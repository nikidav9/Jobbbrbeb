<?php
// Обрыв связи не выдаётся за пустоту.
//
// Разница для человека решающая. «Смен нет» он читает как «здесь искать
// нечего» и уходит — молча, и в суточном отчёте это выглядит обычным оттоком.
// «Нет активных заявок» только что откликнувшийся прочитает как «мой отклик
// пропал». «Нет сообщений» ждущий ответа прочитает как «мне не ответили».
// Во всех трёх случаях список просто не принесли.
//
// ГЛАВНОЕ, ЧЕМУ НАУЧИЛ РАЗБОР ПЕРВОЙ ВЕРСИИ. Признак сам по себе ничего не
// значит: значит его ИСТОЧНИК. Сначала экраны откликов и переписок читали
// общий backendOffline, который поднимают только загрузки вакансий. Экран
// говорил «нет связи», когда его собственный список пришёл, и молчал, когда
// не пришёл, — то есть врал в обе стороны. Поэтому ниже проверяется не
// наличие плашки, а то, что её поднимает ТОТ список, который экран показывает.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$ctx = (string)file_get_contents(__DIR__ . '/../contexts/AppContext.tsx');

/** Тело функции-стрелки, объявленной как `const <имя> = ...`, до её `\n  };`. */
function arrow_body(string $src, string $name): string
{
    $start = strpos($src, 'const ' . $name . ' = ');
    if ($start === false) return '';
    $end = strpos($src, "\n  };\n", $start);
    return $end !== false ? substr($src, $start, $end - $start) : '';
}

// ── Признак поднимается в теле СВОЕЙ загрузки ────────────────────────────────
// Привязываемся к телу, а не к наличию вызова где-нибудь в файле: пометок в
// файле много, и проверка на наличие пережила бы удаление любой из них.
foreach (['refreshVacancies' => 'vacancies', 'refreshLikes' => 'likes', 'refreshChats' => 'chats'] as $fn => $key) {
    $body = arrow_body($ctx, $fn);
    check("$fn найдена", $body !== '');
    check("$fn: обрыв поднимает свой признак", str_contains($body, "markOffline('$key', true);"));
    check("$fn: успех свой признак снимает", str_contains($body, "markOffline('$key', false);"));
    // Порядок: сначала данные легли, потом снят признак. Иначе признак
    // снимется и при неудачной записи.
    $set = strpos($body, 'set');
    check("$fn: признак снимается после данных",
        $set !== false && $set < strpos($body, "markOffline('$key', false);"));
    // Список при обрыве НЕ обнуляется: иначе человек теряет и кэш, и
    // объяснение разом.
    check("$fn: при обрыве список не трогаем",
        !preg_match('~catch[\s\S]{0,200}set\w+\(\[\]\)~', $body));
}
check('карта признаков отдаётся экранам', str_contains($ctx, "\n        offline,"));
// Прежний общий признак остался и означает ровно то, что означал: его
// поднимали и снимали ровно загрузки вакансий, и лента с ним и работает.
check('общий признак собран из вакансий',
    str_contains($ctx, 'const backendOffline = offline.vacancies || offline.permVacancies;'));

