"""Связь с Telegram не отменяет доставку сайта.

Написан по настоящей поломке. 14 сентября шаг «Restore and verify Telegram
webhook» стоял ПЕРЕД публикацией сборки. Связь московского сервера с
api.telegram.org отпала, tgtool вернул пустой ответ, шаг упал — и следующий за
ним шаг публикации был пропущен. Сайт не уехал вовсе, хотя к Telegram
отношения не имел: отказ одной внешней связи отменил доставку всего
остального.

Инвариант: сайт публикуется РАНЬШЕ проверки вебхука, и проверка задачу не
валит. Но и молчать об отказе нельзя — бот несёт вход в мини-приложение и
уведомления, — поэтому следом обязан стоять шаг, срабатывающий именно при
отказе вебхука.

Второй инвариант появился 15 сентября: быстрые последовательные push запускали
несколько deploy одновременно, а все они делали --clobber одного и того же
release asset. Один прогон мог удалить asset, пока другой его загружал, и
uploads.github.com отвечал 404. Production publish поэтому обязан быть
сериализован, а сам внешний upload иметь ограниченный retry.

Третий инвариант — документация и локальная git-метаинформация не являются
релизом приложения. Такие push не должны занимать production deploy или EAS
OTA и отменять настоящую сборку, поэтому оба release workflow обязаны иметь
одинаковый минимальный paths-ignore для docs/Markdown/.gitignore.
"""

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_PATH = ROOT / ".github/workflows/deploy-regru.yml"
EAS_PATH = ROOT / ".github/workflows/eas-update.yml"
DEPLOY_TEXT = DEPLOY_PATH.read_text(encoding="utf-8")
EAS_TEXT = EAS_PATH.read_text(encoding="utf-8")
WORKFLOW = yaml.safe_load(DEPLOY_TEXT)
STEPS = WORKFLOW["jobs"]["deploy"]["steps"]

failures = []


def check(name, ok):
    if not ok:
        failures.append(name)


def find(fragment):
    """Номер шага, чьё имя содержит кусок. -1, если такого нет."""
    for i, step in enumerate(STEPS):
        if fragment in (step.get("name") or ""):
            return i
    return -1


publish = find("Publish web build")
webhook = find("Restore and verify Telegram webhook")

check("шаг публикации сайта на месте", publish >= 0)
check("шаг проверки вебхука на месте", webhook >= 0)

# Один fixed release asset не допускает двух писателей одновременно. Старый
# deploy не нужен, когда уже пришёл новый main: отмена здесь корректнее очереди
# из устаревших сборок.
concurrency = WORKFLOW.get("concurrency", {})
check("production deploy имеет отдельную concurrency group",
      concurrency.get("group") == "production-web-deploy")
check("устаревший production deploy отменяется",
      concurrency.get("cancel-in-progress") is True)

# Документационный push не меняет web/OTA bundle. Без этого фильтра правка
# roadmap или README сама занимала release runner и могла отменить реальный
# deploy, потому что production-web-deploy намеренно cancel-in-progress.
for workflow_name, text in (("web deploy", DEPLOY_TEXT), ("EAS Update", EAS_TEXT)):
    check(f"{workflow_name}: есть paths-ignore", "paths-ignore:" in text)
    check(f"{workflow_name}: docs не запускают релиз", "- 'docs/**'" in text)
    check(f"{workflow_name}: Markdown не запускает релиз", "- '**/*.md'" in text)
    check(f"{workflow_name}: .gitignore не запускает релиз", "- '.gitignore'" in text)

if publish >= 0:
    publish_body = str(STEPS[publish].get("run", ""))
    check("release asset публикуется через clobber",
          "gh release upload web dist.tar.gz --clobber" in publish_body)
    check("release upload имеет ограниченный retry",
          "for attempt in 1 2 3" in publish_body and "published=0" in publish_body)
    check("после трёх отказов publish остаётся красным",
          '[ "$published" = 1 ]' in publish_body)

if publish >= 0 and webhook >= 0:
    # Главное. Публикация раньше — тогда отказ Telegram её не отменит.
    check("сайт публикуется раньше проверки вебхука", publish < webhook)
    # И даже стоя позже, шаг не должен валить задачу: иначе следующие за ним
    # шаги снова окажутся пропущенными.
    check(
        "проверка вебхука не валит выкладку",
        STEPS[webhook].get("continue-on-error") is True,
    )
    # Отказ обязан быть слышен. Ищем шаг, который смотрит на итог вебхука, —
    # проверять «есть ли где-то слово warning» бессмысленно: оно нашлось бы в
    # любом соседнем шаге. Привязываемся к ссылке на id этого шага.
    wid = STEPS[webhook].get("id")
    check("у шага вебхука есть id, на который можно сослаться", bool(wid))
    if wid:
        cond = "steps.%s.outcome" % wid
        alarm = [
            s for s in STEPS[webhook + 1 :]
            if cond in str(s.get("if", "")) and "failure" in str(s.get("if", ""))
        ]
        check("об отказе вебхука есть кому сказать", len(alarm) == 1)
        if alarm:
            body = str(alarm[0].get("run", ""))
            check("отказ поднимает предупреждение прогона", "::warning" in body)
            check("отказ попадает в сводку", "GITHUB_STEP_SUMMARY" in body)

if failures:
    print("deploy webhook order: ПРОВАЛЫ")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("deploy webhook order: ok")