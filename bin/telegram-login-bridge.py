#!/usr/bin/env python3
"""Viewer-owned Telegram enrollment bridge (issue #1059).

Runs from the same Telethon environment as the vendored connector
(vendor/telegram-mcp) and speaks a small sanitized NDJSON protocol:

  stdout events (one JSON object per line, nothing else ever printed here):
    {"event": "qr", "url": "tg://login?token=...", "expiresAt": iso}
    {"event": "code_required"}
    {"event": "code_invalid"}
    {"event": "flood_wait", "seconds": int}
    {"event": "password_required"}
    {"event": "password_invalid"}
    {"event": "verifying"}
    {"event": "authorized", "session": "<string session>", "identity": {...}}
    {"event": "health", "status": "connected"|"expired"|"error", ...}
    {"event": "logout", "ok": bool, "code": str|None}
    {"event": "failed", "code": "<sanitized code>"}

  stdin control lines:
    enroll:  {"password": "..."}          (only after password_required)
    phone:   {"code": "12345"}            (only after code_required)
             {"password": "..."}          (only after password_required)
    health:  {"session": "..."}           (first line)
    logout:  {"session": "..."}           (first line)

The session string crosses ONLY these pipes: it is never an argument, never an
environment variable of this process, and never part of an error event. Every
failure is reduced to a sanitized code — raw exception text stays off stdout.
Telegram API credentials arrive as TELEGRAM_API_ID / TELEGRAM_API_HASH in the
environment, exactly as the vendored connector expects.

The PHONE number is the one login input that cannot travel over stdin — the
client needs it before it can ask Telegram for anything — so it is an argument
(`phone --phone=+…`). A number is not a credential: it grants nothing without
the code Telegram sends to the device, and the code and the 2FA password stay
on stdin like every other secret here. Nothing echoes any of the three back:
the events above carry a state, never a value.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import os
import re
import sys

try:
    from telethon import TelegramClient
    from telethon.errors import (
        AuthKeyDuplicatedError,
        AuthKeyUnregisteredError,
        FloodWaitError,
        PasswordHashInvalidError,
        PhoneCodeInvalidError,
        PhoneNumberInvalidError,
        SessionPasswordNeededError,
        SessionRevokedError,
    )
    from telethon.sessions import StringSession
    from telegram_mcp.singleton import SessionLock, session_identity
    TELETHON_AVAILABLE = True
except ImportError:
    # The bridge is normally run from the vendored connector's virtualenv, where
    # Telethon and telegram_mcp are both present. The guard exists so the half
    # of this file that is a STATE MACHINE — number, code, wrong code, 2FA
    # password, flood wait — stays importable and unit-testable outside that
    # environment. Everything that actually talks to Telegram refuses to run
    # (see `main`), so a missing Telethon can never be mistaken for a login.
    TELETHON_AVAILABLE = False
    TelegramClient = None  # type: ignore[assignment]
    StringSession = None  # type: ignore[assignment]
    SessionLock = None  # type: ignore[assignment]
    session_identity = None  # type: ignore[assignment]

    class _AbsentTelethonError(Exception):
        """Stands in for a Telethon error class so `except` clauses still parse.

        The fake client in the unit test raises THESE, because the module under
        test is the one that names them: whichever branch of the import ran,
        `bridge.PhoneCodeInvalidError` is the class this file catches.
        """

    class AuthKeyDuplicatedError(_AbsentTelethonError): pass
    class AuthKeyUnregisteredError(_AbsentTelethonError): pass
    class PasswordHashInvalidError(_AbsentTelethonError): pass
    class PhoneCodeInvalidError(_AbsentTelethonError): pass
    class PhoneNumberInvalidError(_AbsentTelethonError): pass
    class SessionPasswordNeededError(_AbsentTelethonError): pass
    class SessionRevokedError(_AbsentTelethonError): pass

    class FloodWaitError(_AbsentTelethonError):
        def __init__(self, seconds=0):
            super().__init__(seconds)
            self.seconds = seconds

# The whole enrollment self-terminates even if the supervisor dies: an orphaned
# bridge holding a half-done QR login must not linger with a live connection.
ENROLL_DEADLINE_S = 15 * 60
CONNECT_TIMEOUT_S = 30

DEVICE_MODEL = "Agent Log Viewer"
SESSION_LOCK_GRACE_S = 20.0


def emit(payload: dict) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def fail(code: str) -> None:
    emit({"event": "failed", "code": code})


def api_credentials() -> tuple[int, str]:
    return int(os.environ["TELEGRAM_API_ID"]), os.environ["TELEGRAM_API_HASH"]


def make_client(session: str | None) -> TelegramClient:
    api_id, api_hash = api_credentials()
    return TelegramClient(
        StringSession(session),
        api_id,
        api_hash,
        device_model=DEVICE_MODEL,
        app_version="1.0",
    )


async def acquire_session_lock(client: TelegramClient) -> SessionLock:
    """Share the connector's exact per-session exclusion boundary."""
    lock = SessionLock("default", session_identity(client))
    await asyncio.to_thread(lock.acquire, grace_seconds=SESSION_LOCK_GRACE_S)
    return lock