// ── Экран берёт признак с того списка, который показывает ────────────────────
// Ради этого тест и переписан. Пары «экран → его список» — и есть инвариант.
foreach ([
    // экран => [что это, поле контекста, признак, которым закрыта разметка]
    'app/(tabs)/feed.tsx'    => ['лента',      'backendOffline', 'backendOffline'],
    'app/(tabs)/matches.tsx' => ['отклики',    'offline.likes',  'offlineHere'],
    'app/(tabs)/chats.tsx'   => ['переписки',  'offline.chats',  'offlineHere'],
] as $file => [$what, $expr, $guard]) {
    $src = (string)file_get_contents(__DIR__ . '/../' . $file);
    // Именно из контекста, а не локальной заглушкой. Прежняя версия проверки
    // искала имя по всему файлу и оставалась зелёной, когда экран объявлял
    // `const backendOffline = false` у себя: разметка-то поле поминает.
    // useApp() зовут не один раз (в ленте есть маленькие компоненты со своей
    // выборкой), поэтому смотрим ВСЕ деструктуризации.
    $want = explode('.', $expr)[0];
    preg_match_all('~const \{([^}]*)\}\s*=\s*useApp\(\);~', $src, $mm);
    $fromContext = false;
    foreach ($mm[1] ?? [] as $block) {
        if (preg_match('~\b' . preg_quote($want, '~') . '\b~', $block)) { $fromContext = true; break; }
    }
    check("{$what}: признак берётся из контекста", $fromContext);
    check("{$what}: экран не подменяет признак своим",
        !preg_match('~(const|let)\s+' . preg_quote($want, '~') . '\s*=~', $src));
    check("{$what}: про связь сказано прямо", str_contains($src, 'Нет связи с сервером'));
    // Плашка закрыта признаком, а не висит безусловно.
    check("{$what}: плашка под признаком",
        (bool)preg_match('~' . preg_quote($guard, '~') . '[\s\S]{0,400}Нет связи с сервером~', $src));
    // А признак собран из НУЖНОГО списка. Это и есть проверка, которой не
    // было: первая версия дошла до плашки и на этом остановилась.
    $guardBuiltFromList = $guard === $expr
        ? true
        : ($what === 'отклики'
            ? str_contains($src, 'offline.likes && myLikes.length === 0')
            : (bool)preg_match('~const ' . preg_quote($guard, '~') . ' = ' . preg_quote($expr, '~') . '\b~', $src));
    check("{$what}: признак собран из нужного списка", $guardBuiltFromList);
}

// ── Пустой поиск — не обрыв ──────────────────────────────────────────────────
// В переписках пустое состояние показывается по filtered, то есть ПОСЛЕ
// поиска. Если плашку связи вешать туда же, ненайденный запрос при живой сети
// объявлялся бы обрывом. Поэтому признак экрана меряется до фильтра.
$chats = (string)file_get_contents(__DIR__ . '/../app/(tabs)/chats.tsx');
check('переписки: обрыв меряется до поиска',
    str_contains($chats, 'const offlineHere = offline.chats && myChats.length === 0;'));
check('переписки: у пустого поиска свой текст', str_contains($chats, 'Ничего не найдено'));
// В откликах — тот же вопрос про вкладки: пустая вкладка «Отказы» при
// принесённом списке это правда, и плашка поверх неё была бы неправдой.
$m = (string)file_get_contents(__DIR__ . '/../app/(tabs)/matches.tsx');
check('отклики: обрыв меряется по всему списку, не по вкладке',
    str_contains($m, 'offline.likes && myLikes.length === 0'));

// ── Регистрация и поддержка: сетевой сбой не выдаётся за успех/пустоту ───────
foreach (['app/register-worker.tsx' => 'работник', 'app/register-employer.tsx' => 'работодатель'] as $file => $role) {
    $src = (string)file_get_contents(__DIR__ . '/../' . $file);
    check("регистрация {$role}: сбой проверки номера не пропускает дальше",
        !preg_match('~catch\s*\{[\s\S]{0,180}setStep\(2\)~', $src));
    check("регистрация {$role}: сбой проверки номера объяснён",
        str_contains($src, 'Не удалось проверить номер. Проверьте связь и попробуйте ещё раз.'));
}
$support = (string)file_get_contents(__DIR__ . '/../app/support.tsx');
check('поддержка: ошибка истории хранится отдельно', str_contains($support, 'loadFailed'));
check('поддержка: ошибка истории не выглядит пустым чатом', str_contains($support, 'Не удалось загрузить переписку'));
check('поддержка: историю можно повторить',
    (bool)preg_match('~onPress=\{\(\) => void load\(\)\}[\s\S]{0,160}Повторить~', $support));

