#!/usr/bin/env bash
# Конфиг nginx обязан быть валидным. Проверяет сам nginx, а не поиск по тексту.
#
# Написан по аварии 14 сентября. В location ~ попали выражения с квантификатором
# {1,40} без кавычек. Фигурные скобки конфиг nginx разбирает как границы блока:
# выражение обрывается, и nginx НЕ ПОДНИМАЕТСЯ ВОВСЕ — не отдаёт 404 по этим
# адресам, а падает при старте. Сайт лежал целиком.
#
# Почему это прошло мимо прежних проверок: seo_infra_test и career_infra_test
# читают конфиг как ТЕКСТ и проверяют, что нужные строки на месте. Строки были
# на месте. Валидность текстовой проверкой не устанавливается в принципе —
# нужен разбор тем, кто этот файл исполняет.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

command -v nginx >/dev/null || { echo "nginx config: пропущено, nginx не установлен"; exit 0; }
mkdir -p "$WORK/conf"
cp /etc/nginx/fastcgi_params "$WORK/fastcgi_params"

# Сертификаты и порты — забота сервера, здесь проверяется синтаксис. Снимаем
# ssl_*, приземляем listen на непривилегированный порт.
python3 - "$ROOT/infra/nginx-site.conf" "$WORK/site.conf" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'(?m)^\s*ssl_\w+\s+[^;]*;\s*$', '', s)
# IPv6 в контейнере проверки может не быть — такие listen убираем целиком.
s = re.sub(r'(?m)^\s*listen\s+\[::\][^;]*;\s*$', '', s)
# 443 и 80 разводим по разным портам: схлопни их в один — и получишь
# «conflicting server name», то есть шум стенда вместо ответа о конфиге.
s = re.sub(r'(?m)^(\s*listen\s+)([^;]*);',
           lambda m: m.group(1) + re.sub(r'\b443\b', '8443', m.group(2))
                                   .replace('80', '8080')
                                   .replace(' ssl', '').replace('http2', '') + ';', s)
s = s.replace('http2 on;', '')
open(sys.argv[2], 'w', encoding='utf-8').write(s)
PY

# Те же две map, что заводит infra/bootstrap.sh на уровне http.
cat > "$WORK/nginx.conf" <<EOF
events { worker_connections 64; }
error_log $WORK/err.log;
pid $WORK/nginx.pid;
http {
    include /etc/nginx/mime.types;
    access_log off;
    client_body_temp_path $WORK/cb;
    fastcgi_temp_path $WORK/ft;
    proxy_temp_path $WORK/pt;
    uwsgi_temp_path $WORK/ut;
    scgi_temp_path $WORK/st;
    map \$http_authorization \$jt_auth  { default \$http_authorization; }
    map \$http_apikey        \$jt_apikey { default \$http_apikey; }
    include $WORK/site.conf;
}
EOF

if out=$(nginx -t -c "$WORK/nginx.conf" -p "$WORK" 2>&1); then
  echo "nginx config: ok"
else
  echo "nginx config: ПРОВАЛ"
  echo "$out" | sed 's/^/  /'
  exit 1
fi