def identity_of(user) -> dict:
    name = " ".join(part for part in [user.first_name, user.last_name] if part) or "Telegram account"
    # The numeric account id (issue #1091): names and handles are the operator's
    # to change at any moment, so the id is what "the same account" means to the
    # report-run verifier. A string, because a Telegram id is a 64-bit integer.
    # Read defensively: an authorization that produced an entity without an id
    # is still an authorization, and losing the login over a grouping field
    # would be a far worse failure than reporting no id.
    account_id = getattr(user, "id", None)
    return {
        "name": name,
        "username": user.username or None,
        "id": str(account_id) if isinstance(account_id, int) else None,
    }


async def read_stdin_line() -> dict | None:
    loop = asyncio.get_running_loop()
    line = await loop.run_in_executor(None, sys.stdin.readline)
    if not line:
        return None
    try:
        parsed = json.loads(line)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def sign_in_with_password(client, *, emit=emit, read_line=read_stdin_line) -> object | None:
    """2FA loop: each invalid password is reported and another one awaited.

    `emit` and `read_line` are parameters so the loop can be driven by a
    transcript in the unit test; production passes neither.
    """
    emit({"event": "password_required"})
    while True:
        control = await read_line()
        if control is None:
            return None
        entered = control.get("password")
        if not isinstance(entered, str) or not entered:
            continue
        try:
            return await client.sign_in(password=entered)
        except PasswordHashInvalidError:
            emit({"event": "password_invalid"})


# Telegram rate-limits a number that keeps getting its code wrong, and the
# limit is measured in hours. Three tries is the same budget the official
# clients give before they make you request a new code, and stopping there
# leaves the operator able to try again in a minute instead of tomorrow.
MAX_CODE_ATTEMPTS = 3

# E.164 as Telegram accepts it: a leading +, a non-zero country digit, and up
# to fifteen digits in total. Checked here so a typo is refused before it costs
# a code request — and so nothing but digits ever reaches argv.
E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def phone_argument(argv: list[str]) -> str | None:
    """The `--phone` value out of the argument list, or None if it is unusable.

    Both spellings are read (`--phone=+…` and `--phone +…`) because the two are
    equally natural to type and the difference is not worth a failure mode.
    """
    for index, item in enumerate(argv):
        value = None
        if item.startswith("--phone="):
            value = item[len("--phone="):]
        elif item == "--phone" and index + 1 < len(argv):
            value = argv[index + 1]
        if value is not None:
            return value if E164.match(value) else None
    return None


async def sign_in_with_phone(client, phone: str, *, emit=emit, read_line=read_stdin_line) -> object | None:
    """Number → code → optional 2FA password.

    Returns the signed-in user, or None when the attempt is over — in which
    case the reason has ALREADY been emitted (`flood_wait`, `code_invalid` via
    `failed`, `phone_invalid`), except for a closed stdin, which is the
    supervisor cancelling and needs no event of its own.
    """
    try:
        await client.send_code_request(phone)
    except FloodWaitError as wait:
        emit({"event": "flood_wait", "seconds": int(getattr(wait, "seconds", 0) or 0)})
        return None
    except PhoneNumberInvalidError:
        fail_with(emit, "phone_invalid")
        return None

    emit({"event": "code_required"})
    attempts = 0
    while True:
        control = await read_line()
        if control is None:
            return None
        entered = control.get("code")
        # A line that carries no usable code is noise, not a wrong code: it must
        # not spend one of the three tries Telegram will tolerate.
        if not isinstance(entered, str) or not entered:
            continue
        try:
            return await client.sign_in(phone, entered)
        except SessionPasswordNeededError:
            return await sign_in_with_password(client, emit=emit, read_line=read_line)
        except PhoneCodeInvalidError:
            attempts += 1
            if attempts >= MAX_CODE_ATTEMPTS:
                fail_with(emit, "code_invalid")
                return None
            emit({"event": "code_invalid"})
        except FloodWaitError as wait:
            emit({"event": "flood_wait", "seconds": int(getattr(wait, "seconds", 0) or 0)})
            return None


def fail_with(emit_event, code: str) -> None:
    emit_event({"event": "failed", "code": code})


async def enroll() -> None:
    client = make_client(None)
    lock = None
    await client.connect()
    try:
        qr = await client.qr_login()
        user = None
        while user is None:
            expires_in = max(5.0, (qr.expires - datetime.datetime.now(datetime.timezone.utc)).total_seconds())
            emit({"event": "qr", "url": qr.url, "expiresAt": qr.expires.isoformat()})
            try:
                user = await qr.wait(timeout=expires_in)
            except asyncio.TimeoutError:
                # Expired token: mint a fresh one and re-announce it.
                await qr.recreate()
            except SessionPasswordNeededError:
                user = await sign_in_with_password(client)
                if user is None:
                    fail("canceled")
                    return
        emit({"event": "verifying"})
        me = await client.get_me()
        lock = await acquire_session_lock(client)
        emit({
            "event": "authorized",
            "session": client.session.save(),
            "identity": identity_of(me if me is not None else user),
        })
    finally:
        await client.disconnect()
        if lock is not None:
            lock.release()


