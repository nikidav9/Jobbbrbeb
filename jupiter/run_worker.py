#!/usr/bin/env python3
"""Точка входа: крутит worker.run_once на серверной очереди.

    JOBTOO_URL=https://example.com \
    JOBTOO_ADMIN_TOKEN=secret \
    python3 run_worker.py

Профиль кандидата достаётся из базы по user_id задачи, а не из файла:
у каждой задачи свой кандидат, и данные берутся из его загруженного резюме.

Останавливается по SIGTERM / SIGINT (текущий прогон доводится до конца).
Только stdlib — как и весь Jupiter.
"""
from __future__ import annotations

import logging
import os
import signal
import socket
import sys
import time

from agent import CandidateProfile, JupiterAgent
from handoff import HandoffStore
from remote_tasks import RemoteTaskQueue
from site_compat import live_ready
from submission import ReceiptStore
from tasks import ApplicationTask
import worker

log = logging.getLogger("jupiter")

_stop = False


def _on_signal(signum: int, _frame: object) -> None:
    global _stop
    _stop = True
    log.info("получен сигнал %s, завершаюсь после текущей задачи", signum)


def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        sys.exit(f"переменная {name} не задана")
    return val


def main() -> int:
    logging.basicConfig(
        format="%(asctime)s %(levelname)s %(message)s",
        level=logging.INFO,
        stream=sys.stderr,
    )

    base_url = _require_env("JOBTOO_URL")
    admin_token = (
        os.environ.get("JOBTOO_ADMIN_TOKEN", "").strip()
        or os.environ.get("ADMIN_API_TOKEN", "").strip()
    )
    if not admin_token:
        sys.exit("переменная JOBTOO_ADMIN_TOKEN (или ADMIN_API_TOKEN) не задана")

    worker_id = os.environ.get("JUPITER_WORKER_ID", "").strip()
    if not worker_id:
        worker_id = f"jupiter-{socket.gethostname()}"

    poll_interval = int(os.environ.get("JUPITER_POLL_INTERVAL", "30"))
    max_steps = int(os.environ.get("JUPITER_MAX_STEPS", "30"))
    receipts_path = os.environ.get("JUPITER_RECEIPTS", "").strip() or None
    handoffs_path = os.environ.get("JUPITER_HANDOFFS", "").strip() or None
    lease_seconds = int(os.environ.get("JUPITER_LEASE_SECONDS", "300"))

    receipts = ReceiptStore(receipts_path)
    handoffs = HandoffStore(handoffs_path)

    queue = RemoteTaskQueue(
        base_url, admin_token, _require_env("EXPO_PUBLIC_APP_SECRET"),
        lease_seconds=lease_seconds,
    )

    def profile_factory(task: ApplicationTask) -> CandidateProfile:
        profile = queue.fetch_profile(task.candidate_id)
        # Third-party legal consent is intentionally scoped to one application
        # row. It is never copied from JobToo's own consent or reused globally.
        if task.third_party_consent_at:
            profile.values["personal_data_consent"] = True
        return profile

    def agent_factory(task: ApplicationTask) -> JupiterAgent:
        return JupiterAgent(
            allowed_hosts=set(),
            max_steps=max_steps,
            dry_run=not bool(task.submission_authorized_at),
            receipts=receipts,
            handoffs=handoffs,
        )

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    log.info(
        "воркер %s запущен, сервер %s, режим по согласию заявки",
        worker_id, base_url,
    )

    while not _stop:
        try:
            result = worker.run_once(
                queue, profile_factory, agent_factory, worker_id,
                site_gate=live_ready,
            )
        except Exception:
            log.exception("ошибка в run_once")
            time.sleep(poll_interval)
            continue

        if result is None:
            log.debug("очередь пуста, жду %d сек", poll_interval)
            time.sleep(poll_interval)
            continue

        task, state = result
        log.info("задача %s → %s (%s)", task.id, state, task.vacancy_url)

    log.info("воркер остановлен")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
