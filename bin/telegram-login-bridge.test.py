#!/usr/bin/env python3
"""The phone-login state machine of the enrollment bridge, on a fake client.

Run it directly (`python3 bin/telegram-login-bridge.test.py`) or through the
unittest CLI (`python3 -m unittest discover -s bin -p '*.test.py' -t bin`).

Telethon is NOT installed where this runs, and that is the point: the bridge
guards its imports so the half that is a state machine — number, code, wrong
code, 2FA password, flood wait — can be exercised without a network, without
the vendored connector's virtualenv, and above all without a real account. The
phone number below is the reserved all-zero test range, never a real one.
"""

from __future__ import annotations

import asyncio
import importlib.util
import pathlib
import sys
import unittest

BRIDGE_PATH = pathlib.Path(__file__).with_name("telegram-login-bridge.py")

_spec = importlib.util.spec_from_file_location("telegram_login_bridge", BRIDGE_PATH)
assert _spec and _spec.loader
bridge = importlib.util.module_from_spec(_spec)
sys.modules["telegram_login_bridge"] = bridge
_spec.loader.exec_module(bridge)

PHONE = "+10000000000"


class FakeClient:
    """Scripted Telethon surface: what each call does is set by the test."""

    def __init__(self, *, send_code=None, sign_in_results=None, password_results=None):
        self.send_code = send_code
        self.sign_in_results = list(sign_in_results or [])
        self.password_results = list(password_results or [])
        self.codes: list[str] = []
        self.passwords: list[str] = []
        self.phones: list[str] = []

    async def send_code_request(self, phone):
        self.phones.append(phone)
        if isinstance(self.send_code, Exception):
            raise self.send_code
        return object()

    async def sign_in(self, phone=None, code=None, password=None):
        if password is not None:
            self.passwords.append(password)
            outcome = self.password_results.pop(0)
        else:
            self.codes.append(code)
            outcome = self.sign_in_results.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class Transcript:
    """The stdout events, and the control lines the operator sends back."""

    def __init__(self, lines):
        self.events: list[dict] = []
        self.lines = list(lines)

    def emit(self, payload):
        self.events.append(payload)

    async def read_line(self):
        return self.lines.pop(0) if self.lines else None

    def codes(self):
        return [event["event"] for event in self.events]


def run(client, transcript, phone=PHONE):
    return asyncio.run(
        bridge.sign_in_with_phone(client, phone, emit=transcript.emit, read_line=transcript.read_line)
    )


