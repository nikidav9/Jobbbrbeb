# Аудит 1: граф импортов и кандидаты в мёртвый код

Дата: 2026-10-03. Режим: только чтение. Инструмент: `import_graph.py` (stdlib), сырой граф `import_graph.json`. Воспроизведение: `python3 import_graph.py /home/user/Jobbbrbeb`.

Охват: app, components, hooks, services, lib, constants, contexts, types, shims, **template** (в списке задачи не было, но `@/template` импортируют 7 файлов), scripts (js/ts/mjs), tests (ts/tsx/mjs) как отдельные потребители, корневые babel/metro/eslint config. Не входят: dashboard/ (отдельный Next.js, исключён из tsconfig), video/, jupiter/ (python). Разбор: import/export from/require/import()/require.resolve, алиас `@/`, относительные пути, index-файлы, суффиксы .ios/.android/.web/.native. Живость считается обходом от ENTRY (все файлы `app/**` + корневые конфиги). Тесты и скрипты в живость НЕ засчитываются.

## Числа

| Класс | Файлов |
|---|---|
| ENTRY | 59 |
| USED | 170 |
| TEST_ONLY | 0 |
| ORPHAN | 14 |
| DEAD_CHAIN | 3 |
| SCRIPT | 11 |
| TEST | 42 |
| CONFIG | 3 |
| всего | 302 |

Пояснения: TEST_ONLY = 0 (каждый файл, который импортируют тесты, импортирует и живой код; тесты берут чистую логику из services/lib). DEAD_CHAIN = импортируется только файлами, которые сами мертвы (достижим лишь из ORPHAN). Для ORPHAN/DEAD_CHAIN дополнительно проверены строковые ссылки (`git grep -F` по пути файла в tests, scripts, .github, php-proxy, infra, package.json, eas.json, app.json, metro.config.js).

## Главные находки

**1. Кластер MetroMap: `components/feature/MetroMap.tsx` + `constants/metroCoords.ts` + `constants/lavkaLogoData.ts`.** Никто не импортирует MetroMap; два constants тянутся только им. `git grep -w MetroMap` даёт только само определение. Тяжёлые данные (координаты метро, data-URI логотипа) лежат в JS-бандле, если их не вырезает Metro (он не тришейкает неимпортируемые модули — они просто не попадают в бандл; значит вес только в репозитории). Кандидат на удаление группой. REQUIRES MANUAL REVIEW: `YANDEX_MAPS_API_KEY` в metroCoords — проверить, не нужен ли ключ где-то ещё (`git grep YANDEX_MAPS_API_KEY`).

**2. `template/auth/**` (15 файлов, ~1500 строк: supabase- и mock-аутентификация).** Живы только формально, через баррель `template/index.ts` (`export * from './auth'`). Приложение импортирует из `@/template` ровно два имени: `getSupabaseClient` (core) и `AlertProvider` (ui). `useAuth|authService|AuthRouter|AuthProvider|MockAuth|mockAuthService` вне template/docs не встречаются (`git grep -nE ... -- . ":!template" ":!docs"` — пусто). Это самая крупная группа потенциально мёртвого кода, граф-живость её не видит. REQUIRES MANUAL REVIEW: файл `// @ts-nocheck`, платформенный шаблон; убирать вместе с `export * from './auth'`. Также `template/auth/types.ts` используется ядром? (7 живых импортёров — все внутри template).

**3. `components/index.ts` (баррель) + `components/feature/PhoneInput.tsx`.** Баррель никем не импортируется (`git grep "from '@/components'"` пусто). PhoneInput импортирует только он. Единственная ссылка на PhoneInput вне — `tests/auth_email_test.php:437` проверяет, что его НЕТ в экране регистрации. В README.md:256 упомянут в дереве. Остальные 8 реэкспортов баррелем живы через прямые импорты. Кандидат на удаление: index.ts + PhoneInput.

**4. `services/pay.ts` (ORPHAN).** Подпись оплаты за смену (сдельная/фиксированная). Смены закрыты 17.09.2026; импортов нет, ссылок по строке нет. Кандидат (смены).

**5. `components/LegalLinks.tsx`, `components/feature/AboutYouStep.tsx`, `components/feature/VacancyDetailHead.tsx`, `components/ui/DescriptionBlocks.tsx` (ORPHAN).** Ни одного импорта. Особо: `DescriptionBlocks.tsx` упомянут в `tests/description-blocks.test.ts:6` и комментарии `services/descriptionBlocks.ts:5` (тест проверяет логику парсера, не компонент); `VacancyDetailHead` описан в docs/MAP.md:599; ext-vacancy.tsx использует `parseDescriptionBlocks` напрямую и рисует блоки сам (`app/ext-vacancy.tsx:39`). Дубль по смыслу: компонент DescriptionBlocks vs локальная отрисовка в ext-vacancy. REQUIRES MANUAL REVIEW для описанных в MAP.

**6. `constants/help.ts`, `constants/roleIcons.ts` (ORPHAN).** help.ts — часы поддержки `supportIsOpen`; клиент не использует, константы продублированы в `php-proxy/db.php:1772-1773` (SUPPORT_FROM_HOUR/TO_HOUR). roleIcons.ts — только комментарий в SplashLoader.tsx:15. Кандидаты.

**7. `types/pdfjs-dist.d.ts`, `shims/canvas.js`, `app/globals.css`, `template/auth/*/index.ts` — ЛОЖНЫЕ ORPHAN.** Не мёртвые: .d.ts — ambient-объявление для `import('pdfjs-dist/legacy/build/pdf.worker.js')` в `services/resumeImport.ts:74-75` (tsconfig include `**/*.ts`); `shims/canvas.js` — `metro.config.js:10`; `app/globals.css` — файл есть в `app/` (expo-router), в коде не импортируется, `git grep globals.css -- app` пусто: ему место в проверке (web-стили Tailwind? в package.json нет tailwind — REQUIRES MANUAL REVIEW; упоминания только про dashboard/app/globals.css). `template/auth/{mock,supabase}/index.ts` — см. п.2.

**8. Единственный цикл: `constants/jobSections.ts` <-> `constants/types.ts`.** `jobSections.ts:1 import type { WorkType } from './types'` и `types.ts:1 import type { JobSection } from './jobSections'`. Оба импорта `type`-only, в рантайме цикла нет (runtime-граф: 0 циклов). Безвредный, но можно разорвать, вынеся JobSection/WorkType.

