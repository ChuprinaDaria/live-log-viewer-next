#!/usr/bin/python3
"""Rehearse packaged Viewer startup with an explicitly pinned runtime-host tree.

Build with LLV_STANDALONE=1 first. The package must contain bin/, dist/, public/
and .next/static as the shipped distribution does. All state and logs are new,
private files. No operator state, credentials, provider CLI or stable port is used.
"""
import argparse
import collections
import json
import os
from pathlib import Path
import socket
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--viewer", type=Path, required=True, help="immutable standalone package")
parser.add_argument("--runtime-source", type=Path, required=True, help="exact incumbent runtime-host source tree")
parser.add_argument("--bun", type=Path, required=True)
parser.add_argument("--codex-only", action="store_true", help="narrower contention control; does not qualify mixed-provider preservation")
parser.add_argument("--snapshot-delay-ms", type=int, default=0)
parser.add_argument("--rpc-delay-ms", type=int, default=0)
args = parser.parse_args()
assert 0 <= args.snapshot_delay_ms <= 3000 and 0 <= args.rpc_delay_ms <= 5
repo = Path(__file__).resolve().parents[1]
viewer, runtime_source, bun = args.viewer.resolve(), args.runtime_source.resolve(), args.bun.resolve()
assert subprocess.check_output([str(bun), "--version"], text=True).strip() == "1.4.0"
for file in [viewer / "server.js", viewer / "bin/mcp-server.mjs", viewer / "dist/mcp-server.mjs", runtime_source / "src/runtime-host/main.ts"]:
    assert file.is_file(), f"missing packaged prerequisite: {file.name}"
root = Path(tempfile.mkdtemp(prefix="llv-packaged-startup-", dir="/var/tmp"))
os.chmod(root, 0o700)
env = {"PATH": str(root / "bin") + ":/usr/bin:/bin", "NODE_ENV": "production", "NEXT_TELEMETRY_DISABLED": "1", "NEXT_PUBLIC_RUNTIME_UI": "1", "LLV_AGENT_REGISTRY_SQLITE": "sqlite"}
for key, directory in {"HOME": "home", "XDG_CONFIG_HOME": "config", "XDG_CACHE_HOME": "cache", "LLV_STATE_DIR": "state", "TMPDIR": "tmp", "CODEX_HOME": "codex", "LLV_CODEX_HOME": "codex", "CLAUDE_CONFIG_DIR": "claude", "LLV_CLAUDE_HOME": "claude"}.items():
    (root / directory).mkdir(mode=0o700, exist_ok=True)
    env[key] = str(root / directory)
(root / "bin").mkdir(mode=0o700)
(root / "bin/bun").symlink_to(bun)
(root / "sockets").mkdir(mode=0o700)
provider = str(root / "bin/provider")
shutil.copy2(repo / "src/lib/runtime/fixtures/packagedProvider.py", provider)
env.update({"LLV_CODEX_BINARY": provider, "LLV_CLAUDE_BINARY": provider, "LLV_PACKAGED_MIXED_ENGINES": "0" if args.codex_only else "1"})
with open(root / "seed.log", "w") as log:
    subprocess.run([str(bun), "src/lib/runtime/fixtures/packagedStartupSeed.ts"], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)

# A transparent local socket relay counts framing bytes and response times.
# Every request and reply still runs through the real incumbent host.
real_socket = str(root / "sockets/host.sock")
relay_socket = str(root / "sockets/viewer.sock")
metrics = collections.defaultdict(lambda: {"count": 0, "requestBytes": 0, "responseBytes": 0, "elapsedMs": 0, "maxMs": 0})
metrics_lock = threading.Lock()
relay_errors = []
listener = socket.socket(socket.AF_UNIX)
listener.bind(relay_socket)
listener.listen()
listener.settimeout(.2)
stopping = threading.Event()

def forward(peer):
    try:
        request = peer.makefile("rb").readline()
        method = json.loads(request)["method"]
        started = time.monotonic()
        time.sleep((args.snapshot_delay_ms if method == "snapshot" else args.rpc_delay_ms) / 1000)
        with socket.socket(socket.AF_UNIX) as upstream:
            upstream.connect(real_socket)
            upstream.sendall(request)
            response = upstream.makefile("rb").readline()
        elapsed = (time.monotonic() - started) * 1000
        with metrics_lock:
            item = metrics[method]
            item["count"] += 1
            item["requestBytes"] += len(request)
            item["responseBytes"] += len(response)
            item["elapsedMs"] += round(elapsed)
            item["maxMs"] = max(item["maxMs"], round(elapsed))
        peer.sendall(response)
    except (OSError, ValueError, KeyError) as error:
        with metrics_lock:
            relay_errors.append(type(error).__name__)
    finally:
        peer.close()

def relay():
    while not stopping.is_set():
        try:
            peer, _ = listener.accept()
            threading.Thread(target=forward, args=(peer,), daemon=True).start()
        except socket.timeout:
            pass

threading.Thread(target=relay, daemon=True).start()
with socket.socket() as reserved:
    reserved.bind(("127.0.0.1", 0))
    port = reserved.getsockname()[1]
