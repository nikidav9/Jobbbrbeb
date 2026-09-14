#!/bin/bash
# Отчёт о состоянии сервера.
#
# Кладём файлом, который отдаёт свой же nginx. Никаких сторонних сервисов:
# предыдущая версия слала в ntfy.sh, и тот перестал принимать с адреса
# сервера после сотен сообщений за день — наблюдение отвалилось молча и
# в самый неподходящий момент.
#
# Второе правило, тоже выученное на себе: отчёт не должен зависеть от того,
# о чём докладывает. Сначала пишем всё, что не требует Docker. Docker
# спрашиваем последним и с тайм-аутом — не ответил, так и запишем.

OUT=/var/www/html/status.json
TMP=/tmp/jt-status.$$

{
  echo '{'
  echo "  \"время\": \"$(date -Is)\","
  echo "  \"запущен\": \"$(uptime -s)\","
  echo "  \"нагрузка\": \"$(cut -d' ' -f1-3 /proc/loadavg)\","
  echo "  \"память_МБ\": \"$(free -m | awk '/^Mem/{print $3"/"$2}')\","
  echo "  \"подкачка_МБ\": \"$(free -m | awk '/^Swap/{print $3"/"$2}')\","
  echo "  \"диск\": \"$(df -h / | awk 'NR==2{print $3" из "$2", свободно "$4}')\","
  # Из чего сложилось занятое место. Диск здесь не резиновый, а растёт он
  # молча: база от переписки, хранилище от фотографий и голосовых, копии от
  # самих себя. Когда место кончится, Postgres встанет — и разбираться,
  # что именно его съело, будет уже некогда.
  echo "  \"занимает\": \"$(
    for e in "тома:/var/lib/docker/volumes" "копии:/opt/jobtoo-backups" \
             "сайт:/var/www/jobtoo" "репозиторий:/opt/jobtoo" "образы:/var/lib/docker/overlay2"; do
      p=${e#*:}
      # Имена свои, а не из пути: у /var/www/jobtoo и /opt/jobtoo он один и
      # тот же, и в отчёте выходили две одинаковые строки с разными числами.
      [ -e "$p" ] && printf '%s=%s ' "${e%%:*}" "$(du -sh "$p" 2>/dev/null | cut -f1)"
    done)\","
  echo "  \"nginx\": \"$(systemctl is-active nginx)\","
  echo "  \"docker\": \"$(systemctl is-active docker)\","
  echo "  \"таймер\": \"$(systemctl is-active jt-apply.timer)\","
  echo "  \"watchdog\": \"$(systemctl is-active jt-site-watchdog.timer 2>/dev/null || echo отсутствует)\","
  echo "  \"watchdog_последнее\": \"$(tail -1 /var/log/jt-watchdog.log 2>/dev/null | tr -d '\"\\' | cut -c1-300)\","
  echo "  \"последний_заход\": \"$(systemctl show jt-apply.service -p ExecMainStatus --value 2>/dev/null)\","
  # Слушающие порты — самое полезное: по ним видно, поднялись ли службы,
  # даже когда Docker не отвечает вовсе.
  echo "  \"порты\": \"$(ss -ltn 2>/dev/null | awk 'NR>1{print $4}' | grep -oE '[0-9]+$' | sort -un | tr '\n' ' ')\","
  echo "  \"версия\": \"$(cd /opt/jobtoo 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo нет)\","
  # Отдельной строкой, с адресом, а не только номером порта: прокси работает
  # в сети машины, и разница между 127.0.0.1:9000 и 0.0.0.0:9000 — это
  # разница между «закрыто» и «обработчик PHP открыт всему интернету».
  echo "  \"php_слушает\": \"$(ss -ltn 2>/dev/null | awk '$4 ~ /:9000$/ {print $4}' | tr '\n' ' ')\","

  st=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 20 docker compose ps --format '{{.Service}}={{.State}}' 2>&1 | tr '\n' ' ' | tr -d '"')
  echo "  \"контейнеры\": \"${st:-docker не ответил за 20 секунд}\","

  echo "  \"журналы\": {"
  first=1
  for svc in db rest realtime storage dashboard; do
    s=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 10 docker compose ps "$svc" --format '{{.State}}' 2>/dev/null)
    # storage и realtime показываем всегда: оба бывают «running» и при этом
    # не работают — первый отвечал 502, второй отвергает подписки.
    # dashboard показываем всегда: он бывает «running» и при этом отдаёт
    # ошибку на каждый файл статики — снаружи это белый экран без единой
    # записи в отчёте.
    [ "$s" = "running" ] && [ "$svc" != "storage" ] && [ "$svc" != "realtime" ] && [ "$svc" != "dashboard" ] && continue
    [ -n "$s" ] || continue
    [ $first -eq 0 ] && echo ","
    first=0
    # Берём хвост строки, а не начало: причина обычно в конце сообщения,
    # а начало занято перечислением уже применённых миграций.
    # У дашборда берём начало ошибки, а не хвост: в хвосте стек вызовов, а
    # имя ненайденного модуля — в первой строке. Именно её и не хватало,
    # чтобы понять, почему страница открывается, а скрипты к ней нет.
    n=6; cut=600
    [ "$svc" = "dashboard" ] && { n=40; cut=1400; }
    log=$(cd /opt/jobtoo/infra && timeout 15 docker compose logs --tail=$n --no-log-prefix "$svc" 2>&1 \
          | grep -aiE "error|cannot|missing|enoent|warn|Ready|Starting" | head -8 \
          | tr -d '"\\\r' | tr '\n' ' ' | tail -c $cut)
    printf '    "%s": "%s"' "$svc" "$log"
  done
  echo
  echo "  },"
  # Проверка служб изнутри машины: снаружи шлюз может отвечать 502, и не
  # видно, кто виноват — он или сама служба.
  echo "  \"изнутри\": \"rest=$(curl -s -o /dev/null -w %{http_code} -m 5 http://127.0.0.1:3000/ 2>/dev/null) storage=$(curl -s -o /dev/null -w %{http_code} -m 5 http://127.0.0.1:5000/status 2>/dev/null) realtime=$(curl -s -o /dev/null -w %{http_code} -m 5 -H 'Host: realtime-dev.localhost' http://127.0.0.1:4000/api/tenants 2>/dev/null) studio=$(curl -s -o /dev/null -w %{http_code} -m 5 http://127.0.0.1:3001/ 2>/dev/null)\","

  # Ошибки Postgres: storage падает на своих миграциях, а сам показывает
  # только «DatabaseError» без текста. Причина видна лишь здесь.
  echo "  \"ошибки_базы\": \"$(cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose logs --tail=120 --no-log-prefix db 2>&1 | grep -aiE 'error|fatal' | tail -4 | tr -d '"\\\r' | tr '\n' ' ' | tail -c 500)\","

  # Realtime отвергает подключения: надо знать, какого арендатора он завёл.
  echo "  \"realtime_арендаторы\": \"$(cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose exec -T -e PGPASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' /opt/jobtoo-secrets/env | cut -d= -f2)" db psql -tAq -U supabase_admin -d postgres -c \"select external_id || ':' || name from _realtime.tenants\" 2>&1 | tr -d '\"' | tr '\n' ' ' | cut -c1-200)\","


  rt=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose exec -T \
       -e PGPASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' /opt/jobtoo-secrets/env | cut -d= -f2)" db \
       psql -tAq -U supabase_admin -d postgres -c "
         select coalesce(string_agg(external_id || ' / ' || name, ', '), 'нет') from _realtime.tenants;
       " 2>&1 | tr -d '"\n' | cut -c1-160)
  echo "  \"realtime_состояние\": \"${rt:-не прочитать}\","

  # Состав схемы: имя таблицы и сколько в ней колонок и строк. Нужно, чтобы
  # сверить перенос по существу, а не по числу строк: пустая таблица нужна
  # ничуть не меньше полной, и её отсутствие по счётчикам не увидишь.
  sch=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 25 docker compose exec -T \
        -e PGPASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' /opt/jobtoo-secrets/env | cut -d= -f2)" db \
        psql -tAq -U supabase_admin -d postgres -c "
          select string_agg(t.relname || ':' || c.cols || ':' || t.n, ' ' order by t.relname)
          from (select c.relname, c.reltuples::bigint as n, c.oid
                  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                 where ns.nspname='public' and c.relkind='r' and c.relname like 'jm\\_%') t
          join (select attrelid, count(*) cols from pg_attribute
                 where attnum > 0 and not attisdropped group by attrelid) c
            on c.attrelid = t.oid;" 2>&1 | tr -d '"\n' | cut -c1-1200)
  echo "  \"схема\": \"${sch:-не прочитать}\","

  # Сколько весит сама база и её самые тяжёлые таблицы. Растёт она от
  # переписки и уведомлений, а не от людей: четыреста человек занимают
  # меньше, чем их разговоры за месяц.
  wt=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 20 docker compose exec -T \
       -e PGPASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' /opt/jobtoo-secrets/env | cut -d= -f2)" db \
       psql -tAq -U supabase_admin -d postgres -c "
         select pg_size_pretty(pg_database_size('postgres')) || ' всего: ' ||
                string_agg(x.n || ' ' || x.s, ', ' order by x.b desc)
           from (select c.relname as n,
                        pg_size_pretty(pg_total_relation_size(c.oid)) as s,
                        pg_total_relation_size(c.oid) as b
                   from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                  where ns.nspname = 'public' and c.relkind = 'r'
                    and c.relname like 'jm\\_%'
                  order by b desc limit 5) x;" 2>&1 | tr -d '"\n' | cut -c1-300)
  echo "  \"вес_базы\": \"${wt:-не прочитать}\","

  # Точные счётчики там, где приблизительные вводят в заблуждение.
  #
  # В строке «схема» числа берутся из статистики планировщика: у таблиц, по
  # которым она не собиралась, стоит -1, и это читается как «пусто». Здесь
  # важно знать наверняка: от числа подписок на уведомления в браузере
  # зависит, можно ли просто выпустить новые ключи VAPID или это лишит
  # людей уведомлений.
  cnt=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 20 docker compose exec -T \
        -e PGPASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' /opt/jobtoo-secrets/env | cut -d= -f2)" db \
        psql -tAq -U supabase_admin -d postgres -c "
          select 'подписки_браузер=' || (select count(*) from jm_web_push_subscriptions)
              || ' с_телеграмом=' || (select count(*) from jm_users where telegram_id is not null)
              || ' с_пушем=' || (select count(*) from jm_users where push_token is not null);
        " 2>&1 | tr -d '"\n' | cut -c1-200)
  echo "  \"охват\": \"${cnt:-не прочитать}\","
  # Публичная часть ключа уведомлений. Секретом не является по устройству:
  # её получает каждый браузер при подписке. Здесь она затем, чтобы её можно
  # было взять и вписать в приложение, не доставая приватную половину
  # ниоткуда и не проводя её через переписку.
  echo "  \"vapid_публичный\": \"$(grep -m1 '^VAPID_PUBLIC_KEY=' /opt/jobtoo-secrets/env 2>/dev/null | cut -d= -f2-)\","

  # Переезд домена: три вещи, каждая из которых по отдельности выглядит
  # исправно, а вместе должны сойтись до смены записи в DNS.
  echo "  \"сертификаты\": \"$(ls /etc/letsencrypt/live 2>/dev/null | grep -v README | tr '\n' ' ')\","
  # Дашборд: приехала ли сборка и отвечает ли она. Пока записи в DNS нет,
  # обе строки пустые — это и значит «готово, но не включено».
  #
  # И отдельно — есть ли у него пропуск приложения. Без него ответы в
  # поддержку, рассылки и сброс пароля отваливаются с «EXPO_PUBLIC_APP_SECRET
  # не задан на сервере», причём видно это только тому, кто в этот момент
  # нажал кнопку. Значение живёт в app_secrets.php, а контейнеру достаётся
  # через файл переменных — то есть между ними два шага, и любой может
  # отвалиться молча.
  # Со статикой, а не только со страницей. «Отвечает 200» ничего не значит:
  # сервер отдаёт страницу из памяти и при полностью недоступном диске — а
  # человек видит белый экран, потому что ни один скрипт к ней не грузится.
  slot=$(cat /var/lib/jt-dash-slot 2>/dev/null || echo blue)
  [ "$slot" = green ] && dport=3003 || dport=3002
  ddir="/opt/jobtoo-dashboard-$slot"
  echo "  \"дашборд\": \"слот $slot, сборка $([ -s "$ddir/server.js" ] && echo есть || echo нет), страница $(curl -s -o /dev/null -w %{http_code} -m 5 http://127.0.0.1:$dport/ 2>/dev/null || echo нет), скрипты $(
    c=$(curl -s -m 5 http://127.0.0.1:$dport/ 2>/dev/null | grep -oE '/_next/static/chunks/main-app-[^\"]+\.js' | head -1)
    [ -n "$c" ] && curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$dport$c" 2>/dev/null || echo нет)\","

  # Забор сообщений бота: жива ли служба и когда в последний раз доходила
  # до Телеграма. «Работает» тут ничего не значит — процесс может висеть,
  # ничего не забирая, и снаружи это неотличимо от тишины в чатах.
  echo "  \"забор_бота\": \"$(systemctl is-active jt-tgpoll.service 2>/dev/null) отметка=$(
    b=$(stat -c %Y /var/lib/jt-tg-beat 2>/dev/null || echo 0)
    [ "${b:-0}" -gt 0 ] && echo "$(( ($(date +%s) - b) ))с назад" || echo нет)\","
  # Хвост журнала забора: там время обработки каждого сообщения. Без него
  # «бот медленный» — это ощущение, а не число.
  echo "  \"забор_журнал\": \"$(tail -4 /var/log/jt-tgpoll.log 2>/dev/null | tr -d '"\\\r' | tr '\n' ' ' | cut -c1-300)\","
  # Двумя числами, а не одним, и это не педантизм. Пропуск может лежать в
  # файле переменных и при этом не быть внутри контейнера — ровно так и было:
  # отчёт показывал «есть», а дашборд отвечал «не задан на сервере». Значение
  # в файле и значение в работающем контейнере — разные вещи, и знать надо обе.
  # Чужие вакансии: сколько живых и что сказал последний заход по каждому
  # источнику. Сломавшийся фид иначе не отличить от источника, у которого
  # просто нет открытых смен.
  echo "  \"чужие_вакансии\": \"$(cat /var/lib/jt-ingest.out 2>/dev/null | tr -d '"\\\r\n' | cut -c1-260)\","
  echo "  \"дашборд_пропуск\": \"файл=$(grep -c '^EXPO_PUBLIC_APP_SECRET=.\+' /opt/jobtoo-secrets/env 2>/dev/null | tr -d '\n') внутри=$(
    cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose --profile dashboard exec -T "dashboard-$slot" \
      printenv EXPO_PUBLIC_APP_SECRET 2>/dev/null | tr -d '\r\n' | wc -c | tr -d ' ')\","
  echo "  \"сайт\": \"файлов $(find /var/www/jobtoo -type f 2>/dev/null | wc -l), оболочка $([ -s /var/www/jobtoo/index.html ] && echo есть || echo нет), страница ключей $([ -s /var/www/private/token.txt ] && echo есть || echo нет)\","
  # Что будет, когда репозиторий закроют.
  #
  # Оттуда сервер берёт три вещи: сами обновления (git pull), сборку сайта и
  # сборку дашборда. Закрытый репозиторий обрывает все три, причём молча:
  # сайт останется прежним, ошибки не будет нигде, а «почему не обновляется»
  # выясняется днями. Проверять это после закрытия поздно — чинить придётся
  # тем же закрытым репозиторием.
  #
  # Поэтому проверяем заранее и тем же токеном, которым будет ходить сервер:
  # видно ли репозиторий через API, отвечает ли git и находится ли файл в
  # выпуске. Три ответа «да» — закрывать можно хоть сейчас.
  #
  # Всё склеивается в одну строку и чистится от переводов строки: первая же
  # версия этой проверки вставила в отчёт лишний перенос, и весь status.json
  # перестал разбираться. Проверка исправности не имеет права ломать то, во
  # что она пишет.
  echo "  \"github\": \"$( {
    t=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose exec -T php php -r '
      $v = @include "/var/www/api/gh_token.php"; echo is_string($v) ? $v : "";' 2>/dev/null | tr -d '\r\n')
    if [ -z "$t" ]; then printf 'токена нет'; else
      # Длина, а не значение: по ней видно, доехал ли токен целиком, и при
      # этом его нельзя списать с открытой страницы.
      printf 'длина=%s ' "${#t}"
      R=$(curl -sL -m 15 -H "Authorization: Bearer $t" -w '\n%{http_code}' \
        https://api.github.com/repos/nikidav9/Jobbbrbeb 2>/dev/null)
      printf 'api=%s ' "$(printf '%s' "$R" | tail -1)"
      # Своими словами GitHub объясняет отказ лучше, чем номер: 401 значит
      # «токен не тот», 404 — «токен не про этот репозиторий».
      printf 'ответ=%s ' "$(printf '%s' "$R" | grep -o '"message": *"[^"]*"' | head -1 | cut -c13-60 | tr -d '"')"
      printf 'git=%s ' "$(GIT_TERMINAL_PROMPT=0 timeout 20 git ls-remote \
        "https://x-access-token:$t@github.com/nikidav9/Jobbbrbeb" HEAD >/dev/null 2>&1 && echo да || echo нет)"
      printf 'сборка_сайта=%s ' "$(curl -sL -m 15 -H "Authorization: Bearer $t" \
        https://api.github.com/repos/nikidav9/Jobbbrbeb/releases/tags/web 2>/dev/null \
        | grep -c '"name": *"dist.tar.gz"')"
      printf 'закрыт=%s' "$(printf '%s' "$R" | grep -o '"private": *[a-z]*' | head -1 | awk '{print $2}')"
    fi; } | tr -d '\n\r"' )\","
  # Куда указывает домен по мнению ответственных за него серверов. Обычный
  # преобразователь здесь бесполезен: TTL записи час, и он ещё час будет
  # показывать прежнее — то есть в самый нужный момент соврёт.
  echo "  \"домен\": \"$(ns=$(dig +short +time=5 +tries=1 NS jobtoo.ru 2>/dev/null | head -1); [ -n "$ns" ] && dig +short +time=5 +tries=1 A jobtoo.ru "@$ns" 2>/dev/null | tr '\n' ' ' || echo 'не спросить')\","
  # Открывается ли сайт по IPv6. Запись AAAA у домена есть, но само по себе
  # это ничего не значит: если nginx не слушает второй стек или сертификат
  # по нему не отдаётся, у половины мобильных сетей сайт просто не откроется,
  # а у остальных будет работать. Худший вид поломки — «у соседа работает».
  echo "  \"ipv6_сайт\": \"$(curl -6 -s -o /dev/null -m 8 -w '%{http_code}' https://jobtoo.ru/ 2>/dev/null || echo нет) / admin=$(curl -6 -s -o /dev/null -m 8 -w '%{http_code}' https://admin.jobtoo.ru/ 2>/dev/null || echo нет)\","
  # Только наличие, без значений: страница открыта всем. Без токена бота
  # после переезда молча умрёт вебхук, без пароля — вход в дашборд.
  echo "  \"секреты_прокси\": \"$(cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose exec -T php php -r '
      foreach (["app_secrets.php","admin_credentials.php","sb_service_key.php","sb_url.php",
                "studio_credentials.php","gh_token.php","deploy_token.php"] as $f) {
        $p = "/var/www/api/" . $f;
        if (!is_readable($p)) { echo "$f=нет "; continue; }
        $v = include $p;
        if (is_array($v)) { foreach ($v as $k => $x) echo $k . "=" . (strlen((string)$x) ? "есть" : "пусто") . " "; }
        else { echo $f . "=" . (strlen((string)$v) ? "есть" : "пусто") . " "; }
      }' 2>&1 | tr -d '"' | tr '\n' ' ' | cut -c1-300)\","

  # Жив ли токен бота на этом сервере и виден ли ему группа.
  #
  # После переезда домена вебхук бота придёт сюда, и проверять это будет
  # поздно. Раз в десять минут, а не каждую минуту: Telegram незачем дёргать
  # по кругу, но и час ждать нельзя — в момент переключения ответ нужен
  # свежий, а не позавчерашний.
  if [ ! -f /var/lib/jt-tg-check2 ] \
     || [ $(( $(date +%s) - $(stat -c %Y /var/lib/jt-tg-check2 2>/dev/null || echo 0) )) -gt 600 ]; then
    (cd /opt/jobtoo/infra 2>/dev/null && timeout 150 docker compose exec -T php php -r '
      $s = @include "/var/www/api/app_secrets.php";
      $t = is_array($s) ? ($s["TG_BOT_TOKEN"] ?? "") : "";
      if (!strlen($t)) { echo "токена нет"; exit; }

      // Достался ли контейнеру IPv6. Без него до Telegram отсюда не дойти
      // вовсе: его IPv4-адрес закрыт, и это единственная работающая дорога.
      //
      // Читаем из самой системы, а не спрашиваем утилиту ip: в этом образе
      // её нет, и проверка отвечала «нет» независимо от истины. Пятый столбец
      // здесь — область видимости, 00 значит глобальный адрес.
      $v6 = "нет";
      foreach (@file("/proc/net/if_inet6") ?: [] as $line) {
        $p = preg_split("/\s+/", trim($line));
        if (($p[3] ?? "") === "00" && ($p[0] ?? "") !== str_repeat("0", 32)) { $v6 = "есть"; break; }
      }
      echo "свой_ipv6=" . $v6 . " ";

      // Отказы непостоянные: один и тот же getMe то проходит, то умирает по
      // тайм-ауту. Одиночная проверка тут врёт в обе стороны, поэтому меряем
      // счётом — и сразу сравниваем с принудительным IPv4.
      //
      // Сравнение нужно, чтобы отличить две разные болезни: если IPv4 берёт
      // всегда, а обычный запрос через раз, виноват недоступный из контейнера
      // IPv6 и лечится это одной строкой. Если плохо и там и там — это уже
      // фильтрация на пути к Telegram, и лечится совсем иначе.
      // Три способа: как получится, строго по IPv6 и строго по IPv4.
      // Третий — заведомо закрытый — оставлен как контроль: если и он
      // вдруг начнёт отвечать, значит изменилась сеть, а не наша настройка.
      $try = function ($mode) use ($t) {
        $c = curl_init("https://api.telegram.org/bot" . $t . "/getMe");
        $o = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CONNECTTIMEOUT => 4];
        if ($mode === 4) $o[CURLOPT_IPRESOLVE] = CURL_IPRESOLVE_V4;
        if ($mode === 6) $o[CURLOPT_IPRESOLVE] = CURL_IPRESOLVE_V6;
        curl_setopt_array($c, $o);
        $b = curl_exec($c); $e = curl_errno($c); curl_close($c);
        $j = json_decode((string) $b, true);
        return [is_array($j) && ($j["ok"] ?? false), $e];
      };
      $plan = [["как есть", 0, 4], ["только IPv6", 6, 4], ["только IPv4", 4, 2]];
      $errs = [];
      foreach ($plan as [$name, $mode, $times]) {
        $n = 0;
        for ($i = 0; $i < $times; $i++) {
          [$ok, $e] = $try($mode);
          if ($ok) $n++; elseif ($e) $errs[$name . "/" . $e] = 1;
        }
        echo $name . "=" . $n . "/" . $times . " ";
      }
      if ($errs) echo "ошибки:" . implode(",", array_keys($errs)) . " ";
      // Причину отказа сохраняем: «не отвечает» не отличает заблокированную
      // сеть от просроченного токена, а чинится это по-разному.
      $why = "";
      $get = function ($m) use ($t, &$why) {
        $c = curl_init("https://api.telegram.org/bot" . $t . "/" . $m);
        curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
        $body = curl_exec($c);
        if ($body === false && $why === "") $why = "curl " . curl_errno($c) . ": " . curl_error($c);
        $r = json_decode((string) $body, true); curl_close($c);
        return is_array($r) ? $r : [];
      };
      $me = $get("getMe");
      echo "бот=" . ($me["ok"] ?? false ? ($me["result"]["username"] ?? "?") : ("не отвечает [" . ($why ?: ($me["description"] ?? "пустой ответ")) . "]"));
      $g = $get("getChat?chat_id=-1001709270025");
      echo " группа=" . ($g["ok"] ?? false ? ($g["result"]["title"] ?? "?") : ("отказ: " . ($g["description"] ?? "?")));
      if (($g["ok"] ?? false) && !empty($me["result"]["id"])) {
        $m2 = $get("getChatMember?chat_id=-1001709270025&user_id=" . $me["result"]["id"]);
        echo " права=" . ($m2["ok"] ?? false ? ($m2["result"]["status"] ?? "?") : "не прочитать");
        $sm = $g["result"]["slow_mode_delay"] ?? 0;
        if ($sm) echo " медленный_режим=" . $sm . "с";
      }
      // Вебхук: после переезда домена он приведёт Telegram сюда. Ошибка
      // доставки видна только отсюда — сам бот об этом никому не скажет.
      $w = $get("getWebhookInfo");
      if ($w["ok"] ?? false) {
        $r = $w["result"];
        echo " вебхук=" . ($r["url"] ?? "нет")
           . " в_очереди=" . ($r["pending_update_count"] ?? 0);
        if (!empty($r["last_error_message"])) echo " последняя_ошибка=" . $r["last_error_message"];
      }
      // Отдельно — умеет ли контейнер вообще выходить наружу по https.
      // Без этого «бот не отвечает» ничего не значит: виноват может быть
      // и токен, и сеть, и отсутствие корневых сертификатов в образе.
      ' 2>&1 | tr -d '"\\\n\r' | cut -c1-400) > /var/lib/jt-tg-check2 2>/dev/null
    # И то же самое с самой машины, вне контейнера: если наружу не пускает
    # докерная сеть, а не провайдер, лечится это совсем иначе.
    {
      # Решающий замер: тот же запрос с машины, но отдельно по IPv6 и по IPv4.
      # Если IPv6 берёт всегда, а IPv4 не берёт никогда — закрыт не Telegram
      # вообще, а его IPv4-адрес. Контейнеру же достаётся только IPv4:
      # у докерной сети IPv6 нет. Отсюда и «с машины работает, из контейнера
      # нет» при одном и том же исходящем адресе.
      printf 'машина: '
      for v in 6 4; do
        ok=0
        for i in 1 2 3 4; do
          c=$(curl -sS -"$v" -o /dev/null -m 8 -w '%{http_code}' "https://api.telegram.org/" 2>/dev/null)
          [ "$c" = "302" ] && ok=$((ok + 1))
        done
        printf 'ipv%s=%s/4 ' "$v" "$ok"
      done
      printf 'адреса=%s ' "$(getent ahosts api.telegram.org 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ',')"
      # Свой IPv6: он тут есть, и это меняет советы по записям в DNS —
      # AAAA не обязана исчезать, у неё может быть куда указывать.
      printf 'свой_ipv6=%s' "$(ip -6 addr show scope global 2>/dev/null | grep -oE 'inet6 [0-9a-f:]+' | awk '{print $2}' | head -1)"
    } > /var/lib/jt-net-check2 2>/dev/null
  fi
  # Со временем съёмки: замер живёт до десяти минут, и без отметки не
  # отличить «стало хорошо» от «показываю то, что было до починки».
  echo "  \"телеграм\": \"$(date -d "@$(stat -c %Y /var/lib/jt-tg-check2 2>/dev/null || echo 0)" +%H:%M 2>/dev/null) $(cat /var/lib/jt-tg-check2 2>/dev/null | cut -c1-400)\","
  echo "  \"сеть\": \"$(cat /var/lib/jt-net-check2 2>/dev/null | tr -d '"\\\n\r' | cut -c1-200)\","

  # Анонимный путь: им приложение грузит файлы и держит живые подписки.
  # Подробности — в infra/check-anon.sh.
  echo "  \"анонимный_путь\": \"$(cat /var/lib/jt-anon-check2 2>/dev/null | tr -d '"\\\n\r' | cut -c1-300)\","
  echo "  \"вебхук_опыт\": \"$(cat /var/lib/jt-webhook-check 2>/dev/null | tr -d '"\\\n\r' | cut -c1-200)\","

  # Чем закончилась последняя публикация вакансии в группу. Записывает
  # db.php при каждой рассылке. Без этого причина отказа Telegram остаётся
  # внутри одного запроса и пропадает вместе с ним: снаружи видно только
  # «в личку пришло, в группу нет».
  gp=$(cd /opt/jobtoo/infra 2>/dev/null && timeout 15 docker compose exec -T \
       -e PGPASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' /opt/jobtoo-secrets/env | cut -d= -f2)" db \
       psql -tAq -U supabase_admin -d postgres -c \
       "select value from jm_settings where key = 'last_group_post';" 2>&1 \
       | tr -d '"\\\n\r' | cut -c1-400)
  echo "  \"публикация_в_группу\": \"${gp:-нет записи}\","

  # Ключевые шаги отдельно: в общем хвосте их забивают журналы контейнеров.
  echo "  \"роли\": \"$(grep -a '\[роли\]' /var/log/jt-apply.log 2>/dev/null | tail -2 | tr -d '"' | tr '\n' ' ' | cut -c1-400)\","
  echo "  \"миграции\": \"$(grep -a '\[миграции\]' /var/log/jt-apply.log 2>/dev/null | tail -2 | tr -d '"' | tr '\n' ' ' | cut -c1-300)\","
  echo "  \"заход\": \"$(tail -6 /var/log/jt-apply.log 2>/dev/null | tr -d '"' | tr '\n' ' ' | cut -c1-500)\""
  echo '}'
} > "$TMP" 2>/dev/null

mv -f "$TMP" "$OUT" 2>/dev/null || true
chmod 644 "$OUT" 2>/dev/null || true
