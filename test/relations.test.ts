import { describe, it, expect } from "vitest";
import {
  formatRelationList,
  parseRelationChanges,
  relationsFromIssue,
  type RelationFlag,
} from "../src/relations.js";

describe("parseRelationChanges", () => {
  function vals(partial: Partial<Record<RelationFlag, string[]>>): Record<RelationFlag, string[]> {
    return {
      "--blocked-by": [],
      "--blocks": [],
      "--relates-to": [],
      "--duplicate-of": [],
      ...partial,
    };
  }

  it("parses bare ids as adds on create", () => {
    const changes = parseRelationChanges(vals({ "--blocked-by": ["ENG-1", "ENG-2"] }), {
      allowRemove: false,
    });
    expect(changes).toEqual([
      { flag: "--blocked-by", action: "add", ref: "ENG-1" },
      { flag: "--blocked-by", action: "add", ref: "ENG-2" },
    ]);
  });

  it("rejects +/- on create", () => {
    expect(() =>
      parseRelationChanges(vals({ "--blocks": ["+ENG-1"] }), { allowRemove: false }),
    ).toThrow(/accepts issue ids only/);
  });

  it("parses +add / -remove / bare-add on update", () => {
    const changes = parseRelationChanges(
      vals({
        "--blocks": ["+ENG-2", "-ENG-3", "ENG-4"],
        "--relates-to": ["-ENG-9"],
      }),
      { allowRemove: true },
    );
    expect(changes).toEqual([
      { flag: "--blocks", action: "add", ref: "ENG-2" },
      { flag: "--blocks", action: "remove", ref: "ENG-3" },
      { flag: "--blocks", action: "add", ref: "ENG-4" },
      { flag: "--relates-to", action: "remove", ref: "ENG-9" },
    ]);
  });
});

describe("relationsFromIssue", () => {
  it("maps blocks / blocked_by / relates_to / duplicate_of from both sides", () => {
    const snap = relationsFromIssue({
      relations: {
        nodes: [
          { id: "r1", type: "blocks", relatedIssue: { identifier: "ENG-2" } },
          { id: "r2", type: "related", relatedIssue: { identifier: "ENG-3" } },
          { id: "r3", type: "duplicate", relatedIssue: { identifier: "ENG-4" } },
        ],
      },
      inverseRelations: {
        nodes: [
          { id: "r4", type: "blocks", issue: { identifier: "ENG-5" } },
          { id: "r5", type: "related", issue: { identifier: "ENG-6" } },
        ],
      },
    });
    expect(snap.blocks).toEqual(["ENG-2"]);
    expect(snap.blocked_by).toEqual(["ENG-5"]);
    expect(snap.relates_to).toEqual(["ENG-3", "ENG-6"]);
    expect(snap.duplicate_of).toEqual(["ENG-4"]);
  });
});

describe("formatRelationList", () => {
  it("joins ids or returns none", () => {
    expect(formatRelationList([])).toBe("none");
    expect(formatRelationList(["A-1", "A-2"])).toBe("A-1,A-2");
  });
});
