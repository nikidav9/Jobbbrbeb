#!/usr/bin/env python3
"""Цепочка приглашения целиком: от ссылки до записи на сервере.

Эта проверка написана по следам собственной ошибки. Серверная часть
приглашения была сделана и покрыта тестами, но код приглашения ей никто не
передавал: dbUpsertUser звался с одним доводом, а `startapp=ref_...` не
разбирал никто. Механизм был исправен и при этом не мог сработать ни разу —
а тесты на нём были зелёные, потому что проверяли только сервер.

Поэтому здесь проверяется не правильность звена, а НЕПРЕРЫВНОСТЬ: каждое
звено должно быть связано со следующим. Обрыв в любом месте гасит программу
целиком и делает это молча.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
layout = (root / "app/_layout.tsx").read_text(encoding="utf-8")
storage = (root / "services/storage.ts").read_text(encoding="utf-8")
dbts = (root / "services/db.ts").read_text(encoding="utf-8")
ctx = (root / "contexts/AppContext.tsx").read_text(encoding="utf-8")
dbphp = (root / "php-proxy/db.php").read_text(encoding="utf-8")
referral = (root / "php-proxy/referral.php").read_text(encoding="utf-8")

failures = []


def check(name: str, condition: bool) -> None:
    if not condition:
        failures.append(name)


# 1. Ссылка разобрана.
check("ссылка ref_ разбирается", "ref_([A-Za-z0-9]{8})" in layout)
check("разобранный код сохраняется", "savePendingReferral(" in layout)
check("savePendingReferral импортирован", "savePendingReferral" in layout.split("\n\n")[0]
      or "savePendingReferral } from '@/services/storage'" in layout)

# 2. Код переживает путь до регистрации: между ссылкой и регистрацией
#    несколько экранов, а мини-приложение может перезапуститься.
for fn in ("savePendingReferral", "getPendingReferral", "clearPendingReferral"):
    check(f"{fn} есть в хранилище", f"export async function {fn}" in storage)
check("код кладётся в постоянное хранилище", "KEY_PENDING_REF" in storage)

# 3. Регистрация его забирает, передаёт и стирает.
check("регистрация забирает код", "getPendingReferral()" in ctx)
# Доводов у вызова стало больше — согласие на обработку данных уходит тем же
# заходом. Код приглашения по-прежнему вторым, но скобка за ним уже не
# закрывается, поэтому проверка смотрит на границу довода, а не на конец вызова.
check("код уходит в dbUpsertUser", re.search(r"dbUpsertUser\(u,\s*referralCode\s*[,)]", ctx) is not None)
# Чужой код, оставшийся в хранилище, был бы приписан следующему, кто
# зарегистрируется на этом телефоне.
check("код стирается после применения", "clearPendingReferral()" in ctx)

# 4. Клиентский слой действительно отправляет второй довод.
check("dbUpsertUser принимает код", "referralCode?: string" in dbts)
check("второй довод уходит на сервер",
      re.search(r"referralCode\s*\?\s*\[row,\s*referralCode\]\s*:\s*\[row\]", dbts) is not None)

# 5. Сервер его читает — тем же номером довода.
check("сервер читает второй довод", "jt_referral_attach($uid, (string)($args[1] ?? ''))" in dbphp)
check("код нормализуется перед поиском владельца", "ref_code_normalize($rawCode)" in dbphp)
# Приглашение пишется ОТДЕЛЬНОЙ операцией и после создания профиля: миграция
# 064 применяется руками, а деплой уезжает сам, и в промежутке колонки нет.
# Одной строкой с профилем это роняло бы регистрацию всем — PostgREST отвечает
# 400 на неизвестное поле, а sb() на 400 бросает исключение.
check("приглашение не пишется вместе с профилем",
      "$u['referral_code']" not in dbphp and "$u['invited_by']" not in dbphp)
# Искать try/catch по всему файлу нельзя: точка с re.S перепрыгивает границу
# функции и находит чужой обработчик. Вырезаем тело именно этой функции.
def body(name: str) -> str:
    start = dbphp.find(f"function {name}(")
    if start < 0:
        return ""
    end = dbphp.find("\n}\n", start)
    return dbphp[start:end] if end > start else dbphp[start:]

attach = body("jt_referral_attach")
check("функция приглашения на месте", attach != "")
check("сбой приглашения не роняет регистрацию",
      "try {" in attach and "} catch (Throwable" in attach)
check("приглашение пишется отдельной операцией", "sb_update('jm_users'" in attach)
check("правила приглашения подключены", "ref_can_attribute(" in dbphp)
check("код нормализуется по общему правилу", "function ref_code_normalize" in referral)

# 6. Человек может УЗНАТЬ свой код — иначе звать нечем.
check("есть операция про своё приглашение", "case 'dbGetMyReferral'" in dbphp)
check("операция сверяется с сессией", "'dbGetMyReferral' => 0," in dbphp)
check("клиент умеет её звать", "export async function dbGetMyReferral" in dbts)
# Код заводится при первом обращении: у зарегистрировавшихся до миграции 064
# его нет, и без этого программа была бы закрыта как раз для тех, кто уже
# пользуется сервисом и может кого-то позвать.
check("код выдаётся и старым пользователям", "jt_referral_code_unique()" in dbphp)

# 7. И не утекает к посторонним: USER_PUBLIC_COLS уходит при запросе ЛЮБОГО
#    человека. Чужой код в руках постороннего — это чужое вознаграждение.
cols = re.search(r"define\('USER_PUBLIC_COLS',(.*?)\]\)\);", dbphp, re.S)
check("USER_PUBLIC_COLS найдены", cols is not None)
if cols:
    check("кода приглашения нет в публичных колонках", "referral_code" not in cols.group(1))
    check("кто кого привёл — тоже не публично", "invited_by" not in cols.group(1))

if failures:
    print("referral chain: ПРОВАЛЫ")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("referral chain: ok")