**9. Мёртвые клиентские обёртки RPC в `services/db.ts` (≈35 экспортов без единого импорта).** Например `dbCountUsers, dbDeleteUser, dbGetUserByPhone, dbUpsertVacancy(Batch) (смены, отвечает 410), dbGetLikesByVacancy, dbRemoveLike, dbDeleteMatch, dbIncrementUnread, dbAddSaved/dbRemoveSaved, dbFileComplaint, dbGetSkillResults/dbSubmitSkillTest, dbTelegramAuth/dbBindTelegram/dbUnbindTelegram/dbTgPrepareLink (Telegram выведен), dbSupportSend, dbGetCrossBorderConsent/dbRecordCrossBorderConsent/dbRevokeCrossBorderConsent`. Серверные функции с теми же именами живут в php-proxy/db.php (grep по слову попадает на PHP) — удалять клиентскую обёртку, не трогая сервер, но по CLAUDE.md правятся обе стороны. REQUIRES MANUAL REVIEW: сверить с `$publicFns/$selfArgFns` и с тестами php (часть тестов читает db.ts как текст).

**10. Неиспользуемые экспорты в живых файлах (138 штук, из них используются только тестами: 13).** Полный список — раздел «Неиспользуемые экспорты». Типично: тип/константа экспортированы «на всякий случай» и используются внутри файла (`internal_refs>0`) — достаточно убрать `export`. Реально без единой ссылки (internal_refs=0, grep пуст): `filterStyles`, `HEADER_ICON`, `scaleFactor`, `editTypography`, `profileTypography`, `cardBase`, `androidModalProps`, `ANDROID_FORCED_EDGE_TO_EDGE`, `isTelegramMiniApp`, `telegramHapticFeedback`, `workerRejected`, `workerCompleted`, `scoreVacancyForWorker`, `vacancyInfoLines`, `resetExtSaved`, `getAppliedFilters`, `getDraft`, `requestNotificationPermissions`, `extractPhoneDigits`, `getTodayDates`, `DrawnArt`.

Дополнительно:

- Маршруты expo-router без навигационных ссылок в коде: `app/admin.tsx` (в `_layout.tsx:281` объявлен, `git grep "/admin"` по app/components/contexts пуст — достижим только по URL), `app/analytics.tsx` (ссылка есть из admin.tsx:337). `app/filters/level.tsx` и `posted.tsx` достижимы только динамически: `feed.tsx:1049 pathname: \`/filters/${kind}\``. Все они ENTRY; решение — владельцу.
- Дубли по смыслу (только список, анализ делает другой агент): `ui/Chip` vs `profile/edit/Chip` vs `profile/SkillChip`; `ui/ConfirmDialog` (+ConfirmHost, services/confirm) vs `profile/edit/ConfirmDialog`; `ui/Sheet` vs `profile/edit/BottomSheet` vs `OptionSheet`; `profile/HardShadowCard` vs `profile/edit/HardShadowBox`; `constants/profileTheme` vs `constants/profileEditTheme` vs `constants/jt` vs `constants/theme`; `profile/icons` vs `profile/edit/icons` vs `response/icons`; `feature/MetroPicker` vs `feature/MetroMap` (мёртв); `services/matching` vs `services/matchCounts`; `services/feedFilters` vs `feedFilterStore`; `services/companyLogoMap` vs `constants/companyLogos`; `lib/webSplash` vs `components/SplashLoader`; `ui/jt.tsx` vs `constants/jt.ts`.
- Тестовые «пины» по пути (файл упомянут строкой в тесте/скрипте/php, не импортом) — полный список в JSON `pinned_by_path` (70 файлов); важно для удаления: любой тест, читающий исходник по пути, упадёт при его удалении.
- Неразрешённые импорты (кроме картинок/шрифтов `@/assets/*`): нет. Все `@/assets/...` — статические ресурсы, вне графа.
- Ограничения метода: разбор регулярными выражениями, не AST; динамические `require(variable)` и `import(variable)` не раскрываются (в коде `feed.tsx:1049` есть динамический ПУТЬ маршрута, не модуля); совпадение имён в неиспользуемых экспортах ловится по слову, поэтому "REFS" означает возможное совпадение с PHP/комментарием, а не доказанное использование.

## Таблица: все не-USED файлы

| файл | класс | кто импортирует | вердикт | доказательство |
|---|---|---|---|---|
| `app/globals.css` | ORPHAN | - | MANUAL REVIEW | нет импортёров в app/; tailwind в зависимостях не проверялся; упоминания — только dashboard/ |
| `components/LegalLinks.tsx` | ORPHAN | - | CANDIDATE | нет импортёров и строковых ссылок |
| `components/feature/AboutYouStep.tsx` | ORPHAN | - | CANDIDATE | нет импортёров и строковых ссылок |
| `components/feature/MetroMap.tsx` | ORPHAN | - | CANDIDATE (удалить вместе с 2 constants) | нет импортёров; `git grep -w MetroMap` — только объявление |
| `components/feature/PhoneInput.tsx` | DEAD_CHAIN | components/index.ts | CANDIDATE (вместе с index.ts) | единственный импортёр — мёртвый components/index.ts; tests/auth_email_test.php:437 требует его отсутствия в регистрации |
| `components/feature/VacancyDetailHead.tsx` | ORPHAN | - | MANUAL REVIEW | нет импортёров; описан в docs/MAP.md:599 (обновить карту при удалении) |
| `components/index.ts` | ORPHAN | - | CANDIDATE | `git grep "from '@/components'"` пусто; только README.md:256 о PhoneInput |
| `components/ui/DescriptionBlocks.tsx` | ORPHAN | - | MANUAL REVIEW | нет импортёров; упомянут в docs/MAP.md:750, комментариях services/descriptionBlocks.ts:5 и tests/description-blocks.test.ts:6 |
| `constants/help.ts` | ORPHAN | - | CANDIDATE | нет импортёров; те же константы живут в php-proxy/db.php:1772 |
| `constants/lavkaLogoData.ts` | DEAD_CHAIN | components/feature/MetroMap.tsx | CANDIDATE (цепочка MetroMap) | единственный импортёр — MetroMap.tsx:12 |
| `constants/metroCoords.ts` | DEAD_CHAIN | components/feature/MetroMap.tsx | CANDIDATE (цепочка MetroMap) | единственный импортёр — MetroMap.tsx:11 |
| `constants/roleIcons.ts` | ORPHAN | - | CANDIDATE | нет импортёров; только комментарий components/SplashLoader.tsx:15 |
| `services/pay.ts` | ORPHAN | - | CANDIDATE (смены закрыты) | нет импортёров и строковых ссылок |
| `shims/canvas.js` | ORPHAN | - | KEEP (не мёртв) | metro.config.js:10 extraNodeModules.canvas |
| `template/auth/mock/index.ts` | ORPHAN | - | MANUAL REVIEW (см. п.2) | баррель подпапки, не импортируется (template/auth/index.ts берёт ./mock/hook напрямую) |
| `template/auth/supabase/index.ts` | ORPHAN | - | MANUAL REVIEW (см. п.2) | то же |
| `types/pdfjs-dist.d.ts` | ORPHAN | - | KEEP (не мёртв) | ambient `declare module` для services/resumeImport.ts:74-75 |

