#!/bin/bash
# Удаление всех людей: чистый лист под новое приложение (решение владельца
# 03.10.2026). Каталог остаётся: внешние вакансии, источники, компании,
# логотипы, база знаний Юпитера, ответы поддержки, ключи API, журнал миграций.
#
# Запуск — из bootstrap.sh, один раз на каждое новое содержимое
# infra/wipe-users-now, синхронно: пока идёт удаление, следующий заход
# bootstrap не стартует и не поднимет остановленные службы.
# Итог — /var/www/html/wipe-status.json: только числа и шаги, ни строки о людях.
#
# Порядок важен. Сначала таблицы — одним TRUNCATE. Не очистились — дальше не
# идём: ящик, файлы и резервные копии остаются, люди восстановимы. Только
# после успеха чистим всё, что SQL-ом не удалить: почтовый ящик Юпитера,
# бакеты с файлами, файлы воркеров, логи и копии — по 152-ФЗ «удалить» значит
# удалить везде.
#
# Перечень мест — разбор 03.10.2026 по миграциям 000–145, php-proxy, jupiter,
# infra. Отметки __import__/__files__ в jm_migrations НЕ трогаем: они не дают
# import.sh заново залить людей из старого облака.
set -u

REPO=${REPO:-/opt/jobtoo}
STATUS=/var/www/html/wipe-status.json
cd "$REPO/infra" || exit 1
set -a; . /opt/jobtoo-secrets/env; set +a
say() { echo "$(date -Is) [удаление] $1" >> /var/log/jt-apply.log; }
q() { docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

STARTED=$(date -Is)
STEPS=""
step() {
  say "$1: $2"
  local v
  v=$(printf '%s' "$2" | tr -d '"\\' | tr '\n' ' ' | cut -c1-300)
  STEPS="$STEPS${STEPS:+,}\"$1\":\"$v\""
}
write_status() {
  printf '{"started_at":"%s","finished_at":"%s","steps":{%s}}\n' \
    "$STARTED" "$(date -Is)" "$STEPS" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"
}

# ── 1. Остановить всё, что пишет о людях ──────────────────────────────────
WAS_ACTIVE=""
for s in jt-jupiter jt-jupiter-browser jt-jupiter-mail jt-tgpoll; do
  if systemctl is-active --quiet "$s.service" 2>/dev/null; then
    WAS_ACTIVE="$WAS_ACTIVE $s"
    systemctl stop "$s.service" 2>/dev/null || true
  fi
done
step services_stopped "${WAS_ACTIVE:-нет активных}"
restart_services() {
  for s in $WAS_ACTIVE; do systemctl start "$s.service" 2>/dev/null || true; done
}

# ── 2. Таблицы — первыми ──────────────────────────────────────────────────
# Один TRUNCATE без CASCADE: внешние ключи между перечисленными Postgres
# разрешает внутри оператора, а если на таблицу людей неожиданно ссылается
# что-то не из списка — оператор упадёт целиком и ничего не удалит.
TABLES="jm_jupiter_events jm_jupiter_captcha jm_jupiter_questions jm_jupiter_applications
jm_jupiter_answers jm_jupiter_emails jm_jupiter_mailboxes
jm_ext_swipes jm_ext_saved jm_perm_swipes jm_resume_files jm_referral_rewards jm_auth_codes
jm_messages jm_chats jm_ratings jm_likes jm_perm_applications jm_complaints
jm_saved jm_perm_saved jm_vacancy_views jm_perm_vacancy_views
jm_notifications jm_web_push_subscriptions jm_bot_messages jm_support_messages jm_support_threads
jm_consents jm_worker_slots jm_skill_results jm_survey_responses jm_survey_sends
jm_app_opens jm_guest_events jm_bulletins jm_vacancies jm_perm_vacancies jm_users"
existing=""
for t in $TABLES; do
  if q -tAc "select to_regclass('public.$t') is not null" 2>/dev/null | grep -q t; then
    existing="$existing${existing:+, }public.$t"
  fi
done
before=$(q -tAc "select count(*) from public.jm_users" 2>/dev/null | tr -d ' ')
if [ -z "$existing" ] || ! out=$(q -c "begin;
  truncate $existing restart identity;
  delete from public.jm_settings
   where (key like 'bcast:%' or key like 'gpost:%')
     and substring(key from 7) not in (select id::text from public.jm_ext_vacancies);
  commit;" 2>&1); then
  step tables "ОШИБКА: ${out:-таблицы не найдены}"
  restart_services
  step stopped "таблицы не очистились — ящик, файлы и копии не тронуты"
  write_status
  exit 1
fi
after=$(q -tAc "select count(*) from public.jm_users" 2>/dev/null | tr -d ' ')
step tables "очищено таблиц: $(echo "$existing" | tr ',' '\n' | wc -l); людей было ${before:-?}, стало ${after:-?}"

# ── 3. Общий почтовый ящик Юпитера: письма работодателей людям ────────────
IMAP_OK=0
if [ -n "${JUPITER_MAIL_IMAP_USER:-}" ] && [ -n "${JUPITER_MAIL_IMAP_PASSWORD:-}" ]; then
  out=$(timeout 300 python3 - <<'PY' 2>&1
import imaplib, os
host = os.environ.get("JUPITER_MAIL_IMAP_HOST", "imap.timeweb.ru")
with imaplib.IMAP4_SSL(host, 993) as c:
    c.login(os.environ["JUPITER_MAIL_IMAP_USER"], os.environ["JUPITER_MAIL_IMAP_PASSWORD"])
    names = []
    for raw in c.list()[1] or []:
        line = raw.decode(errors="replace")
        if "\\Noselect" in line:
            continue
        names.append(line.rsplit(' "/" ', 1)[-1].strip() if ' "/" ' in line else line.split()[-1])
    total = 0
    for name in names or ["INBOX"]:
        if c.select(name)[0] != "OK":
            continue
        ids = (c.search(None, "ALL")[1][0] or b"").split()
        if ids:
            c.store(b",".join(ids).decode(), "+FLAGS.SILENT", "(\\Deleted)")
            c.expunge()
        total += len(ids)
        c.close()
    c.select("INBOX")
    left = len((c.search(None, "ALL")[1][0] or b"").split())
    print(f"удалено писем {total}, во входящих осталось {left}")
    raise SystemExit(0 if left == 0 else 2)
PY
  )
  rc=$?
  [ $rc = 0 ] && IMAP_OK=1
  step imap "$out (код $rc)"
else
  step imap "нет доступа к ящику в env — пропущено"
fi
# Адреса, снятые с удалённых людей, держат имя занятым, пока в ящике лежат их
# письма: иначе новому однофамильцу досталась бы чужая почта. Ящик пуст —
# держать нечего.
if [ $IMAP_OK = 1 ]; then
  rm -f /var/lib/jupiter/mail-uid.json
  q -c "truncate public.jm_jupiter_retired_addresses" >/dev/null 2>&1 \
    && step retired_addresses "очищены" || step retired_addresses "не очищены"
fi

# ── 4. Бакеты с файлами людей (company-logos не трогаем) ──────────────────
for b in avatars chat-media resume-files; do
  code=$(curl -s -o /tmp/jt-wipe-bucket.log -w '%{http_code}' -X POST \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    "https://jobtoo.ru/storage/v1/bucket/$b/empty")
  step "bucket_$b" "HTTP $code $(head -c 120 /tmp/jt-wipe-bucket.log 2>/dev/null)"
done
rm -f /tmp/jt-wipe-bucket.log
objs=$(q -tAc "select coalesce(string_agg(bucket_id || '=' || n, ' '), 'пусто') from (select bucket_id, count(*) n from storage.objects group by 1 order by 1) s" 2>/dev/null)
step storage_objects_left "$objs"

# ── 5. Файлы на сервере ───────────────────────────────────────────────────
rm -f /var/lib/jupiter/receipts.json /var/lib/jupiter/handoffs.json \
      /var/lib/jt-jupiter-browser/receipts.json /var/lib/jt-jupiter-browser/handoffs.json \
      /var/lib/jt-tg-dead-letters.jsonl /var/lib/jt-tg-dead-letters.jsonl.old
rm -f /tmp/jupiter_resume_*.pdf /var/tmp/jupiter_resume_*.pdf 2>/dev/null
docker compose exec -T php sh -c 'cd "$(php -r "echo sys_get_temp_dir();")" && rm -f jobtoo_tg_pending.json jm_try_*.json jm_admin_login_*.json jt-email-apply-hour.json' 2>/dev/null
for l in /var/log/jt-jupiter.log /var/log/jt-jupiter-browser.log /var/log/jt-jupiter-mail.log \
         /var/log/jt-tgpoll.log /var/www/api/expo-proxy.log; do
  [ -f "$l" ] && : > "$l"
done
journalctl --rotate >/dev/null 2>&1; journalctl --vacuum-time=1s >/dev/null 2>&1
step server_files "квитанции, передачи, очередь бота, временные файлы и логи очищены"

# ── 6. Резервные копии с людьми ───────────────────────────────────────────
n_local=$(ls /opt/jobtoo-backups/db-*.sql.gz /opt/jobtoo-backups/files-*.tar.gz 2>/dev/null | wc -l)
rm -f /opt/jobtoo-backups/db-*.sql.gz /opt/jobtoo-backups/files-*.tar.gz
s3="второго хранилища нет"
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${AWS_ACCESS_KEY_ID:-}" ] && command -v aws >/dev/null 2>&1; then
  n_s3=0
  for key in $(aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 ls "s3://$BACKUP_S3_BUCKET/" 2>/dev/null | awk '{print $NF}' | grep -E '^(db|files)-'); do
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 rm "s3://$BACKUP_S3_BUCKET/$key" --only-show-errors >/dev/null 2>&1 && n_s3=$((n_s3 + 1))
  done
  s3="во втором хранилище удалено: $n_s3"
fi
step backups "локальных удалено: $n_local; $s3"
# Свежая копия уже без людей — чтобы было из чего подняться.
if bash "$REPO/infra/backup.sh" >/dev/null 2>&1; then step backup_fresh "сделана"; else step backup_fresh "не получилась"; fi

# ── 7. Вернуть службы ─────────────────────────────────────────────────────
restart_services
step services_started "${WAS_ACTIVE:-нечего запускать}"
write_status
