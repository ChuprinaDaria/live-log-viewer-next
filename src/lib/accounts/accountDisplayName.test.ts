import { describe, expect, test } from "bun:test";

import { accountDisplayName, DEFAULT_ACCOUNT_ID } from "./badge";

describe("accountDisplayName", () => {
  const accounts = [
    { id: DEFAULT_ACCOUNT_ID, label: "Main", email: "account-a@example.test" },
    { id: "acct-b", label: "Second", email: null },
  ];
  test("prefers the mailbox the registry recorded", () => {
    expect(accountDisplayName(accounts, DEFAULT_ACCOUNT_ID)).toBe("account-a@example.test");
  });
  test("a managed account without a mailbox keeps its id, never «default» wording", () => {
    expect(accountDisplayName(accounts, "acct-b")).toBe("acct-b");
  });
  test("the default account without a mailbox falls back to the registry label", () => {
    expect(accountDisplayName([{ id: DEFAULT_ACCOUNT_ID, label: "Main" }], DEFAULT_ACCOUNT_ID)).toBe("Main");
  });
  test("an unknown id is returned as is", () => {
    expect(accountDisplayName(accounts, "ghost")).toBe("ghost");
    expect(accountDisplayName([], DEFAULT_ACCOUNT_ID)).toBe(DEFAULT_ACCOUNT_ID);
  });
});
