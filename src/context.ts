import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace context for a command invocation.
 *
 * Linear's analog of gh-axi's repo detection: which team/project is this
 * directory working against, and does the current git branch name an issue?
 *
 * Team priority: --team flag > LINEAR_TEAM env > .linear.toml (team_id, the
 * schpet/linear-cli convention) > team key inferred from the branch's issue
 * identifier. The `source` field records which one won so suggestions only
 * carry a --team flag when the user actually had to pass one.
 *
 * Project priority: --project flag (per-command) > LINEAR_PROJECT env >
 * .linear.toml project_id. Ambient project scopes list/create; update only
 * changes project when --project is passed explicitly.
 */
export interface TeamContext {
  /** Team key as given (resolved to canonical key/UUID lazily by resolvers). */
  team: string;
  source: "flag" | "env" | "config" | "branch";
}

export interface ProjectContext {
  /** Project name or UUID as given (resolved lazily by resolvers). */
  project: string;
  source: "env" | "config";
}

export interface LinearContext {
  team?: TeamContext;
  project?: ProjectContext;
  /** Issue identifier (e.g. ABC-123) parsed from the current git branch. */
  branchIssue?: string;
}

/** Values read from a schpet-compatible `.linear.toml` (plus our project_id). */
export interface LinearTomlConfig {
  teamId?: string;
  projectId?: string;
}

/** Extract an issue identifier like ABC-123 from a Linear-style branch name. */
export function issueFromBranchName(branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  const match = branch.match(/(?:^|\/)([A-Za-z0-9]+-\d+)(?:-|$)/);
  return match ? match[1].toUpperCase() : undefined;
}

/** Read team_id / project_id from a .linear.toml in cwd or its ancestors. */
export function configFromLinearToml(startDir: string): LinearTomlConfig {
  let dir = startDir;
  for (let depth = 0; depth < 24; depth++) {
    const candidate = join(dir, ".linear.toml");
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, "utf8");
        const teamMatch = content.match(/^\s*team_id\s*=\s*"([^"]+)"/m);
        const projectMatch = content.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
        return {
          ...(teamMatch ? { teamId: teamMatch[1] } : {}),
          ...(projectMatch ? { projectId: projectMatch[1] } : {}),
        };
      } catch {
        return {};
      }
    }
    const parent = join(dir, "..");
    if (parent === dir) return {};
    dir = parent;
  }
  return {};
}

/** Read team_id from a .linear.toml in cwd or its ancestors (schpet-compatible). */
export function teamFromConfig(startDir: string): string | undefined {
  return configFromLinearToml(startDir).teamId;
}

/** Read project_id from a .linear.toml in cwd or its ancestors. */
export function projectFromConfig(startDir: string): string | undefined {
  return configFromLinearToml(startDir).projectId;
}

/**
 * Effective project for list/create.
 *
 * - `--project <name>` — that project (overrides ambient)
 * - `--project none` — no project (list: null filter; create: omit projectId)
 * - `--project any` — ignore ambient; list with no project filter
 * - omitted — LINEAR_PROJECT / .linear.toml project_id when set
 */
export type ProjectScope =
  | { type: "named"; name: string }
  | { type: "none" }
  | { type: "any" };

export function resolveProjectScope(
  flagValue: string | undefined,
  ctx?: LinearContext,
): ProjectScope | undefined {
  if (flagValue === "any") return { type: "any" };
  if (flagValue === "none") return { type: "none" };
  if (flagValue) return { type: "named", name: flagValue };
  if (ctx?.project?.project) return { type: "named", name: ctx.project.project };
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
  const toml = configFromLinearToml(process.cwd());

  const ctx: LinearContext = { branchIssue };

  if (teamFlag) {
    ctx.team = { team: teamFlag, source: "flag" };
  } else {
    const envTeam = process.env["LINEAR_TEAM"];
    if (envTeam && envTeam.trim()) {
      ctx.team = { team: envTeam.trim(), source: "env" };
    } else if (toml.teamId) {
      ctx.team = { team: toml.teamId, source: "config" };
    } else if (branchIssue) {
      const key = branchIssue.split("-")[0];
      ctx.team = { team: key, source: "branch" };
    }
  }

  const envProject = process.env["LINEAR_PROJECT"];
  if (envProject && envProject.trim()) {
    ctx.project = { project: envProject.trim(), source: "env" };
  } else if (toml.projectId) {
    ctx.project = { project: toml.projectId, source: "config" };
  }

  return ctx;
}
