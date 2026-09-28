#!/usr/bin/env python3
"""Ресурсные пределы браузера: meminfo, параллелизм, watchdog, поиск своих
процессов Chromium — на фейках, без браузера и без сети."""
from __future__ import annotations

import os
import signal
import tempfile
import time
import unittest
from pathlib import Path

import browser_limits as bl

MEMINFO = """MemTotal:       16481000 kB
MemFree:         2000000 kB
MemAvailable:    8192000 kB
Buffers:          100000 kB
Cached:          1000000 kB
HugePages_Total:       0
"""


def fake_proc(root: Path, procs: dict[int, tuple[str, int, str | None]]) -> None:
    """procs: pid -> (comm, ppid, значение OWNER_ENV или None)."""
    for pid, (comm, ppid, owner) in procs.items():
        d = root / str(pid)
        d.mkdir()
        (d / "comm").write_text(comm + "\n")
        (d / "stat").write_text(f"{pid} ({comm} x) S {ppid} 1 1 0\n")  # пробел в comm — нарочно
        env = b"PATH=/bin\0" + (f"{bl.OWNER_ENV}={owner}\0".encode() if owner else b"")
        (d / "environ").write_bytes(env)


class MeminfoTest(unittest.TestCase):
    def test_parse(self):
        info = bl.parse_meminfo(MEMINFO)
        self.assertEqual(info["MemAvailable"], 8192000)
        self.assertEqual(info["HugePages_Total"], 0)
        self.assertEqual(bl.available_mb_from_meminfo(info), 8000)

    def test_fallback_without_memavailable(self):
        info = bl.parse_meminfo("MemFree: 1048576 kB\nBuffers: 524288 kB\nCached: 524288 kB\n")
        self.assertEqual(bl.available_mb_from_meminfo(info), 2048)

    def test_garbage_lines_ignored(self):
        self.assertEqual(bl.parse_meminfo("мусор\nA: x kB\n\nB: 5 kB"), {"B": 5})

    def test_read_takes_min_of_host_and_cgroup(self):
        with tempfile.TemporaryDirectory() as d:
            mi = Path(d, "meminfo")
            mi.write_text(MEMINFO)
            cg = Path(d, "cg")
            cg.mkdir()
            self.assertEqual(bl.read_available_mb(str(mi), str(cg)), 8000)  # cgroup нет
            (cg / "memory.max").write_text(str(2048 * 1024 * 1024))
            (cg / "memory.current").write_text(str(1024 * 1024 * 1024))
            self.assertEqual(bl.read_available_mb(str(mi), str(cg)), 1024)
            (cg / "memory.max").write_text("max\n")
            self.assertEqual(bl.read_available_mb(str(mi), str(cg)), 8000)
        self.assertEqual(bl.read_available_mb("/nonexistent", "/nonexistent"), 0)


class ParallelismTest(unittest.TestCase):
    def test_decisions(self):
        f = bl.max_parallel_browsers
        self.assertEqual(f(0), 1)       # хуже некуда — всё равно одна задача
        self.assertEqual(f(1200), 1)
        self.assertEqual(f(2048), 2)    # (2048-1024)//500
        self.assertEqual(f(4096), 4)    # 6, но упор в HARD_CAP=4
        self.assertEqual(f(64000), bl.HARD_CAP)
        self.assertEqual(f(4096, hard_cap=2), 2)
        self.assertEqual(f(3000, per_browser_mb=1000, reserve_mb=0), 3)

    def test_monotonic(self):
        vals = [bl.max_parallel_browsers(mb) for mb in range(0, 20000, 250)]
        self.assertEqual(vals, sorted(vals))

    def test_blocked_types(self):
        self.assertTrue(bl.should_block_resource("image"))
        self.assertTrue(bl.should_block_resource("font"))
        self.assertFalse(bl.should_block_resource("script"))      # анкета рисуется JS
        self.assertFalse(bl.should_block_resource("stylesheet"))  # без CSS ломается видимость
        self.assertFalse(bl.should_block_resource("xhr"))
        self.assertFalse(bl.should_block_resource("document"))


class ProcessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        # 100 — наш воркер. 101 node — его дитя, 102 chrome — дитя node,
        # 103 renderer — дитя chrome. 104 crashpad — сирота, но с нашей меткой.
        # 200 chrome — чужой (ppid 1, без метки). 201 chrome — с чужой меткой.
        # 105 — наш потомок, но не chrome (bash) — трогать нельзя.
        fake_proc(self.root, {
            1: ("init", 0, None), 100: ("python3", 1, None),
            101: ("node", 100, None), 102: ("chrome", 101, None),
            103: ("chrome", 102, None), 104: ("chrome_crashpad", 1, "100"),
            105: ("bash", 100, None),
            200: ("chrome", 1, None), 201: ("chrome", 1, "999"),
        })
        self.sent: list[tuple[int, int]] = []

    def tearDown(self):
        self.tmp.cleanup()

    def kill(self, pid, sig):
        self.sent.append((pid, sig))

    def test_descendants(self):
        self.assertEqual(bl.descendants(100, str(self.root)), {101, 102, 103, 105})

    def test_kill_stray_only_own_chromium(self):
        killed = bl.kill_stray_chromium(100, proc=str(self.root), kill=self.kill)
        self.assertEqual(killed, [102, 103, 104])
        self.assertTrue(all(sig == signal.SIGKILL for _, sig in self.sent))
        for foreign in (1, 100, 101, 105, 200, 201):
            self.assertNotIn(foreign, killed)

    def test_exclude_live_engine(self):
        killed = bl.kill_stray_chromium(100, proc=str(self.root), kill=self.kill, exclude={102, 103})
        self.assertEqual(killed, [104])

    def test_vanished_process_is_not_error(self):
        def gone(pid, sig):
            raise ProcessLookupError
        self.assertEqual(bl.kill_stray_chromium(100, proc=str(self.root), kill=gone), [])

    def test_kill_tree_children_first(self):
        bl.kill_tree(101, proc=str(self.root), kill=self.kill)
        self.assertEqual([p for p, _ in self.sent], [103, 102, 101])

    def test_mark_owner_sets_env(self):
        old = os.environ.get(bl.OWNER_ENV)
        try:
            bl.mark_owner()
            self.assertEqual(os.environ[bl.OWNER_ENV], str(os.getpid()))
        finally:
            if old is None:
                os.environ.pop(bl.OWNER_ENV, None)
            else:
                os.environ[bl.OWNER_ENV] = old

    def test_real_proc_smoke(self):
        # На настоящем /proc: собственный процесс тестов не должен убиваться.
        self.assertNotIn(os.getpid(), bl.own_chromium_pids())

    def test_engine_root_pid_tolerates_garbage(self):
        self.assertIsNone(bl.engine_root_pid(object()))


class WatchdogTest(unittest.TestCase):
    def test_fires_on_hang(self):
        calls = []
        with bl.TaskWatchdog(0.05, kill=lambda: calls.append(1) or [7]) as wd:
            time.sleep(0.3)
        self.assertTrue(wd.fired)
        self.assertEqual(calls, [1])
        self.assertEqual(wd.killed, [7])

    def test_quiet_when_task_finishes(self):
        calls = []
        with bl.TaskWatchdog(0.2, kill=lambda: calls.append(1)) as wd:
            pass
        time.sleep(0.4)
        self.assertFalse(wd.fired)
        self.assertEqual(calls, [])

    def test_default_timeout_is_180(self):
        self.assertEqual(bl.TaskWatchdog().timeout, 180.0)
        self.assertEqual(bl.WATCHDOG_TIMEOUT_S, 180.0)

    def test_watch_engine_kills_engine_tree_on_fake(self):
        class Fake:
            pass
        # Фейк без Playwright: engine_root_pid -> None, значит запасной путь.
        wd = bl.watch_engine(Fake(), timeout=0.05)
        seen = []
        wd._kill = lambda: seen.append("stray")
        with wd:
            time.sleep(0.2)
        self.assertEqual(seen, ["stray"])


if __name__ == "__main__":
    unittest.main()
