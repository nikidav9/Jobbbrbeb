# Аудит архитектуры JobToo — 03.10.2026

Режим: **только анализ**, код не менялся (решение владельца 03.10.2026: сначала аудит, потом
решаем, что удалять). Пять аудиторов работали параллельно, выводы сверял оркестратор; где
проверял руками — так и сказано. Подробности и доказательства — в файлах рядом:

| Файл | О чём |
|---|---|
| `1-imports.md` | граф импортов, сироты, мёртвые экспорты, циклы |
| `2-dependencies.md` | статус каждой из 101 зависимости |
| `3-duplicates.md` | дубли и смешение слоёв |
| `4-periphery.md` | каталоги верхнего уровня, ассеты, скрипты, миграции (**есть поправки в шапке**) |
| `5-critical-systems.md` | цепочки «экран → сервис → db.php → таблица» по критическим системам |

## 1. Как устроено сейчас

Схема из задания «UI → Supabase/Firebase» к JobToo **не подходит**:

```
экран (app/) → useApp / services → services/db.ts → POST /api/db.php (RPC {fn,args}) → Supabase Postgres
```

- Firebase-пакетов в клиенте нет. Пуши — `expo-notifications` + Expo Push; `google-services.json`
  нужен Android-сборке для FCM-токена (его проверяет `tests/google_services.test.mjs`).
- `@supabase/supabase-js` в приложении **есть**, но ради realtime-сигналов
  (`chat-room`, `profile`, `user-profile`, `AppContext`) и двух клиентов
  (`lib/supabase.ts`, `template/core/client.ts`). Все 73 вызова `supabase.from()` в `db.ts`
  лежат в ветках `!IS_NATIVE`, а `IS_NATIVE = true`, — это мёртвый код (~440 строк).
- Слоя «репозиторий» между UI и RPC нет: `services/db.ts` зовут напрямую 24 экрана,
  11 компонентов, 3 хука и 12 модулей.
- Чистые слои, уже покрытые тестами: `energy`, `feedMix`, `feedFilters`, `vacancyFacets`,
  `matchCounts`, `matching`, `dayGroups`, `notificationRoute`, `profileGateDecision`,
  `jupiterTimeline`, `captchaTaps`, `lib/profileEdit`, `lib/applyAnswers`, `lib/resumeParser`.
- Самые смешанные файлы: `app/(tabs)/feed.tsx` (2885 строк, три продукта в одном),
  `services/db.ts` (2588), `contexts/AppContext.tsx` (1110), затем `profile.tsx`,
  `matches.tsx`, `chat-room.tsx`, `profile-settings.tsx`, `jupiter-fill.tsx`.
- Циклов импортов в рантайме нет (один type-only: `constants/jobSections.ts` ↔ `constants/types.ts`).

**Главный барьер любого переноса файлов:** около 91 теста читают исходники как текст
(`feed.tsx` — 12+ тестов). Перенос кода ломает их; ещё 70 файлов приложения упомянуты по
пути в tests/scripts/php/infra.

## 2. Возможные живые ошибки (найдены попутно, не чинились)

1. **`dbGetUsers` отвечает 403 при каждом обновлении.** Она в `$adminFns` (`db.php:198`),
   комментарий там уверяет «приложение её не зовёт», но `AppContext.refreshUsers` зовёт её
   без `X-Admin-Token`. Ошибка глотается, список `users` остаётся из кэша. Проверено по коду.
2. **`dbReleasePushToken` — тихий no-op.** Не в `$publicFns`, а вызывается при выходе, когда
   сессии уже нет → 401; плюс сам case требует `uid`. Токен на сервере не освобождается.
   Проверено по коду.
3. **`notifyWorkersNewVacancy`** (прямой `fetch` в `services/notifications.ts`) шлёт только
   `X-App-Secret` без `Authorization` → вероятно 401. Зовётся из `create-perm-vacancy`
   (работодатели закрыты) — вес низкий. Не проверено на проде.
4. **Шторка уведомлений соискателя** (`profile.tsx:1168`) всегда «Уведомлений пока нет», хотя
   рядом рабочий `NotifBell`. Нужно слово владельца: намеренно или нет.
5. `registerForPushNotifications` на холодном старте зовётся дважды (`AppContext:419`, `:465`).
6. Открытый кэш профиля `jm_currentUser` в AsyncStorage лежит рядом с токеном в SecureStore —
   нужен отдельный security-review.

## 3. Кандидаты на удаление (по уровням доверия)

**A. Высокая уверенность — нет ни импорта, ни ссылки в тестах/конфигах/CI:**
`components/feature/MetroMap.tsx` + `constants/metroCoords.ts` + `constants/lavkaLogoData.ts`
(перед удалением проверить `YANDEX_MAPS_API_KEY`); `components/index.ts` +
`components/feature/PhoneInput.tsx`; `components/LegalLinks.tsx`;
`components/feature/AboutYouStep.tsx`; `services/pay.ts` (смены закрыты);
`constants/help.ts`; `constants/roleIcons.ts`; `WebPushBanner` в `feed.tsx` (~80 строк);
ветки `!IS_NATIVE` и ~35 клиентских обёрток RPC без вызовов в `services/db.ts`
(сверять с `$publicFns` / `$selfArgFns`); скрипт `import-users` в `package.json`
(файла `scripts/import-users.ts` нет); две картинки `assets/images/1779*` (дубли
`attached_assets/`) и `assets/fonts/SpaceMono-Regular.ttf`.

