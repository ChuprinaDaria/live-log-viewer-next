import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "bun:test";
import ts from "typescript";

/*
 * Every door into a launch, enumerated — because three times now a guard
 * described as covering "all the points" turned out to have one more.
 *
 * `/api/flows` reserves a reviewer without going through the spawn command at
 * all; the HQ seat replaces the seat command's dependencies wholesale and so
 * kept the console default the seat lane had already left. Neither was a subtle
 * bug: both were unlisted callers. So the list is a check rather than prose.
 *
 * The first version of this check was a regex over file text, and it claimed
 * more than it proved: it recognised a literal `executeSpawnRequest(`, recorded
 * FILE names rather than call sites, and looked for `resolveRole:
 * localRoleResolution` anywhere in the file. An import alias, a computed
 * member call, a second call inside an already-listed file, and a spread of the
 * production dependencies placed AFTER `resolveRole` all passed it. The last
 * one hangs on a live console.
 *
 * So this walks the TypeScript AST instead, and refuses to guess:
 *
 *  - every local binding of the export is followed, aliases included;
 *  - each CALL is classified, not each file;
 *  - the dependencies expression is read AT THE CALL, in property order, so a
 *    later spread that restores the default is what it is;
 *  - anything this can't read — a re-export, a computed member, the export
 *    escaping as a value — is REFUSED rather than assumed innocent.
 *
 * What it does not do is follow a value across functions. That is why an
 * escape is a failure here instead of a starting point for a search.
 *
 * The rule the table encodes: a SEAT launch resolves locally (built-in
 * definitions, no console call ever), because a console that is down must not
 * stop the fleet from launching the agent that would repair the console. Every
 * other launch resolves through the shared console catalog, because that is
 * what makes an additional console role launchable at all.
 */

const SOURCE_ROOT = path.join(import.meta.dir, "..", "..");
const SPAWN_COMMAND = "lib/agent/spawnCommand.ts";
const EXPORT_NAME = "executeSpawnRequest";
/** Dependency objects that carry the console-catalog resolver. */
const DEFAULT_DEPENDENCIES = new Set(["productionSpawnCommandDependencies"]);
const LOCAL_RESOLVER = "localRoleResolution";

/**
 * Spreads that are neither the production defaults nor a literal, classified by
 * name because this scan does not follow values across functions. Each entry
 * names the module the helper lives in, and the check below requires that
 * module to mention `resolveRole` nowhere at all — so a classified spread
 * cannot start setting the resolver without failing this file first.
 */
const CLASSIFIED_SPREADS: Record<string, { module: string; why: string }> = {
  reportSpawnOverrides: {
    module: "lib/telegram/reportSpawn.ts",
    why: "The report launcher's own grant and deferral overrides. It does not name a role resolver, so the call keeps the default.",
  },
};

type Resolution = "console-catalog" | "local";

/** Each call of the spawn command, and the resolution it must get. */
const ENTRY_POINTS: Record<string, { calls: Resolution[]; why: string }> = {
  "app/api/spawn/route.ts": {
    calls: ["console-catalog"],
    why: "The operator's own HTTP lane, and the one MCP `spawn_agent` dispatches to. It passes no dependencies at all, which is what keeps the resolution seam out of reach of any request body, header or query.",
  },
  "lib/telegram/reportSpawn.ts": {
    calls: ["console-catalog"],
    why: "The scheduled report launch. Its body carries no role, so the catalog is never consulted for it in practice; it takes the default because it is an ordinary launch, not a seat.",
  },
  "lib/orchestrator/seatCommand.ts": {
    calls: ["local"],
    why: "Taking and rotating an orchestrator seat. Recovery depends on it, so it never waits on the console — and it resolves the same way its own preflight measures the mandate envelope.",
  },
  "app/api/orchestrator/hq/route.ts": {
    calls: ["local"],
    why: "The HQ seat, through a spawn that replaces the seat command's own. Same seat contract; it needs the choice restated because substituting `spawn` also substitutes the dependencies the seat command would have passed.",
  },
};

