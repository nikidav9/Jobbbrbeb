"""Incoming mail must not be routed by a sender-controlled To/Cc header."""
import unittest

from mail_sync import parse_message


class MailRoutingTests(unittest.TestCase):
    def test_requires_original_envelope_recipient(self):
        raw = (b"From: recruiter@example.org\r\n"
               b"To: u-aabbcc@jobtoo.ru\r\n"
               b"Subject: Interview\r\n\r\nHello")
        self.assertIsNone(parse_message(raw, "8", "2"))

    def test_routes_original_recipient_and_decodes_body(self):
        raw = (b"From: recruiter@example.org\r\n"
               b"To: catchall@jobtoo.ru\r\n"
               b"X-Original-To: u-aabbcc@jobtoo.ru\r\n"
               b"Subject: Interview\r\n"
               b"Content-Type: text/plain; charset=utf-8\r\n\r\nHello")
        address, letter = parse_message(raw, "8", "2")
        self.assertEqual(address, "u-aabbcc@jobtoo.ru")
        self.assertEqual(letter["imap_uid"], "2:8")
        self.assertEqual(letter["body"], "Hello")

    def test_ambiguous_original_recipient_is_not_assigned(self):
        raw = (b"From: recruiter@example.org\r\n"
               b"X-Original-To: u-aabbcc@jobtoo.ru\r\n"
               b"X-Original-To: u-ddffee@jobtoo.ru\r\n\r\nHello")
        self.assertIsNone(parse_message(raw, "8", "2"))


if __name__ == "__main__":
    unittest.main()