// ── Чат, чужой профиль и отзывы: ошибка загрузки не равна пустоте ────────────
$chatRoom = (string)file_get_contents(__DIR__ . '/../app/chat-room.tsx');
check('чат: ошибка записи чата хранится отдельно', str_contains($chatRoom, 'dbChatLoadFailed'));
check('чат: ошибка сообщений хранится отдельно', str_contains($chatRoom, 'messageLoadFailed'));
check('чат: при ошибке сообщений есть диагноз', str_contains($chatRoom, 'Не удалось загрузить сообщения'));
check('чат: при ошибке сообщений есть повтор',
    (bool)preg_match('~setMessageRetry[\s\S]{0,220}Повторить~', $chatRoom));
check('чат: сбой загрузки не включает подсказки как для нового чата',
    str_contains($chatRoom, '!messageLoadFailed && !isChatBlocked'));

$userProfile = (string)file_get_contents(__DIR__ . '/../app/user-profile.tsx');
check('чужой профиль: ошибка загрузки не равна «не найден»',
    str_contains($userProfile, 'userLoadFailed') && str_contains($userProfile, 'Не удалось загрузить профиль'));
check('чужой профиль: отзывы имеют отдельную ошибку',
    str_contains($userProfile, 'ratingsLoadFailed') && str_contains($userProfile, 'Не удалось загрузить отзывы'));
check('чужой профиль: ошибка отзывчивости не выглядит отсутствием данных',
    str_contains($userProfile, 'statsLoadFailed') && str_contains($userProfile, 'Не удалось загрузить отзывчивость'));
check('чужой профиль: отзывчивость можно загрузить повторно',
    str_contains($userProfile, 'setStatsRetry(x => x + 1)'));
check('чужой профиль: старый ответ статистики не попадает в новый профиль',
    str_contains($userProfile, 'let cancelled = false;')
    && str_contains($userProfile, 'if (!cancelled) setStats(next);')
    && str_contains($userProfile, 'return () => { cancelled = true; };'));

$ownProfile = (string)file_get_contents(__DIR__ . '/../app/(tabs)/profile.tsx');
check('свои отзывы: сетевой сбой не выглядит отсутствием отзывов',
    str_contains($ownProfile, 'ratingsLoadFailed') && str_contains($ownProfile, 'Не удалось загрузить отзывы'));

// ── Telegram: пользовательские сетевые действия не молчат ───────────────────
$tg = (string)file_get_contents(__DIR__ . '/../components/TelegramConnectButton.tsx');
check('telegram: ошибка первого статуса не оставляет вечный спиннер',
    str_contains($tg, 'statusFailed') && str_contains($tg, 'Не удалось проверить Telegram'));
check('telegram: отключение сообщает об ошибке',
    str_contains($tg, 'Не удалось отключить Telegram. Проверьте связь и попробуйте ещё раз.'));
check('telegram: открытие бота сообщает об ошибке',
    str_contains($tg, 'Не удалось открыть Telegram. Откройте бота вручную'));
check('telegram: fire-and-forget заявка не даёт unhandled rejection',
    str_contains($tg, 'void dbTgPrepareLink(userId).catch'));
$db = (string)file_get_contents(__DIR__ . '/../services/db.ts');
check('telegram: prepare-link не скрывает сетевую ошибку от UI',
    str_contains($db, "await proxy('tgPrepareLink', [userId]);")
    && !str_contains($db, "try { await proxy('tgPrepareLink', [userId]); } catch {}"));

// ── Уведомления: ошибка сети не выглядит пустотой/успехом ────────────────────
$bell = (string)file_get_contents(__DIR__ . '/../components/ui/NotifBell.tsx');
check('уведомления: ошибка загрузки хранится отдельно', str_contains($bell, 'loadFailed'));
check('уведомления: ошибка загрузки не выглядит пустым списком',
    str_contains($bell, 'Не удалось загрузить уведомления') && str_contains($bell, 'Повторить'));
check('уведомления: прочитать все меняет UI только после сервера',
    str_contains($bell, 'const op = app?.markAllNotifsRead')
    && str_contains($bell, ': dbMarkAllNotifsRead(userId);')
    && (bool)preg_match('~await op;[\s\S]{0,180}setNotifs~', $bell));