/**
 * The one place the export is allowed to escape as a value instead of being
 * called. `POST.withDependencies` is the test seam of the spawn route, and the
 * check below requires it to stay one: no source outside a test may reach it,
 * because a caller through that property is a door this scan cannot see.
 */
const ESCAPES: Record<string, { property: string; why: string }> = {
  "app/api/spawn/route.ts": {
    property: "withDependencies",
    why: "The route's own test seam. Guarded separately: no non-test source may call it.",
  },
};

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    found.push(full);
  }
  return found;
}

const relative = (file: string) => path.relative(SOURCE_ROOT, file).split(path.sep).join("/");

/** Whether a module specifier names the spawn command, by either spelling. */
function importsSpawnCommand(specifier: string, fromFile: string): boolean {
  if (specifier === "@/lib/agent/spawnCommand") return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  return relative(resolved) === SPAWN_COMMAND.replace(/\.ts$/, "");
}

interface Bindings {
  /** Local names bound directly to the export (aliases included). */
  direct: Set<string>;
  /** Local names bound to the whole module. */
  namespaces: Set<string>;
  /** Things this scan cannot follow, each already a failure. */
  refusals: string[];
}

function bindingsOf(source: ts.SourceFile, file: string): Bindings {
  const bindings: Bindings = { direct: new Set(), namespaces: new Set(), refusals: [] };
  const note = (reason: string) => bindings.refusals.push(reason);
  for (const statement of source.statements) {
    /* `export { executeSpawnRequest } from "…"` and its aliasing forms: a
       re-export is a door under a name this file does not control. */
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      && importsSpawnCommand(statement.moduleSpecifier.text, file)) {
      note("re-exports the spawn command");
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!importsSpawnCommand(statement.moduleSpecifier.text, file)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.namespaces.add(clause.namedBindings.name.text);
      continue;
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === EXPORT_NAME) bindings.direct.add(element.name.text);
      }
    }
  }
  /* The dynamic forms the in-process callers use: `const { … } = await
     import("@/lib/agent/spawnCommand")`, and the same inside an awaited
     `Promise.all([...])`. Destructuring is followed; binding the module object
     as a whole is not. */
  const importSpecifier = (node: ts.Expression): string | null => {
    const call = ts.isAwaitExpression(node) ? node.expression : node;
    if (!ts.isCallExpression(call) || call.expression.kind !== ts.SyntaxKind.ImportKeyword) return null;
    const first = call.arguments[0];
    return first && ts.isStringLiteral(first) ? first.text : null;
  };
  const bindModule = (name: ts.BindingName): void => {
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const exported = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : ts.isIdentifier(element.name) ? element.name.text : "";
        if (exported === EXPORT_NAME && ts.isIdentifier(element.name)) bindings.direct.add(element.name.text);
      }
      return;
    }
    if (ts.isIdentifier(name)) { bindings.namespaces.add(name.text); return; }
    note("destructures the spawn command in a shape this scan cannot follow");
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const direct = importSpecifier(node.initializer);
      if (direct && importsSpawnCommand(direct, file)) bindModule(node.name);
      /* `const [a, b] = await Promise.all([import(x), import(y)])`: each
         binding element is matched to the import in its own position. */
      const awaited = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isArrayBindingPattern(node.name) && ts.isCallExpression(awaited) && awaited.expression.getText().endsWith("Promise.all")) {
        const list = awaited.arguments[0];
        if (list && ts.isArrayLiteralExpression(list)) {
          node.name.elements.forEach((element, index) => {
            const specifier = list.elements[index] ? importSpecifier(list.elements[index]!) : null;
            if (specifier && importsSpawnCommand(specifier, file) && ts.isBindingElement(element)) bindModule(element.name);
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

/** How a call's second argument resolves the role, read in property order. */
function resolutionOfArgument(argument: ts.Expression | undefined): Resolution | { refusal: string } {
  if (argument === undefined) return "console-catalog";
  if (!ts.isObjectLiteralExpression(argument)) return { refusal: "passes dependencies this scan cannot read" };
  let resolution: Resolution = "console-catalog";
  for (const property of argument.properties) {
    /* Order matters: a spread of the production dependencies placed AFTER
       `resolveRole` puts the console resolver back, and the launch then waits
       on the console however the property above reads. */
    if (ts.isSpreadAssignment(property)) {
      if (ts.isIdentifier(property.expression) && DEFAULT_DEPENDENCIES.has(property.expression.text)) {
        resolution = "console-catalog";
        continue;
      }
      /* A helper that builds part of the dependencies. Classified by name in
         the table above, or refused: this scan does not read what a function
         returns. */
      const name = ts.isCallExpression(property.expression) ? property.expression.expression.getText() : property.expression.getText();
      if (CLASSIFIED_SPREADS[name]) continue;
      return { refusal: `spreads ${property.expression.getText()}, which this scan cannot classify` };
    }
    if (!ts.isPropertyAssignment(property)) {
      if ((ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)) && property.name.getText() === "resolveRole") {
        return { refusal: "names resolveRole in a form this scan cannot read" };
      }
      continue;
    }
    if (property.name.getText() !== "resolveRole") continue;
    if (ts.isIdentifier(property.initializer) && property.initializer.text === LOCAL_RESOLVER) {
      resolution = "local";
      continue;
    }
    return { refusal: `sets resolveRole to ${property.initializer.getText()}` };
  }
  return resolution;
}

interface Scan {
  calls: Resolution[];
  refusals: string[];
  /** References to the export that are not calls. */
  escapes: string[];
}

function scan(file: string): Scan {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = bindingsOf(source, file);
  const result: Scan = { calls: [], refusals: [...bindings.refusals], escapes: [] };
  if (!bindings.direct.size && !bindings.namespaces.size) return result;

  /** Whether an expression names the export, by any binding this file has. */
  const namesExport = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return bindings.direct.has(node.text);
    if (ts.isPropertyAccessExpression(node)) return ts.isIdentifier(node.expression) && bindings.namespaces.has(node.expression.text) && node.name.text === EXPORT_NAME;
    if (ts.isElementAccessExpression(node)) {
      if (!ts.isIdentifier(node.expression) || !bindings.namespaces.has(node.expression.text)) return false;
      /* `command["executeSpawnRequest"](req)` is a call; a computed key is a
         call this scan cannot name, and it is refused below. */
      return ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text === EXPORT_NAME : true;
    }
    return false;
  };
  const isComputed = (node: ts.Node): boolean => ts.isElementAccessExpression(node)
    && ts.isIdentifier(node.expression) && bindings.namespaces.has(node.expression.text)
    && !ts.isStringLiteral(node.argumentExpression);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && namesExport(node.expression)) {
      if (isComputed(node.expression)) result.refusals.push("calls the spawn command through a computed member");
      else {
        const resolution = resolutionOfArgument(node.arguments[1]);
        if (typeof resolution === "string") result.calls.push(resolution);
        else result.refusals.push(`a call ${resolution.refusal}`);
      }
      ts.forEachChild(node, visit);
      return;
    }
    /* A reference that is not the callee of its own call: the value escapes,
       and where it is invoked is out of this scan's sight. */
    if (namesExport(node) && !(node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      const isImportBinding = node.parent && (ts.isImportSpecifier(node.parent) || ts.isBindingElement(node.parent));
      if (!isImportBinding) result.escapes.push(node.parent?.getText().split("\n")[0]?.trim() ?? node.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

const scans = new Map(sourceFiles(SOURCE_ROOT)
  .filter((file) => relative(file) !== SPAWN_COMMAND)
  .map((file) => [relative(file), scan(file)] as const)
  .filter(([, found]) => found.calls.length || found.refusals.length || found.escapes.length));

test("every call of the spawn command is listed with the resolution it gets", () => {
  /* Files, and the number of calls in each: a SECOND call inside an already
     listed file is a new door too, and it shows up here as a longer list. */
  const found = Object.fromEntries([...scans].map(([file, result]) => [file, result.calls]));
  const expected = Object.fromEntries(Object.entries(ENTRY_POINTS).map(([file, entry]) => [file, entry.calls]));
  expect(found).toEqual(expected);
});

test("nothing reaches the spawn command by a route this scan cannot read", () => {
  const refusals = [...scans].flatMap(([file, result]) => result.refusals.map((refusal) => `${file} ${refusal}`));
  /* An alias this scan follows is fine; a re-export, a computed member or an
     unreadable dependency expression is not, because each is a launch whose
     resolution nobody can state. */
  expect(refusals).toEqual([]);

  const escapes = [...scans].flatMap(([file, result]) => result.escapes.map((escape) => `${file}: ${escape}`));
  const allowed = Object.entries(ESCAPES).map(([file, entry]) => `${file}: ${entry.property}: ${EXPORT_NAME}`);
  expect(escapes).toEqual(allowed);
});

test("the route's test seam stays a test seam", () => {
  const seam = ESCAPES["app/api/spawn/route.ts"]!.property;
  /* The escape above is only safe while nothing in the app reaches through it:
     a wrapper calling `POST.withDependencies(req)` would be a launch this scan
     classifies as belonging to the route, with dependencies written elsewhere.
     Read as member access on a binding imported FROM that route, so the many
     unrelated `withDependencies` in this repo are not mistaken for it. */
  const reaching: string[] = [];
  for (const file of sourceFiles(SOURCE_ROOT)) {
    if (relative(file) === "app/api/spawn/route.ts") continue;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fromRoute = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const target = specifier.startsWith(".") ? relative(path.resolve(path.dirname(file), specifier)) : specifier.replace(/^@\//, "");
      if (target !== "app/api/spawn/route") continue;
      const clause = statement.importClause?.namedBindings;
      if (clause && ts.isNamedImports(clause)) for (const element of clause.elements) fromRoute.add(element.name.text);
      if (clause && ts.isNamespaceImport(clause)) fromRoute.add(clause.name.text);
    }
    if (!fromRoute.size) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === seam && ts.isIdentifier(node.expression) && fromRoute.has(node.expression.text)) {
        reaching.push(`${relative(file)}: ${node.getText()}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(reaching).toEqual([]);
});

test("each listed call passes exactly the resolution the table claims", () => {
  for (const [file, entry] of Object.entries(ENTRY_POINTS)) {
    expect(scans.get(file)?.calls, `${file} — ${entry.why}`).toEqual(entry.calls);
  }
});

test("a classified spread cannot quietly start naming a resolver", () => {
  for (const [name, entry] of Object.entries(CLASSIFIED_SPREADS)) {
    const contents = readFileSync(path.join(SOURCE_ROOT, entry.module), "utf8");
    /* The classification says «this helper does not decide the resolution».
       The moment its module mentions the seam at all, the classification is a
       claim nobody checked, so it fails here instead. */
    expect(contents.includes("resolveRole"), `${name} — ${entry.why}`).toBe(false);
    expect(contents.includes(name)).toBe(true);
  }
});

test("the spawn command's own default is the shared console catalog", () => {
  const contents = readFileSync(path.join(SOURCE_ROOT, SPAWN_COMMAND), "utf8");
  /* A caller that says nothing gets the catalog — so forgetting the seam is
     never what turns an operator launch into a built-in-only one. */
  expect(/resolveRole:\s*resolveSpawnRoleFromCatalog/.test(contents)).toBe(true);
  expect(/dependencies\.resolveRole\s*\?\?\s*resolveSpawnRoleFromCatalog/.test(contents)).toBe(true);
});
