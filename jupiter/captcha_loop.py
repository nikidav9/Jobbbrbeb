"""Капча через человека: показать картинку кандидату в приложении и ввести его ответ.

Капчу Jupiter не решает сам и никому не отдаёт на распознавание — её решает
только кандидат. Здесь лишь доставка: снимок капчи уходит в очередь, приложение
показывает его человеку, ответ возвращается и вводится в ту же живую страницу.

Ответ человека нигде не логируется и не попадает в траекторию: это одноразовый
секрет той страницы, в истории отклика ему не место.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

log = logging.getLogger("jupiter")

SOLVED = "solved"
FAILED = "failed"
EXPIRED = "expired"
UNSUPPORTED = "unsupported"

# Больше двух капч на одну заявку — сайт, скорее всего, гоняет по кругу;
# дальше пусть человек разбирается сам («Нужны вы»).
MAX_CAPTCHAS_PER_TASK = 2


def solve_with_human(
    engine: Any,
    queue: Any,
    task_id: str,
    *,
    wait_s: float = 600,
    poll_s: float = 5,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> str:
    """Показать капчу человеку и ввести ответ. 'solved'|'failed'|'expired'|'unsupported'."""
    info = engine.captcha()
    if info is None or not getattr(info, "transferable", False):
        return UNSUPPORTED

    queue.captcha_post(task_id, engine.captcha_png(info))
    deadline = clock() + wait_s
    while clock() < deadline:
        # Держим аренду, пока человек думает. Потеряли её — задача уже не наша,
        # вводить ответ и продолжать отклик нельзя.
        if queue.heartbeat(task_id) is False:
            return EXPIRED
        status, answer = queue.captcha_poll(task_id)
        if status == "answered":
            ok = bool(engine.enter_captcha(info, answer))
            answer = None
            outcome = SOLVED if ok else FAILED
            queue.captcha_result(task_id, outcome)
            return outcome
        if status == "expired":
            return EXPIRED
        sleep(poll_s)
    return EXPIRED


def can_ask_human(agent: Any, queue: Any) -> bool:
    """Есть ли у движка и очереди всё, чтобы передать капчу человеку.

    HTTP-движок капчу не показывает; dry-run не должен дёргать человека.
    """
    engine = getattr(agent, "engine", None)
    return (
        not getattr(agent, "dry_run", True)
        and callable(getattr(engine, "captcha", None))
        and callable(getattr(queue, "captcha_post", None))
    )


def continue_through_captcha(
    agent: Any,
    queue: Any,
    task_id: str,
    profile: Any,
    result: Any,
    *,
    solve: Callable[..., str] = solve_with_human,
    max_captchas: int = MAX_CAPTCHAS_PER_TASK,
) -> Any:
    """Пока агент упирается в капчу — отдать её человеку и продолжить с той же страницы.

    Не получилось (не та капча, неверный ответ, человек не ответил) —
    возвращается исходный результат CAPTCHA_REQUIRED, и заявка уходит в «Нужны вы».
    """
    from agent import Reason

    for _ in range(max_captchas):
        if result.reason_code != Reason.CAPTCHA_REQUIRED or not can_ask_human(agent, queue):
            return result
        try:
            outcome = solve(agent.engine, queue, task_id)
        except Exception as exc:
            # Сбой доставки не должен ронять заявку: остаётся «Нужны вы».
            log.warning("captcha handoff failed for task %s: %s", task_id, type(exc).__name__)
            return result
        log.info("captcha for task %s: %s", task_id, outcome)
        if outcome != SOLVED:
            return result
        trajectory = result.trajectory
        trajectory.append({"action": "captcha", "status": SOLVED, "by": "candidate"})
        result = agent._run_from_page(agent.engine.current_page(), profile, trajectory)
    return result
