import { describe, expect, it } from "vitest";
import { parseTeamFlag } from "../src/cli.js";

describe("parseTeamFlag", () => {
  it("extracts and removes a valid team flag", () => {
    expect(parseTeamFlag(["list", "--team", "ENG", "--limit", "5"])).toEqual({
      teamFlag: "ENG",
      strippedArgs: ["list", "--limit", "5"],
    });
  });

  it("rejects another flag as the team value", () => {
    expect(() => parseTeamFlag(["list", "--team", "--limit", "5"])).toThrow(
      "--team requires a value",
    );
  });

  it("rejects an empty equals-form team value", () => {
    expect(() => parseTeamFlag(["list", "--team="])).toThrow("--team requires a value");
  });
});
