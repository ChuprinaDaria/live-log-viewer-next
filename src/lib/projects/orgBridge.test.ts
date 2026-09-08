import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { directoryProjectId } from "./identity";
import { forgetOrgBridge, loadOrgBridge, orgAttributionFor } from "./orgBridge";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "org-bridge-"));
  process.env.LLV_STATE_DIR = path.join(root, "state");
  /* No console on this machine: the loader must fall back to the cache file,
     which is exactly the shape a dashboard sees when fleetctl is absent. */
  process.env.FLEETCTL_DIR = path.join(root, "no-console");
  forgetOrgBridge();
});

afterEach(() => {
  delete process.env.LLV_STATE_DIR;
  delete process.env.FLEETCTL_DIR;
  forgetOrgBridge();
  fs.rmSync(root, { recursive: true, force: true });
});

function seedCache(rows: unknown[]): void {
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "org-bridge.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), rows }),
  );
}

test("a session in a console project's directory reports its firm", async () => {
  const projectPath = path.join(root, "work", "ai-trainer");
  fs.mkdirSync(projectPath, { recursive: true });
  seedCache([
    { firm: "noologic", firmName: "Noologic", project: "ai-trainer", projectName: "AI Trainer", path: projectPath, via: "path" },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  const found = orgAttributionFor(bridge, directoryProjectId(fs.realpathSync.native(projectPath)), projectPath);

  expect(found?.firm).toBe("noologic");
  expect(found?.firmName).toBe("Noologic");
  expect(found?.projectName).toBe("AI Trainer");
});

test("a subdirectory of the project still belongs to it", async () => {
  const projectPath = path.join(root, "work", "money");
  fs.mkdirSync(path.join(projectPath, "backend", "app"), { recursive: true });
  seedCache([
    { firm: "noologic", firmName: "Noologic", project: "money", projectName: "money", path: projectPath, via: "path" },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  const found = orgAttributionFor(bridge, "dir-" + "0".repeat(32), path.join(projectPath, "backend", "app"));

  expect(found?.project).toBe("money");
  expect(found?.via).toBe("path");
});

test("a sibling whose name merely starts the same is a different project", async () => {
  /* The bug this guards: a project at `…/work/fleet` must never claim a
     session that ran in `…/work/fleetctl`. */
  const fleet = path.join(root, "work", "fleet");
  const fleetctl = path.join(root, "work", "fleetctl");
  fs.mkdirSync(fleet, { recursive: true });
  fs.mkdirSync(fleetctl, { recursive: true });
  seedCache([
    { firm: "bluebird", firmName: "Blue Bird", project: "fleet", projectName: "fleet", path: fleet, via: "path" },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  expect(orgAttributionFor(bridge, null, fleetctl)).toBeNull();
  expect(orgAttributionFor(bridge, null, fleet)?.project).toBe("fleet");
});

test("the deepest project wins over its parent", async () => {
  const parent = path.join(root, "work", "horoshop");
  const child = path.join(parent, "mcp");
  fs.mkdirSync(child, { recursive: true });
  seedCache([
    { firm: "noologic", firmName: "Noologic", project: "horoshop", projectName: "horoshop", path: parent, via: "path" },
    { firm: "noologic", firmName: "Noologic", project: "horoshop-mcp", projectName: "horoshop-mcp", path: child, via: "path" },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  expect(orgAttributionFor(bridge, null, child)?.project).toBe("horoshop-mcp");
  expect(orgAttributionFor(bridge, null, parent)?.project).toBe("horoshop");
});

test("a path that exists on another machine still joins by path", async () => {
  /* walter's paths read from the Ryzen side: the directory is absent here, so
     no identity can be minted for it, but the cwd string is unchanged. */
  seedCache([
    { firm: "bluebird", firmName: "Blue Bird", project: "image-finder", projectName: "image finder", path: "/srv/remote-host/work/image-finder", via: "path" },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  const found = orgAttributionFor(bridge, null, "/srv/remote-host/work/image-finder/src");

  expect(found?.project).toBe("image-finder");
  expect(found?.firm).toBe("bluebird");
});

test("no console and no cache attributes nothing rather than guessing", async () => {
  const bridge = await loadOrgBridge({ force: true });
  expect(bridge.empty).toBe(true);
  expect(orgAttributionFor(bridge, "dir-" + "a".repeat(32), "/anywhere")).toBeNull();
});

test("a console project without a path is skipped, not half-joined", async () => {
  seedCache([
    { firm: "noologic", firmName: "Noologic", project: "bot", projectName: "bot", path: "", via: "path" },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  expect(bridge.empty).toBe(true);
});

test("a session whose transcript names no cwd still joins, by the Claude folder slug", async () => {
  /* The scanner falls back to the folder name Claude Code uses — every `/`,
     `_` and `.` replaced by `-` — and a great many transcripts carry no
     readable cwd at all. Covering only the ones that do would leave most
     sessions unattributed while looking like it worked. */
  const projectPath = "/srv/remote-host/logger/bridge-ramona/workspace";
  seedCache([
    { firm: "bluebird", firmName: "Blue Bird", project: "ramona", projectName: "Ramona", path: projectPath, via: "path" },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  const slug = projectPath.replace(/[/_.]/g, "-");

  expect(orgAttributionFor(bridge, slug, null)?.project).toBe("ramona");
  expect(orgAttributionFor(bridge, slug, undefined)?.via).toBe("board-id");
});

test("a repository joins by its remote, whatever path it sits at on this machine", async () => {
  /* The case the path index cannot cover: the console knows the checkout at
     one host's path, and the session ran at another's. The repository is the
     same, so the identity must be too. */
  seedCache([
    {
      firm: "bluebird", firmName: "Blue Bird", project: "viewer", projectName: "Viewer",
      path: "/srv/somewhere-else/viewer", repo: "https://github.com/ChuprinaDaria/live-log-viewer-next.git",
      via: "path",
    },
  ]);

  const bridge = await loadOrgBridge({ force: true });
  const { projectIdentityFromRemote } = await import("./identity");
  /* The same repository written two ways — with the .git suffix and without —
     is one repository, so both forms must land on one project. */
  const withSuffix = projectIdentityFromRemote("https://github.com/ChuprinaDaria/live-log-viewer-next.git");
  const without = projectIdentityFromRemote("https://github.com/ChuprinaDaria/live-log-viewer-next");

  expect(withSuffix).not.toBeNull();
  expect(without?.project).toBe(withSuffix!.project);
  expect(orgAttributionFor(bridge, withSuffix!.project, null)?.project).toBe("viewer");
});
