import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.update(
    FIREBASE_PROJECT_ID="test",
    FIREBASE_SERVICE_ACCOUNT_JSON_PATH="unused",
    RETHAVO_ENV="missing-test.env",
)
with patch(
    "google.oauth2.service_account.Credentials.from_service_account_file",
    return_value=MagicMock(),
):
    from rethavo_worker import firebase, jobs, recipients, signals


class Signals(unittest.TestCase):
    def setUp(self):
        signals.signal_state.clear()
        signals.inflight_signals.clear()
        signals.next_firestore_scan_monotonic = 0

    def test_failed_scan_is_bounded_over_day(self):
        with (
            patch.object(signals, "FIRESTORE_FALLBACK_SCAN_INTERVAL_SECONDS", 1800),
            patch.object(signals, "run_collection_query", side_effect=OSError) as query,
            patch.object(signals.logging, "exception"),
            patch.object(signals.time, "monotonic") as clock,
        ):
            for second in range(86400):
                clock.return_value = second
                signals.recover_orphan_jobs()
        self.assertEqual(query.call_count, 48)

    def test_empty_queue_does_not_poll_firestore_every_tick(self):
        with (
            patch.object(signals, "FIRESTORE_FALLBACK_SCAN_INTERVAL_SECONDS", 1800),
            patch.object(signals, "run_collection_query", return_value=[]) as query,
            patch.object(signals.time, "monotonic") as clock,
            patch.object(signals, "get_document") as get,
        ):
            for second in range(3600):
                clock.return_value = second
                signals.recover_orphan_jobs()
                signals.process_due_signals()
        self.assertEqual(query.call_count, 2)
        get.assert_not_called()

    def test_patch_root_does_not_remove_other_jobs(self):
        signals.handle_stream_event(
            {"path": "/", "data": {"a": {"jobId": "a"}, "b": {"jobId": "b"}}}
        )
        signals.handle_stream_event(
            {"path": "/", "data": {"a": {"dueAtClient": 42}}}, "patch"
        )
        self.assertEqual(signals.signal_state["a"], {"jobId": "a", "dueAtClient": 42})
        self.assertIn("b", signals.signal_state)

    def test_nested_patch_and_delete(self):
        signals.handle_stream_event({"path": "/a", "data": {"jobId": "a"}})
        signals.handle_stream_event({"path": "/a/dueAtClient", "data": 100})
        self.assertEqual(signals.signal_state["a"]["dueAtClient"], 100)
        signals.handle_stream_event({"path": "/a", "data": None})
        self.assertNotIn("a", signals.signal_state)

    def test_reconnect_preserves_inflight_and_synthetic(self):
        signals.signal_state["firestore:a"] = {"jobId": "a"}
        signals.inflight_signals.add("b")
        signals.handle_stream_event({"path": "/", "data": {}})
        self.assertIn("firestore:a", signals.signal_state)
        self.assertIn("b", signals.inflight_signals)

    def test_failed_signal_delete_retains_for_retry(self):
        signals.signal_state["a"] = {"jobId": "a"}
        with patch.object(signals, "rtdb_delete", side_effect=OSError):
            with self.assertRaises(OSError):
                signals.remove_signal("a")
        self.assertIn("a", signals.signal_state)

    def test_synthetic_signal_never_written_to_rtdb(self):
        with patch.object(signals, "rtdb_delete") as delete:
            signals.remove_signal("firestore:a")
            delete.assert_not_called()

    def test_failed_ack_does_not_resurrect_completed_job(self):
        job = {"id": "a", "_document_name": "jobs/a", "status": "PENDING"}
        with (
            patch.object(signals, "get_document", return_value=job),
            patch.object(signals, "process_job"),
            patch.object(signals, "remove_signal", side_effect=OSError),
            patch.object(signals, "mark_job") as mark,
        ):
            with self.assertRaises(OSError):
                signals.process_signal("a", {"jobId": "a"})
            mark.assert_not_called()

    def test_stale_processing_is_recovered_but_active_is_not(self):
        for age, expected in [(901000, 1), (1000, 0)]:
            job = {
                "id": "a",
                "_document_name": "jobs/a",
                "status": "PROCESSING",
                "processingStartedAtClient": 1000000 - age,
            }
            with (
                patch.object(signals, "get_document", return_value=job),
                patch.object(signals, "now_ms", return_value=1000000),
                patch.object(signals, "process_job") as process,
                patch.object(signals, "remove_signal"),
            ):
                signals.process_signal("a", {"jobId": "a"})
                self.assertEqual(process.call_count, expected)

    def test_poison_timestamp_does_not_block_other_signals(self):
        signals.signal_state.update(a={"dueAtClient": "bad"}, b={"dueAtClient": 0})
        self.assertEqual(len(signals.acquire_due_signals()), 2)

    def test_batch_failure_releases_all_and_processes_other_jobs(self):
        signals.signal_state.update(a={"jobId": "a"}, b={"jobId": "b"})
        with patch.object(
            signals, "process_signal", side_effect=[OSError, None]
        ) as process:
            signals.process_due_signals()
        self.assertEqual(process.call_count, 2)
        self.assertFalse(signals.inflight_signals)
        self.assertGreater(signals.signal_state["a"]["dueAtClient"], signals.now_ms())

    def test_shutdown_releases_unprocessed_batch(self):
        signals.signal_state.update(a={"jobId": "a"}, b={"jobId": "b"})
        with patch.object(signals.stop_event, "is_set", return_value=True):
            signals.process_due_signals()
        self.assertFalse(signals.inflight_signals)
        self.assertEqual(set(signals.signal_state), {"a", "b"})


