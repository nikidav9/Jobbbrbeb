# Аудит 3: дублирование и пересечение ответственности

Режим: только чтение. Охват: `services/` (45 файлов), `lib/` (11), `hooks/` (7), `contexts/` (1), `constants/` (18), `components/` (89), `app/` (экраны). Репозиторий на коммите `2db728c4`. Правило: сомнение значит REQUIRES MANUAL REVIEW (в тексте — RMR).
Каталог `.claude/worktrees/*` — чужие копии репозитория (в git не входят, `.git/info/exclude`); из всех подсчётов исключён.

Методика: `grep` по импортам и именам; скрипт `scratchpad/exports.py` считает экспорты без внешних ссылок (результат — `scratchpad/unused-exports.txt`, 146 строк). Для каждого «мёртвого» вывода проверено, что нет `import * as`, динамических `require` и вызова по строковому имени.

Шкала риска: низкий / средний / высокий. Для клиента OTA-обновление выкатывается мержем в `main`; нативные модули и `version` не трогаем (CLAUDE.md). Ни одно предложение ниже не требует нативных модулей и смены версии.

---

## 0. Размеры и что в них смешано

| Файл | Строк | Что смешано |
|---|---|---|
| `services/db.ts` | 2588 | Транспорт (`proxy`, таймаут, повтор, 401), хранение токена сессии, маппинг строк в типы (`rowTo*`, `*ToRow`), 158 экспортов `db*` по 25 доменам, ~440 строк недостижимого кода прямого Supabase (п. 1), типы доменов (`ResumeVaultItem`, `MarketingConsent`, `JupiterSavedAnswer`…) |
| `app/(tabs)/feed.tsx` | 2885 | Один файл — три продукта. `WorkerPermMode` 798–1979 (≈1180 строк: колода, фильтры, поиск, молния, undo, обе отрисовки карточек); `EmployerHome` 1984–2242 (≈260); `WorkerCareer` 2242; `HomeScreen` 2262; стили 2660–2885. Внутри ещё: бизнес-логика (`cleanDescription`, `matchesSearch`, `previewText`, `filterChipInfo`, `interleave`), UI-компоненты (`FilterChipsBar`, `VacancyViewersModal`, `DeckActions`, `FeedSearchHeader`), 20 прямых вызовов `db*` |
| `app/(tabs)/matches.tsx` | 1898 | `WorkerMatches` (348–800) и `EmployerMatches` (956–1690) плюс 2 набора стилей; `permAppStatus`, `MatchStatus` |
| `app/(tabs)/profile.tsx` | 1482 | Два разных профиля в одном файле: новый (соискатель, `components/profile/*`, `ProfileColors`) и старый (работодатель: `Colors`, свой `SectionCard`, `AppInput`/`PrimaryButton`, инлайн-окно правки). Плюс `RatingsModal`, заглушка уведомлений (п. 5) |
| `app/chat-room.tsx` | 1476 | Экран + голосовые (`VoiceBubble`, веб-запись) + своя работа с файлами и датами |
| `contexts/AppContext.tsx` | 1110 | Сессия и вход, 41 `useState`, кэш (stale-while-revalidate), realtime (web), два почти одинаковых опроса (web и native), уведомления, тосты, оптимистичные правки |
| `app/analytics.tsx` | 1067 | Свои форматтеры и график, разовый экран |

Вывод по размерам: самые дорогие в сопровождении места — `feed.tsx` (раздел 6) и `db.ts` (раздел 1). Оба уже расписаны в `docs/MAP.md`; дробить их надо отдельными срезами, а не вперемешку с чисткой дублей.

---

## 1. Дубль: два пути к серверу, один мёртвый (Supabase-клиент и `IS_NATIVE`)

Факты:
- `services/db.ts:18` `const IS_NATIVE = true;` — константа. 65 функций имеют ранний `if (IS_NATIVE) { return proxy(...) }`, после него идёт прямой `supabase.from(...)`. Скриптом посчитано ≈442 строки кода после раннего возврата (оценка, не точный счёт). Всего `supabase.` в `db.ts` — 73 вхождения.
- `lib/supabase.ts` создаёт клиент `@supabase/supabase-js`. Живые потребители:
  1. `contexts/AppContext.tsx:511, 546, 557` — только `supabase.channel(...).on('broadcast')` (сигналы realtime), и только на web (`:507`, `Platform.OS !== 'web'` — выход).
  2. `services/db.ts` — мёртвые ветки выше и `dbWarmup` (`:704–713`, живая ветка — `fetch`).
- Комментарий в `lib/supabase.ts:21` «осталось две вещи: чат и загрузка файлов в Storage» устарел: Storage-вызовов в клиенте нет (`grep supabase.storage` пусто), загрузка идёт через `dbUploadFile` (`db.ts:1193`).

1) Что используется: прокси `POST /api/db.php`. Из supabase-js — только realtime-канал на вебе.
2) Legacy: все ветки после `if (IS_NATIVE)`, функции `throwOnError`, `withTimeout` (частично), импорт `supabase` в `db.ts`. На native-сборке `@supabase/supabase-js` остаётся в бандле из-за импорта `lib/supabase` в `db.ts` и `AppContext` (нативный JS-размер, не нативный модуль).
3) Уникальная логика в мёртвой копии: нет — всё уже выполняет сервер (`php-proxy/db.php`). Исключение для RMR: `withTimeout(…, DB_TIMEOUT)` (12 с) защищал прямые вызовы, а у `proxy` свои 25 с и повтор.
4) Объединить можно: удалить ветки и `IS_NATIVE`; оставить `supabase` только в `AppContext`/`lib/supabase.ts` для realtime.
5) Путь: (a) PR только с удалением веток после `IS_NATIVE` (механически, `typecheck` и `npm test` ловят расхождения); (b) отдельным PR — вынести realtime в `services/realtime.ts` и ленивый `import()` только на web; (c) обновить комментарий в `lib/supabase.ts`. Риск (a): низкий (код недостижим). Риск (b): средний (realtime web, опрос-страховка остаётся). Tree-shaking supabase-js из native-бандла — RMR: проверить `expo export` размер до/после.

