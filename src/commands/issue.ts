import { execFile } from "node:child_process";
import type { LinearContext } from "../context.js";
import { getFlag, takeFlag, takeBoolFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { takeBody, truncateBody } from "../body.js";
import { toLinearDuration, parseDueDate } from "../dates.js";
import { AxiError } from "../errors.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import {
  normalizeIssueRef,
  resolveCycle,
  resolveLabel,
  resolveProject,
  resolveState,
  resolveTeam,
  resolveUser,
  type ResolvedTeam,
} from "../resolve.js";
import {
  RELATION_FLAGS,
  RELATION_SELECTION,
  applyRelationChanges,
  formatRelationList,
  parseRelationChanges,
  relationFlagsPresent,
  relationsFromIssue,
  type RelationFlag,
  type RelationSnapshot,
} from "../relations.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  joinArray,
  pluck,
  priorityName,
  relativeTime,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  PRIORITY_NAMES,
  type FieldDef,
} from "../toon.js";

export const ISSUE_HELP = `usage: linear-axi issue <subcommand> [args] [flags]
subcommands[10]:
  list, view, create, update, close, reopen, comment, comments, start, branch
list flags{11}: --assignee <me|email|name|none>, --state <name|type>, --label <name>, --project <name>, --cycle <current|next|previous|n|name>, --priority <urgent|high|medium|low|none>, --query <text>, --updated-since <2h|3d|2w|1m|ISO>, --limit <n> (default 25), --fields <a,b,c> (list only), --sort <updated|created>
view flags{2}: --full (untruncated description), --comments (include comment thread)
create flags{14}: --title (required), --body/--body-file, --assignee, --state, --label (repeatable; must already exist), --priority, --project, --parent <id>, --estimate <n>, --due <YYYY-MM-DD>, --blocked-by <id>, --blocks <id>, --relates-to <id>, --duplicate-of <id> (relation flags repeatable)
update flags{15}: --title, --body/--body-file, --assignee, --state, --label +<name>/-<name> (repeatable; bare adds; labels must already exist), --priority, --project, --cycle, --estimate, --due, --parent <id>, --blocked-by +<id>/-<id>, --blocks +<id>/-<id>, --relates-to +<id>/-<id>, --duplicate-of +<id>/-<id> (bare adds)
close flags{1}: --cancel (use canceled state instead of completed)
comment flags{3}: --body/--body-file (required), --reply-to <comment-id>
start: assigns you, moves to started, creates/checks out the git branch
branch: prints the issue's git branch name only
notes:
  Issue ids accept ABC-123 identifiers or UUIDs; bare numbers use the context team.
  --team <key|name> is accepted after every subcommand (see \`linear-axi --help\`).
  Unknown --label values fail with NOT_FOUND (create the label first via \`label create\`).
  Create/update echo the fields that were set (no follow-up view needed to verify).
examples:
  linear-axi issue list --assignee me --state started
  linear-axi issue view ABC-123 --comments
  linear-axi issue create --team ENG --title "Fix login bug" --body-file plan.md --blocked-by ENG-1
  linear-axi issue update ABC-123 --state "In Review" --label +bug --blocks +ENG-2
  linear-axi issue comment ABC-123 --body "Deployed to staging"
  linear-axi issue start ABC-123
`;

const listSchema: FieldDef[] = [
  field("identifier", "id"),
  field("title"),
  pluck("state", "name", "state"),
  custom("assignee", (i) => i.assignee?.displayName ?? "unassigned"),
];

const LIST_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  labels: { selection: "labels { nodes { name } }", def: joinArray("labels", "name", "labels") },
  project: { selection: "project { name }", def: custom("project", (i) => i.project?.name ?? "none") },
  cycle: { selection: "cycle { number }", def: custom("cycle", (i) => i.cycle?.number ?? "none") },
  priority: { selection: "priority", def: priorityName() },
  estimate: { selection: "estimate", def: custom("estimate", (i) => i.estimate ?? "none") },
  due: { selection: "dueDate", def: custom("due", (i) => i.dueDate ?? "none") },
  created: { selection: "createdAt", def: relativeTime("createdAt", "created") },
  updated: { selection: "updatedAt", def: relativeTime("updatedAt", "updated") },
  url: { selection: "url", def: field("url") },
  creator: { selection: "creator { displayName }", def: custom("creator", (i) => i.creator?.displayName ?? "unknown") },
  parent: { selection: "parent { identifier }", def: custom("parent", (i) => i.parent?.identifier ?? "none") },
  team: { selection: "team { key }", def: pluck("team", "key", "team") },
};