class Deliveries(unittest.TestCase):
    def test_both_site_lock_flags_restrict_notification_delivery(self):
        for gate in [
            {},
            {"maintenanceEnabled": False, "errorEnabled": False},
            {"maintenanceEnabled": True},
            {"errorEnabled": True},
            {"maintenanceEnabled": True, "errorEnabled": True},
        ]:
            with self.subTest(gate=gate), patch.object(jobs, "get_app_gate", return_value=gate):
                self.assertEqual(
                    jobs.is_maintenance_enabled(),
                    bool(gate.get("maintenanceEnabled") or gate.get("errorEnabled")),
                )

    def test_technical_failure_delivers_only_to_privileged_users(self):
        job = {
            "id": "locked-site",
            "_document_name": "jobs/locked-site",
            "title": "Test",
            "body": "Body",
            "audience": "users",
            "targetUserIds": ["resident", "admin", "tester"],
            "sendEmail": True,
            "sendPush": True,
        }
        privileged = [
            {"id": "admin", "role": "ADMIN", "email": "admin@example.test"},
            {"id": "tester", "role": "TESTER", "email": "tester@example.test"},
        ]
        with (
            patch.object(jobs, "get_app_gate", return_value={"errorEnabled": True}),
            patch.object(jobs, "get_maintenance_allowed_users", return_value=privileged),
            patch.object(jobs, "ENABLE_FCM_PUSH", False),
            patch.object(jobs, "DELETE_DONE_JOBS", False),
            patch.object(jobs, "mark_job") as mark,
            patch.object(jobs, "progress"),
            patch.object(jobs, "collect_web_push_subscriptions", return_value=[]) as collect,
            patch.object(jobs, "should_send_event_email", return_value=True),
            patch.object(jobs, "collect_recipient_emails", return_value=["resident@example.test", "admin@example.test"]),
            patch.object(jobs, "resend_email") as email,
        ):
            jobs.process_job(job)
        collect.assert_called_once_with("users", ["admin", "tester"], [], "events", "events")
        email.assert_called_once()
        self.assertEqual(email.call_args.args[0], "admin@example.test")
        self.assertTrue(any(call.kwargs.get("status") == "DONE" for call in mark.call_args_list))

    def test_broken_push_recipient_does_not_block_healthy_recipient(self):
        job = {
            "id": "a",
            "_document_name": "jobs/a",
            "title": "Test",
            "body": "Body",
            "sendEmail": False,
            "sendPush": True,
        }
        updates = []
        with (
            patch.object(jobs, "is_maintenance_enabled", return_value=False),
            patch.object(jobs, "ENABLE_FCM_PUSH", False),
            patch.object(
                jobs,
                "collect_web_push_subscriptions",
                return_value=[{"endpoint": "broken"}, {"endpoint": "healthy"}],
            ),
            patch.object(
                jobs, "send_web_push", side_effect=[ValueError, {"ok": True}]
            ) as send,
            patch.object(
                jobs, "mark_job", side_effect=lambda _, **kw: updates.append(kw)
            ),
            patch.object(jobs, "progress"),
        ):
            with self.assertRaises(RuntimeError):
                jobs.process_job(job)
        self.assertEqual(send.call_count, 2)
        self.assertTrue(any(u.get("deliveryReceipts") for u in updates))
        self.assertFalse(any(u.get("status") == "DONE" for u in updates))

    def test_account_cleanup_refreshes_cached_user_profiles(self):
        job = {
            "id": "cleanup",
            "_document_name": "jobs/cleanup",
            "title": "Cleanup",
            "body": "Body",
            "createdById": "admin",
            "cleanupWebPushUserId": "deleted",
            "sendEmail": False,
            "sendPush": False,
        }
        with (
            patch.object(jobs, "is_maintenance_enabled", return_value=False),
            patch.object(jobs, "get_document", return_value={"role": "ADMIN"}),
            patch.object(jobs, "delete_web_push_subscriptions_for_user", return_value=0),
            patch.object(jobs, "invalidate_collection_cache") as invalidate,
            patch.object(jobs, "mark_job"),
            patch.object(jobs, "DELETE_DONE_JOBS", False),
        ):
            jobs.process_job(job)
        invalidate.assert_called_once_with(jobs.USER_COLLECTION)

    def test_email_template_escapes_untrusted_text(self):
        from rethavo_worker.templates import email_html

        html = email_html("<b>Title</b>", "<script>alert(1)</script>\nNext")
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&lt;b&gt;Title&lt;/b&gt;", html)
        self.assertIn("<br>Next", html)

    def test_push_length_is_limited_in_utf8_bytes(self):
        from rethavo_worker.channels import push_text

        text = "Привет 👋 " * 1000
        result = push_text(text, 2048)
        self.assertLessEqual(len(result.encode("utf-8")), 2048)
        self.assertTrue(result.endswith("…"))
        self.assertEqual(push_text("Коротко", 2048), "Коротко")

    def test_partial_email_failure_retries_only_remaining_recipient(self):
        job = {
            "id": "a",
            "_document_name": "jobs/a",
            "title": "Test",
            "body": "Body",
            "audience": "emails",
            "sendEmail": True,
            "sendPush": False,
            "emailTargets": ["a@example.com", "b@example.com"],
        }
        updates = []

        def mark(_, **fields):
            updates.append(fields)
            job.update(fields)

        with (
            patch.object(jobs, "is_maintenance_enabled", return_value=False),
            patch.object(jobs, "mark_job", side_effect=mark),
            patch.object(jobs, "progress"),
            patch.object(jobs, "DELETE_DONE_JOBS", False),
        ):
            with patch.object(
                jobs, "resend_email", side_effect=[None, OSError]
            ) as send:
                with self.assertRaises(RuntimeError):
                    jobs.process_job(job)
                self.assertEqual(send.call_count, 2)
                self.assertFalse(any(u.get("status") == "DONE" for u in updates))
            with patch.object(jobs, "resend_email") as send:
                jobs.process_job(job)
                self.assertEqual(send.call_count, 1)
                self.assertEqual(send.call_args.args[0], "b@example.com")
                self.assertEqual(job["status"], "DONE")

    def test_codec_roundtrip(self):
        value = {"a": [True, 1, 1.5, None, "text"], "b": {"key": "value"}}
        self.assertEqual(
            firebase.decode_firestore_value(firebase.encode_firestore_value(value)),
            value,
        )

    def test_mentions_and_verification_preferences(self):
        self.assertEqual(
            recipients.notification_preference_key("mention", "chat"), "mentions"
        )
        self.assertEqual(
            recipients.notification_preference_key("verification", "auth"), "system"
        )


