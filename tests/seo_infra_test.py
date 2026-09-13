#!/usr/bin/env python3
"""Проверки устройства SEO-части: robots, карта сайта, маршруты nginx.

Карта сайта больше не файл, а страница: в статическом файле не могло быть
вакансий, ради которых всё и затевалось. Поэтому проверяем не содержимое
файла, а то, что маршруты ведут туда, куда задумано, и что порядок правил
в nginx не сломан.
"""
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
robots = (root / "public/robots.txt").read_text(encoding="utf-8")
nginx = (root / "infra/nginx-site.conf").read_text(encoding="utf-8")

failures = []


def check(name: str, condition: bool) -> None:
    if not condition:
        failures.append(name)


# ── robots.txt ────────────────────────────────────────────────────────────────
check("robots указывает карту сайта", "Sitemap: https://jobtoo.ru/sitemap.xml" in robots)
check("robots закрывает /api/", "Disallow: /api/" in robots)
check("robots закрывает админку", "Disallow: /admin" in robots)

# Мини-приложение дописывает свои параметры к адресу, и для робота это дубли.
# Яндексу помогает Clean-param; без него бюджет обхода уходит на копии.
check("robots склеивает параметры мини-приложения", "Clean-param:" in robots)
check("склейка покрывает tgWebAppStartParam", "tgWebAppStartParam" in robots)

# Ботов ИИ-поиска не закрываем: запрет убрал бы нас из ответов ассистентов.
for bot in ("OAI-SearchBot", "PerplexityBot", "YandexAdditional"):
    check(
        f"бот {bot} не запрещён",
        not re.search(rf"User-agent:\s*{re.escape(bot)}\s*\nDisallow:\s*/\s*$", robots, re.M),
    )

# ── маршруты nginx ────────────────────────────────────────────────────────────
check("карта сайта отдаётся страницей, а не файлом", "sitemap.php" in nginx)
check("статического sitemap.xml больше нет", not (root / "public/sitemap.xml").exists())
check("robots.txt остался файлом", "try_files /robots.txt =404" in nginx)

check("есть маршрут сводной страницы", "location ~ ^/rabota/" in nginx)
check("сводные страницы подключены", "landing_page.php" in nginx)
check("есть маршрут постоянной вакансии", "location ~ ^/v/" in nginx)
check("есть маршрут смены", "location ~ ^/s/" in nginx)
check("страница вакансии подключена", "vacancy_page.php" in nginx)

# QUERY_STRING должен идти ПОСЛЕ include fastcgi_params: тот выставляет его из
# $query_string и затёр бы наш, а страница осталась бы без идентификатора.
for block in re.findall(r"location ~ \^/(?:[vs]|rabota)/[^{]*\{(.*?)\n    \}", nginx, re.S):
    check(
        "QUERY_STRING задан после include fastcgi_params",
        block.index("include fastcgi_params") < block.index("fastcgi_param QUERY_STRING"),
    )

# Порядок регулярных location в nginx — порядок их появления в файле. Правило о
# путях с расширением обязано стоять ПОСЛЕ страниц вакансий: идентификатор может
# содержать точку, и тогда вакансия отдавала бы 404 вместо страницы.
ext_rule = nginx.index("(?!api/|rest/|realtime/|storage/)")
check("страницы вакансий объявлены раньше правила о расширениях", nginx.index("location ~ ^/v/") < ext_rule)
check("страницы смен объявлены раньше правила о расширениях", nginx.index("location ~ ^/s/") < ext_rule)
check("сводные страницы объявлены раньше правила о расширениях", nginx.index("location ~ ^/rabota/") < ext_rule)

# То, что чинили раньше, должно остаться целым.
check("несуществующий файл отдаёт 404", "try_files $uri =404" in nginx)
check("маршрутизация приложения на месте", "try_files $uri $uri/ /index.html" in nginx)

# ── сами страницы ─────────────────────────────────────────────────────────────
for php in ("vacancy_page.php", "sitemap.php", "vacancy_url.php", "landing_page.php"):
    path = root / "php-proxy" / php
    check(f"{php} существует", path.exists())
    if path.exists():
        done = subprocess.run(["php", "-l", str(path)], capture_output=True, text=True)
        check(f"{php} без синтаксических ошибок", done.returncode == 0)

page = (root / "php-proxy/vacancy_page.php").read_text(encoding="utf-8")
check("страница отдаёт разметку JobPosting", "JobPosting" in page)
check("есть канонический адрес", 'rel="canonical"' in page)
# Закрытую вакансию не удаляем: страница накопила вес, а ссылки на неё остались
# снаружи. Вместо удаления — отметка и срок действия в прошлом.
check("закрытая вакансия остаётся страницей", "вакансия закрыта" in page.lower())

# Сбой базы не должен выглядеть как «страницы нет». Без строгого режима sb()
# возвращает пустой список: сводная страница проваливается под порог и отдаёт
# 404, карта сайта — 200 с одними статическими адресами. И то и другое
# сообщает поисковику, что сайт опустел, и он выбрасывает страницы из выдачи.
sitemap_src = (root / "php-proxy/sitemap.php").read_text(encoding="utf-8")
landing_src = (root / "php-proxy/landing_page.php").read_text(encoding="utf-8")
vacancy_src = (root / "php-proxy/vacancy_page.php").read_text(encoding="utf-8")
for name, text in (("карта сайта", sitemap_src), ("сводные страницы", landing_src),
                   ("страница вакансии", vacancy_src)):
    check(f"{name}: строгий режим базы включён", "define('SB_STRICT', true)" in text)
    check(f"{name}: при сбое базы отдаётся 503", "http_response_code(503)" in text)
    check(f"{name}: роботу сказано вернуться", "Retry-After" in text)

# Тонкая страница без содержания понижает весь сайт, а не только себя, поэтому
# у сводных страниц есть порог, ниже которого страницы не существует.
landing = (root / "php-proxy/landing_page.php").read_text(encoding="utf-8")
check("у сводных страниц есть порог", "LP_MIN" in landing)
check("карта сайта берёт перечень у самих страниц", "lp_index()" in (root / "php-proxy/sitemap.php").read_text(encoding="utf-8"))

if failures:
    print("seo infrastructure: ПРОВАЛЫ")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("seo infrastructure: OK")
