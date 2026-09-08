import { afterEach, beforeEach, expect, mock, test } from "bun:test";
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
let listFails = false;

mock.module("@/lib/fleetctl/client", () => ({
  fleetctlInstalled: () => installed,
  fleetctl: async (call: ConsoleCall) => {
    calls.push(call);
    if (call.fn === "mcp_list") {
      if (listFails) throw new Error("the console went away between the write and the read");
      return { servers: [{ name: "cohere", type: "stdio", env_keys: ["COHERE_API_KEY"], granted_to: [], fleet_env: [] }], registry: "/srv/claude.json" };
    }
    if (call.fn === "skills_list") return { skills: [] };
    if (refusal) throw new Error(refusal);
    if (call.fn === "mcp_remove") return { mcp: call.params?.name, removed: true, grants_cleaned: ["firm:bluebird", "agent:reviewer"] };
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
  listFails = false;
  delete process.env.LLV_MCP_GRANT;
  delete process.env.LLV_HQ_MCP_GRANT;
});

afterEach(() => {
  delete process.env.LLV_MCP_GRANT;
  delete process.env.LLV_HQ_MCP_GRANT;
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

test("the fleet's own servers cannot be removed from the phone", async () => {
  for (const name of ["viewer", "fleetctl"]) {
    calls = [];
    const response = await post({ action: "remove", name });
    expect(response.status, name).toBe(409);
    const answer = await response.json() as { error?: string; code?: string };
    expect(answer.code).toBe("mcp_in_use");
    expect(answer.error).toContain(name);
    /* Refused here, so the console is never asked — `mcp_remove` would have
       succeeded and taken the dashboard's own server with it. */
    expect(calls).toEqual([]);
  }
});

test("a server the fleet runs on is refused by the variable that grants it", async () => {
  process.env.LLV_MCP_GRANT = "cohere, obsidian";
  process.env.LLV_HQ_MCP_GRANT = "qdrant";
  for (const [name, variable] of [["obsidian", "LLV_MCP_GRANT"], ["qdrant", "LLV_HQ_MCP_GRANT"]]) {
    calls = [];
    const response = await post({ action: "remove", name });
    expect(response.status, name).toBe(409);
    const answer = await response.json() as { error?: string; code?: string };
    expect(answer.code).toBe("mcp_in_use");
    expect(answer.error).toContain(name!);
    /* The message names the variable, because that is the file the operator
       has to edit before the removal can go through. */
    expect(answer.error).toContain(variable!);
    expect(calls).toEqual([]);
  }
  /* A server that is in neither list still goes. */
  const ok = await post({ action: "remove", name: "spare" });
  expect(ok.status).toBe(200);
});

test("command, cwd and url are capped, so a paste cannot become a registry entry", async () => {
  const long = "x".repeat(4097);
  const bad: Array<[unknown, string]> = [
    [{ action: "add", name: "ok", type: "stdio", command: long }, "command"],
    [{ action: "add", name: "ok", type: "stdio", command: "x", cwd: long }, "cwd"],
    [{ action: "add", name: "ok", type: "http", url: `https://example.test/${long}` }, "url"],
  ];
  for (const [body, code] of bad) {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json() as { code?: string }).code).toBe(code);
  }
  expect(calls).toEqual([]);
});

test("a server that was added stays added even when the re-read fails", async () => {
  listFails = true;
  const response = await post({ action: "add", name: "cohere", type: "stdio", command: "x" });
  /* The write happened. Answering 400 here would tell the operator it did not,
     and the next attempt would hit «уже є» — a worse lie than a stale list. */
  expect(response.status).toBe(200);
  const body = await response.json() as { added?: boolean; servers?: unknown };
  expect(body.added).toBe(true);
  expect(body.servers).toBeNull();
});

test("removing answers with the grants the console took down with the server", async () => {
  const response = await post({ action: "remove", name: "cohere" });
  const body = await response.json() as { result?: { grants_cleaned?: unknown } };
  expect(body.result?.grants_cleaned).toEqual(["firm:bluebird", "agent:reviewer"]);
});
