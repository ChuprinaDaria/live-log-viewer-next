import { expect, test } from "bun:test";

import type { ViewerConversationId } from "@/lib/accounts/migration/contracts";

import type { DurableConversationMembership, RegistryConversation, RegistryFile, SpawnLineageEdge } from "./registry";
import { ROLE_IDS } from "@/lib/roles/types";

import {
  SPAWN_DENIED_ROLE_IDS,
  conversationAgentRole,
  conversationDelegationDepth,
  delegationDeniedGuidance,
  delegationRejectionCode,
  isDelegationDeniedRole,
  isSpawnDeniedRole,
  isUnclassifiedRole,
  nestingDepthGuidance,
  resolveSpawnOrigin,
  reviewerOriginSpawnGuidance,
} from "./spawnAdmission";

type FileView = Pick<RegistryFile, "conversations" | "conversationAliases" | "lineageEdges" | "memberships">;

function conversation(id: string, fields: Partial<RegistryConversation> = {}): RegistryConversation {
  return {
    id: id as ViewerConversationId,
    engine: "codex",
    generations: [],
    continuityPaths: [],
    abandonedContinuityPaths: [],
    providerForkPaths: [],
    projectOwnership: null,
    migration: null,
    migrationOptOut: null,
    supersededBy: null,
    agentRole: null,
    delegationDepth: null,
    turn: { state: "unknown", source: "empty", terminalAt: null, observedAt: null },
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...fields,
  };
}

function edge(child: string, parent: string, fields: Partial<SpawnLineageEdge> = {}): SpawnLineageEdge {
  return {
    childConversationId: child as ViewerConversationId,
    parentConversationId: parent as ViewerConversationId,
    childSessionKey: null,
    parentSessionKey: null,
    childArtifactPath: null,
    parentArtifactPath: null,
    kind: "spawn",
    role: null,
    reviewsConversationId: null,
    source: "viewer-spawn",
    evidence: { launchId: null, clientAttemptId: null },
    createdAt: "2026-07-18T00:00:00.000Z",
    ...fields,
  };
}

function membership(conversationId: string, role: string, createdAt: string): DurableConversationMembership {
  return {
    conversationId: conversationId as ViewerConversationId,
    kind: "pipeline",
    containerId: "pipe1234",
    role,
    slot: `${role}:${createdAt}`,
    stageId: null,
    stageOrder: null,
    round: null,
    parentConversationId: null,
    createdAt,
  };
}

function view(fields: Partial<FileView> = {}): FileView {
  return { conversations: {}, conversationAliases: {}, lineageEdges: {}, memberships: {}, ...fields };
}

test("the denied-role contract pins reviewer and verifier and nothing else", () => {
  expect(SPAWN_DENIED_ROLE_IDS).toEqual(["reviewer", "verifier"]);
  expect(isSpawnDeniedRole("reviewer")).toBe(true);
  expect(isSpawnDeniedRole("verifier")).toBe(true);
  expect(isSpawnDeniedRole("builder")).toBe(false);
  expect(isSpawnDeniedRole(null)).toBe(false);
  expect(isSpawnDeniedRole(undefined)).toBe(false);
});

test("role resolution prefers the recorded conversation role, then lineage edge, then newest membership", () => {
  const recorded = view({
    conversations: { conversation_a: conversation("conversation_a", { agentRole: "builder" }) },
    lineageEdges: { conversation_a: edge("conversation_a", "conversation_p", { role: "reviewer" }) },
  });
  expect(conversationAgentRole(recorded, "conversation_a" as ViewerConversationId)).toBe("builder");

  const edged = view({
    conversations: { conversation_a: conversation("conversation_a") },
    lineageEdges: { conversation_a: edge("conversation_a", "conversation_p", { role: "reviewer" }) },
  });
  expect(conversationAgentRole(edged, "conversation_a" as ViewerConversationId)).toBe("reviewer");

  const membered = view({
    memberships: {
      conversation_a: [
        membership("conversation_a", "builder", "2026-07-01T00:00:00.000Z"),
        membership("conversation_a", "verifier", "2026-07-02T00:00:00.000Z"),
      ],
    },
  });
  expect(conversationAgentRole(membered, "conversation_a" as ViewerConversationId)).toBe("verifier");

  expect(conversationAgentRole(view(), "conversation_unknown" as ViewerConversationId)).toBeNull();
});

