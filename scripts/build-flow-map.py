#!/usr/bin/env python3
"""
Собирает макет приложения одним SVG: каждый экран — настоящий, разобранный
на слои, между ними стрелки переходов.

Экраны берутся из docs/screens-vector/*.svg — их делает scripts/shoot-screens.mjs
(снимает живое приложение) и scripts/icons-to-paths.py (переводит иконки-шрифт
в контуры). Здесь они вставляются векторами, а не картинками, поэтому в Figma
приезжают редактируемыми слоями.

Порядок:
    npx expo export -p web --output-dir .figma-export
    node scripts/shoot-screens.mjs
    python3 scripts/icons-to-paths.py
    python3 scripts/build-flow-map.py
"""
import json
import re
from pathlib import Path

W, H = 390, 844          # размер экрана телефона
COL, ROW = 580, 1210     # шаг сетки: зазоры под коридоры для стрелок

ORANGE = '#FF6B1A'
INK = '#111111'
MUTED = '#9CA3AF'
BG = '#F5F7FA'
GREEN = '#16A34A'
BLUE = '#2563EB'
PURPLE = '#7C3AED'

ROOT = Path(__file__).resolve().parent.parent
VEC = ROOT / 'docs' / 'screens-vector'

# ─── Экраны: подпись, файл в коде, зона ─────────────────────────────────
META = {
    'index':                      ('Стартовый экран',             'app/index.tsx', 0),
    'login':                      ('Вход',                        'app/login.tsx', 0),

    'register-worker-1':          ('Работник 1 · Телефон',        'app/register-worker.tsx', 1),
    'register-worker-2':          ('Работник 2 · Пароль',         'app/register-worker.tsx', 1),
    'register-worker-3':          ('Работник 3 · Имя',            'app/register-worker.tsx', 1),
    'register-worker-4':          ('Работник 4 · Согласие',       'app/register-worker.tsx', 1),
    'register-worker-5':          ('Работник 5 · Метро',          'app/register-worker.tsx', 1),
    'register-worker-5-picker':   ('Работник 5 · Выбор станции',  'components/feature/MetroPicker.tsx', 1),
    'register-worker-5-chosen':   ('Работник 5 · Станция выбрана','app/register-worker.tsx', 1),
    'register-worker-6':          ('Работник 6 · Специализация',  'app/register-worker.tsx', 1),
    'register-worker-6-selected': ('Работник 6 · Выбрана',        'app/register-worker.tsx', 1),

    'register-employer-1':        ('Работодатель 1 · Телефон',    'app/register-employer.tsx', 2),
    'register-employer-2':        ('Работодатель 2 · Пароль',     'app/register-employer.tsx', 2),
    'register-employer-3':        ('Работодатель 3 · Компания',   'app/register-employer.tsx', 2),
    'register-employer-4':        ('Работодатель 4 · Согласие',   'app/register-employer.tsx', 2),

    'feed-shift':                 ('Поиск · Смены',               'app/(tabs)/feed.tsx', 3),
    'matches':                    ('Мои отклики',                 'app/(tabs)/matches.tsx', 3),
    'exchange':                   ('Биржа',                       'app/(tabs)/exchange.tsx', 3),
    'chats':                      ('Сообщения',                   'app/(tabs)/chats.tsx', 3),
    'profile':                    ('Профиль',                     'app/(tabs)/profile.tsx', 3),

    'chat-room':                  ('Чат',                         'app/chat-room.tsx', 4),
    'perm-vacancy-detail':        ('Вакансия',                    'app/perm-vacancy-detail.tsx', 4),
    'user-profile':               ('Профиль работодателя',        'app/user-profile.tsx', 4),
    'match':                      ('Мэтч',                        'app/match.tsx', 4),
    'rate':                       ('Оценка смены',                'app/rate.tsx', 4),
    'legal':                      ('Документы',                   'app/legal.tsx', 4),

    'feed-employer':              ('Кабинет работодателя',        'app/(tabs)/feed.tsx', 5),
    'matches-employer':           ('Отклики на смены',            'app/(tabs)/matches.tsx', 5),
    'create-vacancy':             ('Создание смены',              'app/create-vacancy.tsx', 5),
    'create-perm-vacancy':        ('Создание вакансии',           'app/create-perm-vacancy.tsx', 5),
    'perm-applications':          ('Отклики на вакансии',         'app/perm-applications.tsx', 5),
    'profile-employer':           ('Профиль компании',            'app/(tabs)/profile.tsx', 5),
    'candidates':                 ('Кандидаты',                   'app/candidates.tsx', 5),
}

