# Аудит 5: критические системы JobToo (цепочки вызовов)

Только чтение, по состоянию рабочего дерева на 03.10.2026. Источник структуры: docs/MAP.md плюс прямая проверка кода.
Условные обозначения: `A -> B` = «A вызывает B». `[UI+сеть]` = в одном файле экран и запросы к серверу.

## 0. Сквозная схема (общая для всех систем)

```
Экран (app/*.tsx, components/*)
  -> useApp() (hooks/useApp.ts = useContext(AppContext))        <- общий кэш + опрос + refresh*
  -> services/<домен>.ts  (тонкие: extSaved, energy, resumeGate, jupiter*, avatarUpload, notifications)
  -> services/db.ts  proxy(fn,args)  = POST {API_BASE}/api/db.php  {fn,args}
        заголовки: X-App-Secret (EXPO_PUBLIC_APP_SECRET), X-App-Version (expoConfig.version),
                   Authorization: Bearer <jm_session_token>  (SecureStore на телефоне, AsyncStorage на вебе)
  -> php-proxy/db.php: CORS -> проверка X-App-Secret (+APP_SECRET_PREV) -> 426 по X-App-Version (app_version.php)
        -> $adminFns (X-Admin-Token) -> проверка сессии (is_blocked, sessions_valid_from) -> $publicFns / 401
        -> $selfArgFns (сверка позиции аргумента с uid сессии) -> switch(case 'имяФункции')
  -> sb_* (php-proxy/sb_lite.php, сервисный ключ) -> Supabase Postgres (jm_* таблицы) / Storage (avatars, resume-files, чат-бакет)
```

Что НЕ идёт этой дорогой (прямые обходы services/db.ts):
- `lib/webPush.ts` — свой `fetch` на `/api/db.php` (fn `dbSaveWebPushSubscription`), берёт только `getSessionToken` из db.ts; нет `X-App-Version`, нет единой обработки 401/ретраев.
- `services/notifications.ts` — `notifyWorkersNewVacancy` шлёт свой `fetch(PROXY_URL)` с `X-App-Secret` БЕЗ `Authorization` и без `X-App-Version` (fn `dbNotifyAllWorkersNewVacancy`). Вызывается только из `app/create-perm-vacancy.tsx:92` (экран работодателя, регистрация работодателей закрыта 03.10.2026).
- `services/db.ts: dbWarmup` — отдельный `fetch` без токена (так задумано, публичная функция).
- Прямой supabase-js: `contexts/AppContext.tsx` (realtime-каналы), `app/chat-room.tsx:510`, `app/(tabs)/profile.tsx:123`, `app/user-profile.tsx:181` (через `getSupabaseClient()` из `template/`), `app/admin.tsx` и `app/analytics.tsx` (прямые `.from('jm_*')` запросы к таблицам). Подробнее в разделе 11.
- Загрузка файлов в Storage — НЕ напрямую (в db.ts комментарии про «ключ из сборки» устарели): всё через `dbUploadFile`/`dbUploadChatMedia`/`dbSaveResumeFile` -> PHP -> Storage.

Размеры: `services/db.ts` 2588 строк (66 упоминаний `IS_NATIVE`, 73 вызова `supabase.` — ВСЕ в мёртвых ветках, т.к. `const IS_NATIVE = true`); `AppContext.tsx` 1110; `feed.tsx` 2885; `matches.tsx` 1898; `chat-room.tsx` 1476; `profile.tsx` 1482; `php-proxy/db.php` 9175. Экранов, импортирующих `@/services/db` напрямую: 24 в `app/`, 11 в `components/`, 3 в `hooks/`, 12 в `services/`+`lib/`.

---

## 1. Регистрация и вход

### Цепочка (почта + код)
```
app/index.tsx (карусель, крестик = гость, кнопки)
  -> /register-worker  app/register-worker.tsx
       -> components/feature/EmailCodeStep.tsx (purpose="register")
            -> db.ts: dbAuthSendCode(email,'register') -> db.php case 'dbAuthSendCode' (auth_email.php: jt_auth_issue_code, mailer.php SMTP) -> jm_auth_codes
            -> db.ts: dbAuthVerifyCode(email,'register',code) -> db.php case 'dbAuthVerifyCode' -> возвращает ticket (подписанная «квитанция», 2 ч)
       -> onVerified(email,ticket) -> finishByEmail()
            -> useApp().registerUser(user, ticket, {marketing})        [contexts/AppContext.tsx]
                 -> storage.ts: getPendingReferral()   (код приглашения из AsyncStorage)
                 -> db.ts: dbUpsertUser(u, referralCode, {stamp,docs,marketingVersion}, emailTicket)
                      -> db.php case 'dbUpsertUser' (публичная; ticket 'register' обязателен; employer -> 403; клиент сам генерит id = storage.uid())
                           -> jm_users upsert; jt_referral_attach; jt_consent_attach; jt_session_issue -> {session_token}
                      -> saveSessionToken() в SecureStore (db.ts)
                 -> void dbCompleteGuestRegistration(); void dbRecordConsent(...,'registration')   (дублирует согласие, уже ушедшее в dbUpsertUser)
                 -> saveSessionUser() (AsyncStorage jm_currentUser), registerForPushNotifications через 2 с, refresh* через 300 мс
app/login.tsx -> EmailCodeStep(purpose="login", verify=...) -> db.ts: dbAuthLoginByCode -> dbAuthVerifyCode(...,'login') -> {user, session_token}
              -> useApp().signInAs(user) -> router.replace('/(tabs)')
Старые аккаунты по телефону: components/EmailRequiredGate.tsx (в app/_layout.tsx) -> EmailCodeStep('attach') -> db.ts: dbAuthAttachEmail(ticket) -> useApp().adoptUser(updated)
Восстановление сессии при запуске: AppContext boot() -> storage.getSessionUser() -> db.ts: dbRestoreSession() -> db.php 'dbSession' (jt_self_user)
Протухшая сессия: db.ts proxy() 401 + был токен -> saveSessionToken(null) -> sessionExpiredHandler (регистрируется в AppContext) -> logoutRef.current()
```

