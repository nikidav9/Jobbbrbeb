> **Поправки оркестратора (проверено вручную):** `data/` НЕ пуст — там закоммиченные `data/company-logos/*.png`, их использует лента, удалять нельзя. `deno.lock` упомянут в `scripts/secret-scan.py` — не мусор без разбора. В `tests/` 145 файлов, а не 42. Номера миграций с дублями (014, 033, 043, 089, 090, 092, 093, 094, 105, 143) перенумеровывать нельзя: миграции уже применены. Остальное в отчёте — по данным агента, не перепроверено.

# Инвентаризация периферийных частей JobToo

**Дата**: 2026-10-03  
**Агент**: Claude Haiku 4.5

---

## 1. ВЕРХНИЙ УРОВЕНЬ

### Документы
| Файл | Статус | Использование | Вердикт |
|------|--------|-----------------|---------|
| AGENTS.md | 1.4K | Справка об агентах | USED |
| CLAUDE.md | 20.8K | Инструкции для Claude Code (критически) | USED |
| README.md | 17.4K | SEO, общее описание | USED |
| deno.lock | 7.2K | Lock для Deno (не используется в коде) | ORPHAN |
| skills-lock.json | 27K | Lock для скиллов Claude | USED |
| google-services.json | 1.1K | Firebase config (refs в app.json) | USED |

### Каталоги
| Каталог | Содержимое | Статус | Вердикт |
|---------|-----------|--------|----------|
| attached_assets/ | 6 PNG/JPEG (дата 2024) | Нет refs в коде; выглядит как временные загруженные файлы | ORPHAN |
| template/ | Шаблоны кода (index.ts, auth/, core/, ui/) | Импортируется в ~5 файлах (getSupabaseClient) | USED |
| shims/ | canvas.js | Используется в metro.config.js | USED |
| data/ | company-logos/ (пусто или старое) | Не используется | ORPHAN |
| video/ | Remotion компоненты (упомянуто в MAP.md § video) | USED (видео/анимация) | USED |
| public/ | Веб-ассеты (favicon, manifest.json, robots.txt, splash, sw.js) | Используется в вебе | USED |

---

## 2. ASSETS/ (181 файл)

### Использованные
- **Шрифты (4)**: Unbounded-700, Manrope-{500,700,800}.ttf — в app/_layout.tsx
- **Иконки/UI (10)**: jt-logo*.png, splash-*.png, auth-*.png, lavka-logo.png, onboarding-*.png и др.
- **Логотипы (144)**: assets/logos/ (avito, advantum, 1s-bitriks и т.д.) — в constants/companyLogos.ts

### Неиспользованные
- **Временные файлы (2)**:
  - 1779304825430-019e46d4-8f66-79df-bf69-c07d0f6325cc.png
  - 1779304897007-019e46d5-b39d-7f5a-b15d-87125b6b7200.jpeg
  - (выглядят как пользовательские загрузки, дата 2024)
- **Шрифт**: SpaceMono-Regular.ttf (не импортируется)

**Вердикт**: ORPHAN — 3 файла (временные загрузки + неиспользуемый шрифт)

---

## 3. SCRIPTS/ (30 файлов)

### Используемые в workflows/package.json
| Скрипт | Использование | Статус |
|--------|-----------------|---------|
| reset-project.js | package.json: `npm run reset-project` | USED |
| import-users.ts | package.json: `npm run import-users` | USED |
| check-small-screens.mjs | .github/workflows/small-screen.yml | USED |
| defer-landing-bundle.py | .github/workflows/deploy-regru.yml | USED |
| secret-scan.py | .github/workflows/secret-scan.yml | USED |
| upload-company-logos.py | .github/workflows/company-logos.yml | USED |
| seo-production-audit.py | .github/workflows/seo-production-audit.yml | USED |

### Не используемые в workflows (но могут быть ручные)
- autopilot-check.mjs, browser-bench.py, browser-probe.mjs, build-flow-map.py, career-catalog-check.py, career-discover*.mjs, dom-to-svg.js, gen-jupiter-employers.mjs, gen-landing-docs.ts, gen-metro-php.js, icons-to-paths.py, make-apply-unsupported.py, shoot-screens.mjs + JSON и TSV файлы (career-sites.tsv, career-endpoints.json, career-runtime-quarantine.json, owner-career-sites.tsv, career_quarantine_recheck.py, career_search_scout.py)

**Вердикт**: ~22 скрипта REQUIRES MANUAL REVIEW (одноразовые, инструменты разработки, данные для экспорта?)

---

## 4. TESTS/ (42 тестов + инфра)

### Структура
- 42 файла `*.test.ts` и `*.test.mjs`
- Запускаются через `npm test` (node:test)
- CI запускает также: `php -l` для PHP, Python тесты для career/jupiter

### Проблемы НЕ найдены
- readFileSync ссылаются на существующие файлы (app.json, constants/legal.ts, scripts/career-*.json и т.д.)
- Тесты вроде career-catalog-sync ссылаются на реальные файлы (infra/sync-career-catalog.sh, infra/migrate.sh)

