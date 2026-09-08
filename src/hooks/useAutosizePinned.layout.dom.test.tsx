import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useAutosizePinned } from "./useAutosizePinned";

const dom = new Window();
let resize: (() => void) | null = null;
const saved = new Map<string, unknown>();
const overrides = { window: dom, document: dom.document, navigator: dom.navigator, Node: dom.Node, HTMLElement: dom.HTMLElement, ResizeObserver: class {
  constructor(callback: () => void) { resize = callback; }
  observe() {}
  disconnect() { resize = null; }
} };
let root: Root | null = null;
afterEach(async () => {
  if (root) flushSync(() => root!.unmount());
  root = null;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  saved.clear();
});

function mount(chrome: number) {
  for (const [key, value] of Object.entries(overrides)) { saved.set(key, (globalThis as Record<string, unknown>)[key]); (globalThis as Record<string, unknown>)[key] = value; }
  const metrics = { width: 360, content: 100, chrome };
  function Harness() {
    const input = useRef<HTMLTextAreaElement>(null);
    useAutosizePinned(input, "An editable multiline draft", { maxPx: 255, minPx: 52, containerMaxPx: 320, pinned: false });
    return <form ref={(el) => { if (el) Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => metrics.chrome + Number.parseFloat(input.current?.style.height || "0") }); }}>
      <textarea defaultValue="An editable multiline draft" ref={(el) => {
        input.current = el;
        if (!el) return;
        Object.defineProperties(el, {
          scrollHeight: { configurable: true, get: () => metrics.content },
          offsetHeight: { configurable: true, get: () => Number.parseFloat(el.style.height || "0") },
        });
        el.getBoundingClientRect = () => ({ width: metrics.width }) as DOMRect;
      }} />
    </form>;
  }
  const host = dom.document.createElement("div");
  dom.document.body.replaceChildren(host);
  root = createRoot(host as unknown as Element);
  flushSync(() => root!.render(<Harness />));
  return { metrics, input: host.querySelector("textarea")! };
}

test("a width change remeasures wrapping without an edit and preserves the mid-text scroll", () => {
  const { metrics, input } = mount(65);
  expect(input.style.height).toBe("102px");
  input.setSelectionRange(4, 4);
  input.scrollTop = 12;
  metrics.width = 240; metrics.content = 180;
  resize!();
  expect(input.style.height).toBe("182px");
  expect(input.scrollTop).toBe(12);
});

test("context and attachments reserve space for Send inside the form", () => {
  const { metrics, input } = mount(120);
  metrics.content = 500;
  metrics.width = 300;
  resize!();
  expect(input.style.height).toBe("200px");
  metrics.chrome = 160;
  resize!();
  expect(input.style.height).toBe("160px");
});