### Особые пути
- **Телефонный запасной путь: в клиенте мёртв.** Регистрация/вход по телефону и паролю удалены 03.10.2026 (MAP, шапка раздела «Вход по почте»; сервер `dbUpsertUser` без квитанции отвечает 400 «Подтверждение почты устарело»). Остатки: `db.ts: dbGetUserByPhone` (экспорт без вызовов из экранов), `dbSetContactPhone` (телефон «для связи», `PhoneSheet`, `profile.tsx:429`), флаг `emailAuthReady` (AppContext, `dbAuthConfig`) всё ещё гейтит `EmailRequiredGate` и `CompleteProfileSheet.emailPending`. Раздел MAP про «регистрацию по телефону / 7 шагов / reset-password / hasPassword» — историческая часть, часто противоречит шапке; опираться на шапку.
- **Тестовый вход рецензента: только сервер.** `php-proxy/auth_email.php: jt_review_fixed_code()` — для одного адреса из секретов `REVIEW_LOGIN_EMAIL`/`REVIEW_LOGIN_CODE` код фиксирован (цели login и register). Клиентского кода нет: рецензент вводит почту и код в обычный `EmailCodeStep`. Секреты ставятся через GitHub Secrets -> `deploy-regru.yml` -> `deploy.php`.
- **Гостевой режим: только клиент + анонимные события.** `app/index.tsx: enterAsGuest()` -> `dbRecordGuestEvent('guest_started')` + `useApp().enterGuest()` (синтетический `User{id:'guest', isGuest:true}` в памяти, НЕ пишется в сессию) -> `/(tabs)`. Гейты по `isGuest`: `feed.tsx` (`promptRegister` -> `dbStartGuestRegistration`, `exitGuest()`, `router.replace('/')`), `GuestGate.tsx` (профиль/отклики), `ConsentGate` (гостю не показывается), AppContext (`touch`, опросы пропускают гостя). Публичные функции для гостя: `dbGetExtFeed`, `dbCountExtFeed`, `dbCompanyLogos`, `dbGetVacancies`, `dbGetPermVacancies`, `guestEvent`.
- **Согласия при регистрации:** `components/feature/ConsentChecks.tsx` (две обязательные галки + реклама) -> передаются в `registerUser` -> `dbUpsertUser`.

### Где бизнес-логика
- Сервисный слой: `services/db.ts` (токен, proxy, rowToUser/userToRow), `services/storage.ts` (uid, сессия-кэш, реферал). Оркестрация входа/регистрации/выхода — в **AppContext** (`registerUser`, `signInAs`, `adoptUser`, `logout`, boot-эффект), а не в сервисе.
- UI + сеть смешаны: `register-worker.tsx` (генерит `id`, собирает `User`, зовёт `registerUser`; разбор ошибки по regexp `/почт/i` на русском тексте сервера для возврата на шаг почты), `login.tsx` (зовёт `dbAuthLoginByCode` прямо из экрана и `signInAs`), `EmailCodeStep` (прямые `dbAuthSendCode/VerifyCode`).

### Неочевидные зависимости
- `ConsentGate` (корневой layout) пишет в контекст `setConsentPending`, а `CompleteProfileSheet` (внутри `(tabs)`) читает `consentPending`/`emailAuthReady` — порядок «согласие -> почта -> профиль» держится на флагах в AppContext, а не на явной очереди.
- Идентификатор нового пользователя рождается на клиенте (`uid()`), сервер проверяет формат (`jt_new_user_id_is_valid`); тест `tests/user_id_contract_test.py`.
- `registerUser` и `dbUpsertUser` оба записывают согласие (в теле и отдельным `dbRecordConsent`) — дублирование намеренное («запись — доказательство»), не «чистить».
- Логика ветвится по русскому тексту ошибок сервера (`humanServerError` пропускает кириллицу как есть; экраны матчат `/почт/`, `/уже есть/`).

### НЕЛЬЗЯ трогать
- Порядок в `registerUser`: `getPendingReferral` до записи, `clearPendingReferral` сразу после; `dbUpsertUser` ПЕРЕД `_setCurrentUser`; токен сохраняется из ответа `dbUpsertUser` внутри db.ts.
- В `proxy()`: различие «401 с токеном» (разлогин) и «401 без токена» (гость, не выкидывать); один повтор при не-JSON, кроме 502/503/504; `id` сообщения/ключ повтора создаются ДО `proxy()` (идемпотентность, см. `dbInsertMessage`).
- Миграция токена `AsyncStorage -> SecureStore` в `readToken()`: убрать = разлогинить всех.
- Android: ретрай чтения сессии 3×200 мс в boot (AsyncStorage иногда отдаёт null рано).
- Версия/секрет: `X-App-Secret`, `X-App-Version` на каждом запросе; сервер отвечает 426 на `< JT_MIN_APP_VERSION`.

---

## 2. Профиль (редактирование, аватар, Storage)

### Цепочка
```
app/(tabs)/profile.tsx (1482 стр.)  [UI+сеть+логика]
  -> useApp().currentUser / updateUser(u)
        -> db.ts: dbUpsertUser(u) -> db.php 'dbUpsertUser' (для существующего: PATCH белого списка $editable) -> jm_users
        -> setUsers, saveSessionUser (кэш) — ПОСЛЕ подтверждения сервера
  -> components/profile/* (ProfileHeader, ResumeTabContent, PersonalTabContent, FilesTabContent, ReviewsTabContent)
  -> app/profile-edit/*.tsx (18 экранов) -> lib/profileEdit.ts (patchResume/patchPersonal, mergeSelfUser) -> updateUser(next)
  -> services/resumeImport.ts (pickAndImportResume, extractResumePdf, mergeResumeIntoUser) + lib/resumeParser.ts
        -> db.ts: dbSaveResumeFile/dbGetResumeFiles/dbSelectResumeFile/dbSignResumeFile -> jm_resume_files + Storage bucket resume-files (приватный)
  -> services/resumeGate.ts (ensureResumeForApply: dbGetResumeFiles + кэш 10 мин) <- forgetResumeCheck() вызывает profile.tsx
Аватар:
  profile.tsx / components/CompleteProfileSheet.tsx
    -> services/avatarUpload.ts: uploadAvatar(uri,userId)  (ImageManipulator: квадрат 600x600 JPEG; web: fetch(blob), native: FileSystem.readAsStringAsync base64)
    -> db.ts: dbUploadFile('avatar_<uid>.jpg', bytes, 'image/jpeg') (bytesToBase64 вручную)
    -> db.php 'dbUploadFile' (имя только своё, getimagesizefromstring сверяет тип, лимит 25 МБ) -> curl POST SB_URL/storage/v1/object/avatars/<name> (x-upsert)
    -> URL публичного бакета + '?t=Date.now()' -> updateUser({avatarUrl})
Файлы чата: chat-room.tsx -> db.ts: dbUploadChatMedia -> db.php 'dbUploadChatMedia' (закрытый бакет) ; показ: hooks/useSignedMedia -> dbSignMedia (подпись на час, кэш 59 мин)
Сертификат: app/profile-edit/certificate.tsx -> dbSaveCertificateFile/dbSignCertificateFile (resume-files/certificate/<uid>/...)
```

### Где логика
- Чистое/тестируемое: `lib/profileEdit.ts`, `lib/applyAnswers.ts`, `lib/resumeParser.ts` (тест `tests/resumeParser.test.ts`), `services/avatarUpload.ts` (уже вынесено из экрана: «раньше жило в профиле»).
- UI+сеть смешаны: `profile.tsx` (RatingsModal с `dbGetRatingsForUser` и прямой подпиской supabase, PhoneSheet-логика `dbSetContactPhone`, `dbGetConsent`, `dbGetResumeFiles`, редактирование полей и удаление аккаунта), `profile-edit/certificate.tsx` и `basic.tsx` (прямо `updateUser`).
- Прямые обходы: realtime-канал `ratings:<id>` через `getSupabaseClient()` на вебе (profile.tsx:123, user-profile.tsx:181).

