import type { LinearContext } from "../context.js";
import { getFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { takeBody, truncateBody } from "../body.js";
import { AxiError } from "../errors.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import { resolveProject } from "../resolve.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  relativeTime,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const DOC_HELP = `usage: linear-axi doc <subcommand> [args] [flags]
subcommands[4]:
  list, view, create, update
list flags{4}: --query <text> (title contains), --project <name>, --limit <n> (default 25), --fields <a,b,c> (list only)
view flags{1}: --full (untruncated content)
create flags{3}: --title (required), --body/--body-file (content), --project <name>
update flags{3}: --title, --body/--body-file (content)
notes:
  Document ids are UUIDs (shown as \`id\`); pass one to \`doc view <id>\`.
  Extra --fields for list: creator, url, created, team, summary.
examples:
  linear-axi doc list --query onboarding
  linear-axi doc view 5f2c9c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f
  linear-axi doc create --title "Runbook" --body-file runbook.md
  linear-axi doc update 5f2c9c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f --title "Runbook v2"
`;

const listSchema: FieldDef[] = [
  field("id"),
  field("title"),
  custom("project", (d) => d.project?.name ?? "none"),
  relativeTime("updatedAt", "updated"),
];

const LIST_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  creator: {
    selection: "creator { displayName }",
    def: custom("creator", (d) => d.creator?.displayName ?? "unknown"),
  },
  url: { selection: "url", def: field("url") },
  created: { selection: "createdAt", def: relativeTime("createdAt", "created") },
  team: { selection: "team { key }", def: custom("team", (d) => d.team?.key ?? "none") },
  summary: { selection: "summary", def: custom("summary", (d) => d.summary ?? "none") },
};

// ---------------------------------------------------------------------------
// list

const LIST_FLAGS = ["--query", "--project", "--limit", "--fields"];

