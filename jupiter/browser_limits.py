"""Ресурсные пределы браузерного движка Юпитера (рекомендации как код).

Chromium — самая тяжёлая часть Юпитера. Замер (scripts/browser-bench.py)
показал, сколько памяти держит один движок; здесь это превращено в правила:

- BLOCK_RESOURCE_TYPES — какие ресурсы страницы можно не грузить;
- max_parallel_browsers() — сколько браузеров можно держать одновременно при
  данной свободной памяти (читает /proc/meminfo и лимит cgroup, без psutil);
- TaskWatchdog — жёсткий таймаут задачи: по истечении браузер убивается;
- kill_stray_chromium() — добивает процессы Chromium, которые остались от
  НАШЕГО процесса. Чужие браузеры (другие пользователи, другие воркеры,
  браузер самого владельца) не трогаются.

Модуль на stdlib и не меняет browser_engine.py: подключается снаружи
(см. jupiter/README.md или отчёт по A18). Только Linux (/proc).
"""
from __future__ import annotations

import os
import signal
import threading
from pathlib import Path
from typing import Callable, Iterable

# Что можно не грузить: на анкету это не влияет, а трафик и память съедает.
# stylesheet НЕ блокируем — без CSS «видимость» полей определяется неверно
# (движок отбрасывает невидимые поля), script — тем более: анкета рисуется JS.
BLOCK_RESOURCE_TYPES = frozenset({"image", "media", "font"})

WATCHDOG_TIMEOUT_S = 180.0

# Оценка по замеру: один движок (браузер + node-драйвер + вкладка) на тяжёлой
# странице. Значения округлены вверх, с запасом на страницы тяжелее замеренной.
PER_BROWSER_MB = 500
RESERVE_MB = 1024  # память под ОС, PHP, сам воркер и всплески
HARD_CAP = 4       # больше — упирается в CPU и анти-бот сайтов, а не в память

OWNER_ENV = "JUPITER_BROWSER_OWNER"
_CHROME_NAMES = ("chrome", "chrome_crashpad", "chromium", "headless_shell")


def should_block_resource(resource_type: str) -> bool:
    """Для route-обработчика: True — запрос обрывать."""
    return resource_type in BLOCK_RESOURCE_TYPES


# ── Память ──────────────────────────────────────────────────────────────────
def parse_meminfo(text: str) -> dict[str, int]:
    """'MemAvailable:  123 kB' -> {'MemAvailable': 123} (в килобайтах)."""
    result: dict[str, int] = {}
    for line in text.splitlines():
        name, sep, rest = line.partition(":")
        parts = rest.split()
        if sep and parts and parts[0].isdigit():
            result[name.strip()] = int(parts[0])
    return result


def available_mb_from_meminfo(info: dict[str, int]) -> int:
    if "MemAvailable" in info:
        return info["MemAvailable"] // 1024
    # Старые ядра без MemAvailable.
    free = info.get("MemFree", 0) + info.get("Buffers", 0) + info.get("Cached", 0)
    return free // 1024


