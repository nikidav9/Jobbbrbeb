#!/bin/bash
# Разворачивает и обновляет всё хозяйство на сервере.
#
# Вызывается двумя способами: один раз при первой загрузке (из cloud-init)
# и дальше по таймеру, после git pull. Поэтому обязан быть идемпотентным:
# второй запуск не должен ничего ломать и ничего пересоздавать заново.
#
# Секреты живут только здесь, на сервере, в /opt/jobtoo-secrets/env.
# В репозиторий они не попадают и в cloud-init их нет: тот виден в панели.
# Создаются один раз и потом не меняются — иначе при каждом обновлении
# менялись бы ключи, а с ними отвалились бы и приложение, и дашборд.
set -eu

REPO=/opt/jobtoo
SECRETS=/opt/jobtoo-secrets/env

say() {
  # Только в свой журнал.
  #
  # Раньше каждое сообщение уходило ещё и на ntfy.sh — сторонний сервис в
  # Германии. Он появился, когда сервер был нем и другого способа узнать о
  # происходящем не было. Способ давно есть: status.json и этот журнал,
  # оба на своей машине.
  #
  # А отправка осталась и продолжала работать: наружу, за границу, уходили
  # имена служб, версии, куски ошибок с адресами и путями. Немного, но
  # ровно то, что переезд затевался убрать.
  echo "$(date -Is) [$1] $2" >> /var/log/jt-apply.log
}

# ── Подготовка машины ─────────────────────────────────────────────────────
# Всё тяжёлое живёт здесь, а не в cloud-init, по горькому опыту: там это
# была служба типа oneshot, а systemd убивает такие через 90 секунд. Установка
# Docker в полторы минуты не укладывается, и она обрывалась на полуслове.
# Здесь же таймаут снят, а любая поломка чинится коммитом, а не пересозданием.

if [ ! -f /swapfile ]; then
  # На 4 ГБ памяти Postgres, Realtime и Storage без подкачки будут толкаться.
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile \
    && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

# Догоняем то, что появилось позже установки docker: на уже работающей
# машине блок ниже не выполняется, и новые зависимости туда не попадают.
if ! command -v aws >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y awscli >/dev/null 2>&1 || true
fi

# dig нужен отдельно: docker ставился до того, как он понадобился, и на
# уже работающей машине блок ниже не выполняется.
if ! command -v dig >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y dnsutils >/dev/null 2>&1 || true
fi

if ! command -v docker >/dev/null 2>&1; then
  say "установка" "ставлю docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y jq openssl python3 certbot python3-certbot-nginx dnsutils awscli
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh
  systemctl enable --now docker
  say "установка" "docker=$(docker --version 2>/dev/null || echo не встал)"
fi

# ── Файрвол ───────────────────────────────────────────────────────────────
# Прошлая попытка включить ufw обрушила сеть между контейнерами: его правило
# FORWARD по умолчанию DROP рвёт связь докерных сетей и их выход наружу.
# Внешне это выглядело как бесконечный перезапуск служб — сборка встала
# намертво вместе с наблюдением за ней.
#
# Поэтому теперь иначе: ufw не трогаем совсем, а закрываем лишнее через
# цепочку DOCKER-USER — ту самую, которую Docker для этого и оставляет и
# которую сам не перезаписывает.
#
# Наружу нужны только 22, 80, 443 и 8443 (панель). Всё остальное — Postgres,
# PostgREST, Realtime, Storage — слушает 127.0.0.1 и снаружи и так недоступно;
# правила ниже страхуют на случай, если что-то откроется по недосмотру.
if ! iptables -L DOCKER-USER -n 2>/dev/null | grep -q "jt-guard"; then
  iptables -I DOCKER-USER -m comment --comment "jt-guard" -j RETURN 2>/dev/null || true
fi

# 9000 — php-fpm. Он и так настроен слушать только 127.0.0.1 (см. compose),
# но контейнер работает в сети машины, и цена ошибки здесь — открытый наружу
# обработчик PHP. Две независимые преграды вместо одной.
for p in 5432 3000 3001 4000 5000 5001 8123 9000 10050; do
  if ! iptables -C INPUT -p tcp --dport "$p" ! -i lo -j DROP 2>/dev/null; then
    iptables -I INPUT -p tcp --dport "$p" ! -i lo -j DROP 2>/dev/null || true
  fi
done

# ── Журналы ───────────────────────────────────────────────────────────────
# Ничем не ограничены по умолчанию, а пишут непрерывно: Storage — строку на
# каждую картинку, Realtime — на каждую проверку. Растёт это молча и ровно
# до того дня, когда на диске кончится место и встанет Postgres. Причём
# первым делом человек посмотрит на базу и на файлы, а виноваты окажутся
# записи о том, как всё работало.
#
# Держим 14 дней и не больше 500 МБ — столько же, сколько храним резервные
# копии: дольше журнал всё равно бесполезен, а искать по нему причину
# позавчерашней поломки успеваешь.
if [ ! -f /etc/systemd/journald.conf.d/jt.conf ]; then
  mkdir -p /etc/systemd/journald.conf.d
  printf '[Journal]\nSystemMaxUse=500M\nMaxRetentionSec=14day\n' > /etc/systemd/journald.conf.d/jt.conf
  systemctl restart systemd-journald >/dev/null 2>&1 || true
  say "журналы" "ограничены: 500 МБ, 14 дней"
fi

# У Docker свой журнал, отдельный от системного, и по умолчанию тоже
# безразмерный.
#
# Файл кладём, но демон намеренно НЕ перезапускаем: это подняло бы заново
# все контейнеры, включая базу, ради настройки, которая начнёт действовать
# и без спешки. Она вступит в силу при ближайшей перезагрузке машины и
# коснётся заново созданных контейнеров. То есть сегодня это заготовка, а
# не действующее ограничение, — и врать себе об этом не нужно.
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" }
}
EOF
  say "журналы" "докеру задан предел: 3 файла по 20 МБ, вступит в силу после перезагрузки"
fi

# А пока — обрезаем то, что уже накопилось. Без этого предел, который
# заработает нескоро, не поможет против журнала, выросшего сегодня.
DKLOG=$(du -sm /var/lib/docker/containers 2>/dev/null | cut -f1)
if [ "${DKLOG:-0}" -gt 1000 ]; then
  find /var/lib/docker/containers -name '*-json.log' -size +200M -exec truncate -s 0 {} \; 2>/dev/null || true
  say "журналы" "докерные обрезаны, было ${DKLOG} МБ"
fi

# Отчёт из репозитория заменяет тот, что зашит в cloud-init: этот можно
# править коммитом, а тот — только пересозданием машины.
if [ -f "$REPO/infra/report.sh" ]; then
  install -m 755 "$REPO/infra/report.sh" /usr/local/bin/jt-report
fi

# Сам nginx обычно надёжен, но при его остановке внешний GitHub-monitor только
# сообщит о проблеме. Локальный watchdog раз в минуту проверяет настоящий TLS
# vhost через loopback и после двух последовательных сбоев безопасно
# перезапускает nginx. Сетевой маршрут Timeweb он намеренно не трогает.
if [ -f "$REPO/infra/site-watchdog.sh" ]; then
  install -m 755 "$REPO/infra/site-watchdog.sh" /usr/local/bin/jt-site-watchdog
  cat > /etc/systemd/system/jt-site-watchdog.service <<'EOF'
[Unit]
Description=JobToo website local watchdog
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jt-site-watchdog
# При новом commit watchdog запускает атомарную Expo-сборку. На этой машине
# systemd иначе обрывает oneshot через 90 секунд, и deploy не успевает
# установить/запустить фоновые службы нового commit.
TimeoutStartSec=1800
EOF
  cat > /etc/systemd/system/jt-site-watchdog.timer <<'EOF'
[Unit]
Description=Check and repair JobToo website every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now jt-site-watchdog.timer >/dev/null 2>&1 || true
fi

# Катучая история здоровья: одна строка в минуту в файл, который отдаёт nginx.
# status.json — снимок без прошлого; этот сэмплер копит таймлайн, по которому
# видно частоту коротких провалов и что с ними совпало. Своим таймером, а не в
# конце bootstrap: тот при тяжёлом заходе идёт дольше минуты и дал бы рваную
# шкалу. Подробности — в самом скрипте.
if [ -f "$REPO/infra/health-sample.sh" ]; then
  install -m 755 "$REPO/infra/health-sample.sh" /usr/local/bin/jt-health-sample
  cat > /etc/systemd/system/jt-health-sample.service <<'EOF'
[Unit]
Description=JobToo health history sampler
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jt-health-sample
EOF
  cat > /etc/systemd/system/jt-health-sample.timer <<'EOF'
[Unit]
Description=Sample JobToo health every minute

[Timer]
OnBootSec=3min
OnUnitActiveSec=1min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now jt-health-sample.timer >/dev/null 2>&1 || true
fi

# Разовый опыт: дозванивается ли Телеграм до этой машины напрямую.
# Подробности и сетка безопасности — в самом скрипте. Отметкой, а не
# каждую минуту: переключать вебхук по кругу нельзя.
#
# Первый заход (отметка jt-webhook.done) целил в jobtoo.ru и не вышел:
# «Connection timed out». Второй целит в tg.jobtoo.ru — имя без A-записи,
# и потому только по IPv6. Отметка новая, иначе опыт не повторился бы.
# Ждём сертификат: без него Телеграм откажется от вебхука на TLS-ошибке,
# и одна попытка сгорела бы впустую.
if [ -f "$REPO/infra/switch-webhook.sh" ] && [ ! -f /var/lib/jt-webhook-tg2.done ] \
   && [ -d /etc/letsencrypt/live/tg.jobtoo.ru ]; then
  touch /var/lib/jt-webhook-tg2.done
  bash "$REPO/infra/switch-webhook.sh" >/dev/null 2>&1 || true
fi

# Забор сообщений бота своими силами.
#
# Телеграм отказался ставить вебхук на имя без записи A — дословно
# «IPv6-only addresses are not allowed», — а по IPv4 эта машина с ним не
# разговаривает ни в одну сторону. Значит входящий путь нам недоступен в
# принципе, и остаётся обратный: спрашивать самим. Подробности в скрипте.
if [ -f "$REPO/infra/tg-poll.py" ]; then
  install -m 755 "$REPO/infra/tg-poll.py" /usr/local/bin/jt-tg-poll
  if [ ! -f /etc/systemd/system/jt-tgpoll.service ]; then
    cat > /etc/systemd/system/jt-tgpoll.service <<'EOF'
[Unit]
Description=JobToo: забор сообщений телеграм-бота
After=docker.service
Wants=docker.service

[Service]
ExecStart=/usr/local/bin/jt-tg-poll
Restart=always
RestartSec=5
StandardOutput=append:/var/log/jt-tgpoll.log
StandardError=append:/var/log/jt-tgpoll.log

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now jt-tgpoll.service >/dev/null 2>&1 || true
    say "бот" "включён забор сообщений своими силами"
  fi
  # Перезапуск при смене самого скрипта: служба держит соединение сутками и
  # сама новую версию не подхватит. Без этого правка здесь выглядела бы
  # применённой, а работал бы прежний код.
  if ! cmp -s "$REPO/infra/tg-poll.py" /var/lib/jt-tg-poll.deployed 2>/dev/null; then
    cp -f "$REPO/infra/tg-poll.py" /var/lib/jt-tg-poll.deployed
    systemctl restart jt-tgpoll.service 2>/dev/null || true
    say "бот" "забор перезапущен на новой версии"
  fi
  systemctl is-active --quiet jt-tgpoll.service || systemctl start jt-tgpoll.service 2>/dev/null || true
