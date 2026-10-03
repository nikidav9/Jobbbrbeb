# Аудит зависимостей (только чтение), 2026-10-03

Корневой package.json: 101 пакетов. Метод: git ls-files *.ts/tsx/js/mjs/cjs (без dashboard, video) -> regexp import/require/dynamic import, плюс алиас @/ (template/ и lib/supabase.ts разобраны вручную), плюс app.json plugins, babel/metro/eslint/eas, .github/workflows, docs/MAP.md и reverse-peer поиск по node_modules/*/package.json. Скрипты: scratchpad/scan.mjs, peers.mjs.

| пакет | версия | нативный? | статус | где используется (доказательство) | рекомендация |
|---|---|---|---|---|---|
| @apollo/client | ^3.4.10 | нет | UNUSED | 0 импортов, 0 строк-ссылок | remove (JS-only) вместе с graphql |
| @appmetrica/react-native-analytics | 4.2.0 | да | USED | services/crashReporting.ts; tests/crash_reporting.test.mjs пинит версию 4.2.0 | keep |
| @expo-google-fonts/inter | ^0.4.1 | нет | UNUSED | 0 импортов, 0 строковых ссылок вне package*.json | remove (JS-only) |
| @expo-google-fonts/manrope | ^0.4.1 | нет | USED | app/_layout.tsx, components/SplashLoader.tsx | keep |
| @expo-google-fonts/onest | 0.4.1 | нет | UNUSED | 0 импортов | remove (JS-only) |
| @expo-google-fonts/unbounded | 0.4.1 | нет | USED | app/_layout.tsx, components/SplashLoader.tsx | keep |
| @expo/metro-runtime | ~57.0.16 | нет | REQUIRED BY TOOLCHAIN | peer expo, expo-router, @expo/router-server | keep |
| @expo/styleguide-native | ^1.0.1 | нет | UNUSED | 0 импортов | remove (JS-only) |
| @expo/vector-icons | ^15.0.3 | нет | USED | 49 файлов app/components | keep |
| @gorhom/bottom-sheet | 4.4.6 | нет | UNUSED | 0 импортов (только peer-цели reanimated/gesture-handler) | remove (JS-only) |
| @lucide/lab | ^0.1.2 | нет | UNUSED | 0 импортов | remove (JS-only) |
| @privacyresearch/libsignal-protocol-typescript | 0.0.16 | нет | UNUSED | 0 импортов | remove (JS-only) |
| @react-native-async-storage/async-storage | 2.2.0 | да | USED | 13 файлов; lib/supabase.ts, template/core/client.ts | keep |
| @react-native-community/datetimepicker | 9.1.0 | да (+plugin) | REQUIRES MANUAL REVIEW | нет JS-импорта; есть config plugin в app.json plugins; упоминание в jupiter/browser_engine.py (не JS) | нативный: решение владельца; если пикер не нужен - убрать вместе с plugin ДО сборки 1.0.0 |
| @react-native-masked-view/masked-view | 0.3.2 | да | REQUIRED BY TOOLCHAIN | зависимость expo-router (нужна для нативного стека/табов) | keep |
| @supabase/supabase-js | ^2.50.0 | нет | USED | lib/supabase.ts (realtime channel + Storage), template/core/client.ts; AppContext.tsx, services/db.ts (ветки при IS_NATIVE=true=false не исполняются), chat-room.tsx .channel() | keep; НЕ мёртвая |
| bcryptjs | ^3.0.3 | нет | UNUSED | 0 JS-импортов (совпадение только php-proxy/db.php - это PHP bcrypt) | remove + @types/bcryptjs |
| date-fns | ^2.28.0 | нет | UNUSED | 0 импортов (dashboard/ свой date-fns) | remove (JS-only) |
| dedent | ^0.7.0 | нет | UNUSED | 0 импортов (совпадение в Python-тесте) | remove (JS-only) |
| es6-error | ^4.1.1 | нет | UNUSED | 0 импортов | remove (JS-only) |
| expo | ^57.0.9 | да | USED | metro.config.js (expo/metro-config), babel preset, eslint, CI | keep |
| expo-application | ~57.0.3 | да | USED | app/chat-room.tsx; peer expo-notifications/auth-session | keep |
| expo-asset | ~57.0.18 | да (+plugin) | REQUIRED BY TOOLCHAIN | plugin в app.json; peer expo-audio; dep expo | keep |
| expo-audio | ~57.0.5 | да (+plugin) | USED | app/chat-room.tsx + plugin | keep |
| expo-auth-session | ~57.0.13 | нет | POSSIBLY USED | только template/auth/supabase/service.ts (template экспортируется из @/template, но OAuth-путь, вероятно, не вызывается) | REVIEW: JS-only, но уйдёт вместе с template-кодом; не удалять без проверки template/ |
| expo-clipboard | ~57.0.2 | да | USED | app/invite.tsx, app/jupiter-application.tsx | keep |
| expo-constants | ~57.0.20 | да | USED | services/db.ts, services/notifications.ts | keep |
| expo-crypto | ~57.0.3 | да | USED | feed.tsx, perm-vacancy-detail.tsx | keep |
| expo-device | ~57.0.2 | да | USED | services/notifications.ts | keep |
| expo-document-picker | ~57.0.3 | да (+plugin) | USED | profile-edit/certificate.tsx, services/resumeImport.ts | keep |
| expo-file-system | ~57.0.7 | да (+plugin) | USED | chat-room.tsx, certificate.tsx, avatarUpload.ts | keep |
| expo-font | ~57.0.4 | да (+plugin) | USED | app/_layout.tsx, SplashLoader + plugin | keep |
| expo-image | ~57.0.5 | да (+plugin) | USED | 13 файлов + plugin | keep |
| expo-image-manipulator | ~57.0.20 | да | USED | chat-room.tsx, services/avatarUpload.ts | keep |
| expo-image-picker | ~57.0.20 | да (+plugin) | USED | profile.tsx, chat-room.tsx, CompleteProfileSheet + plugin | keep |
| expo-linear-gradient | ~57.0.2 | да | USED | 6 файлов | keep |
| expo-linking | ~57.0.11 | да | REQUIRED BY TOOLCHAIN | peer expo-router; dep expo-auth-session (deep links jobtoo://) | keep |
| expo-localization | ~57.0.2 | да (+plugin) | REQUIRES MANUAL REVIEW | нет JS-импорта; в app.json plugins | нативный; убрать только вместе с plugin ДО сборки; иначе keep |
| expo-manifests | ~57.0.2 | да | REQUIRED BY TOOLCHAIN | dep expo-updates | keep |
| expo-navigation-bar | ~57.0.3 | да (+plugin) | REQUIRES MANUAL REVIEW | 0 импортов, нет plugin; нативный, autolinking его включит в бинарник | нативный; кандидат на удаление только ДО сборки 1.0.0, нужно решение |
| expo-notifications | ~57.0.21 | да (+plugin) | USED | app/_layout.tsx, services/notifications.ts + plugin; getExpoPushTokenAsync; google-services.json есть (FCM через Expo push) | keep |
| expo-router | ~57.0.24 | да (+plugin) | USED | 63 файла + plugin | keep |
| expo-screen-orientation | ~57.0.2 | да (+plugin) | REQUIRES MANUAL REVIEW | 0 импортов, нет plugin; app.json orientation=portrait работает без него | нативный; кандидат ДО сборки 1.0.0, нужно решение |
| expo-secure-store | ~57.0.4 | да (+plugin) | USED | services/db.ts + plugin | keep |
| expo-splash-screen | ~57.0.9 | да (+plugin) | USED | 4 файла + plugin | keep |
| expo-status-bar | ~57.0.1 | да (+plugin) | USED | app/_layout.tsx + plugin | keep |
| expo-symbols | ~57.0.3 | да | REQUIRED BY TOOLCHAIN | dep expo-router | keep |
| expo-system-ui | ~57.0.4 | да (+plugin) | REQUIRED BY TOOLCHAIN | нужен для userInterfaceStyle в app.json (prebuild) ; peer react-native-web-ветки | keep (нативный) |
| expo-updates | ~57.0.24 | да (+plugin) | USED | app/_layout.tsx, profile-settings.tsx + plugin; OTA | keep |
| expo-web-browser | ~57.0.3 | да (+plugin) | USED | profile.tsx, template/auth/supabase/service.ts + plugin | keep |
| graphql | ^15.3.0 | нет | UNUSED | 0 импортов; нужен только @apollo/client (peer) - тоже не используется | remove вместе с @apollo/client |
| lucide-react-native | ^0.475.0 | нет | UNUSED | 0 импортов (иконки: @expo/vector-icons) | remove (JS-only) |
| nativewind | ^4.1.23 | нет | UNUSED | 0 импортов; нет tailwind.config/global.css/babel-preset nativewind | remove (JS-only) |
| path-to-regexp | ^1.9.0 | нет | UNUSED | 0 импортов, никто не зависит | remove (JS-only) |
| pdfjs-dist | 3.11.174 | нет | USED | services/resumeImport.ts; metro.config.js shim canvas; types/pdfjs-dist.d.ts | keep |
| prop-types | ^15.7.2 | нет | UNUSED | 0 импортов; транзитивно приходит сам (apollo, react-redux и др.) | remove (JS-only) |
| querystring | ^0.2.0 | нет | UNUSED | 0 импортов, никто не зависит | remove (JS-only) |
| react | 19.2.3 | нет | USED | 160 файлов | keep |
| react-dom | 19.2.3 | нет | REQUIRED BY TOOLCHAIN | peer expo-router/@expo/metro-runtime/react-native-web (веб-сборка) | keep |
| react-native | 0.86.3 | нет | USED | 158 файлов | keep |
| react-native-calendars | ^1.1312.1 | нет | UNUSED | 0 импортов | remove (JS-only) |
| react-native-chart-kit | 6.12.0 | нет | USED | app/analytics.tsx | keep |
| react-native-crypto-js | ^1.0.0 | нет | UNUSED | 0 импортов | remove (JS-only) |
| react-native-dynamic | ^1.0.0 | нет | UNUSED | 0 импортов | remove (JS-only); убрать из expo.doctor.exclude |
| react-native-edge-to-edge | 1.6.0 | да (+plugin) | REQUIRES MANUAL REVIEW | 0 JS-импортов; нет в plugins; lib/androidInsets.ts лишь комментарии; нативный, autolinking | нативный: решить до сборки 1.0.0 (RN 0.86 имеет edge-to-edge в ядре) |
| react-native-elements | ^3.4.3 | нет | UNUSED | 0 импортов | remove (JS-only) |
| react-native-fade-in-image | ^1.6.1 | нет | UNUSED | 0 импортов | remove (JS-only); убрать из expo.doctor.exclude |
| react-native-gesture-handler | ~2.32.0 | да | USED | chats.tsx, feed.tsx, _layout.tsx; peer expo-router | keep |
| react-native-infinite-scroll-view | ^0.4.5 | нет | UNUSED | 0 импортов | remove (JS-only); убрать из expo.doctor.exclude |
| react-native-keyboard-aware-scroll-view | ^0.9.5 | нет | UNUSED | 0 импортов | remove (JS-only); убрать из expo.doctor.exclude |
| react-native-paper | ^5.12.5 | нет | UNUSED | 0 импортов | remove (JS-only) |
| react-native-qrcode-svg | ^6.3.15 | нет | UNUSED | 0 импортов | remove (JS-only) |
| react-native-reanimated | 4.5.1 | да | USED | chats.tsx, feed.tsx, hooks/useSwipeDeck.ts | keep |
| react-native-safe-area-context | ~5.7.0 | да | USED | 45 файлов; peer expo-router | keep |
| react-native-screens | ~4.26.0 | да | REQUIRED BY TOOLCHAIN | peer/dep expo-router (нет прямых импортов) | keep (нативный) |
| react-native-super-grid | ^6.0.1 | нет | UNUSED | 0 импортов | remove (JS-only) |
| react-native-svg | 15.15.4 | да | USED | 9 файлов; нужен chart-kit | keep |
| react-native-url-polyfill | ^2.0.0 | нет | USED | app/_layout.tsx, lib/supabase.ts | keep |
| react-native-vector-icons | ^10.2.0 | да | REQUIRES MANUAL REVIEW | 0 импортов (совпадения - @expo/vector-icons); peer react-native-elements (сам не используется); в пакете есть android/ - шрифты нативно | JS-код не использует; кандидат после решения по react-native-elements; нативный |
| react-native-web | ^0.21.0 | нет | REQUIRED BY TOOLCHAIN | peer expo, expo-image, expo-router (веб - обязательная поверхность) | keep |
| react-native-webview | 13.16.1 | да | USED | jupiter-fill.tsx, MailHtmlView.tsx, MetroMap.tsx | keep |
| react-native-worklets | 0.10.1 | да | REQUIRED BY TOOLCHAIN | peer react-native-reanimated, expo-modules-core; babel-preset-expo подключает плагин сам | keep (нативный) |
| react-redux | ^7.2.0 | нет | UNUSED | 0 импортов | remove (JS-only) |
| react-refresh | ^0.17.0 | нет | REQUIRED BY TOOLCHAIN | peer babel-preset-expo / dep expo, react-native | keep |
| react-string-replace | ^0.4.4 | нет | UNUSED | 0 импортов | remove (JS-only) |
| redux | ^4.0.5 | нет | UNUSED | 0 импортов | remove (JS-only) |
| redux-thunk | ^2.3.0 | нет | UNUSED | 0 импортов | remove (JS-only) |
| semver | ^7.6.0 | нет | UNUSED | 0 импортов в коде приложения; транзитивно есть у @babel/core, @expo/cli | remove (JS-only), но низкий приоритет |
| snack-content | ^3.2.0 | нет | UNUSED | 0 импортов | remove (JS-only) |
| tslib | 2.6.2 | нет | POSSIBLY USED | 0 импортов; tsconfig без importHelpers; транзитивно у supabase/apollo; пин 2.6.2 | низкий риск, но REVIEW: проверить importHelpers/сборку веба |
| url | ^0.11.0 | нет | UNUSED | 0 импортов (в workflows только слово "url") | remove (JS-only) |
| zustand | ^5.0.2 | нет | UNUSED | 0 импортов | remove (JS-only) |
| @babel/core (dev) | ^7.25.2 | нет | REQUIRED BY TOOLCHAIN | peer babel-preset-expo/metro; babel.config.js | keep (devDependency верно) |
| @types/bcryptjs (dev) | ^2.4.6 | нет | UNUSED | нет bcryptjs | remove вместе с bcryptjs |
| @types/node (dev) | ^26.6.4 | нет | REQUIRED BY TOOLCHAIN | tests/*.ts импортируют node:test/fs/path; peer ts-node | keep |
| @types/react (dev) | ~19.2.10 | нет | REQUIRED BY TOOLCHAIN | tsc --noEmit | keep |
| eslint (dev) | ^9.25.0 | нет | REQUIRED BY TOOLCHAIN | eslint.config.js, npm run lint | keep |
| eslint-config-expo (dev) | ~57.0.2 | нет | REQUIRED BY TOOLCHAIN | eslint.config.js | keep |
| react-dev-inspector (dev) | ^2.0.1 | нет | UNUSED | 0 упоминаний (только package.json/deno.lock) | remove (devDep) |
| ts-node (dev) | ^10.9.2 | нет | UNUSED | единственный потребитель - script import-users -> ./scripts/import-users.ts, файла НЕТ | remove вместе с мёртвым script import-users |
| typescript (dev) | ~6.0.3 | нет | REQUIRED BY TOOLCHAIN | tsc --noEmit, CI typecheck | keep |

## Счёт
- UNUSED: 38
- USED: 37
- REQUIRED BY TOOLCHAIN: 18
- REQUIRES MANUAL REVIEW: 6
- POSSIBLY USED: 2

## @supabase/supabase-js: НЕ мёртвая
- `grep -rn "supabase-js" lib template`: lib/supabase.ts (createClient), template/core/client.ts (createClient + getSupabaseClient).
- services/db.ts: `const IS_NATIVE = true` (строка 18) - все `supabase.from(...)` стоят в ветках `if (!IS_NATIVE)`, фактически мёртвый путь данных; данные идут через php-proxy.
- Живое использование: `.channel(...)` (realtime) в app/chat-room.tsx:512, app/(tabs)/profile.tsx:129, app/user-profile.tsx:183, contexts/AppContext.tsx:546/557/712 (комментарий в lib/supabase.ts: "остались две вещи: живые обновления чата и загрузка файлов в Storage"). Экраны analytics.tsx, admin.tsx тоже берут getSupabaseClient().
- Вывод: зависимость нужна. Убрать можно только после миграции realtime/Storage на php-proxy (отдельная задача). Дубль в dashboard/package.json (там 0 импортов, см. ниже).

## Firebase / FCM
- Пакетов firebase / @react-native-firebase в package.json и lock НЕТ (`grep firebase package.json package-lock.json` пусто).
- `google-services.json` существует в корне (project jobtoo-266b7, package com.jobtoo) и указан в app.json android.googleServicesFile: нужен expo-notifications для FCM-токена Android. Пуш идёт через Expo Push (`getExpoPushTokenAsync` в services/notifications.ts:129,158). Файл содержит api_key (клиентский ключ Firebase, не секрет сервера, но находится в публичном репо - на сведение владельца).
- expo-notifications: USED.

## Версии-дубли (несколько пакетов делают одно)
- Иконки: @expo/vector-icons (USED) vs lucide-react-native, @lucide/lab, react-native-vector-icons.
- UI-киты: react-native-paper, react-native-elements, nativewind - все без импортов.
- Состояние: redux, react-redux, redux-thunk, zustand, @apollo/client+graphql - ничего не импортируется (стейт: contexts/AppContext.tsx).
- Шрифты: 4 пакета @expo-google-fonts, используются 2 (manrope, unbounded).
- Крипто: bcryptjs, react-native-crypto-js, @privacyresearch/libsignal - не используются; expo-crypto используется.
- Списки/скролл: react-native-super-grid, infinite-scroll-view, keyboard-aware-scroll-view, react-native-calendars - не используются.
- Node polyfills: url, querystring, path-to-regexp - не используются.
- Два Supabase-пути (lib/supabase.ts и template/core/client.ts) создают два клиента с одной библиотекой.

## Не на своём месте (dependencies vs devDependencies)
- @babel/core, eslint, eslint-config-expo, typescript, @types/* в devDependencies - верно.
- В dependencies, но по смыслу dev/инфра: react-refresh (peer babel-preset-expo; безвреден), @expo/metro-runtime (нужен в рантайме веба - ок), tslib/semver (транзитивные).
- Обратных случаев (рантайм в devDependencies) не найдено.
- package.json несёт `resolutions` (metro 0.82.0) - yarn-поле, при npm не действует; `overrides` (shell-quote, tar) действует. Для SDK 57 metro 0.82 - проверить вручную (REQUIRES MANUAL REVIEW, вне задачи).
- `.npmrc`: legacy-peer-deps=true - скрывает конфликты peer; удаление пакетов не должно их создавать, но npm ci нужно прогнать в ветке.

## Прочие package.json
- **dashboard/** (Next.js, отдельный lock): grep по коду dashboard: next, react-dom, recharts, geist, web-push, tailwindcss, @tailwindcss/postcss, postcss - используются. НЕ найдено импортов: @supabase/supabase-js, bcryptjs (+@types/bcryptjs), clsx, date-fns, tailwind-merge -> кандидаты (REVIEW, т.к. CI build-dashboard npm ci/next build должен это подтвердить).
- **video/** (Remotion): код импортирует только react и remotion; @remotion/cli - инструмент рендера (scripts), react-dom - peer. Отдельный пакет, в бандл приложения не входит, eslint его игнорирует. Не трогать.
- **jupiter/**: package.json нет; jupiter/requirements.txt: quickjs>=1.19; в CI дополнительно pip playwright==1.63.0. Python-зависимости, к npm не относятся.
- **infra/**: package.json и requirements нет (shell/python stdlib).

## Правила применения
- Все кандидаты "remove (JS-only)" - чистый JS, не нативные: OTA-безопасно (нет импортов), нативный бинарник не меняется. Удаление из package.json меняет package-lock; CI `npm ci` + typecheck + lint + `expo export --platform web` обязательны перед мержем (в этом аудите ничего не менялось).
- Нативные пакеты без импортов (datetimepicker, localization, navigation-bar, screen-orientation, edge-to-edge, react-native-vector-icons) помечены REQUIRES MANUAL REVIEW: бинарник 1.0.0 ещё не собран, удаление сейчас безопасно по JS, но убирать их plugin из app.json - решение владельца. После выпуска бинарника удалять их нельзя без пересборки.
- Побочное: scripts `import-users` указывает на отсутствующий scripts/import-users.ts; expo.doctor.exclude содержит react-native-webrtc и expo-av, которых нет в зависимостях.
- Побочное: при аудите случайно создан пустой файл /x (пустая heredoc-ошибка); удалить не смог из-за защитной проверки. Попросите владельца удалить `/x` (0 байт, вне репозитория).