async def enroll_by_phone(phone: str) -> None:
    """The QR flow's twin for a phone that cannot scan a code shown on itself.

    Everything after the sign-in is deliberately identical to `enroll`: the same
    `verifying`, the same per-session lock, the same `authorized` event with the
    same session string and identity — so one credential store and one service
    read both flows without knowing which one produced the session.
    """
    client = make_client(None)
    lock = None
    await client.connect()
    try:
        user = await sign_in_with_phone(client, phone)
        if user is None:
            return
        emit({"event": "verifying"})
        me = await client.get_me()
        lock = await acquire_session_lock(client)
        emit({
            "event": "authorized",
            "session": client.session.save(),
            "identity": identity_of(me if me is not None else user),
        })
    finally:
        await client.disconnect()
        if lock is not None:
            lock.release()


async def health() -> None:
    control = await read_stdin_line()
    session = control.get("session") if control else None
    if not isinstance(session, str) or not session:
        emit({"event": "health", "status": "error", "code": "bridge_failed"})
        return
    client = make_client(session)
    lock = None
    try:
        lock = await acquire_session_lock(client)
        await asyncio.wait_for(client.connect(), timeout=CONNECT_TIMEOUT_S)
        try:
            if not await client.is_user_authorized():
                emit({"event": "health", "status": "expired"})
                return
            me = await client.get_me()
            if me is None:
                emit({"event": "health", "status": "expired"})
                return
            emit({"event": "health", "status": "connected", "identity": identity_of(me)})
        finally:
            await client.disconnect()
    except (AuthKeyUnregisteredError, AuthKeyDuplicatedError, SessionRevokedError):
        emit({"event": "health", "status": "expired"})
    except (asyncio.TimeoutError, ConnectionError, OSError):
        emit({"event": "health", "status": "error", "code": "network_failed"})
    except Exception:
        emit({"event": "health", "status": "error", "code": "bridge_failed"})
    finally:
        if lock is not None:
            lock.release()


async def logout() -> None:
    control = await read_stdin_line()
    session = control.get("session") if control else None
    if not isinstance(session, str) or not session:
        emit({"event": "logout", "ok": False, "code": "bridge_failed"})
        return
    client = make_client(session)
    lock = None
    try:
        lock = await acquire_session_lock(client)
        await asyncio.wait_for(client.connect(), timeout=CONNECT_TIMEOUT_S)
        ok = bool(await client.log_out())
        emit({"event": "logout", "ok": ok, "code": None if ok else "logout_failed"})
    except (AuthKeyUnregisteredError, AuthKeyDuplicatedError, SessionRevokedError):
        # Telegram already considers the authorization gone: remote logout is done.
        emit({"event": "logout", "ok": True, "code": None})
    except (asyncio.TimeoutError, ConnectionError, OSError):
        emit({"event": "logout", "ok": False, "code": "network_failed"})
    except Exception:
        emit({"event": "logout", "ok": False, "code": "bridge_failed"})
    finally:
        try:
            await client.disconnect()
        finally:
            if lock is not None:
                lock.release()


async def run(command: str, argv: list[str] | None = None) -> None:
    if command == "enroll":
        try:
            await asyncio.wait_for(enroll(), timeout=ENROLL_DEADLINE_S)
        except asyncio.TimeoutError:
            fail("timed_out")
        except (ConnectionError, OSError):
            fail("network_failed")
        except Exception:
            fail("bridge_failed")
    elif command == "phone":
        phone = phone_argument(argv or [])
        if phone is None:
            fail("phone_invalid")
            return
        try:
            await asyncio.wait_for(enroll_by_phone(phone), timeout=ENROLL_DEADLINE_S)
        except asyncio.TimeoutError:
            fail("timed_out")
        except (ConnectionError, OSError):
            fail("network_failed")
        except Exception:
            fail("bridge_failed")
    elif command == "health":
        await health()
    elif command == "logout":
        await logout()
    else:
        fail("bridge_failed")


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    # A bridge without Telethon can only pretend, and pretending here would read
    # as a failed login rather than as a broken install. Say so and stop.
    if not TELETHON_AVAILABLE:
        fail("bridge_failed")
        sys.exit(1)
    if "TELEGRAM_API_ID" not in os.environ or "TELEGRAM_API_HASH" not in os.environ:
        fail("credentials_missing")
        sys.exit(1)
    asyncio.run(run(command, sys.argv[1:]))


if __name__ == "__main__":
    main()