fi

# ── Jupiter: воркер подачи откликов ──────────────────────────────────────
# Создаётся отключённым: для запуска нужен профиль кандидата, которого пока
# нет. Включается вручную: systemctl enable --now jt-jupiter.service
if [ -f "$REPO/jupiter/run_worker.py" ] && [ ! -f /etc/systemd/system/jt-jupiter.service ]; then
  mkdir -p /var/lib/jupiter
  cat > /etc/systemd/system/jt-jupiter.service <<SVCEOF
[Unit]
Description=JobToo: Jupiter — подача откликов на карьерные сайты
After=docker.service
Wants=docker.service

[Service]
WorkingDirectory=$REPO/jupiter
EnvironmentFile=$SECRETS
Environment=JOBTOO_URL=https://jobtoo.ru
Environment=JUPITER_PROFILE=/var/lib/jupiter/profile.json
Environment=JUPITER_RECEIPTS=/var/lib/jupiter/receipts.json
Environment=JUPITER_HANDOFFS=/var/lib/jupiter/handoffs.json
ExecStart=/usr/bin/python3 $REPO/jupiter/run_worker.py
Restart=on-failure
RestartSec=30
StandardOutput=append:/var/log/jt-jupiter.log
StandardError=append:/var/log/jt-jupiter.log

[Install]
WantedBy=multi-user.target
SVCEOF
  systemctl daemon-reload
  say "jupiter" "юнит создан (отключён, нужен профиль)"
fi
if systemctl is-active --quiet jt-jupiter.service 2>/dev/null; then
  if ! cmp -s "$REPO/jupiter/run_worker.py" /var/lib/jupiter/.deployed 2>/dev/null; then
    cp -f "$REPO/jupiter/run_worker.py" /var/lib/jupiter/.deployed
    systemctl restart jt-jupiter.service 2>/dev/null || true
    say "jupiter" "перезапущен на новой версии"
  fi
fi

# Сторож — теперь запасной выход, а не основной путь.
#
# Пока забор жив, вебхука быть не должно вовсе: у Телеграма это
# взаимоисключающие способы. Поэтому сторож просыпается только когда отметка
# живости протухла на десять минут — тогда он вернёт вебхук на пересылку,
# и бот заговорит, пусть и прежним кружным путём.
BEAT=$(stat -c %Y /var/lib/jt-tg-beat 2>/dev/null || echo 0)
if [ -f "$REPO/infra/webhook-watch.sh" ] \
   && [ "$(( $(date +%s) - ${BEAT:-0} ))" -gt 600 ]; then
  if [ ! -f /var/lib/jt-webhook-check ] \
     || [ $(( $(date +%s) - $(stat -c %Y /var/lib/jt-webhook-check 2>/dev/null || echo 0) )) -gt 300 ]; then
    bash "$REPO/infra/webhook-watch.sh" >/dev/null 2>&1 || true
  fi
fi

# Проверка анонимного пути — того, чем приложение грузит файлы и держит
# живые подписки. Раз в десять минут: она лазает в базу и в три службы,
# а ответ меняется только когда мы сами что-то поменяли.
if [ -f "$REPO/infra/check-anon.sh" ]; then
  if [ ! -f /var/lib/jt-anon-check2 ] \
     || [ $(( $(date +%s) - $(stat -c %Y /var/lib/jt-anon-check2 2>/dev/null || echo 0) )) -gt 600 ]; then
    bash "$REPO/infra/check-anon.sh" >/dev/null 2>&1 || true
  fi
fi