check('уведомления: удаление одного меняет UI только после сервера',
    (bool)preg_match('~await dbDeleteNotif\(id\);[\s\S]{0,180}setNotifs~', $bell));
check('уведомления: удаление всех меняет UI только после сервера',
    (bool)preg_match('~await dbDeleteAllNotifs\(userId\);[\s\S]{0,180}setNotifs\(\[\]\)~', $bell));

$tgBanner = (string)file_get_contents(__DIR__ . '/../components/TelegramLinkBanner.tsx');
check('telegram banner: готовит резервную привязку', str_contains($tgBanner, 'void dbTgPrepareLink(userId).catch'));
check('telegram banner: ошибка открытия видна', str_contains($tgBanner, 'Не удалось открыть Telegram. Откройте вручную'));

// ── Push: разрешение ОС не выдаётся за рабочую доставку ─────────────────────
$push = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');
$pushSheet = (string)file_get_contents(__DIR__ . '/../components/NotificationPermissionSheet.tsx');
check('push: регистрация возвращает явный результат',
    str_contains($push, 'Promise<boolean>') && str_contains($push, 'return true;') && str_contains($push, 'return false;'));
check('push: экран ждёт регистрацию токена после уже выданного разрешения',
    str_contains($pushSheet, "status === 'granted'") &&
    str_contains($pushSheet, 'withTimeout(registerForPushNotifications(userId)'));
check('push: enabled сохраняется только после успешной регистрации',
    str_contains($pushSheet, 'if (ok) {') &&
    str_contains($pushSheet, "AsyncStorage.setItem(CHOICE_KEY, 'enabled')"));
check('push: ошибка токена объяснена и не закрывает лист как успех',
    str_contains($pushSheet, 'push-токен не зарегистрировался'));

// ── Рассылка вакансии: вторичный сбой не выдаётся за доставку ────────────────
$notifSvc = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');
$createShift = (string)file_get_contents(__DIR__ . '/../app/create-vacancy.tsx');
$createPerm = (string)file_get_contents(__DIR__ . '/../app/create-perm-vacancy.tsx');
check('рассылка вакансии: helper возвращает результат',
    str_contains($notifSvc, 'export async function notifyWorkersNewVacancy') &&
    str_contains($notifSvc, '): Promise<boolean>') &&
    str_contains($notifSvc, 'if (res.ok) return true;'));
check('рассылка вакансии: исчерпанные повторы дают false',
    str_contains($notifSvc, 'return false;'));
check('смена: неудачная рассылка видна, но публикация не откатывается',
    str_contains($createShift, "if (!ok) showToast('Вакансия опубликована, но рассылку не удалось отправить."));
check('постоянная: неудачная рассылка видна, но публикация не откатывается',
    str_contains($createPerm, "if (!ok) showToast('Вакансия опубликована, но рассылку не удалось отправить."));

// ── Адрес: таймаут подсказок не выглядит как ноль результатов ───────────────
$dbSrc = (string)file_get_contents(__DIR__ . '/../services/db.ts');
$addr = (string)file_get_contents(__DIR__ . '/../components/feature/AddressSuggestField.tsx');
check('адрес: сервис не превращает ошибку в пустой массив',
    !preg_match("~dbAddressSuggest[\s\S]{0,320}catch \{[\s\S]{0,80}return \[\]~", $dbSrc));
check('адрес: ошибка подсказок хранится отдельно', str_contains($addr, 'searchFailed'));
check('адрес: ошибка подсказок не выглядит как ничего не найдено',
    str_contains($addr, 'Не удалось загрузить подсказки') && str_contains($addr, 'Повторить'));
check('адрес: настоящий пустой поиск всё ещё объяснён',
    str_contains($addr, 'Ничего не нашлось. Можно подтвердить адрес как есть.'));