**B. Нужен просмотр человеком:** `template/auth/**` (15 файлов, ~1500 строк; приложение берёт
из `@/template` только `getSupabaseClient` и `AlertProvider`), `components/feature/VacancyDetailHead.tsx`
и `components/ui/DescriptionBlocks.tsx` (описаны в `docs/MAP.md` — карту править),
`app/globals.css`, `app/admin.tsx` (нет ссылок на него), `attached_assets/`, `deno.lock`
(упомянут в `scripts/secret-scan.py`), 138 неиспользуемых экспортов
(список — в `1-imports.md`; в большинстве хватит снять `export`).

**C. НЕ трогать (выглядят мёртвыми, но нет):** `shims/canvas.js` (`metro.config.js`),
`types/pdfjs-dist.d.ts` (`services/resumeImport.ts`), `data/company-logos/*` (логотипы ленты),
`google-services.json`, `app/filters/level.tsx` и `posted.tsx` (путь `/filters/${kind}`),
номера миграций (уже применены).

## 4. Зависимости (101 пакет)

USED 37 · REQUIRED BY TOOLCHAIN 18 · UNUSED 38 · РУЧНАЯ ПРОВЕРКА 6 · POSSIBLY USED 2.

Чисто-JS без единого упоминания (вручную перепроверено выборкой из 13 — подтвердилось):
`@apollo/client`, `graphql`, `nativewind`, `lucide-react-native`, `@lucide/lab`,
`@expo/styleguide-native`, `@gorhom/bottom-sheet`, `react-native-paper`, `react-native-elements`,
`react-native-calendars`, `react-native-qrcode-svg`, `react-native-super-grid`,
`react-native-fade-in-image`, `react-native-infinite-scroll-view`,
`react-native-keyboard-aware-scroll-view`, `react-native-dynamic`, `redux`, `react-redux`,
`redux-thunk`, `zustand`, `@expo-google-fonts/inter`, `@expo-google-fonts/onest`, `bcryptjs`
(+ `@types/bcryptjs`), `react-native-crypto-js`, `@privacyresearch/libsignal-protocol-typescript`,
`date-fns`, `dedent`, `es6-error`, `path-to-regexp`, `prop-types`, `querystring`, `url`,
`react-string-replace`, `snack-content`, `semver`; dev: `react-dev-inspector`, `ts-node`.
После удаления — `npm ci`, typecheck, lint, `expo export --platform web`; убрать их же из
`expo.doctor.exclude`.

**Нативные без JS-импортов — решение владельца** (пока бинарник 1.0.0 не собран, убрать
безопасно; после выпуска — только с пересборкой): `@react-native-community/datetimepicker`,
`expo-localization` (оба в `plugins`), `expo-navigation-bar`, `expo-screen-orientation`,
`react-native-edge-to-edge`, `react-native-vector-icons`. `expo-auth-session` — вместе с `template/`.
`@supabase/supabase-js` убрать нельзя, пока realtime и Storage не перенесены на php-proxy.

`package.json: resolutions` (metro) — поле для yarn, при npm не действует.

## 5. Дубли (топ по ценности, подробности — `3-duplicates.md`)

Прямой `fetch` мимо `proxy()` (2 места); «включить уведомления» написано 4 раза; 5 копий
чтения файла/base64; два поколения UI-кита (3 кнопки, 3 поля, 4 семейства чипов, два
`ConfirmDialog` с разным API; экраны работодателя на старой теме); форматирование
(5 копий месяцев, 4 правила телефона, 11 поисков линии метро); 4 набора цветов с дрейфом
(`#FF6A1F`/`#FF6B1A`…); две ветки карточки ленты в `feed.tsx` (`renderPermDeckCard`, возможно,
недостижима — свои вакансии в колоду не попадают).

## 6. Предлагаемая структура

Полная смена структуры (`src/`, `features/`) **сейчас не рекомендуется**: 91 тест привязан к
путям, а каждый мерж сам выкатывается в приложение. Рекомендованный путь — постепенный:

1. Мёртвые файлы (уровень A) — один PR.
2. Мёртвые ветки `!IS_NATIVE` и обёртки в `db.ts`.
3. Починка найденных ошибок (раздел 2) + единый `fetch` через `proxy()`.
4. Зависимости (по группам, с `expo export` в CI).
5. Решения владельца: UI-кит, шторка уведомлений, `template/`.
6. Форматтеры и файловый модуль в `lib/`.
7. В последнюю очередь: разрезать `feed.tsx` и `db.ts` по доменам (`services/db/{auth,profile,feed,chat,...}`)
   — вместе с правкой тестов, читающих исходники.

Внутри существующих папок правило уже рабочее: логика — в `services/` и `lib/` чистыми
функциями с node-тестами, экраны — тонкие. Это и надо продолжать, а не вводить `features/`.

## 7. Что хрупко и не трогается рефакторингом

Порядок `registerUser` (реферал до записи, токен из ответа `dbUpsertUser`); различие
«401 с токеном» и «401 без токена» в `proxy()`; миграция токена в SecureStore; ретрай чтения
сессии на Android (3×200 мс); `zIndex` вместе с `elevation` в ленте; `collapsable={false}` у
плашки вкладок; все хуки колоды до раннего `return`; `SplashScreen.preventAutoHideAsync` /
`hideAsync`; контракт `webSplash` и версия кэша `public/sw.js`; `X-App-Secret` и
`X-App-Version` на каждом запросе; `app.json: version` и `runtimeVersion`; `push_privacy.php` и
`notificationRoute.ts` менять парами.

## 8. Как проводился аудит и его границы

Статический разбор своим скриптом (регулярки, не AST); `knip`/`madge` не запускались. Динамические
`require(переменная)` не раскрываются. Живой сервер, прод-таблицы и сборки не проверялись —
пункты раздела 2 опираются на код репозитория. Отчёт по периферии содержал ошибки, исправлены
вручную (см. шапку `4-periphery.md`). Остальные отчёты проверены выборочно, не целиком.