### НЕЛЬЗЯ трогать
- `mergeSelfUser` в `refreshUsers`: публичная проекция `dbGetUsers` без `personal_data`/телефона/почты; без слияния следующий `updateUser` стирает их на сервере.
- В `userToRow` нет `telegram_id`, `avg_rating`, `score*` — сервер защищает, клиент не должен их слать; пустой `password` удаляется из тела.
- `updateUser`: сервер сначала, потом локальное состояние (иначе при сетевой ошибке UI врёт).
- `avatarUpload`: ветка web/native чтения файла; обязательная проверка исключения (иначе в профиль запишется адрес несуществующего файла); имя файла строго `avatar_<authUid>.jpg` — сервер иначе откажет.
- `app/profile-edit/_layout.tsx` не пускает пока `loading` (экраны берут начальные значения один раз).
- `PUBLIC_USER_COLUMNS`/`USER_PUBLIC_COLS`: `resume_data` публичен, `personal_data`/`resume_email` — нет (тесты `profile_privacy_test.php`, `read_authz_test.php`).

---

## 3. Вакансии и лента (career feed, колода, закладки, поиск, фильтры)

### Цепочка
```
app/(tabs)/feed.tsx -> HomeScreen (роль) -> WorkerPermMode (колода) | EmployerHome | WorkerCareer
  WorkerPermMode [UI+сеть+логика, ~1200 строк в одной функции]:
    useApp(): permVacancies, permApplications, updateUser, permSavedIds, optimistic*, backendOffline
    filters:  services/feedFilterStore.ts (useSyncExternalStore: applied/draft/query)  <- app/filters/*.tsx (6 экранов) пишут; feed читает
              services/feedFilters.ts (toExtFeedFilters), services/vacancyFacets.ts, components/filters/kit
    поиск:    FeedSearchHeader -> searchText -> 400 мс -> searchQuery -> setFeedQuery + filtersKey
    карьерные: db.ts: dbGetExtFeed(60, filters) -> db.php case 'dbGetExtFeed' (7075) -> php-proxy/ext_feed.php (ext_feed_arrange) -> RPC jm_ext_feed_pool (миграции 112/120/121/134)
    свои:     AppContext permVacancies (dbGetPermVacancies / ByEmployer) ; свайпы: dbGetPermSwipes/dbPermSwipe/dbPermUnswipe
    колода:   services/feedMix.ts (interleaveDeck, rankOwn, sectionOfPerm) + hooks/useSwipeDeck.ts (Gesture + Reanimated, ворклеты)
    закладки: services/extSaved.ts (модульное хранилище + useSyncExternalStore) -> dbGetExtSaved/dbAddExtSaved/dbRemoveExtSaved (jm_ext_saved) ;
              свои вакансии: dbAddPermSaved/dbRemovePermSaved + AppContext.permSavedIds/optimistic*
    молнии:   hooks/useEnergy.ts + services/energy.ts (чистая логика) + db.ts: dbEnergyLeft (php-proxy/energy.php)
    подробнее: services/extVacancyHandoff.ts (openExtVacancy / setDeckAction / takeDeckAction) -> app/ext-vacancy.tsx ; фокус feed.tsx: useFocusEffect -> swWantRef/swSkipRef
    свайп вправо (swWant) -> energy.spendOne -> swFly -> ensureResumeForApply (services/resumeGate -> ProfileGateHost) -> sendExtApply -> jupiterEnqueue (см. п.4)
    свайп влево (swSkip) -> dbExtSwipe(-1) | dbPermSwipe(-1)
    свои отклики -> applyTo -> ApplySheet -> sendPermApply -> dbApplyPermVacancy (+ dbCreateChat в соседних местах)
Закладки-экран: app/saved.tsx -> dbGetPermSavedDetailed + useExtSaved
Детали своей вакансии: app/perm-vacancy-detail.tsx (публичный маршрут, hideAsync в effect)
Публикация: app/create-perm-vacancy.tsx (экран есть, регистрация работодателей закрыта -> почти мёртв) -> dbUpsertPermVacancy + notifyWorkersNewVacancy
```
Данные ленты в AppContext: `vacancies` (смены, только история), `permVacancies`, кэш в AsyncStorage (`CACHE_KEYS`), опрос по таймеру, `offline` по ключам.

### Где UI смешан с сетью
- `feed.tsx` — главное место: 21 импортированная db-функция прямо в экране; решения (энергия, резюме, гость, автоприменение, отмена и «вернуть») живут в замыканиях внутри `WorkerPermMode`; состояние `careerVacancies/careerTotal` локально, а не в сервисе. Сервисные куски вынесены только частично (`feedMix`, `feedFilterStore`, `extSaved`, `energy`, `resumeGate`, `extVacancyHandoff`).
- Чистые, тестируемые в node: `feedMix.ts`, `feedFilters.ts`, `vacancyFacets.ts`, `energy.ts`, `matching.ts`, `matchCounts.ts`, `dayGroups.ts`, `descriptionBlocks.ts`, `profileGateDecision.ts`, `notificationRoute.ts`, `captchaTaps.ts`, `jupiterTimeline.ts`.

### Неочевидное
- Состояние между экранами передаётся через МОДУЛЬНЫЕ ГЛОБАЛЫ (`feedFilterStore`, `extSaved`, `extVacancyHandoff.opened/pending`, `resumeGate.gateOpener/resumeOkUntil`, `notifications.activeChatId`, `jupiterLive`), не через контекст. Они не сбрасываются при logout само по себе (кроме `resetExtSaved`) — риск утечки состояния между аккаунтами на одном устройстве.
- `feed.tsx` ссылается на себя через ref-ы (`swWantRef.current = swWant` на каждый рендер) — нужно для хука `useSwipeDeck`, который создаётся до объявления функций.
- Серверный «Всего N» и список компаний считаются отдельным лёгким вызовом (`p_per_company => 5000`), `dbGetExtFeed` принимает и голый массив от старого сервера.
- Подсчёт молний решает сервер (`jt_energy_require` в `jupiterEnqueue` и `dbApplyPermVacancy` -> 429 `ENERGY_EMPTY`); клиентский счётчик — для мгновенной шапки.

### НЕЛЬЗЯ трогать
- 12 PHP/MJS-тестов читают исходник `feed.tsx` по подстрокам (`swipe_energy_test`, `swipe_card_test`, `card_scroll_test`, `it_only_feed_test`, `ext_saved_test`, `feed_sections_wiring_test`, `career_work_type_test`, `stats_scope_test`, `message_notify_test`, `offline_states_test`...). Разбиение `feed.tsx` на файлы сломает их — править тесты в том же PR.
- Android: `zIndex` вместе с `elevation` (feed.tsx:2421–2473 — «elevation важнее zIndex», кнопки колоды иначе перекрываются); `useSwipeDeck` на gesture-handler+reanimated (не возвращать PanResponder: комментарий в `chats.tsx` про захват касания); `touchAction='pan-y'` для вебa.
- Все хуки колоды объявлены ДО раннего return (комментарий в feed.tsx ~944) — порядок хуков; переносить эффекты только вместе.
- Свайп влево записывается на сервер сразу, а свайп вправо `dbExtSwipe(+1)` — ТОЛЬКО после успешного `jupiterEnqueue` (иначе сервер спрячет вакансию без отклика); при сбое `energy.refundOne()` + `swLastSkipped`.
- Пустой `feedLocked` (молнии кончились) не должен закрывать гостей.