### Баррель-живые, но фактически неиспользуемые (граф их не ловит)

| файл | класс | кто импортирует | вердикт | доказательство |
|---|---|---|---|---|
| `template/auth/index.ts` | USED (формально) | template/index.ts | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/mock/context.tsx` | USED (формально) | template/auth/index.ts, template/auth/mock/hook.tsx | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/mock/hook.tsx` | USED (формально) | template/auth/index.ts, template/auth/mock/router.tsx | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/mock/router.tsx` | USED (формально) | template/auth/index.ts | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/mock/service.ts` | USED (формально) | template/auth/index.ts, template/auth/mock/context.tsx (+1) | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/supabase/context.tsx` | USED (формально) | template/auth/index.ts, template/auth/supabase/hook.tsx | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/supabase/hook.tsx` | USED (формально) | template/auth/index.ts, template/auth/supabase/router.tsx | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/supabase/router.tsx` | USED (формально) | template/auth/index.ts | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/supabase/service.ts` | USED (формально) | template/auth/index.ts, template/auth/supabase/context.tsx (+1) | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |
| `template/auth/types.ts` | USED (формально) | template/auth/index.ts, template/auth/mock/context.tsx (+5) | MANUAL REVIEW: фактически неиспользуем | из `@/template` приложение берёт только getSupabaseClient и AlertProvider |

### SCRIPT (скрипты как потребители; запускаются вручную/в CI, не из приложения)

| файл | импортируют скрипты | импортируют тесты |
|---|---|---|
| `scripts/autopilot-check.mjs` | - | - |
| `scripts/browser-probe.mjs` | - | - |
| `scripts/career-discover-lib.mjs` | scripts/career-discover.mjs | tests/career-discover.test.mjs |
| `scripts/career-discover.mjs` | - | - |
| `scripts/check-small-screens.mjs` | - | - |
| `scripts/dom-to-svg.js` | - | - |
| `scripts/gen-jupiter-employers.mjs` | - | tests/jupiter-employers.test.mjs |
| `scripts/gen-landing-docs.ts` | - | tests/landing-docs.test.ts |
| `scripts/gen-metro-php.js` | - | - |
| `scripts/reset-project.js` | - | - |
| `scripts/shoot-screens.mjs` | - | - |

Скрипты, не имеющие ни одного потребителя (ручные утилиты, MANUAL REVIEW, не код приложения): `scripts/autopilot-check.mjs`, `scripts/browser-probe.mjs`, `scripts/career-discover.mjs`, `scripts/check-small-screens.mjs`, `scripts/dom-to-svg.js`, `scripts/gen-metro-php.js`, `scripts/reset-project.js`, `scripts/shoot-screens.mjs`. Перед удалением проверить `package.json scripts`, `.github/workflows`, docs (`reset-project.js` — `package.json: reset-project`; `import-users` ссылается на несуществующий `scripts/import-users.ts` — `git ls-files scripts/import-users.ts` пусто).

### TEST: тесты → код приложения (потребители)

| тест | импортирует из приложения |
|---|---|
| `tests/apply-answers.test.ts` | lib/applyAnswers.ts |
| `tests/captcha-taps.test.ts` | services/captchaTaps.ts |
| `tests/career-discover.test.mjs` | scripts/career-discover-lib.mjs |
| `tests/company.test.ts` | services/company.ts |
| `tests/dayGroups.test.ts` | services/dayGroups.ts |
| `tests/description-blocks.test.ts` | services/descriptionBlocks.ts |
| `tests/energy.test.ts` | services/energy.ts |
| `tests/feedMix.test.ts` | services/feedMix.ts |
| `tests/feed_filters.test.ts` | services/feedFilters.ts |
| `tests/jupiter-employers.test.mjs` | scripts/gen-jupiter-employers.mjs |
| `tests/jupiter-fill.test.ts` | services/jupiterFill.ts |
| `tests/jupiter-timeline.test.ts` | services/jupiterTimeline.ts |
| `tests/jupiterAutopilot.test.ts` | services/jupiterAutopilot.ts |
| `tests/jupiterQuestions.test.ts` | services/jupiterQuestions.ts, services/notificationRoute.ts |
| `tests/jupiter_stats.test.ts` | dashboard/lib/jupiterStats.ts |
| `tests/landing-docs.test.ts` | scripts/gen-landing-docs.ts |
| `tests/mail-links.test.ts` | services/mailLinks.ts |
| `tests/mailHtml.test.ts` | lib/mailHtml.ts |
| `tests/messagePreview.test.ts` | services/messagePreview.ts |
| `tests/notificationRoute.test.ts` | services/notificationRoute.ts |
| `tests/profileEdit.test.ts` | constants/skills.ts, constants/types.ts, lib/profileEdit.ts |
| `tests/profileGateDecision.test.ts` | services/profileGateDecision.ts |
| `tests/resumeParser.test.ts` | lib/resumeParser.ts |
| `tests/stripEmoji.test.ts` | lib/stripEmoji.ts |
| `tests/time.test.ts` | services/time.ts |
| `tests/vacancy-facets.test.ts` | services/vacancyFacets.ts |
| `tests/workerCohort.test.ts` | dashboard/lib/workerCohort.ts |

Тесты без импортов приложения (читают исходники через readFileSync / проверяют php/py): `tests/app_links.test.mjs`, `tests/back_button.test.mjs`, `tests/career-catalog-sync.test.mjs`, `tests/company-logo-map.test.ts`, `tests/completeProfileTruth.test.ts`, `tests/confirm_web.test.mjs`, `tests/crash_reporting.test.mjs`, `tests/feed_empty_filters.test.mjs`, `tests/google_services.test.mjs`, `tests/missingUsersRetry.test.ts`, `tests/noEmoji.test.ts`, `tests/no_zoom.test.mjs`, `tests/notificationReadTruth.test.ts`, `tests/signedMediaRetry.test.ts`, `tests/tabHeader.test.ts`.

## Циклические зависимости

- Всего SCC>1 по всем импортам: [['constants/jobSections.ts', 'constants/types.ts']]
- По рантайм-импортам (без `import type`/dynamic): [] (пусто => рантайм-циклов нет).

## Неиспользуемые экспорты в файлах (T = импортируют тесты, D = импортирует только мёртвый код, int = ссылок внутри файла, grep = другие файлы с этим словом вне docs)