async function listDocs(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "doc list", LIST_FLAGS);

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 25, 1), 250) : 25;
  const { extraDefs, extraSelections } = parseFields(getFlag(args, "--fields"), LIST_EXTRA_FIELDS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter tree is dynamic
  const filter: Record<string, any> = {};
  const scopeParts: string[] = [];

  const query = getFlag(args, "--query");
  if (query) {
    filter["title"] = { containsIgnoreCase: query };
    scopeParts.push(`query: ${query}`);
  }

  const project = getFlag(args, "--project");
  if (project) {
    const resolved = await resolveProject(project);
    filter["project"] = { id: { eq: resolved.id } };
    scopeParts.push(`project: ${resolved.name}`);
  }

  const selections = ["id", "title", "project { name }", "updatedAt", ...extraSelections];
  const data = await gqlQuery<{
    documents: { nodes: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($filter: DocumentFilter, $first: Int!) {
      documents(filter: $filter, first: $first) {
        nodes { ${[...new Set(selections)].join(" ")} }
        pageInfo { hasNextPage }
      }
    }`,
    { filter, first: limit },
  );

  const docs = data.documents.nodes;
  const blocks: string[] = [];

  if (docs.length === 0) {
    const scope = scopeParts.length ? ` matching ${scopeParts.join(", ")}` : "";
    blocks.push(`docs: 0 found${scope}`);
  } else {
    blocks.push(formatCountLine({ count: docs.length, limit, hasMore: data.documents.pageInfo.hasNextPage }));
    if (scopeParts.length) blocks.push(`scope: ${scopeParts.join(", ")}`);
    blocks.push(renderList("docs", docs, [...listSchema, ...extraDefs]));
  }

  const hints: string[] = [];
  if (data.documents.pageInfo.hasNextPage) {
    hints.push(`Run \`linear-axi doc list --limit ${Math.min(limit * 2, 250)}\` to see more`);
  }
  blocks.push(
    renderHelp([...hints, ...getSuggestions({ domain: "doc", action: "list", isEmpty: docs.length === 0, ctx })]),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// view

async function viewDoc(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "doc view", ["--full"]);
  const id = requireId(args);
  const full = args.includes("--full");

  const data = await gqlQuery<{ document: Record<string, unknown> | null }>(
    `query($id: String!) { document(id: $id) {
      id title url updatedAt content
      creator { displayName }
      project { name }
    } }`,
    { id },
  );
  if (!data.document) {
    throw new AxiError(`Document ${id} not found`, "NOT_FOUND", [
      "Run `linear-axi doc list` to see recent documents",
    ]);
  }
  const doc = data.document;

  const schema: FieldDef[] = [
    field("id"),
    field("title"),
    custom("creator", (d) => d.creator?.displayName ?? "unknown"),
    custom("project", (d) => d.project?.name ?? "none"),
    relativeTime("updatedAt", "updated"),
    field("url"),
    custom("content", (d) => (full ? (d.content ?? "") : truncateBody(d.content, 1500))),
  ];

  return renderOutput([
    renderDetail("doc", doc, schema),
    renderHelp(getSuggestions({ domain: "doc", action: "view", id: String(doc["id"]), ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// create

const CREATE_FLAGS = ["--title", "--body", "--body-file", "--project"];

async function createDoc(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "doc create", CREATE_FLAGS);

  const title = getFlag(args, "--title");
  if (!title) {
    throw new AxiError("--title is required", "VALIDATION_ERROR", [
      'Run `linear-axi doc create --title "..." [--body "..."]`',
    ]);
  }
  const body = takeBody(args, { valueBoundaryFlags: CREATE_FLAGS });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = { title };
  if (body) input["content"] = body;

  const project = getFlag(args, "--project");
  if (project) input["projectId"] = (await resolveProject(project)).id;

  const data = await gqlQuery<{
    documentCreate: { success: boolean; document: Record<string, unknown> };
  }>(
    `mutation($input: DocumentCreateInput!) {
      documentCreate(input: $input) {
        success
        document { id title url }
      }
    }`,
    { input },
  );

  const doc = data.documentCreate.document;
  return renderOutput([
    renderDetail("doc", doc, [field("id"), field("title"), field("url")]),
    renderHelp(getSuggestions({ domain: "doc", action: "create", id: String(doc["id"]), ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// update

const UPDATE_FLAGS = ["--title", "--body", "--body-file"];

async function updateDoc(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "doc update", UPDATE_FLAGS);
  const id = requireId(args, UPDATE_FLAGS);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = {};

  const title = getFlag(args, "--title");
  if (title) input["title"] = title;

  const body = takeBody(args, { valueBoundaryFlags: UPDATE_FLAGS });
  if (body !== undefined) input["content"] = body;

  if (Object.keys(input).length === 0) {
    throw new AxiError("Nothing to update — pass --title and/or --body", "VALIDATION_ERROR", [
      `Run \`linear-axi doc update ${id} --title "..."\``,
    ]);
  }

  const data = await gqlQuery<{
    documentUpdate: { success: boolean; document: Record<string, unknown> };
  }>(
    `mutation($id: String!, $input: DocumentUpdateInput!) {
      documentUpdate(id: $id, input: $input) {
        success
        document { id title url }
      }
    }`,
    { id, input },
  );

  const doc = data.documentUpdate.document;
  return renderOutput([
    renderDetail("doc", doc, [field("id"), field("title"), field("url")]),
    renderHelp(getSuggestions({ domain: "doc", action: "update", id: String(doc["id"]), ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// shared helpers + dispatcher

function requireId(args: string[], valueTakingFlags: readonly string[] = []): string {
  const id = getPositional(args, 1, valueTakingFlags);
  if (!id) {
    throw new AxiError("Missing document id", "VALIDATION_ERROR", [
      "Pass a document id (see `linear-axi doc list`)",
    ]);
  }
  return id;
}

export async function docCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return DOC_HELP;

  switch (sub) {
    case "list":
      return listDocs(args, ctx);
    case "view":
      return viewDoc(args, ctx);
    case "create":
      return createDoc(args, ctx);
    case "update":
      return updateDoc(args, ctx);
    default:
      return renderError(`Unknown doc subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi doc --help` for usage",
      ]);
  }
}