---

## 4. Отклик и автоотклик Jupiter (часть приложения)

### Цепочка
```
Свайп вправо по карьерной карточке (feed.tsx: sendExtApply)
  -> db.ts: jupiterEnqueue(userId, url, company) -> db.php 'jupiterEnqueue' (7723)
       проверки: выбранное резюме (jm_resume_files.selected), JUPITER_MAIL_VERIFIED, jt_energy_require
       -> jm_jupiter_applications (state='action_required', reason_code='PHONE_FILL')  (+ rt_touch сигнал)
Список/статусы: matches.tsx (WorkerMatches) -> jupiterMyApplications, jupiterQuestions, jupiterMailUnread
Карточка отклика: app/jupiter-application.tsx -> jupiterApplicationEvents, jupiterLiveState, jupiterGrantThirdPartyConsent, jupiterRequeueLive,
                  jupiterMarkManualSubmitted, jupiterFillProfile ; services/jupiterTimeline.ts (статусы/бейджи — чистое), services/jupiterLive.ts (requestJupiterLive: confirm + jupiterSetLive/jupiterMailbox)
Заполнение «Ждут вас»: app/jupiter-fill.tsx [WebView]
   -> jupiterFillProfile (+ loadResumeBase64 по подписанной ссылке, ≤8 МБ, fetch->FileReader)
   -> services/jupiterAutopilot.ts buildAutopilotScript (строка JS, AUTOPILOT_CORE) + services/jupiterFill.ts (FILL_CORE, fillHostFor, isOtherVacancy, jupiterManualEligible)
   -> WebView injectedJavaScript / onMessage (AutopilotResult) / onShouldStartLoadWithRequest (не пускает на чужую вакансию)
   -> jupiterFieldHints(host, fields) -> db.php 'jupiterFieldHints' -> YandexGPT (php-proxy/jupiter_field_hints.php) — только подписи полей
   -> "Отправить отклик" = SUBMIT_BY_USER_SCRIPT (window.__jtSubmit, нажимает человек) -> jupiterMarkManualSubmitted
Капча: app/jupiter-captcha.tsx -> services/jupiterCaptcha.ts (обёртка над db.ts jupiterCaptchaGet/Answer/Refresh) + services/captchaTaps.ts
Вопросы работодателей: app/jupiter-questions.tsx -> jupiterQuestions/AnswerQuestion/SkipQuestion ; app/jupiter-answers.tsx -> jupiterAnswers/AnswerDelete ; services/jupiterQuestions.ts
Почта JobToo: app/mail.tsx -> jupiterMailbox/MailList/MailHtml/MailRead ; services/mailLinks.ts
"Ответьте один раз": components/feature/ApplyAnswersPrompt + lib/applyAnswers.ts (хранится в user.personalDetails)
Серверный воркер (jupiter/*.py, Python) -> db.php admin-функции (jupiterLease, jupiterHeartbeat, jupiterCheckpoint, jupiterFinish, jupiterGetCandidateProfile,
   jupiterSubmitGuard, jupiterMailIngest, jupiterRequeueSiteReady, jupiterCaptchaPost/Poll/Result) с X-Admin-Token — вне клиента.
```
Таблицы: `jm_jupiter_applications`, `jm_jupiter_events` (триггер), `jm_jupiter_questions`, `jm_jupiter_mailboxes`, `jm_jupiter_retired_addresses`, `jm_resume_files`.

### Где логика
- В сервисах чисто: `jupiterAutopilot.ts`, `jupiterFill.ts`, `jupiterTimeline.ts`, `jupiterQuestions.ts`, `captchaTaps.ts` — тестируются в node/vm (`tests/jupiterAutopilot.test.ts`, `jupiter-fill.test.ts`, `jupiter-timeline.test.ts`, `captcha-taps.test.ts`).
- `jupiter-fill.tsx` [UI+сеть]: загрузка профиля+заявок+резюме, жизненный цикл WebView, подсказки, отметка «отправлено» — всё в экране. `jupiter-application.tsx` — действия (согласие, requeue, ручная отправка) в экране.
- Обёртки-«прокладки»: `jupiterCaptcha.ts`, `jupiterLive.ts` — тонкие, дублируют сигнатуры db.ts (`jupiterCaptchaGet` объявлена и в db.ts:2502, и в jupiterCaptcha.ts — проверить, что экран импортирует из нужного места).
- Тип `JupiterFillProfile` определён в `services/db.ts`, на него ссылаются `jupiterFill.ts`/`jupiterAutopilot.ts` через `import type` (чтобы node-тесты не тянули RN). Это «ЗАВИСИМОСТЬ ВВЕРХ»: нижний чистый слой знает о типе из верхнего сетевого.

### НЕЛЬЗЯ трогать
- `services/jupiterAutopilot.ts` импортирует `./jupiterFill.ts` с РАСШИРЕНИЕМ `.ts` и относительным путём (для `node --experimental-strip-types`) — не переписывать на `@/`.
- Скрипты — СТРОКИ (в Hermes `Function.toString()` не отдаёт исходник); `AUTOPILOT_CORE` — зеркало `jupiter/candidate.py` (`jtConsentDecision`); править обе стороны.
- Инварианты Jupiter: CAPTCHA не обходится; не ставить галочки рекламы/кадрового резерва/третьих лиц/трансграничной/особых категорий; не выдумывать ответы; «Отправить» нажимает человек (`window.__jtSubmit`); `unknown` — без повторной отправки.
- `isOtherVacancy`/`onShouldStartLoadWithRequest`: иначе автопилот бесплатно заполнил бы анкеты соседних вакансий.
- `jupiterEnqueue` повтором возвращает существующую заявку и не тратит молнию; не делать «умный» повтор на клиенте.
- Нет `jupiter-*` маршрутов в `Stack.Screen` списке `_layout.tsx` (они работают по умолчанию expo-router) — в `AuthGuard.publicPaths` их тоже нет, что верно (нужен вход).

---

## 5. Чат и сообщения

