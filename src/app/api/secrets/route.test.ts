import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* The projection is the boundary: a value the inventory grows tomorrow must
   not reach the browser because the page renders it, and a `masked` field that
   holds a sentence must not be printed as a mask. Each case writes its own
   inventory into a temporary directory and imports the route fresh, because
   the path is read at module load. */

const roots: string[] = [];
let caseNumber = 0;

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
  delete process.env.SECRETS_INVENTORY;
});

async function serve(inventory: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-"));
  roots.push(root);
  const file = path.join(root, "inventory.json");
  fs.writeFileSync(file, JSON.stringify(inventory));
  process.env.SECRETS_INVENTORY = file;
  const module = await import(`@/app/api/secrets/route?case=${++caseNumber}`);
  const response = await (module as { GET: () => Promise<Response> }).GET();
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("a prose `masked` is the purpose, never a mask, and no value field crosses", async () => {
  const { status, body } = await serve({
    generated_at: "2026-09-08 04:01:17",
    secrets: [{
      name: "openai_jeeves",
      provider: "openai",
      kind: "token",
      host: "ryzen",
      alive: false,
      masked: "OpenAI API key — jeeves-osvita (root+.env+backend, ryzen)",
      value: "LEAK-A",
      token: "LEAK-B",
      checked_at: "2026-09-08 04:00:05",
    }],
  });
  expect(status).toBe(200);
  const row = (body.secrets as Record<string, unknown>[])[0];
  expect(row.purpose).toBe("OpenAI API key — jeeves-osvita (root+.env+backend, ryzen)");
  expect(row.masked).toBeUndefined();
  expect(row.state).toBe("dead");
  expect(JSON.stringify(body)).not.toContain("LEAK-");
});

test("a real mask stays a mask, and purpose_short wins over the masked prose", async () => {
  const { body } = await serve({
    secrets: [{ name: "k", provider: "openai", alive: true, masked: "sk-…4f2a", purpose_short: "оплата ботів", label: "OpenAI · боти" }],
  });
  const row = (body.secrets as Record<string, unknown>[])[0];
  expect(row.masked).toBe("sk-…4f2a");
  expect(row.purpose).toBe("оплата ботів");
  expect(row.label).toBe("OpenAI · боти");
  expect(row.state).toBe("alive");
});

test("an unchecked key is unchecked, a plan of \"-\" is an absent field, and a CLI with no login carries none", async () => {
  const { body } = await serve({
    secrets: [{ name: "k", provider: "internal", alive: null }],
    accounts: [{ service: "GitHub", email_or_login: "someone", plan: "-", host: "walter" }],
    clis: [{ name: "npm", logged_in_as: null, host: "ryzen" }],
  });
  expect((body.secrets as Record<string, unknown>[])[0].state).toBe("unchecked");
  expect((body.secrets as Record<string, unknown>[])[0].purpose).toBeUndefined();
  expect((body.accounts as Record<string, unknown>[])[0].plan).toBeUndefined();
  expect((body.clis as Record<string, unknown>[])[0].loggedInAs).toBeUndefined();
});

test("a missing inventory is reported as missing rather than as an empty page", async () => {
  process.env.SECRETS_INVENTORY = path.join(os.tmpdir(), "no-such-inventory-file.json");
  const module = await import(`@/app/api/secrets/route?case=${++caseNumber}`);
  const response = await (module as { GET: () => Promise<Response> }).GET();
  expect(response.status).toBe(404);
  expect((await response.json() as { error: string }).error).toBe("INVENTORY_MISSING");
});