const PRIORITY_NUMBERS: Record<string, number> = Object.fromEntries(
  Object.entries(PRIORITY_NAMES).map(([n, name]) => [name, Number(n)]),
);

const STATE_TYPE_NAMES = new Set([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
]);

interface IssueCore {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { id: string; name: string; type: string };
  assignee: { id: string; displayName: string } | null;
  team: { id: string; key: string; name: string };
  branchName: string;
}

async function fetchIssueCore(ref: string): Promise<IssueCore> {
  const data = await gqlQuery<{ issue: IssueCore | null }>(
    `query($id: String!) { issue(id: $id) {
      id identifier title url branchName
      state { id name type }
      assignee { id displayName }
      team { id key name }
    } }`,
    { id: ref },
  );
  if (!data.issue) {
    throw new AxiError(`Issue ${ref} not found`, "NOT_FOUND", [
      "Run `linear-axi issue list` to see recent issues",
    ]);
  }
  return data.issue;
}

async function contextTeam(ctx?: LinearContext): Promise<ResolvedTeam | undefined> {
  if (!ctx?.team) return undefined;
  return resolveTeam(ctx.team.team);
}

// ---------------------------------------------------------------------------
// list

const LIST_FLAGS = [
  "--assignee",
  "--state",
  "--label",
  "--project",
  "--cycle",
  "--priority",
  "--query",
  "--updated-since",
  "--limit",
  "--fields",
  "--sort",
];

const LIST_ALIASES = {
  "--status": "--status was renamed; use --state instead",
  "--milestone": "Linear has no milestones on issues; use --project or --cycle",
  "--author": "use --creator via --fields, or filter with --assignee",
};

