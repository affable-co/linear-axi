import { AxiError } from "./errors.js";
import { gqlQuery } from "./linear.js";
import type { LinearContext } from "./context.js";

/**
 * The single shared resolver for every flag that accepts a human name.
 *
 * Every command flag resolves through here so `--team`, `--state`, `--label`,
 * `--project`, `--cycle`, and `--assignee` behave identically: UUIDs pass
 * through, names match case-insensitively, and unknown names fail with the
 * available options inlined (self-correcting in one turn).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_RE = /^[A-Za-z0-9]+-\d+$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export interface ResolvedTeam {
  id: string;
  key: string;
  name: string;
}

export interface ResolvedRef {
  id: string;
  name: string;
}

export interface ResolvedState extends ResolvedRef {
  type: string;
}

export interface ResolvedCycle extends ResolvedRef {
  number: number;
}

/** Per-process caches; a CLI invocation is short-lived. */
const teamCache = new Map<string, ResolvedTeam>();
const stateCache = new Map<string, ResolvedState>();

/** Workflow state types in Linear's canonical progression order. */
export const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"];

export async function resolveTeam(input: string): Promise<ResolvedTeam> {
  const cached = teamCache.get(input.toLowerCase());
  if (cached) return cached;

  if (isUuid(input)) {
    const data = await gqlQuery<{ team: ResolvedTeam | null }>(
      `query($id: String!) { team(id: $id) { id key name } }`,
      { id: input },
    );
    if (!data.team) throw new AxiError(`Team ${input} not found`, "NOT_FOUND");
    teamCache.set(input.toLowerCase(), data.team);
    return data.team;
  }

  const data = await gqlQuery<{ teams: { nodes: ResolvedTeam[] } }>(
    `query { teams(first: 100) { nodes { id key name } } }`,
  );
  const teams = data.teams.nodes;
  const match =
    teams.find((t) => t.key.toLowerCase() === input.toLowerCase()) ??
    teams.find((t) => t.name.toLowerCase() === input.toLowerCase());
  if (!match) {
    throw new AxiError(
      `Unknown team: ${input}. Available: ${teams.map((t) => t.key).join(", ")}`,
      "NOT_FOUND",
    );
  }
  teamCache.set(input.toLowerCase(), match);
  return match;
}

/**
 * Resolve a workflow state by name or by state *type*
 * (triage/backlog/unstarted/started/completed/canceled → first state of that
 * type by position).
 */
export async function resolveState(team: ResolvedTeam, input: string): Promise<ResolvedState> {
  if (isUuid(input)) return { id: input, name: input, type: "unknown" };

  const cacheKey = `${team.id}:${input.toLowerCase()}`;
  const cached = stateCache.get(cacheKey);
  if (cached) return cached;

  const states = await teamStates(team);
  const byName = states.find((s) => s.name.toLowerCase() === input.toLowerCase());
  const byType = STATE_TYPES.includes(input.toLowerCase())
    ? states.filter((s) => s.type === input.toLowerCase()).sort((a, b) => a.position - b.position)[0]
    : undefined;
  const match = byName ?? byType;
  if (!match) {
    throw new AxiError(
      `Unknown state "${input}" for team ${team.key}. Available: ${states.map((s) => s.name).join(", ")} (or a type: ${STATE_TYPES.join(", ")})`,
      "NOT_FOUND",
    );
  }
  const resolved = { id: match.id, name: match.name, type: match.type };
  stateCache.set(cacheKey, resolved);
  return resolved;
}

interface StateNode extends ResolvedState {
  position: number;
}

export async function teamStates(team: ResolvedTeam): Promise<StateNode[]> {
  const data = await gqlQuery<{ workflowStates: { nodes: StateNode[] } }>(
    `query($teamId: ID!) { workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 100) { nodes { id name type position } } }`,
    { teamId: team.id },
  );
  return data.workflowStates.nodes;
}

