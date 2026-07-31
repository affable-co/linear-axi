import type { LinearContext } from "../context.js";
import { getFlag, takeFlag, takeBoolFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { takeBody, truncateBody } from "../body.js";
import { parseDueDate } from "../dates.js";
import { AxiError } from "../errors.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import {
  resolveProject,
  resolveProjectStatus,
  resolveTeam,
  resolveUser,
  type ResolvedTeam,
} from "../resolve.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  joinArray,
  relativeTime,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const PROJECT_HELP = `usage: linear-axi project <subcommand> [args] [flags]
subcommands[4]:
  list, view <name|uuid>, create, update <name|uuid>
list flags{4}: --state <backlog|planned|started|paused|completed|canceled>, --query <text> (name contains), --limit <n> (default 25), --fields <a,b,c>
view flags{1}: --full (untruncated description)
create flags{6}: --name (required), --body/--body-file, --lead <me|email|name>, --state, --start <YYYY-MM-DD>, --target <YYYY-MM-DD>
update flags{6}: --name, --body/--body-file, --lead, --state, --start <YYYY-MM-DD>, --target <YYYY-MM-DD>
notes:
  --team <key> (from flag, LINEAR_TEAM, .linear.toml, or git branch) is required for create.
  Extra --fields for list: lead, teams, start, created, updated, url.
examples:
  linear-axi project list --state started
  linear-axi project view "Mobile App"
  linear-axi project create --team ENG --name "Q3 Launch" --target 2026-09-30
  linear-axi project update "Q3 Launch" --state completed
`;

/** Valid Project.state enum values (Linear ProjectFilter state comparator). */
const PROJECT_STATES = new Set(["backlog", "planned", "started", "paused", "completed", "canceled"]);

function validateProjectState(raw: string, flag = "--state"): string {
  const value = raw.toLowerCase();
  if (!PROJECT_STATES.has(value)) {
    throw new AxiError(
      `Invalid ${flag}: ${raw}. Use ${[...PROJECT_STATES].join(", ")}`,
      "VALIDATION_ERROR",
    );
  }
  return value;
}

function progressPercent(p: { progress?: number }): string {
  return `${Math.round((p.progress ?? 0) * 100)}%`;
}

async function contextTeam(ctx?: LinearContext): Promise<ResolvedTeam | undefined> {
  if (!ctx?.team) return undefined;
  return resolveTeam(ctx.team.team);
}

// ---------------------------------------------------------------------------
// list

const LIST_FLAGS = ["--state", "--query", "--limit", "--fields"];

const listSchema: FieldDef[] = [
  field("name"),
  field("state"),
  custom("progress", progressPercent),
  custom("target", (p) => p.targetDate ?? "none"),
];

const LIST_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  lead: { selection: "lead { displayName }", def: custom("lead", (p) => p.lead?.displayName ?? "none") },
  teams: { selection: "teams { nodes { key } }", def: joinArray("teams", "key", "teams") },
  start: { selection: "startDate", def: custom("start", (p) => p.startDate ?? "none") },
  created: { selection: "createdAt", def: relativeTime("createdAt", "created") },
  updated: { selection: "updatedAt", def: relativeTime("updatedAt", "updated") },
  url: { selection: "url", def: field("url") },
};