ZONES = {
    0: ('Вход', PURPLE),
    1: ('Регистрация работника', '#8B5CF6'),
    2: ('Регистрация работодателя', '#0EA5E9'),
    3: ('Работник · вкладки', ORANGE),
    4: ('Работник · вторичные', BLUE),
    5: ('Работодатель', GREEN),
}

# ─── Переходы (выписаны из router.push / router.replace) ────────────────
EDGES = [
    ('index', 'register-worker-1', 'Зарегистрироваться', 'n'),
    ('index', 'register-employer-1', 'Разместить вакансию', 'n'),
    ('index', 'login', 'Войти', 'n'),
    ('index', 'feed-shift', 'уже вошёл', 'r'),
    ('register-worker-6', 'feed-shift', 'Начать поиск', 'r'),
    ('register-employer-4', 'feed-employer', 'после регистрации', 'r'),
    ('register-worker-4', 'legal', 'документы в тексте', 'n'),
    ('login', 'feed-shift', 'вход выполнен', 'r'),

    ('feed-shift', 'match', 'взаимный лайк', 'n'),
    ('feed-shift', 'chat-room', 'написать', 'n'),
    ('feed-shift', 'perm-vacancy-detail', 'вкладка «Работа»', 'n'),
    ('matches', 'chat-room', 'Чат', 'n'),
    ('matches', 'user-profile', 'Профиль ›', 'n'),
    ('matches', 'rate', 'оценить смену', 'n'),
    ('exchange', 'chat-room', 'отклик', 'n'),
    ('chats', 'chat-room', 'открыть диалог', 'n'),
    ('profile', 'legal', 'Документы', 'n'),

    ('chat-room', 'user-profile', 'имя в шапке', 'n'),
    ('perm-vacancy-detail', 'user-profile', 'Профиль →', 'n'),
    ('match', 'chat-room', 'Написать в чат', 'n'),
    ('rate', 'feed-shift', 'после оценки', 'r'),

    ('feed-employer', 'create-vacancy', 'создать смену', 'n'),
    ('feed-employer', 'create-perm-vacancy', 'создать вакансию', 'n'),
    ('feed-employer', 'perm-applications', 'отклики', 'n'),
    ('feed-employer', 'candidates', 'кто откликнулся', 'n'),
    ('matches-employer', 'chat-room', 'Чат', 'n'),
    ('perm-applications', 'user-profile', 'Профиль ›', 'n'),
    ('profile-employer', 'legal', 'Документы', 'n'),
]


def step_edges(ids):
    """Шаги одной формы соединяем по порядку — «далее»."""
    out = []
    for prefix in ('register-worker', 'register-employer'):
        chain = [i for i in ids if i.startswith(prefix + '-')]
        chain.sort(key=lambda s: (int(re.search(r'-(\d+)', s).group(1)), s))
        out += [(a, b, 'далее', 'n') for a, b in zip(chain, chain[1:])]
    return out


GLOBAL_NOTES = [
    'Пуш и колокольчик открывают чат, Мэтчи, Ленту или Биржу (services/notificationRoute.ts)',
    'Нижняя панель переключает 5 вкладок: Поиск · Мэтчи · Биржа · Чаты · Профиль',
    'Экраны разобраны на слои: каждый прямоугольник, текст и иконка — отдельный объект',
]


