import fs from "node:fs";
import { captureProcessIdentity } from "@/lib/processIdentity";
import path from "node:path";
import { RuntimeJournal } from "@/runtime-host/journal";
import { ViewerDeploymentCoordinator } from "@/runtime-host/deployment";
import { HostCommandViewerDeploymentAdapter } from "@/runtime-host/deploymentAdapter";
import type { ViewerReleaseIdentity, ViewerHealthEvidence } from "@/lib/runtime/contracts";

// Build/container setup is supplied by the Python harness. The promoted
// verification deadline, adapter child, rollback and terminal ledger are real.
const directory = process.env.LLV_STATE_DIR!;
const input = JSON.parse(fs.readFileSync(path.join(directory, "rehearsal-release.json"), "utf8")) as {
  candidate: ViewerReleaseIdentity; previous: ViewerReleaseIdentity; actionTimeoutMs?: number;
};
const adapter = HostCommandViewerDeploymentAdapter.fromExecutable(path.resolve("scripts/runtime-host-viewer-adapter.ts"), {
  ...(input.actionTimeoutMs ? { timeouts: { "verify-promoted": input.actionTimeoutMs } } : {}),
});
Object.assign(adapter, {
  reconcile: async () => {},
  resolveRevision: async () => input.candidate.revision,
  buildCandidate: async () => input.candidate,
  startCandidate: async () => {},
  currentRelease: async () => input.previous,
  currentMcpRuntime: async () => input.previous.mcpRuntime!,
  verifyCandidate: async (): Promise<ViewerHealthEvidence> => ({
    checkedAt: new Date().toISOString(), endpoint: input.candidate.endpoint,
    processReady: true, rootStatus: 200, authenticatedStatus: null,
    unauthorizedStatus: null, assets: [], ok: true,
    detail: "Prechecks are fixture setup; this rehearsal qualifies startup and rollback only.",
  }),
  promote: async () => ({ ...input.candidate.mcpRuntime!, action: "activate", publishedAt: new Date().toISOString(), durable: true }),
  retire: async () => {},
  retainOnly: async () => {},
});
const journal = new RuntimeJournal(path.join(directory, "rollback-rehearsal.sqlite"));
const coordinator = new ViewerDeploymentCoordinator(journal, adapter, captureProcessIdentity(process.pid));
const receipt = await coordinator.requestViewerDeployment({ revision: input.candidate.revision, idempotencyKey: "packaged-timeout-rollback" });
const terminal = await coordinator.waitForDeployment(receipt.deploymentId);
fs.writeFileSync(path.join(directory, "rollback-terminal.json"), JSON.stringify(terminal));
journal.close();
console.log(JSON.stringify({ phase: terminal?.phase, terminal: terminal?.terminal, error: terminal?.error }));
process.exit(terminal?.phase === "rolled-back" && terminal.terminal ? 0 : 1);