---

## 2. Дубль: четыре места строят адрес прокси и делают `fetch` мимо `proxy()`

Места:
- `services/db.ts:29` `API_BASE` (trim, срез `/`), `proxy()` — единственная «дверь» с таймаутом 25 с, повтором, разбором не-JSON, 401, `X-App-Version`, `Authorization`.
- `services/notifications.ts:15–20` `PROXY_URL` + `APP_SECRET`; `fetch` в `:318` (`notifyWorkersNewVacancy`).
- `lib/webPush.ts:19–26` `PROXY_URL` + `APP_SECRET`; `fetch` в `:129` (`dbSaveWebPushSubscription`).
- `lib/supabase.ts:42` — свой вариант того же правила (web = `window.location.origin`).
- Ещё два прямых `fetch` к прокси внутри `db.ts` (`:142` сам `proxy`, `:705` `dbWarmup`) — допустимы.

Различия между копиями (скрытый риск расхождений):
| Копия | trim/срез `/` | `X-App-Version` | `Authorization` | таймаут/повтор | обработка 401 |
|---|---|---|---|---|---|
| `db.ts proxy` | да | да | да | 25 с, 1 повтор | чистит токен, `sessionExpiredHandler` |
| `webPush.ts` | нет | нет | да (через `getSessionToken`) | 12 с (`wpTimeout`) | только своё сообщение |
| `notifications.ts` | нет | нет | НЕТ | 25 с, до 3 попыток | нет |

**Вероятная живая ошибка (RMR, проверить на сервере):** `notifyWorkersNewVacancy` шлёт только `X-App-Secret`, без `Authorization`. В `php-proxy/db.php:282–299` функция `dbNotifyAllWorkersNewVacancy` не входит в `$publicFns`, а сразу после (`:296–299`) идёт отказ 401 «Authentication required» для не-публичных функций без сессии. Кроме того, сама функция (`db.php:8909+`) проверяет `employer_id === $authUid`. Если вывод верен, рассылка по новой вакансии (`app/create-perm-vacancy.tsx:92–101`) каждый раз возвращает `false`, и работодатель видит «рассылку не удалось отправить». Спасает серверный `jt_announce_missed` («раз в час», комментарий `db.php:~8940`). Подтвердить: вызвать с реальной сессией и с нашим телом без токена.

1) Используется: `proxy()` в `db.ts`; две внешние копии — рабочие пути уведомлений.
2) Legacy: обе копии `PROXY_URL`/`APP_SECRET`.
3) Уникальная логика: `notifyWorkersNewVacancy` — собственная политика повтора (3 попытки при наличии `vacancyId`, идемпотентность на сервере); `webPush` — таймаут шага 12 с и 401-сообщение «выйдите и войдите».
4) Объединить: да. Экспортировать из `db.ts` (или нового `services/api.ts`) `proxy` как `callServer(fn, args, opts?)`; добавить `dbSaveWebPushSubscription(userId, endpoint, p256dh, auth)` и `dbNotifyAllWorkersNewVacancy(...)` обычными функциями `db*`. Повтор рассылки оставить в `notifications.ts` поверх них.
5) Путь: (1) добавить две обёртки в `db.ts` (+ PHP менять не надо: функции и права есть); (2) переключить `webPush.ts` и `notifications.ts`; (3) удалить `PROXY_URL`/`APP_SECRET`; (4) сторожевой тест «в `app|components|lib|services` нет `fetch(`…`/api/db.php`» вне `db.ts`. Правило CLAUDE.md «добавляя серверную функцию, правишь обе стороны» соблюдено: сервер уже умеет. Риск: низкий для `webPush` (простая замена), средний для `notifyWorkersNewVacancy` (поведение изменится с «всегда 401» на «работает», нужен ручной прогон создания вакансии; идемпотентность на сервере защищает от дублей). Ценность: высокая.

---

## 3. Дубль: уведомления разложены по пяти местам, и сценарий «включить» написан 4 раза

Файлы: `services/notifications.ts` (344), `services/notificationRoute.ts` (75), `lib/webPush.ts` (160), `components/NotificationPermissionSheet.tsx` (420), `components/ui/NotifBell.tsx` (340), `app/profile-settings.tsx` (блок 258–395), `contexts/AppContext.tsx` (регистрация и уведомления), `app/(tabs)/feed.tsx:94–170`.

3.1 Реализации «включить уведомления»
| Где | Что делает |
|---|---|
| `app/profile-settings.tsx:317–375` `enableNotifications` | сброс `NOTIFICATION_DISABLED_KEY`; web — `registerWebPush`; native — `getPermissionsAsync`→`requestPermissionsAsync`→`registerForPushNotifications`, шаги с таймаутом; пишет `NOTIFICATION_CHOICE_KEY` |
| `components/NotificationPermissionSheet.tsx:70–120` (авто) и `:178–215` `handleEnable` | то же самое с другими таймаутами (`ENABLE_TIMEOUT_MS`), своя ветка iOS-подсказки |
| `contexts/AppContext.tsx:419–421, 465, 756, 774` | тихая регистрация при старте, входе, регистрации |
| `app/(tabs)/feed.tsx:106–150` `WebPushBanner` | четвёртая версия (web). **Не отрисовывается нигде** (`grep WebPushBanner` — только объявление), вместе с `getWPState`, `wpStyles` ≈80 строк мёртвого кода |