async function listIssues(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue list", LIST_FLAGS, LIST_ALIASES);

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 25, 1), 250) : 25;
  const sort = getFlag(args, "--sort") ?? "updated";
  if (!["updated", "created"].includes(sort)) {
    throw new AxiError(`Invalid --sort value: ${sort}. Use updated or created`, "VALIDATION_ERROR");
  }
  const { extraDefs, extraSelections } = parseFields(getFlag(args, "--fields"), LIST_EXTRA_FIELDS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter tree is dynamic
  const filter: Record<string, any> = {};
  const scopeParts: string[] = [];

  const team = await contextTeam(ctx);
  if (team) {
    filter["team"] = { id: { eq: team.id } };
    scopeParts.push(`team: ${team.key}`);
  }

  const assignee = getFlag(args, "--assignee");
  if (assignee === "none") {
    filter["assignee"] = { null: true };
    scopeParts.push("assignee: none");
  } else if (assignee) {
    const user = await resolveUser(assignee);
    filter["assignee"] = { id: { eq: user.id } };
    scopeParts.push(`assignee: ${user.displayName}`);
  }

  const state = getFlag(args, "--state");
  if (state) {
    if (STATE_TYPE_NAMES.has(state.toLowerCase())) {
      filter["state"] = { type: { eq: state.toLowerCase() } };
      scopeParts.push(`state: ${state.toLowerCase()}`);
    } else if (team) {
      const resolved = await resolveState(team, state);
      filter["state"] = { id: { eq: resolved.id } };
      scopeParts.push(`state: ${resolved.name}`);
    } else {
      filter["state"] = { name: { eqIgnoreCase: state } };
      scopeParts.push(`state: ${state}`);
    }
  }

  const label = getFlag(args, "--label");
  if (label) {
    const resolved = await resolveLabel(label, team);
    filter["labels"] = { some: { id: { eq: resolved.id } } };
    scopeParts.push(`label: ${resolved.name}`);
  }

  const project = getFlag(args, "--project");
  if (project) {
    const resolved = await resolveProject(project);
    filter["project"] = { id: { eq: resolved.id } };
    scopeParts.push(`project: ${resolved.name}`);
  }

  const cycle = getFlag(args, "--cycle");
  if (cycle) {
    if (!team) {
      throw new AxiError("--cycle needs a team. Pass --team <key>", "VALIDATION_ERROR");
    }
    const resolved = await resolveCycle(cycle, team);
    filter["cycle"] = { id: { eq: resolved.id } };
    scopeParts.push(`cycle: ${resolved.number}`);
  }

  const priority = getFlag(args, "--priority");
  if (priority) {
    const num = PRIORITY_NUMBERS[priority.toLowerCase()];
    if (num === undefined) {
      throw new AxiError(
        `Invalid --priority: ${priority}. Use urgent, high, medium, low, or none`,
        "VALIDATION_ERROR",
      );
    }
    filter["priority"] = { eq: num };
    scopeParts.push(`priority: ${priority.toLowerCase()}`);
  }

  const query = getFlag(args, "--query");
  if (query) {
    filter["title"] = { containsIgnoreCase: query };
    scopeParts.push(`query: ${query}`);
  }

  const updatedSince = getFlag(args, "--updated-since");
  if (updatedSince) {
    filter["updatedAt"] = { gt: toLinearDuration(updatedSince, "--updated-since") };
    scopeParts.push(`updated-since: ${updatedSince}`);
  }

  const selections = ["identifier", "title", "state { name }", "assignee { displayName }", ...extraSelections];
  const data = await gqlQuery<{
    issues: { nodes: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($filter: IssueFilter, $first: Int!) {
      issues(filter: $filter, first: $first, orderBy: ${sort === "created" ? "createdAt" : "updatedAt"}) {
        nodes { ${[...new Set(selections)].join(" ")} }
        pageInfo { hasNextPage }
      }
    }`,
    { filter, first: limit },
  );

  const issues = data.issues.nodes;
  const blocks: string[] = [];

  if (issues.length === 0) {
    const scope = scopeParts.length ? ` matching ${scopeParts.join(", ")}` : "";
    blocks.push(`issues: 0 found${scope}`);
  } else {
    blocks.push(formatCountLine({ count: issues.length, limit, hasMore: data.issues.pageInfo.hasNextPage }));
    if (scopeParts.length) blocks.push(`scope: ${scopeParts.join(", ")}`);
    blocks.push(renderList("issues", issues, [...listSchema, ...extraDefs]));
  }

  const hints: string[] = [];
  if (data.issues.pageInfo.hasNextPage) {
    hints.push(`Run \`linear-axi issue list --limit ${Math.min(limit * 2, 250)}\` to see more`);
  }
  blocks.push(
    renderHelp([
      ...hints,
      ...getSuggestions({ domain: "issue", action: "list", isEmpty: issues.length === 0, ctx }),
    ]),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// view

async function viewIssue(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue view", ["--full", "--comments"]);
  const ref = normalizeIssueRef(requireRef(args, "issue id"), ctx);
  const full = takeBoolFlag(args, "--full");
  const withComments = takeBoolFlag(args, "--comments");

  const data = await gqlQuery<{ issue: Record<string, unknown> | null }>(
    `query($id: String!) { issue(id: $id) {
      identifier title description url branchName
      state { name type }
      assignee { displayName }
      team { key }
      project { name }
      cycle { number }
      labels { nodes { name } }
      parent { identifier }
      children(first: 50) { nodes { identifier } }
      ${RELATION_SELECTION}
      comments(first: 50) { nodes { id body createdAt user { displayName } parent { id } } }
      attachments(first: 25) { nodes { title url } }
      priority estimate dueDate updatedAt
    } }`,
    { id: ref },
  );
  if (!data.issue) {
    throw new AxiError(`Issue ${ref} not found`, "NOT_FOUND", [
      "Run `linear-axi issue list` to see recent issues",
    ]);
  }
  const issue = data.issue;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- connection shapes
  const conn = (v: any): any[] => v?.nodes ?? [];
  const rel = relationsFromIssue(
    issue as {
      relations?: { nodes?: { id: string; type: string; relatedIssue?: { identifier: string } }[] };
      inverseRelations?: { nodes?: { id: string; type: string; issue?: { identifier: string } }[] };
    },
  );

  const schema: FieldDef[] = [
    field("identifier", "id"),
    field("title"),
    pluck("state", "name", "state"),
    custom("assignee", (i) => i.assignee?.displayName ?? "unassigned"),
    priorityName(),
    pluck("team", "key", "team"),
    custom("project", (i) => i.project?.name ?? "none"),
    custom("cycle", (i) => i.cycle?.number ?? "none"),
    joinArray("labels", "name", "labels"),
    custom("estimate", (i) => i.estimate ?? "none"),
    custom("due", (i) => i.dueDate ?? "none"),
    custom("parent", (i) => i.parent?.identifier ?? "none"),
    custom("sub_issues", (i) => {
      const kids = conn(i.children).map((k) => k.identifier);
      return kids.length ? kids.join(",") : "none";
    }),
    custom("blocked_by", () => formatRelationList(rel.blocked_by)),
    custom("blocks", () => formatRelationList(rel.blocks)),
    custom("relates_to", () => formatRelationList(rel.relates_to)),
    custom("duplicate_of", () => formatRelationList(rel.duplicate_of)),
    custom("comments", (i) => conn(i.comments).length),
    custom("attachments", (i) => conn(i.attachments).length),
    relativeTime("updatedAt", "updated"),
    field("url"),
    custom("description", (i) =>
      full ? (i.description ?? "") : truncateBody(i.description, 1200),
    ),
  ];

  const blocks: string[] = [renderDetail("issue", issue, schema)];

  if (withComments) {
    const comments = conn(issue["comments"]);
    if (comments.length) {
      blocks.push(renderList("comments", sortThreaded(comments), commentSchema(full)));
    } else {
      blocks.push("comments: 0");
    }
  }

  const stateType = (issue["state"] as { type?: string } | null)?.type ?? "";
  blocks.push(
    renderHelp(
      getSuggestions({ domain: "issue", action: "view", id: String(issue["identifier"]), state: stateType, ctx }),
    ),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// create

const CREATE_FLAGS = [
  "--title",
  "--body",
  "--body-file",
  "--assignee",
  "--state",
  "--label",
  "--priority",
  "--project",
  "--parent",
  "--estimate",
  "--due",
  ...RELATION_FLAGS,
];

/** Fields selected on issueCreate / issueUpdate payloads for mutation echoes. */
const MUTATION_ISSUE_SELECTION = `identifier title url
          state { name type }
          assignee { displayName }
          labels { nodes { name } }
          project { name }
          parent { identifier }
          cycle { number }
          priority estimate dueDate`;

type EchoAxis =
  | "title"
  | "state"
  | "assignee"
  | "labels"
  | "project"
  | "parent"
  | "cycle"
  | "priority"
  | "estimate"
  | "due"
  | "url";

function collectRelationFlagValues(args: string[]): Record<RelationFlag, string[]> {
  const values = {} as Record<RelationFlag, string[]>;
  for (const flag of RELATION_FLAGS) {
    values[flag] = collectRepeatable(args, flag);
  }
  return values;
}

function mutationEchoSchema(
  axes: Set<EchoAxis>,
  relations?: Partial<RelationSnapshot>,
  message?: string,
): FieldDef[] {
  const schema: FieldDef[] = [field("identifier", "id")];
  if (axes.has("title")) schema.push(field("title"));
  if (axes.has("state")) schema.push(pluck("state", "name", "state"));
  if (axes.has("assignee")) {
    schema.push(custom("assignee", (i) => i.assignee?.displayName ?? "unassigned"));
  }
  if (axes.has("labels")) schema.push(joinArray("labels", "name", "labels"));
  if (axes.has("project")) {
    schema.push(custom("project", (i) => i.project?.name ?? "none"));
  }
  if (axes.has("parent")) {
    schema.push(custom("parent", (i) => i.parent?.identifier ?? "none"));
  }
  if (axes.has("cycle")) {
    schema.push(custom("cycle", (i) => i.cycle?.number ?? "none"));
  }
  if (axes.has("priority")) schema.push(priorityName());
  if (axes.has("estimate")) {
    schema.push(custom("estimate", (i) => i.estimate ?? "none"));
  }
  if (axes.has("due")) {
    schema.push(custom("due", (i) => i.dueDate ?? "none"));
  }
  if (relations && relations.blocked_by !== undefined) {
    const ids = relations.blocked_by;
    schema.push(custom("blocked_by", () => formatRelationList(ids)));
  }
  if (relations && relations.blocks !== undefined) {
    const ids = relations.blocks;
    schema.push(custom("blocks", () => formatRelationList(ids)));
  }
  if (relations && relations.relates_to !== undefined) {
    const ids = relations.relates_to;
    schema.push(custom("relates_to", () => formatRelationList(ids)));
  }
  if (relations && relations.duplicate_of !== undefined) {
    const ids = relations.duplicate_of;
    schema.push(custom("duplicate_of", () => formatRelationList(ids)));
  }
  if (axes.has("url")) schema.push(field("url"));
  if (message) schema.push(field("_message", "message"));
  return schema;
}

function relationEcho(
  snapshot: RelationSnapshot,
  touched: Set<keyof RelationSnapshot>,
): Partial<RelationSnapshot> {
  const out: Partial<RelationSnapshot> = {};
  for (const key of touched) out[key] = snapshot[key];
  return out;
}

async function createIssue(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue create", CREATE_FLAGS);

  const team = await contextTeam(ctx);
  if (!team) {
    throw new AxiError("--team is required for issue create", "VALIDATION_ERROR", [
      'Run `linear-axi issue create --team <key> --title "..."`',
      "Run `linear-axi team list` to see team keys",
    ]);
  }
  const title = takeFlag(args, "--title");
  if (!title) {
    throw new AxiError("--title is required", "VALIDATION_ERROR", [
      'Run `linear-axi issue create --team <key> --title "..." [--body "..."]`',
    ]);
  }
  const body = takeBody(args, { valueBoundaryFlags: CREATE_FLAGS });

  const echoed = new Set<EchoAxis>(["title", "state", "url"]);

  // Resolve every reference before mutating so bad input fails cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = { teamId: team.id, title };
  if (body) input["description"] = body;

  const assignee = takeFlag(args, "--assignee");
  if (assignee) {
    input["assigneeId"] = (await resolveUser(assignee)).id;
    echoed.add("assignee");
  }

  const state = takeFlag(args, "--state");
  if (state) input["stateId"] = (await resolveState(team, state)).id;

  const labelNames = collectRepeatable(args, "--label");
  if (labelNames.length) {
    input["labelIds"] = await Promise.all(labelNames.map(async (l) => (await resolveLabel(l, team)).id));
    echoed.add("labels");
  }

  const priority = takeFlag(args, "--priority");
  if (priority) {
    input["priority"] = parsePriority(priority);
    echoed.add("priority");
  }

  const project = takeFlag(args, "--project");
  if (project) {
    input["projectId"] = (await resolveProject(project)).id;
    echoed.add("project");
  }

  const parent = takeFlag(args, "--parent");
  if (parent) {
    input["parentId"] = (await fetchIssueCore(normalizeIssueRef(parent, ctx))).id;
    echoed.add("parent");
  }

  const estimate = takeFlag(args, "--estimate");
  if (estimate) {
    input["estimate"] = parseEstimate(estimate);
    echoed.add("estimate");
  }

  const due = takeFlag(args, "--due");
  if (due) {
    input["dueDate"] = parseDueDate(due);
    echoed.add("due");
  }

  const relationValues = collectRelationFlagValues(args);
  const relationChanges = parseRelationChanges(relationValues, { allowRemove: false });

  const data = await gqlQuery<{
    issueCreate: { success: boolean; issue: Record<string, unknown> };
  }>(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { ${MUTATION_ISSUE_SELECTION} }
      }
    }`,
    { input },
  );

  const issue = data.issueCreate.issue;
  const identifier = String(issue["identifier"]);

  let relEcho: Partial<RelationSnapshot> | undefined;
  if (relationChanges.length) {
    const rel = await applyRelationChanges(identifier, relationChanges, ctx);
    relEcho = relationEcho(rel.snapshot, rel.touched);
  }

  const blocks = [
    renderDetail("issue", issue, mutationEchoSchema(echoed, relEcho)),
    renderHelp(getSuggestions({ domain: "issue", action: "create", id: identifier, ctx })),
  ];
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// update

const UPDATE_FLAGS = [
  "--title",
  "--body",
  "--body-file",
  "--assignee",
  "--state",
  "--label",
  "--priority",
  "--project",
  "--cycle",
  "--parent",
  "--estimate",
  "--due",
  ...RELATION_FLAGS,
];

async function updateIssue(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue update", UPDATE_FLAGS, {
    "--status": "--status was renamed; use --state instead",
  });
  const ref = normalizeIssueRef(requireRef(args, "issue id", UPDATE_FLAGS), ctx);
  const core = await fetchIssueCore(ref);
  const team: ResolvedTeam = { id: core.team.id, key: core.team.key, name: core.team.name };

  const echoed = new Set<EchoAxis>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = {};

  const title = takeFlag(args, "--title");
  if (title) {
    input["title"] = title;
    echoed.add("title");
  }

  const body = takeBody(args, { valueBoundaryFlags: UPDATE_FLAGS });
  if (body !== undefined) input["description"] = body;

  const assignee = takeFlag(args, "--assignee");
  if (assignee === "none") {
    input["assigneeId"] = null;
    echoed.add("assignee");
  } else if (assignee) {
    input["assigneeId"] = (await resolveUser(assignee)).id;
    echoed.add("assignee");
  }

  const state = takeFlag(args, "--state");
  if (state) {
    input["stateId"] = (await resolveState(team, state)).id;
    echoed.add("state");
  }

  const labelNames = collectRepeatable(args, "--label");
  if (labelNames.length) {
    const added: string[] = [];
    const removed: string[] = [];
    for (const raw of labelNames) {
      if (raw.startsWith("-")) removed.push((await resolveLabel(raw.slice(1), team)).id);
      else added.push((await resolveLabel(raw.replace(/^\+/, ""), team)).id);
    }
    if (added.length) input["addedLabelIds"] = added;
    if (removed.length) input["removedLabelIds"] = removed;
    echoed.add("labels");
  }

  const priority = takeFlag(args, "--priority");
  if (priority) {
    input["priority"] = parsePriority(priority);
    echoed.add("priority");
  }

  const project = takeFlag(args, "--project");
  if (project === "none") {
    input["projectId"] = null;
    echoed.add("project");
  } else if (project) {
    input["projectId"] = (await resolveProject(project)).id;
    echoed.add("project");
  }

  const cycle = takeFlag(args, "--cycle");
  if (cycle === "none") {
    input["cycleId"] = null;
    echoed.add("cycle");
  } else if (cycle) {
    input["cycleId"] = (await resolveCycle(cycle, team)).id;
    echoed.add("cycle");
  }

  const parent = takeFlag(args, "--parent");
  if (parent === "none") {
    input["parentId"] = null;
    echoed.add("parent");
  } else if (parent) {
    input["parentId"] = (await fetchIssueCore(normalizeIssueRef(parent, ctx))).id;
    echoed.add("parent");
  }

  const estimate = takeFlag(args, "--estimate");
  if (estimate) {
    input["estimate"] = parseEstimate(estimate);
    echoed.add("estimate");
  }

  const due = takeFlag(args, "--due");
  if (due === "none") {
    input["dueDate"] = null;
    echoed.add("due");
  } else if (due) {
    input["dueDate"] = parseDueDate(due);
    echoed.add("due");
  }

  const relationValues = collectRelationFlagValues(args);
  const relationChanges = parseRelationChanges(relationValues, { allowRemove: true });
  const hasRelations = relationFlagsPresent(relationValues);

  if (Object.keys(input).length === 0 && !hasRelations) {
    throw new AxiError("Nothing to update — pass at least one field flag", "VALIDATION_ERROR", [
      `Run \`linear-axi issue update ${core.identifier} --state <state>\` (see \`issue --help\` for all flags)`,
    ]);
  }

  let issue: Record<string, unknown> = {
    identifier: core.identifier,
    state: { name: core.state.name, type: core.state.type },
    assignee: core.assignee,
  };
  if (Object.keys(input).length > 0) {
    issue = await updateIssueMutation(core.id, input);
  }

  let relEcho: Partial<RelationSnapshot> | undefined;
  let message: string | undefined;
  if (relationChanges.length) {
    const rel = await applyRelationChanges(core.identifier, relationChanges, ctx);
    relEcho = relationEcho(rel.snapshot, rel.touched);
    if (Object.keys(input).length === 0 && rel.allNoops) {
      message = rel.noopMessages.join("; ") || "Already up to date";
      issue = { ...issue, _message: message };
    }
  }

  // Always echo id; when only relations changed, still show id + relation fields.
  if (echoed.size === 0 && !relEcho) echoed.add("state");

  const blocks = [
    renderDetail("issue", issue, mutationEchoSchema(echoed, relEcho, message)),
    renderHelp(getSuggestions({ domain: "issue", action: "update", id: core.identifier, ctx })),
  ];
  return renderOutput(blocks);
}

