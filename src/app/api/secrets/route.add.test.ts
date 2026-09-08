import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

/*
 * Adding a secret from the phone, through the console.
 *
 * The console is mocked here, so what this file tests is the half the route
 * owns: what it refuses before spending a process, and — the reason this
 * route ever accepts a value at all — that the value travels over stdin and
 * never as a command-line flag, where `ps` would hand it to anyone on the
 * machine. The route's older promise still holds for every other action: a
 * body carrying a value is refused outright.
 *
 * The fixture value is deliberately not key-shaped: a test file is a public
 * file, and a string that looks like a real credential is a string somebody
 * will one day try to revoke.
 */

const VALUE = "example-value-1";

interface ConsoleCall {
  fn: string;
  params?: Record<string, unknown>;
  stdinParam?: string;
  stdinValue?: string;
}

let calls: ConsoleCall[] = [];
let refusal: string | null = null;
/* `mock.module` replaces the console for the whole PROCESS, and the GET cases
   in `route.test.ts` are about the inventory FILE the route falls back to when
   no console is installed. So the mock answers through a flag, and this file
   puts it back to "no console" when it is done — whichever order the two files
   run in, neither sees the other's world. */
let installed = false;

mock.module("@/lib/fleetctl/client", () => ({
  fleetctlInstalled: () => installed,
  fleetctl: async (call: ConsoleCall) => {
    calls.push(call);
    if (call.fn === "secrets_list") {
      return { secrets: [{ id: "cohere_mcp", provider: "cohere", state: "unknown", env_name: "COHERE_MCP", file: "/srv/fleet-secrets/cohere_mcp.env" }] };
    }
    if (refusal) throw new Error(refusal);
    const added = call.params?.secret;
    return { secret: added, ref: "/srv/fleet-secrets/cohere_mcp.env:COHERE_MCP" };
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

afterAll(() => { installed = false; });

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest("http://127.0.0.1/api/secrets", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify(body),
  })) as unknown as Promise<Response>;
}

const called = (fn: string): ConsoleCall | undefined => calls.find((call) => call.fn === fn);

test("the metadata travels as flags and the value only over stdin", async () => {
  const response = await post({
    action: "add", secret: "cohere_mcp", value: VALUE, provider: "cohere",
    label: "Cohere · RAG", envName: "COHERE_MCP", kind: "token", owner: "daria",
    firm: "bluebird", project: "money", purpose: "ембединги", tags: ["rag", "prod"],
  });
  expect(response.status).toBe(200);

  const add = called("secret_add")!;
  expect(add).toBeDefined();
  expect(add.params?.secret).toBe("cohere_mcp");
  expect(add.params?.provider).toBe("cohere");
  expect(add.params?.label).toBe("Cohere · RAG");
  expect(add.params?.["env-name"] ?? add.params?.envName).toBe("COHERE_MCP");
  expect(add.params?.["purpose-short"] ?? add.params?.purposeShort).toBe("ембединги");
  expect(add.params?.tags).toEqual(["rag", "prod"]);

  /* The whole point: `params` becomes argv, and argv is public. */
  expect(add.params?.value).toBeUndefined();
  expect(JSON.stringify(add.params)).not.toContain(VALUE);
  expect(add.stdinParam).toBe("value");
  expect(add.stdinValue).toBe(VALUE);

  /* The answer is the refreshed row, and it carries no value either. */
  const body = await response.json() as { secret?: { name?: string; state?: string } };
  expect(body.secret?.name).toBe("cohere_mcp");
  expect(body.secret?.state).toBe("unchecked");
  expect(JSON.stringify(body)).not.toContain(VALUE);
});

test("only the trailing newline is trimmed — the rest of the value is the key", async () => {
  await post({ action: "add", secret: "k", value: `  ${VALUE}\n`, provider: "cohere" });
  expect(called("secret_add")!.stdinValue).toBe(`  ${VALUE}`);
});

test("a value on any OTHER action is still refused, as it always was", async () => {
  const response = await post({ secret: "cohere_mcp", share: "global", value: VALUE });
  expect(response.status).toBe(400);
  expect(calls).toEqual([]);
  const body = await response.json() as { error: string };
  expect(body.error).toContain("metadata");
});

test("a slug that is not a slug, an env name that is not one, and a missing provider are refused", async () => {
  for (const body of [
    { action: "add", secret: "Cohere MCP", value: VALUE, provider: "cohere" },
    { action: "add", secret: "../escape", value: VALUE, provider: "cohere" },
    { action: "add", secret: "k", value: VALUE, provider: "cohere", envName: "with-dash" },
    { action: "add", secret: "k", value: VALUE, provider: "  " },
    { action: "add", secret: "k", value: VALUE },
  ]) {
    const response = await post(body);
    expect(response.status, JSON.stringify(body)).toBe(400);
  }
  expect(calls).toEqual([]);
});

test("an empty value is refused, and one over 8 KiB is refused by size, not truncated", async () => {
  for (const value of ["", "\n", "   ", "x".repeat(8 * 1024 + 1)]) {
    const response = await post({ action: "add", secret: "k", value, provider: "cohere" });
    expect(response.status).toBe(400);
  }
  expect(calls).toEqual([]);
  /* Exactly 8 KiB still goes through: the limit is a limit, not an off-by-one. */
  const ok = await post({ action: "add", secret: "k", value: "x".repeat(8 * 1024), provider: "cohere" });
  expect(ok.status).toBe(200);
});

test("the console's own refusal reaches the caller, and never with the value in it", async () => {
  refusal = "секрет cohere_mcp уже є — додайте --replace, щоб перезаписати";
  const response = await post({ action: "add", secret: "cohere_mcp", value: VALUE, provider: "cohere" });
  expect(response.status).toBe(400);
  const body = await response.json() as { error: string };
  expect(body.error).toContain("--replace");
  expect(JSON.stringify(body)).not.toContain(VALUE);
});

test("replace is passed as a flag, and only when it was asked for", async () => {
  await post({ action: "add", secret: "k", value: VALUE, provider: "cohere" });
  expect(called("secret_add")!.params?.replace).toBeUndefined();
  calls = [];
  await post({ action: "add", secret: "k", value: VALUE, provider: "cohere", replace: true });
  expect(called("secret_add")!.params?.replace).toBe(true);
});
