#!/bin/bash
# Переносит данные из облачного Supabase в свою базу.
#
# Забирает сервер сам, напрямую из облака: у него открыты все порты, а данные
# при этом нигде не задерживаются. Через репозиторий их не пронести — он
# публичный, а там переписка и телефоны 420 человек.
#
# Запускается один раз и сам себя останавливает: отметка в jm_migrations.
# Повторная заливка означала бы дубли, поэтому «пусть применяется каждую
# минуту» здесь не годится, в отличие от всего остального на этой машине.
#
# Порядок таблиц — по зависимостям, а не по алфавиту: сначала люди, потом их
# вакансии, потом отклики на эти вакансии.
set -u

REPO=${REPO:-/opt/jobtoo}
SECRETS=/opt/jobtoo-secrets/env
CLOUD=/opt/jobtoo-secrets/cloud
say() { echo "$(date -Is) [$1] $2" >> /var/log/jt-apply.log; }

[ -f "$CLOUD" ] || { say "перенос" "нет доступа к облаку, пропускаю"; exit 0; }
set -a; . "$SECRETS"; . "$CLOUD"; set +a

cd "$REPO/infra"
q() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

# Уже переносили — второй раз не надо.
if q -tAc "select 1 from jm_migrations where name='__import__'" 2>/dev/null | grep -q 1; then
  exit 0
fi

ORDER="jm_settings jm_users jm_vacancies jm_perm_vacancies jm_bulletins
       jm_likes jm_chats jm_messages jm_saved jm_perm_saved jm_perm_applications
       jm_notifications jm_ratings jm_complaints jm_bot_messages
       jm_support_messages jm_support_threads jm_support_knowledge jm_web_push_subscriptions
       jm_vacancy_views jm_perm_vacancy_views jm_worker_slots"

say "перенос" "начинаю"
report=""
for t in $ORDER; do
  off=0; got=0
  while :; do
    page=$(curl -s -m 120 "$SB_URL/rest/v1/$t?select=*&limit=1000&offset=$off" \
             -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY")
    # Таблицы может не быть в облаке — это не ошибка, просто пропускаем.
    case "$page" in
      '[]') break ;;
      '['*) ;;
      *) break ;;
    esac
    n=$(printf '%s' "$page" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
    [ "$n" -eq 0 ] && break

    # JSON едет в base64. Прямо его через COPY не протащить: в данных есть
    # кавычки, запятые и переносы строк, и любой формат — что CSV, что
    # текстовый — истолкует их по-своему и порвёт строку пополам. В base64
    # таких символов нет вовсе, поэтому разбор однозначен.
    #
    # jsonb_populate_recordset сам разложит поля по колонкам: знать их
    # порядок и типы не нужно, а лишние ключи он молча пропустит.
    err=$(printf '%s' "$page" | base64 -w0 \
      | docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
          psql -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
          -c "create temp table _in (b text);
              copy _in (b) from stdin;
              do \$do\$
              declare
                j    jsonb := convert_from(decode((select b from _in), 'base64'), 'UTF8')::jsonb;
                cols text;
              begin
                -- Вставляем только те колонки, что есть в данных.
                --
                -- Через select * не выйдет: отсутствующее поле он подставит
                -- явным NULL, и умолчание колонки перестанет действовать.
                -- Так споткнулись на jm_bulletins.views — её добавляет
                -- миграция 008 как NOT NULL DEFAULT 0, в выгрузке её нет,
                -- и явный NULL нарушал ограничение вместо того, чтобы
                -- уступить нулю по умолчанию.
                select string_agg(quote_ident(k), ', ')
                  into cols
                  from (select distinct jsonb_object_keys(e) as k
                          from jsonb_array_elements(j) e) x
                 where k in (select column_name from information_schema.columns
                              where table_schema = 'public' and table_name = '$t');
                if cols is null then return; end if;
                execute format(
                  'insert into public.%I (%s) select %s
                     from jsonb_populate_recordset(null::public.%I, \$1)
                     on conflict do nothing',
                  '$t', cols, cols, '$t') using j;
              end
              \$do\$;" 2>&1)
    if [ -n "$err" ]; then
      say "перенос" "СПОТКНУЛСЯ на $t (сдвиг $off): $(printf '%s' "$err" | grep -a -m1 -iE 'error|ошибка' | cut -c1-220)"
      exit 1
    fi

    got=$((got+n)); off=$((off+1000))
    [ "$n" -lt 1000 ] && break
  done
  have=$(q -tAc "select count(*) from public.$t" 2>/dev/null | tr -d '[:space:]')
  report="$report $t=$have"
done

q -c "insert into jm_migrations (name) values ('__import__') on conflict do nothing" >/dev/null 2>&1
say "перенос" "готово:$report"