async function updateIssueMutation(
  issueId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  input: Record<string, any>,
): Promise<Record<string, unknown>> {
  const data = await gqlQuery<{
    issueUpdate: { success: boolean; issue: Record<string, unknown> };
  }>(
    `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { ${MUTATION_ISSUE_SELECTION} }
      }
    }`,
    { id: issueId, input },
  );
  return data.issueUpdate.issue;
}

// ---------------------------------------------------------------------------
// close / reopen — read-check-write idempotent

async function closeIssue(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue close", ["--cancel"]);
  const cancel = takeBoolFlag(args, "--cancel");
  const ref = normalizeIssueRef(requireRef(args, "issue id"), ctx);
  const core = await fetchIssueCore(ref);
  const targetType = cancel ? "canceled" : "completed";

  if (core.state.type === targetType) {
    return renderOutput([
      renderDetail("issue", noopResult(core, `Already ${core.state.name}`), noopResultSchema),
      renderHelp(getSuggestions({ domain: "issue", action: "close", id: core.identifier, ctx })),
    ]);
  }

  const state = await resolveState(core.team, targetType);
  const updated = await updateIssueMutation(core.id, { stateId: state.id });
  return renderOutput([
    renderDetail("issue", updated, stateResultSchema),
    renderHelp(getSuggestions({ domain: "issue", action: "close", id: core.identifier, ctx })),
  ]);
}