# ── Секреты ───────────────────────────────────────────────────────────────
if [ ! -f "$SECRETS" ]; then
  mkdir -p "$(dirname "$SECRETS")"
  chmod 700 "$(dirname "$SECRETS")"

  PGPASS=$(openssl rand -hex 24)
  JWTSEC=$(openssl rand -hex 32)
  SKB=$(openssl rand -hex 32)
  # Realtime требует ровно 16 байт: с 32 он падает на «Bad key size» и
  # молча не обслуживает подписки, хотя контейнер выглядит здоровым.
  ENCKEY=$(openssl rand -hex 8)

  # Ключи anon и service_role — это JWT, подписанные тем же секретом.
  # Ровно так же, как в облачном Supabase, иначе PostgREST их не примет.
  keys=$(python3 - "$JWTSEC" <<'PY'
import base64, hmac, hashlib, json, sys, time
secret = sys.argv[1].encode()
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(role):
    now = int(time.time())
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    p = b64(json.dumps({"role":role,"iss":"supabase","iat":now,
                        "exp":now+60*60*24*365*10},separators=(',',':')).encode())
    msg = f"{h}.{p}".encode()
    sig = b64(hmac.new(secret, msg, hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"
print(jwt("anon")); print(jwt("service_role"))
PY
)
  ANON=$(echo "$keys" | sed -n 1p)
  SERVICE=$(echo "$keys" | sed -n 2p)

  cat > "$SECRETS" <<EOF
POSTGRES_PASSWORD=$PGPASS
JWT_SECRET=$JWTSEC
ANON_KEY=$ANON
SERVICE_ROLE_KEY=$SERVICE
SECRET_KEY_BASE=$SKB
REALTIME_ENC_KEY=$ENCKEY
EOF
  chmod 600 "$SECRETS"
  say "секреты" "созданы заново"
fi

# ── Ключи для уведомлений в браузере ──────────────────────────────────────
# Создаём здесь, а не приносим извне. Прежняя пара жила во внешней панели,
# и при переносе её пришлось бы оттуда доставать и куда-то передавать —
# то есть провести секрет через переписку. Один раз так и вышло.
#
# Сервер делает пару сам: приватная часть остаётся в этом файле и никуда не
# уходит, публичную можно называть вслух, её и так получает каждый браузер
# при подписке.
#
# Менять ключи стало безопасно: приложение сверяет, под каким ключом выдана
# подписка, и при несовпадении переподписывается (lib/webPush.ts). До этой
# правки смена ключей молча лишала уведомлений всех, кто уже подписан.
if ! grep -q '^VAPID_PRIVATE_KEY=' "$SECRETS" 2>/dev/null; then
  if openssl ecparam -name prime256v1 -genkey -noout -out /tmp/jt-vapid.pem 2>/dev/null; then
    vapid=$(openssl pkey -in /tmp/jt-vapid.pem -text -noout 2>/dev/null | python3 -c '
import sys, base64, re
t = sys.stdin.read()
def block(label, nxt):
    m = re.search(label + r":(.*?)" + nxt, t, re.S)
    return bytes.fromhex(re.sub(r"[^0-9a-f]", "", m.group(1))) if m else b""
# priv — 32 байта скаляра, pub — несжатая точка на 65 байт. Ровно в таком
# виде их ждёт веб-push: не PEM, не DER, а сырые байты в base64url.
priv = block("priv", "pub:")[-32:]
pub  = block("pub", "ASN1 OID|NIST CURVE|$")
pub  = pub[pub.find(b"\x04"):][:65] if b"\x04" in pub else pub[:65]
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
if len(priv) == 32 and len(pub) == 65:
    print(b64(priv)); print(b64(pub))
')
    VP=$(echo "$vapid" | sed -n 1p)
    VB=$(echo "$vapid" | sed -n 2p)
    if [ -n "$VP" ] && [ -n "$VB" ]; then
      echo "VAPID_PRIVATE_KEY=$VP" >> "$SECRETS"
      echo "VAPID_PUBLIC_KEY=$VB"  >> "$SECRETS"
      say "vapid" "пара создана, публичный: $VB"
    else
      say "vapid" "разобрать ключ не вышло — уведомления в браузере пока на прежней паре"
    fi
    rm -f /tmp/jt-vapid.pem
  fi
fi

# Ключ подписи пользовательских сессий.
#
# Раньше его не было вовсе, и db.php подписывал токены ключом базы. Это значило
# две вещи: ротация ключа базы разлогинивала всех разом, а при пустом ключе
# подпись считалась пустым ключом — то есть токен на любой чужой id
# подделывался. Теперь ключ свой и заводится один раз.
#
# Создаётся здесь, а не доставляется из GitHub: deploy.php пересобирает
# app_secrets.php по жёсткому списку ключей и посторонние из него вычищает.
# До прокси ключ доезжает переменной окружения — см. блок php в
# docker-compose.yml.
#
# Перезаписывать нельзя: новый ключ обесценит все выданные токены и разлогинит
# всех живых пользователей разом.
grep -q '^SESSION_SECRET=' "$SECRETS" 2>/dev/null \
  || echo "SESSION_SECRET=$(openssl rand -hex 32)" >> "$SECRETS"

# Отдельная подпись короткой cookie закрытого Jupiter Lab. Не используем
# SESSION_SECRET приложения: компрометация тестового стенда не должна
# обесценивать пользовательские сессии JobToo.
grep -q '^JUPITER_SESSION_SECRET=' "$SECRETS" 2>/dev/null \
  || echo "JUPITER_SESSION_SECRET=$(openssl rand -hex 32)" >> "$SECRETS"

ln -sf "$SECRETS" "$REPO/infra/.env"
grep -q "^PUBLIC_URL=" "$SECRETS" || echo "PUBLIC_URL=http://$(hostname -I | awk '{print $1}')" >> "$SECRETS"

# Секреты нужны не только docker compose, но и самому скрипту — для psql.
set -a; . "$SECRETS"; set +a

# ── Рабочий каталог прокси ────────────────────────────────────────────────
# Прокси ищет свои секреты рядом с собой — так устроен jt_secret(), и так же
# это лежит на Reg.ru. Поэтому собираем каталог, где код и секреты вместе:
# код из репозитория, секреты остаются между обновлениями.
#
# Сервисный ключ берём свой, локальный: прокси теперь ходит в свою же базу.
# Пропуск приложения и токен бота приезжают извне — в репозитории им не место.
# В образе php-fpm слушает 9000 на всех адресах. Пока у контейнера была своя
# сеть, это никого не касалось; теперь сеть общая с машиной, и без этой
# настройки обработчик PHP оказался бы открыт наружу.
mkdir -p /opt/jobtoo-php
printf '[www]\nlisten = 127.0.0.1:9000\n' > /opt/jobtoo-php/zz-listen.conf
chmod 644 /opt/jobtoo-php/zz-listen.conf

PROXY=/opt/jobtoo-proxy
mkdir -p "$PROXY"
MIGRATIONS_READY=1
if [ -s "$PROXY/db.php" ] && [ -x "$REPO/infra/migrate.sh" ]; then
  if ! bash "$REPO/infra/migrate.sh"; then
    MIGRATIONS_READY=0
    say "выкладка" "миграции не прошли — PHP и сайт оставлены прежними"
  fi
fi
if [ "$MIGRATIONS_READY" = 1 ]; then
  cp -f "$REPO"/php-proxy/*.php "$PROXY"/ 2>/dev/null || true
fi

# Отдельный серверный ключ для шифрования native push-токенов. Не ротируем
# его вместе с кодом: иначе уже зарегистрированные устройства потеряют push.
if [ ! -s "$PROXY/push_token_key.php" ]; then
  PUSH_TOKEN_KEY=$(openssl rand -base64 32 | tr -d '\n')
  printf "<?php return '%s';\n" "$PUSH_TOKEN_KEY" > "$PROXY/push_token_key.php"
  chmod 640 "$PROXY/push_token_key.php"
  chown root:www-data "$PROXY/push_token_key.php" 2>/dev/null || true
fi
# И описания рядом с кодом. Раньше копировались только .php, и оба json —
# описание API для партнёра и образец фида — на сервер не попадали вовсе.
# Снаружи это выглядело благополучно: адрес отвечает 200, а тело пустое.
# Партнёр, которому дали такую ссылку, решил бы, что у нас всё сломано.
cp -f "$REPO"/php-proxy/*.json "$PROXY"/ 2>/dev/null || true
rm -f "$PROXY"/*.example.php

printf "<?php return '%s';\n" "$SERVICE_ROLE_KEY" > "$PROXY/sb_service_key.php"
# sb_url.php здесь больше не пишется: адрес бэкенда теперь задан прямо в коде
# прокси (db.php, tg.php, admin.php, sb_lite.php) и переключателем не является.
# Это и был аварийный откат в облако — ровно та настройка, которой первичная
# запись ПДн граждан РФ уводилась бы за границу мимо ч. 5 ст. 18 152-ФЗ.
# Старый файл, если остался с прежних выкаток, убираем: лежащий рядом с кодом
# файл с адресом выглядит работающим, хотя его больше никто не читает.
rm -f "$PROXY/sb_url.php"

# Токен для доставки секретов из GitHub — см. php-proxy/deploy.php.
# Создаётся один раз: сменится он — и выкладка перестанет доходить, а
# заметно это станет только когда понадобится поменять пароль.
if [ ! -f /opt/jobtoo-secrets/deploy ]; then
  echo "DEPLOY_TOKEN=$(openssl rand -hex 24)" > /opt/jobtoo-secrets/deploy
  chmod 600 /opt/jobtoo-secrets/deploy
fi
. /opt/jobtoo-secrets/deploy
printf "<?php return '%s';\n" "$DEPLOY_TOKEN" > "$PROXY/deploy_token.php"

# Всё, что нужно вписать в настройки репозитория, — одной страницей за
# паролем панели. Иначе эти значения приходится диктовать в переписке, а
# оттуда они уже не убираются.
#
# Ключи anon и service_role сюда попадают намеренно: без них приложение не
# сможет уйти с облака на этот сервер. Страница закрыта тем же паролем, что
# и панель, — а панель показывает переписку и телефоны, то есть куда больше.
mkdir -p /var/www/private
{
  echo "# Вписать в Settings → Secrets and variables → Actions"
  echo
  echo "## Можно вписывать сейчас"
  echo
  echo "JT_DEPLOY_TOKEN=$DEPLOY_TOKEN"
  echo "SB_SERVICE_KEY=$SERVICE_ROLE_KEY"
  echo
  echo "## ТОЛЬКО ПОСЛЕ переезда домена на этот сервер"
  echo "#"
  echo "# Эти два уводят живые чаты и загрузку файлов с облака сюда."
  echo "# Пока jobtoo.ru указывает на Reg.ru, там нет ни /rest/v1, ни"
  echo "# /storage/v1 — и первое же обновление по воздуху сломает чаты и"
  echo "# фотографии у всех разом. Обновление уходит само, на каждый коммит,"
  echo "# так что ошибиться здесь можно ровно один раз."
  echo
  echo "EXPO_PUBLIC_SUPABASE_URL=https://jobtoo.ru"
  echo "EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY"
} > /var/www/private/token.txt
chmod 640 /var/www/private/token.txt
chown root:www-data /var/www/private/token.txt 2>/dev/null || true

# 33 — www-data в обычном образе PHP; в alpine это был 82. Номер важен:
# каталог закрыт для посторонних, и с чужим владельцем прокси не прочитает
# собственные секреты, а доставка из GitHub не сможет их обновить.
chown -R 33:33 "$PROXY" 2>/dev/null || true
chmod 750 "$PROXY"

# ── Доступ к GitHub ───────────────────────────────────────────────────────
# Пока репозиторий открыт, ни git, ни загрузка сборок пароля не требуют.
# Стоит его закрыть — и то, и другое начнёт отказывать, причём загрузка
# сборок молча: сервер просто оставит старую версию сайта.
#
# Поэтому заранее: если токен доставлен (см. php-proxy/deploy.php), git
# начинает ходить с ним, а curl добавляет заголовок. Нет токена — всё
# работает как раньше, ни одна строка ниже не меняется.
# Со своим cd, и это не мелочь.
#
# Каталог со сборкой контейнеров скрипт выбирает ниже по тексту, а сюда
# приходит с тем, что дала служба по таймеру, — то есть, скорее всего, с
# корнем. docker compose там файла не находит, команда тихо возвращает
# пустоту, и токен получается пустым. Ошибки при этом нет нигде.
#
# Пока репозиторий был открытым, это не значило ничего: git и так ходил без
# пароля. После закрытия сервер перестал получать обновления вовсе, и
# причина выглядела как «токен не работает», хотя токен был исправен и его
# просто ни разу не прочитали.
GH_TOKEN=$( (cd "$REPO/infra" && docker compose exec -T php php -r '
  $v = @include "/var/www/api/gh_token.php";
  echo is_string($v) ? $v : "";') 2>/dev/null | tr -d '\r\n' || true)

GH_HDR=()
if [ -n "${GH_TOKEN:-}" ]; then
  GH_HDR=(-H "Authorization: Bearer $GH_TOKEN")
  # git — через отдельный файл, а не через адрес: токен в адресе остаётся
  # в .git/config и всплывает в каждом сообщении об ошибке.
  git config --global credential.helper store 2>/dev/null || true
  printf 'https://x-access-token:%s@github.com\n' "$GH_TOKEN" > /root/.git-credentials
  chmod 600 /root/.git-credentials

  # И то же самое в адрес самого хранилища.
  #
  # Красивее было бы обойтись файлом, но он читается относительно HOME, а
  # обновления тянет служба по таймеру — с окружением, которое мы не писали.
  # Когда репозиторий закрыли, оказалось, что до файла она не дотягивается:
  # «could not read Username», то есть учётных данных не нашлось вовсе.
  # Сервер отстал на девять коммитов, и починить это изнутри было нечем —
  # канал доставки правок обрывался тем же самым отказом.
  #
  # Адрес от HOME не зависит: он лежит в .git/config самого хранилища. Токен
  # в нём — плата за то, чтобы обновления доезжали при любом окружении.
  # Права на каталог и так только у root, а всплыть в чужом логе он может
  # разве что при ошибке git — это меньшее из двух зол.
  CUR=$(git -C /opt/jobtoo config --get remote.origin.url 2>/dev/null || true)
  WANT="https://x-access-token:$GH_TOKEN@github.com/nikidav9/JobToo.git"
  if [ "$CUR" != "$WANT" ]; then
    git -C /opt/jobtoo remote set-url origin "$WANT" 2>/dev/null \
      && say "обновления" "адрес хранилища переписан с токеном"
  fi
fi

# Пропуск приложения — в переменные compose.
#
# Дашборд принимает рассылки от сервера по заголовку x-app-secret, но живёт
# этот пропуск не здесь, а в app_secrets.php: его кладёт выкладка, а не этот
# скрипт. Контейнер о нём не знал бы и отвечал 401 на каждую попытку послать
# уведомление в браузер — молча, потому что зовущая сторона ответ не читает.
#
# Поэтому переносим значение в файл переменных. Читаем через сам PHP: файл
# написан через base64_decode, и разобрать его текстом нельзя.
if [ -n "${GH_TOKEN+x}" ]; then
  APP_SECRET_VAL=$( (cd "$REPO/infra" && docker compose exec -T php php -r '
    $s = @include "/var/www/api/app_secrets.php";
    echo is_array($s) ? ($s["APP_SECRET"] ?? "") : "";') 2>/dev/null | tr -d '\r\n' || true)
  if [ -n "${APP_SECRET_VAL:-}" ] \
     && ! grep -qx "EXPO_PUBLIC_APP_SECRET=$APP_SECRET_VAL" "$SECRETS" 2>/dev/null; then
    sed -i '/^EXPO_PUBLIC_APP_SECRET=/d' "$SECRETS"
    echo "EXPO_PUBLIC_APP_SECRET=$APP_SECRET_VAL" >> "$SECRETS"
  fi
fi

# Серверный пропуск административных API. Пока отдельный токен не задан,
# используем пароль дашборда: он уже не попадает в клиентские сборки.
ADMIN_TOKEN_VAL=$( (cd "$REPO/infra" && docker compose exec -T php php -r '
  $s = @include "/var/www/api/app_secrets.php";
  $a = @include "/var/www/api/admin_credentials.php";
  echo is_array($s) && !empty($s["ADMIN_API_TOKEN"])
    ? $s["ADMIN_API_TOKEN"]
    : (is_array($a) ? ($a["password"] ?? "") : "");') 2>/dev/null | tr -d '\r\n' || true)
if [ -n "${ADMIN_TOKEN_VAL:-}" ] \
   && ! grep -qx "ADMIN_API_TOKEN=$ADMIN_TOKEN_VAL" "$SECRETS" 2>/dev/null; then
  sed -i '/^ADMIN_API_TOKEN=/d' "$SECRETS"
  echo "ADMIN_API_TOKEN=$ADMIN_TOKEN_VAL" >> "$SECRETS"
fi

# Ключи к объектному хранилищу — туда же, в файл переменных: скрипт копий
# читает именно его. Приезжают они тем же каналом, что и остальные секреты
# (deploy.php), и лежат в backup_s3.php рядом с прочими.
S3_CONF=$( (cd "$REPO/infra" && docker compose exec -T php php -r '
  $s = @include "/var/www/api/backup_s3.php";
  if (!is_array($s)) exit;
  printf("%s\n%s\n%s\n%s\n", $s["endpoint"] ?? "", $s["bucket"] ?? "",
                                 $s["key"] ?? "", $s["secret"] ?? "");') 2>/dev/null || true)
if [ -n "$S3_CONF" ]; then
  S3_END=$(printf '%s' "$S3_CONF" | sed -n 1p)
  S3_BKT=$(printf '%s' "$S3_CONF" | sed -n 2p)
  S3_KEY=$(printf '%s' "$S3_CONF" | sed -n 3p)
  S3_SEC=$(printf '%s' "$S3_CONF" | sed -n 4p)
  if [ -n "$S3_BKT" ] && [ -n "$S3_KEY" ] \
     && ! grep -qx "BACKUP_S3_BUCKET=$S3_BKT" "$SECRETS" 2>/dev/null; then
    sed -i '/^BACKUP_S3_ENDPOINT=/d;/^BACKUP_S3_BUCKET=/d;/^AWS_ACCESS_KEY_ID=/d;/^AWS_SECRET_ACCESS_KEY=/d' "$SECRETS"
    {
      echo "BACKUP_S3_ENDPOINT=${S3_END:-https://s3.twcstorage.ru}"
      echo "BACKUP_S3_BUCKET=$S3_BKT"
      echo "AWS_ACCESS_KEY_ID=$S3_KEY"
      echo "AWS_SECRET_ACCESS_KEY=$S3_SEC"
    } >> "$SECRETS"
    say "копии" "ключи хранилища приняты, бакет $S3_BKT"
  fi
fi

# Скачать файл из выпуска.
#
# Тонкость, из-за которой дашборд когда-то и перестал обновляться, когда
# репозиторий закрыли. Обычный адрес /releases/download/… у закрытого
# репозитория заголовком Authorization не открывается: github.com уводит на
# страницу входа, и вместо архива приезжает HTML. Токен при этом исправен —
# просто не тому адресу предъявлен.
#
# Правильный путь — через API: сперва узнать номер файла в выпуске, потом
# забрать его по номеру с Accept: application/octet-stream. Оттуда идёт
# переадресация на хранилище с подписанной ссылкой; curl при переходе на
# чужой узел заголовок Authorization не тащит, и это как раз то, что нужно —
# иначе хранилище отвечает «две проверки сразу».
#
# Без токена остаётся прежний прямой адрес: для открытого репозитория он
# работает и не требует ничего.
gh_asset() {
  local tag="$1" name="$2" out="$3" id
  if [ -n "${GH_TOKEN:-}" ]; then
    id=$(curl -fsSL -m 60 "${GH_HDR[@]}" -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/nikidav9/JobToo/releases/tags/$tag" 2>/dev/null \
      | python3 -c 'import sys,json
d = json.load(sys.stdin)
print(next((str(a["id"]) for a in d.get("assets", []) if a.get("name") == sys.argv[1]), ""))' \
        "$name" 2>/dev/null) || id=""
    if [ -z "$id" ]; then
      return 1
    fi
    curl -fsSL -m 300 "${GH_HDR[@]}" -H 'Accept: application/octet-stream' \
      -o "$out" "https://api.github.com/repos/nikidav9/JobToo/releases/assets/$id" 2>/dev/null
    return $?
  fi
  curl -fsSL -m 300 -o "$out" \
    "https://github.com/nikidav9/JobToo/releases/download/$tag/$name" 2>/dev/null
}

# ── Сайт ──────────────────────────────────────────────────────────────────
# Собранная веб-версия приезжает не так, как на Reg.ru. Туда её кладёт
# GitHub по FTP; сюда положить нечем — ни FTP, ни ssh, и заводить их значит
# держать ключ от сервера в настройках репозитория.
#
# Поэтому наоборот: сборка выкладывается выпуском с постоянной меткой web,
# а сервер забирает её сам — тем же движением, каким забирает infra/.
#
# Разворачиваем во временный каталог и подменяем готовым: если архив побит
# или скачался наполовину, на месте останется прежний рабочий сайт, а не
# половина нового.
if [ "$MIGRATIONS_READY" != 1 ]; then
  say "сайт" "обновление отложено до успешных миграций"
elif gh_asset web dist.tar.gz /tmp/jt-web.tgz; then
  SUM=$(sha256sum /tmp/jt-web.tgz | cut -d' ' -f1)
  if [ "$SUM" != "$(cat /var/lib/jt-web.sha 2>/dev/null || true)" ]; then
    WEB_RELEASES=/var/www/jobtoo-releases
    WEB_RELEASE="$WEB_RELEASES/$SUM"
    rm -rf "$WEB_RELEASE.tmp" && mkdir -p "$WEB_RELEASE.tmp"
    if tar -xzf /tmp/jt-web.tgz -C "$WEB_RELEASE.tmp" 2>/dev/null && [ -s "$WEB_RELEASE.tmp/index.html" ]; then
      # iOS сохраняет установленную PWA агрессивнее обычной вкладки. Старый
      # index.html может проснуться уже после выкладки и запросить bundle с
      # отпечатком предыдущей версии. Раньше каталог подменялся целиком, такого
      # файла уже не было — JavaScript не стартовал, заставка повторялась и
      # оставалась навсегда. Переносим в новую выкладку хешированные файлы
      # предыдущей: старая оболочка сможет загрузиться, обновить service worker
      # и на следующей навигации перейти на свежий index.html.
      WEB_CURRENT=$(readlink -f /var/www/jobtoo 2>/dev/null || true)
      if [ -d "$WEB_CURRENT" ]; then
        for tree in _expo/static assets; do
          if [ -d "$WEB_CURRENT/$tree" ]; then
            mkdir -p "$WEB_RELEASE.tmp/$tree"
            cp -an "$WEB_CURRENT/$tree/." "$WEB_RELEASE.tmp/$tree/" 2>/dev/null || true
          fi
        done
      fi
      # Каждый выпуск неизменяемый, а обслуживаемый путь — ссылка. rename(2)
      # меняет её одним действием: nginx видит целиком старую или целиком
      # новую сборку, но никогда пустой/наполовину заменённый каталог.
      mkdir -p "$WEB_RELEASES"
      rm -rf "$WEB_RELEASE"
      mv "$WEB_RELEASE.tmp" "$WEB_RELEASE"
      chmod -R a+rX "$WEB_RELEASE"
      if [ -d /var/www/jobtoo ] && [ ! -L /var/www/jobtoo ]; then
        mv /var/www/jobtoo "$WEB_RELEASES/pre-atomic-$(date +%s)"
      fi
      ln -s "$WEB_RELEASE" /var/www/jobtoo.next
      mv -Tf /var/www/jobtoo.next /var/www/jobtoo
      # Совместимость нужна на время, а не навсегда. Удаляем только старые
      # хешированные файлы; текущие имеют свежую дату из нового архива.
      find "$WEB_RELEASE/_expo/static" "$WEB_RELEASE/assets" -type f -mtime +45 -delete 2>/dev/null || true
      # Двух предыдущих выпусков достаточно для старых PWA-оболочек; текущий
      # каталог find никогда не удаляет.
      find "$WEB_RELEASES" -mindepth 1 -maxdepth 1 -type d ! -path "$WEB_RELEASE" -printf '%T@ %p\n' \
        | sort -nr | tail -n +3 | cut -d' ' -f2- | xargs -r rm -rf
      echo "$SUM" > /var/lib/jt-web.sha
      say "сайт" "обновлён, файлов: $(find /var/www/jobtoo -type f | wc -l)"
    else
      say "сайт" "архив не распаковался — оставляю прежний"
      rm -rf "$WEB_RELEASE.tmp"
    fi
  fi
  rm -f /tmp/jt-web.tgz
  echo ok > /var/lib/jt-web.ok
else
  # Молчать здесь нельзя. Сборка не скачалась — сайт остаётся прежним, и
  # снаружи это выглядит как «выкладка не доехала», без единой подсказки.
  rm -f /var/lib/jt-web.ok
  say "сайт" "сборка не скачалась (репозиторий закрыт без токена?)"
fi

# ── Дашборд ───────────────────────────────────────────────────────────────
# Тем же способом, что и веб-версия: сборка приезжает выпуском, потому что
# собирать Next.js здесь нельзя — он съедает под два гигабайта и уронит базу.
#
# Забираем всегда, а запускаем только когда есть что запускать: пока файла
# server.js нет, служба не поднимается и место не занимает.
# Переход со старой однослотовой схемы должен сработать даже без нового
# архива. Иначе уже записанная сумма совпадёт, блок обновления будет пропущен,
# а compose удалит прежний сервис как orphan — панель останется без процесса.
if [ -s /opt/jobtoo-dashboard/server.js ] \
   && [ ! -e /opt/jobtoo-dashboard-blue ] && [ ! -e /opt/jobtoo-dashboard-green ]; then
  mv /opt/jobtoo-dashboard /opt/jobtoo-dashboard-blue
  printf '%s' blue > /var/lib/jt-dash-slot
  say "дашборд" "прежняя сборка перенесена в blue-слот"
fi

if gh_asset dashboard dashboard.tar.gz /tmp/jt-dash.tgz; then
  DSUM=$(sha256sum /tmp/jt-dash.tgz | cut -d' ' -f1)
  if [ "$DSUM" != "$(cat /var/lib/jt-dash.sha 2>/dev/null || true)" ]; then
    ACTIVE=$(cat /var/lib/jt-dash-slot 2>/dev/null || echo green)
    [ "$ACTIVE" = blue ] && NEXT=green || NEXT=blue
    NEXT_DIR="/opt/jobtoo-dashboard-$NEXT"
    rm -rf "$NEXT_DIR.tmp" && mkdir -p "$NEXT_DIR.tmp"
    if tar -xzf /tmp/jt-dash.tgz -C "$NEXT_DIR.tmp" 2>/dev/null && [ -s "$NEXT_DIR.tmp/server.js" ]; then
      rm -rf "$NEXT_DIR"
      mv "$NEXT_DIR.tmp" "$NEXT_DIR"
      chmod -R a+rX "$NEXT_DIR"
      cd "$REPO/infra"
      if timeout 300 docker compose --env-file "$SECRETS" --profile dashboard \
          up -d --force-recreate "dashboard-$NEXT" >/tmp/jt-dash-up.log 2>&1; then
        [ "$NEXT" = blue ] && NEXT_PORT=3002 || NEXT_PORT=3003
        # Не направляем людей в новый слот, пока Next.js действительно не
        # отвечает. Старый слот всё это время продолжает обслуживать nginx.
        READY=false
        for _ in $(seq 1 30); do
          if curl -fsS -m 3 "http://127.0.0.1:$NEXT_PORT/" >/dev/null; then READY=true; break; fi
          sleep 2
        done
        if [ "$READY" = true ]; then
          printf '%s' "$NEXT" > /var/lib/jt-dash-slot
          printf '%s' "$ACTIVE" > /var/lib/jt-dash-switch-pending
          echo "$DSUM" > /var/lib/jt-dash.sha
          say "дашборд" "слот $NEXT проверен; переключение будет атомарно при reload nginx"
        else
          docker compose --env-file "$SECRETS" --profile dashboard stop "dashboard-$NEXT" >/dev/null 2>&1 || true
          say "дашборд" "новый слот $NEXT не прошёл проверку — оставляю $ACTIVE"
        fi
      else
        say "дашборд" "новый слот $NEXT не поднялся — оставляю $ACTIVE"
      fi
    else
      say "дашборд" "архив не распаковался — оставляю прежний"
      rm -rf /tmp/jt-dash
    fi
  fi
  rm -f /tmp/jt-dash.tgz
fi

# Сумма архива может не измениться, а переменные окружения — измениться.
# Поднимаем активный слот по отпечатку сборки и секретов, сохраняя поведение
# актуального main, где новый APP_SECRET доезжал в уже собранный дашборд.
ACTIVE=$(cat /var/lib/jt-dash-slot 2>/dev/null || echo blue)
ACTIVE_DIR="/opt/jobtoo-dashboard-$ACTIVE"
cd "$REPO/infra"
if [ -s "$ACTIVE_DIR/server.js" ]; then
  DFP=$(cat /var/lib/jt-dash.sha 2>/dev/null; grep -m1 '^EXPO_PUBLIC_APP_SECRET=' "$SECRETS" 2>/dev/null || true)
  DFP=$(printf '%s' "$DFP" | sha256sum | cut -d' ' -f1)
  if [ "$DFP" != "$(cat /var/lib/jt-dash.fp 2>/dev/null || true)" ] \
     || ! docker compose --env-file "$SECRETS" --profile dashboard ps "dashboard-$ACTIVE" \
          --format '{{.State}}' 2>/dev/null | grep -q running; then
    timeout 300 docker compose --env-file "$SECRETS" --profile dashboard \
      up -d --force-recreate "dashboard-$ACTIVE" >/tmp/jt-dash-active.log 2>&1 \
      && printf '%s' "$DFP" > /var/lib/jt-dash.fp \
      || say "дашборд" "активный слот $ACTIVE не поднялся"
  fi
fi

# ── Контейнеры ────────────────────────────────────────────────────────────
cd "$REPO/infra"
chmod +x init/*.sh 2>/dev/null || true
# up -d сам по себе безвреден: контейнеры, у которых ничего не изменилось,
# он не трогает. Но вывод в журнал каждую минуту засоряет его так, что
# полезное тонет, поэтому пишем только при изменениях.
timeout 600 docker compose --env-file "$SECRETS" up -d --remove-orphans >/tmp/jt-compose.log 2>&1 \
  || say "контейнеры" "up не уложился в 10 минут"
grep -qE "Started|Recreated|Created" /tmp/jt-compose.log 2>/dev/null \
  && say "контейнеры" "$(grep -aE "Started|Recreated|Created" /tmp/jt-compose.log | tr -d "\r" | tr "\n" " " | cut -c1-200)"

# Дашборд — отдельным ходом и только когда сборка приехала. Он в профиле,
# то есть общий up его не касается: это и позволяет держать его готовым, но
# выключенным, пока не решат переносить.
#
# Раньше здесь стояла отметка «уже поднимали», и поднимался он ровно один раз
# за всю жизнь машины. Из-за неё контейнер так и работал со старым набором
# переменных: пропуск приложения приехал, в файле лежал, а внутрь не попал —
# и дашборд отвечал «EXPO_PUBLIC_APP_SECRET не задан на сервере» тому, кто
# в этот момент отвечал человеку в поддержке.
#
# Теперь как у всех остальных: зовём каждый раз, а в журнал пишем, только
# когда что-то действительно изменилось. Compose сам не трогает контейнер,
# у которого совпали образ, переменные и настройки.
#
# По отпечатку, а не каждую минуту. Прошлая правка звала up -d на каждом
# заходе — «compose сам не тронет то, что не менялось». На деле контейнер
# пересоздавался снова и снова, и в эти секунды статика отдавалась с ошибкой:
# страница открывалась, а стили и скрипты к ней — нет. Снаружи это выглядело
# как белый экран.
#
# Отпечаток — из того, от чего контейнер действительно зависит: версии сборки
# и пропуска приложения. Изменилось что-то из этого — поднимаем заново.

# ── Шлюз ──────────────────────────────────────────────────────────────────
# Свою конфигурацию кладём вместо стандартной: две одновременно спорят
# за default_server, и nginx не поднимется.
# Конфигурацию собираем целиком и перезапускаем ОДИН раз.
#
# Раньше сначала клался вариант без TLS с перезапуском, а защищённая часть
# дописывалась в самом конце — после ролей, миграций, переноса и копий. Всё
# это время порт 443 не слушал, и прокси на хостинге получал отказ. Каждую
# минуту, по несколько минут кряду.

# ── Заголовки к данным ────────────────────────────────────────────────────
# Здесь стоял временный мост: пока прокси жил на Reg.ru и ходил со старым
# ключом облака, nginx принимал тот ключ и подставлял вместо него наш.
#
# Мост своё отработал. Домен переехал 15.08, прокси теперь на этой же
# машине и ходит со своим ключом, а старый — от чужого проекта, который мы
# покидаем, — больше не должен открывать наши данные. Держать его дальше
# значило бы оставить действующий пропуск ради удобства, которого уже нет.
#
# Сами переменные остаются: на них ссылается конфигурация шлюза, и здесь
# они просто пропускают заголовок как есть. Так убирается ровно подмена, а
# не кусок настройки, о котором потом никто не вспомнит.
cat > /etc/nginx/conf.d/jt-authswap.conf <<'EOF'
map $http_authorization $jt_auth  { default $http_authorization; }
map $http_apikey        $jt_apikey { default $http_apikey; }
EOF
chmod 644 /etc/nginx/conf.d/jt-authswap.conf

# ── Панель и сертификат ───────────────────────────────────────────────────
# Пароль к панели задаёт владелец, а не сервер.
#
# Сначала было наоборот: сервер придумывал пароль сам. Звучит надёжнее, а на
# деле хуже — такой пароль надо как-то передать владельцу, то есть провести
# через переписку, страницу или журнал. И он перестаёт быть паролем. А если
# не передать, к панели не попадёшь вовсе: она же за ним и закрыта.
#
# Заданный владельцем не передаётся никуда: он его и так знает. Приезжает
# тем же путём, что остальные секреты, — из настроек репозитория.
#
# Сгенерированный остаётся запасным вариантом на случай, если своего ещё не
# задали: без пароля панель открылась бы всем, а она показывает переписку.
if [ -r "$PROXY/studio_credentials.php" ]; then
  SC=$(docker compose exec -T php php -r '
    $v = @include "/var/www/api/studio_credentials.php";
    if (is_array($v)) echo ($v["login"] ?? "") . "\n" . ($v["password"] ?? "");
  ' 2>/dev/null | tr -d '\r')
  STUDIO_USER=$(echo "$SC" | sed -n 1p)
  STUDIO_PASS=$(echo "$SC" | sed -n 2p)
fi

if [ -z "${STUDIO_PASS:-}" ]; then
  if [ ! -f /opt/jobtoo-secrets/studio ]; then
    SPASS=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
    echo "STUDIO_USER=admin"  >  /opt/jobtoo-secrets/studio
    echo "STUDIO_PASS=$SPASS" >> /opt/jobtoo-secrets/studio
    chmod 600 /opt/jobtoo-secrets/studio
  fi
  . /opt/jobtoo-secrets/studio
fi

# Пересобираем при смене пароля, а не только при первом запуске. Прежняя
# проверка «файла нет — создать» означала, что сменить пароль нельзя вовсе:
# положили новый, а вход остался по старому, и понять это можно только
# попробовав.
WANT=$(printf '%s' "${STUDIO_USER}:${STUDIO_PASS}" | sha256sum | cut -d' ' -f1)
if [ "$WANT" != "$(cat /etc/nginx/.htpasswd.mark 2>/dev/null || true)" ]; then
  printf '%s:%s\n' "$STUDIO_USER" "$(openssl passwd -apr1 "$STUDIO_PASS")" > /etc/nginx/.htpasswd
  chmod 640 /etc/nginx/.htpasswd
  chown root:www-data /etc/nginx/.htpasswd 2>/dev/null || true
  echo "$WANT" > /etc/nginx/.htpasswd.mark
  chmod 600 /etc/nginx/.htpasswd.mark
  say "панель" "пароль обновлён"
fi

# Сертификат на имя вида <адрес>.sslip.io: своего домена пока нет, а без
# TLS пароль к панели ходил бы открытым текстом. Имя временное, поменяем
# на db.jobtoo.ru, когда до записи дойдут руки.
# Строго IPv4: ifconfig.me отдавал IPv6, и имя получалось несуществующим —
# certbot честно не мог выпустить сертификат на 2a03:...sslip.io.
IP=$(ip -4 addr show scope global 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
IP6=$(ip -6 addr show scope global 2>/dev/null | grep -oE 'inet6 [0-9a-f:]+' | awk '{print $2}' | head -1)
HOST="${IP}.sslip.io"

# certonly, а не --nginx: правки certbot в конфигурации не выживали. Этот
# скрипт переписывает её каждую минуту и стирал всё, что тот вносил —
# сертификат был выпущен, а отдавать его было некому.
if [ ! -d "/etc/letsencrypt/live/$HOST" ] && command -v certbot >/dev/null 2>&1; then
  certbot certonly --webroot -w /var/www/html -n --agree-tos \
    -m nikidav9@gmail.com -d "$HOST" >>/var/log/jt-apply.log 2>&1 \
    && say "сертификат" "выпущен на $HOST" \
    || say "сертификат" "не вышло, работаем по http"
fi

# Перезагрузка шлюза после продления. Сам certbot её не делает, а nginx
# держит сертификат в памяти: без этого через 60 дней он молча продолжит
# отдавать просроченный, и браузеры перестанут открывать сайт.
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/nginx.sh <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/nginx.sh

# ── Сертификат на сам домен ───────────────────────────────────────────────
# Выпускаем ДО того, как jobtoo.ru начнёт указывать сюда. Иначе неизбежен
# провал: пока идёт выпуск, https не отвечает, а это и приложение, и вебхук
# бота. Работает это благодаря строке в public/.htaccess — хостинг
# перенаправляет проверку Let's Encrypt на этот сервер.
#
# Сначала проверяем сами, своим файлом, что цепочка сложилась. Пустая
# попытка стоит дорого: пять неудачных проверок в час — и Let's Encrypt
# закрывает выпуск на этот домен, а таймер здесь ходит каждую минуту.
#
# Второй путь — на случай, если перенаправление на хостинге не сложится:
# имя уже указывает сюда. Тогда выпускать надо как можно быстрее, потому
# что это и есть тот самый провал.
#
# Спрашиваем не обычным способом, а прямо у ответственных за домен
# серверов. TTL записи — час: обычный преобразователь ещё целый час будет
# отдавать прежний адрес, и всё это время сервер не знал бы, что запись
# уже поменяли. Сброса своего кэша мало — кэшируют и вышестоящие.
#
# Заодно это даёт то, ради чего всё затевалось: у ответственных серверов
# новая запись появляется в ту же секунду, как её сохранили, а до людей
# доходит в течение часа. Значит сертификат успевает встать на место
# раньше, чем хоть кто-то придёт по новому адресу.
DOMAIN=jobtoo.ru
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ] && command -v certbot >/dev/null 2>&1; then
  # Раньше здесь стояла предварительная проверка: сервер спрашивал
  # ответственные за домен серверы и выпускал сертификат, только увидев там
  # свой адрес. Она берегла от пустых попыток, пока имя ещё указывало на
  # хостинг: пять неудачных проверок в час закрывают выпуск на домен.
  #
  # В день переезда я решил, что она подвела, и убрал её. Это было неверно:
  # проверка сработала сама, минутой позже, и сертификат выпустил именно тот
  # код, который я счёл виноватым. Она просто ждала, пока станут видны обе
  # записи — и корневая, и www, — то есть делала ровно то, для чего написана.
  #
  # Оставляю без неё сознательно, а не потому что она плоха: домен теперь
  # указывает сюда постоянно, Let's Encrypt проверяет владение сам, и второй
  # сторож только добавляет условий, в которых можно застрять.
  #
  # Пауза 15 минут: пять неудачных проверок в час закрывают выпуск на домен,
  # а таймер здесь ходит каждую минуту.
  LAST=$(cat /var/lib/jt-cert-last 2>/dev/null || echo 0)
  NOW=$(date +%s)
  if [ "$((NOW - ${LAST:-0}))" -gt 900 ]; then
    date +%s > /var/lib/jt-cert-last
    certbot certonly --webroot -w /var/www/html -n --agree-tos \
      -m nikidav9@gmail.com -d "$DOMAIN" -d "www.$DOMAIN" >>/var/log/jt-apply.log 2>&1 \
      && say "сертификат" "выпущен на $DOMAIN и www" \
      || say "сертификат" "на $DOMAIN не вышел, повтор через 15 мин"
  fi
fi

# ── Сертификат для дашборда ───────────────────────────────────────────────
# Пробуем, только когда запись уже указывает сюда: спрашиваем ответственные
# за домен серверы напрямую. Иначе каждая минута была бы неудачной попыткой,
# а пять неудач в час закрывают выпуск на всё имя.
#
# Пока записи нет — этот кусок молчит и ничего не делает. Появится — и
# сертификат, и блок шлюза, и сама служба поднимутся сами, без правок.
ADMIN_HOST=admin.jobtoo.ru
if [ ! -d "/etc/letsencrypt/live/$ADMIN_HOST" ] && command -v certbot >/dev/null 2>&1 \
   && command -v dig >/dev/null 2>&1 \
   && { [ -s /opt/jobtoo-dashboard-blue/server.js ] || [ -s /opt/jobtoo-dashboard-green/server.js ]; }; then
  ANS=$(dig +short +time=5 +tries=1 NS jobtoo.ru 2>/dev/null | head -1)
  AOK=0
  [ -n "$ANS" ] && AOK=$(dig +short +time=5 +tries=1 A "$ADMIN_HOST" "@$ANS" 2>/dev/null | grep -c "^$IP$" || true)
  if [ "${AOK:-0}" -ge 1 ]; then
    ALAST=$(cat /var/lib/jt-admin-cert-last 2>/dev/null || echo 0)
    if [ "$(( $(date +%s) - ${ALAST:-0} ))" -gt 900 ]; then
      date +%s > /var/lib/jt-admin-cert-last
      certbot certonly --webroot -w /var/www/html -n --agree-tos \
        -m nikidav9@gmail.com -d "$ADMIN_HOST" >>/var/log/jt-apply.log 2>&1 \
        && say "сертификат" "выпущен на $ADMIN_HOST" \
        || say "сертификат" "на $ADMIN_HOST не вышел, повтор через 15 мин"
    fi
  fi
fi

# tg.jobtoo.ru — имя только под вебхук, и намеренно без A-записи. Проверяем
# соответственно AAAA, а не A: A там не появится никогда, это и есть смысл
# записи. Ждём, пока имя укажет на наш же IPv6.
TG_HOST=tg.jobtoo.ru
if [ ! -d "/etc/letsencrypt/live/$TG_HOST" ] && command -v certbot >/dev/null 2>&1 \
   && command -v dig >/dev/null 2>&1 && [ -n "${IP6:-}" ]; then
  TNS=$(dig +short +time=5 +tries=1 NS jobtoo.ru 2>/dev/null | head -1)
  TOK=0
  [ -n "$TNS" ] && TOK=$(dig +short +time=5 +tries=1 AAAA "$TG_HOST" "@$TNS" 2>/dev/null | grep -c "^${IP6}$" || true)
  if [ "${TOK:-0}" -ge 1 ]; then
    TLAST=$(cat /var/lib/jt-tg-cert-last 2>/dev/null || echo 0)
    if [ "$(( $(date +%s) - ${TLAST:-0} ))" -gt 900 ]; then
      date +%s > /var/lib/jt-tg-cert-last
      certbot certonly --webroot -w /var/www/html -n --agree-tos \
        -m nikidav9@gmail.com -d "$TG_HOST" >>/var/log/jt-apply.log 2>&1 \
        && say "сертификат" "выпущен на $TG_HOST" \
        || say "сертификат" "на $TG_HOST не вышел, повтор через 15 мин"
    fi
  fi
fi

# Собираем во временный файл и сравниваем с действующим: перезапускать
# nginx каждую минуту незачем. Он это переживает, но не бесследно — часть
# запросов в момент перезагрузки обрывается, и снаружи это выглядит как
# «картинка иногда не грузится». Проверка с восьми точек мира показала
# таймаут на половине из них.
NEW=/tmp/jt-nginx-new.conf
cp "$REPO/infra/nginx.conf" "$NEW"
if [ -d "/etc/letsencrypt/live/$HOST" ] && [ -f "$REPO/infra/nginx-tls.conf" ]; then
  sed "s/__HOST__/$HOST/g" "$REPO/infra/nginx-tls.conf" >> "$NEW"
fi
# Блок самого домена — только когда сертификат на него уже есть. Иначе
# nginx не поднимется вовсе, и вместе с сайтом ляжет всё остальное.
if [ -d "/etc/letsencrypt/live/$DOMAIN" ] && [ -f "$REPO/infra/nginx-site.conf" ]; then
  cat "$REPO/infra/nginx-site.conf" >> "$NEW"
fi
# Дашборд — так же: только вместе со своим сертификатом.
if [ -d "/etc/letsencrypt/live/$ADMIN_HOST" ] && [ -f "$REPO/infra/nginx-admin.conf" ]; then
  DASH_SLOT=$(cat /var/lib/jt-dash-slot 2>/dev/null || echo blue)
  [ "$DASH_SLOT" = green ] && DASH_PORT=3003 || DASH_PORT=3002
  sed "s/__DASHBOARD_PORT__/$DASH_PORT/g" "$REPO/infra/nginx-admin.conf" >> "$NEW"
fi
# Вебхук Телеграма — так же.
if [ -d "/etc/letsencrypt/live/$TG_HOST" ] && [ -f "$REPO/infra/nginx-tg.conf" ]; then
  cat "$REPO/infra/nginx-tg.conf" >> "$NEW"
fi

NGINX_READY=0
if cmp -s "$NEW" /etc/nginx/sites-available/jobtoo; then
  # Ничего не изменилось — не трогаем работающий шлюз.
  rm -f "$NEW"
  NGINX_READY=1
else
cp "$NEW" /etc/nginx/sites-available/jobtoo
ln -sf /etc/nginx/sites-available/jobtoo /etc/nginx/sites-enabled/jobtoo
rm -f /etc/nginx/sites-enabled/default

if nginx -t >/tmp/jt-nginx.log 2>&1; then
  systemctl reload nginx
  NGINX_READY=1
  say "шлюз" "пересобран${HOST:+, tls на $HOST}"
else
  say "шлюз" "не прошёл проверку: $(grep -a -m1 -iE 'emerg|error' /tmp/jt-nginx.log | cut -c1-200)"
  # Отступаем по одной ступени, а не сразу до голого http.
  #
  # Блок сайта появляется ровно в момент переезда домена — и если бы в нём
  # оказалась ошибка, прежний откат снёс бы вместе с ним и шифрование для
  # приложения. То есть мелкая опечатка в новом куске гасила бы всё разом,
  # именно тогда, когда всё и переключается.
  ALT=/tmp/jt-nginx-alt.conf
  cp "$REPO/infra/nginx.conf" "$ALT"
  if [ -d "/etc/letsencrypt/live/$HOST" ] && [ -f "$REPO/infra/nginx-tls.conf" ]; then
    sed "s/__HOST__/$HOST/g" "$REPO/infra/nginx-tls.conf" >> "$ALT"
  fi
  cp "$ALT" /etc/nginx/sites-available/jobtoo
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    say "шлюз" "поднят без блоков домена — виноват nginx-site.conf или nginx-admin.conf"
  else
    # Лучше без шифрования, чем без шлюза вовсе.
    cp "$REPO/infra/nginx.conf" /etc/nginx/sites-available/jobtoo
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
    say "шлюз" "поднят без шифрования — виноват nginx-tls.conf"
  fi
  rm -f "$ALT"
fi
fi

# Гасим прежний слот только после того, как nginx успешно принял конфигурацию
# с новым портом. При ошибке проверки оба слота остаются живы и откат сводится
# к возврату файла jt-dash-slot.
if [ "$NGINX_READY" = 1 ] && [ -s /var/lib/jt-dash-switch-pending ] \
   && grep -q "127.0.0.1:${DASH_PORT:-3002}" /etc/nginx/sites-available/jobtoo 2>/dev/null; then
  OLD_SLOT=$(cat /var/lib/jt-dash-switch-pending)
  docker compose --env-file "$SECRETS" --profile dashboard stop "dashboard-$OLD_SLOT" >/dev/null 2>&1 || true
  rm -f /var/lib/jt-dash-switch-pending
fi

set +e
# ── Роли ──────────────────────────────────────────────────────────────────
# Не через docker-entrypoint-initdb.d: те скрипты выполняются только при
# создании пустого каталога данных, а образ Supabase приходит с уже готовым.
# Наш файл там молча не отрабатывал, пароли служебным ролям не задавались,
# и rest, realtime и storage бесконечно перезапускались, не сумев войти.
#
# Здесь же — после запуска, и при каждом заходе: alter role идемпотентен.
for i in $(seq 1 40); do
  docker compose exec -T db pg_isready -U supabase_admin -h localhost >/dev/null 2>&1 && break
  sleep 5
done

# Проверку «а можно ли войти» убрал: она глотала причину отказа, и блок
# молча пропускался. Пусть команда выполняется всегда и всегда докладывает —
# ошибка полезнее тишины.
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres >/tmp/jt-roles.log 2>&1 <<SQL

    -- Роли создаём, а не только настраиваем: образ supabase/postgres их не
    -- приносит, вопреки моему первоначальному допущению. psql отвечал
    -- «role authenticator does not exist», а службы бесконечно
    -- перезапускались, не сумев войти.
    --
    -- Имена и права повторяют облачные: разведи их по-своему — и миграции
    -- из supabase/migrations начнут падать на GRANT-ах.
    do \$\$ begin
      -- anon: тот, кем PostgREST представляется без токена. Прав почти нет,
      -- всё закрыто через RLS (см. 013_lock_down_rls.sql).
      if not exists (select from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
      end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
      end if;
      -- service_role ходит мимо RLS: под ним работает php-proxy.
      if not exists (select from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
      end if;
      -- authenticator — тот, кто подключается и переключается в нужную роль
      -- по токену. Единственный из троих, кто умеет входить.
      if not exists (select from pg_roles where rolname = 'authenticator') then
        create role authenticator login noinherit;
      end if;
      if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then
        create role supabase_storage_admin login createrole;
      end if;
      -- postgres: в этом образе суперпользователь зовётся supabase_admin, а
      -- роли postgres нет вовсе. При этом миграции Storage раздают ей права
      -- и падают с «role postgres does not exist» — служба не стартует, и
      -- снаружи это выглядит как 502 на всех запросах к файлам.
      if not exists (select from pg_roles where rolname = 'postgres') then
        create role postgres superuser login createrole createdb replication bypassrls;
      end if;

      -- Realtime и Studio ходили в базу суперпользователем. Обе службы
      -- смотрят наружу — Realtime держит вебсокеты, Studio отдаёт страницу
      -- в браузер, — и взлом любой из них означал полный доступ к базе:
      -- телефоны, переписка, возможность всё стереть.
      --
      -- Разводим по своим ролям. Storage так уже развели раньше; уроки того
      -- раза (членство в anon/authenticated/service_role, владение своей
      -- схемой) учтены ниже.
      if not exists (select from pg_roles where rolname = 'supabase_realtime_admin') then
        create role supabase_realtime_admin login noinherit;
      end if;
      -- NOINHERIT — не мелочь, а половина смысла всей правки. Realtime состоит
      -- в service_role, чтобы уметь в неё переключаться при проверке политик.
      -- С наследованием он заодно молча получал и её права: «всё на все
      -- таблицы». Проверка это и показала — update чужой таблицы проходил.
      -- Без наследования переключиться он по-прежнему может, а даром права не
      -- получает. Ровно поэтому authenticator рядом заведён так же.
      alter role supabase_realtime_admin with noinherit;
      -- REPLICATION обязателен: Realtime читает журнал упреждающей записи
      -- через слот логической репликации. Без этого признака он поднимется
      -- и будет отвечать, но изменения перестанут доходить — то есть чаты
      -- замрут, а контейнер останется здоровым. Самая тихая из поломок.
      alter role supabase_realtime_admin with replication;

      -- Studio: читает всё, не меняет ничего.
      if not exists (select from pg_roles where rolname = 'supabase_meta_reader') then
        create role supabase_meta_reader login noinherit;
      end if;
      -- bypassrls при праве только на чтение — это «видит, но не трогает».
      -- Без него таблицы jm_* выглядели бы пустыми: с 013_lock_down_rls.sql
      -- всё закрыто политиками, и обычная роль не увидела бы ни строки.
      -- Пустая таблица вместо запрета читается как поломка.
      alter role supabase_meta_reader with bypassrls noinherit nocreatedb nocreaterole nosuperuser noreplication;
    end \$\$;

    -- Схема realtime (без подчёркивания): её ждут миграции Realtime, а
    -- рабочее хозяйство он держит в _realtime. Имена разные, нужны обе.
    create schema if not exists realtime;
    alter schema realtime owner to supabase_realtime_admin;

    alter role authenticator          with login password '${POSTGRES_PASSWORD}';
    alter role supabase_storage_admin with login password '${POSTGRES_PASSWORD}';
    alter role supabase_realtime_admin with login password '${POSTGRES_PASSWORD}';
    alter role supabase_meta_reader    with login password '${POSTGRES_PASSWORD}';

    grant anon, authenticated, service_role to authenticator;

    -- То же самое нужно и Storage. На каждый запрос он переключается в роль
    -- обратившегося — set_config('role', …), — а переключиться можно только
    -- в ту роль, в которой состоишь. Под суперпользователем это проходило
    -- само собой; стоило сузить права, как все картинки стали отдаваться
    -- ошибкой 403, причём в теле ответа лежал сам запрос, а не объяснение.
    grant anon, authenticated, service_role to supabase_storage_admin;

    create schema if not exists _realtime;
    alter schema _realtime owner to supabase_realtime_admin;
    create schema if not exists storage;
    alter schema storage owner to supabase_storage_admin;

    -- Storage работает под владельцем своей схемы. Чтобы это было
    -- достаточно, он должен видеть и то, что заводил прежде под
    -- суперпользователем: таблицы, созданные до смены роли, остались за
    -- прежним владельцем, и без этой строки служба поднялась бы, но не
    -- смогла прочитать собственный список файлов.
    do \$\$
    declare r record;
    begin
      for r in select tablename from pg_tables where schemaname = 'storage' loop
        execute format('alter table storage.%I owner to supabase_storage_admin', r.tablename);
      end loop;
      -- Ровно та же беда ждала бы Realtime: таблицы _realtime.tenants,
      -- extensions и его собственный журнал миграций заводились раньше под
      -- суперпользователем. Сменить владельца схемы мало — новый владелец
      -- не сможет ни дописать миграцию, ни поправить арендатора.
      for r in select schemaname, tablename from pg_tables
               where schemaname in ('_realtime', 'realtime') loop
        execute format('alter table %I.%I owner to supabase_realtime_admin',
                       r.schemaname, r.tablename);
      end loop;
      for r in select schemaname, sequencename from pg_sequences
               where schemaname in ('_realtime', 'realtime') loop
        execute format('alter sequence %I.%I owner to supabase_realtime_admin',
                       r.schemaname, r.sequencename);
      end loop;
    end \$\$;

    -- Публикация, на которую смотрит слежение за изменениями в таблицах.
    -- Само приложение ею не пользуется: и оно, и дашборд подписаны на
    -- broadcast — обычные сообщения по вебсокету, мимо журнала базы. Но
    -- арендатор Realtime настроен на неё, и без публикации он сыпал бы
    -- ошибками в журнал при каждом заходе. Поэтому просто заводим, если её
    -- нет, и оставляем за суперпользователем: владеть ею Realtime незачем —
    -- добавление таблицы всё равно требует владения самой таблицей.
    do \$\$ begin
      if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
      end if;
    end \$\$;

    -- ── Права Realtime ───────────────────────────────────────────────────
    -- Он должен уметь переключаться в роль подписчика: изменения из журнала
    -- проходят через политики RLS того, кто подписался, а переключиться
    -- можно только в роль, в которой состоишь. Тот же урок, что с картинками
    -- выше, — и цена ошибки та же: служба жива, а данные не идут.
    grant anon, authenticated, service_role to supabase_realtime_admin;
    grant usage on schema public to supabase_realtime_admin;
    grant select on all tables in schema public to supabase_realtime_admin;
    alter default privileges in schema public
      grant select on tables to supabase_realtime_admin;

    -- ── Права Studio ─────────────────────────────────────────────────────
    -- Только select и только usage: ни create, ни insert, ни update. Права
    -- перевыдаются на каждом заходе, поэтому таблицы, появившиеся между
    -- заходами, тоже становятся видны — не дожидаясь default privileges.
    grant usage on schema public, storage, realtime, _realtime to supabase_meta_reader;
    grant select on all tables in schema public    to supabase_meta_reader;
    grant select on all tables in schema storage   to supabase_meta_reader;
    grant select on all tables in schema realtime  to supabase_meta_reader;
    grant select on all tables in schema _realtime to supabase_meta_reader;
    alter default privileges in schema public  grant select on tables to supabase_meta_reader;
    alter default privileges in schema storage grant select on tables to supabase_meta_reader;
    -- Раздел «Reports» в Studio читает статистику сервера. Роль pg_monitor
    -- даёт только чтение счётчиков и ничего больше.
    grant pg_monitor to supabase_meta_reader;

    grant usage on schema public  to anon, authenticated, service_role;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on all tables    in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    alter default privileges in schema public grant all on tables    to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
SQL
rc=$?
# set -e намеренно НЕ возвращаем: дальше идут проверки, которые законно
# отвечают ненулевым кодом (служба ещё поднимается, файла ещё нет), и
# каждая такая мелочь убивала весь заход молча — миграции переставали
# доезжать, а в журнале не оставалось ни строчки.
if [ $rc -eq 0 ]; then
  say "роли" "заданы"
  # Перезапуск служб здесь был ошибкой: он выполнялся каждую минуту, а не
  # однажды. Службы мигали, приложение отвечало через раз, и следующая же
  # проверка Storage приходилась на момент, когда тот ещё не поднялся.
  # Толкаем только один раз, при первой настройке ролей.
  if [ ! -f /opt/jobtoo-secrets/.roles-done ]; then
    docker compose restart rest realtime storage >/dev/null 2>&1 || true
    touch /opt/jobtoo-secrets/.roles-done
  fi
  # Отдельная разовая отметка под смену роли Storage: новые права роли
  # действуют с новых соединений, а служба держит пул уже открытых. Без
  # этого толчка картинки продолжали бы отдаваться ошибкой, хотя права
  # уже выданы, — и выглядело бы это как «не помогло».
  if [ ! -f /opt/jobtoo-secrets/.storage-role-2 ]; then
    docker compose restart storage >/dev/null 2>&1 || true
    touch /opt/jobtoo-secrets/.storage-role-2
    say "storage" "перезапущен после выдачи ролей"
  fi
else
  say "роли" "ОШИБКА($rc): $(tail -4 /tmp/jt-roles.log | tr '\n' ' ' | cut -c1-300)"
fi

# ── Перевод Realtime и Studio на свои роли ────────────────────────────────
# Обе службы ходили в базу суперпользователем. Роли для них заведены выше;
# здесь происходит сама пересадка — и она обставлена так, чтобы неудача
# стоила одного захода, а не простоя до утра.
#
# Порядок: подставить роль → пересоздать службу → убедиться, что она вошла в
# базу именно под ней → при неудаче вернуть суперпользователя и доложить.
# Номер попытки. Если пересадка не удалась, отметка о неудаче остаётся, и
# больше мы не пробуем — иначе служба пересоздавалась бы каждую минуту, то
# есть неудачная правка превратилась бы в бесконечный перезапуск. Чтобы
# попробовать снова после исправления, достаточно увеличить это число.
ROLE_REV=1

switch_role() {                 # служба переменная роль
  local svc="$1" var="$2" role="$3" was mark="/opt/jobtoo-secrets/.role-$1-v$ROLE_REV-failed"
  was=$(grep -E "^$var=" "$SECRETS" 2>/dev/null | tail -1 | cut -d= -f2-)
  [ "$was" = "$role" ] && return 0        # уже переведена, ничего не делаем
  [ -f "$mark" ] && return 1              # уже пробовали и не вышло

  sed -i "/^$var=/d" "$SECRETS"
  echo "$var=$role" >> "$SECRETS"
  docker compose --env-file "$SECRETS" up -d --force-recreate "$svc" >/dev/null 2>&1

  # Ждём не «контейнер запустился», а «служба вошла в базу именно этой ролью».
  # Первое ничего не доказывает: Realtime без права на репликацию поднимается
  # совершенно здоровым и просто перестаёт доставлять изменения. Живое
  # соединение под новым именем в pg_stat_activity изобразить нельзя.
  local i ok=""
  for i in $(seq 1 12); do
    sleep 5
    [ "$(docker compose ps "$svc" --format '{{.State}}' 2>/dev/null)" = "running" ] || continue
    if [ -n "$(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
                 psql -tAq -U supabase_admin -d postgres \
                 -c "select 1 from pg_stat_activity where usename = '$role' limit 1" \
                 2>/dev/null | tr -d '[:space:]')" ]; then
      ok=1; break
    fi
  done

  if [ -n "$ok" ]; then
    rm -f /opt/jobtoo-secrets/.role-"$svc"-v*-failed
    say "$svc" "работает под ролью $role, суперпользователь больше не нужен"
    return 0
  fi

  # Не получилось — возвращаем как было и приносим причину. Молчаливый откат
  # хуже поломки: правка выглядела бы применённой, а дыра осталась бы.
  sed -i "/^$var=/d" "$SECRETS"
  docker compose --env-file "$SECRETS" up -d --force-recreate "$svc" >/dev/null 2>&1
  touch "$mark"
  say "$svc" "роль $role не подошла, вернул суперпользователя: $(
    docker compose logs --tail=6 --no-log-prefix "$svc" 2>&1 | tr -d '\r' | tr '\n' ' ' | cut -c1-220)"
  return 1
}

if [ $rc -eq 0 ]; then
  switch_role realtime REALTIME_DB_USER supabase_realtime_admin
  switch_role meta     META_DB_USER     supabase_meta_reader
fi

# ── Старый ключ приложения ────────────────────────────────────────────────
# Прокси принимает и предыдущий секрет: у части людей приложение установлено
# со старым, зашитым в сборку. Ключ отключается очисткой значения, без
# выкладки — array_filter в db.php сам выбрасывает пустое.
#
# Вопрос только в том, когда. Раз в сутки показываем, сколько запросов ещё
# приходит со старым ключом: ноль несколько дней подряд и есть тот ответ,
# после которого его можно убирать не наугад.
if [ ! -f /var/lib/jt-prev-reported ] || \
   [ "$(cat /var/lib/jt-prev-reported 2>/dev/null)" != "$(date +%F)" ]; then
  PREV_USED=$( (cd "$REPO/infra" && docker compose exec -T php \
    cat /var/www/api/prev_secret_used) 2>/dev/null | tr -d '\r\n' || true)
  if [ -n "$PREV_USED" ]; then
    say "старый ключ" "запросов со старым секретом: $PREV_USED"
  fi
  date +%F > /var/lib/jt-prev-reported
fi

# ── Перевозка медиа переписки в закрытый бакет ────────────────────────────
# Фото и голосовые из чатов лежали в публичном бакете `avatars`: ссылка на
# них открывалась кем угодно, без авторизации и навсегда. Новые файлы уходят
# в закрытый `chat-media` (миграция 034), а уже загруженные надо перевезти.
#
# Пачками по сотне, до пустого ответа. Порядок — копия, потом удаление
# оригинала: оборвётся посередине, и часть файлов окажется в обоих бакетах,
# что безобидно. Приложение просит подписанную ссылку на закрытый бакет, а
# не найдя файла — показывает по прежней публичной. Ни одно сообщение не
# ломается ни в какой момент перевозки, и следующий заход просто продолжит.
# Секрет читаем здесь же, а не полагаемся на переменную окружения: в шелле
# её нет — в файле переменных лежит EXPO_PUBLIC_APP_SECRET, а сам секрет
# живёт в app_secrets.php, написанном через base64 и текстом не разбираемом.
# Сослаться на несуществующую переменную значило бы тихо ничего не сделать.
MEDIA_SECRET=$( (cd "$REPO/infra" && docker compose exec -T php php -r '
  $s = @include "/var/www/api/app_secrets.php";
  echo is_array($s) ? ($s["APP_SECRET"] ?? "") : "";') 2>/dev/null | tr -d '\r\n' || true)

if [ ! -f /opt/jobtoo-secrets/.chat-media-moved ] && [ -n "${MEDIA_SECRET:-}" ]; then
  total=0
  for _ in $(seq 1 40); do
    out=$(curl -s -m 120 -X POST https://jobtoo.ru/api/db.php \
            -H 'Content-Type: application/json' -H "X-App-Secret: $MEDIA_SECRET" \
            -d '{"fn":"dbMigrateChatMedia","args":[]}' 2>/dev/null)
    n=$(printf '%s' "$out" | grep -o '"перевезено":[0-9]*' | head -1 | cut -d: -f2)
    [ -z "$n" ] && break
    total=$((total + n))
    printf '%s' "$out" | grep -q '"ещё_есть":true' || { touch /opt/jobtoo-secrets/.chat-media-moved; break; }
  done
  [ "$total" -gt 0 ] && say "медиа" "перевезено в закрытый бакет: $total" || true
fi

# ── Первый счёт рейтингов ─────────────────────────────────────────────────
# Рейтинг работника (JobToo Score) сервер пересчитывает сам после каждой
# смены и каждой оценки. Но у четырёхсот с лишним человек смены и оценки уже
# накоплены, и без одного захода по всем они увидели бы «рейтинг ещё не
# считается» до своей следующей смены — то есть месяцами.
#
# Формула живёт в php-proxy/db.php и только там. Повторить её здесь на SQL
# было бы вторым местом, где она записана, и первым же местом, где она
# разойдётся с настоящей.
if [ ! -f /opt/jobtoo-secrets/.score-backfilled ] && [ -n "${MEDIA_SECRET:-}" ]; then
  out=$(curl -s -m 300 -X POST https://jobtoo.ru/api/db.php \
          -H 'Content-Type: application/json' -H "X-App-Secret: $MEDIA_SECRET" \
          -d '{"fn":"scoreRecalcAll","args":[]}' 2>/dev/null)
  n=$(printf '%s' "$out" | grep -o '"пересчитано":[0-9]*' | head -1 | cut -d: -f2)
  if [ -n "$n" ]; then
    touch /opt/jobtoo-secrets/.score-backfilled
    say "рейтинг" "посчитан работникам: $n"
  fi
fi

# ── Арендатор Realtime ────────────────────────────────────────────────────
# Realtime в самостоятельной установке адресует подключения «арендатору» и
# заводит его сам при первом запуске (SEED_SELF_HOST). У нас список оказался
# пуст: засев не прошёл, потому что я сбрасывал схему _realtime, когда менял
# ключ шифрования.
#
# Без арендатора служба отвечает 403 на всякое подключение — то есть чаты и
# уведомления перестают обновляться живьём, при том что контейнер здоров.
if [ -z "$(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -tAq -U supabase_admin -d postgres \
      -c 'select 1 from _realtime.tenants limit 1' 2>/dev/null | tr -d '[:space:]')" ]; then
  docker compose restart realtime >/dev/null 2>&1
  sleep 20
  n=$(docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
        psql -tAq -U supabase_admin -d postgres \
        -c 'select count(*) from _realtime.tenants' 2>/dev/null | tr -d '[:space:]')
  say "realtime" "арендаторов после перезапуска: ${n:-не прочитать}"
fi

# ── Схема Storage ─────────────────────────────────────────────────────────
# Storage ведёт в базе собственный набор миграций и сам же проверяет, что
# схема им соответствует. Моя ранняя попытка создать её вручную, а потом
# несколько сбросов подряд оставили её на полпути: служба отвечает
# DatabaseSchemaMismatch и отказывается работать.
#
# Сбрасываем один раз и отдаём целиком службе. Файлы при этом не теряются —
# они лежат в томе на диске, а не в базе.
if [ ! -f /opt/jobtoo-secrets/.storage-clean ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/bucket \
         -H "Authorization: Bearer $SERVICE_ROLE_KEY" 2>/dev/null)
  if [ "$code" != "200" ]; then
    docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
      psql -q -U supabase_admin -d postgres \
      -c "drop schema if exists storage cascade;" >/dev/null 2>&1
    docker compose restart storage >/dev/null 2>&1
    sleep 25
    code2=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/bucket \
            -H "Authorization: Bearer $SERVICE_ROLE_KEY" 2>/dev/null)
    if [ "$code2" = "200" ]; then
      touch /opt/jobtoo-secrets/.storage-clean
      say "storage" "схема пересоздана службой, отвечает"
    else
      say "storage" "после сброса отвечает $code2"
    fi
  else
    touch /opt/jobtoo-secrets/.storage-clean
  fi
fi

# ── Миграции ──────────────────────────────────────────────────────────────
# После контейнеров: накатыватель сам подождёт базу и Storage, а если те
# ещё не готовы — тихо отложит до следующего запуска таймера.
chmod +x "$REPO/infra/migrate.sh" 2>/dev/null || true
bash "$REPO/infra/migrate.sh" || say "миграции" "не прошли, см. следующий заход"

# Ключ шифрования Realtime: если он неверной длины, служба поднимается, но
# подписки не работают — то есть чаты перестают обновляться живьём, а внешне
# всё в порядке. Худший вид поломки, поэтому чиним отдельно.
if [ "${#REALTIME_ENC_KEY}" -ne 16 ]; then
  NEWKEY=$(openssl rand -hex 8)
  sed -i "s/^REALTIME_ENC_KEY=.*/REALTIME_ENC_KEY=$NEWKEY/" "$SECRETS"
  # Старые записи зашифрованы прежним ключом и уже не расшифруются;
  # своё хозяйство Realtime заведёт заново при следующем запуске.
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -q -U supabase_admin -d postgres \
    -c "drop schema if exists _realtime cascade; create schema _realtime;
        alter schema _realtime owner to supabase_admin;" >/dev/null 2>&1
  set -a; . "$SECRETS"; set +a
  docker compose up -d --force-recreate realtime >/dev/null 2>&1
  say "realtime" "ключ шифрования заменён на верную длину"
fi

# ── Резервные копии ───────────────────────────────────────────────────────
# Ставим таймер один раз. Копия делается раньше переключения намеренно:
# после него данные 420 человек будут жить в единственном экземпляре.
install -m 755 "$REPO/infra/backup.sh" /usr/local/bin/jt-backup 2>/dev/null || true
if [ ! -f /etc/systemd/system/jt-backup.timer ]; then
  cat > /etc/systemd/system/jt-backup.service <<'EOF'
[Unit]
Description=Резервная копия базы и файлов
[Service]
Type=oneshot
ExecStart=/usr/local/bin/jt-backup
TimeoutStartSec=3600
EOF
  cat > /etc/systemd/system/jt-backup.timer <<'EOF'
[Unit]
Description=Резервная копия базы и файлов
[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now jt-backup.timer
  # Первую копию делаем сразу, не дожидаясь ночи: без неё данные существуют
  # в одном экземпляре прямо сейчас.
  /usr/local/bin/jt-backup || true
fi

# ── Перенос данных из облака ──────────────────────────────────────────────
# Только если мы вообще знаем, откуда переносить: ключ доступа к облаку
# приезжает отдельно и в репозитории его нет.
if [ -f /opt/jobtoo-secrets/cloud ]; then
  chmod +x "$REPO/infra/import.sh" 2>/dev/null || true
  bash "$REPO/infra/import.sh" || say "перенос" "не удался, см. следующий заход"
  chmod +x "$REPO/infra/import-files.sh" 2>/dev/null || true
  bash "$REPO/infra/import-files.sh" || say "файлы" "не удались, см. следующий заход"
fi

state=$(docker compose ps --format '{{.Service}}={{.State}}' 2>/dev/null | tr '\n' ' ')
say "развёрнуто" "$state"

# Если служба не поднялась — присылаем её журнал. Без этого «restarting»
# означает только «что-то не так», а причина остаётся на машине, куда мне
# не попасть.
for svc in db rest realtime storage; do
  st=$(docker compose ps "$svc" --format '{{.State}}' 2>/dev/null)
  case "$st" in
    running) ;;
    *) say "журнал:$svc" "$(docker compose logs --tail=12 --no-log-prefix "$svc" 2>&1 | tr -d '\r' | cut -c1-200 | tail -12)" ;;
  esac
done

# Обновляем страницу состояния — по ней я вижу происходящее снаружи.
[ -x /usr/local/bin/jt-report ] && /usr/local/bin/jt-report || true
