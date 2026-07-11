import { describe, it, expect } from "vitest";
import {
  extract,
  field,
  pluck,
  joinArray,
  relativeTime,
  boolYesNo,
  mapEnum,
  lower,
  custom,
  priorityName,
  PRIORITY_NAMES,
  renderList,
  renderDetail,
  renderHelp,
  renderError,
  renderOutput,
} from "../src/toon.js";

describe("field extractors", () => {
  it("field() passes through values", () => {
    expect(extract({ number: 42 }, [field("number")])).toEqual({ number: 42 });
  });

  it("field() with alias", () => {
    expect(extract({ identifier: "ABC-1" }, [field("identifier", "id")])).toEqual({ id: "ABC-1" });
  });

  it("field() returns null for missing", () => {
    expect(extract({}, [field("title")])).toEqual({ title: null });
  });

  it("pluck() extracts nested value", () => {
    expect(extract({ state: { name: "Todo" } }, [pluck("state", "name")])).toEqual({ state: "Todo" });
  });

  it("pluck() returns null for missing", () => {
    expect(extract({}, [pluck("state", "name")])).toEqual({ state: null });
  });

  it("pluck() with alias", () => {
    expect(extract({ team: { key: "ENG" } }, [pluck("team", "key", "team")])).toEqual({ team: "ENG" });
  });

  it("boolYesNo() converts booleans", () => {
    expect(extract({ done: true }, [boolYesNo("done", "done")])).toEqual({ done: "yes" });
    expect(extract({ done: false }, [boolYesNo("done", "done")])).toEqual({ done: "no" });
  });

  it("lower() lowercases strings", () => {
    expect(extract({ state: "STARTED" }, [lower("state")])).toEqual({ state: "started" });
  });

  it("lower() passes non-strings through", () => {
    expect(extract({ state: 5 }, [lower("state")])).toEqual({ state: 5 });
  });

  it("custom() runs an arbitrary function", () => {
    expect(extract({ a: 2, b: 3 }, [custom("sum", (i) => i.a + i.b)])).toEqual({ sum: 5 });
  });
});

describe("joinArray with Linear connection shapes", () => {
  it("joins a plain array of sub-values", () => {
    const result = extract({ labels: [{ name: "bug" }, { name: "ui" }] }, [joinArray("labels", "name")]);
    expect(result).toEqual({ labels: "bug,ui" });
  });

  it("joins a Linear connection shape ({ nodes: [...] })", () => {
    const result = extract(
      { labels: { nodes: [{ name: "bug" }, { name: "backend" }] } },
      [joinArray("labels", "name", "labels")],
    );
    expect(result).toEqual({ labels: "bug,backend" });
  });

  it("joins arrays of plain strings", () => {
    const result = extract({ tags: ["a", "b"] }, [joinArray("tags", "name", "tags")]);
    expect(result).toEqual({ tags: "a,b" });
  });

  it("returns 'none' for an empty plain array", () => {
    expect(extract({ labels: [] }, [joinArray("labels", "name")])).toEqual({ labels: "none" });
  });

  it("returns 'none' for an empty connection", () => {
    expect(extract({ labels: { nodes: [] } }, [joinArray("labels", "name")])).toEqual({ labels: "none" });
  });

  it("honors a custom empty placeholder", () => {
    expect(extract({ labels: { nodes: [] } }, [joinArray("labels", "name", "labels", "unlabeled")])).toEqual({
      labels: "unlabeled",
    });
  });

  it("returns 'none' when the field is missing entirely", () => {
    expect(extract({}, [joinArray("labels", "name")])).toEqual({ labels: "none" });
  });
});

describe("mapEnum with numeric keys", () => {
  const map = { "0": "none", "1": "urgent", "2": "high" };

  it("maps a numeric value via its string key", () => {
    expect(extract({ priority: 1 }, [mapEnum("priority", map, "none", "priority")])).toEqual({
      priority: "urgent",
    });
  });

  it("maps a string key value", () => {
    const strMap = { APPROVED: "approved" };
    expect(extract({ decision: "APPROVED" }, [mapEnum("decision", strMap, "none", "decision")])).toEqual({
      decision: "approved",
    });
  });

  it("falls back for values outside the map", () => {
    expect(extract({ priority: 9 }, [mapEnum("priority", map, "none", "priority")])).toEqual({
      priority: "none",
    });
  });

  it("falls back for an empty string value", () => {
    expect(extract({ decision: "" }, [mapEnum("decision", { A: "a" }, "none", "decision")])).toEqual({
      decision: "none",
    });
  });
});