def _cgroup_available_mb(root: str = "/sys/fs/cgroup") -> int | None:
    """Свободно в контейнере (cgroup v2), если лимит задан."""
    try:
        limit = Path(root, "memory.max").read_text().strip()
        if limit == "max":
            return None
        used = int(Path(root, "memory.current").read_text().strip())
        return max(0, (int(limit) - used) // (1024 * 1024))
    except (OSError, ValueError):
        return None


def read_available_mb(meminfo_path: str = "/proc/meminfo", cgroup_root: str = "/sys/fs/cgroup") -> int:
    """Свободная память в МБ: меньшее из «хост» и «лимит контейнера»."""
    try:
        host = available_mb_from_meminfo(parse_meminfo(Path(meminfo_path).read_text()))
    except OSError:
        host = 0
    cg = _cgroup_available_mb(cgroup_root)
    return host if cg is None else min(host, cg)


def max_parallel_browsers(
    available_mb: int | None = None,
    *,
    per_browser_mb: int = PER_BROWSER_MB,
    reserve_mb: int = RESERVE_MB,
    hard_cap: int = HARD_CAP,
) -> int:
    """Сколько браузеров запускать одновременно. Не меньше 1: одна задача
    должна пройти даже на маленьком сервере (упадёт — так упадёт понятно)."""
    if available_mb is None:
        available_mb = read_available_mb()
    fit = (available_mb - reserve_mb) // per_browser_mb
    return max(1, min(hard_cap, int(fit)))


# ── Процессы ────────────────────────────────────────────────────────────────
def mark_owner() -> None:
    """Пометить этот процесс владельцем браузеров. Вызвать ДО запуска движка:
    дети наследуют переменную окружения, и по ней потом видно, чей браузер,
    даже если Chromium переродился (ppid=1) и из дерева процессов выпал."""
    os.environ[OWNER_ENV] = str(os.getpid())


def _read_ppid(pid: int, proc: str) -> int | None:
    try:
        stat = Path(proc, str(pid), "stat").read_text()
        # comm может содержать пробелы и скобки: разбираем после последней ')'.
        return int(stat.rsplit(")", 1)[1].split()[1])
    except (OSError, IndexError, ValueError):
        return None


def _read_comm(pid: int, proc: str) -> str:
    try:
        return Path(proc, str(pid), "comm").read_text().strip()
    except OSError:
        return ""


def _read_owner(pid: int, proc: str) -> str | None:
    try:
        raw = Path(proc, str(pid), "environ").read_bytes()
    except OSError:
        return None
    key = (OWNER_ENV + "=").encode()
    for item in raw.split(b"\0"):
        if item.startswith(key):
            return item[len(key):].decode(errors="replace")
    return None


def _all_pids(proc: str) -> list[int]:
    try:
        return [int(n) for n in os.listdir(proc) if n.isdigit()]
    except OSError:
        return []


def descendants(root_pid: int, proc: str = "/proc") -> set[int]:
    """Все потомки процесса (без него самого)."""
    children: dict[int, list[int]] = {}
    for pid in _all_pids(proc):
        ppid = _read_ppid(pid, proc)
        if ppid is not None:
            children.setdefault(ppid, []).append(pid)
    found: set[int] = set()
    todo = [root_pid]
    while todo:
        for child in children.get(todo.pop(), []):
            if child not in found:
                found.add(child)
                todo.append(child)
    return found


def _is_chromium(pid: int, proc: str) -> bool:
    comm = _read_comm(pid, proc)
    return any(comm == n or comm.startswith(n) for n in _CHROME_NAMES)


def own_chromium_pids(root_pid: int | None = None, proc: str = "/proc") -> set[int]:
    """Процессы Chromium этого процесса: потомки + помеченные OWNER_ENV.
    Чужие (не потомки и без нашей метки) сюда не попадают."""
    root = os.getpid() if root_pid is None else root_pid
    own = {p for p in descendants(root, proc) if _is_chromium(p, proc)}
    for pid in _all_pids(proc):
        if pid not in own and _is_chromium(pid, proc) and _read_owner(pid, proc) == str(root):
            own.add(pid)
    own.discard(root)
    return own


def kill_stray_chromium(
    root_pid: int | None = None,
    *,
    proc: str = "/proc",
    kill: Callable[[int, int], None] = os.kill,
    exclude: Iterable[int] = (),
) -> list[int]:
    """SIGKILL всем процессам Chromium нашего процесса. Возвращает убитые PID.
    exclude — PID живых движков, которые трогать нельзя (при параллельной работе)."""
    skip = set(exclude)
    killed: list[int] = []
    for pid in sorted(own_chromium_pids(root_pid, proc) - skip):
        try:
            kill(pid, signal.SIGKILL)
            killed.append(pid)
        except (ProcessLookupError, PermissionError):
            pass
    return killed


def kill_tree(root_pid: int, *, proc: str = "/proc",
              kill: Callable[[int, int], None] = os.kill) -> list[int]:
    """Убить процесс и всех его потомков (потомков сначала). Для одного движка:
    его корень — node-драйвер Playwright, см. engine_root_pid()."""
    pids = sorted(descendants(root_pid, proc), reverse=True) + [root_pid]
    killed: list[int] = []
    for pid in pids:
        try:
            kill(pid, signal.SIGKILL)
            killed.append(pid)
        except (ProcessLookupError, PermissionError):
            pass
    return killed


def engine_root_pid(engine: object) -> int | None:
    """PID node-драйвера Playwright конкретного JupiterBrowserEngine. Лезет во
    внутренности Playwright, поэтому при неудаче отдаёт None (тогда watchdog
    падает на kill_stray_chromium)."""
    try:
        return int(engine._pw._impl_obj._connection._transport._proc.pid)  # type: ignore[attr-defined]
    except Exception:
        return None


# ── Watchdog ────────────────────────────────────────────────────────────────
class TaskWatchdog:
    """Жёсткий таймаут задачи. По истечении вызывает kill() — браузер убит, и
    зависший вызов Playwright в основном потоке падает исключением; дальше
    вызывающий делает engine.close() как обычно.

        with watch_engine(engine, 180) as wd:
            run_task(engine)
        if wd.fired: ...  # задача убита по времени

    Таймер — демон-поток: сам не удерживает процесс от выхода.
    """

    def __init__(self, timeout: float = WATCHDOG_TIMEOUT_S,
                 kill: Callable[[], object] | None = None):
        self.timeout = timeout
        self._kill = kill or kill_stray_chromium
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self.fired = False
        self.killed: object = None

    def _fire(self) -> None:
        with self._lock:
            self.fired = True
        self.killed = self._kill()

    def start(self) -> "TaskWatchdog":
        self._timer = threading.Timer(self.timeout, self._fire)
        self._timer.daemon = True
        self._timer.start()
        return self

    def cancel(self) -> None:
        if self._timer is not None:
            self._timer.cancel()

    def __enter__(self) -> "TaskWatchdog":
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.cancel()


def kill_engine_browser(engine: object) -> list[int]:
    """Убить Chromium одного движка, оставив живым node-драйвер Playwright.
    Так надо: убитый драйвер оставляет engine.close() в гонке (замер: ~50%
    зависаний в context.close()), а при убитом браузере драйвер сам сообщает
    «browser has been closed», зависший вызов падает, close() отрабатывает чисто.
    Драйвер не нашли — запасной путь: все Chromium нашего процесса."""
    pid = engine_root_pid(engine)
    if pid is None:
        return kill_stray_chromium()
    return kill_stray_chromium(pid)


def watch_engine(engine: object, timeout: float = WATCHDOG_TIMEOUT_S) -> TaskWatchdog:
    """Watchdog на конкретный движок: убивает только его Chromium (не соседние
    движки этого же процесса). Дальше вызывающий делает engine.close()."""
    return TaskWatchdog(timeout, lambda: kill_engine_browser(engine))