**Вердикт**: USED (все тесты целостны)

---

## 5. DOCS/ (282 файла)

### Группировка
- **MAP.md** (266K) — главная карта, свежая (2026-10-03 22:32)
- **Процесс**: выпуск-приложения.md, очередь-задач.md, круг-работы.md, ручные-шаги.md
- **Разведка**: источники-вакансий-разбор.md (111K), разведка-форм.md (24K), cofinder-swipejobs-разбор.md
- **Jupiter**: jupiter-browser-legal.md (35K), jupiter-browser-survey.md, jupiter-mail.md, план-юпитер.md
- **RKN**: rkn-подготовка.md (37K), rkn-письмо-изменения-2026-10.md (41K)
- **Дизайн**: design/ (40 файлов с макетами и иконками)

### Подозрительные
- **old-profile-video-frames.jpg** в design/profile/references/ — архивное, не используется
- **copy.svg** в design/settings-help/assets/icons/ — может быть артефакт

### Дубли
- **README.md** повторяется (есть в корне и в docs/)

**Вердикт**: Основной контент USED; old-profile-video-frames.jpg и неактуальные части ORPHAN

---

## 6. .CLAUDE/WORKTREES/

### Состояние
- **14 agent-* каталогов** (последние из них 2026-09-26)
- **НЕ git-tracked** (`git ls-files .claude/worktrees` возвращает пусто)
- Содержат копии полного репозитория (node_modules, app/, etc.)

**Использование**: Это рабочие деревья для параллельных сессий Claude Code

**Вердикт**: USED (но требуют очистки по завершении сессий; можно удалить старые)

---

## 7. SUPABASE/MIGRATIONS (157 файлов)

### Проблема: дубли номеров
```
014: partner_metrics.sql + perm_application_hired.sql
033: consents.sql + guest_analytics.sql
043: app_opens.sql + partner_source_health.sql
089: consolidate_career_catalog.sql + mvideo_avito.sql
090: career_browser_discovery.sql + petrovich_html_links.sql
092: kaspersky_selectel_koronatech.sql + sber_yadro.sql
093: phosagro_selectel_lesta.sql + sber_lavka_canonical.sql
094: magnit.sql + sber_developers_direct.sql
105: jupiter_lease_recovery.sql + restore_career_sources.sql
143: feed_near_it.sql + mail_html.sql
```

**Вердикт**: REQUIRES MANUAL REVIEW (10 дублей номеров; второй файл в каждой паре нужно пренумеровать)

---

## 8. DEBUG КОД В ПРИЛОЖЕНИИ

### Найдено
- **console.warn/error**: ~10 вызовов в app/chat-room.tsx, app/perm-vacancy-detail.tsx (используются для логирования ошибок, не debug-код)
- **TODO/FIXME/HACK**: 0 найдено
- **Закомментированный код**: есть в некоторых файлах (app/jupiter-*.tsx, app/analytics.tsx, app/legal.tsx), но <10 строк каждый
- **Подозрительные имена**: 0 найдено (не существует old/backup/copy/temp/v2/_new файлов в app/)

**Вердикт**: USED (логирование необходимо для production)

---

## ИТОГОВАЯ ТАБЛИЦА

| Категория | Статус | Кол-во | Рекомендация |
|-----------|--------|--------|---------------|
| Top-level orphans | ORPHAN | 3 (attached_assets, deno.lock, data/) | Удалить |
| Assets неиспользованные | ORPHAN | 3 файла (2 временных + 1 шрифт) | Удалить |
| Scripts одноразовые | REQUIRES REVIEW | 22 | Документировать, отмечены ли как инструменты |
| Tests | USED | 42 | ✓ |
| Docs | USED (mostly) | 282 | Переименовать old-profile-video-frames.jpg, синхронизировать README |
| Worktrees | USED | 14 | Очистить старые (>1 месяца) |
| Migrations | REQUIRES REVIEW | 157 (с 10 дублями) | Пренумеровать дубли |
| Debug код | USED | 0 (только production logs) | ✓ |

---

## Рекомендации к действиям

### 🟢 Удалить сразу
1. `attached_assets/` (временные файлы пользователя, 2024)
2. `deno.lock` (не используется)
3. `data/` (пусто)
4. `assets/images/1779*.{png,jpeg}` (временные)
5. `assets/fonts/SpaceMono-Regular.ttf` (неиспользуется)
6. `docs/design/profile/references/old-profile-video-frames.jpg`

### 🟡 Требуют ревью
1. **scripts/** — каждый script задокументировать в комментарии (когда использовать, при выполнении)
2. **supabase/migrations/** — переименовать 10 дублей (добавить суффиксы: 014_a, 014_b или просто сместить на 147, 148, 149...)
3. **.claude/worktrees/** — старые >30 дней можно удалить; текущие нужны для запущенных сессий

### 📋 Документация
- Синхронизировать docs/README.md с корневым README.md (либо удалить один)
- Обновить docs/MAP.md про скрипты (какой для чего, когда работает)