3.2 Мелкие дубли внутри этого блока
- Ключ `'jm_notif_prompt_choice'` объявлен дважды: `profile-settings.tsx:34` (локально) и `NotificationPermissionSheet.tsx:20` (экспорт) — значение одно, источники два.
- `registerForPushNotifications` на холодном старте вызывается дважды подряд: `AppContext.tsx:419` и `:465` (оба `setTimeout 2000`) — два `dbSavePushToken` за один запуск.
- В `services/notifications.ts` мёртвое: `escapeHtml` (`:190`), типы `ExpoPushMessage`/`ExpoPushTicket` (`:165–184`), `DASHBOARD_URL` (`:11`), `requestNotificationPermissions` (`:85`, 0 внешних ссылок), `formatDateRu`/`MONTHS_RU` нужны только рассылке. Ветка `type: 'shift'` в `notifyWorkersNewVacancy` — смены закрыты 17.09.2026, остался один вызов с `type: 'permanent'`.
- `lib/webPush.ts` импортирует из `services/notifications.ts` (`NOTIFICATION_DISABLED_KEY`), а тот — из `db.ts`; обратной зависимости нет, цикла нет.

3.3 Маршрутизация (`services/notificationRoute.ts`) — не дубль: единая таблица для пуша (`app/_layout.tsx:174`) и колокольчика (`NotifBell.tsx:125`). Оставить как есть. Но `TO_MATCHES` содержит «смены» (`shift_confirmed_by_employer`, `shift_cancelled`, `shift_rejected`) и `TO_FEED` — `nearby_shift`: для старой истории нужны, RMR перед удалением.

1) Используется: `registerForPushNotifications`, `releasePushTokenIfSignedOut`, `setActiveChat`, `notifyWorkersNewVacancy`, `setupAndroidChannels`, `registerWebPush`, `NotificationPermissionSheet` (монтируется в `app/(tabs)/_layout.tsx:258`).
2) Legacy: `WebPushBanner`, `escapeHtml`, типы Expo-тикетов, `requestNotificationPermissions`, смена в рассылке.
3) Уникальная логика: лист разрешения — правила показа (раз в 3 дня для iOS-подсказки, `needsHomeScreenForPush`); настройки — причины отказа токена (`getPushRegisterDebug`), «блокировано системой».
4) Объединить: да — один модуль `services/pushEnable.ts` с `enablePush(userId): Promise<{ok, state, message}>` (разрешение + токен/подписка + запись `CHOICE`), который зовут настройки и лист. `AppContext` оставить на тихой `registerForPushNotifications`.
5) Путь: (a) удалить `WebPushBanner` и мёртвые функции — риск низкий; (b) убрать вторую регистрацию из `AppContext:465` — низкий (проверить, не отличались ли условия: первая внутри `if (!isGuest)`? — RMR по контексту `:405–470`); (c) общий `enablePush` — средний (iOS/Android/PWA на разных платформах, автотестов нет, нужен ручной прогон трёх поверхностей). Ценность: средняя.

---

## 4. Дубль: чтение файла в байты и base64 — пять копий

| Файл | Функция | Строки |
|---|---|---|
| `services/avatarUpload.ts` | `base64ToUint8Array` + ветка web (`fetch(uri)`→blob) | 16–36, 69–80 |
| `app/chat-room.tsx` | `base64ToUint8Array` (внутри компонента!), `uriToBytes` | 624–649, 762 |
| `services/resumeImport.ts` | `base64ToBytes`, `readAsset` | 14–47 |
| `app/profile-edit/certificate.tsx` | `bytesToBase64`, ветка web | 40, 205–216 |
| `services/db.ts` | `bytesToBase64` | 1175 |
| `app/jupiter-fill.tsx` | `loadResumeBase64` (fetch) | 41–50 |

1) Используется: все (разные экраны).
2) Legacy: нет «старой» — это независимые копии одного кода; в `avatarUpload.ts` комментарий прямо говорит «Копировать было нельзя», но копии появились позже.
3) Уникальное: `readAsset` проверяет лимит 10 МБ и `response.ok`; `uriToBytes` в чате без проверки `ok`; `chat-room` внутри компонента пересоздаёт функцию на каждый рендер.
4) Объединить: да, в `lib/fileBytes.ts`: `readUriBytes(uri)` (web: fetch/blob; native: `FileSystem.readAsStringAsync` base64 + декодер), `bytesToBase64`, `base64ToBytes`. `atob` в Hermes есть не везде — отсюда ручной декодер, его и оставить единственным.
5) Путь: создать модуль и тест на круговой обмен base64 (`node:test`, как `tests/energy.test.ts`); заменять по одному файлу. Риск: низкий–средний (платформенные ветки; web и телефон проверить руками на аватаре и фото в чате).

---

## 5. Пересечение: две «шторки уведомлений», одна — заглушка