| файл | экспорт | T | D | int | grep других файлов |
|---|---|---|---|---|---|
| `components/NotificationPermissionSheet.tsx` | `NOTIFICATION_CHOICE_KEY` | - | - | 1 | app/profile-settings.tsx |
| `components/NotificationPermissionSheet.tsx` | `needsHomeScreenForPush` | - | - | 1 | - |
| `components/SplashLoader.tsx` | `Stroke` | - | D | 2 | constants/roleIcons.ts |
| `components/SplashLoader.tsx` | `DrawnArt` | - | - | 0 | - |
| `components/feature/ApplySheet.tsx` | `APPLY_MIN_LENGTH` | - | - | 1 | - |
| `components/feature/ApplySheet.tsx` | `ApplyChip` | - | - | 1 | - |
| `components/filters/kit.tsx` | `FToggle` | - | - | 1 | - |
| `components/filters/kit.tsx` | `filterStyles` | - | - | 0 | - |
| `components/profile/LanguageLevel.tsx` | `languageSegments` | - | - | 1 | - |
| `components/profile/ProfileTabs.tsx` | `ProfileTabKey` | - | - | 3 | - |
| `components/profile/SkillChip.tsx` | `ChipTone` | - | - | 1 | - |
| `components/profile/icons.tsx` | `ProfileIconProps` | - | - | 2 | - |
| `components/response/icons.tsx` | `ResponseIconProps` | - | - | 1 | - |
| `components/ui/TabHeader.tsx` | `HEADER_ICON` | - | - | 0 | - |
| `constants/chatSuggestions.ts` | `ChatSuggestion` | - | - | 3 | - |
| `constants/legal.ts` | `OPERATOR_EMAIL` | - | - | 20 | - |
| `constants/legal.ts` | `LegalDoc` | - | - | 1 | - |
| `constants/metro.ts` | `MetroLine` | - | - | 0 | - |
| `constants/profileEditTheme.ts` | `editTypography` | - | - | 0 | - |
| `constants/profileTheme.ts` | `HardShadowOffset` | - | - | 0 | - |
| `constants/profileTheme.ts` | `cardBase` | - | - | 0 | - |
| `constants/profileTheme.ts` | `profileTypography` | - | - | 0 | - |
| `constants/scale.ts` | `scaleFactor` | - | - | 0 | - |
| `contexts/AppContext.tsx` | `AppNotification` | - | - | 3 | - |
| `contexts/AppContext.tsx` | `ToastMessage` | - | - | 2 | - |
| `contexts/AppContext.tsx` | `VacancyStats` | - | - | 5 | - |
| `contexts/AppContext.tsx` | `OfflineKey` | - | - | 3 | - |
| `contexts/AppContext.tsx` | `OfflineMap` | - | - | 2 | - |
| `hooks/useSwipeDeck.ts` | `SWIPE_THRESHOLD` | - | - | 4 | - |
| `hooks/useSwipeDeck.ts` | `VELOCITY_THRESHOLD` | - | - | 2 | - |
| `hooks/useSwipeDeck.ts` | `MIN_FLING_DISTANCE` | - | - | 2 | - |
| `hooks/useSwipeDeck.ts` | `SwipeDeckHandlers` | - | - | 1 | - |
| `lib/androidInsets.ts` | `ANDROID_API` | - | - | 1 | - |
| `lib/androidInsets.ts` | `ANDROID_FORCED_EDGE_TO_EDGE` | - | - | 0 | - |
| `lib/androidInsets.ts` | `measuredNavBar` | - | - | 1 | - |
| `lib/androidInsets.ts` | `androidModalProps` | - | - | 0 | - |
| `lib/mailHtml.ts` | `MAIL_CSP` | T | - | 1 | tests/mailHtml.test.ts |
| `lib/personalFieldChoices.ts` | `PersonalFieldKey` | - | - | 5 | app/(tabs)/profile.tsx |
| `lib/personalFieldChoices.ts` | `PersonalChoice` | - | - | 1 | - |
| `lib/profileEdit.ts` | `emptyResume` | T | - | 1 | components/profile/ResumeTabContent.tsx, tests/profileEdit.test.ts |
| `lib/telegram.ts` | `isTelegramMiniApp` | - | - | 0 | - |
| `lib/telegram.ts` | `telegramHapticFeedback` | - | - | 0 | - |
| `services/captchaTaps.ts` | `MAX_TAPS` | T | - | 2 | jupiter/browser_captcha.py, tests/captcha-taps.test.ts |
| `services/companyLogoMap.ts` | `companyLogoKey` | - | - | 1 | tests/company-logo-map.test.ts |
| `services/companyLogoMap.ts` | `loadCompanyLogos` | - | - | 1 | - |
| `services/confirm.ts` | `ConfirmOptions` | - | - | 2 | - |
| `services/crashReporting.ts` | `crashReportingAvailable` | - | - | 1 | - |
| `services/dayGroups.ts` | `todayKey` | - | - | 4 | - |
| `services/dayGroups.ts` | `dayLabel` | T | - | 1 | app/chat-room.tsx, tests/dayGroups.test.ts |
| `services/db.ts` | `Responsiveness` | - | - | 2 | - |
| `services/db.ts` | `dbResponsivenessMap` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `dbCountUsers` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `ConsentPayload` | - | - | 1 | - |
| `services/db.ts` | `CrossBorderConsentRecord` | - | - | 1 | - |
| `services/db.ts` | `dbGetCrossBorderConsent` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `CrossBorderConsentSource` | - | - | 1 | - |
| `services/db.ts` | `dbRecordCrossBorderConsent` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `dbRevokeCrossBorderConsent` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `MarketingConsent` | - | - | 2 | - |
| `services/db.ts` | `dbDeleteUser` | - | - | 1 | php-proxy/db.php, tests/profile_privacy_test.php |
| `services/db.ts` | `dbGetUserByPhone` | - | - | 2 | php-proxy/README.md, php-proxy/db.php |
| `services/db.ts` | `dbUpsertVacancy` | - | - | 2 | "docs/\320\262\321\213\320\277\321\203\321\201\320\272-\320\277\321\200\320\270\320\273\320\276\320\266\320\265\320\275\320\270\321\217.md", "docs/\320\276\321\207\320\265\321\200\320\265\320\264\321\214-\320\267\320\260\320\264\320\260\321\207.md" (+2) |
| `services/db.ts` | `dbUpsertVacancyBatch` | - | - | 2 | "docs/\320\276\321\207\320\265\321\200\320\265\320\264\321\214-\320\267\320\260\320\264\320\260\321\207.md", php-proxy/db.php (+1) |
| `services/db.ts` | `dbGetLikes` | - | - | 2 | contexts/AppContext.tsx, "docs/\320\276\321\207\320\265\321\200\320\265\320\264\321\214-\320\267\320\260\320\264\320\260\321\207.md" (+4) |
| `services/db.ts` | `dbRecordVacancyView` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `GuestEventType` | - | - | 1 | - |
| `services/db.ts` | `GuestEventContext` | - | - | 4 | - |
| `services/db.ts` | `dbGetLikesByVacancy` | - | - | 2 | php-proxy/db.php |
| `services/db.ts` | `dbRemoveLike` | - | - | 2 | php-proxy/db.php |
| `services/db.ts` | `dbDeleteMatch` | - | - | 2 | "docs/\320\276\321\207\320\265\321\200\320\265\320\264\321\214-\320\267\320\260\320\264\320\260\321\207.md", php-proxy/db.php (+1) |
| `services/db.ts` | `dbRenameResumeFile` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `dbIncrementUnread` | - | - | 1 | php-proxy/db.php, supabase/migrations/070_atomic_message_insert.sql (+2) |
| `services/db.ts` | `dbAddSaved` | - | - | 2 | php-proxy/db.php |
| `services/db.ts` | `dbRemoveSaved` | - | - | 2 | php-proxy/db.php |
| `services/db.ts` | `dbFileComplaint` | - | - | 2 | "docs/\320\276\321\207\320\265\321\200\320\265\320\264\321\214-\320\267\320\260\320\264\320\260\321\207.md", php-proxy/db.php (+1) |
| `services/db.ts` | `dbDeleteVacancy` | - | - | 1 | php-proxy/db.php, tests/sitemap_invalidation_test.py |
| `services/db.ts` | `dbGetPermApplicationsForVacancy` | - | - | 2 | php-proxy/db.php |
| `services/db.ts` | `jupiterLiveStatus` | - | - | 2 | php-proxy/db.php, tests/jupiter_applications_test.php (+1) |
| `services/db.ts` | `dbGetExtVacancies` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `SkillResult` | - | - | 1 | - |
| `services/db.ts` | `dbGetSkillResults` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `dbSubmitSkillTest` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `dbSetEmployerCompany` | - | - | 1 | - |
| `services/db.ts` | `dbGetWebPushSubscription` | - | - | 1 | "docs/\320\276\321\207\320\265\321\200\320\265\320\264\321\214-\320\267\320\260\320\264\320\260\321\207.md", php-proxy/db.php |
| `services/db.ts` | `dbGetWorkerTokensByMetro` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `dbTgPrepareLink` | - | - | 0 | - |
| `services/db.ts` | `dbGetAllWorkerTokens` | - | - | 1 | php-proxy/db.php |
| `services/db.ts` | `TgAuthResult` | - | - | 2 | - |
| `services/db.ts` | `dbTelegramAuth` | - | - | 0 | - |
| `services/db.ts` | `dbBindTelegram` | - | - | 0 | - |
| `services/db.ts` | `dbUnbindTelegram` | - | - | 0 | - |
| `services/db.ts` | `SupportSender` | - | - | 2 | - |
| `services/db.ts` | `dbSupportSend` | - | - | 0 | - |
| `services/db.ts` | `JupiterQuestionType` | - | - | 1 | - |
| `services/extSaved.ts` | `ExtSavedItem` | - | - | 4 | - |
| `services/extSaved.ts` | `isExtSaved` | - | - | 1 | - |
| `services/extSaved.ts` | `resetExtSaved` | - | - | 0 | - |
| `services/feedFilterStore.ts` | `getAppliedFilters` | - | - | 0 | - |
| `services/feedFilterStore.ts` | `getDraft` | - | - | 0 | - |
| `services/feedFilters.ts` | `activeCount` | T | - | 0 | tests/feed_filters.test.ts |
| `services/feedFilters.ts` | `OwnVacancyLike` | - | - | 1 | - |
| `services/jupiterAutopilot.ts` | `AutopilotOutcome` | - | - | 1 | - |
| `services/jupiterAutopilot.ts` | `AutopilotOptions` | - | - | 1 | - |
| `services/jupiterAutopilot.ts` | `AUTOPILOT_CORE` | T | - | 1 | tests/jupiterAutopilot.test.ts |
| `services/jupiterFill.ts` | `buildFillScript` | T | - | 0 | tests/jupiter-fill.test.ts |
| `services/jupiterLive.ts` | `forgetJupiterLive` | - | - | 0 | tests/swipe_energy_test.php |
| `services/jupiterTimeline.ts` | `JupiterStatus` | T | - | 2 | - |
| `services/jupiterTimeline.ts` | `jupiterIsSber` | T | - | 1 | - |
| `services/jupiterTimeline.ts` | `JupiterBadge` | T | - | 1 | - |
| `services/jupiterTimeline.ts` | `TimelineKind` | T | - | 1 | - |
| `services/jupiterTimeline.ts` | `fillNote` | T | - | 2 | tests/jupiter-timeline.test.ts |
| `services/mailLinks.ts` | `MailPart` | - | - | 2 | - |
| `services/mailLinks.ts` | `linkLabel` | T | - | 1 | components/profile/PersonalTabContent.tsx, tests/mail-links.test.ts |
| `services/matchCounts.ts` | `workerLikes` | - | - | 1 | - |
| `services/matchCounts.ts` | `workerActive` | - | - | 1 | - |
| `services/matchCounts.ts` | `workerRejected` | - | - | 0 | - |
| `services/matchCounts.ts` | `workerCompleted` | - | - | 0 | - |
| `services/matching.ts` | `scoreVacancyForWorker` | - | - | 0 | - |
| `services/matching.ts` | `CandidateRank` | - | - | 1 | - |
| `services/notificationRoute.ts` | `NotifTarget` | - | - | 3 | - |
| `services/notifications.ts` | `requestNotificationPermissions` | - | - | 0 | - |
| `services/profileGateDecision.ts` | `ProfileGateStep` | - | - | 1 | - |
| `services/resumeImport.ts` | `extractResumePdf` | - | - | 1 | - |
| `services/resumeImport.ts` | `PickedResumeImport` | - | - | 1 | - |
| `services/storage.ts` | `getFeedSections` | - | - | 0 | tests/feed_sections_wiring_test.php, tests/it_only_feed_test.php |
| `services/storage.ts` | `saveFeedSections` | - | - | 0 | tests/feed_sections_wiring_test.php |
| `services/storage.ts` | `localDateStr` | - | - | 1 | - |
| `services/storage.ts` | `getVirtualStartDate` | - | - | 1 | - |
| `services/storage.ts` | `getTodayDates` | - | - | 0 | - |
| `services/storage.ts` | `isPhoneComplete` | - | D | 0 | components/feature/PhoneInput.tsx |
| `services/storage.ts` | `extractPhoneDigits` | - | - | 0 | - |
| `services/vacancyCard.ts` | `vacancyInfoLines` | - | - | 0 | - |
| `services/webVoice.ts` | `webVoiceMime` | - | - | 4 | - |
| `template/auth/mock/service.ts` | `MockAuthService` | - | - | 2 | - |
| `template/auth/supabase/service.ts` | `isVisibilityTriggeredAuthEvent` | - | - | 1 | - |
| `template/auth/supabase/service.ts` | `getLastVisibilityChange` | - | - | 0 | - |
| `template/auth/supabase/service.ts` | `shouldIgnoreAuthEvent` | - | - | 1 | - |
| `template/auth/supabase/service.ts` | `AuthService` | - | - | 16 | - |