async function listProjects(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "project list", LIST_FLAGS);

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 25, 1), 250) : 25;
  const { extraDefs, extraSelections } = parseFields(getFlag(args, "--fields"), LIST_EXTRA_FIELDS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter tree is dynamic
  const filter: Record<string, any> = {};
  const scopeParts: string[] = [];

  const state = getFlag(args, "--state");
  if (state) {
    const value = validateProjectState(state);
    filter["state"] = { eq: value };
    scopeParts.push(`state: ${value}`);
  }

  const query = getFlag(args, "--query");
  if (query) {
    filter["name"] = { containsIgnoreCase: query };
    scopeParts.push(`query: ${query}`);
  }

  const selections = ["name", "state", "progress", "targetDate", ...extraSelections];
  const data = await gqlQuery<{
    projects: { nodes: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($filter: ProjectFilter, $first: Int!) {
      projects(filter: $filter, first: $first, orderBy: updatedAt) {
        nodes { ${[...new Set(selections)].join(" ")} }
        pageInfo { hasNextPage }
      }
    }`,
    { filter, first: limit },
  );

  const projects = data.projects.nodes;
  const blocks: string[] = [];

  if (projects.length === 0) {
    const scope = scopeParts.length ? ` matching ${scopeParts.join(", ")}` : "";
    blocks.push(`projects: 0 found${scope}`);
  } else {
    blocks.push(formatCountLine({ count: projects.length, limit, hasMore: data.projects.pageInfo.hasNextPage }));
    if (scopeParts.length) blocks.push(`scope: ${scopeParts.join(", ")}`);
    blocks.push(renderList("projects", projects, [...listSchema, ...extraDefs]));
  }

  const hints: string[] = [];
  if (data.projects.pageInfo.hasNextPage) {
    hints.push(`Run \`linear-axi project list --limit ${Math.min(limit * 2, 250)}\` to see more`);
  }
  blocks.push(
    renderHelp([
      ...hints,
      ...getSuggestions({ domain: "project", action: "list", isEmpty: projects.length === 0, ctx }),
    ]),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// view

async function viewProject(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "project view", ["--full"]);
  const ref = requireName(args);
  const full = takeBoolFlag(args, "--full");
  const resolved = await resolveProject(ref);

  const data = await gqlQuery<{ project: Record<string, unknown> | null }>(
    `query($id: String!) { project(id: $id) {
      name state progress
      lead { displayName }
      teams { nodes { key } }
      startDate targetDate url description updatedAt
    } }`,
    { id: resolved.id },
  );
  if (!data.project) {
    throw new AxiError(`Project ${ref} not found`, "NOT_FOUND", [
      "Run `linear-axi project list` to see available projects",
    ]);
  }
  const project = data.project;

  const schema: FieldDef[] = [
    field("name"),
    field("state"),
    custom("progress", progressPercent),
    custom("lead", (p) => p.lead?.displayName ?? "none"),
    joinArray("teams", "key", "teams"),
    custom("start", (p) => p.startDate ?? "none"),
    custom("target", (p) => p.targetDate ?? "none"),
    relativeTime("updatedAt", "updated"),
    field("url"),
    custom("description", (p) => (full ? (p.description ?? "") : truncateBody(p.description, 1200))),
  ];

  return renderOutput([
    renderDetail("project", project, schema),
    renderHelp(getSuggestions({ domain: "project", action: "view", id: String(project["name"]), ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// create

const CREATE_FLAGS = ["--name", "--body", "--body-file", "--lead", "--state", "--start", "--target"];

async function createProject(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "project create", CREATE_FLAGS);

  const team = await contextTeam(ctx);
  if (!team) {
    throw new AxiError("--team is required for project create", "VALIDATION_ERROR", [
      'Run `linear-axi project create --team <key> --name "..."`',
      "Run `linear-axi team list` to see team keys",
    ]);
  }
  const name = takeFlag(args, "--name");
  if (!name) {
    throw new AxiError("--name is required", "VALIDATION_ERROR", [
      'Run `linear-axi project create --team <key> --name "..."`',
    ]);
  }
  const body = takeBody(args, { valueBoundaryFlags: CREATE_FLAGS });

  // Resolve every reference before mutating so bad input fails cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = { name, teamIds: [team.id] };
  if (body) input["description"] = body;

  const lead = takeFlag(args, "--lead");
  if (lead) input["leadId"] = (await resolveUser(lead)).id;

  // Project mutations take statusId — the string `state` field is deprecated
  // and not present on ProjectCreateInput/ProjectUpdateInput.
  const state = takeFlag(args, "--state");
  if (state) input["statusId"] = (await resolveProjectStatus(state)).id;

  const start = takeFlag(args, "--start");
  if (start) input["startDate"] = parseDueDate(start, "--start");

  const target = takeFlag(args, "--target");
  if (target) input["targetDate"] = parseDueDate(target, "--target");

  const data = await gqlQuery<{
    projectCreate: { success: boolean; project: Record<string, unknown> };
  }>(
    `mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project { id name state url }
      }
    }`,
    { input },
  );

  const project = data.projectCreate.project;
  return renderOutput([
    renderDetail("project", project, [field("name"), field("state"), field("url")]),
    renderHelp(getSuggestions({ domain: "project", action: "create", id: String(project["name"]), ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// update

const UPDATE_FLAGS = ["--name", "--body", "--body-file", "--lead", "--state", "--start", "--target"];

async function updateProject(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "project update", UPDATE_FLAGS);
  const ref = requireName(args, UPDATE_FLAGS);
  const resolved = await resolveProject(ref);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = {};

  const name = takeFlag(args, "--name");
  if (name) input["name"] = name;

  const body = takeBody(args, { valueBoundaryFlags: UPDATE_FLAGS });
  if (body !== undefined) input["description"] = body;

  const lead = takeFlag(args, "--lead");
  if (lead === "none") input["leadId"] = null;
  else if (lead) input["leadId"] = (await resolveUser(lead)).id;

  const state = takeFlag(args, "--state");
  if (state) input["statusId"] = (await resolveProjectStatus(state)).id;

  const start = takeFlag(args, "--start");
  if (start) input["startDate"] = parseDueDate(start, "--start");

  const target = takeFlag(args, "--target");
  if (target) input["targetDate"] = parseDueDate(target, "--target");

  if (Object.keys(input).length === 0) {
    throw new AxiError("Nothing to update — pass at least one field flag", "VALIDATION_ERROR", [
      `Run \`linear-axi project update "${resolved.name}" --state <state>\` (see \`project --help\` for all flags)`,
    ]);
  }

  const data = await gqlQuery<{
    projectUpdate: { success: boolean; project: Record<string, unknown> };
  }>(
    `mutation($id: String!, $input: ProjectUpdateInput!) {
      projectUpdate(id: $id, input: $input) {
        success
        project { name state url }
      }
    }`,
    { id: resolved.id, input },
  );

  const project = data.projectUpdate.project;
  return renderOutput([
    renderDetail("project", project, [field("name"), field("state"), field("url")]),
    renderHelp(getSuggestions({ domain: "project", action: "update", id: String(project["name"]), ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// shared helpers + dispatcher

function requireName(args: string[], valueTakingFlags: readonly string[] = []): string {
  const ref = getPositional(args, 1, valueTakingFlags);
  if (!ref) {
    throw new AxiError("Missing project name or uuid", "VALIDATION_ERROR", [
      "Run `linear-axi project list` to see available projects",
    ]);
  }
  return ref;
}

export async function projectCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return PROJECT_HELP;

  switch (sub) {
    case "list":
      return listProjects(args, ctx);
    case "view":
      return viewProject(args, ctx);
    case "create":
      return createProject(args, ctx);
    case "update":
      return updateProject(args, ctx);
    default:
      return renderError(`Unknown project subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi project --help` for usage",
      ]);
  }
}