- `components/ui/NotifBell.tsx` — настоящий список (`useApp().notifications`, `markNotifRead`, маршруты). Подключён через `TabHeader` (старый заголовок работодателя).
- `app/(tabs)/profile.tsx:1168–1195` — шторка «Уведомления» у соискателя (`ProfileTopBar.onNotifications`, `:642`) **всегда показывает «Уведомлений пока нет»**: список не читается вовсе, хотя `hasUnread`/`unreadCount` рядом считаются. Импорт `NotifBell` в `profile.tsx:41` не используется.

Вывод: либо заглушка забыта (функциональная дыра для основной аудитории), либо так решено владельцем. RMR: спросить владельца; если нет — заменить на тот же список, что в `NotifBell` (вынести `NotificationList` из `NotifBell.tsx`). Риск: низкий (чтение данных, которые уже в контексте). Ценность: высокая для продукта.

---

## 6. Дубль: две ветки карточки ленты и общие вычисления (`feed.tsx`, `ext-vacancy.tsx`)

- `renderPermDeckCard` (`feed.tsx:1404`, ≈260 строк) и `renderExtDeckCard` (`:1667`, ≈250) — одинаковый каркас (`cardArea`, призраки, список с pull-to-refresh, футер), разная начинка. Комментарий над первой: «тот же макет, что у смены».
- Выражения повторены в `feed.tsx:1677–1678` и `app/ext-vacancy.tsx:84–87`: `vacancyLevel`→`VACANCY_LEVELS.find(...)`, `vacancyFormat`→`VACANCY_FORMATS.find(...)`; зарплата `₽/${payPeriod==='hour'?'ч':'мес'}` — `feed.tsx:1720`, `ext-vacancy.tsx:176`.
- Зарплата вида `${x.toLocaleString('ru-RU')} ₽/мес` вручную — 12 мест: `feed.tsx:1244, 1472, 2158`, `perm-vacancy-detail.tsx:133, 242`, `company.tsx:263`, `admin.tsx:295`, `notifications.ts:261`, `ext-vacancy.tsx:176` и др. Отдельно `lib/profileEdit.ts:52 formatSalary`, `feed.tsx:229 salaryShort` и мёртвый `services/pay.ts payShort`.
- Вычищение описания: `cleanDescription`/`previewText` (feed) и `parseDescriptionBlocks` (`services/descriptionBlocks.ts`, `ext-vacancy.tsx:39`) — разные цели (превью и разбор), но источник разметки один (`## `, `• `). Вынести превью в `services/descriptionBlocks.ts` (рядом с парсером, чистая функция, тест уже есть: `tests/description-blocks.test.ts`).

Свои вакансии (`PermVacancy`) в колоду сейчас не попадают (MAP: `sectionOfPerm(workType)==='it'`, ни один вид работ не IT), то есть `renderPermDeckCard` и интерливинг `feedMix.ts` могут быть недостижимы для работника; для работодателя `PermVacancy` — это его же вакансии в других экранах. RMR: подтвердить у владельца, жива ли ветка; если нет — минус ≈260 строк. Риск удаления: средний (затрагивает свайп/undo, охрана `tests/swipe_card_test.php`, `card_scroll_test.php`).

Ценность объединения вычислений (`services/vacancyCard.ts`: `salaryLabel`, `levelLabel`, `formatLabel`): средняя; риск низкий (чистые функции + юнит-тесты).

---

## 7. Дубль: два поколения дизайн-системы живут параллельно

Токены (количество файлов-потребителей): `constants/theme.ts` `Colors` — 42; `constants/jt.ts` `JT` — 70; `constants/profileTheme.ts` — 18; `constants/profileEditTheme.ts` — 44.
Дрейф значений одного и того же цвета:
- акцент: `#FF6B1A` (`Colors.primary`, `JT.accent`, `EditColors.accent`) и `#FF6A1F` (`ProfileColors.accent`);
- чернила: `#141414` (`JT.ink`, `EditColors.ink`) и `#151413` (`ProfileColors.ink`);
- фон: `#F5EFE6` (`JT`, `Edit`) и `#F4EEE5` (`ProfileColors.bg`);
- персиковый: `#FFE2CC` одинаков в трёх наборах; `#E8DED1` (`JT.stack2`, `Edit.disabledBg`), `#CFC4B6` (`JT.borderSoft`, `Edit.border`), `#4A443D`, `#6B645C` повторены в `JT` и `EditColors`.
- Во вёрстке: `#FFFFFF` 45 раз, `#92400E` 23, `#EFE7DC` 14 как литералы в `app|components` (токены ими не используются).

Шрифты: два набора файлов одной гарнитуры грузятся в `app/_layout.tsx:232–241`: локальные `Manrope-500/700/800`, `Unbounded-700` (`JT_FONT`) и пакетные `Manrope_500Medium…800ExtraBold`, `Unbounded_700Bold/800ExtraBold` (профиль и правка профиля). Из-за этого `JT_FONT.semi` уже ссылается на пакетный вариант. Итого шесть-семь файлов TTF вместо четырёх.

Компоненты по поколениям:
- Старое (светлая тема `Colors`): `ui/PrimaryButton`, `ui/AppInput`, `ui/Chip`, `ui/TabHeader`, `ui/NotifBell`, `ui/Toast`; используются в основном в экранах работодателя (`feed.tsx:2087 <TabHeader/>` внутри `EmployerHome`, `matches.tsx:1602` в `EmployerMatches`, `profile.tsx:647` в ветке работодателя), `ProfileGateSheet`, `AddressSuggestField`.
- Новое («наклейка» JT): `ui/jt.tsx` (`JTButton`, `JTInput`, `JTProgress`, `JTCheck`, `JTLink` — 17 потребителей, в основном вход/регистрация), `profile/edit/*` (кит правки профиля, 22 потребителя), `filters/kit.tsx`, `profile/*`.