Вердикт по таблице: `int=0` и пустой grep — кандидат на удаление; `int>0` — только снять `export`; `T` — используется только тестом (TEST_ONLY на уровне символа, оставить или перенести в тест); непустой grep из php-proxy/db.php — совпадение имён с серверной функцией, клиентская обёртка не вызывается (см. находку 9). Всё по умолчанию REQUIRES MANUAL REVIEW.

## Приложение: USED (число живых импортёров)

| файл | живых импортёров | примеры |
|---|---|---|
| `components/AutoRejectNotice.tsx` | 1 | app/create-perm-vacancy.tsx |
| `components/CompleteProfileSheet.tsx` | 1 | app/(tabs)/_layout.tsx |
| `components/ConsentGate.tsx` | 1 | app/_layout.tsx |
| `components/CookieConsent.tsx` | 1 | app/_layout.tsx |
| `components/EmailRequiredGate.tsx` | 1 | app/_layout.tsx |
| `components/EntryTransition.tsx` | 1 | app/(tabs)/_layout.tsx |
| `components/GuestGate.tsx` | 3 | app/(tabs)/chats.tsx, app/(tabs)/matches.tsx (+1) |
| `components/NotificationPermissionSheet.tsx` | 1 | app/(tabs)/_layout.tsx |
| `components/ReadTicks.tsx` | 2 | app/(tabs)/chats.tsx, app/chat-room.tsx |
| `components/SplashLoader.tsx` | 2 | app/index.tsx, components/EntryTransition.tsx |
| `components/feature/AddressSuggestField.tsx` | 1 | app/create-perm-vacancy.tsx |
| `components/feature/ApplyAnswersPrompt.tsx` | 1 | app/(tabs)/feed.tsx |
| `components/feature/ApplySheet.tsx` | 4 | app/(tabs)/feed.tsx, app/(tabs)/matches.tsx (+2) |
| `components/feature/ConsentChecks.tsx` | 1 | app/register-worker.tsx |
| `components/feature/DeleteAccountSheet.tsx` | 2 | app/(tabs)/profile.tsx, app/profile-settings.tsx |
| `components/feature/EmailCodeStep.tsx` | 3 | app/login.tsx, app/register-worker.tsx (+1) |
| `components/feature/MailHtmlView.tsx` | 1 | app/mail.tsx |
| `components/feature/MailHtmlView.web.tsx` | 1 | app/mail.tsx |
| `components/feature/MetroPicker.tsx` | 2 | app/(tabs)/profile.tsx, app/create-perm-vacancy.tsx |
| `components/feature/PermApplicationsSheet.tsx` | 1 | app/(tabs)/feed.tsx |
| `components/feature/ProfileGateHost.tsx` | 1 | app/_layout.tsx |
| `components/feature/ProfileGateSheet.tsx` | 1 | components/feature/ProfileGateHost.tsx |
| `components/feature/ScoreCard.tsx` | 3 | app/(tabs)/matches.tsx, app/(tabs)/profile.tsx (+1) |
| `components/feature/VacancyContacts.tsx` | 1 | app/perm-vacancy-detail.tsx |
| `components/feature/WorkTypeSelector.tsx` | 2 | app/(tabs)/feed.tsx, app/create-perm-vacancy.tsx |
| `components/filters/kit.tsx` | 7 | app/(tabs)/feed.tsx, app/filters/format.tsx (+5) |
| `components/profile/AddRow.tsx` | 2 | components/profile/PersonalTabContent.tsx, components/profile/ResumeTabContent.tsx |
| `components/profile/EditableRow.tsx` | 1 | components/profile/PersonalTabContent.tsx |
| `components/profile/EmptyState.tsx` | 1 | components/profile/ReviewsTabContent.tsx |
| `components/profile/FilesTabContent.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/HardShadowCard.tsx` | 3 | components/profile/ProfileHeader.tsx, components/profile/ResumeFileCard.tsx (+1) |
| `components/profile/LanguageLevel.tsx` | 1 | components/profile/ResumeTabContent.tsx |
| `components/profile/PersonalTabContent.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/ProfileHeader.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/ProfileTabs.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/ResumeFileCard.tsx` | 1 | components/profile/FilesTabContent.tsx |
| `components/profile/ResumeTabContent.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/ReviewsTabContent.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/SectionCard.tsx` | 1 | components/profile/ResumeTabContent.tsx |
| `components/profile/SkillChip.tsx` | 2 | components/profile/PersonalTabContent.tsx, components/profile/ResumeTabContent.tsx |
| `components/profile/edit/AddDashedButton.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/BottomSheet.tsx` | 4 | components/profile/edit/OptionSheet.tsx, components/profile/edit/index.ts (+2) |
| `components/profile/edit/Checkbox.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/Chip.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/ConfirmDialog.tsx` | 4 | components/profile/edit/index.ts, components/profile/edit/sheets/EmailSheet.tsx (+2) |
| `components/profile/edit/EditScreen.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/Field.tsx` | 3 | components/profile/edit/OptionSheet.tsx, components/profile/edit/index.ts (+1) |
| `components/profile/edit/FieldLabel.tsx` | 4 | components/profile/edit/Field.tsx, components/profile/edit/SelectField.tsx (+2) |
| `components/profile/edit/HardShadowBox.tsx` | 15 | app/(tabs)/feed.tsx, app/invite.tsx (+13) |
| `components/profile/edit/InfoNote.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/OptionSheet.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/RadioCard.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/SectionTitle.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/SelectField.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/TextArea.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/edit/Toggle.tsx` | 2 | components/profile/edit/index.ts, components/profile/edit/sheets/PhoneSheet.tsx |
| `components/profile/edit/icons.tsx` | 21 | app/invite.tsx, app/jupiter-answers.tsx (+19) |
| `components/profile/edit/index.ts` | 22 | app/profile-edit/apply-answers.tsx, app/profile-edit/award.tsx (+20) |
| `components/profile/edit/sheets/EmailSheet.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/edit/sheets/PhoneSheet.tsx` | 1 | app/(tabs)/profile.tsx |
| `components/profile/edit/useUnsavedGuard.tsx` | 1 | components/profile/edit/index.ts |
| `components/profile/icons.tsx` | 10 | app/(tabs)/matches.tsx, components/profile/AddRow.tsx (+8) |
| `components/profile/illustrations.tsx` | 2 | components/profile/FilesTabContent.tsx, components/profile/ReviewsTabContent.tsx |
| `components/response/icons.tsx` | 1 | app/jupiter-application.tsx |
| `components/ui/AppInput.tsx` | 2 | app/(tabs)/profile.tsx, components/feature/ProfileGateSheet.tsx |
| `components/ui/BackButton.tsx` | 19 | app/(tabs)/chats.tsx, app/(tabs)/company.tsx (+17) |
| `components/ui/Chip.tsx` | 1 | app/(tabs)/feed.tsx |
| `components/ui/CompanyMark.tsx` | 6 | app/(tabs)/company.tsx, app/(tabs)/feed.tsx (+4) |
| `components/ui/ConfirmDialog.tsx` | 1 | components/ui/ConfirmHost.tsx |
| `components/ui/ConfirmHost.tsx` | 1 | app/_layout.tsx |
| `components/ui/DeckLoader.tsx` | 1 | app/(tabs)/feed.tsx |
| `components/ui/JTBolt.tsx` | 2 | app/(tabs)/feed.tsx, components/ui/DeckLoader.tsx |
| `components/ui/JTPullRefresh.tsx` | 3 | app/(tabs)/feed.tsx, app/(tabs)/matches.tsx (+1) |
| `components/ui/LavkaLogo.tsx` | 2 | app/perm-vacancy-detail.tsx, components/ui/CompanyMark.tsx |
| `components/ui/NotifBell.tsx` | 2 | app/(tabs)/profile.tsx, components/ui/TabHeader.tsx |
| `components/ui/PrimaryButton.tsx` | 3 | app/(tabs)/profile.tsx, components/feature/AddressSuggestField.tsx (+1) |
| `components/ui/Sheet.tsx` | 7 | app/(tabs)/feed.tsx, app/(tabs)/profile.tsx (+5) |
| `components/ui/TabHeader.tsx` | 3 | app/(tabs)/feed.tsx, app/(tabs)/matches.tsx (+1) |
| `components/ui/TabLogo.tsx` | 3 | app/(tabs)/feed.tsx, app/(tabs)/matches.tsx (+1) |
| `components/ui/Toast.tsx` | 1 | components/ui/ToastLayer.tsx |
| `components/ui/ToastLayer.tsx` | 1 | app/_layout.tsx |
| `components/ui/jt.tsx` | 17 | app/+not-found.tsx, app/ext-vacancy.tsx (+15) |
| `constants/chatSuggestions.ts` | 5 | app/(tabs)/feed.tsx, app/(tabs)/matches.tsx (+3) |
| `constants/companyLogos.ts` | 3 | app/(tabs)/matches.tsx, app/jupiter-application.tsx (+1) |
| `constants/jobSections.ts` | 4 | app/(tabs)/feed.tsx, constants/types.ts (+2) |
| `constants/jt.ts` | 64 | app/(tabs)/_layout.tsx, app/(tabs)/chats.tsx (+62) |
| `constants/jupiterEmployers.ts` | 1 | constants/legal.ts |
| `constants/landing.ts` | 1 | app/+html.tsx |
| `constants/legal.ts` | 5 | app/(tabs)/profile.tsx, app/legal.tsx (+3) |
| `constants/metro.ts` | 7 | app/(tabs)/feed.tsx, app/(tabs)/profile.tsx (+5) |
| `constants/profileEditTheme.ts` | 44 | app/invite.tsx, app/jupiter-application.tsx (+42) |
| `constants/profileTheme.ts` | 18 | app/(tabs)/matches.tsx, app/(tabs)/profile.tsx (+16) |
| `constants/scale.ts` | 63 | app/(tabs)/_layout.tsx, app/(tabs)/chats.tsx (+61) |
| `constants/skills.ts` | 1 | app/profile-edit/skills.tsx |
| `constants/theme.ts` | 36 | app/(tabs)/_layout.tsx, app/(tabs)/chats.tsx (+34) |
| `constants/types.ts` | 49 | app/(tabs)/chats.tsx, app/(tabs)/company.tsx (+47) |
| `contexts/AppContext.tsx` | 3 | app/_layout.tsx, components/ui/Toast.tsx (+1) |
| `hooks/useApp.ts` | 60 | app/(tabs)/_layout.tsx, app/(tabs)/chats.tsx (+58) |
| `hooks/useEnergy.ts` | 1 | app/(tabs)/feed.tsx |
| `hooks/useHydrated.ts` | 2 | app/(tabs)/company.tsx, app/legal.tsx |
| `hooks/useMissingUsers.ts` | 1 | app/(tabs)/matches.tsx |
| `hooks/useSignedMedia.ts` | 1 | app/chat-room.tsx |
| `hooks/useSwipeDeck.ts` | 1 | app/(tabs)/feed.tsx |
| `hooks/useWarmSystemBar.ts` | 13 | app/(tabs)/feed.tsx, app/(tabs)/matches.tsx (+11) |
| `lib/androidInsets.ts` | 2 | app/(tabs)/_layout.tsx, components/NotificationPermissionSheet.tsx |
| `lib/applyAnswers.ts` | 4 | app/(tabs)/feed.tsx, app/jupiter-fill.tsx (+2) |
| `lib/mailHtml.ts` | 2 | components/feature/MailHtmlView.tsx, components/feature/MailHtmlView.web.tsx |
| `lib/personalFieldChoices.ts` | 1 | app/(tabs)/profile.tsx |
| `lib/profileEdit.ts` | 24 | app/(tabs)/feed.tsx, app/profile-edit/apply-answers.tsx (+22) |
| `lib/resumeParser.ts` | 1 | services/resumeImport.ts |
| `lib/stripEmoji.ts` | 2 | components/ui/NotifBell.tsx, components/ui/Toast.tsx |
| `lib/supabase.ts` | 2 | contexts/AppContext.tsx, services/db.ts |
| `lib/telegram.ts` | 1 | app/_layout.tsx |
| `lib/webPush.ts` | 4 | app/(tabs)/feed.tsx, app/profile-settings.tsx (+2) |
| `lib/webSplash.ts` | 4 | app/_layout.tsx, app/index.tsx (+2) |
| `services/avatarUpload.ts` | 2 | app/(tabs)/profile.tsx, components/CompleteProfileSheet.tsx |
| `services/captchaTaps.ts` | 1 | app/jupiter-captcha.tsx |
| `services/company.ts` | 5 | app/(tabs)/company.tsx, app/(tabs)/feed.tsx (+3) |
| `services/companyLogoMap.ts` | 3 | app/(tabs)/matches.tsx, app/jupiter-application.tsx (+1) |
| `services/confirm.ts` | 8 | app/(tabs)/chats.tsx, app/(tabs)/profile.tsx (+6) |
| `services/crashReporting.ts` | 3 | app/(tabs)/profile.tsx, app/user-profile.tsx (+1) |
| `services/dayGroups.ts` | 2 | app/(tabs)/matches.tsx, app/saved.tsx |
| `services/db.ts` | 51 | app/(tabs)/chats.tsx, app/(tabs)/feed.tsx (+49) |
| `services/descriptionBlocks.ts` | 1 | app/ext-vacancy.tsx |
| `services/energy.ts` | 3 | app/(tabs)/feed.tsx, constants/landing.ts (+1) |
| `services/extSaved.ts` | 3 | app/(tabs)/feed.tsx, app/ext-vacancy.tsx (+1) |
| `services/extVacancyHandoff.ts` | 3 | app/(tabs)/feed.tsx, app/ext-vacancy.tsx (+1) |
| `services/feedFilterStore.ts` | 7 | app/(tabs)/feed.tsx, app/filters/format.tsx (+5) |
| `services/feedFilters.ts` | 4 | app/(tabs)/feed.tsx, app/filters/index.tsx (+2) |
| `services/feedMix.ts` | 1 | app/(tabs)/feed.tsx |
| `services/jupiterAutopilot.ts` | 1 | app/jupiter-fill.tsx |
| `services/jupiterCaptcha.ts` | 1 | app/jupiter-captcha.tsx |
| `services/jupiterFill.ts` | 4 | app/(tabs)/matches.tsx, app/jupiter-application.tsx (+2) |
| `services/jupiterLive.ts` | 1 | app/jupiter-application.tsx |
| `services/jupiterQuestions.ts` | 1 | app/jupiter-questions.tsx |
| `services/jupiterTimeline.ts` | 3 | app/(tabs)/matches.tsx, app/jupiter-application.tsx (+1) |
| `services/mailLinks.ts` | 1 | app/mail.tsx |
| `services/matchCounts.ts` | 2 | app/(tabs)/_layout.tsx, app/(tabs)/matches.tsx |
| `services/matching.ts` | 1 | app/(tabs)/matches.tsx |
| `services/messagePreview.ts` | 2 | app/(tabs)/chats.tsx, app/chat-room.tsx |
| `services/notificationRoute.ts` | 2 | app/_layout.tsx, components/ui/NotifBell.tsx |
| `services/notifications.ts` | 8 | app/_layout.tsx, app/chat-room.tsx (+6) |
| `services/presence.ts` | 2 | app/chat-room.tsx, app/user-profile.tsx |
| `services/profileGateDecision.ts` | 1 | components/feature/ProfileGateHost.tsx |
| `services/resumeGate.ts` | 4 | app/(tabs)/feed.tsx, app/(tabs)/profile.tsx (+2) |
| `services/resumeImport.ts` | 2 | app/(tabs)/profile.tsx, components/feature/ProfileGateSheet.tsx |
| `services/storage.ts` | 19 | app/(tabs)/chats.tsx, app/(tabs)/feed.tsx (+17) |
| `services/time.ts` | 5 | app/(tabs)/feed.tsx, app/(tabs)/matches.tsx (+3) |
| `services/vacancyCard.ts` | 2 | app/(tabs)/feed.tsx, app/perm-vacancy-detail.tsx |
| `services/vacancyFacets.ts` | 9 | app/(tabs)/feed.tsx, app/ext-vacancy.tsx (+7) |
| `services/webVoice.ts` | 1 | app/chat-room.tsx |
| `template/auth/index.ts` | 1 | template/index.ts |
| `template/auth/mock/context.tsx` | 2 | template/auth/index.ts, template/auth/mock/hook.tsx |
| `template/auth/mock/hook.tsx` | 2 | template/auth/index.ts, template/auth/mock/router.tsx |
| `template/auth/mock/router.tsx` | 1 | template/auth/index.ts |
| `template/auth/mock/service.ts` | 3 | template/auth/index.ts, template/auth/mock/context.tsx (+1) |
| `template/auth/supabase/context.tsx` | 2 | template/auth/index.ts, template/auth/supabase/hook.tsx |
| `template/auth/supabase/hook.tsx` | 2 | template/auth/index.ts, template/auth/supabase/router.tsx |
| `template/auth/supabase/router.tsx` | 1 | template/auth/index.ts |
| `template/auth/supabase/service.ts` | 3 | template/auth/index.ts, template/auth/supabase/context.tsx (+1) |
| `template/auth/types.ts` | 7 | template/auth/index.ts, template/auth/mock/context.tsx (+5) |
| `template/core/client.ts` | 2 | template/auth/supabase/service.ts, template/core/index.ts |
| `template/core/config.ts` | 3 | template/auth/supabase/hook.tsx, template/auth/supabase/service.ts (+1) |
| `template/core/index.ts` | 1 | template/index.ts |
| `template/core/types.ts` | 3 | template/core/client.ts, template/core/config.ts (+1) |
| `template/index.ts` | 7 | app/(tabs)/profile.tsx, app/_layout.tsx (+5) |
| `template/ui/context.tsx` | 2 | template/ui/hook.tsx, template/ui/index.ts |
| `template/ui/hook.tsx` | 1 | template/ui/index.ts |
| `template/ui/index.ts` | 1 | template/index.ts |
| `template/ui/types.ts` | 2 | template/ui/context.tsx, template/ui/index.ts |

