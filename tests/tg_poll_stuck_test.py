#!/usr/bin/env python3
"""Забор сообщений бота не должен вставать навсегда из-за одного update.

Почему тест функциональный, а не по строкам. Поломка здесь была не в том, что
кода не хватало, — код был, и выглядел осмысленно: не смог доставить, значит не
двигай offset, Телеграм отдаст снова. Ошибка в ПОВЕДЕНИИ этой логики во времени:
«снова» означало «тот же update каждые три секунды, вечно», а вместе с ним
стояла вся очередь. Проверка по наличию строк такое не ловит — она и на
сломанном коде была бы зелёной, потому что все нужные строки на месте.

Поэтому прогоняем настоящий main() с подменёнными сетью и обработчиком.
"""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('tgpoll', root / 'infra/tg-poll.py')
tg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tg)

failures = []


def check(name, ok):
    if not ok:
        failures.append(name)


class Stop(Exception):
    """Выход из бесконечного цикла забора."""


def run_poller(deliver_result, *, max_rounds=40, updates=None):
    """Прогнать main() на подменённых api/deliver/secret.

    Возвращает (сколько раз пробовали доставить, сколько раундов getUpdates,
    какие update_id обработчик увидел, финальный offset).
    """
    updates = updates if updates is not None else [{'update_id': 100, 'message': {'text': 'привет'}}]
    state = {'rounds': 0, 'seen': [], 'offset': None}

    def fake_api(token, method, params, timeout):
        if method == 'getWebhookInfo':
            return {'ok': True, 'result': {}}
        if method != 'getUpdates':
            return {'ok': True, 'result': {}}
        state['rounds'] += 1
        if state['rounds'] > max_rounds:
            raise Stop()
        off = int(params.get('offset', 0))
        state['offset'] = off
        # Телеграм отдаёт только то, что ещё не подтверждено сдвигом offset.
        return {'ok': True, 'result': [u for u in updates if u['update_id'] >= off]}

    def fake_deliver(update, app_secret):
        state['seen'].append(update['update_id'])
        return deliver_result(update)

    tg.api = fake_api
    tg.deliver = fake_deliver
    tg.secret = lambda name: 'token' if name == 'TG_BOT_TOKEN' else 'secret'
    tg.time.sleep = lambda s: None

    tmp = tempfile.mkdtemp()
    tg.OFFSET_FILE = f'{tmp}/offset'
    tg.BEAT_FILE = f'{tmp}/beat'
    tg.STATS_FILE = f'{tmp}/stats.json'
    tg.DEAD_FILE = f'{tmp}/dead.jsonl'

    try:
        tg.main()
    except Stop:
        pass
    return state, tmp


# ── 1. Битый update: обработчик отвечает 400 и будет отвечать так всегда ──────
# Это тот самый случай, ради которого всё и чинилось. Раньше бот вставал здесь
# навсегда; теперь должен признать update мёртвым и пойти дальше.
state, tmp = run_poller(lambda u: (False, True) if u['update_id'] == 100 else (True, False),
                        updates=[{'update_id': 100, 'message': {'text': 'битый'}},
                                 {'update_id': 101, 'message': {'text': 'следующий'}}])

check('битый update не повторяется бесконечно', state['seen'].count(100) <= 2)
check('очередь за битым update пошла дальше', 101 in state['seen'])

dead = Path(tmp, 'dead.jsonl')
check('брошенный update записан, а не потерян молча', dead.exists() and dead.read_text().strip() != '')
if dead.exists() and dead.read_text().strip():
    row = json.loads(dead.read_text().strip().split('\n')[0])
    check('в записи лежит сам update', row.get('update', {}).get('update_id') == 100)

stats = Path(tmp, 'stats.json')
check('брошенный update виден в замерах суточного отчёта',
      stats.exists() and int(json.loads(stats.read_text()).get('dropped', 0)) >= 1)


# ── 2. Обработчик временно недоступен: 503, повтор осмыслен ───────────────────
# Здесь сдаваться сразу нельзя — контейнер мог перезапускаться. Но и стоять
# вечно тоже: после предела попыток идём дальше.
state2, tmp2 = run_poller(lambda u: (False, False),
                          updates=[{'update_id': 200, 'message': {'text': 'а'}}])

check('временный отказ повторяется несколько раз',
      state2['seen'].count(200) > 2)
check('но не бесконечно: предел попыток сработал',
      state2['seen'].count(200) <= tg.DELIVER_MAX_ATTEMPTS * 2 + 2)
check('после предела offset сдвинулся', (state2['offset'] or 0) > 200)


# ── 3. Обычная работа не сломана ──────────────────────────────────────────────
state3, _ = run_poller(lambda u: (True, False),
                       updates=[{'update_id': 300, 'message': {'text': 'ок'}}])
check('успешный update доставлен один раз', state3['seen'].count(300) == 1)
check('offset сдвинулся после успеха', (state3['offset'] or 0) > 300)


if failures:
    print('tg poll stuck: ПРОВАЛЫ')
    for name in failures:
        print('  -', name)
    raise SystemExit(1)
print('tg poll stuck: ok; забор выходит из затора и не теряет сообщения молча')