Конкретные пары:
| Пара | Кто использует | Вывод |
|---|---|---|
| `ui/PrimaryButton` / `ui/jt.tsx JTButton` / локальный `PrimaryButton` в `jupiter-application.tsx:78` | 3 / ~12 / 1 | три разных кнопки, одно имя дважды. Объединять в `JTButton` (+ вариант `secondary`/`danger`/`small`); локальную заменить |
| `ui/AppInput` / `ui/jt.tsx JTInput` / `profile/edit/Field`+`TextArea` | 3 / ~6 / 17 | три поля ввода; `Field` — эталон правки, `JTInput` — вход |
| `ui/Chip` / `profile/SkillChip` / `profile/edit/Chip` (+`SuggestChip`, `RemovableChip`) / `filters/kit FChip` | 1 / 2 / 12 / 7 | четыре семейства чипов |
| `ui/ConfirmDialog` (из `ConfirmHost`, `confirmAsync`) / `profile/edit/ConfirmDialog` | 1 / 4 | **одинаковое имя, разные API**: `body` vs `message`, `onCancel` vs `onDismiss`; обе делают «да/нет» |
| `ui/Sheet.tsx` (`SheetHandle`+`useSwipeToDismiss`, 7 потребителей, каждый сам делает `<Modal>`) / `profile/edit/BottomSheet` (самодостаточная, 4) | 15 `<Modal` по коду; `BottomSheet` и `Sheet` — два способа сделать шторку | нужен один примитив |
| `ui/Toast` / `ToastLayer` | `ToastLayer` в `_layout`; `Toast` только через него и `components/index.ts` | не дубль, но `components/index.ts` (9 строк) не импортируется нигде: мёртвая бочка, тянет за собой `PhoneInput`, `WorkTypeSelector`… |
| `profile/HardShadowCard` / `profile/edit/HardShadowBox` / стиль `cardSticker` в `feed.tsx` | 3 / 15 / 1 | три реализации «жёсткой тени» |
| `profile/icons.tsx` (36 иконок) / `profile/edit/icons.tsx` (16) / `response/icons.tsx` | 10 / 21 / 1 | пересекаются имена: `PlusIcon`, `SearchIcon`, `LockIcon`, `LinkIcon`, `MailIcon`, `PhoneIcon`, `PinIcon`, `CarIcon`, `UploadIcon`, `CheckIcon`, `ChevronRightIcon` — по 2 копии |
| `ui/TabHeader` (старая шапка) / `ui/TabLogo`+`ProfileTopBar` (новая) | см. выше | сосуществуют по ролям |
| `profile.tsx:1199 SectionCard` (локальный, работодатель) / `components/profile/SectionCard.tsx` (соискатель) | оба живые | одинаковое имя, разные пропсы |
| `ErrorBoundary` в `profile.tsx:1458` и `user-profile.tsx:648` | оба живые | копипаст, отличаются шрифтами |
| `MetaBit` в `feed.tsx:513` и `PermApplicationsSheet.tsx:48` | оба живые | копипаст |
| «Аватар»: `getInitials` + `nameColorFromString` собираются вручную в 10 файлах (chat-room×2, chats, matches×4, feed, saved, profile, user-profile, PermApplicationsSheet, ReviewsTabContent, jupiter-application); общего `<Avatar>` нет | | компонент `Avatar`/`NameBubble` убрал бы ≈100 строк стилей |
| `CompanyMark` (общий знак) vs ручные знаки в `matches.tsx:530–536, 711` и `jupiter-application.tsx:387–389` с условием `companyLogo(...) \|\| remoteLogoFor(...) ? <CompanyMark/> : <инициалы>` | | `CompanyMark` уже умеет и то, и другое; ручной код дублирует выбор |

Мёртвые целиком (0 импортёров, включая бочки и тесты):
- `components/LegalLinks.tsx` (63), `components/feature/AboutYouStep.tsx` (191), `components/feature/VacancyDetailHead.tsx` (74), `components/feature/MetroMap.tsx` (564 — вместе с `constants/metroCoords.ts` 253 и `constants/lavkaLogoData.ts`, кроме `YANDEX_MAPS_API_KEY`), `components/ui/DescriptionBlocks.tsx` (79; экран `ext-vacancy.tsx` рисует блоки сам, а тест `description-blocks.test.ts` читает файл по имени), `constants/roleIcons.ts` (35; упомянут только в комментарии `SplashLoader`), `constants/help.ts` (15; константы «часы поддержки» не читает никто, тест `offline_states_test.php` упоминает слово «help»), `services/pay.ts` (30), `components/index.ts` (бочка), `components/profile/edit/index.ts` — НЕ мёртв (его импортируют 22 файла). Подробный перечень экспортов без ссылок — `scratchpad/unused-exports.txt`.

