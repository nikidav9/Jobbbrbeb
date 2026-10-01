#!/usr/bin/env python3
"""Ключ YandexGPT: секреты репозитория → deploy.php → /etc/jobtoo/yandex-gpt.env.

Статическая проверка цепочки, как соседние infra-тесты: ключ доезжает до
воркеров Юпитера сам, файл закрыт (600, root), пустые секреты ничего не стирают.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
wf = (ROOT / ".github/workflows/deploy-regru.yml").read_text(encoding="utf-8")
dep = (ROOT / "php-proxy/deploy.php").read_text(encoding="utf-8")
boot = (ROOT / "infra/bootstrap.sh").read_text(encoding="utf-8")

fails = []


def check(name: str, ok: bool) -> None:
    if not ok:
        fails.append(name)


check("workflow берёт оба секрета",
      "YANDEX_GPT_API_KEY: ${{ secrets.YANDEX_GPT_API_KEY }}" in wf
      and "YANDEX_GPT_FOLDER_ID: ${{ secrets.YANDEX_GPT_FOLDER_ID }}" in wf)
check("workflow кладёт их в тело запроса", '"yandex_gpt": {' in wf and '"api_key": e("YANDEX_GPT_API_KEY", "")' in wf)
check("deploy.php пишет файл только при обоих значениях",
      "!empty($yg['api_key']) && !empty($yg['folder_id'])" in dep and "'/yandex_gpt.php'" in dep)
check("deploy.php пишет через literal (base64), не сырой строкой", "literal((string) $yg['api_key'])" in dep)
check("bootstrap читает yandex_gpt.php", '@include "/var/www/api/yandex_gpt.php"' in boot)
check("bootstrap пишет env закрытым", "umask 077" in boot and "chown root:root /etc/jobtoo/yandex-gpt.env.new" in boot)
check("bootstrap меняет файл атомарно", "mv -f /etc/jobtoo/yandex-gpt.env.new /etc/jobtoo/yandex-gpt.env" in boot)
check("bootstrap перезапускает оба воркера",
      "for svc in jt-jupiter.service jt-jupiter-browser.service" in boot)
check("из ключа и каталога вычищается всё, кроме печатаемого ASCII",
      'preg_replace("/[^!-~]/", "", strtr((string)$v, $lat))' in boot and '$c($s["api_key"] ?? "")' in boot)
check("русская «А» в ключе становится латинской, а не пропадает", '"А"=>"A"' in boot)
check("пустые секреты ничего не стирают", 'if [ -n "$YGPT_KEY" ] && [ -n "$YGPT_FOLDER" ]; then' in boot)
check("воркеры читают тот же файл", "EnvironmentFile=-$YGPT_ENV" in boot)

check("раз в час сервер сам проверяет модель", "YGPT_PING=/var/lib/jobtoo/ygpt-ping.txt" in boot
      and "-mmin +$YGPT_AGE" in boot and "YGPT_AGE=60" in boot
      and "foundationModels/v1/completion" in boot)
check("неудачная проверка повторяется через 10 минут", "YGPT_AGE=10" in boot)
check("при ошибке — причина словами Яндекса, ключ вырезан, файл ответа удалён",
      'm = m.replace(k, "***")' in boot and 'rm -f "$body"' in boot
      and '[^\\w .,:;()/+=-]' in boot)
check("в статусе — проверка и реальные вызовы за сутки",
      '"yandex_gpt_проверка"' in boot and '"yandex_gpt_вызовов_за_сутки"' in boot
      and "grep -c 'YandexGPT: вызов, статус'" in boot)

if fails:
    raise SystemExit("yandex gpt delivery: ПРОВАЛЫ\n  - " + "\n  - ".join(fails))
print("yandex gpt delivery: OK")
