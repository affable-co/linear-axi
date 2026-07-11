import type { LinearContext } from "../context.js";
import { getFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import { resolveUser } from "../resolve.js";
import { getSuggestions } from "../suggestions.js";
import {
  boolYesNo,
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

export const USER_HELP = `usage: linear-axi user <subcommand> [args] [flags]
subcommands[2]:
  list, view <me|email|name|uuid>
list flags{2}: --limit <n> (default 100), --query <text> (display name contains)
view: profile plus a precomputed count of the user's open assigned issues
examples:
  linear-axi user list
  linear-axi user list --query alice
  linear-axi user view me
`;

// ---------------------------------------------------------------------------
// list

const LIST_FLAGS = ["--limit", "--query"];

const listSchema: FieldDef[] = [
  field("displayName", "name"),
  field("email"),
  boolYesNo("active"),
];

interface UserNode {
  displayName: string;
  email: string;
  active: boolean;
}

async function listUsers(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "user list", LIST_FLAGS);

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 250) : 100;
  const query = getFlag(args, "--query");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter tree is dynamic
  const filter: Record<string, any> | undefined = query
    ? { displayName: { containsIgnoreCase: query } }
    : undefined;

  const data = await gqlQuery<{
    users: { nodes: UserNode[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($filter: UserFilter, $first: Int!) {
      users(filter: $filter, first: $first) {
        nodes { displayName email active }
        pageInfo { hasNextPage }
      }
    }`,
    { filter: filter ?? null, first: limit },
  );

  const users = data.users.nodes;
  const blocks: string[] = [];
  if (users.length === 0) {
    const scope = query ? ` matching query: ${query}` : "";
    blocks.push(`users: 0 found${scope}`);
  } else {
    blocks.push(formatCountLine({ count: users.length, limit, hasMore: data.users.pageInfo.hasNextPage }));
    if (query) blocks.push(`scope: query: ${query}`);
    blocks.push(renderList("users", users, listSchema));
  }

  const hints: string[] = [];
  if (data.users.pageInfo.hasNextPage) {
    hints.push(`Run \`linear-axi user list --limit ${Math.min(limit * 2, 250)}\` to see more`);
  }
  blocks.push(renderHelp([...hints, ...getSuggestions({ domain: "user", action: "list", ctx })]));
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// view

interface UserDetail {
  displayName: string;
  name: string;
  email: string;
  active: boolean;
  admin: boolean;
  createdAt: string;
  assignedIssues: { nodes: { identifier: string }[]; pageInfo: { hasNextPage: boolean } };
}

async function viewUser(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "user view", []);
  const ref = getPositional(args, 1);
  if (!ref) {
    throw new AxiError("Missing user reference", "VALIDATION_ERROR", [
      'Pass "me", an email, or a display name',
    ]);
  }
  const user = await resolveUser(ref);

  const data = await gqlQuery<{ user: UserDetail | null }>(
    `query($id: String!) {
      user(id: $id) {
        displayName name email active admin createdAt
        assignedIssues(
          filter: { state: { type: { in: ["triage", "backlog", "unstarted", "started"] } } }
          first: 50
        ) {
          nodes { identifier }
          pageInfo { hasNextPage }
        }
      }
    }`,
    { id: user.id },
  );
  if (!data.user) {
    throw new AxiError(`User ${ref} not found`, "NOT_FOUND", [
      "Run `linear-axi user list` to see users",
    ]);
  }

  const detailSchema: FieldDef[] = [
    field("displayName", "name"),
    field("email"),
    boolYesNo("active"),
    boolYesNo("admin"),
    relativeTime("createdAt", "created"),
    custom("assigned_open", (u) => {
      const n = u.assignedIssues?.nodes?.length ?? 0;
      return u.assignedIssues?.pageInfo?.hasNextPage ? `${n}+` : n;
    }),
  ];

  const blocks = [
    renderDetail("user", data.user, detailSchema),
    renderHelp(getSuggestions({ domain: "user", action: "view", id: data.user.displayName, ctx })),
  ];
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// dispatcher

export async function userCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return USER_HELP;

  switch (sub) {
    case "list":
      return listUsers(args, ctx);
    case "view":
      return viewUser(args, ctx);
    default:
      return renderError(`Unknown user subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi user --help` for usage",
      ]);
  }
}
