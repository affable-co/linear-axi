import { describe, it, expect } from "vitest";
import { TOP_HELP } from "../src/cli.js";
import { ISSUE_HELP } from "../src/commands/issue.js";
import { PROJECT_HELP } from "../src/commands/project.js";
import { CYCLE_HELP } from "../src/commands/cycle.js";
import { TEAM_HELP } from "../src/commands/team.js";
import { STATE_HELP } from "../src/commands/state.js";
import { LABEL_HELP } from "../src/commands/label.js";
import { USER_HELP } from "../src/commands/user.js";
import { DOC_HELP } from "../src/commands/doc.js";
import { SEARCH_HELP } from "../src/commands/search.js";
import { API_HELP } from "../src/commands/api.js";
import { SETUP_HELP } from "../src/commands/setup.js";
import { AUTH_HELP } from "../src/commands/auth.js";

/**
 * Every HELP constant must contain an `examples:` section with at least two
 * concrete usage examples, each a `  linear-axi ...` line.
 */
function assertHelpHasExamples(name: string, help: string) {
  describe(name, () => {
    it("contains an examples: section", () => {
      expect(help).toContain("examples:");
    });

    it("has at least 2 examples starting with linear-axi (2-space indented)", () => {
      const section = help.slice(help.indexOf("examples:"));
      const exampleLines = section.split("\n").filter((line) => /^ {2}linear-axi /.test(line));
      expect(exampleLines.length).toBeGreaterThanOrEqual(2);
    });
  });
}

describe("Help output includes examples for every command family", () => {
  assertHelpHasExamples("TOP_HELP", TOP_HELP);
  assertHelpHasExamples("ISSUE_HELP", ISSUE_HELP);
  assertHelpHasExamples("PROJECT_HELP", PROJECT_HELP);
  assertHelpHasExamples("CYCLE_HELP", CYCLE_HELP);
  assertHelpHasExamples("TEAM_HELP", TEAM_HELP);
  assertHelpHasExamples("STATE_HELP", STATE_HELP);
  assertHelpHasExamples("LABEL_HELP", LABEL_HELP);
  assertHelpHasExamples("USER_HELP", USER_HELP);
  assertHelpHasExamples("DOC_HELP", DOC_HELP);
  assertHelpHasExamples("SEARCH_HELP", SEARCH_HELP);
  assertHelpHasExamples("API_HELP", API_HELP);
  assertHelpHasExamples("SETUP_HELP", SETUP_HELP);
  assertHelpHasExamples("AUTH_HELP", AUTH_HELP);
});