def esc(s):
    return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def load_screen(sid):
    """Внутренности экрана: содержимое его <svg> без внешней обёртки."""
    f = VEC / f'{sid}.svg'
    if not f.exists():
        return None
    m = re.search(r'<svg[^>]*>(.*)</svg>\s*$', f.read_text(encoding='utf-8'), re.S)
    return m.group(1) if m else None


def build():
    ids = json.loads((VEC / 'index.json').read_text(encoding='utf-8'))
    ids = [i for i in ids if i in META and (VEC / f'{i}.svg').exists()]

    PER_ROW = 7
    screens, row = [], 0
    for zone in sorted(ZONES):
        zids = [i for i in ids if META[i][2] == zone]
        for k, sid in enumerate(zids):
            screens.append(dict(id=sid, title=META[sid][0], file=META[sid][1],
                                zone=zone, col=k % PER_ROW, row=row + k // PER_ROW))
        if zids:
            row += (len(zids) - 1) // PER_ROW + 1

    by_id = {s['id']: s for s in screens}
    edges = [e for e in EDGES + step_edges(ids) if e[0] in by_id and e[1] in by_id]

    max_col = max(s['col'] for s in screens)
    max_row = max(s['row'] for s in screens)
    total_w = 160 + (max_col + 1) * COL
    total_h = 340 + (max_row + 1) * ROW

    def xy(sc):
        return 80 + sc['col'] * COL, 240 + sc['row'] * ROW

    o = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
         f'width="{total_w}" height="{total_h}" viewBox="0 0 {total_w} {total_h}" '
         f'font-family="Inter, -apple-system, Segoe UI, Roboto, sans-serif">',
         f'<rect width="{total_w}" height="{total_h}" fill="#FAFAF8"/>',
         '<defs>'
         f'<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
         f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{ORANGE}"/></marker>'
         f'<marker id="ar2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
         f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{PURPLE}"/></marker>'
         '</defs>']

    o.append(f'<text x="80" y="76" font-size="42" font-weight="800" fill="{INK}">JobToo — макет приложения</text>')
    o.append(f'<text x="80" y="112" font-size="16" fill="{MUTED}">'
             f'{len(screens)} экранов, {len(edges)} переходов. Настоящие экраны, разобранные на слои</text>')
    lx = 80
    for z in sorted(ZONES):
        zt, zc = ZONES[z]
        o.append(f'<rect x="{lx}" y="136" width="14" height="14" rx="4" fill="{zc}"/>')
        o.append(f'<text x="{lx+22}" y="148" font-size="13" fill="{INK}">{esc(zt)}</text>')
        lx += 44 + len(zt) * 8

    # ── Стрелки по коридорам между фреймами ─────────────────────────────
    def lane_y(r, k):
        return 240 + r * ROW + H + 34 + (k % 9) * 30

    def corridor_x(c):
        return 80 + c * COL - (COL - W) / 2

    used = {}

    def lane(r):
        used[r] = used.get(r, 0) + 1
        return used[r] - 1

    for src, dst, label, style in edges:
        a, b = by_id[src], by_id[dst]
        ax, ay = xy(a)
        bx, by_ = xy(b)
        acx, bcx = ax + W / 2, bx + W / 2
        col = PURPLE if style == 'r' else ORANGE
        dash = ' stroke-dasharray="6 4"' if style == 'r' else ''
        marker = 'ar2' if style == 'r' else 'ar'

        if a['row'] == b['row'] and abs(a['col'] - b['col']) == 1:
            pts = ([(ax + W, ay + H / 2), (bx, by_ + H / 2)] if bx > ax
                   else [(ax, ay + H / 2), (bx + W, by_ + H / 2)])
            lx_, ly_ = (pts[0][0] + pts[1][0]) / 2, pts[0][1] - 10
        elif a['row'] == b['row']:
            y1 = lane_y(a['row'], lane(a['row']))
            pts = [(acx, ay + H), (acx, y1), (bcx, y1), (bcx, by_ + H)]
            lx_, ly_ = (acx + bcx) / 2, y1 - 6
        else:
            down = b['row'] > a['row']
            r1 = a['row'] if down else a['row'] - 1
            r2 = b['row'] - 1 if down else b['row']
            y1 = lane_y(r1, lane(r1))
            if r1 == r2:
                pts = [(acx, ay + H if down else ay), (acx, y1), (bcx, y1),
                       (bcx, by_ if down else by_ + H)]
                lx_, ly_ = (acx + bcx) / 2, y1 - 6
            else:
                y2 = lane_y(r2, lane(r2))
                cx_ = corridor_x(b['col'] if bcx > acx else b['col'] + 1)
                pts = [(acx, ay + H if down else ay), (acx, y1), (cx_, y1),
                       (cx_, y2), (bcx, y2), (bcx, by_ if down else by_ + H)]
                lx_, ly_ = (acx + cx_) / 2, y1 - 6

        d = 'M ' + ' L '.join(f'{px:.0f} {py:.0f}' for px, py in pts)
        o.append(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="2" opacity="0.8"'
                 f'{dash} stroke-linejoin="round" marker-end="url(#{marker})"/>')
        tw = 12 + len(label) * 6.2
        o.append(f'<rect x="{lx_-tw/2:.0f}" y="{ly_-13:.0f}" width="{tw:.0f}" height="19" rx="9" '
                 f'fill="#FAFAF8" stroke="{col}" stroke-opacity="0.35"/>')
        o.append(f'<text x="{lx_:.0f}" y="{ly_:.0f}" font-size="11" fill="{col}" '
                 f'text-anchor="middle">{esc(label)}</text>')

    # ── Фреймы с настоящим содержимым ───────────────────────────────────
    for sc in screens:
        x, y = xy(sc)
        zc = ZONES[sc['zone']][1]
        inner = load_screen(sc['id'])
        o.append(f'<g id="{esc(sc["id"])}" data-name="{esc(sc["title"])}">')
        o.append(f'<text x="{x}" y="{y-30}" font-size="17" font-weight="700" fill="{INK}">{esc(sc["title"])}</text>')
        o.append(f'<text x="{x}" y="{y-12}" font-size="11.5" fill="{MUTED}" font-family="monospace">{esc(sc["file"])}</text>')
        # Обрезка считается в системе координат самой группы, а она сдвинута
        # на (x, y). Поэтому прямоугольник задаём от нуля, иначе контур уезжает
        # вдвое дальше и срезает всё содержимое экрана.
        o.append(f'<clipPath id="clip-{esc(sc["id"])}"><rect x="0" y="0" width="{W}" height="{H}" rx="34"/></clipPath>')
        o.append(f'<g clip-path="url(#clip-{esc(sc["id"])})" transform="translate({x} {y})">')
        o.append(inner if inner else f'<rect width="{W}" height="{H}" fill="{BG}"/>')
        o.append('</g>')
        o.append(f'<rect x="{x}" y="{y}" width="{W}" height="{H}" rx="34" fill="none" stroke="{zc}" stroke-width="2.5"/>')
        o.append('</g>')

    ny = 240 + (max_row + 1) * ROW - 130
    o.append(f'<text x="80" y="{ny}" font-size="15" font-weight="700" fill="{INK}">Отдельно</text>')
    for i, note in enumerate(GLOBAL_NOTES):
        o.append(f'<text x="80" y="{ny+26+i*22}" font-size="13" fill="{MUTED}">• {esc(note)}</text>')

    o.append('</svg>')
    return '\n'.join(o), len(screens), len(edges)


if __name__ == '__main__':
    svg, n_scr, n_edge = build()
    out = ROOT / 'docs' / 'jobtoo-flow-map.svg'
    out.write_text(svg, encoding='utf-8')
    print(f'{out}  ({out.stat().st_size // 1024} KB, {n_scr} экранов, {n_edge} переходов)')