### Цепочка
```
Список: app/(tabs)/chats.tsx (скрытая вкладка href:null; открывается конвертом в «Откликах»)
   -> useApp().chats (AppContext.refreshChats -> db.ts dbGetChats -> db.php 'dbGetChats' (selfArg) -> jm_chats + jm_messages)
   -> свайп-удаление: Gesture.Pan (RNGH+Reanimated) -> dbDeleteChat
Комната: app/chat-room.tsx (1476 строк) [UI+сеть+логика]
   -> dbGetChatById, dbGetMessages (опрос POLL_INTERVAL + сигнал), dbMarkRead, dbInsertMessage(chatId,senderId,text) (id создаётся до proxy)
   -> dbGetLikeByVacancyWorker / dbUpsertLike / dbCheckAndCreateMatch / dbSetPermApplicationStatus  (решения работодателя прямо в комнате)
   -> фото: expo-image-picker + ImageManipulator + FileSystem -> dbUploadChatMedia -> путь -> dbInsertMessage(IMG_PREFIX+path)
   -> голос: expo-audio (useAudioRecorder/useAudioPlayer) native | services/webVoice.ts на вебе -> dbUploadChatMedia -> VOICE_PREFIX
   -> показ медиа: hooks/useSignedMedia -> dbSignMedia
   -> realtime: getSupabaseClient().channel(`chat:${chatId}`).on('broadcast','refresh', pollRef.current)   <- сервер шлёт «обнови» без данных
   -> services/notifications.ts: setActiveChat(chatId) (глушит баннер для открытого чата)
   -> services/presence.ts (был в сети), services/messagePreview.ts, constants/chatSuggestions
Создание чата: dbCreateChat (из feed/matches/chat) -> db.php (chat_ensure; jt_notify_new_message для первого сообщения)
Серверное уведомление: dbInsertMessage -> jt_notify_new_message -> push_privacy.php -> Expo Push (нейтральный текст) + jm_notifications
```
Таблицы: `jm_chats`, `jm_messages`, `jm_likes`, `jm_perm_applications`, Storage (закрытый чат-бакет).

### Особенности
- Три канала доставки одновременно: опрос по таймеру, broadcast-сигнал (supabase realtime channel `chat:<id>`, а также общие `jt` и `jt:u:<uid>` в AppContext) и push. Сигнал не несёт данных — всегда перечитывается через db.php (пропуск проверяется).
- Realtime-клиент (`template/core/client.ts`, `@ts-nocheck`) — второй синглтон Supabase-клиента рядом с `lib/supabase.ts` (на вебе); см. раздел 11.

### НЕЛЬЗЯ трогать
- Идемпотентность `dbInsertMessage` (id до `proxy()`, ретрай использует те же args).
- Метки `[img]`/`[voice]` в текстовой колонке (`IMG_PREFIX/VOICE_PREFIX`, `messagePreview.ts` синхронен с `jt_message_preview` в PHP).
- Опрос — подстраховка, не убирать вместе с realtime (в РФ Supabase websocket может быть заблокирован).
- Уведомление о сообщении собирает ТОЛЬКО сервер; клиент больше не шлёт тексты (admin-only `tgNotifyUser`, `sendPushNotification`).
- Тесты читают `chat-room.tsx` и `chats.tsx` по тексту (`chats_swipe_test.php`, `offline_states_test.php`, `chat_match_refresh_test.py`).

---

## 6. Matching и «Отклики»

### Цепочка
```
app/(tabs)/matches.tsx (1898 строк)  -> MatchesScreen -> WorkerMatches | EmployerMatches
  WorkerMatches:
    useApp(): likes (смены, история), permApplications, chats, permVacancies, refreshAll ...
    + Jupiter: jupiterMyApplications, jupiterQuestions, jupiterMailUnread  (прямо в экране, useFocusEffect)
    + services/matchCounts.ts (workerLikes/workerActive/... матчбейдж; matchBadgeCount используется и в (tabs)/_layout.tsx)
    + services/jupiterTimeline.ts (jupiterBadge, jupiterRowSummary, jupiterNeedsCaptcha) + services/jupiterFill.ts (jupiterManualEligible)
    + services/dayGroups.ts (группировка по дням), useMissingUsers
  EmployerMatches (унаследован, смены закрыты):
    dbUpsertLike, dbCheckAndCreateMatch, dbSetShiftOutcome, dbApprovePermApplication, dbSetPermApplicationStatus; services/matching.ts (rankCandidate, scoreVacancyForWorker)
AppContext: refreshLikes (dbGetLikesForUser), refreshPermApplications (dbGetPermApplications), refreshVacancyStats (dbGetVacancyStatsMap)
Сервер: 'dbUpsertLike' / 'dbCheckAndCreateMatch' / 'dbApplyPermVacancy' / 'dbApprovePermApplication' -> jm_likes, jm_perm_applications, jm_chats ; jt_notify_match
```
- Слово «matching» в двух смыслах: (1) услуга `services/matching.ts` (ранжирование кандидатов для работодателя — по сути мёртво после закрытия смен/работодателей), (2) экран «Отклики» (сборник Jupiter-заявок + заявок на свои вакансии). Бейдж на вкладке = `matchBadgeCount + unreadCount` в `(tabs)/_layout.tsx`.
- Логика экрана: `matches.tsx` — один из самых «грязных» файлов: UI, сетевые вызовы Jupiter, работодательские транзакции и дедупликация в одном модуле. Чистые куски вынесены в `matchCounts`, `jupiterTimeline`, `dayGroups`.

### НЕЛЬЗЯ трогать
- Тесты `perm_app_test.php`, `like_authz_test.php`, `mail_unread_dot_test.php`, `offline_states_test.php` читают `matches.tsx`.
- Признак `offline.permApplications` и `offlineHere` — «нет связи» вместо «нет заявок» (иначе человек решит, что его отклик пропал).
- Порядок для «Нужны вы»: `jupiterBadge(a).tone === 'needs_you'` (включая согласие Сбера).

---

## 7. Уведомления

### Цепочка
```
Регистрация токена (native, Expo Push, НЕ Firebase SDK):
  AppContext boot / registerUser / signInAs -> services/notifications.ts: registerForPushNotifications(userId)
     -> expo-notifications getExpoPushTokenAsync({projectId from expoConfig.extra.eas.projectId})
     -> db.ts: dbSavePushToken -> db.php 'dbSavePushToken' (selfArg) -> jt_push_encrypt (php-proxy/push_privacy.php: 'jtenc1.' шифрование) -> jm_users.push_token
  Запрос разрешения: components/NotificationPermissionSheet.tsx (из (tabs)/_layout) -> Notifications.requestPermissionsAsync -> registerForPushNotifications | lib/webPush.ts registerWebPush
  Настройки: app/profile-settings.tsx (включить/выключить: NOTIFICATION_DISABLED_KEY, dbClearPushToken, dbDeleteWebPushSubscription, диагностика getPushRegisterDebug/getWebPushDebug)
  Выход: AppContext.logout -> dbClearPushToken (native) / dbDeleteWebPushSubscription (web)
  Запуск без входа: releasePushTokenIfSignedOut -> dbReleasePushToken (см. замечание ниже)
Web push: lib/webPush.ts (VAPID public key, Service Worker public/sw.js 'push'/'notificationclick', fetch напрямую dbSaveWebPushSubscription)
Отправка (всё на сервере): db.php jt_notify_* / jt_expo_send (push_privacy.php) -> jt_push_prepare_expo_message (нейтрализует текст по JT_PUSH_EVENTS) -> Expo Push API -> FCM (Android) / APNs (iOS)
   + запись в jm_notifications (полный текст) ; Telegram-зеркало
Приём:
  app/_layout.tsx: Notifications.setNotificationHandler в services/notifications.ts (глушит баннер для открытого чата через activeChatId)
  app/_layout.tsx NotificationHandler: addNotificationResponseReceivedListener + getLastNotificationResponseAsync
     -> нет сессии (getSessionUser) -> router.push('/')
     -> type==='refresh' -> dbGetNotifications(user.id) -> services/notificationRoute.ts: routeForRefreshPush
     -> иначе routeForNotification(type,{chatId})
Колокольчик: components/ui/NotifBell.tsx (в TabHeader/профиле)
   -> dbGetNotifications / dbMarkNotifRead / dbMarkAllNotifsRead / dbDeleteNotif / dbDeleteAllNotifs
   -> routeForNotification(n.type, n.payload) || routeByTitle(n.title) -> router.push
   (счётчик в AppContext: refreshNotifications -> dbGetNotifications; ВНИМАНИЕ: маппинг в AppNotification теряет type/payload — маршрут берёт сам NotifBell из своего запроса)
Каналы Android: setupAndroidChannels (messages, matches, vacancies, default) — вызывается из _layout.tsx
```

