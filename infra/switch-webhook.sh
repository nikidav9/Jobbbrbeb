#!/bin/bash
# Перевести вебхук бота со старого внешнего relay прямо на этот сервер — и
# откатиться, если не выйдет.
#
# Зачем крюк вообще был. Телеграм перестал дозваниваться до jobtoo.ru, когда
# тот жил на Reg.ru: «Connection timed out», растущая очередь, бот молчал на
# любые /start. Внешний relay был доступен Телеграму, поэтому вебхук временно
# увели туда, а оттуда обновление уходило к нам обычным запросом.
#
# Теперь jobtoo.ru — другая машина в другой сети, и прежняя причина могла
# отпасть. Проверить это можно только одним способом: перевести и посмотреть.
#
# Первый заход на jobtoo.ru не вышел — тот же «Connection timed out». Зато
# он совпал с тем, что видно с самой машины: наружу к api.telegram.org по
# IPv6 доходит 4 запроса из 4, по IPv4 — 0 из 2. Ломается именно IPv4.
# А у jobtoo.ru есть обе записи, и какую взять — решает Телеграм.
#
# Отсюда tg.jobtoo.ru: то же приложение, тот же /api/tg.php, но у имени
# нет A-записи вовсе. Выбирать нечего, остаётся рабочий IPv6.
#
# Поэтому с сеткой. Переключаем, ждём, спрашиваем Телеграм, что у него вышло.
# Есть ошибка доставки — возвращаем как было, в ту же минуту. Хуже, чем было,
# стать не может: непринятые обновления Телеграм присылает повторно, так что
# сообщения не теряются даже в неудачном случае.

set -u
cd /opt/jobtoo/infra 2>/dev/null || exit 0

TOKEN=$(docker compose exec -T php php -r '
  $s = @include "/var/www/api/app_secrets.php";
  echo is_array($s) ? ($s["TG_BOT_TOKEN"] ?? "") : "";' 2>/dev/null | tr -d '\r\n')
SECRET=$(docker compose exec -T php php -r '
  $s = @include "/var/www/api/app_secrets.php";
  echo is_array($s) ? ($s["APP_SECRET"] ?? "") : "";' 2>/dev/null | tr -d '\r\n')

[ -z "$TOKEN" ] && { echo "нет токена" > /var/lib/jt-webhook-check; exit 0; }

# Сперва по IPv6. К Телеграму с этой машины IPv4 не доходит: в каждом замере
# 0 ответов из 2, тогда как по IPv6 — 4 из 4. Без указания стека выбирает
# система, и раз в несколько попыток берёт сломанный путь — отсюда и
# «Телеграм не отвечает» там, где он прекрасно отвечает. Вторая попытка без
# указания: если однажды отвалится уже IPv6, привязка сделала бы редкий сбой
# постоянным.
api() {
  local m="$1"; shift
  local r
  r=$(curl -s -6 -m 20 "https://api.telegram.org/bot$TOKEN/$m" "$@" 2>/dev/null)
  case "$r" in *'"ok"'*) printf '%s' "$r"; return 0;; esac
  curl -s -m 20 "https://api.telegram.org/bot$TOKEN/$m" "$@" 2>/dev/null
}

field() { python3 -c 'import sys,json;print(json.load(sys.stdin).get("result",{}).get(sys.argv[1],""))' "$1" 2>/dev/null; }

BEFORE=$(api getWebhookInfo)
NEW="https://tg.jobtoo.ru/api/tg.php"

# Ничего не делаем, пока не знаем, что было. Связь с Телеграмом рвётся, и на
# неудачном запросе прежний адрес читается как пустая строка. Дальше она
# попадала бы и в файл отката, и — при неудаче — в setWebhook, а setWebhook с
# пустым адресом означает «удалить вебхук». Так бот и остался без вебхука
# вовсе: не из-за отказа, а из-за оборванного запроса.
case "$BEFORE" in
  *'"ok":true'*) ;;
  *)
    echo "$(date +%H:%M) Телеграм не ответил — опыт отложен" > /var/lib/jt-webhook-check
    rm -f /var/lib/jt-webhook-tg.done
    exit 0;;
esac

WAS=$(echo "$BEFORE" | field url)
PEND0=$(echo "$BEFORE" | field pending_update_count)

[ "$WAS" = "$NEW" ] && { echo "$(date +%H:%M) уже прямой" > /var/lib/jt-webhook-check; exit 0; }
# Пустой прежний адрес в файл отката не пишем: откатываться на «никуда» —
# это и есть выключить бота.
[ -n "$WAS" ] && echo "$WAS" > /var/lib/jt-webhook.prev

T0=$(date +%s)

# Ответ на setWebhook читаем, а не выбрасываем.
#
# Прошлый заход этого не делал, и целые сутки было неизвестно самое главное:
# принял Телеграм адрес или отказал. Если отказал — вебхук остался на прежнем
# месте, бот не пострадал, и всё, что нам нужно, это дословная причина.
SET=$(api setWebhook -d "url=$NEW" -d "secret_token=$SECRET" -d "drop_pending_updates=false")
case "$SET" in
  *'"ok":true'*) ;;
  *)
    echo "$(date +%H:%M) Телеграм не принял $NEW: $(echo "$SET" | tr -d '\r\n"' | cut -c1-160)" \
      > /var/lib/jt-webhook-check
    exit 0;;
esac

# Даём Телеграму время попробовать доставить. Минуту, не больше: пока идёт
# опыт, бот отвечает через непроверенный путь, и растягивать это на людях
# незачем. Ошибку смотрим не по тексту, а по времени: last_error_message
# остаётся от прошлого адреса и без свежей даты доказывает только то, что
# когда-то что-то не вышло.
sleep 60

INFO=$(api getWebhookInfo)
ERR=$(echo "$INFO" | field last_error_message)
EDATE=$(echo "$INFO" | field last_error_date)
PEND=$(echo "$INFO" | field pending_update_count)

if [ -n "$ERR" ] && [ -n "$WAS" ] && [ "${EDATE:-0}" -ge "$T0" ] 2>/dev/null; then
  # Не дозвонился — возвращаем как было немедленно.
  api setWebhook -d "url=$WAS" -d "secret_token=$SECRET" >/dev/null
  # Пересылка проверяет заголовок у себя и дальше не передаёт — значит на
  # время отката обработчик должен принимать обновления и без него.
  touch /opt/jobtoo-proxy/tg_relay_mode 2>/dev/null || true
  echo "$(date +%H:%M) прямой путь НЕ вышел ($ERR) — вернул на $WAS" > /var/lib/jt-webhook-check
elif [ "${PEND0:-0}" -gt 0 ] && [ "${PEND:-0}" -lt "${PEND0:-0}" ] 2>/dev/null; then
  # Очередь была и рассосалась — доставка точно состоялась.
  rm -f /opt/jobtoo-proxy/tg_relay_mode 2>/dev/null || true
  echo "$(date +%H:%M) прямой путь работает: очередь $PEND0 -> $PEND" > /var/lib/jt-webhook-check
else
  # Ошибки нет, но и доставлять было нечего. Оставляем прямой путь — первое
  # же сообщение боту покажет правду, а откатить всегда успеем.
  echo "$(date +%H:%M) прямой путь поставлен, ошибок нет, но очередь пуста — итог покажет первое сообщение" > /var/lib/jt-webhook-check
fi
