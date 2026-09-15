#!/usr/bin/env python3
"""Забирать сообщения бота самим, вместо того чтобы Телеграм звонил нам.

Почему не вебхук. Телеграм отвечает на попытку его поставить дословно:
«bad webhook: IPv6-only addresses are not allowed». То есть адрес без записи
A он не принимает вовсе. А по IPv4 эта машина с ним не разговаривает ни в
одну сторону: наружу 0 ответов из 2 в каждом замере, внутрь —
«Connection timed out». Путь сломан, и починить его с нашей стороны нечем.

Отсюда обратный ход: не ждать звонка, а звонить самим. getUpdates — это
исходящий запрос, а исходящие по IPv6 работают. Вебхук и getUpdates у одного
бота взаимоисключающие, поэтому этот процесс является единственным владельцем
входящего Telegram-контура и снимает любой случайно поставленный webhook.

Устройство простое до скуки. Держим соединение 25 секунд, получаем пачку
обновлений, отдаём каждое своему же обработчику, запоминаем номер последнего
только ПОСЛЕ успешной обработки. Номер — на диске: перезапуск службы не должен
приводить к тому, что человек получит вчерашний ответ дважды.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

OFFSET_FILE = "/var/lib/jt-tg-offset"
BEAT_FILE = "/var/lib/jt-tg-beat"
STATS_FILE = "/var/lib/jt-tg-poll-stats.json"
DEAD_FILE = "/var/lib/jt-tg-dead-letters.jsonl"
LOCAL = "https://jobtoo.ru/api/tg.php"

# Сколько раз пытаться отдать ОДИН И ТОТ ЖЕ update, прежде чем признать его
# неотправляемым и пойти дальше.
#
# Предел здесь не про аккуратность, а про то, чтобы бот вообще жил. Без него
# неудачная доставка возвращала offset на место и делала break: Телеграм отдавал
# тот же update снова каждые три секунды, и так вечно. Один update, который наш
# обработчик принять не может, останавливал бота НАВСЕГДА — вместе со всеми
# сообщениями и нажатиями кнопок, вставшими за ним в очередь. Снаружи это
# выглядит как «бот молчит», а сторож при этом зелёный: отметку живости
# обновляет успешный getUpdates, который и продолжает успешно приходить.
#
# Пять попыток с паузой в три секунды — это четверть минуты на перезапуск
# обработчика. Больше ждать незачем: если он не поднялся, следующие update
# тоже не пройдут и упрутся в свой предел.
DELIVER_MAX_ATTEMPTS = 5

# Полтора мегабайта мёртвых писем — это уже не «редкий сбой», а поломка,
# которую видно в отчёте. Держим один прошлый файл и не растём бесконечно.
DEAD_FILE_MAX_BYTES = 1_500_000


def secret(name: str) -> str:
    """Прочитать актуальный серверный секрет через тот же PHP-контейнер."""
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "php", "php", "-r",
         '$s = @include "/var/www/api/app_secrets.php";'
         f'echo is_array($s) ? ($s["{name}"] ?? "") : "";'],
        cwd="/opt/jobtoo/infra", capture_output=True, timeout=30,
    )
    return out.stdout.decode("utf-8", "replace").strip()


def record_api_result(attempts, ok: bool, mode: str, error: str) -> None:
    now = int(time.time())
    try:
        with open(STATS_FILE, encoding="utf-8") as f:
            stats = json.load(f)
        if not isinstance(stats, dict):
            stats = {}
    except Exception:
        stats = {}

    stats.setdefault("since", now)
    stats["requests"] = int(stats.get("requests", 0)) + 1
    for attempt_mode, reached in attempts:
        key = "ipv6" if attempt_mode == "ipv6" else "fallback"
        stats[f"{key}_attempts"] = int(stats.get(f"{key}_attempts", 0)) + 1
        if reached:
            stats[f"{key}_reached"] = int(stats.get(f"{key}_reached", 0)) + 1

    stats["last_attempt"] = now
    stats["last_mode"] = mode
    if ok:
        stats["ok"] = int(stats.get("ok", 0)) + 1
        stats["consecutive_failures"] = 0
        stats["last_success"] = now
        stats["last_error"] = ""
    else:
        stats["failed"] = int(stats.get("failed", 0)) + 1
        stats["consecutive_failures"] = int(stats.get("consecutive_failures", 0)) + 1
        stats["last_failure"] = now
        stats["last_error"] = error[:200]

    tmp = f"{STATS_FILE}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, STATS_FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def api(token: str, method: str, params: dict, timeout: int) -> dict:
    """Запрос к Телеграму: сначала IPv6, затем системный маршрут."""
    url = f"https://api.telegram.org/bot{token}/{method}"
    base = ["curl", "-sS", "-m", str(timeout + 10), url]
    for key, value in params.items():
        base += ["-d", f"{key}={value}"]

    def attempt(cmd):
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=timeout + 20)
        except Exception as exc:
            return {}, False, type(exc).__name__

        raw = out.stdout.decode("utf-8", "replace")
        try:
            payload = json.loads(raw or "null")
        except json.JSONDecodeError:
            payload = None
        reached = out.returncode == 0 and isinstance(payload, dict) and bool(payload)
        if reached:
            error = str(payload.get("description") or payload.get("error_code") or "")
            return payload, True, error
        stderr = out.stderr.decode("utf-8", "replace").strip()
        error = stderr or f"curl={out.returncode}, body={raw[:80]}"
        return {}, False, error.replace(token, "[token]")

    attempts = []
    payload, reached, error = attempt(base[:1] + ["-6"] + base[1:])
    attempts.append(("ipv6", reached))
    if reached:
        ok = bool(payload.get("ok"))
        record_api_result(attempts, ok, "ipv6", "" if ok else error)
        return payload

    payload, fallback_reached, fallback_error = attempt(base)
    attempts.append(("fallback", fallback_reached))
    ok = bool(payload.get("ok")) if fallback_reached else False
    record_api_result(
        attempts, ok, "fallback" if fallback_reached else "none",
        "" if ok else (fallback_error or error),
    )
    return payload if fallback_reached else {}


def deliver(update: dict, app_secret: str) -> tuple:
    """Отдать update обработчику. Возвращает (успех, отказ_окончательный).

    Второе значение — разница между «обработчик сейчас недоступен» и
    «обработчик посмотрел и сказал, что принять это не может». Раньше наружу
    шёл один bool, и эти два случая лечились одинаково — повтором. Для второго
    случая повтор не поможет никогда, сколько ни жди.

    Окончательными считаем 400, 404, 413 и 422: обработчик разобрал запрос и
    отказался. А вот 401 и 403 — НЕ окончательные, хотя тоже 4xx: их даёт
    разъехавшийся APP_SECRET, и он подхватывается при следующей попытке. Пусть
    такие отказы уходят в общий предел попыток, а не отбрасывают update сразу.
    """
    body = json.dumps(update, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(LOCAL, data=body, headers={
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": app_secret,
    })
    try:
        urllib.request.urlopen(req, timeout=30).read()
        return True, False
    except urllib.error.HTTPError as e:
        print(f"обработчик ответил {e.code}", file=sys.stderr, flush=True)
        return False, e.code in (400, 404, 413, 422)
    except Exception as e:
        print(f"обработчик недоступен: {e}", file=sys.stderr, flush=True)
    return False, False


def drop_update(update: dict, reason: str) -> None:
    """Признать update неотправляемым: записать и пойти дальше.

    Молча выбрасывать нельзя — это чьё-то сообщение боту. Поэтому кладём его
    целиком в отдельный файл: разобрать причину можно будет потом, а бот
    продолжит работать сейчас.
    """
    try:
        if os.path.getsize(DEAD_FILE) > DEAD_FILE_MAX_BYTES:
            os.replace(DEAD_FILE, DEAD_FILE + ".old")
    except OSError:
        pass
    try:
        with open(DEAD_FILE, "a", encoding="utf-8") as f:
            json.dump({"at": int(time.time()), "reason": reason, "update": update},
                      f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
    except Exception:
        pass

    # Счётчик — в тот же файл замеров, что читает суточный отчёт. Брошенный
    # update обязан быть видимым: иначе починка превратит «бот стоит» в «бот
    # тихо теряет сообщения», а это не лучше.
    try:
        try:
            with open(STATS_FILE, encoding="utf-8") as f:
                stats = json.load(f)
            if not isinstance(stats, dict):
                stats = {}
        except Exception:
            stats = {}
        stats["dropped"] = int(stats.get("dropped", 0)) + 1
        stats["last_drop"] = int(time.time())
        stats["last_drop_reason"] = reason[:200]
        tmp = f"{STATS_FILE}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, STATS_FILE)
    except Exception:
        pass

    print(f"update {update.get('update_id')} брошен: {reason}",
          file=sys.stderr, flush=True)


def webhook_conflict(payload: dict) -> bool:
    """Telegram не даст getUpdates, пока у того же бота висит webhook."""
    if int(payload.get("error_code") or 0) != 409:
        return False
    text = str(payload.get("description") or "").lower()
    return "webhook" in text or "getupdates" in text


def main() -> int:
    token = secret("TG_BOT_TOKEN")
    app_secret = secret("APP_SECRET")
    if not token:
        print("нет токена бота", file=sys.stderr)
        return 1

    # Polling — канонический ingress. Любой webhook на этом же боте блокирует
    # getUpdates, независимо от того, кто и зачем его поставил. Снимаем без
    # удаления накопленной очереди.
    info = api(token, "getWebhookInfo", {}, 15).get("result", {})
    url = info.get("url", "")
    if url:
        cleared = api(token, "deleteWebhook", {"drop_pending_updates": "false"}, 15)
        if cleared.get("ok"):
            print(f"снял конфликтующий вебхук {url}", flush=True)
        else:
            print(f"не удалось снять конфликтующий вебхук {url}", file=sys.stderr, flush=True)

    try:
        offset = int(open(OFFSET_FILE).read().strip())
    except Exception:
        offset = 0

    # Какой update сейчас застрял и сколько раз мы уже пробовали его отдать.
    # Снаружи цикла: неудачная доставка возвращает нас к getUpdates, и тот же
    # update приходит заново — счётчик внутри цикла обнулялся бы каждый раз, а
    # предел попыток не набирался бы никогда.
    stuck_id = None
    stuck_attempts = 0

    while True:
        r = api(token, "getUpdates",
                {"offset": offset, "timeout": 25, "allowed_updates":
                 '["message","callback_query","my_chat_member"]'}, 25)

        if not r.get("ok"):
            # Если кто-то поставил webhook уже ПОСЛЕ старта службы, не ждём
            # рестарта: снимаем конфликт сами и продолжаем с тем же offset.
            if webhook_conflict(r):
                cleared = api(token, "deleteWebhook", {"drop_pending_updates": "false"}, 15)
                if cleared.get("ok"):
                    print("снял webhook, мешавший getUpdates", file=sys.stderr, flush=True)
                    time.sleep(1)
                    continue

            # Ротация токена не должна требовать ручного рестарта службы.
            if int(r.get("error_code") or 0) == 401:
                fresh = secret("TG_BOT_TOKEN")
                if fresh and fresh != token:
                    token = fresh
                    print("подхватил новый токен бота", file=sys.stderr, flush=True)
                    time.sleep(1)
                    continue

            # Обрыв связи или иной отказ. Сообщения не подтверждаем и
            # следующий успешный запрос продолжит с прежнего offset.
            time.sleep(3)
            continue

        # Отметка живости означает успешный ответ Telegram, а не просто
        # очередную попытку. Иначе сторож молчит именно во время тайм-аутов.
        try:
            with open(BEAT_FILE, "w", encoding="utf-8") as f:
                f.write(str(int(time.time())))
        except Exception:
            pass

        for upd in r.get("result", []):
            t0 = time.time()
            uid = int(upd.get("update_id", 0))
            ok, permanent = deliver(upd, app_secret)
            if not ok:
                # APP_SECRET мог смениться без рестарта poller. Перечитываем и
                # пробуем ровно один раз.
                fresh_secret = secret("APP_SECRET")
                if fresh_secret:
                    app_secret = fresh_secret
                ok, permanent = deliver(upd, app_secret)
            if not ok:
                # Считаем попытки именно по этому update_id. Счётчик живёт
                # снаружи цикла: после break мы вернёмся к getUpdates и получим
                # тот же update заново — без памяти между заходами предел
                # никогда бы не набрался.
                if uid == stuck_id:
                    stuck_attempts += 1
                else:
                    stuck_id, stuck_attempts = uid, 1

                if permanent or stuck_attempts >= DELIVER_MAX_ATTEMPTS:
                    drop_update(upd, "обработчик отказал окончательно" if permanent
                                else f"не доставлен за {stuck_attempts} попыток")
                    offset = max(offset, uid + 1)
                    try:
                        open(OFFSET_FILE, "w").write(str(offset))
                    except Exception:
                        pass
                    stuck_id, stuck_attempts = None, 0
                    # Именно continue, а не break: очередь за битым update
                    # должна идти дальше, ради этого всё и делается.
                    continue

                print(f"update {uid} не подтверждён (попытка {stuck_attempts}"
                      f" из {DELIVER_MAX_ATTEMPTS}) — offset сохранён для повтора",
                      file=sys.stderr, flush=True)
                time.sleep(3)
                break

            if uid == stuck_id:
                stuck_id, stuck_attempts = None, 0

            dt = time.time() - t0
            kind = "сообщение" if "message" in upd else "кнопка" if "callback_query" in upd else "прочее"
            print(f"{time.strftime('%H:%M:%S')} {kind} обработано за {dt:.1f}с", flush=True)
            offset = max(offset, int(upd.get("update_id", 0)) + 1)
            try:
                open(OFFSET_FILE, "w").write(str(offset))
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
