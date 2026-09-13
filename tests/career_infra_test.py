#!/usr/bin/env python3
"""Устройство сборщика карьерных страниц: куда ему можно ходить.

Отличие от остальных сборщиков в том, что адрес задаёт человек в панели, а не
мы в коде. Значит, наш сервер по просьбе из базы пойдёт по чужому адресу — и
если правило адреса ослабить, тем же ходом можно попросить его сходить в
служебную сеть и принести оттуда ответ. Проверки ниже стерегут именно это.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
career = (root / "php-proxy/career.php").read_text(encoding="utf-8")
ingest = (root / "php-proxy/ingest.php").read_text(encoding="utf-8")
safe = (root / "php-proxy/safe_url.php").read_text(encoding="utf-8")
feed = (root / "php-proxy/career_feed.php").read_text(encoding="utf-8")
migration = (root / "supabase/migrations/063_career_pages_source.sql").read_text(encoding="utf-8")

failures = []


def check(name: str, condition: bool) -> None:
    if not condition:
        failures.append(name)


# ── Правило адреса одно на всех ───────────────────────────────────────────────
check("правило адреса живёт отдельно", "function ing_safe_https_url" in safe)
check("правило возвращает проверенный адрес для curl", "function ing_safe_https_resolve" in safe)
check("приёмник берёт общее правило", "require_once __DIR__ . '/safe_url.php';" in ingest)
check("сборщик берёт общее правило", "require_once __DIR__ . '/safe_url.php';" in career)
# Своя копия рано или поздно разойдётся с оригиналом — и всегда в сторону
# «чуть мягче».
for name, text in (("ingest.php", ingest), ("career.php", career), ("career_feed.php", feed)):
    check(f"{name} не заводит свою копию правила", "function ing_safe_https_url" not in text)

check("правило пускает только https", "!== 'https'" in safe)
check("правило отсекает служебные сети", "FILTER_FLAG_NO_PRIV_RANGE" in safe and "FILTER_FLAG_NO_RES_RANGE" in safe)
check("правило отсекает localhost", "'localhost'" in safe)

# ── Каждый адрес из панели проходит проверку ──────────────────────────────────
check("адреса из настроек фильтруются правилом", "ing_safe_https_url($u)" in career)
# Редирект увёл бы нас на адрес, который проверку не проходил: так её и обходят.
check("переходы по редиректу выключены", "CURLOPT_FOLLOWLOCATION => false" in career)
check("только https на уровне curl", "CURLOPT_PROTOCOLS => CURLPROTO_HTTPS" in career)
check("сборщик закрепляет проверенный DNS-адрес", "CURLOPT_RESOLVE => $resolveEntries" in career)
check("приёмник закрепляет проверенный DNS-адрес", "CURLOPT_RESOLVE => $resolveEntries" in ingest)
check("сертификат проверяется", "CURLOPT_SSL_VERIFYPEER => true" in career)
check("имя в сертификате проверяется", "CURLOPT_SSL_VERIFYHOST => 2" in career)
# Без предела чужой сервер кормил бы нас, пока не кончится память.
check("размер страницы ограничен", "$tooLarge = true" in career)
check("есть время ожидания", "CURLOPT_TIMEOUT" in career and "CURLOPT_CONNECTTIMEOUT" in career)
# Адрес закреплён через CURLOPT_RESOLVE, но фактический адрес соединения всё
# равно проверяем вторым рубежом.
check("адрес, к которому пришли, читается", "CURLINFO_PRIMARY_IP" in career)
# Проверяем само условие, а не наличие константы рядом: отключить сторожа,
# оставив константу на месте, — самый простой способ его потерять.
check("этот адрес проходит проверку на служебные сети",
      "if ($servedBy !== '' && !filter_var($servedBy, FILTER_VALIDATE_IP," in career
      and "FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {" in career)
check("непубличный ответ выбрасывается до разбора",
      career.index("CURLINFO_PRIMARY_IP") < career.index("cf_items("))
check("идентификатор источника ограничен по виду", "^[A-Za-z0-9._-]{1,64}$" in career)
# Выключенный источник не обслуживаем: миграция 063 заводит его выключенным
# намеренно, и открытая точка входа не должна обходить ручную проверку.
check("выключенный источник не обслуживается",
      "if (empty($source['enabled'])) {" in career and "'источник выключен'" in career)

# ── Разбор чужой разметки ─────────────────────────────────────────────────────
check("глубина обхода ограничена", "$depth > 8" in feed)
check("число вакансий со страницы ограничено", ">= 500" in feed)
check("разбор не ходит в сеть", "curl_" not in feed)
check("разбор не ходит в базу", "sb_" not in feed)

# ── Источник заводится выключенным ────────────────────────────────────────────
# Как заведён hh.ru миграцией 058: сначала ручная проверка объёма и качества,
# и только потом показ людям.
check("источник карьерных страниц заведён", "'career'" in migration)
check("источник выключен до ручной проверки",
      bool(re.search(r"insert into public\.jm_ext_sources.*?\bfalse\b", migration, re.S)))
check("включение не прячется в on conflict", "enabled = true" not in migration)

if failures:
    print("career pages infrastructure: ПРОВАЛЫ")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("career pages infrastructure: ok")