1) Используется: старое — экраны работодателя, `ProfileGateSheet`, `AddressSuggestField`; новое — вход, профиль, фильтры, правка.
2) Legacy: поколение `Colors` + `ui/*` (кроме `ToastLayer`, `ConfirmHost`, `Sheet`, `CompanyMark`, `BackButton`, `JTPullRefresh`, `Chip` на ленте — живые и общие).
3) Уникальная логика: `AppInput` — фокус-рамка и `accessibilityLabel`; `PrimaryButton` — `adjustsFontSizeToFit`; `useSwipeToDismiss` — жест на `PanResponder`, перехват только за ручку; `BottomSheet` — тот же жест + крестик + `height`/`backgroundColor`; `ui/ConfirmDialog` — кнопки столбиком (длинная подпись).
4) Объединить: возможно, но это перекраска старых экранов работодателя, то есть продуктовое решение владельца (его экраны в «старой» теме). RMR.
5) Путь:
   - сначала только безопасное: удалить мёртвые файлы из списка выше (риск низкий; `typecheck`, `lint`, `expo export --platform web`);
   - единые токены: сделать `ProfileColors`/`EditColors` производными от `JT` (`accent: JT.accent` и т.д.), затем выровнять `#FF6A1F`/`#151413`/`#F4EEE5` (видимые на глаз сдвиги ≤1 тона; риск средний — визуальная проверка, правка обновляет макет профиля, решение владельца: «смотри исключительно на этот дизайн»);
   - шрифты: перейти на один набор файлов (оставить пакетные или локальные), заменить `JT_FONT.*`; риск средний (неверное имя шрифта молча даёт системный шрифт; проверять на web и телефоне);
   - `Avatar`, `ErrorBoundary`, `MetaBit`, общая кнопка/шторка: по одному, после мёртвого кода.

---

## 8. Дубль: форматирование (даты, деньги, телефоны)

Даты:
- Названия месяцев в родительном падеже: 5 копий — `services/dayGroups.ts:11`, `services/storage.ts:131`, `services/notifications.ts:217`, `app/chat-room.tsx:135`, `constants/legal.ts:777`. Плюс короткие `MONTHS_SHORT` (`dayGroups.ts:16`).
- «Ключ дня / подпись дня»: `services/dayGroups.ts` (`dayKey`, `dayLabel`, `dayShort`, 2 потребителя: `saved.tsx`, `matches.tsx`) и **отдельные** `dayKey`/`dayLabel` в `app/chat-room.tsx:139, 145` (другие правила: `Сегодня`, год в подписи, ключ без нулей).
- Время сообщения: `chat-room.tsx:887 formatTime` (`HH:MM`), `storage.ts:146 formatChatTime`, `time.ts agoRu` (3 потребителя), `jupiter-application.tsx:49` («27 сент., 12:01»), `mailLinks.ts:46–51`, `NotifBell.tsx:262`, `FilesTabContent.tsx:77, 93`, `ResumeTabContent.tsx:360`, `admin.tsx:178 formatDT`, `analytics.tsx:532`, `mail.tsx:91, 102` — каждое со своим `toLocale…('ru-RU', …)`.
- Остатки смен: `storage.ts` — `formatDate` (2 потребителя, оба «смена» в `matches.tsx`), `localDateStr`, `getVirtualStartDate`, `getTodayDates` (0 внешних ссылок), `getFeedSections`/`saveFeedSections` (0 ссылок), `extractPhoneDigits` (0). `feed.tsx:1979 getTodayISO`.

Деньги: см. раздел 6. Единой функции нет.

Телефоны:
- `components/feature/PhoneInput.tsx` (маска `+7 (XXX) XXX-XX-XX`; потребитель только `components/index.ts` — мёртв), `components/profile/edit/sheets/PhoneSheet.tsx:14–30` (`digitsOf`, `formatDigits`, другая маска `999 000-00-00`), `app/user-profile.tsx:541 formatPhoneRu` (`+7 916 587-08-77`), `services/storage.ts:204–215` (`isPhoneComplete`, `extractPhoneDigits`), `app/(tabs)/profile.tsx:427–428` (сравнение «цифры»), `user-profile.tsx:252`. Правило «11 цифр, ведущая 7 или 8» повторено 4 раза.
- `\D`-чистка цифр — 14 мест (часть относится к возрасту и коду, это нормально).

Метро:
- `constants/metro.ts` (67) — единственный источник станций и веток (хорошо). Но поиск линии по станции `METRO_LINES.find(l => l.stations.includes(...))` и по id — 11 раз в 7 файлах (`feed.tsx:1414`, `perm-vacancy-detail.tsx:141`, `profile.tsx:386, 1090`, `user-profile.tsx:237`, `create-perm-vacancy.tsx:50, 55`, `city-metro.tsx:46`, `MetroMap.tsx:311`).
- Три выбора метро: `components/feature/MetroPicker.tsx` (используют `profile.tsx`, `create-perm-vacancy.tsx`), `app/profile-edit/city-metro.tsx` (свой `ALL_STATIONS`, `:39`), `MetroMap.tsx` (мёртв).
- На сервере те же данные генерируются двумя генераторами в два файла: `infra/gen-metro-php.py`→`php-proxy/metro.php`, `scripts/gen-metro-php.js`→`php-proxy/metro_stations.php` (комментарий в `bot_brain.php:42` ссылается на `.js`). Вне охвата, но источник расхождения: объединить генераторы. RMR: `metro_stations.php` нужен только `bot_brain.php`; Telegram «выведен из контура» (CLAUDE.md) — возможно, мёртв.

1) Используется: все перечисленные.
2) Legacy: `PhoneInput`, смены в `storage.ts`, `pay.ts`.
3) Уникальное: `dayGroups.dayLabel` — заглавные («СЕГОДНЯ»), `chat-room.dayLabel` — «Сегодня» с годом; маски телефона различаются форматом (для поля ввода и для показа).
4) Объединить: да, в `services/format.ts` (чистые функции, тесты node:test): `MONTHS_GEN`, `fmtRub(n, period?)`, `phoneDigits(raw)`, `formatPhoneRu`, `lineForStation`, `lineById` (последние два — в `constants/metro.ts`).
5) Путь: добавить модуль и тест, заменять по одному потребителю; месяцы — первыми (механика). Риск: низкий (чистые функции). Ценность: средняя.

