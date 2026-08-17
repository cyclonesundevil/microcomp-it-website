import os
import re
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

with tempfile.TemporaryDirectory() as import_data_dir:
    os.environ["ANALYTICS_DB_PATH"] = str(Path(import_data_dir) / "import.db")
    import app as app_module
    from app import app, sanitized_analytics_path, sanitized_referrer


class ContactPrivacyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = str(Path(self.temp_dir.name) / "analytics.db")
        os.environ["ANALYTICS_DB_PATH"] = self.db_path
        self.client = app.test_client()
        self.turnstile_patcher = patch.object(app_module, "turnstile_enabled", return_value=False)
        self.turnstile_patcher.start()

    async def asyncTearDown(self):
        self.turnstile_patcher.stop()
        self.temp_dir.cleanup()

    def test_sanitizers_remove_query_values_and_fragments(self):
        self.assertEqual(
            sanitized_analytics_path("/index.html?name=Someone&message=Private#contact"),
            "/index.html",
        )
        self.assertEqual(
            sanitized_referrer("https://microcompit.com/index.html?email=private@example.com"),
            "https://microcompit.com/index.html",
        )

    async def test_pageview_stores_only_the_path(self):
        response = await self.client.get(
            "/index.html?name=Someone&email=private%40example.com&message=Private"
        )
        self.assertEqual(response.status_code, 200)

        conn = sqlite3.connect(self.db_path)
        try:
            stored_path = conn.execute(
                "SELECT path FROM visitors WHERE event_type = 'pageview' ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(stored_path, "/index.html")

    async def test_native_submission_is_audited_without_message_contents(self):
        response = await self.client.post(
            "/api/contact",
            form={
                "name": "Automated Sender",
                "email": "sender@example.net",
                "message": "A solicitation with private message contents.",
                "website": "",
                "started_at": "",
            },
            headers={"User-Agent": "Mozilla/5.0"},
        )
        self.assertEqual(response.status_code, 200)

        conn = sqlite3.connect(self.db_path)
        try:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(contact_events)")]
            event = conn.execute(
                "SELECT status, source, detail, email_domain FROM contact_events ORDER BY id DESC LIMIT 1"
            ).fetchone()
        finally:
            conn.close()

        self.assertNotIn("message", columns)
        self.assertNotIn("name", columns)
        self.assertNotIn("email", columns)
        self.assertEqual(
            event,
            ("filtered", "native_form", "missing_or_invalid_start_time", "example.net"),
        )

    async def test_valid_json_submission_requires_email_verification_then_acknowledges(self):
        previous_values = {
            name: os.environ.get(name)
            for name in ("SMTP_EMAIL", "SMTP_PASSWORD", "CONTACT_EMAIL_RECEIVER", "DISCORD_WEBHOOK_URL")
        }
        os.environ["SMTP_EMAIL"] = "sender@microcompit.com"
        os.environ["SMTP_PASSWORD"] = "not-a-real-password"
        os.environ["CONTACT_EMAIL_RECEIVER"] = "owner@microcompit.com"
        os.environ.pop("DISCORD_WEBHOOK_URL", None)

        try:
            with patch.object(app_module.smtplib, "SMTP") as smtp:
                response = await self.client.post(
                    "/api/contact",
                    json={
                        "name": "Prospective Client",
                        "email": "customer@acme-corp.com",
                        "message": "Please contact me about a consulting engagement.",
                        "website": "",
                        "started_at": str(int(time.time() * 1000) - 5_000),
                    },
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                self.assertEqual(response.status_code, 202)
                response_data = await response.get_json()
                self.assertTrue(response_data["verificationPending"])

                smtp_server = smtp.return_value.__enter__.return_value
                self.assertEqual(smtp_server.send_message.call_count, 1)
                verification_email = smtp_server.send_message.call_args.args[0]
                self.assertEqual(verification_email["To"], "customer@acme-corp.com")
                verification_body = verification_email.get_payload()[0].get_payload(decode=True).decode()
                token_match = re.search(r"/api/contact/verify\?token=([^\s]+)", verification_body)
                self.assertIsNotNone(token_match)
                token = token_match.group(1)

                preview = await self.client.get(f"/api/contact/verify?token={token}")
                self.assertEqual(preview.status_code, 200)
                self.assertEqual(smtp_server.send_message.call_count, 1)

                verified = await self.client.post("/api/contact/verify", form={"token": token})
                self.assertEqual(verified.status_code, 200)
                self.assertEqual(smtp_server.send_message.call_count, 3)

                reused = await self.client.post("/api/contact/verify", form={"token": token})
                self.assertEqual(reused.status_code, 410)
                self.assertEqual(smtp_server.send_message.call_count, 3)

                staff_email = smtp_server.send_message.call_args_list[1].args[0]
                acknowledgement = smtp_server.send_message.call_args_list[2].args[0]
                self.assertEqual(staff_email["To"], "owner@microcompit.com")
                self.assertEqual(staff_email["Reply-To"], "customer@acme-corp.com")
                self.assertEqual(acknowledgement["To"], "customer@acme-corp.com")
        finally:
            for name, value in previous_values.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

        conn = sqlite3.connect(self.db_path)
        try:
            event = conn.execute(
                "SELECT status, source, detail, email_delivered, discord_delivered, "
                "acknowledgement_delivered, email_domain "
                "FROM contact_events ORDER BY id DESC LIMIT 1"
            ).fetchone()
            pending_count = conn.execute("SELECT COUNT(*) FROM pending_contact_submissions").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(
            event,
            ("verified_delivered", "json", "email+acknowledgement", 1, 0, 1, "acme-corp.com"),
        )
        self.assertEqual(pending_count, 0)


if __name__ == "__main__":
    unittest.main()
