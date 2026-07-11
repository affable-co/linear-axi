import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readCredentialsFile, resolveApiKey, clearApiKeyCache } from "../src/auth.js";
import { AxiError } from "../src/errors.js";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "linear-axi-auth-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("readCredentialsFile", () => {
  it("reads api_key from the default workspace's section", () =>
    withTempDir((dir) => {
      const file = join(dir, "credentials.toml");
      writeFileSync(
        file,
        ['default_workspace = "acme"', "", "[workspaces.acme]", 'api_key = "lin_api_default"', "", "[workspaces.other]", 'api_key = "lin_api_other"'].join("\n"),
        "utf8",
      );
      expect(readCredentialsFile(file)).toBe("lin_api_default");
    }));

  it("reads api_key from the only workspace when no default is declared", () =>
    withTempDir((dir) => {
      const file = join(dir, "credentials.toml");
      writeFileSync(file, ["[workspaces.solo]", 'api_key = "lin_api_solo"'].join("\n"), "utf8");
      expect(readCredentialsFile(file)).toBe("lin_api_solo");
    }));

  it("returns undefined for a missing file", () => {
    expect(readCredentialsFile(join(tmpdir(), "does-not-exist-linear.toml"))).toBeUndefined();
  });

  it("returns undefined for a malformed file with no api_key", () =>
    withTempDir((dir) => {
      const file = join(dir, "credentials.toml");
      writeFileSync(file, "this is not = valid [ toml\n@@@@\n", "utf8");
      expect(readCredentialsFile(file)).toBeUndefined();
    }));

  it("returns undefined (not crash) for schpet v2 style with `default` and no api_key", () =>
    withTempDir((dir) => {
      const file = join(dir, "credentials.toml");
      writeFileSync(
        file,
        ['default = "ws"', "", "[workspaces.ws]", 'name = "Workspace"', 'url_key = "ws"'].join("\n"),
        "utf8",
      );
      expect(readCredentialsFile(file)).toBeUndefined();
    }));

  it("does not treat multiple workspaces without a default as resolvable", () =>
    withTempDir((dir) => {
      const file = join(dir, "credentials.toml");
      writeFileSync(
        file,
        ["[workspaces.a]", 'api_key = "lin_api_a"', "", "[workspaces.b]", 'api_key = "lin_api_b"'].join("\n"),
        "utf8",
      );
      // Ambiguous: no default and more than one workspace → no key.
      expect(readCredentialsFile(file)).toBeUndefined();
    }));
});

describe("resolveApiKey", () => {
  const savedKey = process.env["LINEAR_API_KEY"];
  const savedXdg = process.env["XDG_CONFIG_HOME"];

  beforeEach(() => {
    clearApiKeyCache();
    delete process.env["LINEAR_API_KEY"];
    delete process.env["XDG_CONFIG_HOME"];
  });

  afterEach(() => {
    clearApiKeyCache();
    if (savedKey === undefined) delete process.env["LINEAR_API_KEY"];
    else process.env["LINEAR_API_KEY"] = savedKey;
    if (savedXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
    else process.env["XDG_CONFIG_HOME"] = savedXdg;
  });

  it("prefers the LINEAR_API_KEY env var, trimmed", () => {
    process.env["LINEAR_API_KEY"] = "  lin_api_env  ";
    expect(resolveApiKey()).toBe("lin_api_env");
  });

  it("throws AUTH_REQUIRED when no key is available anywhere", () =>
    withTempDir((emptyDir) => {
      // Point XDG at an empty dir so no real ~/.config credentials leak in.
      process.env["XDG_CONFIG_HOME"] = emptyDir;
      try {
        resolveApiKey();
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AxiError);
        expect((e as AxiError).code).toBe("AUTH_REQUIRED");
      }
    }));

  it("reads a key from XDG_CONFIG_HOME/linear/credentials.toml when env is absent", () =>
    withTempDir((dir) => {
      const linearDir = join(dir, "linear");
      mkdirSync(linearDir, { recursive: true });
      writeFileSync(
        join(linearDir, "credentials.toml"),
        ["[workspaces.solo]", 'api_key = "lin_api_fromfile"'].join("\n"),
        "utf8",
      );
      process.env["XDG_CONFIG_HOME"] = dir;
      expect(resolveApiKey()).toBe("lin_api_fromfile");
    }));
});