---

## 9. Дубль: хранение сессии разведено по двум модулям

- Токен: `services/db.ts:48–91` (`SESSION_TOKEN_KEY='jm_session_token'`, SecureStore на телефоне, AsyncStorage на вебе, кэш в памяти, миграция со старого места).
- Профиль пользователя: `services/storage.ts:11–29` (`jm_currentUser`, весь объект `User` в AsyncStorage, быстрый старт) — читают `app/_layout.tsx:167` и `AppContext`. `rowToUser` кладёт в объект и `password` (`db.ts:268`; на сервере пароля уже нет по решению 03.10.2026), `phone`, `email`, `personalDetails`.
- Вспомогательные ключи AsyncStorage разбросаны: `jm_c1_*` (кэш), `jt_energy_v1`, `jt_company_logos_v1`, `jm_notifications_disabled`, `jm_notif_prompt_choice`, `jm_ios_home_hint_at`, `jm_guest_*`, `ANON_KEY` и т.д. — 13 мест прямого `AsyncStorage` вне `storage.ts`.

Риск (RMR, `security-review`): открытый кэш профиля рядом с защищённым токеном — тот самый случай, ради которого токен перенесён в SecureStore (`db.ts:45–47`). Профиль содержит телефон, почту, данные резюме. Вывод в этом аудите не делается, нужен отдельный разбор.
Объединение: единый `services/sessionStore.ts` (токен + кэш профиля, `clearAll()` при выходе). Сейчас `logout` чистит их вручную (`AppContext:794–832`). Риск: средний (вход/выход на трёх поверхностях).

---

## 10. Дубль: «Ответы для откликов» и «банк ответов Юпитера»

- `app/profile-edit/apply-answers.tsx` + `lib/applyAnswers.ts` + `components/feature/ApplyAnswersPrompt.tsx`: шесть частых вопросов (дата выхода, английский, переезд, формат, зарплата, Telegram), хранятся в `personal_data.applyAnswers`, подставляются из профиля.
- `app/jupiter-answers.tsx` + `app/jupiter-questions.tsx` + `db.ts jupiterAnswers/jupiterAnswerQuestion`: банк `jm_jupiter_answers` (вопрос→ответ, `question_key`), копится из вопросов работодателей.
Оба питают один агент (`jupiter/remote_tasks.py`), две карточки в настройках, два хранилища. Это пересечение ответственности, а не копипаст. RMR: решение владельца о единой точке («Мои ответы»). Не менять без него.

---

## 11. Мелкие и однозначные находки

1. Мёртвые клиентские обёртки `db*` (0 использований, часть без серверной функции): `dbTelegramAuth`, `dbBindTelegram`, `dbUnbindTelegram`, `dbTgPrepareLink`, `dbSupportSend`, `dbSetEmployerCompany` (на сервере вхождений 0 — вызовы дали бы «неизвестная функция»); `dbGetWorkerTokensByMetro`, `dbGetAllWorkerTokens`, `dbGetWebPushSubscription` (на сервере только админские, клиенту недоступны); `dbCountUsers`, `dbDeleteUser`, `dbResponsivenessMap`, `dbGetExtVacancies`, `dbUpsertVacancy`, `dbUpsertVacancyBatch` (ответ 410), `dbRecordVacancyView`, `dbGetLikesByVacancy`, `dbRemoveLike`, `dbDeleteMatch`, `dbRenameResumeFile`, `dbIncrementUnread`, `dbAddSaved`, `dbRemoveSaved`, `dbFileComplaint`, `dbDeleteVacancy`, `dbGetPermApplicationsForVacancy`, `dbGetSkillResults`, `dbSubmitSkillTest`, `dbGetCrossBorderConsent` + две соседние, `dbGetUserByPhone`. Полный список — `scratchpad/unused-exports.txt` (раздел `services/db.ts`). Удалять вместе с сервером нельзя (PHP зовут тесты и панель); клиентские обёртки можно. Риск: низкий; RMR для тех, что в `tests/*.php` называются по имени (проверить `grep` по `tests/` перед удалением).
2. `AppContext`: пять одинаковых блоков `try {fetch; set; saveCache; markOffline(false)} catch {markOffline(true); throw}` (`refreshVacancies/Likes/Chats/PermVacancies/PermApplications`, `:893–1012`) и два почти одинаковых эффекта опроса (web `:575–640`, native `:645+`). Общий `makeRefresher(key, fetch, set, cacheKey)` убрал бы ≈70 строк. Риск: средний (ядро приложения, без UI-тестов).
3. `services/storage.ts` реэкспортирует `normalizeCompany` из `company.ts`: потребители импортируют двумя путями (`perm-vacancy-detail.tsx`, `MetroMap.tsx` — из storage; остальные из company). Убрать реэкспорт после правки двух импортов. Риск: низкий.
4. `constants/types.ts` + `db.ts`: типы доменов частично определены в `db.ts` (экспорты `MarketingConsent`, `ResumeVaultItem`, `JupiterSavedAnswer`…), потребители импортируют их из сервиса. Это затрудняет разбиение `db.ts`. План: типы в `constants/types.ts`, реэкспорт на время миграции.
5. `energy`: константа `DAILY_ENERGY=10` (`services/energy.ts`) и `JT_DAILY_APPLIES=10` (`php-proxy/energy.php:12`) независимы; сервер решает, клиент — кэш. Намеренно (см. `hooks/useEnergy.ts:21–33`). Не объединять; добавить тест-сторож на равенство. Риск: низкий.
6. `companyLogos`: два слоя логотипов — вшитые 128×128 (`constants/companyLogos.ts`, 308 строк) и серверная карта 256×256 (`services/companyLogoMap.ts`, `dbCompanyLogos`). По замыслу вшитые — резерв без сети (комментарий в `companyLogoMap.ts`). RMR: удалять вшитые только после подтверждения покрытия базой.
7. `services/jupiter*` (6 файлов) — внутри домена Юпитера дублей не найдено; `captchaTaps.ts`/`jupiterCaptcha.ts` — разные задачи. Не трогать.
8. `lib/resumeParser.ts` (364) и `services/resumeImport.ts` (189): чёткое разделение (разбор / выбор файла). Нормально. `lib/profileEdit.ts` (306) — своя логика полей профиля. Нормально.
9. `hooks/`: `useApp` — тонкий реэкспорт контекста; `useMissingUsers` (1 потребитель), `useHydrated` (2), `useSignedMedia` (1) — без дублей.
10. `.claude/worktrees/*` — 10+ полных копий репозитория на диске (в git не входят); для поиска по репозиторию без `--exclude` дают ложные дубли. Не коммитятся, но портят `grep -r`.