### Firebase / FCM в клиенте
- **Пакетов firebase в package.json нет** (`grep firebase` по исходникам — только `google-services.json`). Клиент использует ТОЛЬКО `expo-notifications` + Expo Push; `getDevicePushTokenAsync` не используется.
- `google-services.json` лежит в корне и подключён через `app.json: android.googleServicesFile` (проект `jobtoo-266b7`, пакет `com.jobtoo`). Он нужен сборке (FCM-ключи для Expo Push на Android), тест `tests/google_services.test.mjs` проверяет совпадение пакета. Это конфиг, а не код; в нём лежит `current_key` (API key клиентский — штатно).
- Следовательно, «убрать Firebase» из клиента = убрать `google-services.json`, т.е. пуши на Android перестанут работать. Заменяемо только при отказе от Expo Push.

### Где UI смешан с сетью
- `_layout.tsx: NotificationHandler` ходит в `dbGetNotifications` напрямую; `NotifBell`, `NotificationPermissionSheet`, `profile-settings.tsx` вызывают `db*`, регистрацию токена и AsyncStorage сами.
- Дубль: ключ `jm_notif_prompt_choice` объявлен и в `NotificationPermissionSheet.tsx` (экспорт), и в `profile-settings.tsx:34` отдельной константой.

### Прямые обходы
- `notifyWorkersNewVacancy` (см. раздел 0) и `lib/webPush.ts` — свой fetch мимо `proxy()`.
- Подозрение (проверить на проде): `dbReleasePushToken` НЕ в `$publicFns`, а `releasePushTokenIfSignedOut` вызывается именно когда нет сессии -> сервер вернёт 401 «Authentication required» (клиент: «Для этого действия нужна регистрация», проглатывается `.catch`). Уборка токенов у вышедших не работает; серверный кейс требует `$authUid`.

### НЕЛЬЗЯ трогать
- `push_privacy.php`: нейтральные тексты и `JT_PUSH_EVENTS` (ключи совпадают с `services/notificationRoute.ts` — менять парами); шифрование токена `jtenc1.` и `jt_push_lookup_pattern`.
- Пуш `{type:'refresh'}` — маршрут выбирается по самому свежему непрочитанному; fallback `/(tabs)/matches`.
- Нет сессии -> `router.push('/')`, иначе чат падает.
- `Notifications.setNotificationHandler` на уровне модуля `notifications.ts` — должен импортироваться при старте (его тянет `_layout.tsx` через `setupAndroidChannels`).
- `getExpoPushTokenAsync` требует `projectId` из `extra.eas.projectId`.
- Тесты: `notify_authz_test.php`, `notify_defer_test.php`, `message_notify_test.php`, `web_push_test.php`, `notificationReadTruth.test.ts`.

---

## 8. Force update / проверка версии / OTA

### Цепочка
```
Клиент -> сервер: services/db.ts APP_VERSION = Constants.expoConfig.version ('1.0.0') -> заголовок X-App-Version в КАЖДОМ запросе proxy() и в dbWarmup
Сервер: php-proxy/app_version.php: JT_MIN_APP_VERSION='1.0.0'; jt_app_version_too_old(header) -> db.php:168 jt_respond({'error':'Эта версия приложения устарела — установите свежую версию JobToo'}, 426)
   нет заголовка = клиент 1.4.0 / дашборд / бот -> не трогаем; мусор -> не трогаем
Клиент при 426: ОТДЕЛЬНОГО ЭКРАНА «обновите» НЕТ. proxy(): parsed.error есть -> humanServerError (кириллица проходит) -> throw Error(текст) -> показывается тостом/плашкой там, где экран ловит ошибку. Бесконечные циклы не создаются, но и принудительного блока нет.
OTA (expo-updates):
   app.json: runtimeVersion {policy:'appVersion'}, updates.url = https://u.expo.dev/<projectId>, requestHeaders expo-channel-name: production
   app/_layout.tsx: useOTAUpdates() -> checkAndApplyUpdate() на старте и при AppState 'active':
        Updates.checkForUpdateAsync -> fetchUpdateAsync -> reloadAsync()  (немедленная перезагрузка посреди сессии; dev и web пропускаются)
   app/profile-settings.tsx: ручное «Очистить кэш и обновить»: clearRuntimeCache -> Updates.check/fetch/reloadAsync ; web — снятие SW + _jt_refresh
   .github/workflows/eas-update.yml: push в main (кроме docs/**, *.md, infra/ingest-now, data/company-logos/**, video/** ...) -> `eas update --channel production`
        env EXPO_PUBLIC_* берутся из GitHub Secrets и ВШИВАЮТСЯ в бандл; concurrency group production-eas-update (cancel-in-progress)
   .github/workflows/eas-build.yml: ручная/тег build-* нативная сборка (нативные модули, иконка, сплэш, разрешения)
   php-proxy/expo-updates-proxy.php: прокси манифеста/ассетов (u.expo.dev, assets.eascdn.net) для РФ — app.json 1.0.0 указывает прямо на u.expo.dev; прокси относится к старой сборке 1.4.0 (проверить, нужен ли ещё).
```
- Поиска `Updates.isUpdateAvailable`/модального блока, `Constants.expoConfig.version` сравнения или `semver` (пакет `semver` в зависимостях) на стороне клиента НЕТ: policy «мягкая» — сервер отвечает 426, а клиент лишь показывает текст.

### НЕЛЬЗЯ трогать
- `app.json: version` и `runtimeVersion.policy` (смена версии отрежет OTA от установленного бинарника); нативные модули не добавлять после выпуска 1.0.0.
- `X-App-Version` — единственный источник решения «устарело»; не менять формат `\d{1,4}\.\d{1,4}\.\d{1,4}`.
- `reloadAsync` в `checkAndApplyUpdate` стоит под `try/catch` молча; убрать защиту `__DEV__`/`web` = падения в dev/PWA.
- Пути, исключённые из `eas-update.yml`, нельзя расширять случайно: иначе каждый мерж с данными/видео выкатывает OTA.
- Тесты: `app_version_test.php`, `google_services.test.mjs`.

