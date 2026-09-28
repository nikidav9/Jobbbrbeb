#!/usr/bin/env python3
"""Замер ресурсов JupiterBrowserEngine (A18): память Chromium, время на задачу,
утечки процессов после close(). Без сети: тяжёлая страница со своего сервера.

    python3 scripts/browser-bench.py [--runs 10] [--chromium PATH]

Память — сумма по дереву процессов движка (node-драйвер Playwright + Chromium):
RSS (с двойным учётом общих страниц) и PSS (честная доля), если читается
smaps_rollup. Пик берётся сэмплером раз в 100 мс.
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "jupiter"))

import browser_limits as bl  # noqa: E402
from browser_engine import JupiterBrowserEngine  # noqa: E402

DEFAULT_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


def heavy_page() -> str:
    """~2500 узлов, картинки-заглушки, JS держит ~50 МБ массивов, анкета без <form>."""
    rows = "".join(
        f'<div class="row"><span>Строка {i}</span><a href="#r{i}">ссылка {i}</a>'
        f'<img alt="" width="8" height="8" src="/img/{i}.png"></div>'
        for i in range(600)
    )
    return f"""<!doctype html><meta charset="utf-8"><title>Тяжёлая вакансия</title>
<style>.row{{padding:2px;border-bottom:1px solid #ccc}}</style>
<h1>Backend-разработчик</h1><button type="button" id="open">Откликнуться</button>
<div id="root"></div>{rows}
<script>
window.__ballast = []; for (let i = 0; i < 50; i++) window.__ballast.push(new Array(130000).fill(i));
document.getElementById('open').onclick = function () {{
  document.getElementById('root').innerHTML =
    '<label>Имя <input name="name" type="text"></label>' +
    '<label>Email <input name="email" type="email"></label>' +
    '<button type="button">Отправить</button>';
}};
</script>"""


class Handler(BaseHTTPRequestHandler):
    page = heavy_page().encode()

    def do_GET(self):
        if self.path.startswith("/hang"):
            time.sleep(60)
        if self.path.startswith("/img/"):
            body, ctype = b"\x89PNG\r\n\x1a\n" + b"0" * 2000, "image/png"
        else:
            body, ctype = self.page, "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *a):
        pass


def mem_kb(pids: set[int]) -> tuple[int, int]:
    """(RSS, PSS) в КБ по набору PID."""
    rss = pss = 0
    for pid in pids:
        try:
            for line in Path(f"/proc/{pid}/status").read_text().splitlines():
                if line.startswith("VmRSS:"):
                    rss += int(line.split()[1])
            for line in Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines():
                if line.startswith("Pss:"):
                    pss += int(line.split()[1])
        except OSError:
            pass
    return rss, pss


def live_own_pids() -> set[int]:
    """Наше дерево: потомки + помеченные (без зомби — их держит init, не мы)."""
    pids = bl.descendants(os.getpid()) | bl.own_chromium_pids()
    out = set()
    for p in pids:
        try:
            state = Path(f"/proc/{p}/stat").read_text().rsplit(")", 1)[1].split()[0]
        except OSError:
            continue
        if state != "Z":
            out.add(p)
    return out


def zombies() -> int:
    n = 0
    for p in bl._all_pids("/proc"):
        try:
            stat = Path(f"/proc/{p}/stat").read_text()
        except OSError:
            continue
        if stat.rsplit(")", 1)[1].split()[0] == "Z" and "chrome" in stat.split(")")[0]:
            n += 1
    return n


class Sampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.stop = threading.Event()
        self.peak_rss = self.peak_pss = self.peak_procs = 0

    def run(self):
        while not self.stop.is_set():
            pids = live_own_pids()
            rss, pss = mem_kb(pids)
            self.peak_rss, self.peak_pss = max(self.peak_rss, rss), max(self.peak_pss, pss)
            self.peak_procs = max(self.peak_procs, len(pids))
            time.sleep(0.1)


def task(url: str, chromium: str, block: bool) -> dict:
    t0 = time.monotonic()
    eng = JupiterBrowserEngine({"127.0.0.1"}, executable_path=chromium, settle_ms=200)
    t_start = time.monotonic()
    try:
        if block:
            eng._context.route("**/img/*", lambda route, req: route.abort())
        page = eng.open(url)
        forms = len(page.forms)
        eng.semantic_snapshot()
        t_work = time.monotonic()
    finally:
        eng.close()
    t_end = time.monotonic()
    return {"start": t_start - t0, "work": t_work - t_start, "close": t_end - t_work,
            "total": t_end - t0, "forms": forms}


def scenario(name: str, url: str, chromium: str, runs: int, workers: int, block: bool) -> list:
    base_zombies = zombies()
    sam = Sampler()
    sam.start()
    results: list[dict] = []
    lock = threading.Lock()

    def worker():
        for _ in range(runs):
            r = task(url, chromium, block)
            with lock:
                results.append(r)

    t0 = time.monotonic()
    threads = [threading.Thread(target=worker) for _ in range(workers)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    wall = time.monotonic() - t0
    sam.stop.set()
    sam.join()
    time.sleep(1.0)
    left = live_own_pids()
    tot = [r["total"] for r in results]
    return [name, workers, len(results), f"{statistics.mean(tot):.2f}", f"{max(tot):.2f}",
            f"{wall / len(results):.2f}", f"{sam.peak_rss / 1024:.0f}", f"{sam.peak_pss / 1024:.0f}",
            sam.peak_procs, len(left), zombies() - base_zombies]


def table(rows: list[list], head: list[str]) -> None:
    rows = [head] + [[str(c) for c in r] for r in rows]
    w = [max(len(r[i]) for r in rows) for i in range(len(head))]
    for k, r in enumerate(rows):
        print("  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
        if k == 0:
            print("  ".join("-" * x for x in w))


def watchdog_check(hang_url: str, chromium: str) -> list:
    eng = JupiterBrowserEngine({"127.0.0.1"}, executable_path=chromium, timeout=120)
    t0 = time.monotonic()
    err = "нет"
    with bl.watch_engine(eng, timeout=4) as wd:
        try:
            eng.open(hang_url)
        except Exception as exc:  # драйвер убит — Playwright роняет вызов
            err = type(exc).__name__
    dt = time.monotonic() - t0
    eng.close()
    time.sleep(1.0)
    return [wd.fired, f"{dt:.1f}с (лимит 4с)", err, len(live_own_pids())]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--chromium", default=os.environ.get("JUPITER_CHROMIUM") or DEFAULT_CHROMIUM)
    args = ap.parse_args()

    bl.mark_owner()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    meminfo = bl.parse_meminfo(Path("/proc/meminfo").read_text())
    print(f"Хост: MemTotal {meminfo['MemTotal'] // 1024} МБ, доступно {bl.read_available_mb()} МБ, "
          f"CPU {os.cpu_count()}; страница {len(Handler.page) // 1024} КБ, 600 строк + 600 img, ~50 МБ JS-массивов")
    print(f"Задача = запуск движка + open + snapshot + close; прогонов на воркер: {args.runs}\n")

    head = ["сценарий", "паралл.", "задач", "сред,с", "макс,с", "с/задачу(wall)",
            "пик RSS,МБ", "пик PSS,МБ", "пик проц.", "живых после", "зомби+"]
    rows = []
    for workers in (1, 2):
        rows.append(scenario("как есть", base + "/", args.chromium, args.runs, workers, False))
    for workers in (1, 2):
        rows.append(scenario("img заблокированы", base + "/", args.chromium, args.runs, workers, True))
    table(rows, head)

    print("\nWatchdog на зависшей странице:")
    table([watchdog_check(base + "/hang", args.chromium)],
          ["сработал", "время", "исключение", "живых процессов после"])

    stray = bl.kill_stray_chromium()
    print(f"\nkill_stray_chromium после всех прогонов: убито {len(stray)}; "
          f"живых своих {len(live_own_pids())}")
    ok = not live_own_pids()
    print("ИТОГ:", "утечек живых процессов нет" if ok else "ЕСТЬ живые процессы после close()")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
