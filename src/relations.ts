/**
 * Issue-to-issue relations via Linear's issueRelationCreate / issueRelationDelete.
 *
 * Linear stores one directed edge; the other side appears under inverseRelations.
 * `blocks` is directional; `related` is treated as undirected for add/remove checks.
 */
import type { LinearContext } from "./context.js";
import { AxiError } from "./errors.js";
import { gqlQuery } from "./linear.js";
import { normalizeIssueRef } from "./resolve.js";

export const RELATION_FLAGS = [
  "--blocked-by",
  "--blocks",
  "--relates-to",
  "--duplicate-of",
] as const;

export type RelationFlag = (typeof RELATION_FLAGS)[number];

export interface RelationChange {
  flag: RelationFlag;
  action: "add" | "remove";
  /** Raw issue ref from the flag value (identifier or UUID). */
  ref: string;
}

export interface RelationSnapshot {
  blocked_by: string[];
  blocks: string[];
  relates_to: string[];
  duplicate_of: string[];
}

interface RelationNode {
  id: string;
  type: string;
  relatedIssue?: { identifier: string };
  issue?: { identifier: string };
}

interface LoadedRelations {
  snapshot: RelationSnapshot;
  /** Lookup key → relation UUID for deletes. */
  byKey: Map<string, string>;
}

type EdgeKind = "blocks" | "blocked_by" | "relates_to" | "duplicate_of";

function edgeKey(kind: EdgeKind, identifier: string): string {
  return `${kind}:${identifier.toUpperCase()}`;
}

function sortIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function snapshotFromNodes(
  relations: RelationNode[],
  inverseRelations: RelationNode[],
): LoadedRelations {
  const blocked_by: string[] = [];
  const blocks: string[] = [];
  const relates_to: string[] = [];
  const duplicate_of: string[] = [];
  const byKey = new Map<string, string>();

  for (const r of relations) {
    const other = r.relatedIssue?.identifier;
    if (!other) continue;
    if (r.type === "blocks") {
      blocks.push(other);
      byKey.set(edgeKey("blocks", other), r.id);
    } else if (r.type === "related") {
      relates_to.push(other);
      byKey.set(edgeKey("relates_to", other), r.id);
    } else if (r.type === "duplicate") {
      duplicate_of.push(other);
      byKey.set(edgeKey("duplicate_of", other), r.id);
    }
  }

  for (const r of inverseRelations) {
    const other = r.issue?.identifier;
    if (!other) continue;
    if (r.type === "blocks") {
      blocked_by.push(other);
      byKey.set(edgeKey("blocked_by", other), r.id);
    } else if (r.type === "related") {
      relates_to.push(other);
      // Prefer an existing forward edge key; inverse still deletes this UUID.
      if (!byKey.has(edgeKey("relates_to", other))) {
        byKey.set(edgeKey("relates_to", other), r.id);
      }
    }
  }

  return {
    snapshot: {
      blocked_by: sortIds(blocked_by),
      blocks: sortIds(blocks),
      relates_to: sortIds(relates_to),
      duplicate_of: sortIds(duplicate_of),
    },
    byKey,
  };
}

/** GraphQL selection snippets for issue view / relation loads. */
export const RELATION_SELECTION = `relations(first: 50) { nodes { id type relatedIssue { identifier } } }
      inverseRelations(first: 50) { nodes { id type issue { identifier } } }`;

export function relationsFromIssue(issue: {
  relations?: { nodes?: RelationNode[] };
  inverseRelations?: { nodes?: RelationNode[] };
}): RelationSnapshot {
  return snapshotFromNodes(issue.relations?.nodes ?? [], issue.inverseRelations?.nodes ?? []).snapshot;
}

export function formatRelationList(ids: string[]): string {
  return ids.length ? ids.join(",") : "none";
}

/**
 * Parse repeatable relation flags. On create, bare ids add; on update, `+id`/`id`
 * add and `-id` removes (same grammar as `--label`).
 */
export function parseRelationChanges(
  valuesByFlag: Record<RelationFlag, string[]>,
  opts: { allowRemove: boolean },
): RelationChange[] {
  const changes: RelationChange[] = [];
  for (const flag of RELATION_FLAGS) {
    for (const raw of valuesByFlag[flag] ?? []) {
      if (!opts.allowRemove && (raw.startsWith("+") || raw.startsWith("-"))) {
        throw new AxiError(
          `${flag} on create accepts issue ids only (no +/-). Got: ${raw}`,
          "VALIDATION_ERROR",
        );
      }
      if (raw.startsWith("-")) {
        const ref = raw.slice(1);
        if (!ref) {
          throw new AxiError(`${flag} - requires an issue id`, "VALIDATION_ERROR");
        }
        changes.push({ flag, action: "remove", ref });
      } else {
        const ref = raw.replace(/^\+/, "");
        if (!ref) {
          throw new AxiError(`${flag} requires an issue id`, "VALIDATION_ERROR");
        }
        changes.push({ flag, action: "add", ref });
      }
    }
  }
  return changes;
}

export function relationFlagsPresent(valuesByFlag: Record<RelationFlag, string[]>): boolean {
  return RELATION_FLAGS.some((f) => (valuesByFlag[f] ?? []).length > 0);
}

async function loadRelations(issueRef: string): Promise<LoadedRelations> {
  const data = await gqlQuery<{
    issue: {
      relations: { nodes: RelationNode[] };
      inverseRelations: { nodes: RelationNode[] };
    } | null;
  }>(
    `query($id: String!) { issue(id: $id) {
      ${RELATION_SELECTION}
    } }`,
    { id: issueRef },
  );
  if (!data.issue) {
    throw new AxiError(`Issue ${issueRef} not found`, "NOT_FOUND");
  }
  return snapshotFromNodes(data.issue.relations.nodes, data.issue.inverseRelations.nodes);
}

