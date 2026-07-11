import { encode } from "@toon-format/toon";
import type { LinearContext } from "../context.js";
import { AxiError } from "../errors.js";
import { gqlQuery } from "../linear.js";
import { field, pluck, custom, renderList, renderHelp, renderOutput, type FieldDef } from "../toon.js";
import { getSuggestions } from "../suggestions.js";

export const HOME_HELP = "";

const issueSchema: FieldDef[] = [
  field("identifier", "id"),
  field("title"),
  pluck("state", "name", "state"),
  custom("team", (i) => i.team?.key ?? "unknown"),
];

interface HomeData {
  viewer: {
    displayName: string;
    organization: { name: string };
    assignedIssues: {
      nodes: Record<string, unknown>[];
      pageInfo: { hasNextPage: boolean };
    };
  };
}

const HOME_QUERY = `query {
  viewer {
    displayName
    organization { name }
    assignedIssues(
      filter: { state: { type: { in: ["triage", "unstarted", "started"] } } }
      first: 5
      orderBy: updatedAt
    ) {
      nodes { identifier title state { name } team { key } }
      pageInfo { hasNextPage }
    }
  }
}`;

export async function homeCommand(_args: string[], ctx?: LinearContext): Promise<string> {
  let data: HomeData;
  try {
    data = await gqlQuery<HomeData>(HOME_QUERY);
  } catch (error) {
    // The dashboard is ambient context: render failures as structured output
    // instead of failing the whole session hook.
    if (error instanceof AxiError) {
      return renderOutput([
        encode({ error: error.message, code: error.code }),
        renderHelp(error.suggestions),
      ]);
    }
    throw error;
  }

  const blocks: string[] = [];
  const { viewer } = data;
  blocks.push(encode({ workspace: viewer.organization.name, me: viewer.displayName }));

  if (ctx?.team) {
    blocks.push(encode({ team: ctx.team.team }));
  }
  if (ctx?.branchIssue) {
    blocks.push(encode({ branch_issue: ctx.branchIssue }));
  }

  const issues = viewer.assignedIssues.nodes;
  blocks.push(issues.length ? renderList("my_issues", issues, issueSchema) : "my_issues: 0 active");

  const hints: string[] = [];
  if (viewer.assignedIssues.pageInfo.hasNextPage) {
    hints.push("Run `linear-axi issue list --assignee me` for your full issue list");
  }
  const suggestions = getSuggestions({ domain: "home", action: "home", ctx });
  blocks.push(renderHelp([...hints, ...suggestions]));

  return renderOutput(blocks);
}