export interface ResolvedUser {
  id: string;
  displayName: string;
}

export async function resolveUser(input: string): Promise<ResolvedUser> {
  if (input === "me") {
    const data = await gqlQuery<{ viewer: ResolvedUser }>(`query { viewer { id displayName } }`);
    return data.viewer;
  }
  if (isUuid(input)) return { id: input, displayName: input };

  interface UserNode extends ResolvedUser {
    name: string;
    email: string;
  }
  const data = await gqlQuery<{ users: { nodes: UserNode[] } }>(
    `query { users(first: 250) { nodes { id displayName name email } } }`,
  );
  const users = data.users.nodes;
  const lower = input.toLowerCase();
  const exact = users.find(
    (u) =>
      u.email.toLowerCase() === lower ||
      u.displayName.toLowerCase() === lower ||
      u.name.toLowerCase() === lower,
  );
  if (exact) return exact;

  const partial = users.filter(
    (u) => u.displayName.toLowerCase().includes(lower) || u.name.toLowerCase().includes(lower),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new AxiError(
      `Ambiguous user "${input}": ${partial.map((u) => u.displayName).join(", ")}`,
      "VALIDATION_ERROR",
    );
  }
  throw new AxiError(`Unknown user: ${input}. Use "me", an email, or a display name`, "NOT_FOUND");
}

export async function resolveLabel(input: string, team?: ResolvedTeam): Promise<ResolvedRef> {
  if (isUuid(input)) return { id: input, name: input };

  interface LabelNode extends ResolvedRef {
    team: { id: string } | null;
  }
  const data = await gqlQuery<{ issueLabels: { nodes: LabelNode[] } }>(
    `query($name: String!) { issueLabels(filter: { name: { eqIgnoreCase: $name } }, first: 50) { nodes { id name team { id } } } }`,
    { name: input },
  );
  const labels = data.issueLabels.nodes;
  // Prefer the team-scoped label, then a workspace label.
  const match =
    (team && labels.find((l) => l.team?.id === team.id)) ?? labels.find((l) => l.team === null) ?? labels[0];
  if (!match) {
    throw new AxiError(
      `Unknown label: ${input}`,
      "NOT_FOUND",
      [`Run \`linear-axi label list${team ? ` --team ${team.key}` : ""}\` to see available labels`],
    );
  }
  return match;
}

export async function resolveProject(input: string): Promise<ResolvedRef> {
  if (isUuid(input)) return { id: input, name: input };

  const data = await gqlQuery<{ projects: { nodes: ResolvedRef[] } }>(
    `query($name: String!) { projects(filter: { name: { eqIgnoreCase: $name } }, first: 10) { nodes { id name } } }`,
    { name: input },
  );
  const matches = data.projects.nodes;
  if (matches.length === 0) {
    throw new AxiError(`Unknown project: ${input}`, "NOT_FOUND", [
      "Run `linear-axi project list` to see available projects",
    ]);
  }
  if (matches.length > 1) {
    throw new AxiError(
      `Ambiguous project "${input}". Available: ${matches.map((project) => `${project.name} (${project.id})`).join(", ")}`,
      "VALIDATION_ERROR",
      ["Pass the project's UUID to select it unambiguously"],
    );
  }
  return matches[0];
}