class RequestBudget(unittest.TestCase):
    def test_quota_response_blocks_requests_until_cooldown(self):
        from rethavo_worker import transport

        transport._cooldowns.clear()
        response = MagicMock(status_code=429, headers={"Retry-After": "1"})
        client = MagicMock()
        client.request.return_value = response
        with (
            patch.object(transport, "session", return_value=client),
            patch.object(transport, "_record"),
            patch.object(transport, "progress"),
            patch.object(transport.time, "monotonic", return_value=100) as clock,
        ):
            transport.get("https://firestore.googleapis.com/test")
            for _ in range(100):
                with self.assertRaises(transport.requests.exceptions.RequestException):
                    transport.get("https://firestore.googleapis.com/test")
            self.assertEqual(client.request.call_count, 1)
            clock.return_value = 401
            transport.get("https://firestore.googleapis.com/test")
            self.assertEqual(client.request.call_count, 2)
        transport._cooldowns.clear()


class RecipientRouting(unittest.TestCase):
    def setUp(self):
        self.users = [
            {"id": "three", "role": "USER", "plots": ["Участок 3"], "email": "three@example.test"},
            {"id": "four", "role": "USER", "plots": ["Участок 4"], "email": "four@example.test"},
            {"id": "multi", "role": "USER", "plots": ["Участок 3", "Участок 4"], "email": "multi@example.test", "notificationSettings": {"chat": False, "mentions": True}},
            {"id": "admin", "role": "ADMIN", "email": "admin@example.test"},
            {"id": "mod", "role": "MODERATOR", "email": "mod@example.test"},
        ]
        self.devices = [{"userId": user["id"], "token": user["id"], "endpoint": "https://push.example.test/" + user["id"], "p256dhKey": "key", "authKey": "key"} for user in self.users]
        self.cached = patch.object(recipients, "get_cached_collection_documents", side_effect=lambda collection, _: self.users if collection == recipients.USER_COLLECTION else self.devices)
        self.cached.start()
        self.addCleanup(self.cached.stop)

    def test_private_payment_targets_are_exact_even_for_shared_plots(self):
        targets = ["three", "multi"]
        for collector in [recipients.collect_tokens, recipients.collect_web_push_subscriptions]:
            result = collector("users", targets, [], "payments", "payments")
            self.assertEqual({item["userId"] for item in result}, set(targets))
        self.assertEqual(recipients.collect_recipient_emails("users", targets, [], "payments", "payments"), ["multi@example.test", "three@example.test"])

    def test_request_targets_from_staff_roles_exclude_residents(self):
        targets = [user["id"] for user in self.users if user["role"] in {"ADMIN", "MODERATOR"}]
        for collector in [recipients.collect_tokens, recipients.collect_web_push_subscriptions]:
            self.assertEqual({item["userId"] for item in collector("users", targets, [], "requests", "owners")}, {"admin", "mod"})

    def test_mentions_are_independent_from_chat_and_exclusions_win(self):
        self.assertEqual(recipients.collect_tokens("users", ["multi"], [], "chat", "chat"), [])
        self.assertEqual(len(recipients.collect_tokens("users", ["multi"], [], "mention", "chat")), 1)
        self.assertEqual(recipients.collect_web_push_subscriptions("users", ["three"], ["three"], "payments", "payments"), [])

    def test_deleted_account_subscriptions_do_not_receive_broadcast_or_targeted_push(self):
        self.devices.append({
            "userId": "deleted",
            "token": "deleted-token",
            "endpoint": "https://push.example.test/deleted",
            "p256dhKey": "key",
            "authKey": "key",
        })
        for collector in [recipients.collect_tokens, recipients.collect_web_push_subscriptions]:
            for audience in ["broadcast", "users"]:
                with self.subTest(collector=collector.__name__, audience=audience):
                    result = collector(audience, ["deleted"], [], "payments", "payments")
                    self.assertNotIn("deleted", {item["userId"] for item in result})


if __name__ == "__main__":
    unittest.main()