---

## 9. PWA / веб

### Цепочка
```
app/+html.tsx (корневой HTML для static export): viewport + no-zoom слои, manifest, apple-touch, статичный #splash (JT-splash) с window.__setSplashProgress/__hideSplash/__jobtooBundleMounted,
   регистрация service worker (/sw.js), лендинг для компьютера (constants/landing.ts, класс jt-landing), Telegram Mini App скрипт
lib/webSplash.ts: setWebSplashProgress / hideWebSplash / markWebBundleMounted — контракт с +html (флаги __jobtoo*, если inline-скрипт ещё не выполнился)
public/sw.js: SHELL_CACHE 'jobtoo-app-shell-v8', network-first для /_expo/static и /assets, skipWaiting+clients.claim, на апгрейде навигирует открытые окна, обработчики 'push' и 'notificationclick'
public/manifest.json, public/landing/*, public/splash/*, probe.html, robots.txt
lib/telegram.ts: waitForTelegramMiniApp / initTelegramMiniApp / getTelegramStartParam ; app/_layout.tsx TelegramMiniAppController (ref_*, share_*, vacancy_*)
hooks/useHydrated.ts: параметры адреса — только после первого рендера (иначе React #418 при статике)
components/CookieConsent.tsx: Метрика (ym) после согласия; services/crashReporting.ts: AppMetrica native
Адрес API на вебе: same-origin (window.location.origin) в db.ts, lib/supabase.ts, notifications.ts, webPush.ts (обход блокировок «чистых» имён)
AppContext web: опрос + visibilitychange + realtime (supabase-js) ; dbWarmup каждые 4 мин
Сборка: `npx expo export --platform web` (обязательна в CI); выкладка deploy-regru.yml
```
- Нет `app/+not-found` проблем: `app/+not-found.tsx` есть.
- `public/sw.js` — самый хрупкий файл поставки: кэш-версия `v8`, при смене нужно менять имя и логику очистки старых кэшей.