async function createRelation(
  type: "blocks" | "related" | "duplicate",
  issueId: string,
  relatedIssueId: string,
): Promise<string> {
  const data = await gqlQuery<{
    issueRelationCreate: { success: boolean; issueRelation: { id: string } };
  }>(
    `mutation($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) { success issueRelation { id } }
    }`,
    { input: { type, issueId, relatedIssueId } },
  );
  return data.issueRelationCreate.issueRelation.id;
}

async function deleteRelation(relationId: string): Promise<void> {
  await gqlQuery(
    `mutation($id: String!) { issueRelationDelete(id: $id) { success } }`,
    { id: relationId },
  );
}

function kindForFlag(flag: RelationFlag): EdgeKind {
  switch (flag) {
    case "--blocked-by":
      return "blocked_by";
    case "--blocks":
      return "blocks";
    case "--relates-to":
      return "relates_to";
    case "--duplicate-of":
      return "duplicate_of";
  }
}

function alreadyMessage(flag: RelationFlag, action: "add" | "remove", id: string): string {
  const kind = kindForFlag(flag);
  if (action === "add") {
    switch (kind) {
      case "blocked_by":
        return `Already blocked by ${id}`;
      case "blocks":
        return `Already blocks ${id}`;
      case "relates_to":
        return `Already relates to ${id}`;
      case "duplicate_of":
        return `Already duplicate of ${id}`;
    }
  }
  switch (kind) {
    case "blocked_by":
      return `Already not blocked by ${id}`;
    case "blocks":
      return `Already does not block ${id}`;
    case "relates_to":
      return `Already does not relate to ${id}`;
    case "duplicate_of":
      return `Already not duplicate of ${id}`;
  }
}

export interface ApplyRelationsResult {
  snapshot: RelationSnapshot;
  /** Axes touched by the request (for echo). */
  touched: Set<keyof RelationSnapshot>;
  /** Idempotent no-op notes; empty when every change applied. */
  noopMessages: string[];
  /** True when every requested change was a no-op. */
  allNoops: boolean;
}

/**
 * Apply relation add/remove changes with read-check-write idempotency.
 * `issueRef` may be an identifier or UUID (Linear accepts both on relation APIs).
 */
export async function applyRelationChanges(
  issueRef: string,
  changes: RelationChange[],
  ctx?: LinearContext,
): Promise<ApplyRelationsResult> {
  if (changes.length === 0) {
    const loaded = await loadRelations(issueRef);
    return {
      snapshot: loaded.snapshot,
      touched: new Set(),
      noopMessages: [],
      allNoops: true,
    };
  }

  const loaded = await loadRelations(issueRef);
  const touched = new Set<keyof RelationSnapshot>();
  const noopMessages: string[] = [];
  let applied = 0;

  const addToSnapshot = (kind: keyof RelationSnapshot, id: string, relationId: string) => {
    const list = loaded.snapshot[kind];
    if (!list.includes(id)) list.push(id);
    loaded.snapshot[kind] = sortIds(list);
    loaded.byKey.set(edgeKey(kind, id), relationId);
  };

  const removeFromSnapshot = (kind: keyof RelationSnapshot, id: string) => {
    loaded.snapshot[kind] = loaded.snapshot[kind].filter(
      (x) => x.toUpperCase() !== id.toUpperCase(),
    );
    loaded.byKey.delete(edgeKey(kind, id));
  };

  for (const change of changes) {
    const relatedRef = normalizeIssueRef(change.ref, ctx);
    const relatedId = await resolveIdentifier(relatedRef);
    const kind = kindForFlag(change.flag);
    touched.add(kind);
    const key = edgeKey(kind, relatedId);
    const existingId = loaded.byKey.get(key);

    if (change.action === "add") {
      if (existingId) {
        noopMessages.push(alreadyMessage(change.flag, "add", relatedId));
        continue;
      }
      let relationId: string;
      if (change.flag === "--blocked-by") {
        // Other blocks this issue: issueId=other, relatedIssueId=self.
        relationId = await createRelation("blocks", relatedRef, issueRef);
      } else if (change.flag === "--blocks") {
        relationId = await createRelation("blocks", issueRef, relatedRef);
      } else if (change.flag === "--relates-to") {
        relationId = await createRelation("related", issueRef, relatedRef);
      } else {
        relationId = await createRelation("duplicate", issueRef, relatedRef);
      }
      addToSnapshot(kind, relatedId, relationId);
      applied++;
    } else {
      if (!existingId) {
        noopMessages.push(alreadyMessage(change.flag, "remove", relatedId));
        continue;
      }
      await deleteRelation(existingId);
      removeFromSnapshot(kind, relatedId);
      applied++;
    }
  }

  return {
    snapshot: loaded.snapshot,
    touched,
    noopMessages,
    allNoops: applied === 0,
  };
}

async function resolveIdentifier(ref: string): Promise<string> {
  const ident = ref.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (ident) return `${ident[1].toUpperCase()}-${ident[2]}`;

  const data = await gqlQuery<{ issue: { identifier: string } | null }>(
    `query($id: String!) { issue(id: $id) { identifier } }`,
    { id: ref },
  );
  if (!data.issue) {
    throw new AxiError(`Issue ${ref} not found`, "NOT_FOUND", [
      "Run `linear-axi issue list` to see recent issues",
    ]);
  }
  return data.issue.identifier;
}