async function reopenIssue(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue reopen", []);
  const ref = normalizeIssueRef(requireRef(args, "issue id"), ctx);
  const core = await fetchIssueCore(ref);

  if (core.state.type !== "completed" && core.state.type !== "canceled") {
    return renderOutput([
      renderDetail("issue", noopResult(core, `Already open (${core.state.name})`), noopResultSchema),
      renderHelp(getSuggestions({ domain: "issue", action: "reopen", id: core.identifier, ctx })),
    ]);
  }

  const state = await resolveState(core.team, "unstarted");
  const updated = await updateIssueMutation(core.id, { stateId: state.id });
  return renderOutput([
    renderDetail("issue", updated, stateResultSchema),
    renderHelp(getSuggestions({ domain: "issue", action: "reopen", id: core.identifier, ctx })),
  ]);
}

// encode() renders undefined values as null instead of omitting the key, so
// the message field is only present on the no-op schema.
const stateResultSchema: FieldDef[] = [field("identifier", "id"), pluck("state", "name", "state")];

const noopResultSchema: FieldDef[] = [...stateResultSchema, field("_message", "message")];

function noopResult(core: IssueCore, message: string): Record<string, unknown> {
  return { identifier: core.identifier, state: { name: core.state.name }, _message: message };
}

// ---------------------------------------------------------------------------
// comment / comments

