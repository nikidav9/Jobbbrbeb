#!/bin/bash
# Разведка анкет отклика с московского адреса — раз в сутки.
#
# Зачем на сервере, а не в облаке разработчика: из облака 45 разделов
# каталога отвечали 403/401/451 или рвали соединение — похоже на отсечение
# иностранных адресов. Боевой Jupiter ходит отсюда, и честная картина —
# отсюда же.
#
# Что делает: jupiter/recon.py в dry-run (движок read_only, только GET и
# HEAD, синтетический кандидат, заявки не уходят) и кладёт итог файлом,
# который nginx отдаёт как /jupiter-recon.json. В файле только адреса
# работодателей и устройство их анкет — ничего о людях.
#
# Подпись — честная, Jupiter: браузерную (--ua-retry) отсюда не шлём, этот
# адрес подаёт настоящие отклики. Четыре потока: сайты работодателей не
# должны видеть от нас всплеск.
set -u

REPO=/opt/jobtoo
OUT=/var/www/html/jupiter-recon.json
LOG=/var/log/jt-recon.log

cd "$REPO/jupiter" || exit 0
echo "$(date -Is) start" >>"$LOG"

# Вакансии из ленты (01.10.2026): по одной живой на компанию — разведка
# проверяет ту же вакансию, на которую свайпают люди, а не страницу списка
# (у многих компаний это была главная сайта, и выходило «вакансия не
# найдена»). Только название компании и адрес вакансии — ничего о людях.
FEED=/var/lib/jobtoo/feed-vacancies.json
SECRETS=/opt/jobtoo-secrets/env
mkdir -p /var/lib/jobtoo
if [ -r "$SECRETS" ]; then
  ( set -a; . "$SECRETS"; set +a
    cd "$REPO/infra" && docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -tA -c \
      "select coalesce(json_object_agg(company, urls), '{}'::json) from (
         select company, json_agg(url) as urls from (
           select company, url, row_number() over (partition by company order by last_seen_at desc) as n
           from jm_ext_vacancies where active and company is not null and url like 'http%'
         ) v where n <= 3 group by company) t" ) > "$FEED.tmp" 2>>"$LOG" \
    && [ -s "$FEED.tmp" ] && mv -f "$FEED.tmp" "$FEED" && chmod 644 "$FEED" \
    || { rm -f "$FEED.tmp"; echo "$(date -Is) вакансии ленты не выгрузились — разведка по источникам" >>"$LOG"; }
fi
[ -s "$FEED" ] && export JUPITER_FEED_VACANCIES="$FEED"
tmp=$(mktemp /var/www/html/jupiter-recon.json.XXXXXX)
# Предел 5 часов: с 25.09.2026 в каталоге 415 разделов, а не 170, и прежних
# трёх часов на четыре потока могло не хватить — оборванный прогон не пишет
# ничего.
if timeout 5h python3 recon.py --workers 4 --out "$tmp" >>"$LOG" 2>&1; then
  chmod 644 "$tmp"
  mv -f "$tmp" "$OUT"
  echo "$(date -Is) ok" >>"$LOG"
  # Разведчик источников вакансий через поиск Яндекса (01.10.2026): для
  # компаний, у которых недельный поиск источников не нашёл вакансий, —
  # кандидаты страниц вакансий и выбор YandexGPT. Только предложения: в
  # каталог их вносят через PR. Не больше 40 компаний за проход (платно).
  YGPT_ENV=/etc/jobtoo/yandex-gpt.env
  if [ -r "$YGPT_ENV" ] && [ -s /var/www/html/career-discovery.json ]; then
    ( set -a; . "$YGPT_ENV"; set +a
      timeout 30m python3 "$REPO/scripts/career_search_scout.py" \
        --discovery /var/www/html/career-discovery.json \
        --state /var/lib/jobtoo/scout-state.json \
        --out /var/www/html/career-search-scout.json --limit 40 --feed "$FEED" ) >>"$LOG" 2>&1 \
      || echo "$(date -Is) разведчик источников не прошёл" >>"$LOG"
  fi
  # Источники в карантине (scripts/career-runtime-quarantine.json): снова
  # отвечают ли они серверу — тот же первый запрос, что у сбора. Итог —
  # открытый /career-quarantine-check.json; выпуск из карантина — через PR.
  timeout 15m python3 "$REPO/scripts/career_quarantine_recheck.py" \
    --out /var/www/html/career-quarantine-check.json >>"$LOG" 2>&1 \
    || echo "$(date -Is) проверка карантина не прошла" >>"$LOG"
else
  rm -f "$tmp"
  echo "$(date -Is) failed" >>"$LOG"
fi