---

## Таблица ценности: топ-10 объединений

| № | Дубль | Ценность | Риск | Объём (≈строк) |
|---|---|---|---|---|
| 1 | Прямой `fetch` мимо `proxy()` в `notifications.ts`/`webPush.ts` (+ вероятно сломанная рассылка по новой вакансии, раздел 2) | высокая | низкий (webPush) / средний (рассылка; RMR) | −80 |
| 2 | Мёртвые ветки прямого Supabase в `db.ts` и `IS_NATIVE` (раздел 1) | высокая | низкий (ветки) / средний (realtime в отдельный модуль) | −440 |
| 3 | Заглушка «Уведомлений пока нет» у соискателя при живом `NotifBell` (раздел 5) | высокая (поведение) | низкий; RMR (намеренно ли) | ±50 |
| 4 | Мёртвые файлы: `MetroMap`, `AboutYouStep`, `VacancyDetailHead`, `LegalLinks`, `DescriptionBlocks.tsx`, `roleIcons`, `help`, `pay`, `components/index.ts` + `WebPushBanner` в `feed.tsx` | средняя–высокая | низкий | −1300 (с `metroCoords`, `lavkaLogoData`) |
| 5 | Четыре сценария «включить уведомления» + дубль ключа + двойной вызов регистрации (раздел 3) | средняя | средний | −150 |
| 6 | Пять копий base64/чтения файла (раздел 4) | средняя | низкий–средний | −120 |
| 7 | Два поколения кнопок/полей/чипов/диалогов/шторок/иконок/теней (раздел 7) | средняя | средний–высокий (визуально, решение владельца) | −500 |
| 8 | Месяцы, дни, суммы `₽`, телефон, поиск линии метро (раздел 8) | средняя | низкий | −120 |
| 9 | Токены цвета и шрифтов: четыре набора, дрейф `#FF6A1F`/`#FF6B1A`, два набора файлов Manrope/Unbounded | средняя | средний | −2 файла TTF |
| 10 | Две ветки карточки ленты в `feed.tsx` + общие вычисления; `renderPermDeckCard` возможно недостижима | средняя | средний–высокий; RMR (жива ли ветка своих вакансий) | −260 |

Порядок работ (каждый срез — ветка → PR → зелёный CI → мерж, `docs/круг-работы.md`):
1. Мёртвые файлы и `WebPushBanner` (п. 4): один PR, механика.
2. Ветки Supabase в `db.ts` (п. 2, часть a) + мёртвые обёртки `db*` (раздел 11.1).
3. Проверить и починить `notifyWorkersNewVacancy` (п. 1) вместе с унификацией `fetch`.
4. Решение владельца по п. 3 и разделу 10, затем заглушку уведомлений.
5. Формат-модуль и файловый модуль (пп. 6, 8).
6. Дизайн-система (п. 7, 9) — только после решения владельца по экранам работодателя.
7. Разбиение `feed.tsx` и `db.ts` — последним, на чистой базе.

## Что НЕ является дублем (проверено)
- `services/notificationRoute.ts` — одна таблица на пуш и колокольчик.
- `useEnergy` + `services/energy.ts` + `php-proxy/energy.php` — слои «кэш/логика/решение сервера».
- `vacancyFacets.ts` ↔ `php-proxy/vacancy_facets.php` — паритет охраняется `tests/fixtures/vacancy_facets_cases.json`.
- `MailHtmlView.tsx` / `.web.tsx` — платформенное разделение.
- `services/confirm.ts` + `ConfirmHost` — единственная точка `confirmAsync` для пяти экранов.

Сомнительные места, требующие ручной проверки (сводка): п. 2 (401 у рассылки), п. 3 (`AppContext:419` против `:465`), п. 5 (заглушка уведомлений), п. 6 (живость `renderPermDeckCard`), п. 7 (перекраска экранов работодателя), п. 9 (открытый кэш `jm_currentUser`), раздел 10 (два банка ответов), 11.6 (вшитые логотипы), `metro_stations.php` (нужен ли без Telegram).