async function commentOnIssue(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue comment", ["--body", "--body-file", "--reply-to"]);
  const ref = normalizeIssueRef(
    requireRef(args, "issue id", ["--body", "--body-file", "--reply-to"]),
    ctx,
  );
  const replyTo = takeFlag(args, "--reply-to");
  const body = takeBody(args, { required: true, valueBoundaryFlags: ["--reply-to"] });
  const core = await fetchIssueCore(ref);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = { issueId: core.id, body };
  if (replyTo) input["parentId"] = replyTo;

  const data = await gqlQuery<{
    commentCreate: { success: boolean; comment: Record<string, unknown> };
  }>(
    `mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body createdAt user { displayName } }
      }
    }`,
    { input },
  );

  const blocks = [
    renderDetail("comment", data.commentCreate.comment, [
      field("id"),
      custom("author", (c) => c.user?.displayName ?? "unknown"),
      relativeTime("createdAt", "created"),
      custom("body", (c) => truncateBody(c.body, 300, { fullHint: "see full thread with `issue comments`" })),
    ]),
    renderHelp(getSuggestions({ domain: "issue", action: "comment", id: core.identifier, ctx })),
  ];
  return renderOutput(blocks);
}

interface CommentNode {
  id: string;
  body: string;
  createdAt: string;
  user: { displayName: string } | null;
  parent: { id: string } | null;
}

