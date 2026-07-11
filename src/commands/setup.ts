import { encode } from "@toon-format/toon";
import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import type { LinearContext } from "../context.js";
import { renderHelp, renderOutput } from "../toon.js";

export const SETUP_HELP = `usage: linear-axi setup <subcommand>
subcommands[2]:
  hooks (install agent SessionStart hooks for ambient context), skill (print Agent Skill install instructions)
examples:
  linear-axi setup hooks
  linear-axi setup skill
`;

export async function setupCommand(args: string[], _ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return SETUP_HELP;

  switch (sub) {
    case "hooks":
      return setupHooks();
    case "skill":
      return setupSkill();
    default:
      throw new AxiError(`Unknown setup subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi setup hooks` or `linear-axi setup skill`",
      ]);
  }
}

function setupHooks(): string {
  installSessionStartHooks({
    marker: "linear-axi-session-context",
    binaryNames: ["linear-axi"],
    distEntrypoints: ["dist/bin/linear-axi.js"],
  });

  return renderOutput([
    "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
    renderHelp(["Restart your agent session to receive linear-axi ambient context"]),
  ]);
}

function setupSkill(): string {
  return renderOutput([
    encode({
      skill: {
        name: "linear-axi",
        source: "skills/linear-axi/SKILL.md (bundled in this package)",
        published: false,
      },
    }),
    renderHelp([
      "This repo is not published yet — point your agent at the bundled skills/linear-axi/SKILL.md",
    ]),
  ]);
}
