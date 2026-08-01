import type { LinearContext } from "../context.js";
import { rejectUnknownFlags } from "../args.js";
import { resolveApiCredential } from "../auth.js";
import { AxiError } from "../errors.js";
import { gqlQuery } from "../linear.js";
import { custom, field, renderDetail } from "../toon.js";

export const AUTH_HELP = `usage: linear-axi auth <subcommand>
subcommands[1]:
  status (verify the configured credential and show the authenticated Linear account)
examples:
  linear-axi auth status
  linear-axi auth --help
`;

interface ViewerData {
  viewer: {
    displayName: string;
    organization: { name: string };
  };
}

async function authStatus(args: string[]): Promise<string> {
  rejectUnknownFlags(args.slice(1), "auth status", []);
  const credential = resolveApiCredential();
  const data = await gqlQuery<ViewerData>(
    `query { viewer { displayName organization { name } } }`,
  );

  return renderDetail(
    "auth",
    { status: "authenticated", source: credential.source, viewer: data.viewer },
    [
      field("status"),
      field("source", "credential_source"),
      custom("user", (auth) => auth.viewer.displayName),
      custom("workspace", (auth) => auth.viewer.organization.name),
    ],
  );
}

export async function authCommand(args: string[], _ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return AUTH_HELP;

  switch (sub) {
    case "status":
      return authStatus(args);
    default:
      throw new AxiError(`Unknown auth subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi auth status` to verify authentication",
      ]);
  }
}
