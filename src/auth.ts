import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { authRequiredError } from "./errors.js";

/**
 * Resolve the Linear API key.
 *
 * Priority:
 *   1. LINEAR_API_KEY environment variable
 *   2. ~/.config/linear/credentials.toml (schpet/linear-cli format), using the
 *      `default_workspace` entry or the only workspace present
 *
 * Never prompts. Throws AUTH_REQUIRED with setup instructions when absent.
 */

let cachedKey: string | undefined;

export function resolveApiKey(): string {
  if (cachedKey) return cachedKey;

  const envKey = process.env["LINEAR_API_KEY"];
  if (envKey && envKey.trim()) {
    cachedKey = envKey.trim();
    return cachedKey;
  }

  const fromFile = readCredentialsFile(join(credentialsDir(), "credentials.toml"));
  if (fromFile) {
    cachedKey = fromFile;
    return cachedKey;
  }

  throw authRequiredError();
}

/** Test seam: clear the module-level key cache. */
export function clearApiKeyCache(): void {
  cachedKey = undefined;
}

function credentialsDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  return xdg && xdg.trim() ? join(xdg, "linear") : join(homedir(), ".config", "linear");
}

/**
 * Minimal TOML subset reader for schpet/linear-cli credentials:
 *
 *   default_workspace = "acme"
 *   [workspaces.acme]
 *   api_key = "lin_api_..."
 *
 * Reads `api_key` from the default workspace's section, or from the only
 * section when no default is declared. Returns undefined on any parse gap —
 * auth errors must stay actionable, not throw on odd files.
 */
export function readCredentialsFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  const sections = new Map<string, Map<string, string>>();
  let current = "";
  sections.set(current, new Map());

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = header[1].trim();
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"\s*(#.*)?$/);
    if (kv) {
      sections.get(current)?.set(kv[1], kv[2]);
    }
  }

  const top = sections.get("");
  const defaultWorkspace = top?.get("default_workspace") ?? top?.get("default");

  const workspaceSections = [...sections.keys()].filter((s) => s.startsWith("workspaces."));

  let sectionName: string | undefined;
  if (defaultWorkspace) {
    sectionName = `workspaces.${defaultWorkspace}`;
  } else if (workspaceSections.length === 1) {
    sectionName = workspaceSections[0];
  }

  const key = sectionName ? sections.get(sectionName)?.get("api_key") : top?.get("api_key");
  return key && key.trim() ? key.trim() : undefined;
}
