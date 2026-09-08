import { expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { rejectCrossOrigin } from "./sameOrigin";

test("a host listed in LLV_EXTRA_ORIGIN_HOSTS is same-origin, ports ignored", () => {
  const before = process.env.LLV_EXTRA_ORIGIN_HOSTS;
  process.env.LLV_EXTRA_ORIGIN_HOSTS = " 100.64.0.9:8898 ,example.internal";
  try {
    const ok = new NextRequest("http://100.64.0.9:8898/api/x", { method: "POST", headers: { host: "100.64.0.9:8898", origin: "http://100.64.0.9:8898" } });
    expect(rejectCrossOrigin(ok)).toBeNull();
    const other = new NextRequest("http://100.64.0.9:8898/api/x", { method: "POST", headers: { host: "100.64.0.9:8898", origin: "http://evil.example" } });
    expect(rejectCrossOrigin(other)).not.toBeNull();
  } finally {
    if (before === undefined) delete process.env.LLV_EXTRA_ORIGIN_HOSTS; else process.env.LLV_EXTRA_ORIGIN_HOSTS = before;
  }
});
