import { encode } from "@toon-format/toon";
import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import type { LinearContext } from "../context.js";
import { rejectUnknownFlags } from "../args.js";
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
      rejectUnknownFlags(args.slice(1), "setup hooks", []);
      return setupHooks();
    case "skill":
      rejectUnknownFlags(args.slice(1), "setup skill", []);
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
        source: "https://github.com/affable-co/linear-axi/tree/main/skills/linear-axi",
        install: "npx skills add affable-co/linear-axi --skill linear-axi",
        codex: "$skill-installer install https://github.com/affable-co/linear-axi/tree/main/skills/linear-axi",
      },
    }),
    renderHelp([
      "Run the install command, then restart your agent so it discovers the skill",
    ]),
  ]);
}
