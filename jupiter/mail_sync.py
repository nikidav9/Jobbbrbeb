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
# 2 — письма со ссылками и полной HTML-версией (25.09.2026).
STATE_VERSION = 2

# Timeweb prepends a Received header at its public MX before forwarding the
# message to the catch-all mailbox. Sender-supplied headers appear *below*
# that hop, so only the first Received line whose "by" host is Timeweb's
# public MX is authoritative for the original envelope recipient.
_TIMEWEB_INGRESS = re.compile(r"\bby\s+mx\d+\.timeweb\.ru\b", re.IGNORECASE)
# Personal addresses: legacy u-<token> and readable ivan.petrov2 (see
# php-proxy/jupiter_mail_address.php). Service names of the domain are never a
# person's mailbox — the catch-all box itself is support@.
_TIMEWEB_FOR = re.compile(
    r"\bfor\s+<?\s*([a-z0-9][a-z0-9.-]{0,63}@jobtoo\.ru)\s*>?\s*;",
    re.IGNORECASE,
)
_RESERVED_LOCAL = frozenset({
    "abuse", "admin", "administrator", "billing", "contact", "help",
    "hostmaster", "hr", "info", "jobtoo", "mail", "mailer-daemon",
    "no-reply", "noreply", "postmaster", "privacy", "root", "security",
    "support", "team", "test", "user", "webmaster",
})


def _timeweb_envelope_recipient(message: email.message.Message) -> str | None:
    for received in message.get_all("Received", []):
        if not _TIMEWEB_INGRESS.search(received):
            continue
        # Stop at the first Timeweb ingress hop even if it has no valid
        # personal alias. Looking lower would allow a forged Received header
        # supplied by the sender to win.
        match = _TIMEWEB_FOR.search(received)
        if not match:
            return None
        address = match.group(1).lower()
        return None if address.split("@", 1)[0] in _RESERVED_LOCAL else address
    return None


_BLOCK_TAGS = ("p", "div", "li", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6")


class _PlainHTML(HTMLParser):
    """HTML письма в текст. Ссылки сохраняются: «надпись (адрес)».

    Кнопки в письмах работодателей («Пройти интервью», «Заполнить анкету») —
    это ссылки. Без адреса от такого письма остаётся одна надпись, и перейти
    некуда.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text: list[str] = []
        self.hidden = 0
        self.links: list[tuple[str | None, int]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.hidden += 1
        elif tag == "a":
            href = (dict(attrs).get("href") or "").strip()
            ok = href.lower().startswith(("https://", "http://"))
            self.links.append((href if ok else None, len(self.text)))
        elif tag == "br" or tag in _BLOCK_TAGS:
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1
        elif tag == "a" and self.links:
            href, start = self.links.pop()
            if href:
                label = " ".join("".join(self.text[start:]).split())
                # Надпись — сам адрес: второй раз не нужен. Надписи нет
                # (кнопка-картинка): остаётся один адрес.
                if not label:
                    self.text.append(href)
                elif label != href:
                    self.text.append(f" ({href})")
        elif tag in _BLOCK_TAGS:
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
                text = "".join(parser.text)
                text = re.sub(r"[ \t]+\n", "\n", re.sub(r"[ \t]{2,}", " ", text))
                html_bodies.append(re.sub(r"\n{3,}", "\n\n", text).strip())
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
        # HTML — полная версия письма со ссылками; текстовая у рассылок бывает
        # огрызком («Анкета финалиста на вакансию» без самой анкеты).
        "body": "\n".join(html_bodies or bodies)[:100000], "received_at": received,
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
        check_ingest_response(json.load(result))


def check_ingest_response(parsed: object) -> bool:
    """db.php отвечает конвертом {"data": {...}}; «stored» лежит внутри.

    Раньше служба искала его на верхнем уровне, падала на первом же письме
    и по кругу пробовала его же: в «Почту JobToo» не доходило ничего.
    stored=false — законный ответ (адрес никому не выдан), это не ошибка.
    """
    data = parsed.get("data") if isinstance(parsed, dict) else None
    if not isinstance(data, dict) or not isinstance(data.get("stored"), bool):
        raise RuntimeError("Unexpected mail ingestion response")
    return data["stored"]


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
        # STATE_VERSION растёт, когда меняется разбор писем: служба один раз
        # перечитывает весь ящик, и сервер обновляет текст уже сохранённых.
        same = state.get("uidvalidity") == uidvalidity and state.get("v") == STATE_VERSION
        last_uid = int(state.get("uid", 0)) if same else 0
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
                    json.dump({"uidvalidity": uidvalidity, "uid": int(uid), "v": STATE_VERSION}, file)
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
