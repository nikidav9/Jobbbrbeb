"""Incoming mail routing must use Timeweb's trusted envelope recipient."""
import unittest

from mail_sync import check_ingest_response, parse_message


class MailRoutingTests(unittest.TestCase):
    def test_requires_timeweb_ingress_envelope_recipient(self):
        raw = (b"From: recruiter@example.org\r\n"
               b"To: u-aabbcc@jobtoo.ru\r\n"
               b"Subject: Interview\r\n\r\nHello")
        self.assertIsNone(parse_message(raw, "8", "2"))

    def test_routes_timeweb_ingress_recipient_and_decodes_body(self):
        raw = (b"Received: from sender.example [203.0.113.8]\r\n"
               b"\tby mx1.timeweb.ru with esmtps id abc123\r\n"
               b"\tfor <u-aabbcc@jobtoo.ru>; Thu, 24 Sep 2026 13:41:30 +0300\r\n"
               b"From: recruiter@example.org\r\n"
               b"To: support@jobtoo.ru\r\n"
               b"Subject: Interview\r\n"
               b"Content-Type: text/plain; charset=utf-8\r\n\r\nHello")
        address, letter = parse_message(raw, "8", "2")
        self.assertEqual(address, "u-aabbcc@jobtoo.ru")
        self.assertEqual(letter["imap_uid"], "2:8")
        self.assertEqual(letter["body"], "Hello")

    def test_routes_readable_address(self):
        raw = (b"Received: from sender.example [203.0.113.8]\r\n"
               b"\tby mx2.timeweb.ru with esmtps id abc123\r\n"
               b"\tfor <Ivan.Petrov2@jobtoo.ru>; Thu, 25 Sep 2026 13:41:30 +0300\r\n"
               b"Subject: Interview\r\n\r\nHello")
        address, _ = parse_message(raw, "9", "2")
        self.assertEqual(address, "ivan.petrov2@jobtoo.ru")

    def test_service_address_is_not_a_person(self):
        raw = (b"Received: from sender.example [203.0.113.8]\r\n"
               b"\tby mx1.timeweb.ru with esmtps id abc123\r\n"
               b"\tfor <support@jobtoo.ru>; Thu, 25 Sep 2026 13:41:30 +0300\r\n"
               b"Subject: Hi\r\n\r\nHello")
        self.assertIsNone(parse_message(raw, "9", "2"))

    def test_sender_controlled_original_headers_are_ignored(self):
        raw = (b"Received: from sender.example [203.0.113.8]\r\n"
               b"\tby mx1.timeweb.ru with esmtps id abc123\r\n"
               b"\tfor <u-real@jobtoo.ru>; Thu, 24 Sep 2026 13:41:30 +0300\r\n"
               b"X-Original-To: u-victim@jobtoo.ru\r\n"
               b"Envelope-To: u-victim@jobtoo.ru\r\n"
               b"To: u-victim@jobtoo.ru\r\n\r\nHello")
        address, _ = parse_message(raw, "8", "2")
        self.assertEqual(address, "u-real@jobtoo.ru")

    def test_forged_lower_received_cannot_override_real_timeweb_hop(self):
        raw = (b"Received: from sender.example [203.0.113.8]\r\n"
               b"\tby mx1.timeweb.ru with esmtps id real123\r\n"
               b"\tfor <support@jobtoo.ru>; Thu, 24 Sep 2026 13:41:30 +0300\r\n"
               b"Received: from attacker.example by mx1.timeweb.ru\r\n"
               b"\tfor <u-victim@jobtoo.ru>; Thu, 24 Sep 2026 13:40:00 +0300\r\n"
               b"To: u-victim@jobtoo.ru\r\n\r\nHello")
        self.assertIsNone(parse_message(raw, "8", "2"))


class HtmlBodyTests(unittest.TestCase):
    RAW = (b"Received: from s.example by mx1.timeweb.ru\r\n"
           b"\tfor <nikita.davydov@jobtoo.ru>; Thu, 25 Sep 2026 10:18:42 +0300\r\n"
           b"Subject: =?utf-8?b?0JDQvdC60LXRgtCw?=\r\n"
           b"MIME-Version: 1.0\r\n"
           b"Content-Type: multipart/alternative; boundary=b\r\n\r\n"
           b"--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"
           b"\xd0\x90\xd0\xbd\xd0\xba\xd0\xb5\xd1\x82\xd0\xb0\r\n"
           b"--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
           b"<table><tr><td><p>Hello</p>"
           b"<a href=\"https://pulse.sber.example/form?id=1\">Fill in</a>"
           b"<a href=\"https://x.example/y\">https://x.example/y</a>"
           b"<a href=\"javascript:alert(1)\">bad</a></td></tr></table>\r\n"
           b"--b--\r\n")

    def test_html_part_wins_and_keeps_links(self):
        _, letter = parse_message(self.RAW, "1", "2")
        body = letter["body"]
        self.assertIn("Fill in (https://pulse.sber.example/form?id=1)", body)
        self.assertEqual(body.count("https://x.example/y"), 1)
        self.assertNotIn("javascript:", body)
        self.assertNotIn("\u0410\u043d\u043a\u0435\u0442\u0430\n", body)


class IngestResponseTests(unittest.TestCase):
    def test_db_php_envelope_is_accepted(self):
        # Ровно так отвечает php-proxy/db.php: jt_respond(['data' => $data]).
        self.assertTrue(check_ingest_response({"data": {"stored": True}}))
        self.assertFalse(check_ingest_response({"data": {"stored": False}}))

    def test_error_or_bare_answer_is_rejected(self):
        for bad in ({"error": "boom"}, {"stored": True}, {"data": {}}, [], None):
            with self.assertRaises(RuntimeError):
                check_ingest_response(bad)


if __name__ == "__main__":
    unittest.main()
