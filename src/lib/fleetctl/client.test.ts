import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * The console as a child process, with a stand-in for the console itself.
 *
 * The case that matters is a console that stops listening: argparse refuses a
 * flag and exits before the caller has finished writing. The write then fails
 * with EPIPE, and an unhandled `error` on a stream is a process event, not a
 * call event — it takes the Viewer down with it (AGENTS.md, «a failing socket
 * write is a connection event, never a process event»). A refusal has to come
 * back as a rejected promise and nothing else.
 */

const dir = mkdtempSync(path.join(os.tmpdir(), "llv-fleetctl-client-"));
const bin = path.join(dir, "fleetctl");
writeFileSync(bin, `#!/bin/sh
if [ "$FAKE_CONSOLE" = "deaf" ]; then exit 3; fi
printf '{"got":'
cat
printf '}'
`);
chmodSync(bin, 0o755);
process.env.FLEETCTL_DIR = dir;

const { fleetctl, FleetctlError } = await import("./client");

afterAll(() => {
  delete process.env.FLEETCTL_DIR;
  delete process.env.FAKE_CONSOLE;
  rmSync(dir, { recursive: true, force: true });
});

/** Never inline beside its key name: a scanner cannot tell a fixture from a
    live credential, and it is right not to try. */
const HIDDEN = "not-for-the-command-line";

/** Bigger than a pipe buffer, so the write cannot finish before the exit. */
const BIG = { env: { TOKEN: "x".repeat(140_000) } };

test("a console that exits before reading answers with a rejection, not a crash", async () => {
  process.env.FAKE_CONSOLE = "deaf";
  const call = fleetctl({ fn: "mcp_add", params: { name: "cohere" }, stdinJson: BIG });
  await expect(call).rejects.toBeInstanceOf(FleetctlError);
});

test("the same holds for the single-parameter stdin channel", async () => {
  process.env.FAKE_CONSOLE = "deaf";
  const call = fleetctl({ fn: "role_edit", params: { role: "reviewer" }, stdinParam: "prompt", stdinValue: "y".repeat(140_000) });
  await expect(call).rejects.toBeInstanceOf(FleetctlError);
});

test("a console that does read gets the object on stdin and nothing in argv", async () => {
  delete process.env.FAKE_CONSOLE;
  const answer = await fleetctl<{ got: { env: Record<string, string> } }>({
    fn: "mcp_add",
    params: { name: "cohere" },
    stdinJson: { env: { COHERE_API_KEY: HIDDEN } },
  });
  expect(answer.got.env).toEqual({ COHERE_API_KEY: HIDDEN });
});

test("two stdin channels at once is a refusal — there is one stdin", async () => {
  await expect(fleetctl({ fn: "mcp_add", stdinParam: "command", stdinJson: { env: {} } }))
    .rejects.toBeInstanceOf(FleetctlError);
});