export async function resolveCycle(input: string, team: ResolvedTeam): Promise<ResolvedCycle> {
  if (isUuid(input)) return { id: input, name: input, number: 0 };

  const relative = input.toLowerCase();
  if (relative === "current" || relative === "next" || relative === "previous") {
    const filterField =
      relative === "current" ? "isActive" : relative === "next" ? "isNext" : "isPrevious";
    const data = await gqlQuery<{ cycles: { nodes: ResolvedCycle[] } }>(
      `query($teamId: ID!) { cycles(filter: { team: { id: { eq: $teamId } }, ${filterField}: { eq: true } }, first: 1) { nodes { id number name } } }`,
      { teamId: team.id },
    );
    const cycle = data.cycles.nodes[0];
    if (!cycle) {
      throw new AxiError(`Team ${team.key} has no ${relative} cycle`, "NOT_FOUND", [
        `Run \`linear-axi cycle list --team ${team.key}\` to see cycles`,
      ]);
    }
    return cycle;
  }

  if (/^\d+$/.test(input)) {
    const data = await gqlQuery<{ cycles: { nodes: ResolvedCycle[] } }>(
      `query($teamId: ID!, $number: Float!) { cycles(filter: { team: { id: { eq: $teamId } }, number: { eq: $number } }, first: 1) { nodes { id number name } } }`,
      { teamId: team.id, number: Number(input) },
    );
    const cycle = data.cycles.nodes[0];
    if (!cycle) throw new AxiError(`Cycle ${input} not found for team ${team.key}`, "NOT_FOUND");
    return cycle;
  }

  const data = await gqlQuery<{ cycles: { nodes: ResolvedCycle[] } }>(
    `query($teamId: ID!, $name: String!) { cycles(filter: { team: { id: { eq: $teamId } }, name: { eqIgnoreCase: $name } }, first: 1) { nodes { id number name } } }`,
    { teamId: team.id, name: input },
  );
  const cycle = data.cycles.nodes[0];
  if (!cycle) {
    throw new AxiError(
      `Unknown cycle "${input}" for team ${team.key}. Use current, next, previous, a number, or a name`,
      "NOT_FOUND",
    );
  }
  return cycle;
}

export interface ResolvedProjectStatus extends ResolvedRef {
  type: string;
}

/**
 * Resolve a project status by name or type. Project mutations take statusId —
 * the string `state` field on projects is deprecated and not writable.
 */
export async function resolveProjectStatus(input: string): Promise<ResolvedProjectStatus> {
  if (isUuid(input)) return { id: input, name: input, type: "unknown" };

  const data = await gqlQuery<{ projectStatuses: { nodes: ResolvedProjectStatus[] } }>(
    `query { projectStatuses(first: 50) { nodes { id name type } } }`,
  );
  const statuses = data.projectStatuses.nodes;
  const lower = input.toLowerCase();
  const match =
    statuses.find((s) => s.name.toLowerCase() === lower) ??
    statuses.find((s) => s.type.toLowerCase() === lower);
  if (!match) {
    const names = statuses.map((s) => s.name).join(", ");
    const types = [...new Set(statuses.map((s) => s.type.toLowerCase()))].join(", ");
    throw new AxiError(
      `Unknown project status "${input}". Available: ${names} (or a type: ${types})`,
      "NOT_FOUND",
    );
  }
  return match;
}

/**
 * Normalize an issue reference to a canonical identifier (ABC-123).
 * Bare numbers use the context team's key; UUIDs pass through.
 * Linear's `issue(id:)` accepts identifiers directly, so no lookup is needed.
 */
export function normalizeIssueRef(input: string, ctx?: LinearContext): string {
  const trimmed = input.trim();
  if (isUuid(trimmed)) return trimmed;
  if (IDENTIFIER_RE.test(trimmed)) return trimmed.toUpperCase();
  if (/^\d+$/.test(trimmed)) {
    const teamKey = ctx?.team?.team ?? ctx?.branchIssue?.split("-")[0];
    if (teamKey) return `${teamKey.toUpperCase()}-${trimmed}`;
    throw new AxiError(
      `Bare issue number ${trimmed} needs a team. Use the full identifier (e.g. ABC-${trimmed}) or pass --team`,
      "VALIDATION_ERROR",
    );
  }
  throw new AxiError(
    `Invalid issue reference: ${input}. Use an identifier like ABC-123`,
    "VALIDATION_ERROR",
  );
}

/** Test seam: clear resolver caches. */
export function clearResolverCaches(): void {
  teamCache.clear();
  stateCache.clear();
}
