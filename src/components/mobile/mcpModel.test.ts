import { expect, test } from "bun:test";

import { serverLine, targetLabel, type McpServerRow } from "./mcpModel";

const server = (over: Partial<McpServerRow>): McpServerRow => ({
  name: "cohere", type: "stdio", granted_to: [], fleet_env: [], ...over,
});

test("a stdio server reads as its transport and the binary that runs it", () => {
  expect(serverLine(server({ type: "stdio", command: "/opt/venv/bin/cohere-mcp" }))).toBe("stdio · cohere-mcp");
});

test("an http server reads as its host, never its full url with a token in the query", () => {
  const line = serverLine(server({ name: "obsidian", type: "http", url: "https://127.0.0.1:27124/mcp/?key=abcdef123456" }));
  expect(line).toBe("http · 127.0.0.1:27124");
  expect(line).not.toContain("abcdef123456");
});

test("a url the console could not parse still renders rather than throwing", () => {
  expect(serverLine(server({ type: "sse", url: "not a url" }))).toBe("sse · not a url");
});

test("the row type carries key names and has no place to put a value", () => {
  const row = server({ env_keys: ["COHERE_API_KEY", "PYTHONPATH"] });
  /* The console masks env and headers to their names before answering. This
     is the structural half of that promise: there is no `env` on the row, so
     a value cannot reach the page even by accident. */
  expect(row.env_keys).toEqual(["COHERE_API_KEY", "PYTHONPATH"]);
  expect((row as unknown as Record<string, unknown>).env).toBeUndefined();
  expect((row as unknown as Record<string, unknown>).headers).toBeUndefined();
});

test("a firm target reads by its human name when one is known, its slug otherwise", () => {
  expect(targetLabel("firm:bluebird", { bluebird: "Blue Bird" })).toBe("Blue Bird");
  expect(targetLabel("firm:bluebird")).toBe("bluebird");
  expect(targetLabel("project:money")).toBe("money");
  expect(targetLabel("agent:reviewer")).toBe("reviewer");
});