### НЕЛЬЗЯ трогать
- Порядок `<script>`-ов и ID в `+html.tsx` (#splash, #splash-fill…): сторожа `check-small-screens`/`shoot-screens` ждут исчезновения `#splash`; `tests/no_zoom.test.mjs`.
- Четыре слоя запрета масштаба (viewport, touch-action, gesture*, wheel ctrlKey).
- Контракт webSplash (`__setSplashProgress`, `__hideSplash`, флаги ожидания); `ENTRY_PATHS` в `_layout.tsx` (на не-входных маршрутах сплэш скрывается сразу).
- SW: `SHELL_CACHE` версия и стратегия «сеть первой» для бандла.
- На вебе `Alert.alert` не работает — используется `confirmAsync`/`ConfirmHost` (тест `confirm_web.test.mjs`).
- Tabs layout: `Tabs ... tabBar={() => null}` + собственная плашка `FloatingTabBar`; `collapsable={false}` на `tabCell` (Android Fabric иначе схлопывает View с фоном/скруглением).

---

## 10. Настройки, удаление аккаунта, согласия

### Цепочка
```
Настройки: app/profile-settings.tsx (722 стр.) [UI+сеть+логика]
   -> dbGetMarketingConsent/dbSetMarketingConsent (selfArg) ; уведомления (см. п.7) ; «Очистить кэш и обновить» (storage.clearRuntimeCache, Updates) ; logout ; юр. документы (constants/legal LEGAL_DOCS)
Удаление: components/feature/DeleteAccountSheet.tsx
   -> db.ts: dbSendDeleteAccountCode() = proxy('dbAuthSendCode',['', 'delete'])  (адрес берёт сервер из сессии)
   -> dbDeleteAccountByCode(uid, code) -> db.php 'dbDeleteAccountByCode' (selfArg) -> каскадное удаление; триггер jm_purge_email; jm_jupiter_retired_addresses
   -> onDeleted -> useApp().logout() (profile-settings.tsx:649)
Согласия:
   Регистрация: dbUpsertUser(...,consent) -> jt_consent_attach ; registerUser -> dbRecordConsent(...,'registration')
   Повторное принятие: components/ConsentGate.tsx (в _layout.tsx) -> dbGetConsent(user.id) -> needsReconsent(stamp vs LEGAL_STAMP) -> dbRecordConsent(...,'reconsent') -> повторная dbGetConsent для проверки -> dbSetMarketingConsent
       побочно: setCrashReportingAllowed(consentOk) (services/crashReporting.ts, AppMetrica) ; setConsentPending(blocking) в AppContext
   Трансгранич: dbGetCrossBorderConsent/dbRecordCrossBorderConsent/dbRevokeCrossBorderConsent (источники 'crossborder:push'|'telegram'|'registration'|'reconsent')
   Куки/Метрика (web): components/CookieConsent.tsx (localStorage)
   Юридические тексты: constants/legal.ts (LEGAL_STAMP, legalVersions(), LEGAL_DOCS) ; сервер сверяет редакции ('Редакция согласия устарела. Обновите приложение.')
```

### НЕЛЬЗЯ трогать
- `dbRecordConsent` не бросает (регистрация не должна падать), но `dbRecordCrossBorderConsent`/`dbSetMarketingConsent` БРОСАЮТ (переключатель должен показывать правду) — разный контракт намеренно.
- Подтверждение `dbGetConsent` после записи в `ConsentGate.accept` (кнопка не верит оптимистичному UI).
- Версия документов вшита в сборку: клиент пишет ту редакцию, которую видел; не подставлять с сервера.
- Гость не подписывает согласие (иначе тупик).
- Нет пути удаления без подтверждённой почты (409 «Напишите на support@jobtoo.ru»).
- Тесты: `consent_test.php`, `marketing_consent_test.php`, `delete_by_code_test.php`, `legal*`, `landing-docs.test.ts` (меняя `constants/legal.ts`, перегенерировать `public/landing/docs.json`).

---

## 11. Прямые обходы и supabase-js

### @supabase/supabase-js в приложении — ГДЕ ИСПОЛЬЗУЕТСЯ
1. `lib/supabase.ts` — клиент №1 (`createClient`, на вебе URL = origin; без ключа создаёт заглушку, чтобы не падал импорт). Экспортирует `supabase` и `isSupabaseConfigured`.
2. `services/db.ts` — импортирует `supabase`, но 73 вызова `supabase.from(...)` лежат ТОЛЬКО за `if (!IS_NATIVE)` (константа `true`) — мёртвый код, при этом они определяют, что клиент и ключ всё ещё тянутся в бандл.
3. `contexts/AppContext.tsx` — на вебе `supabase.channel('jt')` и `jt:u:<uid>` (broadcast `changed` -> refresh*); на native — `getSupabaseClient()` из `template/` (второй синглтон, `template/core/client.ts`, `@ts-nocheck`).
4. `app/chat-room.tsx:510` — `getSupabaseClient().channel('chat:<id>')`.
5. `app/(tabs)/profile.tsx:123`, `app/user-profile.tsx:181` — `channel('ratings:<uid>')` (web).
6. `app/admin.tsx` и `app/analytics.tsx` — прямые `.from('jm_users'|'jm_vacancies'|'jm_complaints'|...)` запросы + `ADMIN_PHONE` захардкожен (`'89933431523'`). Доступ к таблицам с ключа сборки закрыт (см. комментарий AppContext), поэтому эти экраны на проде, вероятно, не работают; в клиенте они недоступны из интерфейса, кроме ссылки `admin -> analytics`. Остались для истории (панель теперь — `dashboard/`).
7. Storage: код загрузки через supabase-js убран (все `dbUpload*` идут через PHP); комментарий в `lib/supabase.ts` «остались две вещи: realtime и Storage» устарел — Storage там больше не используется.
- `template/auth/*`, `template/core/*`: шаблонный слой (Supabase auth/provider от генератора проекта). В приложении реально используются из `@/template`: `AlertProvider` (+`useAlert`) и `getSupabaseClient`. Auth-провайдеры (`template/auth/supabase`, `mock`) в приложении не подключены.
- Realtime — канал только-сигнал: сервер (`rt_touch`, `rt_user_signal` в db.php) шлёт имя раздела, данных нет. Подписка на таблицы закрыта намеренно (ключ в каждой сборке).

### Firebase
- Нет `firebase`/`@react-native-firebase` в `package.json`, нет импортов в коде. Есть только `google-services.json` (конфиг для FCM/Expo Push) — см. раздел 7.

---

## 12. Карта «кто кого вызывает» — зависимости и циклы

| Слой | Знает о | НЕ должен знать |
|---|---|---|
| `constants/*`, `lib/*` (чистые) | друг о друге; `lib/webPush.ts` знает `services/db` и `services/notifications` | экраны |
| `services/*` (чистые: energy, feedMix, feedFilters, vacancyFacets, matchCounts, matching, dayGroups, descriptionBlocks, profileGateDecision, notificationRoute, captchaTaps, jupiterTimeline, jupiterFill*, jupiterAutopilot) | типы из `constants/types`; type-only `JupiterFillProfile` из `db.ts` | RN, сеть |
| `services/db.ts` | `lib/supabase` (мёртвые ветки), `expo-constants`, `expo-secure-store`, `AsyncStorage`, `services/storage` (uid/nowISO), `services/company`, type из `jupiterTimeline` | экраны |
| `services/*` с побочными эффектами | `notifications` -> db; `extSaved` -> db; `resumeGate` -> db + `expo-router` + `confirm`; `avatarUpload` -> db | AppContext |
| `contexts/AppContext.tsx` | db, storage, notifications, `lib/webPush`, `lib/webSplash`, `lib/supabase`, `template`, `constants/legal`, `lib/profileEdit` | экраны |
| `hooks/*` | `useApp`, db (useEnergy, useMissingUsers, useSignedMedia) | — |
| `app/*`, `components/*` | всё выше; 35 файлов зовут db напрямую | — |

Циклы и неочевидные петли:
- `lib/webPush.ts` <-> `services/notifications.ts`: webPush импортирует `NOTIFICATION_DISABLED_KEY` из notifications, notifications на webPush не ссылается (цикла нет), но оба независимо дублируют `PROXY_URL`.
- Тип-цикл: `services/db.ts` (тип `JupiterFillProfile`) <- `jupiterFill.ts`/`jupiterAutopilot.ts` (type import) — безопасно, пока `import type`.
- `components/ui/Toast.tsx` -> тип `ToastType` из `contexts/AppContext` (type-only).
- Скрытые связи через модульные синглтоны: `ProfileGateHost` (в `_layout`) регистрирует функцию в `resumeGate`; `feed.tsx` и `perm-vacancy-detail.tsx` вызывают `ensureResumeForApply` не зная о хосте. `ConsentGate` -> `AppContext.consentPending` -> `CompleteProfileSheet`.
- Дублирование обязанностей опроса: AppContext держит ДВА независимых опроса (web / native) + три realtime-эффекта, и каждый экран (chat-room, matches, profile) ещё и сам опрашивает. Перерасход запросов при рефакторинге легко удвоить.

## 13. Подозрения на несоответствие кода и серверных списков (проверить до рефакторинга)

1. `dbGetUsers`. В `php-proxy/db.php` (строка ~198) стоит в `$adminFns` (нужен `X-Admin-Token`), комментарий «Приложение её не зовёт», но `contexts/AppContext.tsx: refreshUsers` (строка ~876) зовёт её из клиента при загрузке, опросах и realtime. Если сервер выложен как в репозитории, приложение получает 403 «Это действие вам недоступно», `users` остаётся пустым/из кэша, `mergeSelfUser` не отрабатывает, имена добираются через `useMissingUsers`/`dbGetUserById`. Требует проверки на проде (`tests/profile_privacy_test.php` проверяет только тело case).
2. `dbReleasePushToken` — не в `$publicFns`, вызывается при отсутствии сессии (см. п.7).
3. `dbNotifyAllWorkersNewVacancy` вызывается клиентом `X-App-Secret`-ом без сессии; не в `$adminFns`/`$publicFns` -> 401 для всех (код проглатывает; для закрытых работодателей это безвредно).
4. В `db.ts` дубли сигнатур `jupiterCaptcha*` (db.ts:2502–2523 и `services/jupiterCaptcha.ts`).

## 14. Итог: какие слои уже чистые, где смешано

Чистые (можно трогать смелее, есть node-тесты): `services/energy.ts`, `feedMix.ts`, `feedFilters.ts`, `vacancyFacets.ts`, `matchCounts.ts`, `matching.ts`, `dayGroups.ts`, `notificationRoute.ts`, `profileGateDecision.ts`, `jupiterTimeline.ts`, `jupiterFill.ts`/`jupiterAutopilot.ts` (строки-скрипты), `captchaTaps.ts`, `lib/profileEdit.ts`, `lib/applyAnswers.ts`, `lib/resumeParser.ts`, `hooks/useSwipeDeck.ts` (только UI-поток).

Смешанные (UI+сеть+бизнес-логика): `app/(tabs)/feed.tsx`, `matches.tsx`, `profile.tsx`, `app/chat-room.tsx`, `app/profile-settings.tsx`, `app/jupiter-fill.tsx`, `app/jupiter-application.tsx`, `contexts/AppContext.tsx` (оркестрация входа, опросы, realtime, кэш — всё в одном провайдере на 1110 строк).

Главный барьер рефакторинга: ~91 тест читает исходники экранов как текст (feed.tsx — 12+ тестов, chat-room, matches, profile, AppContext.tsx, services/db.ts, notifications.ts) — перенос кода между файлами ломает проводку в тестах, а не только сборку.