test("role resolution follows conversation aliases", () => {
  const aliased = view({
    conversationAliases: { conversation_old: "conversation_new" as ViewerConversationId },
    conversations: { conversation_new: conversation("conversation_new", { agentRole: "reviewer" }) },
  });
  expect(conversationAgentRole(aliased, "conversation_old" as ViewerConversationId)).toBe("reviewer");
});

test("depth resolution prefers the recorded depth and falls back membership-first for legacy records", () => {
  const recorded = view({
    conversations: { conversation_a: conversation("conversation_a", { delegationDepth: 2 }) },
    memberships: { conversation_a: [membership("conversation_a", "builder", "2026-07-01T00:00:00.000Z")] },
  });
  expect(conversationDelegationDepth(recorded, "conversation_a" as ViewerConversationId)).toBe(2);

  /* Legacy container children chain lineage stage-to-stage; membership means
     depth 1, not the lineage-hop count. */
  const containerLegacy = view({
    conversations: { conversation_a: conversation("conversation_a") },
    memberships: { conversation_a: [membership("conversation_a", "builder", "2026-07-01T00:00:00.000Z")] },
    lineageEdges: {
      conversation_a: edge("conversation_a", "conversation_b"),
      conversation_b: edge("conversation_b", "conversation_c"),
      conversation_c: edge("conversation_c", "conversation_root"),
    },
  });
  expect(conversationDelegationDepth(containerLegacy, "conversation_a" as ViewerConversationId)).toBe(1);

  expect(conversationDelegationDepth(view(), "conversation_root" as ViewerConversationId)).toBe(0);
});

test("legacy depth walks lineage edges bounded and cycle-guarded", () => {
  const chained = view({
    lineageEdges: {
      conversation_a: edge("conversation_a", "conversation_b"),
      conversation_b: edge("conversation_b", "conversation_c"),
    },
  });
  expect(conversationDelegationDepth(chained, "conversation_a" as ViewerConversationId)).toBe(2);

  const withRecordedAncestor = view({
    conversations: { conversation_b: conversation("conversation_b", { delegationDepth: 3 }) },
    lineageEdges: { conversation_a: edge("conversation_a", "conversation_b") },
  });
  expect(conversationDelegationDepth(withRecordedAncestor, "conversation_a" as ViewerConversationId)).toBe(4);

  const cyclic = view({
    lineageEdges: {
      conversation_a: edge("conversation_a", "conversation_b"),
      conversation_b: edge("conversation_b", "conversation_a"),
    },
  });
  expect(conversationDelegationDepth(cyclic, "conversation_a" as ViewerConversationId)).toBe(1);

  const edges: FileView["lineageEdges"] = {};
  for (let index = 0; index < 20; index += 1) {
    edges[`conversation_${index}`] = edge(`conversation_${index}`, `conversation_${index + 1}`);
  }
  expect(conversationDelegationDepth(view({ lineageEdges: edges }), "conversation_0" as ViewerConversationId)).toBe(8);

  /* Engine-native lineage never contributes delegation depth. */
  const native = view({
    lineageEdges: { conversation_a: edge("conversation_a", "conversation_b", { source: "engine-native" }) },
  });
  expect(conversationDelegationDepth(native, "conversation_a" as ViewerConversationId)).toBe(0);
});

