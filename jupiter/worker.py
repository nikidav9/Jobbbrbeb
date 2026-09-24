#!/usr/bin/env python3
"""Воркер: берёт задачу из очереди и доводит её агентом.

Тонкий слой намеренно. Вся логика подачи — в агенте, всё про аренду и
повторы — в очереди. Здесь только перевод одного в другое, и именно тут
решается, какая неудача заслуживает повтора.
"""
from __future__ import annotations

import os
import logging
import threading
from typing import Callable

from agent import AgentResult, CandidateProfile, JupiterAgent, Reason
from tasks import ApplicationTask, TaskQueueProto, TaskState

# Что имеет смысл повторить: связь, время ожидания, дроссель на той стороне.
# Всё остальное повторять бессмысленно — со второго раза страница не станет
# другой, а работодатель получит лишний запрос.
RETRYABLE_CODES = {
    Reason.NAVIGATION_FAILED,
    Reason.SUBMIT_FAILED,
}
log = logging.getLogger("jupiter")

RESULT_TO_STATE = {
    "submitted": TaskState.SUBMITTED,
    "ready_to_submit": TaskState.READY_TO_SUBMIT,
    "step_ready": TaskState.READY_TO_SUBMIT,
    "duplicate": TaskState.DUPLICATE,
    "submission_unknown": TaskState.SUBMISSION_UNKNOWN,
    "action_required": TaskState.ACTION_REQUIRED,
}


def apply_result(queue: TaskQueueProto, task: ApplicationTask, result: AgentResult) -> str:
    """Перевести итог прогона в состояние задачи."""
    if result.status == "failed":
        retryable = result.reason_code in RETRYABLE_CODES
        return queue.fail(
            task.id, result.reason or "failed", retryable=retryable
        )

    state = RESULT_TO_STATE.get(result.status, TaskState.FAILED)
    queue.finish(
        task.id,
        state,
        reason_code=result.reason_code,
        resume_token=(result.human_action or {}).get("resume_token"),
        receipt_key=next(
            (
                item.get("receipt", {}).get("key")
                for item in reversed(result.trajectory)
                if isinstance(item.get("receipt"), dict)
            ),
            None,
        ),
    )
    return state


def _cleanup_resume(profile: CandidateProfile) -> None:
    """Удалить временный PDF, скачанный для этого прогона."""
    path = profile.resume_path
    if path and os.path.isfile(path) and "/jupiter_resume_" in path:
        try:
            os.unlink(path)
        except OSError:
            pass


def run_once(
    queue: TaskQueueProto,
    profile: CandidateProfile | Callable[[ApplicationTask], CandidateProfile],
    agent_factory: Callable[[ApplicationTask], JupiterAgent],
    worker: str = "worker-1",
) -> tuple[ApplicationTask, str] | None:
    """Взять одну задачу и довести её. None — брать нечего."""
    task = queue.lease(worker)
    if task is None:
        return None

    try:
        resolved = profile(task) if callable(profile) else profile
    except Exception as exc:
        state = queue.fail(task.id, f"Candidate profile unavailable: {exc}", retryable=False)
        return task, state

    heartbeat = getattr(queue, "heartbeat", None)
    stop_heartbeat = threading.Event()
    thread = None
    if callable(heartbeat):
        interval = getattr(queue, "heartbeat_interval", 60)

        def keep_lease() -> None:
            while not stop_heartbeat.wait(interval):
                try:
                    if not heartbeat(task.id):
                        log.error("lease lost while processing task %s", task.id)
                        break
                except Exception:
                    log.exception("could not renew lease for task %s", task.id)

        thread = threading.Thread(target=keep_lease, daemon=True)
        thread.start()

    try:
        agent = agent_factory(task)
        queue.checkpoint(task.id, TaskState.OPENING_APPLICATION, {
            "url": task.vacancy_url,
        })
        if task.resume_token:
            result = agent.resume(task.resume_token, resolved)
        else:
            result = agent.run(task.vacancy_url, resolved)
        return task, apply_result(queue, task, result)
    finally:
        stop_heartbeat.set()
        if thread is not None:
            thread.join(timeout=2)
        _cleanup_resume(resolved)
