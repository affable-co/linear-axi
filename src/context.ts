import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace context for a command invocation.
 *
 * Linear's analog of gh-axi's repo detection: which team is this directory
 * working against, and does the current git branch name an issue?
 *
 * Team priority: --team flag > LINEAR_TEAM env > .linear.toml (team_id, the
 * schpet/linear-cli convention) > team key inferred from the branch's issue
 * identifier. The `source` field records which one won so suggestions only
 * carry a --team flag when the user actually had to pass one.
 */
export interface TeamContext {
  /** Team key as given (resolved to canonical key/UUID lazily by resolvers). */
  team: string;
  source: "flag" | "env" | "config" | "branch";
}

export interface LinearContext {
  team?: TeamContext;
  /** Issue identifier (e.g. ABC-123) parsed from the current git branch. */
  branchIssue?: string;
}

/** Extract an issue identifier like ABC-123 from a Linear-style branch name. */
export function issueFromBranchName(branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  const match = branch.match(/(?:^|\/)([A-Za-z0-9]+-\d+)(?:-|$)/);
  return match ? match[1].toUpperCase() : undefined;
}

/** Read team_id from a .linear.toml in cwd or its ancestors (schpet-compatible). */
export function teamFromConfig(startDir: string): string | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 24; depth++) {
    const candidate = join(dir, ".linear.toml");
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, "utf8");
        const match = content.match(/^\s*team_id\s*=\s*"([^"]+)"/m);
        if (match) return match[1];
      } catch {
        return undefined;
      }
      return undefined;
    }
    const parent = join(dir, "..");
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function currentGitBranch(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["branch", "--show-current"], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      const branch = stdout.trim();
      resolve(branch || undefined);
    });
  });
}

/** Resolve the invocation context. `teamFlag` comes pre-parsed from the CLI layer. */
export async function resolveContext(teamFlag?: string): Promise<LinearContext> {
  const branch = await currentGitBranch();
  const branchIssue = issueFromBranchName(branch);

  if (teamFlag) {
    return { team: { team: teamFlag, source: "flag" }, branchIssue };
  }

  const envTeam = process.env["LINEAR_TEAM"];
  if (envTeam && envTeam.trim()) {
    return { team: { team: envTeam.trim(), source: "env" }, branchIssue };
  }

  const configTeam = teamFromConfig(process.cwd());
  if (configTeam) {
    return { team: { team: configTeam, source: "config" }, branchIssue };
  }

  if (branchIssue) {
    const key = branchIssue.split("-")[0];
    return { team: { team: key, source: "branch" }, branchIssue };
  }

  return { branchIssue };
}