// ── Постоянная вакансия: сетевой сбой не выглядит удалением/успехом ─────────
$permDetail = (string)file_get_contents(__DIR__ . '/../app/perm-vacancy-detail.tsx');
check('постоянная вакансия: гостевая загрузка имеет отдельную ошибку',
    str_contains($permDetail, 'guestVacancyLoadFailed'));
check('постоянная вакансия: ошибка гостевой загрузки не выглядит 404',
    str_contains($permDetail, 'Не удалось загрузить вакансию') && str_contains($permDetail, 'Повторить'));
check('постоянная вакансия: настоящий not-found сохранён',
    str_contains($permDetail, 'Вакансия не найдена'));
check('избранное постоянной вакансии: UI меняется только после сервера',
    (bool)preg_match('~await dbAddPermSaved\(currentUser\.id, vacancy\.id\);[\s\S]{0,160}optimisticAddPermSaved~', $permDetail) &&
    (bool)preg_match('~await dbRemovePermSaved\(currentUser\.id, vacancy\.id\);[\s\S]{0,160}optimisticRemovePermSaved~', $permDetail));
check('избранное постоянной вакансии: ошибка видна',
    str_contains($permDetail, 'Не удалось сохранить вакансию') && str_contains($permDetail, 'Не удалось удалить из избранного'));

// ── Лента: ошибки загрузки/избранного не выдаются за пустоту/успех ───────────
$feedTruth = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
check('список откликов работодателя: ошибка не выглядит пустым списком',
    str_contains($feedTruth, 'dataLoadFailed') && str_contains($feedTruth, 'Не удалось загрузить список'));
check('избранное смены: добавление подтверждается сервером до UI',
    (bool)preg_match('~await dbAddSaved\(user\.id, id\);[\s\S]{0,140}optimisticAddSaved~', $feedTruth));
check('избранное смены: удаление подтверждается сервером до UI',
    (bool)preg_match('~await dbRemoveSaved\(user\.id, id\);[\s\S]{0,140}optimisticRemoveSaved~', $feedTruth));
check('избранное работы: добавление подтверждается сервером до UI',
    (bool)preg_match('~await dbAddPermSaved\(currentUser\.id, v\.id\);[\s\S]{0,160}optimisticAddPermSaved~', $feedTruth));
check('избранное работы: удаление подтверждается сервером до UI',
    (bool)preg_match('~await dbRemovePermSaved\(currentUser\.id, v\.id\);[\s\S]{0,160}optimisticRemovePermSaved~', $feedTruth));
check('избранное ленты: сетевые ошибки видны',
    str_contains($feedTruth, 'Не удалось добавить в избранное') &&
    str_contains($feedTruth, 'Не удалось сохранить в избранное'));

// ── Профиль: успех показывается только после серверной записи ─────────────────
$profileCtx = (string)file_get_contents(__DIR__ . '/../contexts/AppContext.tsx');
$profileScreen = (string)file_get_contents(__DIR__ . '/../app/(tabs)/profile.tsx');
$upsertPos = strpos($profileCtx, 'await dbUpsertUser(u);');
$localPos = strpos($profileCtx, '_setCurrentUser(u);', $upsertPos === false ? 0 : $upsertPos);
check('профиль: сервер подтверждает изменение до локального UI',
    $upsertPos !== false && $localPos !== false && $upsertPos < $localPos);
check('профиль: форма ждёт сервер перед успехом',
    (bool)preg_match("~await updateUser\\(updated\\);[\\s\\S]{0,180}showToast\\('Сохранено', 'success'\\)~", $profileScreen));
check('профиль: фоновый ложный успех удалён',
    !str_contains($profileScreen, "updateUser(updated).catch(() => showToast('Ошибка синхронизации'"));
check('профиль: ошибка оставляет форму для повтора',
    str_contains($profileScreen, 'Не удалось сохранить. Проверьте связь и попробуйте ещё раз'));
check('фото профиля: ошибка записи не запускает опасный откат',
    !str_contains($profileScreen, 'prevAvatarUrl') &&
    !preg_match('~processAndUpload error[\\s\\S]{0,160}updateUser\\(~', $profileScreen));