function commentSchema(full: boolean): FieldDef[] {
  return [
    field("id"),
    custom("author", (c) => c.user?.displayName ?? "unknown"),
    relativeTime("createdAt", "age"),
    custom("reply_to", (c) => c.parent?.id ?? "none"),
    custom("body", (c) => (full ? c.body : truncateBody(c.body, 300, { fullHint: "use --full for complete bodies" }))),
  ];
}

/** Roots by creation time, each followed by its replies in creation order. */
function sortThreaded(comments: CommentNode[]): CommentNode[] {
  const roots = comments.filter((c) => !c.parent).sort(byCreatedAt);
  const replies = comments.filter((c) => c.parent);
  const result: CommentNode[] = [];
  for (const root of roots) {
    result.push(root);
    result.push(...replies.filter((r) => r.parent?.id === root.id).sort(byCreatedAt));
  }
  // Orphaned replies (parent beyond the fetch window) still get shown.
  const seen = new Set(result.map((c) => c.id));
  result.push(...comments.filter((c) => !seen.has(c.id)).sort(byCreatedAt));
  return result;
}

function byCreatedAt(a: CommentNode, b: CommentNode): number {
  return a.createdAt.localeCompare(b.createdAt);
}

async function listComments(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue comments", ["--full"]);
  const full = takeBoolFlag(args, "--full");
  const ref = normalizeIssueRef(requireRef(args, "issue id"), ctx);

  const data = await gqlQuery<{
    issue: { identifier: string; comments: { nodes: CommentNode[] } } | null;
  }>(
    `query($id: String!) { issue(id: $id) {
      identifier
      comments(first: 50) { nodes { id body createdAt user { displayName } parent { id } } }
    } }`,
    { id: ref },
  );
  if (!data.issue) {
    throw new AxiError(`Issue ${ref} not found`, "NOT_FOUND");
  }

  const comments = data.issue.comments.nodes;
  const blocks: string[] = [];
  if (comments.length === 0) {
    blocks.push(`comments: 0 on ${data.issue.identifier}`);
  } else {
    blocks.push(`count: ${comments.length}`);
    blocks.push(renderList("comments", sortThreaded(comments), commentSchema(full)));
  }
  blocks.push(renderHelp(getSuggestions({ domain: "issue", action: "comments", id: data.issue.identifier, ctx })));
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// start / branch

async function startIssue(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue start", ["--no-branch"]);
  const noBranch = takeBoolFlag(args, "--no-branch");
  const ref = normalizeIssueRef(requireRef(args, "issue id"), ctx);
  const core = await fetchIssueCore(ref);

  const me = await resolveUser("me");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = {};
  if (core.assignee?.id !== me.id) input["assigneeId"] = me.id;
  if (core.state.type !== "started") {
    input["stateId"] = (await resolveState(core.team, "started")).id;
  }

  const isNoop = Object.keys(input).length === 0;
  const updated = isNoop
    ? noopResult(core, `Already started and assigned`)
    : await updateIssueMutation(core.id, input);

  const startSchema: FieldDef[] = [
    field("identifier", "id"),
    pluck("state", "name", "state"),
    custom("assignee", (i) => i.assignee?.displayName ?? me.displayName),
    ...(isNoop ? [field("_message", "message")] : []),
  ];
  const blocks: string[] = [renderDetail("issue", updated, startSchema)];

  if (!noBranch) {
    const branchResult = await checkoutBranch(core.branchName);
    blocks.push(`branch: ${core.branchName} (${branchResult})`);
  } else {
    blocks.push(`branch: ${core.branchName} (skipped)`);
  }

  blocks.push(renderHelp(getSuggestions({ domain: "issue", action: "start", id: core.identifier, ctx })));
  return renderOutput(blocks);
}

function git(gitArgs: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", gitArgs, { timeout: 10000 }, (error, _stdout, stderr) => {
      resolve({ ok: !error, stderr: stderr?.toString() ?? "" });
    });
  });
}