class PhoneLoginTest(unittest.TestCase):
    def test_number_then_code_signs_in(self):
        user = object()
        client = FakeClient(sign_in_results=[user])
        transcript = Transcript([{"code": "12345"}])

        self.assertIs(run(client, transcript), user)
        self.assertEqual(client.phones, [PHONE])
        self.assertEqual(client.codes, ["12345"])
        self.assertEqual(transcript.codes(), ["code_required"])

    def test_a_wrong_code_is_reported_and_another_awaited(self):
        user = object()
        client = FakeClient(sign_in_results=[bridge.PhoneCodeInvalidError(None), user])
        transcript = Transcript([{"code": "11111"}, {"code": "22222"}])

        self.assertIs(run(client, transcript), user)
        self.assertEqual(client.codes, ["11111", "22222"])
        self.assertEqual(transcript.codes(), ["code_required", "code_invalid"])

    def test_three_wrong_codes_end_the_attempt(self):
        client = FakeClient(sign_in_results=[bridge.PhoneCodeInvalidError(None)] * 3)
        transcript = Transcript([{"code": "11111"}, {"code": "22222"}, {"code": "33333"}])

        self.assertIsNone(run(client, transcript))
        self.assertEqual(len(client.codes), 3)
        self.assertEqual(transcript.codes(), ["code_required", "code_invalid", "code_invalid", "failed"])
        self.assertEqual(transcript.events[-1]["code"], "code_invalid")

    def test_a_malformed_control_line_does_not_burn_an_attempt(self):
        user = object()
        client = FakeClient(sign_in_results=[user])
        transcript = Transcript([{"code": ""}, {"nothing": True}, {"code": "12345"}])

        self.assertIs(run(client, transcript), user)
        self.assertEqual(client.codes, ["12345"])

    def test_two_step_verification_asks_for_the_password(self):
        user = object()
        client = FakeClient(
            sign_in_results=[bridge.SessionPasswordNeededError(None)],
            password_results=[user],
        )
        transcript = Transcript([{"code": "12345"}, {"password": "fixture-2fa"}])

        self.assertIs(run(client, transcript), user)
        self.assertEqual(client.passwords, ["fixture-2fa"])
        self.assertEqual(transcript.codes(), ["code_required", "password_required"])

    def test_a_wrong_password_is_reported_and_another_awaited(self):
        user = object()
        client = FakeClient(
            sign_in_results=[bridge.SessionPasswordNeededError(None)],
            password_results=[bridge.PasswordHashInvalidError(None), user],
        )
        transcript = Transcript([
            {"code": "12345"},
            {"password": "wrong-one"},
            {"password": "fixture-2fa"},
        ])

        self.assertIs(run(client, transcript), user)
        self.assertEqual(transcript.codes(), ["code_required", "password_required", "password_invalid"])

    def test_flood_wait_on_the_code_request_reports_the_seconds(self):
        client = FakeClient(send_code=bridge.FloodWaitError(86))
        transcript = Transcript([])

        self.assertIsNone(run(client, transcript))
        self.assertEqual(transcript.codes(), ["flood_wait"])
        self.assertEqual(transcript.events[0]["seconds"], 86)
        self.assertEqual(client.codes, [])

    def test_flood_wait_while_signing_in_reports_the_seconds(self):
        client = FakeClient(sign_in_results=[bridge.FloodWaitError(30)])
        transcript = Transcript([{"code": "12345"}])

        self.assertIsNone(run(client, transcript))
        self.assertEqual(transcript.codes(), ["code_required", "flood_wait"])
        self.assertEqual(transcript.events[-1]["seconds"], 30)

    def test_an_unusable_number_fails_before_any_code(self):
        client = FakeClient(send_code=bridge.PhoneNumberInvalidError(None))
        transcript = Transcript([])

        self.assertIsNone(run(client, transcript))
        self.assertEqual(transcript.codes(), ["failed"])
        self.assertEqual(transcript.events[0]["code"], "phone_invalid")

    def test_closed_stdin_cancels_without_an_event(self):
        client = FakeClient(sign_in_results=[])
        transcript = Transcript([])

        self.assertIsNone(run(client, transcript))
        self.assertEqual(transcript.codes(), ["code_required"])

    def test_no_event_ever_carries_the_number_the_code_or_the_password(self):
        user = object()
        client = FakeClient(
            sign_in_results=[bridge.SessionPasswordNeededError(None)],
            password_results=[bridge.PasswordHashInvalidError(None), user],
        )
        transcript = Transcript([
            {"code": "12345"},
            {"password": "wrong-one"},
            {"password": "fixture-2fa"},
        ])
        run(client, transcript)

        printed = repr(transcript.events)
        for secret in (PHONE, "12345", "wrong-one", "fixture-2fa"):
            self.assertNotIn(secret, printed)


class PhoneArgumentTest(unittest.TestCase):
    def test_the_number_is_read_from_either_argument_form(self):
        self.assertEqual(bridge.phone_argument(["phone", "--phone=+10000000000"]), PHONE)
        self.assertEqual(bridge.phone_argument(["phone", "--phone", "+10000000000"]), PHONE)
        self.assertIsNone(bridge.phone_argument(["phone"]))
        self.assertIsNone(bridge.phone_argument(["phone", "--phone="]))

    def test_a_number_that_is_not_e164_is_refused(self):
        self.assertIsNone(bridge.phone_argument(["phone", "--phone=not a number"]))
        self.assertIsNone(bridge.phone_argument(["phone", "--phone=0000000000"]))


if __name__ == "__main__":
    unittest.main()
