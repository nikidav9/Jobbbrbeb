#!/usr/bin/env python3
from pathlib import Path

p = Path('docs/ручные-шаги.md')
s = p.read_text(encoding='utf-8')

def repl(old: str, new: str, label: str) -> None:
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{label}: expected one exact anchor, found {n}')
    s = s.replace(old, new, 1)

repl(
    '### А5. Перенос регистрации в Timeweb — идёт',
    '### А5. Перенос регистрации в Timeweb — завершён ✅',
    'heading',
)

repl(
'''\> ⏳ **Запущен 18 августа.** Серверы имён уже переключены на Timeweb, зона там
> боевая, делегирование в реестре обновилось. Заявка на смену регистратора
> принята — в whois домена стоит `reg-ch: TIMEWEB-RU`. Перенос `.ru` занимает
> несколько дней; всё это время домен лучше не трогать.
>
> Осталось после завершения: **включить автопродление** в Timeweb. Это
> единственная поломка во всей системе, которую нельзя откатить — домен просто
> не продлится, и приложение перестанет существовать.
'''.replace('\\>', '>'),
'''\> ✅ **Перенос завершён.** Проверено публичным WHOIS 15 сентября 2026:
> регистратор — `TIMEWEB-RU`, authoritative NS — `ns1.timeweb.ru`,
> `ns2.timeweb.ru`, `ns3.timeweb.org`, `ns4.timeweb.org`. Домен оплачен до
> **23.05.2027**.
>
> Из кабинета остаётся проверить **автопродление**. Публичный WHOIS не показывает
> эту настройку, поэтому её нельзя честно отметить выполненной из кода. Если
> автопродление выключено — включите его в Timeweb.
'''.replace('\\>', '>'),
    'status block',
)

repl(
    '4. ⏳ **Перенос регистрации идёт** — ждём реестр.',
    '4. ✅ **Перенос регистрации завершён** — WHOIS показывает `TIMEWEB-RU`.',
    'checklist',
)

repl(
'''\> **Код переноса (authinfo) надо перевыпустить.** Тот, что прислала поддержка,
> побывал в переписке, а он равносилен ключу от домена: с ним `jobtoo.ru`
> переносится к другому регистратору без вашего участия. В кабинете Рег.ру
> запросите новый — старый при этом перестаёт работать. И проверьте, что стоит
> запрет на передачу (transfer lock); снимать его надо только на время
> переноса.
'''.replace('\\>', '>'),
'''\> **Старый authinfo больше не нужен для завершённого переноса.** Не храните и
> не переиспользуйте код, который уже попадал в переписку. Для любого будущего
> переноса выпускайте новый код непосредственно перед операцией и держите
> transfer lock включённым в остальное время.
'''.replace('\\>', '>'),
    'authinfo note',
)

for needle in ['registrar:     TIMEWEB-RU', 'state:         REGISTERED, DELEGATED']:
    if needle in s:
        raise SystemExit('raw WHOIS output should not be pasted into manual steps')
if '### А5. Перенос регистрации в Timeweb — завершён ✅' not in s:
    raise SystemExit('completed registrar heading missing')
if '**23.05.2027**' not in s:
    raise SystemExit('paid-till date missing')

p.write_text(s, encoding='utf-8')
print('registrar status patch applied')
