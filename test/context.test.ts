import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import {
  ambientProject,
  configFromLinearToml,
  issueFromBranchName,
  projectFromConfig,
  teamFromConfig,
  resolveContext,
} from "../src/context.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

/** Make the mocked git call resolve to the given branch (or a failure). */
function mockBranch(branch: string | null): void {
  mockedExecFile.mockImplementation(((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    const callback = cb as (e: Error | null, stdout: string, stderr: string) => void;
    if (branch === null) callback(new Error("not a git repo"), "", "");
    else callback(null, `${branch}\n`, "");
    return {} as never;
  }) as never);
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "linear-axi-ctx-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run `fn` with the process cwd set to a fresh temp dir, restoring it after. */
async function inTempCwd(fn: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "linear-axi-ctx-cwd-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("issueFromBranchName", () => {
  it("extracts an identifier from a username-prefixed branch", () => {
    expect(issueFromBranchName("tamas/abc-123-fix-login")).toBe("ABC-123");
  });
  it("extracts an identifier from a bare identifier-prefixed branch", () => {
    expect(issueFromBranchName("abc-123-slug")).toBe("ABC-123");
  });
  it("uppercases the team key portion", () => {
    expect(issueFromBranchName("eng-7")).toBe("ENG-7");
  });
  it("returns undefined for a branch with no identifier", () => {
    expect(issueFromBranchName("main")).toBeUndefined();
  });
  it("returns undefined for undefined input", () => {
    expect(issueFromBranchName(undefined)).toBeUndefined();
  });
});

describe("configFromLinearToml", () => {
  it("reads team_id and project_id from a .linear.toml in the given dir", () =>
    withTempDir((dir) => {
      writeFileSync(join(dir, ".linear.toml"), 'team_id = "ENG"\nproject_id = "Q3 Launch"\n', "utf8");
      expect(configFromLinearToml(dir)).toEqual({ teamId: "ENG", projectId: "Q3 Launch" });
      expect(teamFromConfig(dir)).toBe("ENG");
      expect(projectFromConfig(dir)).toBe("Q3 Launch");
    }));

  it("walks up to an ancestor .linear.toml", () =>
    withTempDir((dir) => {
      writeFileSync(join(dir, ".linear.toml"), 'team_id = "OPS"\nproject_id = "Infra"\n', "utf8");
      const child = join(dir, "nested", "deep");
      mkdirSync(child, { recursive: true });
      expect(configFromLinearToml(child)).toEqual({ teamId: "OPS", projectId: "Infra" });
    }));

  it("returns empty when no .linear.toml exists", () =>
    withTempDir((dir) => {
      expect(configFromLinearToml(dir)).toEqual({});
      expect(teamFromConfig(dir)).toBeUndefined();
      expect(projectFromConfig(dir)).toBeUndefined();
    }));

  it("returns only the keys that are present", () =>
    withTempDir((dir) => {
      writeFileSync(join(dir, ".linear.toml"), 'project_id = "Solo"\n', "utf8");
      expect(configFromLinearToml(dir)).toEqual({ projectId: "Solo" });
    }));
});

describe("ambientProject", () => {
  it("prefers an explicit flag over ambient context", () => {
    expect(
      ambientProject("Flag Project", { project: { project: "Env Project", source: "env" } }),
    ).toBe("Flag Project");
  });

  it("uses ambient context when the flag is absent", () => {
    expect(ambientProject(undefined, { project: { project: "Env Project", source: "env" } })).toBe(
      "Env Project",
    );
  });

  it("clears ambient context when the flag is none", () => {
    expect(ambientProject("none", { project: { project: "Env Project", source: "env" } })).toBeUndefined();
  });
});

describe("resolveContext precedence", () => {
  const savedTeam = process.env["LINEAR_TEAM"];
  const savedProject = process.env["LINEAR_PROJECT"];

  beforeEach(() => {
    mockedExecFile.mockReset();
    delete process.env["LINEAR_TEAM"];
    delete process.env["LINEAR_PROJECT"];
  });

  afterEach(() => {
    if (savedTeam === undefined) delete process.env["LINEAR_TEAM"];
    else process.env["LINEAR_TEAM"] = savedTeam;
    if (savedProject === undefined) delete process.env["LINEAR_PROJECT"];
    else process.env["LINEAR_PROJECT"] = savedProject;
  });

  it("prefers the --team flag (source flag)", async () => {
    mockBranch(null);
    process.env["LINEAR_TEAM"] = "ENVTEAM";
    const ctx = await resolveContext("FLAGTEAM");
    expect(ctx.team).toEqual({ team: "FLAGTEAM", source: "flag" });
  });

  it("uses LINEAR_TEAM when no flag is given (source env)", async () => {
    mockBranch(null);
    process.env["LINEAR_TEAM"] = "ENVTEAM";
    const ctx = await resolveContext();
    expect(ctx.team).toEqual({ team: "ENVTEAM", source: "env" });
  });

  it("carries the branch issue identifier when the git branch names one", async () => {
    mockBranch("tamas/abc-123-fix");
    process.env["LINEAR_TEAM"] = "ENVTEAM";
    const ctx = await resolveContext();
    expect(ctx.branchIssue).toBe("ABC-123");
  });

  it("falls back to the branch's team key when no flag/env/config exists", async () => {
    mockBranch("eng-42-widget");
    // Run in a temp dir with no .linear.toml so config resolution is a no-op.
    await inTempCwd(async () => {
      const ctx = await resolveContext();
      expect(ctx.branchIssue).toBe("ENG-42");
      expect(ctx.team).toEqual({ team: "ENG", source: "branch" });
    });
  });

  it("returns no team when nothing resolves", async () => {
    mockBranch(null);
    await inTempCwd(async () => {
      const ctx = await resolveContext();
      expect(ctx.team).toBeUndefined();
      expect(ctx.branchIssue).toBeUndefined();
    });
  });

  it("uses LINEAR_PROJECT when set (source env)", async () => {
    mockBranch(null);
    process.env["LINEAR_PROJECT"] = "Env Project";
    await inTempCwd(async () => {
      const ctx = await resolveContext();
      expect(ctx.project).toEqual({ project: "Env Project", source: "env" });
    });
  });

  it("falls back to .linear.toml project_id when env is unset", async () => {
    mockBranch(null);
    await inTempCwd(async () => {
      writeFileSync(join(process.cwd(), ".linear.toml"), 'project_id = "Toml Project"\n', "utf8");
      const ctx = await resolveContext();
      expect(ctx.project).toEqual({ project: "Toml Project", source: "config" });
    });
  });

  it("prefers LINEAR_PROJECT over .linear.toml project_id", async () => {
    mockBranch(null);
    process.env["LINEAR_PROJECT"] = "Env Project";
    await inTempCwd(async () => {
      writeFileSync(join(process.cwd(), ".linear.toml"), 'project_id = "Toml Project"\n', "utf8");
      const ctx = await resolveContext();
      expect(ctx.project).toEqual({ project: "Env Project", source: "env" });
    });
  });
});