describe("priorityName", () => {
  it("maps known numeric priorities to names", () => {
    expect(extract({ priority: 0 }, [priorityName()])).toEqual({ priority: "none" });
    expect(extract({ priority: 1 }, [priorityName()])).toEqual({ priority: "urgent" });
    expect(extract({ priority: 2 }, [priorityName()])).toEqual({ priority: "high" });
    expect(extract({ priority: 3 }, [priorityName()])).toEqual({ priority: "medium" });
    expect(extract({ priority: 4 }, [priorityName()])).toEqual({ priority: "low" });
  });

  it("falls back to 'none' for an unknown or missing priority", () => {
    expect(extract({ priority: 99 }, [priorityName()])).toEqual({ priority: "none" });
    expect(extract({}, [priorityName()])).toEqual({ priority: "none" });
  });

  it("supports custom source and output keys", () => {
    expect(extract({ prio: 1 }, [priorityName("prio", "p")])).toEqual({ p: "urgent" });
  });

  it("exposes the PRIORITY_NAMES map", () => {
    expect(PRIORITY_NAMES).toEqual({ 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" });
  });
});

describe("relativeTime buckets", () => {
  function iso(msAgo: number): string {
    return new Date(Date.now() - msAgo).toISOString();
  }
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HR = 60 * MIN;
  const DAY = 24 * HR;

  it("returns 'just now' for under a minute", () => {
    expect(extract({ t: iso(5 * SEC) }, [relativeTime("t", "t")])).toEqual({ t: "just now" });
  });

  it("returns minutes ago", () => {
    expect(extract({ t: iso(5 * MIN) }, [relativeTime("t", "t")])).toEqual({ t: "5m ago" });
  });

  it("returns hours ago", () => {
    expect(extract({ t: iso(3 * HR) }, [relativeTime("t", "t")])).toEqual({ t: "3h ago" });
  });

  it("returns days ago", () => {
    expect(extract({ t: iso(4 * DAY) }, [relativeTime("t", "t")])).toEqual({ t: "4d ago" });
  });

  it("returns months ago", () => {
    expect(extract({ t: iso(60 * DAY) }, [relativeTime("t", "t")])).toEqual({ t: "2mo ago" });
  });

  it("returns years ago", () => {
    expect(extract({ t: iso(800 * DAY) }, [relativeTime("t", "t")])).toEqual({ t: "2y ago" });
  });

  it("returns 'unknown' for null", () => {
    expect(extract({ t: null }, [relativeTime("t", "t")])).toEqual({ t: "unknown" });
  });

  it("returns 'unknown' for an unparseable date", () => {
    expect(extract({ t: "not-a-date" }, [relativeTime("t", "t")])).toEqual({ t: "unknown" });
  });
});

describe("renderList", () => {
  it("renders a TOON list with a header and rows", () => {
    const items = [
      { identifier: "ABC-1", title: "Bug", state: { name: "Todo" }, assignee: { displayName: "alice" } },
      { identifier: "ABC-2", title: "Feat", state: { name: "Done" }, assignee: { displayName: "bob" } },
    ];
    const schema = [
      field("identifier", "id"),
      field("title"),
      pluck("state", "name", "state"),
      custom("assignee", (i) => i.assignee?.displayName ?? "unassigned"),
    ];
    const output = renderList("issues", items, schema);
    expect(output).toContain("issues[2]{id,title,state,assignee}:");
    expect(output).toContain("ABC-1,Bug,Todo,alice");
    expect(output).toContain("ABC-2,Feat,Done,bob");
  });
});

describe("renderDetail", () => {
  it("renders a TOON detail block", () => {
    const item = { identifier: "ABC-1", title: "Test", state: { name: "Todo" } };
    const schema = [field("identifier", "id"), field("title"), pluck("state", "name", "state")];
    const output = renderDetail("issue", item, schema);
    expect(output).toContain("issue:");
    expect(output).toContain("id: ABC-1");
    expect(output).toContain("title: Test");
    expect(output).toContain("state: Todo");
  });
});

describe("renderHelp", () => {
  it("renders help lines with a count header", () => {
    expect(renderHelp(["Do this", "Do that"])).toBe("help[2]:\n  Do this\n  Do that");
  });

  it("returns empty for no lines", () => {
    expect(renderHelp([])).toBe("");
  });
});

describe("renderError", () => {
  it("renders an error with code and suggestions", () => {
    const output = renderError("Not found", "NOT_FOUND", ["Try listing"]);
    expect(output).toContain("error: Not found");
    expect(output).toContain("code: NOT_FOUND");
    expect(output).toContain("help[1]:");
    expect(output).toContain("Try listing");
  });

  it("omits the help block when there are no suggestions", () => {
    const output = renderError("Bad", "VALIDATION_ERROR");
    expect(output).toContain("error: Bad");
    expect(output).not.toContain("help[");
  });
});

describe("renderOutput", () => {
  it("combines blocks and filters empty", () => {
    expect(renderOutput(["block1", "", "block2"])).toBe("block1\nblock2");
  });
});