// ── Fail-closed там, где отсутствие ответа меняет право продолжать ────────────
$dbService = (string)file_get_contents(__DIR__ . '/../services/db.ts');
$phoneStart = strpos($dbService, 'export async function dbCheckPhoneExists');
$phoneEnd = strpos($dbService, 'export async function dbGetUserByPhone', $phoneStart === false ? 0 : $phoneStart);
$phoneBody = ($phoneStart !== false && $phoneEnd !== false)
    ? substr($dbService, $phoneStart, $phoneEnd - $phoneStart)
    : '';
check('регистрация: сервис не превращает ошибку телефона в false',
    $phoneBody !== '' &&
    str_contains($phoneBody, "return proxy<boolean>('dbCheckPhoneExists', [phone]);") &&
    !str_contains($phoneBody, 'catch { return false; }'));

$consentGate = (string)file_get_contents(__DIR__ . '/../components/ConsentGate.tsx');
check('согласие: ошибка первичной проверки хранится отдельно',
    str_contains($consentGate, 'checkFailed') && str_contains($consentGate, 'setCheckFailed(true)'));
check('согласие: ошибка проверки не пропускает в приложение',
    !str_contains($consentGate, 'setNeeded(false); setChecked(true);') &&
    str_contains($consentGate, 'Не удалось проверить документы'));
check('согласие: после ошибки есть повтор и выход',
    str_contains($consentGate, 'setCheckRetry(v => v + 1)') &&
    str_contains($consentGate, '<Text style={styles.acceptText}>Повторить</Text>') &&
    str_contains($consentGate, 'onPress={() => app?.logout()}'));

// ── Свайп «пропустить»: сетевой сбой не превращается в локальный успех ───────
$feedSkip = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
$skipStart = strpos($feedSkip, 'const doSkip = useCallback');
$skipEnd = strpos($feedSkip, 'const doWant = useCallback', $skipStart === false ? 0 : $skipStart);
$skipBody = ($skipStart !== false && $skipEnd !== false)
    ? substr($feedSkip, $skipStart, $skipEnd - $skipStart)
    : '';
check('пропуск смены: ошибка серверной записи возвращает карточку',
    $skipBody !== '' &&
    str_contains($skipBody, 'setCards(prev => [card, ...prev.filter(v => v.id !== card.id)])'));
check('пропуск смены: ошибка убирает ложную запись из истории',
    str_contains($skipBody, '[date]: (h[date] ?? []).filter(v => v.id !== card.id)'));
check('пропуск смены: ошибка видна пользователю',
    str_contains($skipBody, 'Не удалось пропустить вакансию. Проверьте связь и попробуйте ещё раз.'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────
// Ветка обрыва добавлена, а не подменила собой полезную подсказку.
$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
check('подсказка про фильтр осталась', str_contains($feed, 'На выбранных станциях смен нет'));
check('подсказка про другой день осталась', str_contains($feed, 'На этот день смен нет'));
check('обычная пустота осталась', str_contains($feed, 'Новых вакансий пока нет'));
check('прежние заголовки откликов остались',
    str_contains($m, 'Нет активных заявок') && str_contains($m, 'Нет отказов'));
check('прежний заголовок переписок остался', str_contains($chats, 'Нет сообщений'));

// ── У обрыва есть выход ──────────────────────────────────────────────────────
// Тупик хуже ошибки: человеку надо дать действие, а не только диагноз.
check('в ленте можно повторить', str_contains($feed, 'Попробовать снова'));
// Кнопка и её действие рядом, а не просто где-то в файле: onRefresh в ленте
// есть и у обычного обновления, и проверка на его наличие ничего не значила.
check('кнопка повтора зовёт обновление',
    (bool)preg_match('~onPress=\{onRefresh\}[\s\S]{0,200}Попробовать снова~', $feed));

if ($failures) {
    echo "offline states: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "offline states: OK\n";