test("origin resolution keys on the agent caller or the container creator", () => {
  const file = view({
    conversations: {
      conversation_reviewer: conversation("conversation_reviewer", { agentRole: "reviewer", delegationDepth: 1 }),
    },
  });
  expect(resolveSpawnOrigin(file, { kind: "agent", conversationId: "conversation_reviewer" as ViewerConversationId })).toEqual({
    kind: "agent",
    conversationId: "conversation_reviewer" as ViewerConversationId,
    role: "reviewer",
    depth: 1,
  });
  expect(resolveSpawnOrigin(file, {
    kind: "container",
    container: "pipeline",
    containerId: "pipe1234",
    creatorConversationId: "conversation_reviewer" as ViewerConversationId,
  })).toEqual({
    kind: "container",
    conversationId: "conversation_reviewer" as ViewerConversationId,
    role: "reviewer",
    depth: 1,
  });
  expect(resolveSpawnOrigin(file, {
    kind: "container",
    container: "flow",
    containerId: "flow1234",
    creatorConversationId: null,
  })).toEqual({ kind: "container", conversationId: null, role: null, depth: 0 });
  expect(resolveSpawnOrigin(file, { kind: "operator" })).toBeNull();
  expect(resolveSpawnOrigin(file, { kind: "external" })).toBeNull();
  expect(resolveSpawnOrigin(file, { kind: "successor" })).toBeNull();
});

test("rejection guidance is actionable and names the escalation paths", () => {
  expect(reviewerOriginSpawnGuidance("reviewer")).toContain("in-session");
  expect(reviewerOriginSpawnGuidance("verifier")).toStartWith("Verifier");
  expect(nestingDepthGuidance(3, 2)).toContain("depth 2");
  expect(nestingDepthGuidance(3, 2)).toContain("maxAgentNestingDepth");
});

/*
 * Console roles are launchable now (§1.1), and every delegation policy on this
 * board is still written in terms of the seed ids. A copy of `verifier` saved
 * under a new id therefore used to read as "unknown" to the deny-list while
 * carrying verifier's whole prompt — the one way an isolated role could regain
 * the child access it is denied. The classification is by identity alone.
 */

test("a role the board cannot classify delegates nothing, and the seed eight are unchanged", () => {
  for (const seed of ROLE_IDS) expect(isUnclassifiedRole(seed)).toBe(false);
  expect(isUnclassifiedRole("custom-verifier")).toBe(true);
  expect(isUnclassifiedRole("VERIFIER-copy")).toBe(true);
  expect(isUnclassifiedRole(" builder ")).toBe(false);
  expect(isUnclassifiedRole("")).toBe(false);
  expect(isUnclassifiedRole(null)).toBe(false);

  /* A copy of an isolated role is denied because its id is unclassified, and a
     copy of a permitted one is denied for exactly the same reason: the policy
     never looks at the model, the prompt, or a substring of the name. */
  for (const copy of ["custom-verifier", "reviewer-2", "builder-frontend", "orchestrator_v2", "zzz"]) {
    expect(isDelegationDeniedRole(copy)).toBe(true);
  }
  expect(isDelegationDeniedRole("reviewer")).toBe(true);
  expect(isDelegationDeniedRole("verifier")).toBe(true);
  /* The classified roles that may delegate keep delegating. */
  for (const allowed of ["orchestrator", "builder", "architect", "cleaner", "prod-auditor", "deployer"]) {
    expect(isDelegationDeniedRole(allowed)).toBe(false);
  }
  expect(isDelegationDeniedRole(null)).toBe(false);
});

test("each denial names itself, and neither guidance blames the wrong policy", () => {
  expect(delegationRejectionCode("verifier")).toBe("reviewer_origin_spawn");
  expect(delegationRejectionCode("custom-verifier")).toBe("unclassified_role_spawn");
  expect(delegationDeniedGuidance("verifier")).toBe(reviewerOriginSpawnGuidance("verifier"));
  const unclassified = delegationDeniedGuidance("custom-verifier");
  expect(unclassified).toContain("custom-verifier");
  expect(unclassified).toContain("no delegation policy");
  /* It is not a review isolation notice: saying so would send the operator to
     the wrong contract. */
  expect(unclassified).not.toContain("in-session");
});
