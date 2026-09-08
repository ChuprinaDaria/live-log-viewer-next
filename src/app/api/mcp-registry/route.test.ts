import { beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

/*
 * Adding and removing an MCP server from the phone, through the console.
 *
 * The console is mocked here, so what this file actually tests is the part
 * the route owns: what it refuses before spending a process, and — the reason
 * the whole channel exists — that a token travels over stdin and never as a
 * command-line flag, where `ps` would show it to anyone on the machine.
 */

const TOKEN = "not-for-the-command-line";

interface ConsoleCall {
  fn: string;
  params?: Record<string, unknown>;
  stdinJson?: Record<string, unknown>;
  stdinParam?: string;
}

let calls: ConsoleCall[] = [];
let refusal: string | null = null;
let installed = true;

mock.module("@/lib/fleetctl/client", () => ({
  fleetctlInstalled: () => installed,
  fleetctl: async (call: ConsoleCall) => {
    calls.push(call);
    if (call.fn === "mcp_list") {
      return { servers: [{ name: "cohere", type: "stdio", env_keys: ["COHERE_API_KEY"], granted_to: [], fleet_env: [] }], registry: "/srv/claude.json" };
    }
    if (call.fn === "skills_list") return { skills: [] };
    if (refusal) throw new Error(refusal);
    return { mcp: call.params?.name, added: true };
  },
  fleetctlMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  fleetctlStatus: () => 400,
}));

const { POST } = await import("./route");

beforeEach(() => {
  calls = [];
  refusal = null;
  installed = true;
});

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest("http://127.0.0.1/api/mcp-registry", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify(body),
  })) as unknown as Promise<Response>;
}

const called = (fn: string): ConsoleCall | undefined => calls.find((call) => call.fn === fn);

test("a stdio server is added by flags, and its env values only over stdin", async () => {
  const response = await post({
    action: "add", name: "cohere", type: "stdio",
    command: "/opt/venv/bin/cohere-mcp", args: ["--stdio", "serve,now"], cwd: "/opt/venv",
    env: { COHERE_API_KEY: TOKEN },
  });
  expect(response.status).toBe(200);

  const add = called("mcp_add")!;
  expect(add).toBeDefined();
  expect(add.params?.name).toBe("cohere");
  expect(add.params?.command).toBe("/opt/venv/bin/cohere-mcp");
  expect(add.stdinJson?.env).toEqual({ COHERE_API_KEY: TOKEN });
  /* The whole point: not a flag. `params` becomes argv, and argv is public. */
  expect(add.params?.env).toBeUndefined();
  expect(JSON.stringify(add.params)).not.toContain(TOKEN);
  /* An argument may contain a comma, and the flag encoding joins a list with
     commas — so arguments take the same lossless channel. */
  expect(add.stdinJson?.args).toEqual(["--stdio", "serve,now"]);

  const body = await response.json() as { servers?: unknown[] };
  expect(body.servers).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain(TOKEN);
});

test("headers on an http server travel the same way", async () => {
  await post({ action: "add", name: "obsidian", type: "http", url: "https://127.0.0.1:27124/mcp/", headers: { Authorization: `Bearer ${TOKEN}` } });
  const add = called("mcp_add")!;
  expect(add.params?.url).toBe("https://127.0.0.1:27124/mcp/");
  expect(add.stdinJson?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  expect(add.params?.headers).toBeUndefined();
});

test("replace travels as the flag it is, and a plain add sends none", async () => {
  await post({ action: "add", name: "cohere", type: "stdio", command: "x", replace: true });
  expect(called("mcp_add")!.params?.replace).toBe(true);
  calls = [];
  await post({ action: "add", name: "cohere", type: "stdio", command: "x" });
  expect(called("mcp_add")!.params?.replace).toBeUndefined();
});

test("a server with no secrets opens no stdin channel at all", async () => {
  await post({ action: "add", name: "plain", type: "stdio", command: "x" });
  expect(called("mcp_add")!.stdinJson?.env).toBeUndefined();
  expect(called("mcp_add")!.stdinJson?.headers).toBeUndefined();
});

test("removing a server names it and answers with the list that is left", async () => {
  const response = await post({ action: "remove", name: "cohere" });
  expect(response.status).toBe(200);
  expect(called("mcp_remove")!.params).toEqual({ name: "cohere" });
  const body = await response.json() as { servers?: unknown[] };
  expect(body.servers).toHaveLength(1);
});

test("what the route refuses, it refuses before spending a process", async () => {
  const bad: Array<[unknown, string]> = [
    [{ action: "add", name: "Не Ім'я", type: "stdio", command: "x" }, "name"],
    [{ action: "add", name: "", type: "stdio", command: "x" }, "name"],
    [{ action: "add", name: "ok", type: "grpc", command: "x" }, "type"],
    [{ action: "add", name: "ok", type: "stdio" }, "command"],
    [{ action: "add", name: "ok", type: "http" }, "url"],
    [{ action: "add", name: "ok", type: "http", url: "ftp://x/" }, "url"],
    [{ action: "add", name: "ok", type: "stdio", command: "x", env: { "1BAD": "v" } }, "env"],
    [{ action: "add", name: "ok", type: "stdio", command: "x", env: { OK: "v".repeat(4097) } }, "env"],
    [{ action: "add", name: "ok", type: "http", url: "https://x/", headers: { "Bad Header": "v" } }, "headers"],
    [{ action: "add", name: "ok", type: "stdio", command: "x", args: [1] }, "args"],
    [{ action: "remove", name: "Не Ім'я" }, "name"],
    [{ action: "sabotage", name: "ok" }, "action"],
  ];
  for (const [body, code] of bad) {
    const response = await post(body);
    expect(response.status, JSON.stringify(body)).toBe(400);
    const answer = await response.json() as { error?: string; code?: string };
    expect(answer.code, JSON.stringify(body)).toBe(code);
    expect(answer.error, JSON.stringify(body)).toBeTruthy();
  }
  expect(calls).toEqual([]);
});

test("more than 32 environment entries is a refusal, not a slow console call", async () => {
  const env: Record<string, string> = {};
  for (let i = 0; i < 33; i += 1) env[`KEY_${i}`] = "v";
  const response = await post({ action: "add", name: "ok", type: "stdio", command: "x", env });
  expect(response.status).toBe(400);
  expect((await response.json() as { code?: string }).code).toBe("env");
  expect(calls).toEqual([]);
});

test("the console's own refusal is what the operator reads", async () => {
  refusal = "MCP cohere уже є; додай replace=true щоб замінити";
  const response = await post({ action: "add", name: "cohere", type: "stdio", command: "x" });
  expect(response.status).toBe(400);
  expect((await response.json() as { error?: string }).error).toBe(refusal);
});

test("granting still works — the add form did not take the page's other verb", async () => {
  const response = await post({ kind: "mcp", item: "cohere", target: "project:money" });
  expect(response.status).toBe(200);
  expect(called("mcp_grant")!.params).toEqual({ target: "project:money", item: "cohere" });
});
