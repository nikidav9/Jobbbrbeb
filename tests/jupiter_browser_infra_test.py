import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
run = (ROOT / "infra" / "jupiter-browser-run.sh").read_text(encoding="utf-8")
bootstrap = (ROOT / "infra" / "bootstrap.sh").read_text(encoding="utf-8")

start = bootstrap.index("# ── Jupiter: браузерный воркер")
end = bootstrap.index("# Dedicated catch-all mailbox.", start)
section = bootstrap[start:end]

# Версия образа закреплена: точный тег, без latest и без плавающих.
assert 'PW=${PW:-1.63.0}' in run
assert 'IMAGE="mcr.microsoft.com/playwright/python:v${PW}-jammy"' in run
assert "latest" not in run.lower()
assert re.search(r"^PW=\$\{PW:-\d+\.\d+\.\d+\}$", run, re.M)
# Сторож памяти гасит и этот образ.
assert "mcr.microsoft.com/playwright/python:v1.63.0-jammy" in bootstrap

# Служба выключена по умолчанию: без флага не стартует ни юнит, ни скрипт.
assert "ConditionPathExists=/etc/jobtoo/jupiter-browser.enabled" in section
assert 'FLAG=${FLAG:-/etc/jobtoo/jupiter-browser.enabled}' in run
assert '[ -f "$FLAG" ] ||' in run
assert "systemctl enable" not in section
assert "systemctl start" in section and "jupiter-browser.enabled ]; then" in section

# Лимиты памяти: и у юнита, и у контейнера; перезапуск и журнал.
assert "MemoryMax=1500M" in section
assert "--memory 1500m" in run
assert "Restart=on-failure" in section
assert "StandardOutput=append:/var/log/jt-jupiter-browser.log" in section
assert "JUPITER_ENGINE=browser" in section
assert "-e JUPITER_ENGINE=browser" in run

# Секреты берутся из общего файла секретов и передаются по имени, без значений.
assert "EnvironmentFile=$SECRETS" in section
for name in ("YANDEX_GPT_API_KEY", "YANDEX_GPT_FOLDER_ID"):
    assert f"-e {name} " in run or f"-e {name}\\" in run, name
    assert not re.search(rf"{name}=\S", run + section), name
assert not re.search(r"(api[-_]?key|token|secret|password)\s*=\s*['\"]?[A-Za-z0-9_\-]{16,}", run + section, re.I)

# Инвариант проекта: сам Jupiter в основном сервисе браузер не получает.
assert "jt-jupiter.service" in bootstrap
assert "playwright" not in (ROOT / "jupiter" / "requirements.txt").read_text(encoding="utf-8").lower()

# Синтаксис.
for path in ("infra/jupiter-browser-run.sh", "infra/bootstrap.sh"):
    subprocess.run(["bash", "-n", str(ROOT / path)], check=True)

print("jupiter browser infra ok")