## Приложение: ENTRY

`app/(tabs)/_layout.tsx`, `app/(tabs)/chats.tsx`, `app/(tabs)/company.tsx`, `app/(tabs)/feed.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/matches.tsx`, `app/(tabs)/profile.tsx`, `app/+html.tsx`, `app/+not-found.tsx`, `app/_layout.tsx`, `app/admin.tsx`, `app/analytics.tsx`, `app/chat-room.tsx`, `app/create-perm-vacancy.tsx`, `app/ext-vacancy.tsx`, `app/filters/format.tsx`, `app/filters/index.tsx`, `app/filters/level.tsx`, `app/filters/posted.tsx`, `app/filters/salary.tsx`, `app/filters/spec.tsx`, `app/index.tsx`, `app/invite.tsx`, `app/jupiter-answers.tsx`, `app/jupiter-application.tsx`, `app/jupiter-captcha.tsx`, `app/jupiter-fill.tsx`, `app/jupiter-questions.tsx`, `app/legal.tsx`, `app/login.tsx`, `app/mail.tsx`, `app/perm-vacancy-detail.tsx`, `app/profile-edit/_layout.tsx`, `app/profile-edit/apply-answers.tsx`, `app/profile-edit/award.tsx`, `app/profile-edit/basic.tsx`, `app/profile-edit/certificate.tsx`, `app/profile-edit/city-metro.tsx`, `app/profile-edit/course.tsx`, `app/profile-edit/desired-position.tsx`, `app/profile-edit/driving-license.tsx`, `app/profile-edit/education.tsx`, `app/profile-edit/exam.tsx`, `app/profile-edit/interests.tsx`, `app/profile-edit/languages.tsx`, `app/profile-edit/links.tsx`, `app/profile-edit/relocation.tsx`, `app/profile-edit/restrictions.tsx`, `app/profile-edit/skills.tsx`, `app/profile-edit/work-conditions.tsx`, `app/profile-edit/work-permit.tsx`, `app/profile-edit/work-place.tsx`, `app/profile-settings.tsx`, `app/rate.tsx`, `app/register-employer.tsx`, `app/register-worker.tsx`, `app/saved.tsx`, `app/support.tsx`, `app/user-profile.tsx`