#!/usr/bin/env python3
"""Повторная проверка карантина источников: подсчёт вакансий, коды ответа,
подпись JobToo. Сайты — локальный сервер."""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import career_quarantine_recheck as q  # noqa: E402

fails = []
seen = {}


def check(name, ok):
    if not ok:
        fails.append(name)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        raw = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        seen["ua"] = self.headers.get("User-Agent")
        if self.path.startswith("/api/ok"):
            self._send(200, json.dumps({"data": {"items": [{"id": 1}, {"id": 2}]}}))
        elif self.path.startswith("/api/empty"):
            self._send(200, json.dumps({"data": {"items": []}}))
        elif self.path.startswith("/jobs"):
            self._send(200, '<a href="/jobs/">Все</a><a href="/jobs/kassir">Кассир</a><a href="/jobs/povar">Повар</a>', "text/html")
        else:
            self._send(403, "{}")

    def do_POST(self):
        seen["post"] = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
        self._send(200, json.dumps({"list": [{"id": 1}]}))


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"

ok = q.probe({"url": base + "/api/ok", "company": "A", "reason": "production 403"},
             {"url": base + "/api/ok", "map": {"list": "data.items"}})
check("200 и вакансии — можно выпускать", ok["status"] == 200 and ok["items"] == 2 and ok["looks_ok"])
check("подпись — как у сбора", seen.get("ua") == q.USER_AGENT)
empty = q.probe({"url": base + "/api/empty"}, {"url": base + "/api/empty", "map": {"list": "data.items"}})
check("200 без вакансий — не выпускать", empty["items"] == 0 and not empty["looks_ok"])
denied = q.probe({"url": base + "/api/denied"}, {"url": base + "/api/denied", "map": {"list": "x"}})
check("403 — не выпускать", denied["status"] == 403 and not denied["looks_ok"])
links = q.probe({"url": base + "/jobs"}, {"url": base + "/jobs", "mode": "html_links", "map": {"link_path": "/jobs/"}})
check("страница со ссылками: считаются вакансии, не сам список", links["items"] == 2 and links["looks_ok"])
post = q.probe({"url": base + "/api/post"}, {"url": base + "/api/post", "method": "POST", "body": {"a": 1}, "map": {"list": "list"}})
check("POST-источник — с его телом", post["items"] == 1 and json.loads(seen.get("post", "{}")) == {"a": 1})
dead = q.probe({"url": "http://127.0.0.1:9/x"}, None, timeout=2)
check("сеть недоступна — статус «сеть», не падаем", dead["status"] == "сеть" and not dead["looks_ok"])
import tempfile
with tempfile.TemporaryDirectory() as d:
    feed = Path(d) / "feed.json"
    feed.write_text(json.dumps({"Сбер": ["u"], "Wildberries / РВБ": ["u"]}, ensure_ascii=False), encoding="utf-8")
    eps = [{"url": "https://a/1", "map": {"company_const": "Северсталь"}},
           {"url": "https://a/2", "map": {"company_const": "Сбер"}},
           {"url": "https://a/3", "company_hint": "Wildberries"},
           {"url": "https://a/4", "map": {"company_const": "Hoff"}}]
    miss = q.missing_from_feed(eps, {"https://a/4"}, str(feed))
    check("нет в ленте: только компании без вакансий, без карантина, с учётом «/ РВБ»",
          [m["company"] for m in miss] == ["северсталь"] and miss[0]["kind"] == "нет в ленте")
    check("без файла ленты — только карантин", q.missing_from_feed(eps, set(), None) == [])
srv.shutdown()

if fails:
    raise SystemExit("career quarantine recheck: ПРОВАЛЫ\n  - " + "\n  - ".join(fails))
print("career quarantine recheck: OK")
