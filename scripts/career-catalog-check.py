#!/usr/bin/env python3
"""Проверка кандидатов в каталог карьерных сайтов (scripts/career-sites.tsv).

Запуск: python3 scripts/career-catalog-check.py кандидаты.txt итог.json
Строка кандидатов: сектор|название|адрес1|адрес2|… — адреса раздела вакансий
и главная сайта (путь «/»).

Для каждой компании: пробуем заданные адреса раздела вакансий; адрес
засчитывается, только если отвечает 200, не уводит на hh/SuperJob и не
является «мягкой 404» (SPA, которая на любой путь отдаёт одну и ту же
оболочку). Не вышло — ищем ссылку «Вакансии/Карьера» на главной.
"""
import concurrent.futures as cf
import json
import re
import subprocess
import sys
from urllib.parse import urljoin, urlsplit

UA = 'JobTooCatalogCheck/1.0 (+https://jobtoo.ru; support@jobtoo.ru)'
BANNED = re.compile(r'(^|\.)(hh\.ru|headhunter\.ru|superjob\.ru|zarplata\.ru|rabota\.ru|avito\.ru)$')
LINK_WORD = re.compile(r'ваканс|карьер|career|vacanc|/jobs?\b|работа у нас|работа в|karera|rabota', re.I)


def fetch(url):
    try:
        out = subprocess.run(
            ['curl', '-sSL', '-m', '25', '--max-redirs', '6', '-A', UA,
             '-H', 'Accept-Language: ru', '-o', '-', '-w', '\n@@@%{http_code} %{url_effective}', url],
            capture_output=True, timeout=40)
        raw = out.stdout.decode('utf-8', 'replace')
        body, _, tail = raw.rpartition('\n@@@')
        code, _, final = tail.partition(' ')
        return int(code or 0), final.strip(), body
    except Exception:
        return 0, url, ''


def host(u):
    return (urlsplit(u).hostname or '').lower()


def same_site(a, b):
    ha, hb = host(a).split('.'), host(b).split('.')
    return ha[-2:] == hb[-2:]


def soft404(url, body):
    probe = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}/jt-no-such-page-7f3a9"
    c, _, b = fetch(probe)
    if c != 200:
        return False
    return abs(len(b) - len(body)) <= max(200, len(body) * 0.03)


def ok_page(url):
    code, final, body = fetch(url)
    if code != 200:
        return None, code
    if BANNED.search(host(final)):
        return None, 'hh'
    if not same_site(url, final) and not LINK_WORD.search(final):
        return None, 'offsite'
    if re.search(r'<title>[^<]*(404|не найден|not found)', body, re.I):
        return None, 404
    if urlsplit(final).path not in ('', '/') and soft404(final, body):
        return None, 'soft404'
    return final, 200


def links(base, body):
    out = []
    for m in re.finditer(r'<a\b[^>]*href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', body, re.I | re.S):
        href, text = m.group(1), re.sub(r'<[^>]+>', ' ', m.group(2))
        full = urljoin(base, href)
        if not full.startswith('https://'):
            continue
        if LINK_WORD.search(text) or LINK_WORD.search(urlsplit(full).path + ' ' + host(full)):
            out.append(full)
    return list(dict.fromkeys(out))


def check(line):
    sector, name, *urls = line.split('|')
    tried = []
    roots = [u for u in urls if urlsplit(u).path in ('', '/')]
    for u in [u for u in urls if u not in roots]:
        final, why = ok_page(u)
        tried.append(f'{u}:{why}')
        if final:
            return {'name': name, 'sector': sector, 'url': final, 'how': 'direct', 'tried': tried}
    for r in roots:
        code, final, body = fetch(r)
        tried.append(f'{r}:{code}')
        if code != 200 or BANNED.search(host(final)):
            continue
        for cand in links(final, body)[:6]:
            if BANNED.search(host(cand)):
                continue
            got, why = ok_page(cand)
            tried.append(f'{cand}:{why}')
            if got:
                return {'name': name, 'sector': sector, 'url': got, 'how': 'link', 'tried': tried}
    # Сайт жив, но раздел отсюда не проверить (защита от ботов, 401/403):
    # целью разведки становится главная, раздел найдёт разведка из Москвы.
    for t in tried:
        u, _, code = t.rpartition(':')
        if u in roots and code.isdigit() and int(code) in (200, 401, 403, 450, 451, 429):
            return {'name': name, 'sector': sector, 'url': u, 'how': f'root-{code}', 'tried': tried}
    return {'name': name, 'sector': sector, 'url': None, 'how': 'none', 'tried': tried}


def main():
    lines = [l.strip() for l in open(sys.argv[1], encoding='utf-8') if l.strip() and not l.startswith('#')]
    with cf.ThreadPoolExecutor(12) as ex:
        res = list(ex.map(check, lines))
    json.dump(res, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('found', sum(1 for r in res if r['url']), 'of', len(res))


main()