env.update({"PORT": str(port), "HOSTNAME": "127.0.0.1", "LLV_VIEWER_PORT": str(port), "LLV_RUNTIME_HOST_SOCKET": real_socket})
logs = [open(root / "host.log", "w"), open(root / "viewer.log", "w")]
host = subprocess.Popen([str(bun), "src/runtime-host/main.ts"], cwd=runtime_source, env=env, stdout=logs[0], stderr=subprocess.STDOUT)
for _ in range(100):
    if Path(real_socket).exists():
        break
    if host.poll() is not None:
        raise RuntimeError("private runtime host failed to start")
    time.sleep(.1)
env["LLV_RUNTIME_HOST_SOCKET"] = relay_socket
app = subprocess.Popen([str(bun), str(viewer / "server.js")], cwd=viewer, env=env, stdout=logs[1], stderr=subprocess.STDOUT)
started = time.monotonic()
result = {"ready": False, "deadlineMs": 120000, "snapshotDelayMs": args.snapshot_delay_ms, "rpcDelayMs": args.rpc_delay_ms}
expected_keys = [("claude" if not args.codex_only and i >= 3 else "codex") + ":00000000-0000-4000-8000-" + str(i).zfill(12) for i in range(6)]
before_claims = None

def claims():
    filename = root / "state/agent-registry.sqlite"
    with sqlite3.connect(f"file:{filename}?mode=ro", uri=True) as db:
        return db.execute("SELECT row_key,json_extract(value_json,'$.accountId'),json_extract(value_json,'$.claimOwner'),json_extract(value_json,'$.claimEpoch'),json_extract(value_json,'$.structuredHost.process.pid'),json_extract(value_json,'$.structuredHost.process.startIdentity'),json_extract(value_json,'$.artifactPath') FROM registry_rows WHERE collection='entries' AND row_key IN (?,?,?,?,?,?) ORDER BY row_key", expected_keys).fetchall()
print(root, flush=True)
try:
    with open(root / "timeline.jsonl", "w") as timeline:
        # Continue observation after the unchanged 120s gate, without claiming
        # success or releasing the callback's lease at the deadline.
        while time.monotonic() - started < 480:
            before = time.monotonic()
            status = {}
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/runtime/deployments/capabilities/v1", timeout=2) as response:
                    status = json.load(response)
            except urllib.error.HTTPError as error:
                status = json.load(error)
            except (OSError, ValueError):
                pass
            leases = []
            database = root / "state/state.sqlite"
            if database.exists():
                with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as db:
                    leases = db.execute("SELECT collection,owner_pid,owner_start_identity,acquired_at FROM state_leases").fetchall()
            current_claims = claims()
            if before_claims is None and len(current_claims) == 6 and all(row[2] and row[4] and row[5] for row in current_claims):
                before_claims = current_claims
            elapsed = round((time.monotonic() - started) * 1000)
            timeline.write(json.dumps({"elapsedMs": elapsed, "probeMs": round((time.monotonic() - before) * 1000), "status": status, "leases": leases}) + "\n")
            timeline.flush()
            if status.get("structuredHostStartup", {}).get("state") == "ready":
                with sqlite3.connect(f"file:{root / 'state/agent-registry.sqlite'}?mode=ro", uri=True) as db:
                    hosted = db.execute("SELECT count(*) FROM registry_rows WHERE collection='entries' AND json_extract(value_json,'$.structuredHost.process') IS NOT NULL").fetchone()[0]
                contender = subprocess.run([str(bun), "src/lib/runtime/fixtures/startupPipelineContender.ts", str(root / "state")], cwd=repo, env=env, capture_output=True, text=True)
                with sqlite3.connect(f"file:{root / 'state/runtime-events.sqlite'}?mode=ro", uri=True) as db:
                    sends = db.execute("SELECT json_extract(receipt_json,'$.status'),count(*) FROM operations WHERE idempotency_key LIKE 'queued-startup-%' GROUP BY 1").fetchall()
                (root / "ownership.json").write_text(json.dumps({"before": before_claims, "after": current_claims}, indent=2))
                result.update({"ready": True, "elapsedMs": elapsed, "hosted": hosted, "queuedSends": dict(sends), "ownershipPreserved": before_claims is not None and current_claims == before_claims, "creation": json.loads(contender.stdout), "creationExit": contender.returncode})
                break
            time.sleep(.25)
finally:
    # Only child handles created above; no process enumeration or live signals.
    app.terminate()
    host.terminate()
    for child in [app, host]:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            result.setdefault("unsettledPrivateChildren", []).append(child.pid)
    stopping.set()
    listener.close()
    with metrics_lock:
        result["rpc"] = dict(metrics)
        result["relayErrors"] = dict(collections.Counter(relay_errors))
    (root / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
raise SystemExit(0 if result.get("ready") and result["elapsedMs"] < result["deadlineMs"] and result.get("hosted") == 6 and result.get("ownershipPreserved") is True and result.get("creation", {}).get("created") else 1)