async function checkoutBranch(branch: string): Promise<string> {
  const exists = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (exists.ok) {
    const checkout = await git(["checkout", branch]);
    if (!checkout.ok) {
      throw branchError(branch, "checkout", checkout.stderr);
    }
    return "checked out existing";
  }
  const create = await git(["checkout", "-b", branch]);
  if (!create.ok) {
    throw branchError(branch, "create", create.stderr);
  }
  return "created";
}

function branchError(branch: string, action: "checkout" | "create", stderr: string): AxiError {
  const detail = firstLine(stderr) || "git returned a non-zero exit status";
  return new AxiError(
    `Issue was started, but Git could not ${action} branch ${branch}: ${detail}`,
    "UNKNOWN",
    ["Resolve the Git working-tree error, then rerun `linear-axi issue start <id>`"],
  );
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

async function branchName(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "issue branch", []);
  const ref = normalizeIssueRef(requireRef(args, "issue id"), ctx);
  const core = await fetchIssueCore(ref);
  // Bare value on purpose: composable with `git checkout -b $(...)`.
  return core.branchName;
}

// ---------------------------------------------------------------------------
// shared helpers + dispatcher

function requireRef(args: string[], label: string, valueTakingFlags: readonly string[] = []): string {
  const ref = getPositional(args, 1, valueTakingFlags);
  if (!ref) {
    throw new AxiError(`Missing ${label}`, "VALIDATION_ERROR", [
      "Pass an issue identifier like ABC-123",
    ]);
  }
  return ref;
}

/** Collect all --label values, tolerating repeated flags. */
function collectRepeatable(args: string[], flag: string): string[] {
  const values: string[] = [];
  let value = takeFlag(args, flag);
  while (value !== undefined) {
    values.push(value);
    value = takeFlag(args, flag);
  }
  return values;
}

function parsePriority(raw: string): number {
  const num = PRIORITY_NUMBERS[raw.toLowerCase()];
  if (num === undefined) {
    throw new AxiError(`Invalid --priority: ${raw}. Use urgent, high, medium, low, or none`, "VALIDATION_ERROR");
  }
  return num;
}

function parseEstimate(raw: string): number {
  const num = Number(raw);
  // IssueCreateInput/IssueUpdateInput declare estimate as Int.
  if (!Number.isInteger(num) || num < 0) {
    throw new AxiError(`Invalid --estimate: ${raw}. Use a non-negative integer`, "VALIDATION_ERROR");
  }
  return num;
}

export async function issueCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return ISSUE_HELP;

  switch (sub) {
    case "list":
      return listIssues(args, ctx);
    case "view":
      return viewIssue(args, ctx);
    case "create":
      return createIssue(args, ctx);
    case "update":
      return updateIssue(args, ctx);
    case "close":
      return closeIssue(args, ctx);
    case "reopen":
      return reopenIssue(args, ctx);
    case "comment":
      return commentOnIssue(args, ctx);
    case "comments":
      return listComments(args, ctx);
    case "start":
      return startIssue(args, ctx);
    case "branch":
      return branchName(args, ctx);
    default:
      return renderError(`Unknown issue subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi issue --help` for usage",
      ]);
  }
}
