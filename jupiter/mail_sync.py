#!/usr/bin/env python3
"""Import replies for JobToo candidate aliases from a dedicated catch-all IMAP inbox."""
from __future__ import annotations

import email
from email.header import decode_header, make_header
from email.utils import getaddresses, parsedate_to_datetime
import imaplib
from html.parser import HTMLParser
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

LOG = logging.getLogger("jupiter.mail")
DOMAIN = "jobtoo.ru"

# Timeweb prepends a Received header at its public MX before forwarding the
# message to the catch-all mailbox. Sender-supplied headers appear *below*
# that hop, so only the first Received line whose "by" host is Timeweb's
# public MX is authoritative for the original envelope recipient.
_TIMEWEB_INGRESS = re.compile(r"\\bby\\s+mx\\d+\\.timeweb\\.ru\\b", re.IGNORECASE)
_TIMEWEB_FOR = re.compile(
    r"\\bfor\\s+<?\\s*(u-[a-z0-9-]+@jobtoo\\.ru)\\s*>?\\s*;",
    re.IGNORECASE,
)


def _timeweb_envelope_recipient(message: email.message.Message) -> str | None:
    for received in message.get_all("Received", []):
        if not _TIMEWEB_INGRESS.search(received):
            continue
        # Stop at the first Timeweb ingress hop even if it has no valid
        # personal alias. Looking lower would allow a forged Received header
        # supplied by the sender to win.
        match = _TIMEWEB_FOR.search(received)
        return match.group(1).lower() if match else None
    return None


class _PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.hidden += 1
        elif tag in ("br", "p", "div", "li"):
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1
        elif tag in ("p", "div", "li"):
            self.text.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.text.append(data)


def parse_message(raw: bytes, uid: str, uidvalidity: str) -> tuple[str, dict] | None:
    message = email.message_from_bytes(raw)
    # Timeweb does not preserve the original recipient in X-Original-To or
    # Envelope-To for catch-all delivery. Those headers are also sender-
    # controllable in our observed path, so never route on them. The envelope
    # recipient is taken only from Timeweb's own ingress Received line.
    address = _timeweb_envelope_recipient(message)
    if not address:
        return None
    subject = str(make_header(decode_header(message.get("Subject", ""))))
    sender = str(make_header(decode_header(message.get("From", ""))))
    bodies: list[str] = []
    html_bodies: list[str] = []
    parts = message.walk() if message.is_multipart() else [message]
    for part in parts:
        if part.get_content_type() not in ("text/plain", "text/html") or part.get_content_disposition() == "attachment":
            continue
        payload = part.get_payload(decode=True)
        if payload:
            content = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            if part.get_content_type() == "text/plain":
                bodies.append(content)
            else:
                parser = _PlainHTML()
                parser.feed(content)
                html_bodies.append("".join(parser.text).strip())
    try:
        dt = parsedate_to_datetime(message.get("Date", ""))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        received = dt.isoformat()
    except (ValueError, TypeError):
        received = datetime.now(timezone.utc).isoformat()
    return address, {
        "imap_uid": f"{uidvalidity}:{uid}",
        "sender": sender[:320], "subject": subject[:998],
        "body": "\n".join(bodies or html_bodies)[:100000], "received_at": received,
    }


def ingest(address: str, payload: dict) -> None:
    req = Request(
        os.environ["JOBTOO_URL"].rstrip("/") + "/api/db.php",
        data=json.dumps({"fn": "jupiterMailIngest", "args": [address, payload]}).encode(),
        headers={"Content-Type": "application/json",
                 "X-Admin-Token": os.environ.get("JOBTOO_ADMIN_TOKEN") or os.environ["ADMIN_API_TOKEN"],
                 "X-App-Secret": os.environ["EXPO_PUBLIC_APP_SECRET"]},
    )
    with urlopen(req, timeout=30) as result:
        parsed = json.load(result)
        if not isinstance(parsed, dict) or "stored" not in parsed:
            raise RuntimeError("Unexpected mail ingestion response")


def poll() -> None:
    state_path = os.environ.get("JUPITER_MAIL_UID_STATE", "/var/lib/jupiter/mail-uid.json")
    try:
        with open(state_path, encoding="utf-8") as file:
            state = json.load(file)
    except (OSError, ValueError):
        state = {}
    with imaplib.IMAP4_SSL(os.environ.get("JUPITER_MAIL_IMAP_HOST", "imap.timeweb.ru"), 993) as client:
        client.login(os.environ["JUPITER_MAIL_IMAP_USER"], os.environ["JUPITER_MAIL_IMAP_PASSWORD"])
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("Could not select inbox")
        uidvalidity = str(client.response("UIDVALIDITY")[1][0], "ascii")
        last_uid = int(state.get("uid", 0)) if state.get("uidvalidity") == uidvalidity else 0
        status, data = client.uid("SEARCH", None, "ALL")
        if status != "OK":
            raise RuntimeError("Could not list mail")
        for uid in data[0].split():
            if int(uid) <= last_uid:
                continue
            status, fetched = client.uid("FETCH", uid, "(BODY.PEEK[])")
            if status != "OK":
                raise RuntimeError("Could not fetch mail")
            raw = next((part[1] for part in fetched if isinstance(part, tuple)), None)
            if raw is None:
                continue
            parsed = parse_message(raw, uid.decode("ascii"), uidvalidity)
            if parsed:
                ingest(*parsed)
            fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(state_path), prefix=".mail-uid-")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    json.dump({"uidvalidity": uidvalidity, "uid": int(uid)}, file)
                os.replace(tmp_path, state_path)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    required = ("JUPITER_MAIL_IMAP_USER", "JUPITER_MAIL_IMAP_PASSWORD", "JOBTOO_URL",
                "EXPO_PUBLIC_APP_SECRET")
    for name in required:
        if not os.environ.get(name):
            raise SystemExit(f"Missing {name}")
    if not (os.environ.get("JOBTOO_ADMIN_TOKEN") or os.environ.get("ADMIN_API_TOKEN")):
        raise SystemExit("Missing server admin token")
    while True:
        try:
            poll()
        except Exception:
            LOG.exception("Mail sync failed")
        time.sleep(60)
