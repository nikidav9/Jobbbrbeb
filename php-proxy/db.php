<?php
// Ответ прокси должен быть только JSON.
//
// Хостинг печатает предупреждения PHP прямо в ответ, и они оказываются ПЕРЕД
// телом: «<br /><b>Warning</b>: Undefined array key 0…{"data":null}». Клиент
// разбирает такое как JSON, спотыкается о первый символ и показывает
// «JSON Parse error: Unexpected character» — по этому тексту понять нельзя
// ничего. У директора так не публиковалась вакансия.
//
// Поэтому: предупреждения не печатаем (в лог хостинга они по-прежнему идут),
// а всё, что кто-то напечатает мимо, ловим буфером и выбрасываем перед
// выводом. Тихо ломаться хуже, чем громко, — но ломаться в разборе чужого
// текста хуже всего.
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');
ob_start();
require_once __DIR__ . '/referral.php';
require_once __DIR__ . '/funnel.php';
require_once __DIR__ . '/shift_funnel.php';
require_once __DIR__ . '/feed_funnel.php';
require_once __DIR__ . '/sitemap_cache.php';
require_once __DIR__ . '/push_privacy.php';
require_once __DIR__ . '/jupiter_mail_address.php';
require_once __DIR__ . '/ext_feed.php';

/** Отдать ответ, отбросив всё, что случайно напечаталось до него. */
function jt_respond(mixed $payload, int $code = 200): void {
    if (ob_get_level() > 0) ob_end_clean();
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
}

// Адрес бэкенда — из секрета, как и ключ рядом.
//
// Так переключение между облаком и своим сервером (и откат обратно) — это
// смена одного значения в настройках, а не правка трёх файлов и выкладка.
// Откат важнее: если после переезда что-то пойдёт не так, вернуться надо
// быстро, а не собирать релиз.
//
// Значение не задано — работает облако. Выкладка сама по себе ничего не
// переключает, и это намеренно.
// Адрес бэкенда — свой сервер в Москве, и только он.
//
// Раньше здесь была пара «переменная окружения SB_URL или файл sb_url.php, а
// иначе умолчание». Заводилось это как быстрый откат в облако, если переезд
// пойдёт не так. Переезд состоялся 15.08, данные давно в России, а рычаг
// остался — и это ровно тот рычаг, которым первичная запись ПДн граждан РФ
// одной настройкой уводится за границу, мимо ч. 5 ст. 18 152-ФЗ.
//
// Поэтому адрес теперь в коде. Сменить его — правка и коммит, и это осознанно:
// так переезд виден в истории, а не случается от значения в чужом окружении.
define('SB_URL', 'https://jobtoo.ru');

// Ключ доступа к базе.
//
// Анонимный ключ публичен по своей природе: он лежит в бандле сайта
// jobtoo.ru, и достать его может любой, кто откроет исходники страницы.
// Пока RLS выключены, с ним читаются телефоны, имена и переписки. Поэтому
// прокси переводим на сервисный ключ — он остаётся на сервере.
//
// Откуда берём (в порядке приоритета):
//   1) переменная окружения SB_SERVICE_KEY;
//   2) файл sb_service_key.php рядом с этим скриптом — на хостинге, где
//      переменные окружения не задать, это единственный рабочий путь.
//      Расширение .php тут не случайно: если файл запросят по прямой
//      ссылке, сервер его выполнит и отдаст пустоту, а не сам ключ;
//   3) старый анонимный ключ — запасной вариант, чтобы ничего не легло,
//      пока сервисный не прописан.
//
// Как только сервисный ключ окажется на хостинге — можно применять
// миграцию 013_lock_down_rls.sql и закрывать базу от анонимного доступа.

function sb_resolve_key(): string {
    $env = getenv('SB_SERVICE_KEY');
    if (is_string($env) && trim($env) !== '') return trim($env);

    $file = __DIR__ . '/sb_service_key.php';
    if (is_readable($file)) {
        $v = @include $file;
        if (is_string($v) && trim($v) !== '') return trim($v);
    }

    // Запасного ключа в коде больше нет. Прежний анонимный лежал здесь на
    // случай «чтобы ничего не легло» — но он же пережил бы смену ключей и
    // работал бы дальше втихую. Пусто — значит запросы честно упадут, и это
    // видно сразу, а не через месяц.
    return '';
}

define('SB_KEY', sb_resolve_key());

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-App-Secret, X-Admin-Token, X-Yandex-Metrika-Token, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jt_respond(['error' => 'Method not allowed'], 405); exit;
}

// Смена секрета не может быть мгновенной: у части людей приложение уже
// установлено и старый секрет зашит в него до следующего обновления по воздуху.
// Поэтому на время перехода принимаем и предыдущий — APP_SECRET_PREV.
// Когда все обновятся, секрет из GitHub Secrets убирается, и старый ключ
// перестаёт работать сам собой.
$provided = $_SERVER['HTTP_X_APP_SECRET'] ?? '';
$accepted = array_filter([
    jt_secret('APP_SECRET'),
    jt_secret('APP_SECRET_PREV'),
]);
//
// Считаем, сколько запросов ещё приходит со старым ключом. Без этого счёта
// решение «пора убирать» приходится принимать вслепую: уберёшь рано —
// отвалятся все, кто не обновился, и узнаешь об этом от них. Счётчик
// превращает догадку в число, которое видно в ежедневном отчёте.
$ok = false; $viaPrev = false;
$prev = jt_secret('APP_SECRET_PREV');
foreach ($accepted as $s) {
    if (hash_equals($s, $provided)) {
        $ok = true;
        if ($prev !== '' && hash_equals($prev, $provided)) $viaPrev = true;
    }
}
if ($ok && $viaPrev) {
    // Файл, а не база: это диагностика, и ронять из-за неё запрос нельзя.
    $mark = '/var/www/api/prev_secret_used';
    $today = gmdate('Y-m-d');
    $cur = @file_get_contents($mark);
    [$d, $n] = $cur ? array_pad(explode(' ', trim($cur), 2), 2, '0') : [$today, '0'];
    @file_put_contents($mark, $today . ' ' . ($d === $today ? (int)$n + 1 : 1), LOCK_EX);
}
if (!$ok) {
    jt_respond(['error' => 'Forbidden'], 403); exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$fn   = $body['fn'] ?? null;
$args = $body['args'] ?? [];

if (!$fn) { jt_respond(['error' => 'Missing fn'], 400); exit; }

// Операции управления нельзя защищать тем же ключом, который встроен в
// публичный web/APK-клиент. ADMIN_API_TOKEN хранится только на сервере и в
// закрытом дашборде. Если он не настроен, административные вызовы безопасно
// закрыты, а пользовательские сценарии продолжают работать.
$adminFns = [
    'dbKeyKind', 'adminResetPassword', 'dbMigrateChatMedia', 'dbDeleteUser',
    'cronEveningDigest', 'cronDailyReport', 'cronDailyNudges', 'cronShiftNudge',
    'cronAnnounceMissed', 'adminRetireTelegram',
    'tgBroadcast', 'tgSendToUsers', 'surveyDormantSend', 'surveyResults',
    'scoreRecalcAll', 'billingReport',
    // dbGetUsers отдаёт всех пользователей разом. Приложение её не зовёт
    // (в services/db.ts обёртка есть, вызовов нет), а любому вошедшему она
    // выгружала бы список всех людей сервиса одним запросом. Дашборд ходит в
    // базу своим путём, поэтому место операции — здесь.
    'dbGetUsers',
    'apiKeysList', 'apiKeyCreate', 'apiKeyRevoke',
    'botAdminGet', 'botAdminSet', 'supportClose', 'supportReopen',
    'supportReply', 'supportThreads', 'botReply', 'botInbox',
    'tgGroupInfo', 'tgPostToGroup', 'tgSetWebhook', 'tgWebhookInfo',
    'dbGetWorkerTokensByMetro', 'dbGetAllWorkerTokens',
    // Разовая уборка по ВСЕМ чатам сервиса и запись расходов по партнёрам.
    // Приложение их не зовёт (dbMergeDuplicateChats — вообще никто, расходы —
    // только дашборд), а любому вошедшему они были открыты.
    'dbMergeDuplicateChats',
    // Уведомления человеку приложение больше НЕ шлёт: их отправляет сервер
    // там же, где записывает событие (jt_notify_new_message, jt_notify_match,
    // jt_notify_shift_outcome, jt_perm_app_announce). Пока эти операции были
    // открыты вошедшему, текст уведомления приходил с клиента — то есть через
    // нашего бота можно было послать что угодно тому, с кем есть переписка.
    // Теперь звать их может только админский токен.
    //
    // Старые сборки приложения их ещё зовут и получат отказ. Потери нет:
    // уведомление к этому времени уже ушло с сервера, а отказ у них и так
    // проглатывается пустым catch.
    'tgNotifyUser', 'sendPushNotification', 'tgNotifyNewApplication',
    'dbGetPushToken', 'dbSaveNotification',
    // Воркер Jupiter. Ходит с админским токеном, а не от имени человека:
    // он берёт чужие задачи по очереди, и подставлять сюда пользовательскую
    // сессию значило бы дать одному человеку доступ к заявкам другого.
    'jupiterLease', 'jupiterHeartbeat', 'jupiterCheckpoint', 'jupiterFinish',
    'jupiterGetCandidateProfile', 'jupiterSubmitGuard', 'jupiterMailIngest',
];
if (in_array($fn, $adminFns, true)) {
    // На переходном этапе отдельный токен можно задать как ADMIN_API_TOKEN.
    // Если он ещё не создан, используем пароль закрытого дашборда: он уже
    // серверный и, в отличие от APP_SECRET, не попадает в web/APK-бандл.
    $adminToken = jt_secret('ADMIN_API_TOKEN');
    if ($adminToken === '') {
        $credFile = __DIR__ . '/admin_credentials.php';
        $creds = is_readable($credFile) ? @include $credFile : null;
        $adminToken = is_array($creds) ? (string)($creds['password'] ?? '') : '';
    }
    $providedAdmin = (string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '');
    if ($adminToken === '' || !hash_equals($adminToken, $providedAdmin)) {
        jt_respond(['error' => 'Admin authorization required'], 403); exit;
    }
}

$authHeader = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
$authClaims = jt_session_claims($authHeader);
$authUid = $authClaims['uid'] ?? null;

// Токен подписан верно — но этого мало.
//
// Он живёт тридцать дней и до сих пор ничем не гасился: ни сменой пароля, ни
// блокировкой. То есть увели токен — и он работает месяц, сколько пароль ни
// меняй; а заблокированный пользователь просто продолжал ходить в API, потому
// что is_blocked спрашивали только рассылки, решая, слать ли уведомление.
//
// Поэтому один запрос к своей же строке: он заодно ловит и удалённый аккаунт.
// Колонки sessions_valid_from может ещё не быть (миграция 046) — тогда
// проверяем хотя бы блокировку, а не роняем всё приложение.
if ($authUid !== null) {
    $acct = null;
    try {
        $acct = sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked,sessions_valid_from,role');
    } catch (\Throwable $e) {
        try { $acct = sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked,role'); }
        catch (\Throwable $e2) { $acct = null; }
    }
    if (!is_array($acct)) {
        jt_respond(['error' => 'Session is no longer valid'], 401); exit;
    }
    if (!empty($acct['is_blocked'])) {
        jt_respond(['error' => 'Аккаунт заблокирован'], 403); exit;
    }
    $validFrom = isset($acct['sessions_valid_from']) && $acct['sessions_valid_from'] !== null
        ? (int)strtotime((string)$acct['sessions_valid_from']) : 0;
    // Пять секунд допуска: отметка времени в базе и iat в токене ставятся
    // разными часами и с разным округлением, а без запаса свежевыданный при
    // смене пароля токен мог бы оказаться «старше» самой отметки.
    if ($validFrom > 0 && (int)($authClaims['iat'] ?? 0) + 5 < $validFrom) {
        jt_respond(['error' => 'Session is no longer valid'], 401); exit;
    }
}
$publicFns = [
    'dbCountUsers', 'dbWarmup', 'dbCheckPhoneExists', 'dbLogin',
    'dbUpsertUser', 'tgAuth', 'dbGetVacancies', 'dbGetPermVacancies',
    'addressSuggest', 'dbLogOpen', 'guestEvent',
    'dbResponsivenessMap', 'dbGetExtVacancies', 'dbGetExtFeed',
];
if (!in_array($fn, $publicFns, true) && !in_array($fn, $adminFns, true) && $authUid === null) {
    jt_respond(['error' => 'Authentication required'], 401); exit;
}

// Для операций, где первый/второй аргумент прямо обозначает владельца,
// сервер не доверяет ID из тела запроса и сверяет его с подписанной сессией.
$selfArgFns = [
    'tgPrepareLink' => 0, 'dbTouchLastSeen' => 0,
    'dbChangePassword' => 0, 'dbDeleteAccount' => 0,
    'dbRecordConsent' => 0, 'dbGetConsent' => 0,
    'dbRecordCrossBorderConsent' => 0, 'dbGetCrossBorderConsent' => 0,
    'dbRevokeCrossBorderConsent' => 0,
    'tgBindTelegram' => 0, 'tgUnbindTelegram' => 0,
    'dbGetSkillResults' => 0, 'dbSubmitSkillTest' => 0,
    'supportHistory' => 0, 'supportState' => 0, 'supportSend' => 0,
    'supportAssistantAsk' => 0, 'supportEscalate' => 0,
    'dbGetLikesForUser' => 0, 'dbGetChats' => 0,
    'dbGetMyReferral' => 0,
    'dbGetSaved' => 0, 'dbAddSaved' => 0, 'dbRemoveSaved' => 0,
    'dbGetPermVacanciesByEmployer' => 0, 'dbGetPermApplications' => 0,
    'dbGetPermSaved' => 0, 'dbAddPermSaved' => 0, 'dbRemovePermSaved' => 0,
    'dbGetPermSavedDetailed' => 0,
    'dbSavePushToken' => 0, 'dbClearPushToken' => 0,
    'dbGetWebPushSubscription' => 0, 'dbSaveWebPushSubscription' => 0,
    'dbDeleteWebPushSubscription' => 0, 'dbGetNotifications' => 0,
    'dbMarkAllNotifsRead' => 0, 'dbDeleteAllNotifs' => 0,
    'dbRecordVacancyView' => 1, 'dbRecordPermVacancyView' => 1,
    'dbRemoveLike' => 1,
    'dbApplyPermVacancy' => 1,
    // Заявки Jupiter: человек видит и ставит в очередь только свои.
    'jupiterEnqueue' => 0, 'jupiterMyApplications' => 0,
    'jupiterLiveStatus' => 0, 'jupiterSetLive' => 0,
    'jupiterRequeueLive' => 0, 'jupiterGrantThirdPartyConsent' => 0,
    'jupiterMailbox' => 0, 'jupiterMailList' => 0, 'jupiterMailRead' => 0,
    'jupiterFillProfile' => 0, 'jupiterMarkManualSubmitted' => 0,
    'jupiterApplicationEvents' => 0,
    // Свайпы по карьерным вакансиям: только свои.
    'dbExtSwipe' => 0, 'dbExtUnswipe' => 0,
];
if (isset($selfArgFns[$fn])) {
    $pos = $selfArgFns[$fn];
    if ($authUid === null || (string)($args[$pos] ?? '') !== $authUid) {
        jt_respond(['error' => 'Forbidden for this user'], 403); exit;
    }
}

// Смены (подработка) выведены из сервиса: остаётся только постоянная работа.
//
// Запрет стоит здесь, а не в клиенте, и это не перестраховка. Экран создания
// смены удалён, но у 500 человек в магазине стоит старая сборка, где он есть,
// — и она продолжит слать dbUpsertVacancy, пока её не обновят. Без серверного
// отказа раздел, «удалённый» из приложения, тихо продолжал бы наполняться.
//
// Закрыто только СОЗДАНИЕ. dbUpdateVacancy намеренно не в списке: им
// закрываются уже существующие смены — и вручную, и автозакрытием прошедших.
// Запрети его — и старые смены навсегда остались бы «активными». Чтение
// (dbGetVacancies) и удаление тоже работают: у людей есть история откликов и
// переписок по ним, и обрывать её задним числом — не то же самое, что
// перестать принимать новые.
$shiftWriteFns = ['dbUpsertVacancy', 'dbUpsertVacancyBatch'];
if (in_array($fn, $shiftWriteFns, true)) {
    jt_respond(['error' => 'Раздел подработки закрыт: публикуйте постоянную вакансию'], 410); exit;
}

// Переписка доступна только её участникам.
$chatArgFns = [
    'dbGetMessages' => 0, 'dbGetChatById' => 0, 'dbInsertMessage' => 0,
    'dbMarkRead' => 0, 'dbIncrementUnread' => 0, 'dbDeleteChat' => 0,
];
if (isset($chatArgFns[$fn])) {
    $chatId = (string)($args[$chatArgFns[$fn]] ?? '');
    $chat = $chatId !== '' ? sb_single('jm_chats', ['id' => 'eq.' . $chatId], 'worker_id,employer_id') : null;
    if (!$chat || ($authUid !== (string)$chat['worker_id'] && $authUid !== (string)$chat['employer_id'])) {
        jt_respond(['error' => 'Chat access denied'], 403); exit;
    }
    if ($fn === 'dbInsertMessage' && (string)($args[1] ?? '') !== $authUid) {
        jt_respond(['error' => 'Invalid sender'], 403); exit;
    }
    $actualChatRole = $authUid === (string)$chat['worker_id'] ? 'worker' : 'employer';
    if ($fn === 'dbMarkRead' && (string)($args[1] ?? '') !== $actualChatRole) {
        jt_respond(['error' => 'Read state role mismatch'], 403); exit;
    }
    if ($fn === 'dbIncrementUnread') {
        $recipientRole = $actualChatRole === 'worker' ? 'employer' : 'worker';
        if ((string)($args[1] ?? '') !== $recipientRole) {
            jt_respond(['error' => 'Unread recipient mismatch'], 403); exit;
        }
    }
}
if ($fn === 'dbCreateChat') {
    $workerId = (string)($args[0] ?? '');
    $employerId = (string)($args[1] ?? '');
    $vacancyId = (string)($args[2] ?? '');
    if ($authUid !== $workerId && $authUid !== $employerId) {
        jt_respond(['error' => 'Chat access denied'], 403); exit;
    }

    $chatVacancyKind = 'shift';
    $chatVacancy = $vacancyId !== ''
        ? sb_single('jm_vacancies', ['id' => 'eq.' . $vacancyId], 'employer_id')
        : null;
    if (!$chatVacancy) {
        $chatVacancyKind = 'permanent';
        $chatVacancy = $vacancyId !== ''
            ? sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vacancyId], 'employer_id')
            : null;
    }
    if (!$chatVacancy || (string)($chatVacancy['employer_id'] ?? '') !== $employerId) {
        jt_respond(['error' => 'Chat vacancy mismatch'], 403); exit;
    }

    $chatCallerRole = (string)($acct['role'] ?? '');
    if ($authUid === $workerId) {
        // На постоянной вакансии кнопка «Написать работодателю» доступна до
        // отклика, поэтому работнику достаточно реальной вакансии и её владельца.
        if ($chatCallerRole !== 'worker') {
            jt_respond(['error' => 'Chat role mismatch'], 403); exit;
        }
    } else {
        if ($chatCallerRole !== 'employer') {
            jt_respond(['error' => 'Chat role mismatch'], 403); exit;
        }
        $chatRelation = $chatVacancyKind === 'shift'
            ? sb_single('jm_likes', [
                'vacancy_id' => 'eq.' . $vacancyId,
                'worker_id' => 'eq.' . $workerId,
                'employer_id' => 'eq.' . $employerId,
            ], 'id')
            : sb_single('jm_perm_applications', [
                'vacancy_id' => 'eq.' . $vacancyId,
                'worker_id' => 'eq.' . $workerId,
                'employer_id' => 'eq.' . $employerId,
            ], 'id');
        if (!$chatRelation) {
            jt_respond(['error' => 'Chat relation mismatch'], 403); exit;
        }
    }
}

// Создавать и менять объявления может только указанный в них работодатель.
if (in_array($fn, ['dbUpsertVacancy', 'dbUpsertPermVacancy'], true)) {
    $owner = (string)(($args[0]['employer_id'] ?? ''));
    if ($owner === '' || $owner !== $authUid) {
        jt_respond(['error' => 'Vacancy owner required'], 403); exit;
    }
}
if ($fn === 'dbUpsertVacancyBatch') {
    foreach ((array)($args[0] ?? []) as $row) {
        if ((string)($row['employer_id'] ?? '') !== $authUid) {
            jt_respond(['error' => 'Vacancy owner required'], 403); exit;
        }
    }
}
$ownedVacancyFns = [
    'dbUpdateVacancy' => ['jm_vacancies', 0],
    'dbDeleteVacancy' => ['jm_vacancies', 0],
    'dbGetLikesByVacancy' => ['jm_vacancies', 0],
    'dbGetVacancyViewers' => ['jm_vacancies', 0],
    'dbClosePermVacancy' => ['jm_perm_vacancies', 0],
    'dbDeletePermVacancy' => ['jm_perm_vacancies', 0],
    'dbGetPermApplicationsForVacancy' => ['jm_perm_vacancies', 0],
    // Близнец dbGetVacancyViewers для постоянных вакансий стоял без проверки:
    // список посмотревших чужую вакансию отдавался любому вошедшему.
    'dbGetPermVacancyViewers' => ['jm_perm_vacancies', 0],
];
if (isset($ownedVacancyFns[$fn])) {
    [$table, $pos] = $ownedVacancyFns[$fn];
    $vac = sb_single($table, ['id' => 'eq.' . (string)($args[$pos] ?? '')], 'employer_id');
    if (!$vac || (string)($vac['employer_id'] ?? '') !== $authUid) {
        jt_respond(['error' => 'Vacancy owner required'], 403); exit;
    }
}
if ($fn === 'dbSetPermApplicationStatus') {
    $app = sb_single('jm_perm_applications', ['id' => 'eq.' . (string)($args[0] ?? '')], 'employer_id');
    if (!$app || (string)($app['employer_id'] ?? '') !== $authUid) {
        jt_respond(['error' => 'Application access denied'], 403); exit;
    }
}
if ($fn === 'dbSubmitRatingAndMaybeDelete') {
    $params = is_array($args[0] ?? null) ? $args[0] : [];
    if ((string)($params['fromUserId'] ?? '') !== $authUid) {
        jt_respond(['error' => 'Rating author mismatch'], 403); exit;
    }
    $ratingLikeId = (string)($params['likeId'] ?? '');
    $ratingLike = $ratingLikeId !== ''
        ? sb_single('jm_likes', ['id' => 'eq.' . $ratingLikeId], 'worker_id,employer_id,vacancy_id')
        : null;
    if (!$ratingLike) {
        jt_respond(['error' => 'Rating relation not found'], 404); exit;
    }
    $ratingRole = $authUid === (string)$ratingLike['worker_id'] ? 'worker'
        : ($authUid === (string)$ratingLike['employer_id'] ? 'employer' : '');
    $ratingTarget = $ratingRole === 'worker'
        ? (string)$ratingLike['employer_id']
        : ($ratingRole === 'employer' ? (string)$ratingLike['worker_id'] : '');
    if ($ratingRole === ''
        || (string)($params['role'] ?? '') !== $ratingRole
        || (string)($params['toUserId'] ?? '') !== $ratingTarget
        || (string)($params['vacancyId'] ?? '') !== (string)$ratingLike['vacancy_id']) {
        jt_respond(['error' => 'Rating relation mismatch'], 403); exit;
    }
    $ratingValue = (int)($params['rating'] ?? 0);
    if ($ratingValue < 1 || $ratingValue > 5) {
        jt_respond(['error' => 'Rating must be between 1 and 5'], 400); exit;
    }
    foreach (['quality', 'speed', 'matchedDesc', 'attitude', 'paidOnTime'] as $metric) {
        if (!array_key_exists($metric, $params) || $params[$metric] === null) continue;
        $metricValue = (int)$params[$metric];
        if ($metricValue < 1 || $metricValue > 5) {
            jt_respond(['error' => 'Rating metric must be between 1 and 5'], 400); exit;
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Ожидающие привязки Telegram ─────────────────────────────────────────
// Ссылка вида t.me/bot?start=link_<id> доносит метку до бота только когда
// чат с ботом заводится впервые. Если человек уже писал боту раньше,
// Telegram открывает существующий чат, кнопки START нет, и уходит голый
// «/start» — привязать не к чему. Поэтому приложение перед переходом
// оставляет здесь заявку, а бот подхватывает её по голому «/start».
define('TG_PENDING_FILE', sys_get_temp_dir() . '/jobtoo_tg_pending.json');
const TG_PENDING_TTL = 900;   // 15 минут

function tg_pending_read(): array {
    if (!is_file(TG_PENDING_FILE)) return [];
    $raw = @file_get_contents(TG_PENDING_FILE);
    $all = $raw ? json_decode($raw, true) : [];
    if (!is_array($all)) return [];
    $now = time();
    return array_filter($all, fn($ts) => is_int($ts) && $now - $ts < TG_PENDING_TTL);
}

function tg_pending_write(array $all): void {
    @file_put_contents(TG_PENDING_FILE, json_encode($all), LOCK_EX);
}

function uid(): string {
    return base_convert(time(), 10, 36) . substr(base_convert(mt_rand(), 10, 36), 2, 5);
}

/**
 * Адрес «Почты JobToo» человека; нет — выдаём читаемый (имя.фамилия).
 *
 * Занятым считается и адрес удалённого аккаунта (jm_jupiter_retired_addresses):
 * иначе новый тёзка получал бы чужие ответы работодателей. Гонку двух
 * одновременных выдач решает уникальный индекс: проигравший кандидат
 * отбрасывается, и берётся следующий.
 */
function jt_jupiter_mailbox(string $userId): ?string {
    $box = sb_single('jm_jupiter_mailboxes', ['user_id' => 'eq.' . $userId], 'address');
    if (!empty($box['address'])) return $box['address'];
    $user = sb_single('jm_users', ['id' => 'eq.' . $userId], 'first_name,last_name,is_blocked');
    if (!$user || !empty($user['is_blocked'])) return null;
    $base = jt_mail_base((string)($user['first_name'] ?? ''), (string)($user['last_name'] ?? ''));
    foreach (jt_mail_candidates($base) as $local) {
        $address = $local . '@' . JT_MAIL_DOMAIN;
        if (sb_single('jm_jupiter_mailboxes', ['address' => 'eq.' . $address], 'user_id')
            || sb_single('jm_jupiter_retired_addresses', ['address' => 'eq.' . $address], 'address')) {
            continue;
        }
        try {
            sb('POST', 'jm_jupiter_mailboxes', ['on_conflict' => 'user_id'], [
                'user_id' => $userId, 'address' => $address,
            ], ['Prefer: resolution=ignore-duplicates,return=representation']);
        } catch (RuntimeException $e) {
            continue;   // адрес успел занять другой — пробуем следующий
        }
        // Своя строка или строка параллельного запроса того же человека.
        $box = sb_single('jm_jupiter_mailboxes', ['user_id' => 'eq.' . $userId], 'address');
        if (!empty($box['address'])) return $box['address'];
    }
    return null;
}

function jt_new_user_id_is_valid(string $id): bool {
    return preg_match('~\A[a-z0-9]{8,32}\z~', $id) === 1;
}

/**
 * Адрес вакансии без рекламных меток, якоря и регистра хоста.
 *
 * По нему считается повтор. Та же вакансия из рассылки и из ленты отличается
 * только метками — и без нормализации была бы новой заявкой, то есть вторым
 * откликом одному работодателю.
 */
function jupiter_canonical_url(string $url): string
{
    $parts = @parse_url(trim($url));
    if (!$parts || empty($parts['host'])) return '';
    $scheme = strtolower((string)($parts['scheme'] ?? ''));
    if (!in_array($scheme, ['http', 'https'], true)) return '';
    $drop = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'utm_referrer', 'gclid', 'yclid', 'fbclid', 'ysclid', '_openstat',
        'from', 'ref', 'referrer', 'source',
    ];
    $query = [];
    if (!empty($parts['query'])) {
        parse_str($parts['query'], $query);
        foreach (array_keys($query) as $key) {
            if (in_array(strtolower((string)$key), $drop, true)) unset($query[$key]);
        }
        ksort($query);
    }
    $path = rtrim((string)($parts['path'] ?? ''), '/');
    if ($path === '') $path = '/';
    $out = $scheme . '://' . strtolower((string)$parts['host']);
    if (!empty($parts['port'])) $out .= ':' . (int)$parts['port'];
    $out .= $path;
    if ($query) $out .= '?' . http_build_query($query);
    return mb_substr($out, 0, 2048);
}

function now_iso(): string {
    $ms = intval(microtime(true) * 1000) % 1000;
    return gmdate('Y-m-d\TH:i:s') . '.' . str_pad((string)$ms, 3, '0', STR_PAD_LEFT) . 'Z';
}

function sb(string $method, string $table, array $query = [], $body_data = null, array $extra_hdrs = []): array {
    $url = SB_URL . '/rest/v1/' . $table;
    if (!empty($query)) $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    $hdrs = [
        'apikey: ' . SB_KEY,
        'Authorization: Bearer ' . SB_KEY,
        'Content-Type: application/json',
    ];
    foreach ($extra_hdrs as $h) $hdrs[] = $h;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $hdrs,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($body_data !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body_data));
    $resp = curl_exec($ch); $err = curl_error($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($err) throw new RuntimeException('curl: ' . $err);
    $dec = json_decode($resp ?: '[]', true);
    if ($code >= 400 && is_array($dec) && isset($dec['message'])) throw new RuntimeException($dec['message']);
    return is_array($dec) ? $dec : [];
}

/**
 * Сколько строк в таблице — без выкачивания самих строк.
 *
 * PostgREST отдаёт число в заголовке Content-Range, если попросить
 * Prefer: count=exact и ограничить выдачу одной строкой. Через sb() так
 * нельзя: она отдаёт только тело ответа.
 */
function sb_count(string $t, array $f = []): int {
    $q = array_merge(['select' => 'id'], $f);
    $url = SB_URL . '/rest/v1/' . $t . '?' . http_build_query($q, '', '&', PHP_QUERY_RFC3986);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . SB_KEY,
            'Authorization: Bearer ' . SB_KEY,
            'Prefer: count=exact',
            'Range: 0-0',
        ],
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp = curl_exec($ch);
    curl_close($ch);
    if (!is_string($resp)) return 0;
    // Content-Range: 0-0/357
    return preg_match('#Content-Range:\s*[^/]+/(\d+)#i', $resp, $m) ? (int)$m[1] : 0;
}

const YANDEX_METRIKA_COUNTER_ID = 109805381;

/** Один запрос к Reporting API. Неполный отчёт не отправляем. */
function ym_stat(string $token, array $params): array {
    $params = array_merge([
        'ids' => YANDEX_METRIKA_COUNTER_ID,
        'accuracy' => 'full',
    ], $params);
    $url = 'https://api-metrika.yandex.net/stat/v1/data?'
        . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: OAuth ' . $token],
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $raw = curl_exec($ch);
    $error = curl_error($ch);
    $errno = curl_errno($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) {
        throw new RuntimeException("Яндекс.Метрика недоступна: curl {$errno}: {$error}");
    }
    $result = json_decode($raw, true);
    if ($code >= 400 || !is_array($result)) {
        $description = is_array($result)
            ? (string)($result['message'] ?? $result['errors'][0]['message'] ?? '')
            : json_last_error_msg();
        throw new RuntimeException("Яндекс.Метрика ответила HTTP {$code}: {$description}");
    }
    return $result;
}

function ym_daily_report(string $token): array {
    $tz = new DateTimeZone('Europe/Moscow');
    $today = (new DateTimeImmutable('now', $tz))->setTime(0, 0);
    $day = $today->modify('-1 day');
    $previousDay = $today->modify('-2 days');
    $metrics = 'ym:s:visits,ym:s:users,ym:s:bounceRate';
    $bySource = ym_stat($token, [
        'date1' => $day->format('Y-m-d'),
        'date2' => $day->format('Y-m-d'),
        'metrics' => $metrics,
        // Источник самого визита, а не «последний значимый». lastSign
        // приписывает поиску последующие прямые заходы того же человека:
        // по нему выходило 29 визитов из поиска там, где их было 3.
        'dimensions' => 'ym:s:lastTrafficSource',
        'limit' => 100,
    ]);
    $previous = ym_stat($token, [
        'date1' => $previousDay->format('Y-m-d'),
        'date2' => $previousDay->format('Y-m-d'),
        'metrics' => 'ym:s:visits',
    ]);
    $search30 = ym_stat($token, [
        'date1' => $day->modify('-29 days')->format('Y-m-d'),
        'date2' => $day->format('Y-m-d'),
        'metrics' => 'ym:s:visits,ym:s:users',
        'filters' => "ym:s:lastTrafficSource=='organic'",
    ]);

    $totals = $bySource['totals'] ?? [];
    $sources = ['organic' => 0, 'direct' => 0, 'referral' => 0, 'social' => 0];
    foreach (($bySource['data'] ?? []) as $row) {
        $source = (string)($row['dimensions'][0]['id'] ?? '');
        if (array_key_exists($source, $sources)) {
            $sources[$source] = (int)round((float)($row['metrics'][0] ?? 0));
        }
    }
    return [
        'date' => $day->format('d.m.Y'),
        'visits' => (int)round((float)($totals[0] ?? 0)),
        'users' => (int)round((float)($totals[1] ?? 0)),
        'bounce_rate' => (float)($totals[2] ?? 0),
        'previous_visits' => (int)round((float)($previous['totals'][0] ?? 0)),
        'search_30d' => (int)round((float)($search30['totals'][0] ?? 0)),
        // Люди важнее визитов: три визита от трёх человек и три от одного —
        // разные новости, а по одному числу их не отличить.
        'search_30d_users' => (int)round((float)($search30['totals'][1] ?? 0)),
        'sources' => $sources,
    ];
}

// Поля пользователя, которые можно отдавать клиенту.
//
// Раньше здесь стояла звёздочка, и вместе с профилем наружу уходило поле
// password. Пропуск к db.php публичен по своей природе — он лежит в бандле
// сайта, — так что одним запросом dbGetUsers выгружалась вся база: телефон
// и пароль каждого. Перечисляем поля поимённо: добавится новое, оно не
// просочится само собой.
define('USER_PUBLIC_COLS', implode(',', [
    'id', 'role', 'first_name', 'last_name', 'age',
    'metro_line_id', 'metro_station', 'work_types', 'company', 'bio',
    'resume_data',
    'avatar_url', 'avg_rating', 'rating_count', 'is_blocked',
    'created_at', 'last_seen_at',
    // Поручительство: скольких приведённых этот человек довёл до смены.
    // Отдаётся всем, кто видит карточку, — в этом и смысл награды: она
    // работает, только если её видит работодатель.
    'referral_worked',
]));

define('USER_SELF_COLS', USER_PUBLIC_COLS . ',phone,resume_email,resume_file_name,resume_imported_at,personal_data');

// bcrypt-хеш от пароля, положенного как есть, отличается началом строки.
// Версии три — $2a$, $2b$, $2y$: приложение хеширует библиотекой bcryptjs
// и даёт $2b$, PHP даёт $2y$, и проверить чужой хеш умеет каждый из них
// (проверено в обе стороны).
function is_bcrypt(string $s): bool {
    return (bool)preg_match('/^\$2[aby]\$/', $s);
}

function sb_select(string $t, array $f = [], string $sel = '*', ?string $ord = null): array {
    $q = array_merge(['select' => $sel], $f);
    if ($ord) $q['order'] = $ord;
    return sb('GET', $t, $q);
}

// Supabase режет выборку до 1000 строк — для агрегатов тянем всё постранично
function sb_select_all(string $t, array $f = [], string $sel = '*'): array {
    $all = []; $page = 1000; $off = 0;
    while (true) {
        $q = array_merge(['select' => $sel, 'limit' => (string)$page, 'offset' => (string)$off], $f);
        $rows = sb('GET', $t, $q);
        foreach ($rows as $r) $all[] = $r;
        if (count($rows) < $page) break;
        $off += $page;
    }
    return $all;
}

function sb_single(string $t, array $f = [], string $sel = '*'): ?array {
    $rows = sb_select($t, array_merge($f, ['limit' => '1']), $sel);
    return !empty($rows) ? $rows[0] : null;
}

// Сигнал приложению уходит отсюда, из обёрток записи, а не из мест вызова:
// так о нём невозможно забыть при следующей правке. Он идёт после самой
// записи — сначала данные, потом слово о них.
function sb_insert(string $t, array $data, bool $ret = false): array {
    $r = sb('POST', $t, [], $data, [$ret ? 'Prefer: return=representation' : 'Prefer: return=minimal']);
    rt_touch($t);
    return $r;
}

function sb_upsert(string $t, array $data, string $conflict = '', bool $ret = false): array {
    $pref = 'resolution=merge-duplicates,return=' . ($ret ? 'representation' : 'minimal');
    $q = $conflict ? ['on_conflict' => $conflict] : [];
    $r = sb('POST', $t, $q, $data, ['Prefer: ' . $pref]);
    rt_touch($t);
    return $r;
}

function sb_update(string $t, array $f, array $data): void {
    sb('PATCH', $t, $f, $data, ['Prefer: return=minimal']);
    rt_touch($t);
}

function sb_delete(string $t, array $f): void {
    sb('DELETE', $t, $f);
    rt_touch($t);
}

// ─── Приватное хранилище PDF-резюме ───────────────────────────────────────
function jt_resume_storage_upload(string $path, string $bytes): void {
    $ch = curl_init(SB_URL . '/storage/v1/object/resume-files/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_POSTFIELDS => $bytes,
        CURLOPT_TIMEOUT => 90,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SB_KEY,
            'Authorization: Bearer ' . SB_KEY,
            'Content-Type: application/pdf',
            'x-upsert: false',
        ],
    ]);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($code < 200 || $code >= 300) {
        throw new RuntimeException($err ?: ('хранилище резюме ответило ' . $code . ': ' . substr((string)$resp, 0, 180)));
    }
}

function jt_resume_storage_delete(string $path): void {
    if ($path === '') return;
    $ch = curl_init(SB_URL . '/storage/v1/object/resume-files/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SB_KEY,
            'Authorization: Bearer ' . SB_KEY,
        ],
    ]);
    curl_exec($ch);
    curl_close($ch);
}

function jt_resume_signed_url(string $path): string {
    $ch = curl_init(SB_URL . '/storage/v1/object/sign/resume-files/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['expiresIn' => 3600]),
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SB_KEY,
            'Authorization: Bearer ' . SB_KEY,
            'Content-Type: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $dec = json_decode($resp ?: 'null', true);
    if ($code < 200 || $code >= 300 || empty($dec['signedURL'])) {
        throw new RuntimeException('Не удалось открыть PDF');
    }
    return SB_URL . '/storage/v1' . $dec['signedURL'];
}

function jt_resume_sync_user(string $uid, ?array $row): void {
    if ($row === null) {
        sb_update('jm_users', ['id' => 'eq.' . $uid], [
            'resume_data' => null,
            'resume_email' => null,
            'resume_file_name' => null,
            'resume_imported_at' => null,
        ]);
        return;
    }
    sb_update('jm_users', ['id' => 'eq.' . $uid], [
        'resume_data' => $row['resume_data'] ?? null,
        'resume_email' => $row['resume_email'] ?? null,
        'resume_file_name' => $row['file_name'] ?? null,
        'resume_imported_at' => $row['imported_at'] ?? null,
    ]);
}

function sb_rpc(string $fn, array $params = []): mixed {
    $url = SB_URL . '/rest/v1/rpc/' . $fn;
    $hdrs = ['apikey: ' . SB_KEY, 'Authorization: Bearer ' . SB_KEY, 'Content-Type: application/json'];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_HTTPHEADER => $hdrs, CURLOPT_TIMEOUT => 10, CURLOPT_SSL_VERIFYPEER => true]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($params));
    $resp = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $status >= 400 || $status === 0) {
        throw new RuntimeException('Не удалось выполнить запрос к базе: ' . $fn);
    }
    return json_decode($resp ?: 'null', true);
}


// ─── Секреты приложения ──────────────────────────────────────────────────────
// Раньше они лежали прямо в коде «на всякий случай». Пока репозиторий был
// закрытым, это сходило с рук; как только он стал публичным, токен бота и
// секрет приложения оказались доступны любому поиском по коду.
//
// Теперь берём их с хостинга: из переменных окружения либо из файла
// app_secrets.php рядом (см. app_secrets.example.php). Расширение .php не
// случайно: по прямой ссылке сервер выполнит файл и отдаст пустоту.
function jt_secret(string $name, string $fallback = ''): string {
    static $file = null;
    $env = getenv($name);
    if (is_string($env) && trim($env) !== '') return trim($env);

    if ($file === null) {
        $p = __DIR__ . '/app_secrets.php';
        $v = is_readable($p) ? @include $p : null;
        $file = is_array($v) ? $v : [];
    }
    if (!empty($file[$name])) return (string)$file[$name];

    return $fallback;
}

// ─── Пользовательские сессии ─────────────────────────────────────────────────
function jt_b64url_encode(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}
function jt_b64url_decode(string $raw): string|false {
    $pad = strlen($raw) % 4;
    if ($pad) $raw .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($raw, '-_', '+/'), true);
}
// ─── Перебор ──────────────────────────────────────────────────────────────────
//
// Вход — это номер телефона и пароль, и оба подбираются: `dbCheckPhoneExists`
// отвечает, есть ли такой номер, а `dbLogin` — верен ли к нему пароль. Обе
// операции публичные (иначе нельзя ни зарегистрироваться, ни войти), и до сих
// пор ни одна из них не считала попытки. В админке такой счёт есть с самого
// начала — здесь его не было, хотя перебирать выгоднее как раз здесь.
//
// Счёт файловый, как в admin.php: база для этого слишком дорога, а запрос
// ронять из-за счётчика нельзя. REMOTE_ADDR — настоящий адрес клиента: nginx
// отдаёт PHP по FastCGI и стоит на краю, без второго прокси перед собой.
const JT_TRY_WINDOW = 900;          // 15 минут
const JT_TRY_MAX = ['login' => 10, 'phone' => 30];

function jt_try_file(string $kind): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return sys_get_temp_dir() . '/jm_try_' . $kind . '_' . hash('sha256', $ip) . '.json';
}

function jt_try_blocked(string $kind): bool {
    $st = json_decode((string)@file_get_contents(jt_try_file($kind)), true);
    if (!is_array($st)) return false;
    if ((int)($st['since'] ?? 0) + JT_TRY_WINDOW < time()) return false;
    return (int)($st['fails'] ?? 0) >= (JT_TRY_MAX[$kind] ?? 10);
}

function jt_try_note(string $kind): void {
    $f = jt_try_file($kind);
    $st = json_decode((string)@file_get_contents($f), true);
    if (!is_array($st) || (int)($st['since'] ?? 0) + JT_TRY_WINDOW < time()) {
        $st = ['since' => time(), 'fails' => 0];
    }
    $st['fails'] = (int)($st['fails'] ?? 0) + 1;
    @file_put_contents($f, json_encode($st), LOCK_EX);
}

function jt_try_reset(string $kind): void { @unlink(jt_try_file($kind)); }

// Ключ подписи сессий — свой, а не ключ базы.
//
// Раньше при пустом SESSION_SECRET подпись считалась ключом Supabase. Две беды
// сразу: ротация ключа базы разлогинивала всех разом, а если ключ до сервера
// не доехал и оказался пустым, подпись считалась пустым ключом — и токен на
// любой чужой uid подделывался в две строки.
//
// Теперь ключ берётся свой (bootstrap.sh заводит его при первом запуске), а
// ключ базы остаётся запасным, пока свой не доехал: иначе эта правка в момент
// выкатки положила бы вход всем. Пустым ключ не бывает ни при каком раскладе —
// на этом и держалась подделка.
function jt_session_key(): string {
    $key = jt_secret('SESSION_SECRET');
    if ($key === '') $key = SB_KEY;
    if ($key === '') {
        // Подписывать нечем. Молчать нельзя: пустой ключ — это подделываемые
        // токены, то есть вход под любым чужим id.
        jt_respond(['error' => 'Server is not configured to issue sessions'], 500);
        exit;
    }
    return $key;
}
/**
 * Ключ, которым подписаны токены, выданные до появления SESSION_SECRET.
 *
 * Принимается только на проверке — тот же приём, что с APP_SECRET_PREV: дать
 * уже выданным токенам дожить, а не разлогинивать четыреста человек разом.
 */
function jt_session_key_prev(): string {
    return jt_secret('SESSION_SECRET') !== '' ? SB_KEY : '';
}
function jt_session_issue(string $uid): string {
    $payload = jt_b64url_encode(json_encode([
        'uid' => $uid, 'iat' => time(), 'exp' => time() + 30 * 86400,
    ], JSON_UNESCAPED_SLASHES));
    $sig = jt_b64url_encode(hash_hmac('sha256', $payload, jt_session_key(), true));
    return $payload . '.' . $sig;
}
/**
 * Кто предъявил токен — или null.
 *
 * Возвращает пару [uid, iat]: время выдачи нужно, чтобы смена пароля и
 * блокировка гасили уже выданные токены. У токенов, выданных до этой правки,
 * iat нет — считаем их выданными в нулевой момент, то есть первая же смена
 * пароля их погасит.
 */
function jt_session_claims(string $header): ?array {
    if (!preg_match('/^Bearer\s+(.+)$/i', trim($header), $m)) return null;
    $parts = explode('.', trim($m[1]), 2);
    if (count($parts) !== 2) return null;
    [$payload, $provided] = $parts;
    $ok = false;
    foreach ([jt_session_key(), jt_session_key_prev()] as $key) {
        if ($key === '') continue;
        if (hash_equals(jt_b64url_encode(hash_hmac('sha256', $payload, $key, true)), $provided)) {
            $ok = true; break;
        }
    }
    if (!$ok) return null;
    $raw = jt_b64url_decode($payload);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($data) || empty($data['uid']) || (int)($data['exp'] ?? 0) < time()) return null;
    return ['uid' => (string)$data['uid'], 'iat' => (int)($data['iat'] ?? 0)];
}
function jt_session_uid(string $header): ?string {
    $c = jt_session_claims($header);
    return $c === null ? null : $c['uid'];
}

// ─── Мгновенные сообщения ─────────────────────────────────────────────────────
// Раньше телефон слушал саму таблицу сообщений. Как только доступ к таблицам
// закрыли, такая подписка замолкает — она подчиняется тем же правилам.
//
// Поэтому сигналим иначе: сервер шлёт короткое «в этом чате что-то новое»
// через канал трансляций, а телефон в ответ забирает сообщения обычным путём,
// через прокси. Канал таблиц не касается, правила ему не помеха.
//
// В сигнале намеренно нет текста: каналы трансляции публичные, и всё, что
// туда попадёт, сможет прочитать любой, кто угадает имя канала. Пусть знает
// только то, что где-то шевельнулось.

/**
 * Разделы, об изменении которых приложению стоит узнать сразу.
 *
 * Раньше оно узнавало об этом подпиской на сами таблицы. Но чтобы такая
 * подписка что-то приносила, ключу приложения нужны права на чтение — а он
 * лежит в каждой установленной сборке и достаётся оттуда кем угодно. Ради
 * живой ленты пришлось бы открыть постороннему телефоны и переписку.
 *
 * Поэтому наружу уходит только имя раздела, без единой строки данных. По
 * нему приложение перечитывает нужное через этот же прокси, где проверяется
 * пропуск. Ключ из телефона годится ровно на одно: услышать «обновись».
 */
const RT_SECTIONS = [
    'jm_vacancies'        => 'vacancies',
    'jm_chats'            => 'chats',
    'jm_messages'         => 'chats',
    'jm_likes'            => 'likes',
    'jm_perm_vacancies'   => 'perm_vacancies',
    'jm_perm_applications'=> 'perm_applications',
    // jm_users намеренно нет. В эту таблицу пишется отметка «был в сети» —
    // у каждого человека раз в несколько минут. Сигнал оттуда заставлял бы
    // все открытые приложения перечитывать список из четырёхсот профилей
    // без всякого повода. Профиль меняется редко, и его подхватывает
    // обычное обновление по таймеру.
    'jm_saved'            => 'saved',
    'jm_perm_saved'       => 'perm_saved',
    'jm_ratings'          => 'ratings',
    'jm_notifications'    => 'notifications',
];

/**
 * Сказать приложению, что раздел изменился.
 *
 * Зовётся из обёрток записи, а не из мест вызова: так о новом разделе
 * невозможно забыть, а забытый сигнал — это молча не обновляющийся экран,
 * и никто не поймёт почему.
 */
function rt_touch(string $table): void {
    // За один запрос про раздел говорим однажды. Одна отправка отклика
    // трогает и лайки, и чаты, и сообщения; рассылка уведомлений — четыреста
    // строк подряд, и столько же сигналов были бы вредны, а не полезны.
    static $sent = [];
    static $broken = false;
    if ($broken) return;

    $what = RT_SECTIONS[$table] ?? null;
    if ($what === null || isset($sent[$what])) return;
    $sent[$what] = true;

    // Realtime молчит — перестаём его дёргать до конца запроса. Иначе
    // одиннадцать разделов по четыре секунды тайм-аута превратятся в
    // сорок секунд ожидания у человека, отправившего одно сообщение.
    if (!rt_broadcast('jt', 'changed', ['что' => $what])) $broken = true;
}

function rt_broadcast(string $topic, string $event, array $payload = []): bool {
    $body = json_encode([
        'messages' => [['topic' => $topic, 'event' => $event, 'payload' => $payload]],
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init(SB_URL . '/realtime/v1/api/broadcast');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        // Коротко: сообщение уже записано, и если сигнал не уйдёт, телефон
        // всё равно подхватит его следующим опросом.
        CURLOPT_TIMEOUT => 4,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SB_KEY,
            'Authorization: Bearer ' . SB_KEY,
            'Content-Type: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $resp !== false && $code >= 200 && $code < 300;
}

// Единственное место, где сообщения попадают в базу: и обычные, и системные.
// Сигнал уходит отсюда, чтобы его нельзя было забыть добавить.
function msg_insert(array $row): array {
    sb_insert('jm_messages', $row);
    try {
        if (!empty($row['chat_id'])) {
            rt_broadcast('chat:' . $row['chat_id'], 'refresh');
        }
    } catch (\Throwable $e) {
        // Отправка сообщения не должна падать из-за сигнала.
    }
    return $row;
}

// ─── Карточка вакансии в чате ─────────────────────────────────────────────────
// Чат теперь один на пару людей, и в нём может идти речь о нескольких сменах.
// Чтобы не путаться, каждый новый отклик открывается карточкой: что за работа,
// когда и где. Раньше это висело полосой в шапке чата и относилось непонятно
// к чему — при второй смене шапка показывала бы только одну из них.
//
// Текстом, а не значками: карточка попадает и в список чатов, и в пуш, а там
// разметки нет. Эмодзи не ставим — от них в чате договорились уходить.

function fmt_date_ru(string $iso): string {
    if ($iso === '') return '';
    $ts = strtotime($iso);
    if (!$ts) return $iso;
    $days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return $days[(int)date('w', $ts)] . ' ' . date('d.m', $ts);
}

/**
 * Завести переписку по отклику (или подхватить существующую).
 *
 * Чат один на пару людей, а не на каждую вакансию: директор с тремя сменами
 * получал три отдельные переписки с одним человеком, и разговор рассыпался.
 *
 * Первым сообщением идёт карточка вакансии — от системы, это справка. А вот
 * сам отклик пишет человек, и отправляется он от его имени. Раньше и отклик
 * слался от «system» шаблоном «Меня заинтересовала ваша вакансия»: на той
 * стороне видели автоответчик, и отвечать было нечему — из 132 чатов в 50
 * не прозвучало ни одного живого слова.
 *
 * $from — кто написал первое сообщение: true или 'worker' — работник,
 * 'employer' — работодатель, всё остальное — система.
 *
 * Работодатель появился здесь после разбора чата, где директор одобрила
 * кандидата и оба замолчали: чат открылся шаблоном «Поздравляем, свяжитесь с
 * кандидатом», и каждый стал ждать другого. На вопрос «почему перестали»
 * директор ответила: «не удобно, ни кто не писал» — буквально так и было,
 * два системных сообщения и ни одного человеческого.
 */
function chat_ensure(string $wid, string $eid, string $vid, string $vt, string $cn,
                     ?string $sm, int $uw, int $ue, bool|string $from = false): string {
    $author = ($from === true || $from === 'worker') ? $wid
            : ($from === 'employer' ? $eid : 'system');

    $ex = sb_single('jm_chats',
        ['worker_id' => 'eq.' . $wid, 'employer_id' => 'eq.' . $eid],
        'id,vacancy_id,unread_worker,unread_employer');

    if ($ex) {
        $cid = $ex['id'];
        // Карточку вакансии повторять незачем — чат уже про неё. А вот живое
        // сообщение уходит всегда: директор одобряет кандидата в той же
        // переписке, которую тот открыл своим откликом, и на «та же вакансия —
        // ничего не добавляем» его первые слова пропадали молча.
        $newVac = $vid !== '' && ($ex['vacancy_id'] ?? '') !== $vid;
        if ($newVac) {
            sb_update('jm_chats', ['id' => 'eq.' . $cid], [
                'vacancy_id' => $vid,
                'vac_title' => $vt,
                'company_name' => $cn,
                'unread_worker' => (int)($ex['unread_worker'] ?? 0) + $uw,
                'unread_employer' => (int)($ex['unread_employer'] ?? 0) + $ue,
            ]);
            $card = vacancy_card_text($vid);
            if ($card) {
                msg_insert(['id' => uid(), 'chat_id' => $cid, 'sender_id' => 'system',
                    'text' => $card, 'created_at' => now_iso()]);
            }
        } elseif ($sm !== null && $sm !== '' && ($uw > 0 || $ue > 0)) {
            sb_update('jm_chats', ['id' => 'eq.' . $cid], [
                'unread_worker' => (int)($ex['unread_worker'] ?? 0) + $uw,
                'unread_employer' => (int)($ex['unread_employer'] ?? 0) + $ue,
            ]);
        }
        if ($sm !== null && $sm !== '') {
            msg_insert(['id' => uid(), 'chat_id' => $cid, 'sender_id' => $author,
                'text' => $sm, 'created_at' => now_iso()]);
        }
        return $cid;
    }

    $cid = uid();
    sb_insert('jm_chats', ['id' => $cid, 'vacancy_id' => $vid, 'worker_id' => $wid,
        'employer_id' => $eid, 'vac_title' => $vt, 'company_name' => $cn,
        'unread_worker' => $uw, 'unread_employer' => $ue, 'created_at' => now_iso()]);
    $card = vacancy_card_text($vid);
    if ($card) {
        msg_insert(['id' => uid(), 'chat_id' => $cid, 'sender_id' => 'system',
            'text' => $card, 'created_at' => now_iso()]);
    }
    if ($sm) {
        msg_insert(['id' => uid(), 'chat_id' => $cid, 'sender_id' => $author,
            'text' => $sm, 'created_at' => now_iso()]);
    }
    return $cid;
}

function vacancy_card_text(string $vid): ?string {
    if (trim($vid) === '') return null;

    $v = sb_single('jm_vacancies', ['id' => 'eq.' . $vid]);
    if ($v) {
        $lines = ['Смена: ' . trim((string)($v['title'] ?? ''))];
        $date = fmt_date_ru((string)($v['date'] ?? ''));
        $time = ($v['time_start'] ?? '') && ($v['time_end'] ?? '')
            ? $v['time_start'] . '–' . $v['time_end'] : '';
        $when = trim($date . ($date && $time ? ', ' : '') . $time);
        if ($when !== '') $lines[] = 'Когда: ' . $when;
        $where = trim((string)($v['address'] ?? ''));
        if ($where === '' && !empty($v['metro_station'])) $where = 'м. ' . $v['metro_station'];
        if ($where !== '') $lines[] = 'Где: ' . $where;
        return implode("\n", $lines);
    }

    $p = sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vid]);
    if ($p) {
        $lines = ['Постоянная работа: ' . trim((string)($p['title'] ?? ''))];
        if (!empty($p['schedule'])) $lines[] = 'График: ' . $p['schedule'];
        $where = trim((string)($p['address'] ?? ''));
        if ($where === '' && !empty($p['metro_station'])) $where = 'м. ' . $p['metro_station'];
        if ($where !== '') $lines[] = 'Где: ' . $where;
        return implode("\n", $lines);
    }

    return null;
}

// ─── Адреса и координаты ──────────────────────────────────────────────────────
// Геокодер только один — Яндекс (сервер в РФ: 152-ФЗ, локализация данных). Ключ
// серверный, лежит в app_secrets.php (YANDEX_GEOCODER_KEY). Иностранных
// геокодеров в проекте нет: если ключа нет или Яндекс молчит — координаты просто
// не определяются, но ни один запрос за границу не уходит. Все вызовы идут через
// geo_search() ниже.

// Серверный ключ Яндекс.Геокодера. Пусто — координаты не определяются.
function yandex_geocoder_key(): string {
    return jt_secret('YANDEX_GEOCODER_KEY');
}

// Геокодер Яндекса (HTTP API). Сервер в РФ. Формат ответа:
// response.GeoObjectCollection.featureMember[].GeoObject, координаты в
// Point.pos как «lon lat». Возвращаем список
// [ ['name'=>..., 'lat'=>float, 'lng'=>float], ... ].
function yandex_geocode_search(string $q, int $timeout = 6): array {
    $key = yandex_geocoder_key();
    if ($key === '') return [];
    $url = 'https://geocode-maps.yandex.ru/1.x/?' . http_build_query([
        'apikey'  => $key,
        'format'  => 'json',
        'geocode' => $q,
        'lang'    => 'ru_RU',
        'results' => 7,
        // Смещаем выдачу к Москве и области, но не жёстко (rspn=0).
        'll'   => '37.62,55.75',
        'spn'  => '1.30,0.80',
        'rspn' => 0,
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);
    $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    $dec = json_decode($resp ?: 'null', true);
    if ($code !== 200 || !is_array($dec)) return [];

    $members = $dec['response']['GeoObjectCollection']['featureMember'] ?? null;
    if (!is_array($members)) return [];

    $out = [];
    foreach ($members as $m) {
        $obj = $m['GeoObject'] ?? null;
        if (!is_array($obj)) continue;
        $pos = trim((string)($obj['Point']['pos'] ?? '')); // «lon lat»
        if ($pos === '') continue;
        $parts = explode(' ', $pos);
        if (count($parts) < 2) continue;
        $lon = (float)$parts[0];
        $lat = (float)$parts[1];
        // Полный адрес: metaDataProperty.GeocoderMetaData.text, без «Россия,».
        $text = $obj['metaDataProperty']['GeocoderMetaData']['text']
            ?? trim(((string)($obj['description'] ?? '')) . ', ' . ((string)($obj['name'] ?? '')), ', ');
        $text = preg_replace('/^\s*Россия,\s*/u', '', (string)$text);
        $out[] = ['name' => $text, 'lat' => $lat, 'lng' => $lon];
    }
    return $out;
}

// Серверный ключ Яндекс.Геосаджеста (подсказки адреса). Российский сервис.
function yandex_suggest_key(): string {
    return jt_secret('YANDEX_SUGGEST_KEY');
}

// Яндекс.Геосаджест (suggest-maps.yandex.ru): подсказки адреса при вводе.
// Возвращаем ту же форму [ ['name'=>..., 'lat'=>float|null, 'lng'=>float|null] ].
// Координаты достаём из uri (ll=<lon>,<lat>), если Яндекс их отдал; иначе null —
// поле адреса и без координат работает (просто без метки на карте).
function yandex_suggest_search(string $q, int $timeout = 6): array {
    $key = yandex_suggest_key();
    if ($key === '') return [];
    $url = 'https://suggest-maps.yandex.ru/v1/suggest?' . http_build_query([
        'apikey'        => $key,
        'text'          => $q,
        'lang'          => 'ru',
        'results'       => 7,
        'print_address' => 1,
        // Смещаем подсказки к Москве и области.
        'll'  => '37.62,55.75',
        'spn' => '1.30,0.80',
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);
    $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    $dec = json_decode($resp ?: 'null', true);
    if ($code !== 200 || !is_array($dec)) return [];

    $results = $dec['results'] ?? null;
    if (!is_array($results)) return [];

    $out = [];
    foreach ($results as $r) {
        $name = $r['address']['formatted_address']
            ?? trim(((string)($r['title']['text'] ?? '')) . ', ' . ((string)($r['subtitle']['text'] ?? '')), ', ');
        $name = preg_replace('/^\s*Россия,\s*/u', '', (string)$name);
        if ($name === '') continue;
        $lat = null; $lng = null;
        $uri = (string)($r['uri'] ?? '');
        // ymapsbm1://geo?ll=<lon>,<lat>&… — координаты, если пришли.
        if ($uri !== '' && preg_match('/[?&]ll=([-0-9.]+)(?:,|%2C)([-0-9.]+)/i', $uri, $mm)) {
            $lng = (float)$mm[1];
            $lat = (float)$mm[2];
        }
        $out[] = ['name' => $name, 'lat' => $lat, 'lng' => $lng];
    }
    return $out;
}

// Единая точка поиска адреса — только российские сервисы Яндекса. Если есть
// ключ HTTP-геокодера — берём его (даёт координаты точно); иначе — Геосаджест
// (подсказки, координаты по возможности). Иностранных сервисов здесь нет.
function geo_search(string $q, int $timeout = 6): array {
    if (yandex_geocoder_key() !== '') {
        $hits = yandex_geocode_search($q, $timeout);
        if (!empty($hits)) return $hits;
    }
    return yandex_suggest_search($q, $timeout);
}

// Работодатели пишут адрес как придётся. Готовим несколько написаний одного
// и того же адреса — от самого точного к самому общему.
function address_variants(string $address): array {
    $v = [];
    $s = trim($address);
    if ($s === '') return $v;
    $v[] = $s;

    // «Ул.», «Ул,», «улица» в начале Nominatim только сбивают
    $t = preg_replace('/^\s*(ул[.,]?|улица)\s+/ui', '', $s);

    // Улицы называют в родительном падеже: не «Скульптура Мухиной», а
    // «Скульптора». Работодатели регулярно пишут именительный.
    $t = preg_replace('/\bСкульптура\b/ui', 'Скульптора', $t);
    $t = preg_replace('/\bАрхитектура\b/ui', 'Архитектора', $t);

    // «2й проезд» → «2-й проезд»
    $t = preg_replace('/\b(\d+)(й|я|е|го)\b/u', '$1-$2', $t);
    if ($t !== $s) $v[] = $t;

    // Без корпуса и строения: «Мневники 7к2» → «Мневники 7»
    $u = preg_replace('/\s*(\d+)\s*[кс]\s*\d+[а-я]?\s*$/ui', ' $1', $t);
    if ($u !== $t) $v[] = trim($u);

    // Совсем без номера дома — хотя бы попасть на нужную улицу
    $w = preg_replace('/[\s,]+\d.*$/u', '', $u);
    if (mb_strlen(trim($w)) > 4 && trim($w) !== trim($u)) $v[] = trim($w);

    return array_values(array_unique($v));
}

// Координаты по адресу. Возвращает [lat, lng] или null.
// Города за пределами Москвы (Красногорск, Химки и прочие) не трогаем: если
// дописать им «, Москва», геокодер уводит метку в другой конец области.
function geocode_address(string $address, int $timeout = 4, float $budget = 6.0): ?array {
    $deadline = microtime(true) + $budget;
    $outsideMoscow = (bool)preg_match(
        '/\b(красногорск|химки|люберцы|балашиха|мытищи|реутов|котельники|видное|одинцово|подольск|домодедово|щербинка|долгопрудный|лобня|дзержинский)\b/ui',
        $address
    );

    foreach (address_variants($address) as $q) {
        // Вариантов бывает четыре, и каждый — запрос наружу. Когда Nominatim
        // молчит, это десятки секунд, и PHP успевает упереться в лимит
        // времени раньше, чем дойдёт до записи. Дороже координат.
        if (microtime(true) >= $deadline) break;
        $full = $outsideMoscow ? $q . ', Московская область' : $q . ', Москва';
        foreach (geo_search($full, $timeout) as $hit) {
            if ($hit['lat'] !== null && $hit['lng'] !== null) {
                return [$hit['lat'], $hit['lng']];
            }
        }
    }
    return null;
}

// Горизонт публикации смен: не дальше двух недель вперёд и не больше
// четырнадцати дат за одну публикацию.
//
// Ограничение было только в форме создания, а форма живёт в приложении, и
// приложение у людей на руках бывает старым. Так и вышло: 10 июля в 08:23:58
// одним запросом приехали 63 смены на каждый день до 10 сентября. Правило,
// которое проверяется только на клиенте, — не правило.
define('VACANCY_HORIZON_DAYS', 14);

function vacancy_dates_guard(array $rows): void {
    $today = new DateTimeImmutable('today', new DateTimeZone('Europe/Moscow'));
    $limit = $today->modify('+' . VACANCY_HORIZON_DAYS . ' days');
    $dates = [];
    foreach ($rows as $r) {
        $d = trim((string)($r['date'] ?? ''));
        if ($d === '') continue;
        $dates[$d] = true;
        $when = DateTimeImmutable::createFromFormat('Y-m-d', $d, new DateTimeZone('Europe/Moscow'));
        if (!$when) {
            throw new RuntimeException('Не разобрал дату смены: ' . $d);
        }
        if ($when > $limit) {
            throw new RuntimeException(
                'Смену можно выложить не дальше чем на ' . VACANCY_HORIZON_DAYS . ' дней вперёд. '
                . 'Дата ' . $d . ' слишком далеко.'
            );
        }
    }
    if (count($dates) > VACANCY_HORIZON_DAYS) {
        throw new RuntimeException(
            'За одну публикацию можно выложить не больше ' . VACANCY_HORIZON_DAYS . ' дней, '
            . 'а пришло ' . count($dates) . '.'
        );
    }
}

/**
 * Не публикуем требования к полу, возрасту, национальности или внешности.
 * Законные специальные требования редки и должны пройти ручную проверку,
 * а не попадать в массовую ленту автоматически.
 */
function vacancy_content_guard(array $row): void {
    $text = mb_strtolower(implode(' ', array_map(
        fn($v) => is_scalar($v) ? (string)$v : '',
        [
            $row['title'] ?? '', $row['description'] ?? '',
            $row['conditions'] ?? '', $row['requirements'] ?? '',
        ]
    )));
    $blocked = [
        '~\\bмужчин[аы]?\\b|мужского\\s+пола~u',
        '~\\bженщин[аы]?\\b|женского\\s+пола~u',
        '~русскоязычн|славянск(?:ая|ой)\\s+внешност~u',
        '~\\b(?:до|от)\\s*\\d{2}\\s*(?:лет|года)~u',
        '~\\b\\d{2}\\s*[–—-]\\s*\\d{2}\\s*(?:лет|года)~u',
    ];
    foreach ($blocked as $pattern) {
        if (preg_match($pattern, $text)) {
            throw new RuntimeException(
                'Уберите требования к полу, возрасту, национальности или внешности. '
                . 'Оставьте только навыки и условия работы.'
            );
        }
    }
}

// Дописываем координаты в строку вакансии перед сохранением. Без этого метка
// на карте не появляется вовсе: раньше телефон геокодировал адреса сам при
// каждом открытии карты, и пока все тридцать запросов не пройдут, на карте
// висела одна-единственная вакансия.
/**
 * Сохранить, а потом искать координаты.
 *
 * Раньше порядок был обратный: сначала геокодер, потом запись. Адрес идёт
 * во внешнюю службу до четырёх раз, и если та молчит, PHP упирается в лимит
 * времени и умирает — до того, как что-либо сохранит. Вакансия пропадала
 * целиком, а человек получал обрывок вместо ответа и не понимал, почему
 * «не публикуется».
 *
 * Теперь запись первая. Не нашлись координаты — метка встанет у метро, это
 * мелочь по сравнению с потерянной вакансией.
 */
function save_then_geocode(string $table, array $row): void {
    sb_upsert($table, $row, 'id');

    $hasCoords = isset($row['lat']) && $row['lat'] !== null
              && isset($row['lng']) && $row['lng'] !== null;
    $address = trim((string)($row['address'] ?? ''));
    $id = (string)($row['id'] ?? '');
    if ($hasCoords || $address === '' || $id === '') return;

    try {
        $c = geocode_address($address);
        if ($c) sb_update($table, ['id' => 'eq.' . $id], ['lat' => $c[0], 'lng' => $c[1]]);
    } catch (\Throwable $e) {}
}

function fill_coords(array $row): array {
    $hasCoords = isset($row['lat']) && $row['lat'] !== null
              && isset($row['lng']) && $row['lng'] !== null;
    $address = trim((string)($row['address'] ?? ''));
    if ($hasCoords || $address === '') return $row;

    // Сохранение вакансии не должно падать из-за геокодера: не нашлось —
    // значит не нашлось, метка встанет у метро.
    try {
        $c = geocode_address($address);
        if ($c) { $row['lat'] = $c[0]; $row['lng'] = $c[1]; }
    } catch (\Throwable $e) {}

    return $row;
}

// ─── Telegram Mini App ────────────────────────────────────────────────────────

// Запасного значения тут нарочно нет. Прежний токен утёк вместе с открытым
// репозиторием, и посторонний переписывал боту описание на рекламу. Токен
// отозван и живёт только в GitHub Secrets (TG_BOT_TOKEN), откуда выкладка
// собирает app_secrets.php. Если он не задан — лучше явная тишина, чем
// работа на ключе, который знает чужой.
define('TG_BOT_TOKEN', jt_secret('TG_BOT_TOKEN'));
define('DASHBOARD_URL', getenv('DASHBOARD_URL') ?: 'https://admin.jobtoo.ru');
// Часы работы поддержки, по Москве. Обещать круглосуточный ответ и молчать
// до утра хуже, чем сразу сказать, когда ответят.
define('SUPPORT_FROM_HOUR', 10);
define('SUPPORT_TO_HOUR', 21);
// Единственная персональная настройка операторского уведомления.
// Значение — приватный Telegram chat_id владельца поддержки. Если не задано,
// бот никому лично не пишет.
define('SUPPORT_NOTIFY_TELEGRAM_ID', (int)jt_secret('SUPPORT_NOTIFY_TELEGRAM_ID'));

// Текущая редакция отдельного согласия на зарубежные каналы. Сервер
// проверяет её сам: старый клиент не должен обходить новый экран согласия.
define('JT_CROSSBORDER_CONSENT_VERSION', '2026-09-19');

/**
 * Отметка «обращение закрыто» (null — открыто).
 *
 * Таблицы может ещё не быть: миграции выкладываются отдельным ходом, и один
 * раз этот ход уже не состоялся. Ради служебной отметки нельзя ронять ни
 * обращение человека, ни ответ из дашборда — поэтому переживаем. Но не молча:
 * возвращаем, получилось ли, иначе дашборд напишет «закрыто», а обращение при
 * следующем обновлении вернётся в список, и будет непонятно почему.
 */
function support_thread_set(string $userId, ?string $closedAt): bool {
    if ($userId === '') return false;
    try {
        sb_upsert('jm_support_threads', [
            'user_id' => $userId, 'closed_at' => $closedAt, 'updated_at' => now_iso(),
        ], 'user_id');
        return true;
    } catch (Throwable $e) { return false; }
}

/** Явный вызов живого оператора. До этого момента диалог остаётся у помощника. */
function support_request_operator(string $userId, string $reason = ''): bool {
    if ($userId === '') return false;

    // Одно уведомление на новое обращение, а не на каждое сообщение в уже
    // открытом диалоге. После закрытия следующий вызов снова считается новым.
    $before = support_thread_state($userId);
    $wasWaiting = !empty($before['operator_requested_at']) && empty($before['closed_at']);

    try {
        sb_upsert('jm_support_threads', [
            'user_id' => $userId,
            'closed_at' => null,
            'operator_requested_at' => now_iso(),
            'operator_request_text' => $reason !== '' ? $reason : null,
            'updated_at' => now_iso(),
        ], 'user_id');
        if (!$wasWaiting) support_notify_owner();
        return true;
    } catch (Throwable $e) { return false; }
}

/** Состояние поддержки. Отсутствие строки означает обычный диалог с помощником. */
function support_thread_state(string $userId): array {
    if ($userId === '') return ['operator_requested_at' => null, 'closed_at' => null];
    try {
        $row = sb_single('jm_support_threads', ['user_id' => 'eq.' . $userId],
            'user_id,closed_at,operator_requested_at,operator_request_text,updated_at');
        return is_array($row) ? $row : ['operator_requested_at' => null, 'closed_at' => null];
    } catch (Throwable $e) {
        return ['operator_requested_at' => null, 'closed_at' => null];
    }
}

/**
 * Личное уведомление только владельцу поддержки.
 *
 * Текст обращения намеренно не отправляем в Telegram: бот сообщает лишь факт,
 * а сам диалог остаётся в админке JobToo.
 */
function support_notify_owner(): void {
    if (SUPPORT_NOTIFY_TELEGRAM_ID <= 0) return;
    tg_send_support_owner_message(
        SUPPORT_NOTIFY_TELEGRAM_ID,
        "🆘 Новое обращение в поддержку JobToo\n\n"
            . "Открыть: " . rtrim(DASHBOARD_URL, '/') . "/support"
    );
}

function support_norm(string $text): string {
    $text = function_exists('mb_strtolower') ? mb_strtolower($text, 'UTF-8') : strtolower($text);
    $text = str_replace(['ё'], ['е'], $text);
    $text = preg_replace('/[^\\p{L}\\p{N}]+/u', ' ', $text) ?? $text;
    return trim(preg_replace('/\\s+/u', ' ', $text) ?? $text);
}

function support_words(string $text): array {
    $norm = support_norm($text);
    if ($norm === '') return [];
    $parts = preg_split('/\\s+/u', $norm) ?: [];
    $stop = ['как','что','где','когда','почему','мне','мой','моя','мои','это','или','для','про','при','есть','нет','ли','на','в','и','с','по','к','из','у'];
    return array_values(array_unique(array_filter($parts, static function ($w) use ($stop) {
        $len = function_exists('mb_strlen') ? mb_strlen($w, 'UTF-8') : strlen($w);
        return $len >= 3 && !in_array($w, $stop, true);
    })));
}

/**
 * Консервативный matcher: точная ключевая фраза весит намного больше общей
 * лексики. Если уверенности нет, помощник не выдумывает ответ, а предлагает
 * живого оператора.
 */
function support_best_article(string $text, string $role): ?array {
    $input = support_norm($text);
    if ($input === '') return null;

    try {
        $rows = sb_select('jm_support_knowledge', [
            'active' => 'eq.true', 'order' => 'priority.desc',
        ], 'id,role,question,answer,keywords,priority');
    } catch (Throwable $e) {
        return null;
    }

    $inputWords = support_words($input);
    $best = null;
    $bestScore = 0;

    foreach ($rows as $row) {
        $articleRole = (string)($row['role'] ?? 'all');
        if ($articleRole !== 'all' && $articleRole !== $role) continue;

        $score = 0;
        $keywords = is_array($row['keywords'] ?? null) ? $row['keywords'] : [];
        foreach ($keywords as $keyword) {
            $kw = support_norm((string)$keyword);
            if ($kw === '') continue;
            if (str_contains($input, $kw)) {
                $score += 10 + count(support_words($kw)) * 2;
            } else {
                foreach (support_words($kw) as $word) {
                    if (in_array($word, $inputWords, true)) $score += 2;
                }
            }
        }

        $questionWords = support_words((string)($row['question'] ?? ''));
        $score += count(array_intersect($inputWords, $questionWords));
        $score += min(3, (int)($row['priority'] ?? 0) / 100);

        if ($score > $bestScore) {
            $bestScore = $score;
            $best = $row;
        }
    }

    return $bestScore >= 7 ? $best : null;
}

function support_knowledge_for_role(string $role): array {
    try {
        $rows = sb_select('jm_support_knowledge', [
            'active' => 'eq.true', 'order' => 'priority.desc',
        ], 'id,role,question,answer,priority');
    } catch (Throwable $e) {
        return [];
    }
    $out = [];
    foreach ($rows as $row) {
        $articleRole = (string)($row['role'] ?? 'all');
        if ($articleRole !== 'all' && $articleRole !== $role) continue;
        $out[] = [
            'id' => (string)($row['id'] ?? ''),
            'question' => (string)($row['question'] ?? ''),
            'answer' => (string)($row['answer'] ?? ''),
        ];
    }
    return $out;
}

define('TG_GROUP_CHAT_ID', (int)(getenv('TG_GROUP_CHAT_ID') ?: -1001709270025)); // группа «ПОДРАБОТКИ»
define('TG_WORK_GROUP_CHAT_ID', (int)(getenv('TG_WORK_GROUP_CHAT_ID') ?: -1004358116342));

/**
 * Validates Telegram WebApp initData signature (HMAC per official spec).
 * Returns ['user' => [...], 'params' => [...]] or null if invalid/expired.
 */
function tg_validate_init_data(string $initData): ?array {
    if (TG_BOT_TOKEN === '' || $initData === '') return null;
    parse_str($initData, $params);
    $hash = $params['hash'] ?? '';
    if (!$hash) return null;
    unset($params['hash']);
    ksort($params);
    $pairs = [];
    foreach ($params as $k => $v) $pairs[] = $k . '=' . $v;
    $dataCheckString = implode("\n", $pairs);
    $secretKey = hash_hmac('sha256', TG_BOT_TOKEN, 'WebAppData', true);
    $calc = bin2hex(hash_hmac('sha256', $dataCheckString, $secretKey, true));
    if (!hash_equals($calc, $hash)) return null;
    // Reject init data older than 24 hours
    if (isset($params['auth_date']) && (time() - (int)$params['auth_date']) > 86400) return null;
    $user = isset($params['user']) ? json_decode($params['user'], true) : null;
    return ['user' => is_array($user) ? $user : null, 'params' => $params];
}

/**
 * Служебная личная доставка по заранее известному chat_id.
 *
 * Обычные пользовательские уведомления через Telegram ниже по-прежнему
 * отключены. Этот транспорт используют только adminRetireTelegram и одно
 * операторское уведомление о новом обращении в поддержку.
 */
function tg_send_retirement_message(int $chatId, string $text): bool {
    if (TG_BOT_TOKEN === '') return false;

    $payload = [
        'chat_id' => $chatId,
        'text' => $text,
        'disable_web_page_preview' => true,
    ];

    for ($try = 1; $try <= 3; $try++) {
        $ch = curl_init('https://api.telegram.org/bot' . TG_BOT_TOKEN . '/sendMessage');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_IPRESOLVE => $try < 3 ? CURL_IPRESOLVE_V6 : CURL_IPRESOLVE_WHATEVER,
            CURLOPT_POSTFIELDS => json_encode($payload),
        ]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $dec = json_decode($resp ?: 'null', true);
        if (is_array($dec) && ($dec['ok'] ?? false) === true) return true;
        if ($resp !== false && $code < 500 && is_array($dec)) break;
        if ($try < 3) usleep($try * 400000);
    }
    return false;
}

/** Отдельное имя для единственного личного уведомления владельцу поддержки. */
function tg_send_support_owner_message(int $chatId, string $text): bool {
    if ($chatId <= 0 || $chatId !== SUPPORT_NOTIFY_TELEGRAM_ID) return false;
    return tg_send_retirement_message($chatId, $text);
}

/**
 * Единственный оставшийся Telegram-транспорт — публикации в две групповые
 * ленты JobToo. Персональные chat_id здесь запрещены независимо от данных в БД.
 *
 * Это даёт жёсткую границу: старый клиент, забытый cron или ручной вызов не
 * сможет снова включить личные Telegram-уведомления. Mini App открывается
 * обычной URL-кнопкой и не требует отправки ПДн пользователю через этот метод.
 */
function tg_send_message(int $chatId, string $text, bool|string $withAppButton = false, string $btnText = '🚀 Откликнуться в JobToo', ?array $keyboard = null, ?int $messageThreadId = null): bool {
    if (!in_array($chatId, [TG_GROUP_CHAT_ID, TG_WORK_GROUP_CHAT_ID], true)) return false;
    if (TG_BOT_TOKEN === '') return false;

    $payload = [
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => true,
    ];
    if ($messageThreadId !== null && $messageThreadId > 0) {
        $payload['message_thread_id'] = $messageThreadId;
    }
    // Готовая клавиатура — для сообщений с кнопками ответа, вроде «одобрить
    // или отклонить». Раньше такие отправлялись мимо этой функции, своим
    // curl, — и мимо повтора при обрыве связи вместе с ним. То есть
    // работодатель мог не узнать об отклике ровно по той же причине, по
    // которой не уходили объявления в группу.
    if ($keyboard !== null) {
        $payload['reply_markup'] = ['inline_keyboard' => $keyboard];
    } elseif ($withAppButton !== false) {
        $url = is_string($withAppButton) ? $withAppButton : 'https://t.me/JobToo_bot/app';
        $payload['reply_markup'] = ['inline_keyboard' => [[
            ['text' => $btnText, 'url' => $url],
        ]]];
    }
    // Три попытки, а не одна.
    //
    // Связь с api.telegram.org рваная: замер с сервера дал четыре ответа из
    // четырёх на одной настройке и один из двух на другой, в разное время
    // по-разному. При одной попытке этого достаточно, чтобы объявление
    // молча не ушло в группу — ровно то, на что и жаловались.
    //
    // Повторяем только когда виновата связь. На отказ по существу — «бот
    // исключён», «чат не найден» — повтор бессмыслен: ответ будет тот же,
    // а человек будет ждать втрое дольше.
    $resp = false; $err = ''; $dec = null; $ok = false;
    for ($try = 1; $try <= 3; $try++) {
        $ch = curl_init('https://api.telegram.org/bot' . TG_BOT_TOKEN . '/sendMessage');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            // Сперва по IPv6, и это не вкусовщина. Замеры с этой машины
            // изо дня в день одинаковы: по IPv6 к Телеграму доходит 4 из 4,
            // по IPv4 — 0 из 2. А когда стек не указан, выбирает система, и
            // примерно в четверти случаев она выбирает сломанный путь.
            // Отсюда и «иногда объявление не уходит».
            //
            // Последняя попытка — без указания: если однажды отвалится уже
            // IPv6, жёсткая привязка к нему превратила бы редкий сбой в
            // постоянный.
            CURLOPT_IPRESOLVE => $try < 3 ? CURL_IPRESOLVE_V6 : CURL_IPRESOLVE_WHATEVER,
            CURLOPT_POSTFIELDS => json_encode($payload),
        ]);
        $resp = curl_exec($ch);
        $err  = curl_error($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $dec = json_decode($resp ?: 'null', true);
        $ok  = is_array($dec) && ($dec['ok'] ?? false) === true;
        if ($ok) break;

        // Телеграм ответил и отказал — это его слово, а не обрыв связи.
        if ($resp !== false && $code < 500 && is_array($dec)) break;
        if ($try < 3) usleep($try * 400000);   // 0,4 с, потом 0,8 с
    }

    // Последний отказ запоминаем: молчаливый провал отправки в группу стоил
    // нам того, что объявления перестали доходить до «ПОДРАБОТОК», а понять
    // причину было нечем — код на месте, права есть, сообщений нет.
    if (!$ok) {
        $GLOBALS['jt_last_tg_error'] = [
            'chat' => $chatId,
            'ошибка' => $err ?: (($dec['description'] ?? null) ?: substr((string)$resp, 0, 200)),
            'попыток' => $try ?? 1,
            'когда' => now_iso(),
        ];
    }
    return $ok;
}

/**
 * Отправка пушей через Expo, пачками по сотне. Не бросает исключений.
 *
 * ВАЖНО про содержимое. Перед отправкой helper безусловно заменяет title,
 * body, channelId и data на один нейтральный wake-up payload. Поэтому никакой
 * вызывающий код не может случайно протащить в Expo имя, user_id, chat_id,
 * vacancy_id, тип события или текст сообщения. Детали остаются в российском
 * jm_notifications и загружаются приложением после открытия.
 */
function jt_encrypt_legacy_push_tokens_once(): void {
    $marker = __DIR__ . '/.push_tokens_encrypted_v1';
    if (is_file($marker)) return;

    try {
        $rows = sb_select_all('jm_users', ['push_token' => 'not.is.null'], 'id,push_token');
        foreach ($rows as $row) {
            $uid = (string)($row['id'] ?? '');
            $stored = trim((string)($row['push_token'] ?? ''));
            if ($uid === '' || $stored === '' || jt_push_is_encrypted($stored)) continue;
            sb_update('jm_users', ['id' => 'eq.' . $uid], ['push_token' => jt_push_encrypt($stored)]);
        }
        @file_put_contents($marker, gmdate('c'), LOCK_EX);
    } catch (Throwable $e) {
        // Доставка не должна падать из-за фоновой миграции: legacy-токены
        // всё равно читаются helper'ом и будут переписаны при регистрации.
    }
}

function expo_push(array $messages): void {
    jt_encrypt_legacy_push_tokens_once();
    $messages = jt_push_prepare_expo_messages($messages);
    if (empty($messages)) return;

    for ($i = 0; $i < count($messages); $i += 100) {
        $chunk = array_slice($messages, $i, 100);
        $ch = curl_init('https://exp.host/--/api/v2/push/send');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(count($chunk) === 1 ? $chunk[0] : $chunk),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_TIMEOUT => 15,
        ]);
        curl_exec($ch); curl_close($ch);
    }
}

/**
 * Уведомить пользователя всем, что есть на сервере: колокольчик, телеграм,
 * пуш на телефон.
 *
 * Появилось после разбирательства с директором, который перестал выкладывать
 * вакансии: «мне не поступали отклики соискателей, сейчас зашла — сразу 4».
 * За это время человека нашли через другую компанию, а вакансию удалили.
 *
 * Причина была в том, что уведомление директору отправлял телефон соискателя,
 * уже после того как отклик сохранён. Старая версия приложения, оборвавшаяся
 * сеть, свёрнутое приложение — и директор не узнавал ничего, а ошибка
 * глоталась молча. Уведомление о событии должен слать тот, кто это событие
 * записал, то есть сервер.
 *
 * Повтор в течение минуты отбрасываем: пока не все обновились, старые клиенты
 * продолжают слать своё уведомление, и без этого directоr получал бы по два.
 */
/**
 * Карточка кандидата директору в телеграм, с кнопками «Одобрить/Отклонить».
 *
 * Раньше её заказывал телефон соискателя отдельным запросом после отклика.
 * Теперь зовём и с сервера, сразу при создании отклика: клиент мог не дойти
 * до этого вызова — старая версия, обрыв связи, свёрнутое приложение, — и
 * директор оставался без карточки, как и без самого уведомления.
 */
function tg_new_application_card(string $employerId, string $workerId, string $vacancyId, string $vTitle): bool {
            if (!jt_has_crossborder_consent($employerId)) return false;
            $emp = sb_single('jm_users', ['id' => 'eq.' . $employerId], 'telegram_id');
            if (!$emp || empty($emp['telegram_id'])) return false;

            $app = sb_single('jm_perm_applications', [
                'vacancy_id' => 'eq.' . $vacancyId,
                'worker_id'  => 'eq.' . $workerId,
                'order'      => 'created_at.desc',
            ], 'id');
            if (!$app) return false;

            $lines = ["📥 <b>Новая заявка на «{$vTitle}»</b>", ''];
            if (jt_has_crossborder_consent($workerId)) {
                $w = sb_single('jm_users', ['id' => 'eq.' . $workerId], 'first_name,last_name,age,metro_station,phone,avg_rating,rating_count');
                $name = trim(($w['first_name'] ?? '') . ' ' . ($w['last_name'] ?? '')) ?: 'Кандидат';
                $lines[] = '👤 ' . $name . (!empty($w['age']) ? ", {$w['age']} лет" : '');
                if (!empty($w['metro_station'])) $lines[] = '🚇 м. ' . $w['metro_station'];
                if (!empty($w['avg_rating']) && (float)$w['avg_rating'] > 0) {
                    $lines[] = '⭐ Рейтинг ' . $w['avg_rating'] . (!empty($w['rating_count']) ? " ({$w['rating_count']} оценок)" : '');
                }
                if (!empty($w['phone'])) $lines[] = '📞 +' . ltrim($w['phone'], '+');
            } else {
                $lines[] = '👤 Новый кандидат — данные анкеты доступны только в JobToo.';
            }
            $lines[] = '';
            $lines[] = 'Решите прямо здесь — работник сразу узнает:';

            // Через общую отправку, а не своим curl: раньше это сообщение
            // шло мимо неё, а вместе с ней — мимо повтора при обрыве связи.
            // Связь с Telegram отсюда рваная, и работодатель мог не узнать
            // об отклике по той же причине, по которой не уходили
            // объявления в группу. Одна неудачная попытка — и тишина.
            return tg_send_message((int)$emp['telegram_id'], implode("\n", $lines), false, '', [
                [
                    ['text' => '✅ Одобрить', 'callback_data' => 'appok_' . $app['id']],
                    ['text' => '❌ Отклонить', 'callback_data' => 'appno_' . $app['id']],
                ],
                [['text' => '💬 Написать кандидату', 'callback_data' => 'appmsg_' . $app['id']]],
                [['text' => '👤 Открыть в JobToo', 'url' => 'https://t.me/JobToo_bot/app']],
            ]);
}


/**
 * Уведомить человека всеми каналами сразу: колокольчик, телеграм, пуш.
 *
 * $pushBody — отдельный текст для пуша, и вот почему он появился.
 *
 * Пуш уходит на exp.host, то есть в США. США нет в перечне государств,
 * обеспечивающих адекватную защиту прав субъектов персональных данных
 * (приказ Роскомнадзора № 128 от 05.08.2022, действует с 01.03.2023), —
 * а мы отправляли туда имя и фамилию работника прямо в теле уведомления:
 * «Иван Петров хочет выйти на смену». Это трансграничная передача
 * персональных данных в страну вне перечня, причём по самому строгому
 * порядку: до неё нужно отдельное уведомление РКН и выжидание срока, и
 * ведомство вправе её запретить.
 *
 * Колокольчик живёт в нашей базе в Москве, поэтому там имя остаётся: оно
 * там и полезно. Наружу уходит обезличенный вариант.
 *
 * Если $pushBody не передан, в пуш идёт обычный текст — так и должно быть
 * для сообщений, где имён нет вовсе (а таких большинство).
 */
/**
 * $pushTitle — заголовок ИМЕННО для пуша, когда он должен отличаться от
 * заголовка в колокольчике. Нужен переписке: в колокольчике внутри приложения
 * видно, кто написал, а на экране блокировки — только «Новое сообщение».
 * Так же устроены WhatsApp и Signal со спрятанными предпросмотрами.
 */
/**
 * Только колокольчик: строка в jm_notifications, без телеграма и без пуша.
 *
 * Есть новости, которые человек должен узнать, но за которые нельзя дёргать
 * его телефон. Отказ по отклику — ровно такая: их много, они неприятные, и
 * пуш по каждой кончается выключенными уведомлениями. А выключенные
 * уведомления не вернуть — вместе с отказами человек перестанет получать и
 * сообщения о мэтчах и о завтрашней смене, то есть ровно то, ради чего
 * уведомления и нужны. Спрятать отказ тоже нельзя: молчание работодателя —
 * самый опасный разрыв воронки, и он должен быть виден. Колокольчик и строка
 * в переписке показывают его, не отнимая всего остального.
 *
 * Возвращает false, если писать не стали: пустой получатель или дубль в
 * пределах минуты. notify_user на этом останавливается — раз строки нет, то
 * и слать нечего.
 */
function notify_bell(string $userId, string $title, string $body, string $type = ''): bool {
    if ($userId === '') return false;

    $since = gmdate('Y-m-d\TH:i:s\Z', time() - 60);
    $dup = sb_select('jm_notifications', [
        'user_id'    => 'eq.' . $userId,
        'title'      => 'eq.' . $title,
        'created_at' => 'gte.' . $since,
    ], 'id');
    if ($dup) return false;

    $row = ['user_id' => $userId, 'title' => $title, 'body' => $body];
    if ($type !== '') $row['type'] = $type;
    try {
        sb_insert('jm_notifications', $row);
    } catch (Throwable $e) {
        // Колонки type может не быть — пишем без неё, колокольчик важнее.
        sb_insert('jm_notifications', ['user_id' => $userId, 'title' => $title, 'body' => $body]);
    }
    return true;
}

function notify_user(string $userId, string $title, string $body, string $type = '',
                     array $data = [], ?string $pushBody = null,
                     ?string $pushTitle = null, ?string $channelId = null): void {
    if (!notify_bell($userId, $title, $body, $type)) return;

    $u = sb_single('jm_users', ['id' => 'eq.' . $userId], 'telegram_id,push_token');
    if (!$u) return;

    // Telegram остаётся отдельным каналом и сохраняет собственную проверку
    // согласия. Нативный push ниже содержит только нейтральный сигнал.
    $crossBorderAllowed = jt_has_crossborder_consent($userId);

    if ($crossBorderAllowed && !empty($u['telegram_id'])) {
        $tgTitle = $pushTitle ?? $title;
        $tgBody = $pushBody ?? $body;
        tg_send_message((int)$u['telegram_id'],
            '<b>' . htmlspecialchars($tgTitle, ENT_QUOTES, 'UTF-8') . "</b>\n\n"
            . htmlspecialchars($tgBody, ENT_QUOTES, 'UTF-8'), true, '🚀 Открыть JobToo');
    }
    if (!empty($u['push_token'])) {
        expo_push([[
            'to' => $u['push_token'], 'title' => $pushTitle ?? $title, 'body' => $pushBody ?? $body,
            'sound' => 'default', 'priority' => 'high', 'channelId' => $channelId ?? 'matches',
            'data' => array_merge(['type' => $type], $data),
        ]]);
    }
    // Ни телеграма, ни приложения — остаётся браузер. До этой правки такой
    // человек не получал НИ ОДНОГО внешнего сигнала о личных событиях: о
    // мэтче, о сообщении, об итоге своей смены. Веб-пуш на сервере был и
    // работал, но звали его из одного места — массовой рассылки о новой
    // вакансии. То есть о чужой смене человек узнавал, а о своём мэтче нет.
    //
    // Запасной путь, а не добавочный: у кого есть телеграм или приложение, тот
    // уже извещён, и второй звонок о том же — это ровно то «просто так», от
    // которого выключают уведомления.
    if (empty($u['telegram_id']) && empty($u['push_token'])) {
        web_push_to([$userId => true], $pushTitle ?? $title, $pushBody ?? $body, $type);
    }
}


/**
 * Раз в два дня — тем, у кого рядом действительно есть смена.
 *
 * Прежнее касание работников было слепым: раз в три дня всем «в приложении
 * появились новые варианты рядом с вашим метро», без единой цифры и без
 * проверки, есть ли там что-то рядом на самом деле. Кончилось тем, что
 * 27% людей, сами подключивших телеграм, заблокировали бота.
 *
 * Здесь наоборот: если рядом ничего нет — человек не получает ничего. Молчание
 * дешевле блокировки, а «рядом» считается по остановкам на его ветке, а не по
 * тому, что обе станции есть в Москве.
 *
 * Возвращает, скольким написали и скольких промолчали — второе число тоже
 * стоит смотреть: если молчим почти всем, значит смен мало, а не рассылка
 * плохая.
 */
function shift_nudge_run(): array {
    require_once __DIR__ . '/bot_brain.php';

    $today = gmdate('Y-m-d', time() + 3 * 3600);
    $open = sb_select('jm_vacancies', ['status' => 'eq.open', 'date' => 'gte.' . $today],
        'id,title,company,work_type,metro_station,date,time_start,time_end,salary');
    if (empty($open)) return ['sent' => 0, 'silent' => 0, 'note' => 'открытых смен нет'];

    // Кому уже писали за последние два дня.
    $cut = gmdate('Y-m-d\TH:i:s\Z', time() - 2 * 86400);
    $skip = [];
    foreach (sb_select('jm_notifications',
        ['type' => 'eq.shift_nudge', 'created_at' => 'gte.' . $cut], 'user_id') as $r) {
        $skip[$r['user_id']] = true;
    }

    $workers = sb_select('jm_users', ['role' => 'eq.worker'],
        'id,first_name,metro_station,telegram_id,push_token,is_blocked,nudge_off');
    $sent = 0; $silent = 0; $pushMsgs = [];

    foreach ($workers as $w) {
        if (!empty($w['is_blocked']) || !empty($w['nudge_off'])) continue;
        if (empty($w['telegram_id']) && empty($w['push_token'])) continue;
        if (isset($skip[$w['id']])) continue;

        $st = $w['metro_station'] ?? null;
        $near = [];
        foreach ($open as $v) {
            $d = bot_stops_between($st, $v['metro_station'] ?? null);
            if ($d === null || $d > BOT_NEAR_STOPS) continue;
            $v['_stops'] = $d;
            $near[] = $v;
        }
        if (empty($near)) { $silent++; continue; }

        usort($near, fn($a, $b) => $a['_stops'] === $b['_stops']
            ? strcmp((string)$a['date'], (string)$b['date'])
            : $a['_stops'] <=> $b['_stops']);
        $near = array_slice($near, 0, 3);

        $title = count($near) === 1 ? '⚡ Смена рядом с вами' : '⚡ Смены рядом с вами';
        $list = implode("\n", array_map('bot_shift_line', $near));
        $body = $list . "\n\nОткликнуться — в приложении, в два тапа.";

        try {
            sb_insert('jm_notifications',
                ['user_id' => $w['id'], 'title' => $title, 'body' => $body, 'type' => 'shift_nudge']);
        } catch (Throwable $e) {
            sb_insert('jm_notifications', ['user_id' => $w['id'], 'title' => $title, 'body' => $body]);
        }

        if (!empty($w['telegram_id'])) {
            tg_send_message((int)$w['telegram_id'], $title . "\n\n" . $body, true);
        } else {
            // В пуше видно две строки, поэтому там только ближайшая смена.
            $pushMsgs[] = ['to' => $w['push_token'], 'title' => $title,
                'body' => ltrim(bot_shift_line($near[0]), '• '),
                'sound' => 'default', 'priority' => 'default', 'channelId' => 'vacancies',
                'data' => ['type' => 'shift_nudge']];
        }
        $sent++;
    }
    if (!empty($pushMsgs)) expo_push($pushMsgs);

    return ['sent' => $sent, 'silent' => $silent];
}

/**
 * Понедельничный пост в группу «ПОДРАБОТКИ»: актуальные постоянные вакансии,
 * сгруппированные по роли и отсортированные по убыванию зарплаты. Каждая
 * станция — ссылка, открывающая вакансию в мини-аппе. Возвращает bool.
 */
function post_weekly_perm_digest(): bool {
    $rows = sb_select('jm_perm_vacancies', ['status' => 'eq.open'],
        'id,title,work_type,metro_station,salary');
    if (empty($rows)) return false;

    // Группы в порядке вывода. Все типы работ учтены, плюс запасная «Другие».
    $groups = [
        'stocker' => ['label' => '📦 Кладовщики', 'items' => []],
        'cook' => ['label' => '👨‍🍳 Повара', 'items' => []],
        'shift_supervisor' => ['label' => '👔 Старшие смены', 'items' => []],
        'picker' => ['label' => '🧺 Сборщики', 'items' => []],
        'other' => ['label' => '💼 Другие вакансии', 'items' => []],
    ];
    foreach ($rows as $r) {
        $key = classify_work_type($r['work_type'] ?? '', $r['title'] ?? '');
        if (!isset($groups[$key])) $key = 'other';
        $groups[$key]['items'][] = $r;
    }

    $lines = [];
    $total = count($rows);
    $lines[] = "💼 <b>Постоянная работа в Лавках — {$total} " . plural_vac($total) . "</b>";
    $lines[] = "";
    $lines[] = "👉 <b>Просто нажми на нужную вакансию — и она сразу откроется у тебя прямо в Telegram.</b> Дальше откликнись в два тапа.";

    foreach ($groups as $g) {
        if (empty($g['items'])) continue;
        usort($g['items'], fn($a, $b) => (float)($b['salary'] ?? 0) <=> (float)($a['salary'] ?? 0));
        $lines[] = "";
        $lines[] = "<b>{$g['label']}:</b>";
        foreach ($g['items'] as $v) {
            $metro = $v['metro_station'] ?: ($v['title'] ?? 'Вакансия');
            $sal = ((float)($v['salary'] ?? 0)) > 0
                ? number_format((float)$v['salary'], 0, '', ' ') . ' ₽'
                : 'по договорённости';
            $url = 'https://t.me/JobToo_bot/app?startapp=vacancy_' . $v['id'];
            $lines[] = '🚇 <a href="' . $url . '">' . htmlspecialchars($metro) . ' — ' . $sal . '</a>';
        }
    }

    $lines[] = "";
    $lines[] = "Есть и подработка на день — раздел «Смены» в приложении 👇";

    $text = implode("\n", $lines);
    if (TG_GROUP_CHAT_ID === 0) return false;
    return tg_send_message(TG_GROUP_CHAT_ID, $text, true);
}

/**
 * Определяет тип работы: сначала по полю work_type, а если оно пустое
 * (старые вакансии) — по названию. Так ни одна вакансия не выпадает.
 */
function classify_work_type(string $wt, string $title): string {
    $known = ['stocker', 'cook', 'shift_supervisor', 'picker'];
    if (in_array($wt, $known, true)) return $wt;
    $t = mb_strtolower($title);
    if (mb_strpos($t, 'повар') !== false) return 'cook';
    if (mb_strpos($t, 'сборщик') !== false) return 'picker';
    if (mb_strpos($t, 'старш') !== false) return 'shift_supervisor';
    if (mb_strpos($t, 'кладовщик') !== false) return 'stocker';
    return 'other';
}

/** Склонение слова «вакансия» по числу. */
function plural_vac(int $n): string {
    $n10 = $n % 10; $n100 = $n % 100;
    if ($n10 === 1 && $n100 !== 11) return 'вакансия';
    if ($n10 >= 2 && $n10 <= 4 && ($n100 < 12 || $n100 > 14)) return 'вакансии';
    return 'вакансий';
}

/**
 * Объявить о новой смене всем работникам, у кого есть куда написать.
 *
 * Некоторое время объявление уходило только тем, кому до смены недалеко по
 * своей ветке. Причина была: за один день ушло семь сообщений подряд —
 * человеку с Новогиреево четырежды про Ховрино, — и 27% из тех, кто сам
 * подключил телеграм, бота заблокировали.
 *
 * Но адресность стоила слишком дорого. На смене в Строгино объявление ушло
 * 19 людям вместо 149: география отрезала тех, кто готов ехать, а таких
 * среди складских много — час дороги за смену это нормальная плата. Хуже
 * того, оба человека, живущие на самом Строгино, оказались без телеграма и
 * push-токена, то есть ближайшие всё равно не узнали.
 *
 * Поэтому пишем всем, а от заваливания защищаемся не расстоянием, а счётом:
 * не больше NEARBY_MAX_PER_DAY объявлений в сутки на человека. Директор
 * может выложить смены на неделю одну за другой — это не повод писать семь
 * раз. Серия на несколько дней и так шлёт одно сообщение, а не по одному
 * на дату.
 *
 * Счётчик берётся из колокольчика — и теперь это честно: колокольчик
 * получают все работники, и рассылка идёт всем работникам, значит запись в
 * колокольчике ровно соответствует попытке написать. Пока рассылка была
 * адресной, а колокольчик общим, счётчик врал: человеку с Рязанского
 * проспекта записывалась смена в Строгино, и после двух таких смен где
 * угодно в Москве он переставал получать сообщения даже про соседний дом.
 *
 * Колокольчик в приложении получают все, включая тех, кому написать некуда:
 * он ничего не требует от человека и никого не будит.
 */
const NEARBY_MAX_PER_DAY = 4;

function notify_workers(string $title, string $body,
                        string $tgHtml, string $dataType, bool|string $btnUrl = true,
                        string $vacancyMetro = '', string $vacancyWorkType = ''): array {
    $all = sb_select('jm_users', ['role' => 'eq.worker'],
        'id,metro_station,work_types,telegram_id,push_token,is_blocked,nudge_off,vacancy_delivery_mode');

    // Колокольчик — всем.
    $bell = array_map(fn($w) => ['user_id' => $w['id'], 'title' => $title,
                                 'body' => $body, 'type' => $dataType], $all);
    if (!empty($bell)) {
        try { sb_insert('jm_notifications', $bell); }
        catch (Throwable $e) {
            $plain = array_map(fn($r) => ['user_id' => $r['user_id'], 'title' => $r['title'],
                                          'body' => $r['body']], $bell);
            try { sb_insert('jm_notifications', $plain); } catch (Throwable $e2) {}
        }
    }

    // Сколько объявлений человек уже получил сегодня (по московскому дню).
    $since = gmdate('Y-m-d\T00:00:00\Z', time() + 3 * 3600);
    $seen = [];
    foreach (sb_select('jm_notifications',
        ['type' => 'in.(nearby_shift,nearby_perm)', 'created_at' => 'gte.' . $since],
        'user_id') as $r) {
        $seen[$r['user_id']] = ($seen[$r['user_id']] ?? 0) + 1;
    }

    $pushMsgs = []; $tgOk = 0; $mute = 0; $capped = 0; $filtered = 0; $noConsent = 0; $webIds = [];
    foreach ($all as $w) {
        $mode = (string)($w['vacancy_delivery_mode'] ?? 'all');
        if ($mode === '') $mode = 'all';
        if (!empty($w['is_blocked']) || !empty($w['nudge_off']) || $mode === 'off') {
            $mute++; continue;
        }
        // Персонализация добровольная: пока человек ничего не выбрал, он
        // получает всё как раньше. Фильтры относятся только к внешним
        // Telegram/push сообщениям; колокольчик и общий канал сохраняют
        // полную ленту, поэтому пользователь ничего не теряет.
        $needsMetro = in_array($mode, ['metro', 'work_types_metro'], true);
        $needsWork = in_array($mode, ['work_types', 'work_types_metro'], true);
        $profileMetro = mb_strtolower(trim((string)($w['metro_station'] ?? '')));
        $targetMetro = mb_strtolower(trim($vacancyMetro));
        if ($needsMetro && ($profileMetro === '' || $targetMetro === '' || $profileMetro !== $targetMetro)) {
            $filtered++; continue;
        }
        if ($needsWork) {
            $types = $w['work_types'] ?? [];
            if (is_string($types)) {
                $decoded = json_decode($types, true);
                $types = is_array($decoded) ? $decoded : [];
            }
            $types = array_map(fn($v) => mb_strtolower(trim((string)$v)), is_array($types) ? $types : []);
            if ($vacancyWorkType === '' || !in_array(mb_strtolower(trim($vacancyWorkType)), $types, true)) {
                $filtered++; continue;
            }
        }
        // Запись про эту самую смену уже лежит в колокольчике, поэтому
        // сравниваем со строгим «больше», а не «больше или равно».
        if (($seen[$w['id']] ?? 0) > NEARBY_MAX_PER_DAY) { $capped++; continue; }

        if (!empty($w['telegram_id'])) {
            if (tg_send_message((int)$w['telegram_id'], $tgHtml, $btnUrl)) $tgOk++;
        } elseif (!empty($w['push_token'])) {
            $pushMsgs[] = ['to' => $w['push_token'], 'title' => $title, 'body' => $body,
                'sound' => 'default', 'priority' => 'high',
                'channelId' => 'vacancies', 'data' => ['type' => $dataType]];
        } else {
            // Ни телеграма, ни push-токена. Может быть подписка из браузера —
            // для четверых это единственный способ узнать о смене.
            $webIds[$w['id']] = true;
        }
    }
    if (!empty($pushMsgs)) expo_push($pushMsgs);
    $webOk = web_push_to($webIds, $title, $body, $dataType);

    return ['telegram' => $tgOk, 'push' => count($pushMsgs), 'webpush' => $webOk,
            'muted' => $mute, 'no_consent' => $noConsent, 'filtered' => $filtered,
            'capped' => $capped, 'bell' => count($bell)];
}

/**
 * Push в браузер тем, у кого нет ни телеграма, ни приложения.
 *
 * Уходит через дашборд: ключи подписи (VAPID) лежат там, и держать их вторым
 * экземпляром здесь — лишний способ их потерять.
 */
function web_push_to(array $userIds, string $title, string $body, string $dataType): int {
    if (empty($userIds)) return 0;
    // Внешний web-push, как и нативный push, не несёт содержание события.
    $title = 'JobToo';
    $body = 'У вас новое уведомление';
    $dataType = 'refresh';
    $ok = 0;
    try {
        // Спрашиваем подписки нужных людей, а не всю таблицу. Раньше выборка
        // шла целиком и отсеивалась в PHP: для одной рассылки в сутки это
        // ничего не стоило, но теперь сюда заходит каждое личное уведомление.
        // Порциями по сто — идентификаторы уходят в адрес запроса, и длинный
        // список сломал бы его целиком, а поломка здесь тихая: она под catch.
        $subs = [];
        foreach (array_chunk(array_keys($userIds), 100) as $chunk) {
            foreach (sb_select('jm_web_push_subscriptions',
                ['user_id' => sb_in_list($chunk)],
                'user_id,endpoint,p256dh,auth') as $row) $subs[] = $row;
        }
        $appSecret = jt_secret('APP_SECRET');
        foreach ($subs as $s) {
            if (empty($s['endpoint'])) continue;
            $ch = curl_init(DASHBOARD_URL . '/api/webpush/send');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-app-secret: ' . $appSecret],
                CURLOPT_TIMEOUT => 6,
                CURLOPT_POSTFIELDS => json_encode([
                    'subscription' => [
                        'endpoint' => $s['endpoint'],
                        'keys' => ['p256dh' => $s['p256dh'], 'auth' => $s['auth']],
                    ],
                    'title' => $title,
                    'body' => $body,
                    'data' => ['type' => $dataType],
                ]),
            ]);
            $resp = curl_exec($ch); curl_close($ch);
            $dec = json_decode($resp ?: 'null', true);
            if (is_array($dec) && ($dec['ok'] ?? false)) $ok++;
        }
    } catch (Throwable $e) {}
    return $ok;
}


// ─── JobToo Score ─────────────────────────────────────────────────────────────
//
// Рейтинг работника из фактов. Считаем на сервере и складываем в строку
// пользователя: показывать его надо всюду, где показывают человека, и
// пересчитывать это в приложении на каждом экране было бы и дорого, и
// по-разному в каждом месте.
//
// Веса. Половина — надёжность и пунктуальность: работодателю, набирающему
// два десятка человек на завтра, важнее всего, что они придут и придут
// вовремя. Четверть — оценки: это мнение, ценное, но мнение. Остальное —
// качество, скорость и опыт.
const SCORE_WEIGHTS = [
    'reliability' => 30,
    'punctuality' => 15,
    'rating'      => 25,
    'quality'     => 10,
    'speed'       => 10,
    'experience'  => 10,
];

// Меньше трёх отработанных смен — числа не показываем вовсе.
//
// Не из осторожности: у человека с одной смены выходит либо 100, либо 0, и
// оба ответа решают за работодателя на пустом месте. Пусть лучше видит
// «новичок» и решает сам.
const SCORE_MIN_SHIFTS = 3;

// К скольким сменам опыт считается набранным. Тридцать — это примерно
// полтора месяца регулярных подработок; дальше разница между сотней смен и
// тремя сотнями работодателю уже ничего не говорит.
const SCORE_EXPERIENCE_FULL = 30;

/**
 * Пересчитать рейтинг одного работника и записать в его строку.
 *
 * Возвращает то, что записал, — пригождается и вызывающему, и проверке.
 * Ошибки наружу не выпускает: пересчёт идёт следом за записью исхода смены
 * или оценки, и сорвать саму запись из-за него нельзя.
 */

/**
 * Начислить приглашение, если эта смена — первая отработанная у приглашённого.
 *
 * Зовётся из обоих мест, где выставляется shift_completed. Правило «за что
 * платим» живёт в referral.php и проверяется на выдуманных данных; здесь
 * только поход в базу.
 *
 * Молчит при любой неудаче: начисление — не то, ради чего стоит заваливать
 * человеку отметку об окончании смены. Несработавшее начисление видно в
 * jm_referral_rewards, а несохранённый итог смены не видно нигде.
 */

/**
 * Свободный код приглашения.
 *
 * Совпадение на восьми знаках из тридцати двух маловероятно, но «маловероятно»
 * за год работы случается. Совпавший код увёл бы вознаграждение чужому
 * человеку, поэтому проверяем, а не надеемся.
 */

/**
 * Сверить, что смену закрывает её сторона, и вернуть строку.
 *
 * Эти операции требовали входа, но не спрашивали, ЧЬЯ смена: их нет в
 * $selfArgFns, потому что владелец там не довод запроса, а поле в строке.
 * Любой вошедший мог закрыть чужую смену любым итогом — и поставить человеку
 * невыход, который бьёт по рейтингу сильнее всего остального.
 *
 * $employerOnly — для нынешней отметки об итоге: в приложении её ставит
 * работодатель и только он (экран EmployerMatches). Старые операции
 * подтверждения принимают обе стороны: какая из них зовёт их в давно
 * установленном приложении, мы не знаем, а сломать его — ровно то, ради чего
 * эти операции и оставлены.
 */

/**
 * Название и компания смены — одной строкой на всех.
 *
 * Вакансию могли удалить, а отклик по ней остаться: связи в базе нет. Тогда
 * подставляем общие слова, а не пустые кавычки.
 */
function jt_shift_titles(string $vacancyId): array
{
    $vac = $vacancyId !== ''
        ? sb_single('jm_vacancies', ['id' => 'eq.' . $vacancyId], 'title,company') : null;
    return [
        trim((string)($vac['title'] ?? '')) ?: 'смену',
        trim((string)($vac['company'] ?? '')) ?: 'Работодатель',
    ];
}

/**
 * Известить о мэтче ту сторону, которая его НЕ нажимала.
 *
 * Раньше это делал телефон нажавшего, и текст собирал сам. Событие целиком
 * серверное — мэтч заводится здесь же, — так что телефону тут делать нечего:
 * обрыв связи терял уведомление, а подпись под ним можно было подделать.
 *
 * Извещаем именно другую сторону: свой же нажим человек и так видит на экране.
 */
function jt_notify_match(string $vacancyId, string $workerId, string $employerId,
                         ?string $actorUid): void
{
    [$title, $company] = jt_shift_titles($vacancyId);
    $actor = (string)($actorUid ?? '');

    if ($actor !== $workerId && $workerId !== '') {
        notify_user($workerId, '🎉 Мэтч! Вас хотят взять!',
            $company . ' подтвердили ваш отклик на «' . $title . '». Откройте чат!',
            'match_worker');
    }
    if ($actor !== $employerId && $employerId !== '') {
        $w = sb_single('jm_users', ['id' => 'eq.' . $workerId], 'first_name,last_name');
        $name = trim(((string)($w['first_name'] ?? '')) . ' ' . ((string)($w['last_name'] ?? ''))) ?: 'Кандидат';
        notify_user($employerId, '🎉 Мэтч!',
            $name . ' готов выйти на смену «' . $title . '». Откройте чат!',
            'match_employer', [],
            // В пуш — без имени: он уходит за границу. Название смены
            // оставляем, без него уведомление перестаёт что-либо значить.
            'Кандидат готов выйти на смену «' . $title . '». Откройте чат!');
    }
}

/**
 * Известить работника об итоге смены.
 *
 * Тексты разные не для красоты. Прежде на все случаи был один — «компания
 * отменила смену», — и человек, которого отметили не вышедшим, получал письмо
 * про отмену работодателем. Неправда, да ещё и отметку, которая пойдёт ему в
 * рейтинг, он бы так и не увидел. Пусть видит: если это ошибка, успеет
 * написать в поддержку, пока помнит, как всё было.
 */
function jt_notify_shift_outcome(string $likeId, string $outcome): void
{
    $like = sb_single('jm_likes', ['id' => 'eq.' . $likeId], 'worker_id,vacancy_id');
    $workerId = (string)($like['worker_id'] ?? '');
    if ($workerId === '') return;
    [$title, $company] = jt_shift_titles((string)($like['vacancy_id'] ?? ''));

    if ($outcome === 'worked') {
        notify_user($workerId, '✅ Смена подтверждена работодателем',
            $company . ' подтвердил смену «' . $title . '». Хотите оставить отзыв?',
            'shift_confirmed_by_employer', [], null, null, 'default');
        return;
    }

    [$t, $b] = match ($outcome) {
        'no_show' => ['⚠️ Отмечен невыход',
            $company . ' отметил, что вы не вышли на смену «' . $title
            . '». Это влияет на рейтинг. Если это ошибка — напишите в поддержку.'],
        'worker_cancelled' => ['Смена отменена',
            'Ваш отказ от смены «' . $title . '» (' . $company . ') записан. На рейтинг он не влияет.'],
        'other_cancelled' => ['Смена отменена',
            'Смена «' . $title . '» не состоялась по другой причине. На рейтинг сторон это не влияет.'],
        default => ['❌ Смена отменена',
            $company . ' отменил смену «' . $title
            . '». Загляните в приложение — там много других подработок!'],
    };
    notify_user($workerId, $t, $b, 'shift_cancelled');
}

/**
 * Идентификаторы вакансий этого работодателя.
 *
 * Нужны там, где раньше выбирали таблицу целиком: счётчики откликов и
 * просмотров читает экран «мои вакансии», а отдавались они по всему рынку.
 */
function jt_own_vacancy_ids(string $table, ?string $authUid): array
{
    $me = (string)($authUid ?? '');
    if ($me === '') return [];
    $rows = sb_select_all($table, ['employer_id' => 'eq.' . $me], 'id');
    return array_values(array_filter(array_column($rows, 'id')));
}

/**
 * Строки таблицы по списку вакансий, порциями.
 *
 * Порции нужны не для красоты: идентификаторы уходят в адрес запроса, и
 * работодатель с сотней вакансий упёрся бы в его длину.
 */
function jt_rows_for_vacancies(string $table, array $vacancyIds, string $cols): array
{
    $out = [];
    foreach (array_chunk($vacancyIds, 100) as $chunk) {
        foreach (sb_select_all($table, ['vacancy_id' => sb_in_list($chunk)], $cols) as $r) {
            $out[] = $r;
        }
    }
    return $out;
}

/**
 * Строка сообщения для уведомления.
 *
 * Повторяет services/messagePreview.ts: фото и голосовые лежат в той же
 * текстовой колонке, что и обычные сообщения, — служебная метка плюс ссылка.
 * Показывать её человеку нельзя, поэтому значок и слово.
 *
 * Значки те же, что в списке чатов: список и шторка уведомлений должны
 * говорить одно и то же.
 */
function jt_message_preview(string $text): string
{
    if (str_starts_with($text, '[voice]')) return '🎤 Голосовое сообщение';
    if (str_starts_with($text, '[img]')) return '📷 Фото';
    return mb_substr($text, 0, 100);
}

/**
 * Известить вторую сторону переписки о новом сообщении.
 *
 * Раньше это делал телефон отправителя: собирал заголовок из своего имени,
 * брал чужой пуш-токен и слал. Отсюда шли сразу две беды. Первая — обычная
 * для этой породы: вызов «выстрелил и забыл», обрыв связи, и человек о
 * сообщении не узнал. Вторая хуже: раз текст уведомления приходит с клиента,
 * через НАШЕГО бота можно было послать что угодно тому, с кем есть переписка.
 * Право писать я закрыл раньше, а вот содержание оставалось за клиентом.
 *
 * Теперь и имя отправителя, и текст сервер берёт из того, что сам записал.
 */
function jt_notify_new_message(array $chat, string $senderId, string $text): void
{
    $workerId = (string)($chat['worker_id'] ?? '');
    $employerId = (string)($chat['employer_id'] ?? '');
    $recipientId = $senderId === $workerId ? $employerId : $workerId;
    if ($recipientId === '' || $recipientId === $senderId) return;

    $u = sb_single('jm_users', ['id' => 'eq.' . $senderId], 'first_name,last_name');
    $name = trim(((string)($u['first_name'] ?? '')) . ' ' . ((string)($u['last_name'] ?? '')));
    if ($name === '') $name = 'Собеседник';

    notify_user($recipientId, '💬 ' . $name, jt_message_preview($text),
        'message', ['chatId' => (string)($chat['id'] ?? '')],
        // На экране блокировки — ни имени, ни текста.
        'Откройте чат в JobToo', '💬 Новое сообщение');
}

/**
 * Сторона переписки — или отказ.
 *
 * Та же проверка, что стоит для $chatArgFns до switch, но вызываемая: файлы
 * чата адресуются не идентификатором чата, а именем файла, и в общий список
 * не укладываются.
 */
function jt_require_chat_party(?string $authUid, string $chatId): void
{
    $chat = $chatId !== ''
        ? sb_single('jm_chats', ['id' => 'eq.' . $chatId], 'worker_id,employer_id') : null;
    if (!$chat || ($authUid !== (string)$chat['worker_id'] && $authUid !== (string)$chat['employer_id'])) {
        jt_respond(['error' => 'Chat access denied'], 403); exit;
    }
}

/**
 * Идентификатор чата из имени файла.
 *
 * Приложение складывает имена так: `chat/<id чата>_<время>.jpg` и
 * `chat/voice_<id чата>_<время>.<расширение>`. Значит по имени видно, чей это
 * файл, и подписывать ссылку или заливать можно только своей стороне.
 *
 * Нашлось сплошной ревизией прав: бакет закрытый, но подписать ссылку на ЛЮБОЙ
 * файл чата мог любой вошедший — то есть прочитать чужую переписку в
 * фотографиях и голосовых. Залить с чужим именем (и перезаписать, заголовок
 * x-upsert стоит) — тоже.
 */
function jt_chat_id_from_media_path(string $path): string
{
    $name = basename($path);
    if (str_starts_with($name, 'voice_')) $name = substr($name, 6);
    $pos = strpos($name, '_');
    return $pos === false ? '' : substr($name, 0, $pos);
}

/** Отказ по правилу выше. Один текст на все точки, чтобы не разъехались. */

function jt_shift_party(string $likeId, ?string $authUid, bool $employerOnly): array
{
    $like = sb_single('jm_likes', ['id' => 'eq.' . $likeId], 'id,worker_id,employer_id,vacancy_id');
    if (!$like) {
        jt_respond(['error' => 'Смена не найдена'], 404); exit;
    }
    $employerId = trim((string)($like['employer_id'] ?? ''));
    $workerId = trim((string)($like['worker_id'] ?? ''));
    $uid = (string)($authUid ?? '');
    $allowed = $uid !== '' && ($uid === $employerId || (!$employerOnly && $uid === $workerId));
    if (!$allowed) {
        jt_respond(['error' => 'Это не ваша смена'], 403); exit;
    }
    return $like;
}


/**
 * Записать код приглашения и того, кто привёл, только что созданному человеку.
 *
 * Отдельно от создания профиля намеренно: см. комментарий в dbUpsertUser.
 * Приглашение — приятное дополнение, регистрация — обязательна, и первое не
 * имеет права ронять второе.
 *
 * Поле invited_by задаёт СЕРВЕР по коду: клиент его не присылает и прислать не
 * может — в dbUpsertUser оно срезается белым списком.
 */

/**
 * Объявить в группу вакансии, о которых объявить забыли.
 *
 * Зачем это вообще нужно. Объявление в группу «ПОДРАБОТКИ» до сих пор
 * целиком зависело от телефона того, кто публикует: приложение зовёт
 * dbNotifyAllWorkersNewVacancy отдельным запросом уже ПОСЛЕ того, как экран
 * закрылся (router.back()), и даёт до трёх попыток с двадцатипятисекундным
 * ожиданием — это полторы минуты. Человек нажал «Опубликовать», увидел
 * «Вакансия опубликована» и свернул приложение: запрос не ушёл, сервер о
 * вакансии не узнал, и починить это на сервере было нечем — он просто не
 * знал, что объявлять.
 *
 * Так вакансия и провисела сутки в ленте без единого сообщения в группе.
 *
 * Теперь сервер догоняет сам. Раз в час смотрит свежие открытые вакансии и
 * объявляет те, по которым отметки о доставке нет.
 *
 * Почему окно короткое и почему старые отметки тоже считаются: при первом
 * запуске у всех прежних вакансий отметки gpost нет — она новая. Без обоих
 * ограничений задание вывалило бы в группу всю историю. Поэтому берём только
 * последние часы и считаем доставленной вакансию, у которой есть ЛЮБАЯ из
 * двух отметок: gpost (новая) или bcast (её ставил прежний код, когда
 * рассылка начиналась).
 */
function jt_announce_missed(int $hours = 6, int $limit = 5): array
{
    $cut = gmdate('Y-m-d\TH:i:s\Z', time() - $hours * 3600);
    $announced = [];
    $checked = 0;

    $sources = [
        ['table' => 'jm_perm_vacancies', 'kind' => 'perm',
         'cols' => 'id,title,company,metro_station,salary,schedule,created_at'],
        ['table' => 'jm_vacancies', 'kind' => 'shift',
         'cols' => 'id,title,company,metro_station,salary,date,time_start,time_end,created_at'],
    ];

    foreach ($sources as $src) {
        if (count($announced) >= $limit) break;
        $rows = sb_select($src['table'], [
            'status' => 'eq.open',
            'created_at' => 'gte.' . $cut,
            'order' => 'created_at.asc',
        ], $src['cols']);

        foreach ($rows as $v) {
            if (count($announced) >= $limit) break;
            $id = trim((string)($v['id'] ?? ''));
            if ($id === '') continue;
            $checked++;

            // Любая из двух отметок означает «уже занимались».
            if (sb_single('jm_settings', ['key' => 'eq.gpost:' . $id], 'key')) continue;
            if (sb_single('jm_settings', ['key' => 'eq.bcast:' . $id], 'key')) continue;

            $html = jt_group_html($v, $src['kind']);
            if ($html === '') continue;

            $campaign = bin2hex(random_bytes(8));
            $btn = 'https://t.me/JobToo_bot/app?startapp=' . $src['kind'] . '_' . $id . '_' . $campaign;
            if (TG_GROUP_CHAT_ID === 0) break;
            if (!tg_send_message(TG_GROUP_CHAT_ID, $html, $btn)) continue;

            sb_upsert('jm_settings', [
                'key' => 'gpost:' . $id, 'value' => now_iso(), 'updated_at' => now_iso(),
            ], 'key');
            $announced[] = $id;
        }
    }

    return ['checked' => $checked, 'announced' => count($announced), 'ids' => $announced];
}

/**
 * Текст объявления в группу.
 *
 * Повторяет формат, который собирает приложение (services/notifications.ts).
 * Повтор осознанный: догоняющее задание не может позвать клиентский код, а
 * два разных вида объявления в одной группе выглядели бы как поломка. Меняя
 * формат там — поменять и здесь.
 */
function jt_group_html(array $v, string $kind): string
{
    $title = trim((string)($v['title'] ?? ''));
    $company = trim((string)($v['company'] ?? ''));
    if ($title === '' || $company === '') return '';

    $e = fn(string $x): string => htmlspecialchars($x, ENT_QUOTES, 'UTF-8');
    $salary = (float)($v['salary'] ?? 0);
    $head = $kind === 'perm' ? '💼 <b>Новая постоянная вакансия!</b>' : '⚡ <b>Новая подработка!</b>';

    $out = $head . "\n\n👷 " . $e($title) . ' — ' . $e($company);

    if ($kind === 'shift') {
        $date = trim((string)($v['date'] ?? ''));
        $time = trim(trim((string)($v['time_start'] ?? '')) . '–' . trim((string)($v['time_end'] ?? '')), '–');
        if ($date !== '') $out .= "\n📅 " . $e($date) . ($time !== '' ? ', ' . $e($time) : '');
        elseif ($time !== '') $out .= "\n🕐 " . $e($time);
    } else {
        $schedule = trim((string)($v['schedule'] ?? ''));
        if ($schedule !== '') $out .= "\n🗓 " . $e($schedule);
    }

    $metro = trim((string)($v['metro_station'] ?? ''));
    if ($metro !== '') $out .= "\n🚇 м. " . $e($metro);
    if ($salary > 0) {
        $out .= "\n💰 " . number_format($salary, 0, ',', ' ') . ' ₽' . ($kind === 'perm' ? '/мес' : '');
    }

    return $out . "\n\n⚡ В приложении смены появляются раньше — откликайся первым 👇";
}


/**
 * Строка в переписку об отказе по смене.
 *
 * Прежний текст — «Вы не подошли по данной вакансии. Чат закрыт.» — плох не
 * тем, что врёт: переписка действительно закрывается, экран блокирует ввод по
 * отклонённому отклику (isChatBlocked в app/chat-room.tsx). Плох он тем, что
 * не говорит, ПО КАКОЙ вакансии отказ, — а чат один на пару людей, и речь в
 * нём идёт о нескольких сменах подряд.
 *
 * Поэтому смену называем, а про закрытую переписку оставляем: без этого
 * человек упрётся в серый ввод и не поймёт, почему. Форма безличная — чтобы
 * не угадывать род названия компании.
 */
function jt_shift_reject_announce(string $workerId, string $employerId, string $vacTitle = ''): string
{
    if ($workerId === '' || $employerId === '') return '';

    // Уведомление — ПЕРВЫМ и всегда, строка в переписку — если переписка есть.
    //
    // Порядок тут решает всё. Чат заводится только на мэтче: у человека,
    // которому отказали с экрана «Кандидаты», переписки обычно нет вовсе, и
    // одной строкой до него не достучаться никак. Именно этот случай и был
    // самым частым молчанием.
    //
    // «Работодатель» в тексте не для вежливости: название компании бывает
    // любого рода, а так глагол согласуется всегда.
    //
    // И только колокольчик — без пуша и без телеграма, см. notify_bell.
    // Отказов много, они неприятные, и человек, разбуженный третьим за вечер,
    // выключает уведомления целиком — вместе с теми, ради которых он их и
    // включал. Узнать об отказе он всё равно узнает: колокольчик, строка в
    // переписке и непрочитанное на вкладке никуда не делись, и в приложение
    // он заходит сам, потому что ждёт ответа.
    notify_bell($workerId, '❌ Отклик отклонён',
        'Работодатель отклонил ваш отклик на смену'
            . (trim($vacTitle) !== '' ? ' «' . trim($vacTitle) . '»' : '') . '.',
        'shift_rejected');

    $chat = sb_single('jm_chats',
        ['worker_id' => 'eq.' . $workerId, 'employer_id' => 'eq.' . $employerId],
        'id,unread_worker');
    if (!$chat) return '';

    $title = trim($vacTitle);
    $named = $title !== '' ? ' «' . $title . '»' : '';
    $text = 'Отклик на смену' . $named . ' отклонён. Переписка по ней закрыта.';

    msg_insert(['id' => uid(), 'chat_id' => $chat['id'], 'sender_id' => 'system',
        'text' => $text, 'created_at' => now_iso()]);
    sb_update('jm_chats', ['id' => 'eq.' . $chat['id']],
        ['unread_worker' => (int)($chat['unread_worker'] ?? 0) + 1]);
    return $text;
}

/**
 * Сказать соискателю о решении по его отклику на постоянную вакансию.
 *
 * Раньше это делал телефон директора: после записи статуса приложение
 * отдельными вызовами слало уведомление и системную строку в чат, и оба
 * вызова были «выстрелил и забыл». Уведомление терялось при любом обрыве, а
 * системная строка НЕ ДОХОДИЛА ВООБЩЕ: писать сообщение от имени «system»
 * приложению запрещено (проверка «Invalid sender» в начале файла), и отказ
 * гасился пустым .catch(). Директор видел строку у себя — её дорисовывали на
 * месте, — а соискатель не видел ничего.
 *
 * Теперь и то и другое делает сервер в том же запросе, что меняет статус.
 *
 * Заголовки уведомлений те же, что слало приложение. Это не случайность:
 * notify_user гасит повтор с тем же заголовком в течение минуты, поэтому со
 * старой сборки второе уведомление не придёт.
 */
function jt_perm_app_announce(array $app, string $status, bool $writeChat = true): void
{
    if ($status !== 'approved' && $status !== 'rejected') return;
    $workerId = trim((string)($app['worker_id'] ?? ''));
    $employerId = trim((string)($app['employer_id'] ?? ''));
    if ($workerId === '') return;

    $v = sb_single('jm_perm_vacancies',
        ['id' => 'eq.' . (string)($app['vacancy_id'] ?? '')], 'title,company');
    // Вакансию могли удалить. Тогда в уведомлении остаётся прежняя заглушка,
    // а в строке чата название просто опускается: «на вакансию «вакансию»»
    // читать невозможно.
    $title = trim((string)($v['title'] ?? ''));
    $named = $title !== '' ? ' «' . $title . '»' : '';
    $company = trim((string)($v['company'] ?? '')) ?: 'Работодатель';

    if ($status === 'approved') {
        notify_user($workerId, '✅ Заявка одобрена!',
            $company . ' одобрили вашу заявку на «' . ($title ?: 'вакансию')
                . '» и написали вам — ответьте в чате.',
            'perm_approved');
        $line = 'Заявка на вакансию' . $named . ' одобрена. Обсудите детали выхода.';
    } else {
        // Здесь пуш остаётся, в отличие от отказа по смене (см. notify_bell).
        // Разница не в вежливости, а в частоте: смен человек перебирает
        // десятки за вечер, а заявку на постоянную работу подаёт осознанно и
        // ответа ждёт — такой отказ приходит редко и «просто так» не будит.
        notify_user($workerId, '❌ Заявка отклонена',
            $company . ' отклонили вашу заявку на «' . ($title ?: 'вакансию') . '».',
            'perm_rejected');
        $line = 'Заявка на вакансию' . $named . ' отклонена. Переписка по ней закрыта.';
    }

    // Строку пишем только в УЖЕ существующий разговор. При одобрении из
    // «Мэтчей» чат заводится следующим запросом и сразу с личным сообщением
    // директора — системная строка там была бы лишней.
    if (!$writeChat || $employerId === '') return;
    $chat = sb_single('jm_chats',
        ['worker_id' => 'eq.' . $workerId, 'employer_id' => 'eq.' . $employerId],
        'id,unread_worker');
    if (!$chat) return;

    msg_insert(['id' => uid(), 'chat_id' => $chat['id'], 'sender_id' => 'system',
        'text' => $line, 'created_at' => now_iso()]);
    sb_update('jm_chats', ['id' => 'eq.' . $chat['id']],
        ['unread_worker' => (int)($chat['unread_worker'] ?? 0) + 1]);
}

/**
 * Список значений для фильтра PostgREST `in.(…)`.
 *
 * Складывать значения через запятую напрямую нельзя: id пользователя приходит
 * с клиента при регистрации и формат его никто не проверяет. Запятая внутри
 * разорвала бы список на два значения, а скобка — сломала бы запрос целиком, и
 * тогда падает всё, что этот запрос делает. Мой счётчик согласий в суточном
 * отчёте именно так и уронил бы весь отчёт.
 *
 * PostgREST разрешает брать значение в двойные кавычки; внутри них кавычка
 * экранируется обратной косой.
 */
function sb_in_list(array $values): string
{
    $quoted = [];
    foreach ($values as $v) {
        $quoted[] = '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], (string)$v) . '"';
    }
    return 'in.(' . implode(',', $quoted) . ')';
}

/**
 * Записать согласие в тот же заход, что создал человека.
 *
 * Раньше согласие писалось ОТДЕЛЬНЫМ запросом с клиента, и запрос этот был
 * «выстрелил и забыл»: void dbRecordConsent(...) без ожидания, без повтора,
 * без обработки отказа. Регистрация идёт с телефона, часто на плохой связи —
 * сеть моргнула, и человек зарегистрирован, а записи о том, что он принял
 * условия, нет. Узнать об этом было неоткуда.
 *
 * Запись согласия — не аналитика, а доказательство: именно её предъявляют,
 * когда спрашивают, на каком основании мы обрабатываем данные человека.
 *
 * Идентификатор строки тот же, что в dbRecordConsent: человек плюс отпечаток
 * набора документов. Поэтому повторный вызов с клиента (старые версии
 * приложения его ещё делают) перезаписывает ту же строку, а не плодит вторую.
 *
 * Отказ не роняет регистрацию — отказать человеку в регистрации из-за сбоя
 * записи было бы хуже. Зато молчания больше нет: суточный отчёт считает тех,
 * кто зарегистрировался без согласия, и поднимает тревогу.
 */

function jt_consent_attach(string $uid, $payload): void
{
    if (!is_array($payload)) return;
    $stamp = trim((string)($payload['stamp'] ?? ''));
    if ($stamp === '') return;
    $docs = is_array($payload['docs'] ?? null) ? $payload['docs'] : [];

    try {
        sb_upsert('jm_consents', [
            'id'          => $uid . ':' . substr(hash('sha256', $stamp), 0, 16),
            'user_id'     => $uid,
            'stamp'       => $stamp,
            'docs'        => $docs,
            'source'      => 'registration',
            'accepted_at' => now_iso(),
        ], 'id');

        // Отдельная добровольная галочка при регистрации хранится отдельной
        // строкой. Так можно доказать самостоятельное волеизъявление, не
        // смешивая его с общим согласием на обработку ПДн.
        $crossVersion = trim((string)($payload['crossBorderVersion'] ?? ''));
        if ($crossVersion !== '' && hash_equals(JT_CROSSBORDER_CONSENT_VERSION, $crossVersion)) {
            sb_upsert('jm_consents', [
                'id'          => 'cb:' . $uid . ':' . substr(hash('sha256', $crossVersion), 0, 16),
                'user_id'     => $uid,
                'stamp'       => 'crossborder:' . $crossVersion,
                'docs'        => ['crossBorderConsent' => $crossVersion],
                'source'      => 'crossborder:registration',
                'accepted_at' => now_iso(),
            ], 'id');
        }
    } catch (Throwable $e) {
        // См. выше: регистрацию не роняем, но и не молчим — считается в отчёте.
    }
}

/** Текущее отдельное решение по трансграничной передаче. */
function jt_crossborder_status(string $uid): array
{
    if ($uid === '') {
        return ['accepted' => false, 'version' => null, 'source' => null, 'accepted_at' => null];
    }
    try {
        $rows = sb_select('jm_consents', ['user_id' => 'eq.' . $uid],
            'docs,source,accepted_at', 'accepted_at.desc');
        foreach ($rows as $row) {
            $source = (string)($row['source'] ?? '');
            $docs = $row['docs'] ?? [];
            if (is_string($docs)) $docs = json_decode($docs, true) ?: [];
            $version = is_array($docs) ? (string)($docs['crossBorderConsent'] ?? '') : '';

            if (str_starts_with($source, 'crossborder:')) {
                $accepted = $source !== 'crossborder:revoked'
                    && $version !== ''
                    && hash_equals(JT_CROSSBORDER_CONSENT_VERSION, $version);
                return [
                    'accepted' => $accepted,
                    'version' => $version !== '' ? $version : null,
                    'source' => $source,
                    'accepted_at' => $row['accepted_at'] ?? null,
                ];
            }

            // Совместимость с коротким переходным периодом, когда отдельная
            // галочка уже была в UI, но её версия ещё писалась внутрь общей
            // записи. Новые согласия так больше не сохраняются.
            if ($version !== '' && hash_equals(JT_CROSSBORDER_CONSENT_VERSION, $version)) {
                return [
                    'accepted' => true,
                    'version' => $version,
                    'source' => 'legacy-embedded-crossborder',
                    'accepted_at' => $row['accepted_at'] ?? null,
                ];
            }
        }
    } catch (Throwable $e) {}
    return ['accepted' => false, 'version' => null, 'source' => null, 'accepted_at' => null];
}

function jt_has_crossborder_consent(string $uid): bool
{
    return !empty(jt_crossborder_status($uid)['accepted']);
}

function jt_referral_attach(string $uid, string $rawCode): void
{
    try {
        $fields = ['referral_code' => jt_referral_code_unique()];

        $code = ref_code_normalize($rawCode);
        $inviterId = null;
        if ($code !== null) {
            $inviter = sb_single('jm_users', ['referral_code' => 'eq.' . $code], 'id');
            $inviterId = $inviter['id'] ?? null;
        }
        $verdict = ref_can_attribute(
            $inviterId !== null ? (string)$inviterId : null, $uid, false, null);
        if ($verdict['ok']) {
            $fields['invited_by'] = (string)$inviterId;
            $fields['invited_at'] = now_iso();
        }

        sb_update('jm_users', ['id' => 'eq.' . $uid], $fields);
    } catch (Throwable $e) {
        // Колонок ещё нет (миграция 064 не применена) или база моргнула.
        // Человек зарегистрирован — это главное.
    }
}

function jt_referral_code_unique(): string
{
    for ($i = 0; $i < 5; $i++) {
        $code = ref_code_new();
        if (sb_single('jm_users', ['referral_code' => 'eq.' . $code], 'id') === null) return $code;
    }
    // Пять совпадений подряд — это не везение, а сломанный источник
    // случайности. Молча выдать шестой код значило бы спрятать поломку.
    throw new RuntimeException('не удалось подобрать свободный код приглашения');
}

function jt_referral_on_outcome(string $likeId, string $outcome, ?string $byUserId): void
{
    try {
        $like = sb_single('jm_likes', ['id' => 'eq.' . $likeId], 'worker_id,employer_id');
        $workerId = trim((string)($like['worker_id'] ?? ''));
        if ($workerId === '') return;

        // Начисляем, только если смену закрыл РАБОТОДАТЕЛЬ, и именно тот, чья
        // она. Без этой проверки программа печатала бы деньги: dbSetShiftOutcome
        // требует входа, но не проверяет, чья смена, — значит любой вошедший
        // мог бы закрыть чужую смену как отработанную. Двух своих учёток и
        // двух номеров хватило бы, чтобы начислить себе вознаграждение без
        // единого настоящего выхода на смену.
        //
        // Берём именно $authUid из подписанной сессии. В строке есть поле
        // outcome_by, но его присылает клиент, и доказывает оно ровно ничего.
        $employerId = trim((string)($like['employer_id'] ?? ''));
        if ($byUserId === null || $byUserId === '' || $byUserId !== $employerId) return;
        // И работник не может быть работодателем сам себе.
        if ($employerId === $workerId) return;

        $worker = sb_single('jm_users', ['id' => 'eq.' . $workerId], 'id,invited_by');
        $invitedBy = trim((string)($worker['invited_by'] ?? ''));
        if ($invitedBy === '') return;

        $existing = sb_single('jm_referral_rewards', ['invitee_id' => 'eq.' . $workerId], 'id,like_id,outcome');

        // Отметку об итоге смены можно ИСПРАВИТЬ: dbSetShiftOutcome зовётся
        // повторно, рейтинг пересчитывается. А поручительство до этой ветки
        // не пересчитывалось: строка про первую смену уже была, и правка
        // молча отбрасывалась. Работодатель, промахнувшийся мимо кнопки,
        // навсегда портил поручителю карточку отметкой «не вышел».
        //
        // Правим только ту строку, что заведена этой же сменой. Итог ДРУГОЙ
        // смены — не исправление, а вторая смена, а записываем мы первую.
        if ($existing !== null
            && trim((string)($existing['like_id'] ?? '')) === $likeId
            && in_array($outcome, REF_OUTCOMES, true)
            && (string)($existing['outcome'] ?? '') !== $outcome) {
            sb_update('jm_referral_rewards', ['id' => 'eq.' . $existing['id']],
                ['outcome' => $outcome, 'qualified_at' => now_iso()]);
            jt_referral_bump($invitedBy, $outcome === 'worked' ? 1 : -1);
            return;
        }

        $verdict = ref_should_record($outcome, $invitedBy, $workerId, $existing !== null, $employerId);
        if (!$verdict['ok']) return;

        // Денег здесь нет и не обещано: программа платит поручительством.
        // Записываем оба итога — и выход, и невыход. Второй нужен не для
        // наказания, а чтобы первый что-то значил: если считать только
        // выходы, число на карточке набирается рассылкой кода сотне
        // незнакомых людей, и работодателю оно ничего не говорит.
        sb_insert('jm_referral_rewards', [
            'id' => uid(),
            'inviter_id' => $invitedBy,
            'invitee_id' => $workerId,
            'like_id' => $likeId,
            'outcome' => $outcome,
            'qualified_at' => now_iso(),
        ]);

        if ($outcome === 'worked') jt_referral_bump($invitedBy, 1);
    } catch (Throwable $e) {
        // См. выше: итог смены важнее начисления.
    }
}

/**
 * Подвинуть счётчик поручительств на карточке приглашающего.
 *
 * Зачем счётчик вообще нужен: карточку кандидата работодатель видит списком,
 * и считать по журналу на каждого значило бы сорок запросов на один экран.
 *
 * Чтение и запись здесь раздельные — PostgREST не умеет «прибавь единицу»
 * без хранимой функции. Две одновременные отметки об окончании смены у
 * одного поручителя могут потерять инкремент. Журнал остаётся источником
 * правды, и пересчёт из него — в миграции 065; её можно прогнать повторно.
 */
function jt_referral_bump(string $inviterId, int $delta): void
{
    $inviter = sb_single('jm_users', ['id' => 'eq.' . $inviterId], 'id,referral_worked');
    if ($inviter === null) return;
    // Ниже нуля счётчик не опускаем: отрицательное поручительство — не
    // смысл, а расхождение, и на карточке оно выглядело бы поломкой.
    $next = max(0, (int)($inviter['referral_worked'] ?? 0) + $delta);
    sb_update('jm_users', ['id' => 'eq.' . $inviterId], ['referral_worked' => $next]);
}

function jt_recalc_score(string $uid): array {
    $out = [
        'score' => null, 'score_shifts' => 0,
        'score_reliability' => null, 'score_punctuality' => null,
        'score_quality' => null, 'score_speed' => null,
        'score_employers' => 0, 'score_updated_at' => now_iso(),
    ];
    try {
        $likes = sb_select_all('jm_likes', ['worker_id' => 'eq.' . $uid],
            'employer_id,outcome,late_minutes');

        $worked = 0; $noShow = 0; $onTime = 0; $lateKnown = 0;
        $employers = [];
        foreach ($likes as $l) {
            $o = $l['outcome'] ?? null;
            if ($o === 'worked') {
                $worked++;
                if ($l['employer_id']) $employers[(string)$l['employer_id']] = true;
                // late_minutes заполняется только с августа 2026. У смен
                // постарше его нет, и записывать их как «пришёл вовремя»
                // значило бы выдумать пунктуальность, которой не мерили.
                if ($l['late_minutes'] !== null) {
                    $lateKnown++;
                    if ((int)$l['late_minutes'] === 0) $onTime++;
                }
            } elseif ($o === 'no_show') {
                $noShow++;
            }
            // worker_cancelled: предупредил заранее — это не невыход, и в
            // надёжность не идёт. employer_cancelled и cancelled_legacy к
            // работнику отношения не имеют вовсе.
        }

        $out['score_shifts'] = $worked;
        $out['score_employers'] = count($employers);

        $ratings = sb_select_all('jm_ratings',
            ['to_user_id' => 'eq.' . $uid, 'role' => 'eq.employer'],
            'rating,quality,speed');
        // role здесь — роль оценивающего: 'employer' значит «работодатель
        // оценил работника». Оценки, которые сам работник ставил другим, в
        // его рейтинг, разумеется, не идут.
        $rSum = 0; $rN = 0; $qSum = 0; $qN = 0; $sSum = 0; $sN = 0;
        foreach ($ratings as $r) {
            if ($r['rating'] !== null) { $rSum += (float)$r['rating']; $rN++; }
            if ($r['quality'] !== null) { $qSum += (float)$r['quality']; $qN++; }
            if ($r['speed'] !== null) { $sSum += (float)$r['speed']; $sN++; }
        }

        $out['score_reliability'] = ($worked + $noShow) > 0
            ? round($worked / ($worked + $noShow), 4) : null;
        $out['score_punctuality'] = $lateKnown > 0 ? round($onTime / $lateKnown, 4) : null;
        $out['score_quality'] = $qN > 0 ? round(($qSum / $qN) / 5, 4) : null;
        $out['score_speed']   = $sN > 0 ? round(($sSum / $sN) / 5, 4) : null;

        if ($worked >= SCORE_MIN_SHIFTS) {
            $оси = [
                'reliability' => $out['score_reliability'],
                'punctuality' => $out['score_punctuality'],
                'rating'      => $rN > 0 ? ($rSum / $rN) / 5 : null,
                'quality'     => $out['score_quality'],
                'speed'       => $out['score_speed'],
                'experience'  => min(1.0, $worked / SCORE_EXPERIENCE_FULL),
            ];
            // Ось, по которой нечего сказать, не тянет вниз — она просто не
            // участвует, а её вес перераспределяется на остальные. Иначе
            // работник, которого забыли оценить, оказывался бы хуже того,
            // кого оценили на тройку.
            $вес = 0; $сумма = 0;
            foreach (SCORE_WEIGHTS as $ключ => $w) {
                if ($оси[$ключ] === null) continue;
                $вес += $w;
                $сумма += $w * max(0.0, min(1.0, (float)$оси[$ключ]));
            }
            if ($вес > 0) $out['score'] = (int)round(100 * $сумма / $вес);
        }

        sb_update('jm_users', ['id' => 'eq.' . $uid], $out);
    } catch (Throwable $e) {
        // Пересчёт — дело служебное. Смена отмечена, оценка записана; если
        // рейтинг не сошёлся, он сойдётся при следующей записи.
    }
    return $out;
}

// Репутация работодателя. Оси те же четыре, что в презентации: соответствие
// описанию, отношение, выплаты и отмены смен.
//
// Отмены — единственная ось, которую не спрашивают, а считают: с августа у
// каждой несостоявшейся смены записана причина. Спрашивать у человека то,
// что уже лежит в базе, значит получить худшие данные и заодно удлинить
// форму, которую и так половина пропускает.
const EMP_WEIGHTS = [
    'kept'     => 30,   // не отменяет смены
    'pay'      => 30,   // платит вовремя
    'desc'     => 20,   // работа совпала с описанием
    'attitude' => 20,   // отношение к людям
];
const EMP_MIN_SHIFTS = 3;

function jt_recalc_employer_score(string $uid): array {
    $out = [
        'emp_score' => null, 'emp_score_shifts' => 0,
        'emp_score_desc' => null, 'emp_score_attitude' => null,
        'emp_score_pay' => null, 'emp_score_kept' => null,
        'emp_score_updated_at' => now_iso(),
    ];
    try {
        $likes = sb_select_all('jm_likes', ['employer_id' => 'eq.' . $uid], 'outcome');
        $всего = 0; $отменил = 0;
        foreach ($likes as $l) {
            $o = $l['outcome'] ?? null;
            // Считаем только смены с записанным исходом. cancelled_legacy не
            // берём: причины у них нет, и приписать её работодателю значило
            // бы наказать за то, чего мы не знаем.
            if (!in_array($o, ['worked', 'no_show', 'worker_cancelled', 'employer_cancelled'], true)) continue;
            $всего++;
            if ($o === 'employer_cancelled') $отменил++;
        }
        $out['emp_score_shifts'] = $всего;
        $out['emp_score_kept'] = $всего > 0 ? round(1 - $отменил / $всего, 4) : null;

        // role='worker' — это оценка, которую поставил работник, то есть
        // оценка работодателя.
        $rs = sb_select_all('jm_ratings',
            ['to_user_id' => 'eq.' . $uid, 'role' => 'eq.worker'],
            'emp_matched_desc,emp_attitude,emp_paid_on_time');
        $ср = function (string $поле) use ($rs) {
            $s = 0; $n = 0;
            foreach ($rs as $r) {
                if ($r[$поле] !== null) { $s += (float)$r[$поле]; $n++; }
            }
            return $n > 0 ? round(($s / $n) / 5, 4) : null;
        };
        $out['emp_score_desc']     = $ср('emp_matched_desc');
        $out['emp_score_attitude'] = $ср('emp_attitude');
        $out['emp_score_pay']      = $ср('emp_paid_on_time');

        if ($всего >= EMP_MIN_SHIFTS) {
            $оси = [
                'kept'     => $out['emp_score_kept'],
                'pay'      => $out['emp_score_pay'],
                'desc'     => $out['emp_score_desc'],
                'attitude' => $out['emp_score_attitude'],
            ];
            $вес = 0; $сумма = 0;
            foreach (EMP_WEIGHTS as $ключ => $w) {
                if ($оси[$ключ] === null) continue;
                $вес += $w;
                $сумма += $w * max(0.0, min(1.0, (float)$оси[$ключ]));
            }
            if ($вес > 0) $out['emp_score'] = (int)round(100 * $сумма / $вес);
        }

        sb_update('jm_users', ['id' => 'eq.' . $uid], $out);
    } catch (Throwable $e) {
    }
    return $out;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
try {
    $data = null;

    // Первый живой запрос после выкладки переводит старые plaintext Expo
    // tokens в ciphertext. После этого новые записи уже шифруются сразу.
    jt_encrypt_legacy_push_tokens_once();

    switch ($fn) {

        // ── Users ──────────────────────────────────────────────────────────────
        // Своё приглашение: код и что по нему вышло.
        //
        // Отдельная операция, а не поле в USER_PUBLIC_COLS: те колонки уходят
        // при запросе ЛЮБОГО человека, и код приглашения утёк бы ко всем. Он
        // не секрет, но чужой код в руках постороннего — это чужое
        // вознаграждение.
        //
        // Код заводится при первом обращении: у всех, кто зарегистрировался до
        // миграции 064, его нет, и выдавать им пустоту значило бы закрыть
        // программу для существующих людей — то есть для тех, кто как раз и
        // может кого-то позвать.
        case 'dbGetMyReferral': {
            $me = trim((string)($args[0] ?? ''));
            $row = sb_single('jm_users', ['id' => 'eq.' . $me], 'id,referral_code');
            if (!$row) throw new RuntimeException('Пользователь не найден');
            $code = trim((string)($row['referral_code'] ?? ''));
            if ($code === '') {
                $code = jt_referral_code_unique();
                sb_update('jm_users', ['id' => 'eq.' . $me], ['referral_code' => $code]);
            }
            // Суммы здесь нет и не будет: программа платит поручительством, а
            // не деньгами. Три числа вместо одного бодрого — потому что смысл
            // программы ровно в разрыве между ними: позвал, вышли, не вышли.
            // Спрятать третье значило бы вернуться к счёту регистраций, за
            // который Jobr и поплатился.
            $data = [
                'code' => $code,
                'invited' => sb_count('jm_users', ['invited_by' => 'eq.' . $me]),
                'worked' => sb_count('jm_referral_rewards',
                    ['inviter_id' => 'eq.' . $me, 'outcome' => 'eq.worked']),
                'noShow' => sb_count('jm_referral_rewards',
                    ['inviter_id' => 'eq.' . $me, 'outcome' => 'eq.no_show']),
            ];
            break;
        }

        case 'dbGetUserById':
            $data = sb_single('jm_users', ['id' => 'eq.' . $args[0]], USER_PUBLIC_COLS); break;

        case 'dbGetUsers':
            $data = sb_select('jm_users', [], USER_PUBLIC_COLS, 'created_at.asc'); break;

        // Только число для приветственного экрана. Раньше он считал сам,
        // напрямую из базы публичным ключом, — и после закрытия базы получал
        // отказ, показывая число из кэша телефона, замороженное навсегда.
        case 'dbCountUsers':
            $data = sb_count('jm_users'); break;

        // Какого рода ключ лежит на хостинге — не сам ключ, а только его вид.
        //
        // Понадобилось после того, как отключение старых JWT-ключей в Supabase
        // положило приложение: в sb_service_key.php оказался старый ключ, а
        // снаружи это было не отличить — старый работал, пока его не погасили,
        // и выглядело всё исправным. Теперь вид ключа можно спросить заранее.
        //
        // Значение не раскрывается: наружу уходит одно слово и длина.
        case 'dbKeyKind': {
            $k = SB_KEY;
            $kind = $k === '' ? 'нет ключа'
                  : (strpos($k, 'sb_secret_') === 0 ? 'новый секретный (sb_secret_)'
                  : (strpos($k, 'sb_publishable_') === 0 ? 'публикуемый — на сервере он бесполезен'
                  : (strpos($k, 'eyJ') === 0 ? 'СТАРЫЙ JWT — погаснет при отключении legacy-ключей'
                  : 'неизвестный вид')));
            $data = ['kind' => $kind, 'length' => strlen($k)];
            break;
        }

        // Заявка на привязку Telegram: живёт 15 минут, бот заберёт её по «/start»
        case 'tgPrepareLink': {
            $data = ['error' => 'Telegram больше не используется в JobToo'];
            break;
        }

        // Отметка «был в сети». Колонки может ещё не быть — тогда просто молчим:
        // ради фоновой отметки нельзя возвращать клиенту ошибку.
        case 'dbTouchLastSeen':
            try {
                sb_update('jm_users', ['id' => 'eq.' . $args[0]], ['last_seen_at' => now_iso()]);
            } catch (\Throwable $e) { /* колонки нет — не беда */ }
            break;

        // Пароль хешируется здесь, на сервере. Раньше приложение клало его в
        // базу как есть, и с конца июня так набралось 176 паролей открытым
        // текстом. Уже готовый хеш второй раз не трогаем: этой же операцией
        // сохраняется профиль целиком, и пароль в нём приезжает обратно.
        case 'dbUpsertUser': {
            $u = is_array($args[0] ?? null) ? $args[0] : [];
            $uid = trim((string)($u['id'] ?? ''));
            if ($uid === '') throw new RuntimeException('Нужен id пользователя');
            $existing = sb_single('jm_users', ['id' => 'eq.' . $uid], 'id');
            if (!$existing && !jt_new_user_id_is_valid($uid)) {
                throw new RuntimeException('Некорректный id пользователя');
            }
            if ($existing && $authUid !== $uid) {
                jt_respond(['error' => 'Authentication required'], 401); exit;
            }
            if (!$existing && (empty($u['phone']) || empty($u['password']))) {
                throw new RuntimeException('Для регистрации нужны телефон и пароль');
            }
            if (!$existing) {
                // Старые сборки иногда присылали профиль без role. Postgres
                // тогда отвечал внутренним "null value ... violates not-null",
                // и даже загрузка резюме выглядела как поломка базы.
                // Новые клиенты роль присылают явно; для старых восстанавливаем
                // безопасно из типа анкеты: компания есть только у работодателя.
                $role = trim((string)($u['role'] ?? ''));
                if (!in_array($role, ['worker', 'employer'], true)) {
                    $role = trim((string)($u['company'] ?? '')) !== '' ? 'employer' : 'worker';
                }
                $u['role'] = $role;
            }

            // Сюда приходит профиль целиком, и раньше он целиком же уходил в
            // базу. Но в той же строке лежат поля, которые человек про себя
            // назначать не должен: `is_blocked` — это его блокировка,
            // `avg_rating`/`rating_count` — оценки, которые ему поставили
            // другие, `telegram_id` и `push_token` — адреса доставки, у них
            // свои операции с проверкой владения.
            //
            // Клиент их и не шлёт (`services/db.ts` вырезает оценки сам), но
            // запрос к `db.php` пишется руками за пять минут: пропуск лежит в
            // бандле сайта. Поэтому решает сервер, а не добрая воля клиента.
            // Список именно тот, что шлёт `userToRow` в services/db.ts, минус
            // запретное. `nudge_off` и `vacancy_delivery_mode` сюда не входят
            // намеренно: их меняет бот через /settings, и лишний путь записи
            // здесь ни к чему.
            $editable = [
                'first_name', 'last_name', 'age', 'metro_line_id', 'metro_station',
                'work_types', 'company', 'bio', 'avatar_url', 'resume_data',
                'resume_email', 'resume_file_name', 'resume_imported_at', 'personal_data',
            ];
            // При регистрации строки ещё нет: тогда же задаются и те поля,
            // которые потом менять нельзя. Роль и телефон — опознание
            // человека, и смена их задним числом ломает вход.
            $atCreate = ['id', 'role', 'phone', 'password', 'created_at'];
            $allowed = $existing ? $editable : array_merge($editable, $atCreate);
            // Пароль меняется через dbChangePassword со сверкой старого.
            if ($existing) $u = array_diff_key($u, ['password' => 1]);
            $u = array_intersect_key($u, array_flip($allowed));
            $u['id'] = $uid;
            // Клиент присылает is_blocked: false при каждом сохранении профиля.
            // Своё значение тут задаёт сервер, а не присланное.
            if (!$existing) $u['is_blocked'] = false;
            // Пустой пароль — это не «сотри пароль», а «в профиле его нет».
            if (empty($u['password'])) {
                unset($u['password']);
            } elseif (!is_bcrypt($u['password'])) {
                $u['password'] = password_hash((string)$u['password'], PASSWORD_BCRYPT);
            }
            if ($existing) {
                // Для уже существующей строки нужен PATCH, а не upsert.
                // Upsert в PostgREST сначала собирает INSERT-кандидата и
                // проверяет NOT NULL ещё до разрешения конфликта. Поскольку
                // role/phone намеренно нельзя менять из профиля, их нет в
                // $editable — и такой INSERT-кандидат падал на role = null.
                // PATCH обновляет только разрешённые поля существующей строки.
                $update = $u;
                unset($update['id']);
                sb_update('jm_users', ['id' => 'eq.' . $uid], $update);
            } else {
                sb_upsert('jm_users', $u, 'id');
            }
            // Приглашение пишем ОТДЕЛЬНОЙ операцией и после того, как человек
            // уже создан.
            //
            // Сначала я дописывал эти поля в ту же строку — и это сломало бы
            // регистрацию всем. Миграция 064 применяется руками, деплой
            // уезжает сам при слиянии; между этими моментами колонки
            // referral_code в базе нет, PostgREST отвечает 400 на неизвестное
            // поле, а sb() на 400 бросает исключение. То есть весь
            // dbUpsertUser падал бы, и никто не смог бы зарегистрироваться.
            //
            // Теперь худшее, что может случиться до миграции, — человек
            // зарегистрируется без кода приглашения. Код ему всё равно
            // заведётся при первом заходе на экран приглашения.
            if (!$existing) {
                jt_referral_attach($uid, (string)($args[1] ?? ''));
                // Согласие — в этом же заходе. Отдельным запросом оно терялось
                // при любом обрыве связи, см. jt_consent_attach.
                jt_consent_attach($uid, $args[2] ?? null);
            }
            $data = ['session_token' => $existing ? null : jt_session_issue($uid)];
            break;
        }

        // Вход. Сверка переехала сюда с клиента: раньше приложение спрашивало
        // профиль по номеру телефона и сравнивало пароль у себя — а значит
        // пароль (или его хеш) уходил наружу всякому, кто знает номер.
        //
        // Принимаем обе формы. Пока у части людей пароль лежит открытым
        // текстом, отказывать им нельзя; зато при удачном входе такой пароль
        // тут же превращается в хеш — база вычищается сама, по мере того как
        // люди заходят.
        case 'dbLogin': {
            if (jt_try_blocked('login')) {
                jt_respond(['error' => 'Слишком много попыток входа. Попробуйте через 15 минут.'], 429); exit;
            }
            $phone = preg_replace('/\D+/', '', (string)($args[0] ?? ''));
            $pass  = (string)($args[1] ?? '');
            $row = $phone === '' ? null : sb_single('jm_users', ['phone' => 'eq.' . $phone]);
            if (!$row || $pass === '' || empty($row['password'])) { jt_try_note('login'); $data = null; break; }

            $stored = (string)$row['password'];
            $ok = is_bcrypt($stored) ? password_verify($pass, $stored) : hash_equals($stored, $pass);
            if (!$ok) { jt_try_note('login'); $data = null; break; }
            jt_try_reset('login');

            if (!is_bcrypt($stored)) {
                try {
                    sb_update('jm_users', ['id' => 'eq.' . $row['id']],
                        ['password' => password_hash($pass, PASSWORD_BCRYPT)]);
                } catch (\Throwable $e) { /* вход важнее, чем перевод в хеш */ }
            }

            unset($row['password']);
            $data = ['user' => $row, 'session_token' => jt_session_issue((string)$row['id'])]; break;
        }

        case 'dbSession': {
            $row = sb_single('jm_users', ['id' => 'eq.' . $authUid], USER_SELF_COLS);
            $data = $row ? ['user' => $row] : null;
            break;
        }

        // Смена пароля в профиле. Тоже на сервере — на клиенте старый пароль
        // сравнивался строкой, то есть для всех, у кого уже хеш, смена пароля
        // попросту не работала.
        case 'dbChangePassword': {
            $row = sb_single('jm_users', ['id' => 'eq.' . ($args[0] ?? '')], 'id,password');
            $old = (string)($args[1] ?? '');
            $new = (string)($args[2] ?? '');
            if (!$row || $new === '') { $data = ['ok' => false, 'reason' => 'not_found']; break; }

            $stored = (string)($row['password'] ?? '');
            $ok = is_bcrypt($stored) ? password_verify($old, $stored) : hash_equals($stored, $old);
            if (!$ok) { $data = ['ok' => false, 'reason' => 'wrong_password']; break; }

            // Вместе с паролем гасим выданные токены: смена пароля затем и
            // делается, что доступ у кого-то лишнего. Свой же токен станет
            // недействителен, поэтому тут же выдаём новый.
            $upd = ['password' => password_hash($new, PASSWORD_BCRYPT)];
            try {
                sb_update('jm_users', ['id' => 'eq.' . $row['id']],
                    $upd + ['sessions_valid_from' => now_iso()]);
            } catch (\Throwable $e) {
                sb_update('jm_users', ['id' => 'eq.' . $row['id']], $upd);
            }
            $data = ['ok' => true, 'session_token' => jt_session_issue((string)$row['id'])]; break;
        }

        // Сброс чужого пароля — для дашборда.
        //
        // Раньше дашборд ходил за этим прямо в Supabase собственным ключом.
        // Ключ отозвали, и кнопка стала отвечать «Unregistered API key» —
        // причём тем, кто её нажимал, а не тем, кто мог бы починить. Рабочий
        // ключ лежит на хостинге, и правильнее ходить сюда, как ходят
        // остальные страницы дашборда: меньше мест, где живут ключи.
        case 'adminResetPassword': {
            $uid = (string)($args[0] ?? '');
            if ($uid === '') { $data = ['ok' => false, 'reason' => 'no_user']; break; }

            // Шесть знаков без похожих друг на друга: пароль диктуют голосом,
            // и «0 или O» на том конце провода стоит отдельного звонка.
            $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            $pass = '';
            for ($i = 0; $i < 6; $i++) $pass .= $alphabet[random_int(0, strlen($alphabet) - 1)];

            // return=representation: без него запрос по несуществующему id
            // проходил молча, и дашборд показывал пароль, которого ни у кого нет.
            // Сброс пароля из дашборда — это обычно ответ на «у меня увели
            // доступ». Значит и выданные токены надо погасить: иначе тот, кто
            // увёл, ходит дальше с тем же токеном ещё месяц.
            $patch = ['password' => password_hash($pass, PASSWORD_BCRYPT)];
            try {
                $rows = sb('PATCH', 'jm_users', ['id' => 'eq.' . $uid],
                    $patch + ['sessions_valid_from' => now_iso()],
                    ['Prefer: return=representation']);
            } catch (\Throwable $e) {
                $rows = sb('PATCH', 'jm_users', ['id' => 'eq.' . $uid], $patch,
                    ['Prefer: return=representation']);
            }
            if (empty($rows)) { $data = ['ok' => false, 'reason' => 'not_found']; break; }

            $data = ['ok' => true, 'password' => $pass];
            break;
        }

        case 'dbWarmup':
            // Раньше просто возвращалось true — прогревался только PHP, а сама
            // база оставалась холодной. Теперь делаем самое дешёвое чтение:
            // этим же вызовом её будит и расписание раз в пять минут.
            try { sb_select('jm_users', ['limit' => '1'], 'id'); } catch (\Throwable $e) {}
            $data = true; break;

        // Удаление аккаунта: своё стирает, чужое обезличивает.
        //
        // Раньше здесь было `delete from jm_users`, и приложение вызывало
        // это напрямую анонимным ключом. С миграции 013 у anon отобраны все
        // права на таблицу, так что запрос отклонялся — а код ответ не
        // проверял и показывал «Аккаунт удалён». То есть кнопка не удаляла
        // ничего вообще, при этом уверяя в обратном.
        //
        // Теперь работу делает jm_delete_account (миграция 032) под
        // служебной ролью, а здесь проверяется главное: что человек удаляет
        // себя. Без этой проверки по чужому идентификатору стёрся бы чужой
        // аккаунт — функции всё равно, чей номер ей передали.
        case 'dbDeleteAccount': {
            $uid = (string)($args[0] ?? '');
            $pass = (string)($args[1] ?? '');
            if ($uid === '' || $pass === '') {
                $data = ['error' => 'Нужны идентификатор и пароль']; break;
            }
            $u = sb_single('jm_users', ['id' => 'eq.' . $uid], 'id,password');
            if (!$u) { $data = ['error' => 'Пользователь не найден']; break; }
            $stored = (string)($u['password'] ?? '');
            $ok = is_bcrypt($stored) ? password_verify($pass, $stored) : hash_equals($stored, $pass);
            if (!$ok) { $data = ['error' => 'Неверный пароль']; break; }

            // PDF лежат не в таблице, а в Storage: каскад БД удалит метаданные,
            // но сами объекты без этой уборки остались бы навсегда.
            try {
                $resumeRows = sb_select('jm_resume_files', ['user_id' => 'eq.' . $uid], 'storage_path');
                foreach ($resumeRows as $resumeRow) {
                    jt_resume_storage_delete((string)($resumeRow['storage_path'] ?? ''));
                }
            } catch (Throwable $e) {
                // Совместимость с сервером до миграции 100: отсутствие таблицы
                // не должно ломать удаление аккаунта.
            }

            $data = sb_rpc('jm_delete_account', ['uid' => $uid]);
            break;
        }

        // ── Медиа переписки ─────────────────────────────────────────────
        //
        // Фото и голосовые из чатов уходят в закрытый бакет chat-media
        // (миграция 034), а не в публичный avatars, где они лежали раньше:
        // оттуда ссылка открывалась кем угодно, без авторизации и навсегда.
        //
        // Возвращаем путь, а не ссылку. Ссылку приложение просит отдельно,
        // перед показом, и живёт она недолго — см. dbSignMedia ниже.
        case 'dbUploadChatMedia': {
            $name = (string)($args[0] ?? '');
            $b64  = (string)($args[1] ?? '');
            $type = (string)($args[2] ?? 'application/octet-stream');
            if (!preg_match('#^chat/[A-Za-z0-9._-]{1,180}$#', $name) || str_contains($name, '..')) {
                $data = ['error' => 'плохое имя файла']; break;
            }
            // Заливать можно только в свою переписку. Имя задаёт клиент, а
            // выше стоит x-upsert: без этой проверки чужой файл можно было и
            // подменить.
            jt_require_chat_party($authUid, jt_chat_id_from_media_path($name));
            // Бакет закрытый, но ссылку на него подписывают и отдают с того же
            // имени, что и сайт, — значит разметка, залитая сюда, тоже
            // выполнится как своя. Приложение шлёт только фотографии и
            // голосовые (image/jpeg и audio/mp4); всё остальное, и прежде
            // всего svg+xml и html, здесь не нужно.
            $allowedMedia = [
                'image/jpeg', 'image/png', 'image/webp',
                'audio/mp4', 'audio/mpeg', 'audio/aac',
            ];
            if (!in_array($type, $allowedMedia, true)) {
                $data = ['error' => 'такой тип файла в переписке не принимается']; break;
            }
            $bytes = base64_decode($b64, true);
            if ($bytes === false || $bytes === '') { $data = ['error' => 'пустой файл']; break; }
            if (strlen($bytes) > 25 * 1024 * 1024) { $data = ['error' => 'файл больше 25 МБ']; break; }

            $ch = curl_init(SB_URL . '/storage/v1/object/chat-media/' . $name);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CUSTOMREQUEST => 'POST',
                CURLOPT_POSTFIELDS => $bytes,
                CURLOPT_TIMEOUT => 60,
                CURLOPT_HTTPHEADER => [
                    'apikey: ' . SB_KEY,
                    'Authorization: Bearer ' . SB_KEY,
                    'Content-Type: ' . $type,
                    'x-upsert: true',
                ],
            ]);
            $resp = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err  = curl_error($ch);
            curl_close($ch);
            if ($code < 200 || $code >= 300) {
                $data = ['error' => $err ?: ('хранилище ответило ' . $code . ': ' . substr((string)$resp, 0, 200))];
                break;
            }
            $data = ['path' => $name];
            break;
        }

        // Подписанная ссылка на файл переписки: живёт час и после этого
        // перестаёт работать. Утёкшая ссылка протухает сама — в этом вся
        // разница с публичным бакетом, где она не протухала никогда.
        //
        // Принимаем и путь, и старую публичную ссылку целиком: в сообщениях,
        // отправленных до этой правки, лежит именно она, и переписывать их
        // задним числом не нужно.
        case 'dbSignMedia': {
            $raw = (string)($args[0] ?? '');
            if ($raw === '') { $data = ['error' => 'нужен путь']; break; }
            // Подписать ссылку может только сторона этой переписки: id чата
            // стоит в самом имени файла, см. jt_chat_id_from_media_path.
            jt_require_chat_party($authUid, jt_chat_id_from_media_path($raw));

            // Из старой ссылки достаём путь после имени бакета.
            $path = $raw;
            if (str_starts_with($raw, 'http')) {
                if (preg_match('#/avatars/(chat/[^?\s]+)#', $raw, $m)) {
                    $path = $m[1];
                } else {
                    // Не наш адрес и не наш бакет — отдаём как есть, пусть
                    // показывает. Ломать старые сообщения хуже, чем оставить
                    // ссылку прежней.
                    $data = ['url' => $raw]; break;
                }
            }
            if (!preg_match('#^chat/[A-Za-z0-9._-]{1,180}$#', $path) || str_contains($path, '..')) {
                $data = ['error' => 'плохой путь']; break;
            }

            $ch = curl_init(SB_URL . '/storage/v1/object/sign/chat-media/' . $path);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode(['expiresIn' => 3600]),
                CURLOPT_TIMEOUT => 15,
                CURLOPT_HTTPHEADER => [
                    'apikey: ' . SB_KEY,
                    'Authorization: Bearer ' . SB_KEY,
                    'Content-Type: application/json',
                ],
            ]);
            $resp = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            $dec = json_decode($resp ?: 'null', true);

            if ($code >= 200 && $code < 300 && !empty($dec['signedURL'])) {
                $data = ['url' => SB_URL . '/storage/v1' . $dec['signedURL']];
                break;
            }
            // Файла в закрытом бакете нет — значит он ещё лежит в публичном,
            // с тех времён. Возвращаем прежнюю ссылку: старые сообщения
            // должны показываться, пока файлы не переехали.
            $data = ['url' => SB_URL . '/storage/v1/object/public/avatars/' . $path];
            break;
        }

        // Перевозка уже загруженных файлов переписки из публичного бакета
        // в закрытый. Пачками, потому что запрос не должен упираться в
        // время ожидания: сколько там файлов, заранее никто не знает.
        //
        // Порядок важен: сначала копия, только потом удаление оригинала.
        // Если оборвётся посередине — часть файлов окажется в обоих
        // бакетах, и это безобидно: dbSignMedia отдаст подписанную ссылку
        // на закрытый, а не найдёт — вернёт прежнюю публичную. Ни одно
        // сообщение не сломается ни в какой момент перевозки.
        case 'dbMigrateChatMedia': {
            $moved = 0; $failed = 0;
            $ch = curl_init(SB_URL . '/storage/v1/object/list/avatars');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_HTTPHEADER => ['apikey: ' . SB_KEY, 'Authorization: Bearer ' . SB_KEY,
                                       'Content-Type: application/json'],
                CURLOPT_POSTFIELDS => json_encode(['prefix' => 'chat', 'limit' => 100]),
            ]);
            $list = json_decode((string)curl_exec($ch), true);
            curl_close($ch);
            if (!is_array($list)) { $data = ['error' => 'не удалось прочитать список']; break; }

            foreach ($list as $obj) {
                $name = (string)($obj['name'] ?? '');
                if ($name === '' || !preg_match('#^[A-Za-z0-9._-]{1,180}$#', $name)) continue;
                $src = 'chat/' . $name;

                $c = curl_init(SB_URL . '/storage/v1/object/copy');
                curl_setopt_array($c, [
                    CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 30,
                    CURLOPT_HTTPHEADER => ['apikey: ' . SB_KEY, 'Authorization: Bearer ' . SB_KEY,
                                           'Content-Type: application/json'],
                    CURLOPT_POSTFIELDS => json_encode([
                        'bucketId' => 'avatars', 'sourceKey' => $src,
                        'destinationBucket' => 'chat-media', 'destinationKey' => $src,
                    ]),
                ]);
                curl_exec($c);
                $code = (int) curl_getinfo($c, CURLINFO_HTTP_CODE);
                curl_close($c);
                if ($code < 200 || $code >= 300) { $failed++; continue; }

                $d = curl_init(SB_URL . '/storage/v1/object/avatars/' . $src);
                curl_setopt_array($d, [
                    CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => 'DELETE',
                    CURLOPT_TIMEOUT => 20,
                    CURLOPT_HTTPHEADER => ['apikey: ' . SB_KEY, 'Authorization: Bearer ' . SB_KEY],
                ]);
                curl_exec($d); curl_close($d);
                $moved++;
            }
            $data = ['перевезено' => $moved, 'не вышло' => $failed, 'ещё_есть' => count($list) >= 100];
            break;
        }

        // ── Согласие с документами ──────────────────────────────────────
        //
        // Пишем отпечаток принятого набора редакций. Раньше галочка при
        // регистрации жила переменной в памяти экрана и дальше кнопки
        // «Продолжить» о ней не знал никто: ни отметки, ни даты, ни версии.
        //
        // Записывать «принял» задним числом или за другого нельзя, поэтому
        // отпечаток сюда приходит от приложения, а не выдумывается здесь:
        // человек принимал то, что видел на экране своей версии, а не то,
        // что сейчас лежит на сервере.
        case 'dbRecordConsent': {
            $uid    = (string)($args[0] ?? '');
            $stamp  = (string)($args[1] ?? '');
            $docs   = is_array($args[2] ?? null) ? $args[2] : [];
            $source = (string)($args[3] ?? 'registration');
            if ($uid === '' || $stamp === '') {
                $data = ['error' => 'Нужны пользователь и отпечаток']; break;
            }
            if (!sb_single('jm_users', ['id' => 'eq.' . $uid], 'id')) {
                $data = ['error' => 'Пользователь не найден']; break;
            }
            // Именно upsert, а не insert. Идентификатор строки — человек плюс
            // отпечаток набора, то есть при повторном нажатии он тот же самый,
            // и обычная вставка упиралась бы в первичный ключ. Комментарий
            // ниже это и обещал — «перезаписывает свою», — но вставка так не
            // умеет, и обещание держалось только до второго нажатия.
            sb_upsert('jm_consents', [
                // Один человек — одна запись на редакцию: повторное нажатие
                // не плодит строки, а перезаписывает свою.
                'id'          => $uid . ':' . substr(hash('sha256', $stamp), 0, 16),
                'user_id'     => $uid,
                'stamp'       => $stamp,
                'docs'        => $docs,
                'source'      => in_array($source, ['registration', 'reconsent'], true)
                                 ? $source : 'registration',
                'accepted_at' => now_iso(),
            ], 'id');
            $data = ['записано' => true];
            break;
        }

        // Что человек принял в последний раз — для показа в профиле и для
        // ответа на вопрос «спрашивать ли заново». Отдельные трансграничные
        // решения живут в той же защищённой таблице, но в отдельных строках
        // и сюда не попадают.
        case 'dbGetConsent': {
            $rows = sb_select('jm_consents', [
                'user_id' => 'eq.' . (string)($args[0] ?? ''),
                'source'  => 'not.like.crossborder:%',
            ], 'stamp,docs,source,accepted_at', 'accepted_at.desc');
            $data = $rows[0] ?? null;
            break;
        }

        // Отдельное доказательство согласия на трансграничную передачу.
        // Не перезаписываем им основное согласие: это самостоятельное
        // волеизъявление с собственной редакцией, временем и источником.
        case 'dbRecordCrossBorderConsent': {
            $uid = (string)($args[0] ?? '');
            $version = trim((string)($args[1] ?? ''));
            $source = (string)($args[2] ?? 'crossborder:reconsent');
            $allowed = [
                'crossborder:registration',
                'crossborder:reconsent',
                'crossborder:push',
                'crossborder:telegram',
            ];
            if ($uid === '' || $version === '') {
                $data = ['ok' => false, 'error' => 'Нужны пользователь и редакция согласия']; break;
            }
            if (!hash_equals(JT_CROSSBORDER_CONSENT_VERSION, $version)) {
                $data = ['ok' => false, 'error' => 'Редакция согласия устарела. Обновите приложение.']; break;
            }
            if (!sb_single('jm_users', ['id' => 'eq.' . $uid], 'id')) {
                $data = ['ok' => false, 'error' => 'Пользователь не найден']; break;
            }
            if (!in_array($source, $allowed, true)) $source = 'crossborder:reconsent';

            sb_upsert('jm_consents', [
                'id'          => 'cb:' . $uid . ':' . substr(hash('sha256', $version), 0, 16),
                'user_id'     => $uid,
                'stamp'       => 'crossborder:' . $version,
                'docs'        => ['crossBorderConsent' => $version],
                'source'      => $source,
                'accepted_at' => now_iso(),
            ], 'id');
            $data = ['ok' => true];
            break;
        }

        case 'dbGetCrossBorderConsent': {
            $data = jt_crossborder_status((string)($args[0] ?? ''));
            break;
        }

        case 'dbRevokeCrossBorderConsent': {
            $uid = (string)($args[0] ?? '');
            if ($uid === '') {
                $data = ['ok' => false, 'error' => 'Нужен пользователь']; break;
            }
            $version = JT_CROSSBORDER_CONSENT_VERSION;
            sb_upsert('jm_consents', [
                'id'          => 'cb:' . $uid . ':' . substr(hash('sha256', $version), 0, 16),
                'user_id'     => $uid,
                'stamp'       => 'crossborder:' . $version,
                'docs'        => ['crossBorderConsent' => $version],
                'source'      => 'crossborder:revoked',
                'accepted_at' => now_iso(),
            ], 'id');
            try { sb_update('jm_users', ['id' => 'eq.' . $uid], ['push_token' => null, 'telegram_id' => null]); } catch (Throwable $e) {}
            try { sb_delete('jm_web_push_subscriptions', ['user_id' => 'eq.' . $uid]); } catch (Throwable $e) {}
            $data = ['ok' => true];
            break;
        }

        // Осталось для дашборда: там удаляет администратор, и пароля
        // человека у него нет. Проверка прав — на входе в дашборд.
        case 'dbDeleteUser':
            $data = sb_rpc('jm_delete_account', ['uid' => (string)$args[0]]); break;

        // Проверка «этот номер уже занят» нужна форме регистрации, но ею же
        // перебирают базу номеров. Поэтому считаем и её: тридцати проверок за
        // четверть часа человеку при регистрации хватит с запасом.
        case 'dbCheckPhoneExists':
            if (jt_try_blocked('phone')) {
                jt_respond(['error' => 'Слишком много проверок. Попробуйте через 15 минут.'], 429); exit;
            }
            jt_try_note('phone');
            $data = sb_single('jm_users', ['phone' => 'eq.' . $args[0]], 'id') !== null; break;

        // Как быстро человек отвечает — для чужого профиля.
        //
        // Считаем по переписке: в каждом чате берём первое сообщение и первый
        // ответ этого человека. Отвечает он далеко не всегда — из 143 чатов
        // ответ был в 65, — и именно это директору с работником полезнее всего
        // знать заранее, до того как потратить отклик.
        //
        // Пока чатов меньше двух, ничего не показываем: одна переписка о
        // человеке не говорит ничего, а выглядит как приговор.
        // Отзывчивость сразу по всем — для карточек в ленте.
        //
        // Поштучно нельзя: на экране десяток вакансий, и запрос на каждую
        // превратил бы ленту в слайд-шоу. Данных мало (сотни чатов и
        // сообщений), так что считаем всё за два запроса и отдаём картой.
        case 'dbResponsivenessMap': {
            $chats = sb_select('jm_chats', [], 'id,worker_id,employer_id,created_at');
            $msgs = sb_select('jm_messages', [], 'chat_id,sender_id,created_at', 'created_at.asc');
            $byChat = [];
            foreach ($msgs as $m) {
                if ($m['sender_id'] === 'system' || $m['sender_id'] === 'system_safety') continue;
                $byChat[$m['chat_id']][] = $m;
            }
            // Пустой чат считаем молчанием, только когда срок ответа уже вышел:
            // те же двое суток, что и у авто-закрытия отклика.
            $staleBefore = time() - 2 * 86400;
            $acc = [];
            foreach ($chats as $c) {
                foreach ([$c['worker_id'], $c['employer_id']] as $uid) {
                    if (!$uid) continue;
                    if (!isset($acc[$uid])) $acc[$uid] = ['chats' => 0, 'answered' => 0, 'lags' => []];
                    $ms = $byChat[$c['id']] ?? [];
                    if (!$ms) {
                        if (strtotime($c['created_at']) < $staleBefore) $acc[$uid]['chats']++;
                        continue;
                    }
                    // Разговор, который человек завёл сам, о нём не говорит.
                    if ($ms[0]['sender_id'] === $uid) continue;
                    $acc[$uid]['chats']++;
                    foreach ($ms as $m) {
                        if ($m['sender_id'] === $uid) {
                            $acc[$uid]['answered']++;
                            $acc[$uid]['lags'][] = max(0, strtotime($m['created_at']) - strtotime($ms[0]['created_at']));
                            break;
                        }
                    }
                }
            }
            $out = [];
            foreach ($acc as $uid => $a) {
                if ($a['chats'] < 2) continue;
                sort($a['lags']);
                $out[$uid] = [
                    'chats' => $a['chats'],
                    'answered' => $a['answered'],
                    // Медиана по одному ответу — это просто тот единственный случай.
                    'medianSeconds' => count($a['lags']) >= 2 ? $a['lags'][intdiv(count($a['lags']), 2)] : null,
                ];
            }
            $data = $out; break;
        }

        case 'dbUserStats': {
            $uid = (string)($args[0] ?? '');
            if ($uid === '') { $data = null; break; }
            $chats = sb_select('jm_chats', ['or' => "(worker_id.eq.{$uid},employer_id.eq.{$uid})"], 'id,created_at');
            $ids = array_map(fn($c) => $c['id'], $chats);
            if (!$ids) { $data = ['enough' => false]; break; }
            // Одним запросом на все чаты разом: по запросу на чат открытие
            // профиля у человека с полутора десятками переписок ждало бы секунды.
            $all = sb_select('jm_messages',
                ['chat_id' => 'in.(' . implode(',', $ids) . ')'],
                'chat_id,sender_id,created_at', 'created_at.asc');
            $byChat = [];
            foreach ($all as $m) {
                // Системные сообщения не в счёт: их пишет не человек.
                if ($m['sender_id'] === 'system' || $m['sender_id'] === 'system_safety') continue;
                $byChat[$m['chat_id']][] = $m;
            }
            // Пустой чат — тот, где не написал никто. Считаем его молчанием,
            // но только когда разговор уже точно не состоится: срок ответа на
            // отклик двое суток, после него ждать нечего. Свежие пустые чаты
            // не в счёт — иначе директор получал бы клеймо за переписку,
            // которая началась час назад.
            //
            // Без этого метрика молчала почти у всех: у директора с 16 чатами
            // двенадцать были пустыми, и в расчёт попадал ровно один.
            $staleBefore = time() - 2 * 86400;
            $total = 0; $answered = 0; $lags = [];
            foreach ($chats as $c) {
                $ms = $byChat[$c['id']] ?? [];
                if (!$ms) {
                    if (strtotime($c['created_at']) < $staleBefore) $total++;
                    continue;
                }
                // Чат, который завёл он сам, об отзывчивости не говорит.
                if ($ms[0]['sender_id'] === $uid) continue;
                $total++;
                foreach ($ms as $m) {
                    if ($m['sender_id'] === $uid) {
                        $answered++;
                        $lags[] = max(0, strtotime($m['created_at']) - strtotime($ms[0]['created_at']));
                        break;
                    }
                }
            }
            if ($total < 2) { $data = ['enough' => false]; break; }
            sort($lags);
            // Скорость показываем только при двух ответах и больше: медиана по
            // одному — это просто тот единственный случай, а в профиле она
            // выглядит как «обычно отвечает за 12 дней».
            $median = count($lags) >= 2 ? $lags[intdiv(count($lags), 2)] : null;
            $data = [
                'enough' => true,
                'chats' => $total,
                'answered' => $answered,
                'medianSeconds' => $median,
            ];
            break;
        }

        // Старый клиентский вход по номеру возвращал всю строку, включая
        // пароль. Современный вход — только dbLogin; этот путь закрыт.
        case 'dbGetUserByPhone':
            jt_respond(['error' => 'Deprecated endpoint'], 410); exit;

        // ── Telegram Mini App ──────────────────────────────────────────────────
        // args: [initDataString] → { ok, user|null, tg: {id, first_name, ...} }
        case 'tgAuth': {
            $data = ['ok' => false, 'error' => 'Telegram больше не используется в JobToo'];
            break;
        }

        // args: [userId, initDataString] — link a Telegram account to a user
        case 'tgBindTelegram': {
            $data = false;
            break;
        }

        // args: [employerId, workerId, vacancyId, vacancyTitle]
        // Директору в Telegram: карточка кандидата + кнопки Одобрить/Отклонить
        // args: [employerId, workerId, vacancyId, vacancyTitle]
        case 'tgNotifyNewApplication':
            $data = false;
            break;

        // Ежедневные авто-касания (вызывается кроном раз в день):
        // 1) напоминания директорам о необработанных заявках (каждый день)
        // 2) «разместите смену/вакансию» директорам (раз в 3 дня)
        // 3) «посмотрите новые смены» работникам (раз в 3 дня, со сдвигом)
        case 'cronEveningDigest': {
            // Вечерний дайджест смен на завтра в группу «ПОДРАБОТКИ».
            // Спящее условие: постим только когда на завтра 3+ открытых смены от 2+ лавок.
            $tomorrowMsk = gmdate('Y-m-d', time() + 3 * 3600 + 86400);
            $rows = sb_select('jm_vacancies', ['status' => 'eq.open', 'date' => 'eq.' . $tomorrowMsk],
                'id,employer_id,title,metro_station,time_start,time_end,salary');
            $emps = [];
            foreach ($rows as $r) if (!empty($r['employer_id'])) $emps[$r['employer_id']] = true;
            $data = ['posted' => false, 'shifts' => count($rows), 'lavkas' => count($emps)];
            if (count($rows) >= 3 && count($emps) >= 2) {
                $lines = [];
                foreach (array_slice($rows, 0, 10) as $r) {
                    $sal = ((float)($r['salary'] ?? 0)) > 0
                        ? number_format((float)$r['salary'], 0, ',', ' ') . ' ₽'
                        : 'сдельные нормативы';
                    $lines[] = "• {$r['title']} · м. {$r['metro_station']} · {$r['time_start']}–{$r['time_end']} · {$sal}";
                }
                $more = count($rows) > 10 ? "\n…и ещё " . (count($rows) - 10) : '';
                $txt = "⚡ <b>Смены на завтра</b> — " . count($rows) . " в " . count($emps) . " лавках:\n\n"
                    . implode("\n", $lines) . $more
                    . "\n\nОткликнись первым — прямо в Телеграме 👇";
                tg_send_message((int)TG_GROUP_CHAT_ID, $txt, true);
                $data['posted'] = true;
            }
            break;
        }

        // Ежедневный продуктовый отчёт во внутреннюю группу, тема «Отчёты».
        // Это отдельный сценарий: пользовательские дайджесты и напоминания
        // выше и ниже не меняем и не связываем с операционной статистикой.
        case 'cronDailyReport': {
            $now = time();
            $cut24 = gmdate('Y-m-d\\TH:i:s\\Z', $now - 86400);
            $cut48 = gmdate('Y-m-d\\TH:i:s\\Z', $now - 2 * 86400);
            $metrikaToken = trim((string)($_SERVER['HTTP_X_YANDEX_METRIKA_TOKEN'] ?? ''));
            if ($metrikaToken === '') {
                throw new RuntimeException('YANDEX_METRIKA_TOKEN не передан');
            }
            $metrika = ym_daily_report($metrikaToken);

            $newWorkers = sb_count('jm_users', [
                'role' => 'eq.worker', 'created_at' => 'gte.' . $cut24,
            ]);
            $previousWorkers = sb_count('jm_users', [
                'role' => 'eq.worker',
                'and' => '(created_at.gte.' . $cut48 . ',created_at.lt.' . $cut24 . ')',
            ]);
            $shiftApplications = sb_count('jm_likes', [
                'worker_liked' => 'eq.true', 'created_at' => 'gte.' . $cut24,
            ]);
            $permApplications = sb_count('jm_perm_applications', [
                'created_at' => 'gte.' . $cut24,
            ]);
            $applications = $shiftApplications + $permApplications;

            $ownImpressions = sb_count('jm_vacancy_views', ['viewed_at' => 'gte.' . $cut24])
                + sb_count('jm_perm_vacancy_views', ['viewed_at' => 'gte.' . $cut24]);

            $guestSets = array_fill_keys([
                'vacancy_impression', 'apply_intent',
                'registration_started', 'registration_completed',
            ], []);
            foreach (sb_select_all('jm_guest_events', [
                'event_type' => 'in.(vacancy_impression,apply_intent,registration_started,registration_completed)',
                'occurred_at' => 'gte.' . $cut24,
            ], 'anon_id,event_type,vacancy_id') as $event) {
                $type = (string)($event['event_type'] ?? '');
                if (!isset($guestSets[$type])) continue;
                $key = (string)($event['anon_id'] ?? '') . '|' . (string)($event['vacancy_id'] ?? '');
                $guestSets[$type][$key] = true;
            }
            $guestImpressions = count($guestSets['vacancy_impression']);
            $guestIntents = count($guestSets['apply_intent']);
            $guestStarted = count($guestSets['registration_started']);
            $guestCompleted = count($guestSets['registration_completed']);
            $ownImpressions += $guestImpressions;
            $feedImpressionLine = feed_impression_line($ownImpressions);
            $guestFunnelLine = guest_funnel_line(
                $guestImpressions, $guestIntents, $guestStarted, $guestCompleted
            );
            $zeroApplicationLine = zero_application_diagnosis(
                $applications, $ownImpressions,
                $guestImpressions, $guestIntents, $guestCompleted
            );

            // Сколько откликов получили ответ. Отчёт до сих пор считал только
            // «сколько подали» — а это половина правды: отклик без ответа хуже
            // отказа, человек читает молчание как «сервис не работает».
            //
            // Окно ВЧЕРАШНЕЕ (см. funnel_window): у отклика должны быть сутки
            // на ответ, иначе поданный пять минут назад честно портит долю.
            //
            // Ответ по смене — это employer_liked, он boolean|null: null значит
            // «работодатель ещё не решил». По постоянной вакансии — статус
            // сдвинулся с pending.
            //
            // Оговорка, которую из данных не убрать: если работодатель лайкнул
            // первым с «Кандидатов», а работник откликнулся после, отклик
            // засчитается отвеченным сразу. Порядок сторон в строке не
            // записан, различить нельзя, и выдумывать различение хуже, чем
            // знать про перекос.
            $fw = funnel_window($now);
            $inWindow = "(created_at.gte.{$fw['from']},created_at.lt.{$fw['to']})";
            $askedDay = sb_count('jm_likes', ['worker_liked' => 'eq.true', 'and' => $inWindow])
                + sb_count('jm_perm_applications', ['and' => $inWindow]);
            $answeredDay = sb_count('jm_likes', [
                    'worker_liked' => 'eq.true', 'and' => $inWindow,
                    'employer_liked' => 'not.is.null',
                ])
                + sb_count('jm_perm_applications', ['and' => $inWindow, 'status' => 'neq.pending']);
            $replyLine = funnel_line($askedDay, $answeredDay);
            $replyAlert = funnel_alert($askedDay, $answeredDay);

            $shiftOutcomeCounts = array_fill_keys(SHIFT_OUTCOMES, 0);
            foreach (sb_select_all('jm_likes', [
                'outcome' => 'not.is.null', 'outcome_at' => 'gte.' . $cut24,
            ], 'outcome') as $row) {
                $outcome = (string)($row['outcome'] ?? '');
                if (isset($shiftOutcomeCounts[$outcome])) $shiftOutcomeCounts[$outcome]++;
            }
            $shiftOutcomeLine = shift_outcome_line($shiftOutcomeCounts);

            $shiftWindow = shift_application_window($now);
            $shiftWindowFilter = "(created_at.gte.{$shiftWindow['from']},created_at.lt.{$shiftWindow['to']})";
            $matureShiftApplications = sb_count('jm_likes', [
                'worker_liked' => 'eq.true', 'and' => $shiftWindowFilter,
            ]);
            $matureWorked = sb_count('jm_likes', [
                'worker_liked' => 'eq.true', 'and' => $shiftWindowFilter,
                'outcome' => 'eq.worked',
            ]);
            $shiftConversionLine = shift_conversion_line($matureShiftApplications, $matureWorked);

            $workedOnce = sb_count('jm_users', [
                'role' => 'eq.worker', 'score_shifts' => 'gte.1',
            ]);
            $workedTwice = sb_count('jm_users', [
                'role' => 'eq.worker', 'score_shifts' => 'gte.2',
            ]);
            $secondShiftLine = second_shift_line($workedOnce, $workedTwice);
            $newShifts = sb_count('jm_vacancies', ['created_at' => 'gte.' . $cut24]);
            $newVacancies = sb_count('jm_perm_vacancies', ['created_at' => 'gte.' . $cut24]);

            // Приглашения. Денег в программе нет, ждать решения нечему —
            // смотреть надо на то, доходят ли приведённые до смены. Три числа
            // и есть ответ: если «пришли» растёт, а «вышли» стоит, программа
            // приводит людей, которые не работают, и это хуже, чем её
            // отсутствие.
            //
            // Миграции 064 и 065 накатывает выкладка (infra/migrate.sh, до
            // замены PHP), но отчёт запускается и на базе, где их ещё нет.
            // Он от этого не падает: sb_count возвращает 0 на любой неудаче,
            // включая отсутствующую таблицу и неизвестную колонку, — он не
            // бросает исключений вовсе. То есть до миграции здесь будут
            // честные нули, а не поломка.
            $refWorked = sb_count('jm_referral_rewards', ['outcome' => 'eq.worked']);
            $refNoShow = sb_count('jm_referral_rewards', ['outcome' => 'eq.no_show']);
            $refDay = sb_count('jm_users', [
                'invited_by' => 'not.is.null', 'created_at' => 'gte.' . $cut24,
            ]);
            $referralLine = "🎁 Приглашения: пришли по коду за сутки <b>{$refDay}</b>"
                . ", всего вышли на первую смену <b>{$refWorked}</b>, не вышли <b>{$refNoShow}</b>";

            // Согласия на обработку данных. Запись согласия — не аналитика, а
            // доказательство: именно её предъявляют, когда спрашивают, на
            // каком основании мы обрабатываем данные человека. Теперь она
            // пишется в том же заходе, что создаёт человека, но если запись
            // всё же не легла, молчать об этом нельзя.
            $consentGap = 0;
            $newIds = array_column(sb_select_all('jm_users', [
                'created_at' => 'gte.' . $cut24,
            ], 'id'), 'id');
            if ($newIds) {
                $withConsent = [];
                foreach (array_chunk($newIds, 100) as $chunk) {
                    foreach (sb_select_all('jm_consents', [
                        'user_id' => sb_in_list($chunk),
                    ], 'user_id') as $c) {
                        $withConsent[(string)($c['user_id'] ?? '')] = true;
                    }
                }
                foreach ($newIds as $id) {
                    if (!isset($withConsent[(string)$id])) $consentGap++;
                }
            }
            $consentLine = '📝 Согласий: ' . (count($newIds) - $consentGap) . ' из ' . count($newIds)
                . ' зарегистрировавшихся за сутки';
            $consentAlert = $consentGap > 0
                ? "зарегистрировались без записи о согласии: {$consentGap}" : '';

            // Публикация в группу «ПОДРАБОТКИ». Итог последней записывался в
            // jm_settings и не читался НИГДЕ: в коде так и сказано — «иначе
            // выяснять причину будет нечем», — а читателя не было. Из-за этого
            // вакансия могла сутки висеть в ленте без объявления, и заметить
            // это можно было только глазами в самой группе.
            $groupLine = '';
            $groupAlert = '';
            $lastPost = sb_single('jm_settings', ['key' => 'eq.last_group_post'], 'value');
            $post = json_decode((string)($lastPost['value'] ?? ''), true);
            if (is_array($post)) {
                $when = trim((string)($post['когда'] ?? ''));
                $whenMsk = $when !== '' && strtotime($when) !== false
                    ? (new DateTimeImmutable($when))->setTimezone(new DateTimeZone('Europe/Moscow'))->format('d.m H:i')
                    : '—';
                if (!empty($post['ok'])) {
                    $groupLine = "📣 Последний пост в группу: {$whenMsk} МСК, доставлен";
                } else {
                    $why = $post['отказ'] ?? null;
                    $whyText = is_array($why)
                        ? trim((string)($why['описание'] ?? $why['description'] ?? json_encode($why, JSON_UNESCAPED_UNICODE)))
                        : trim((string)$why);
                    if ($whyText === '') $whyText = 'причина не записана';
                    $groupLine = "📣 Последний пост в группу: {$whenMsk} МСК, <b>НЕ доставлен</b> — "
                        . htmlspecialchars(mb_substr($whyText, 0, 160), ENT_QUOTES, 'UTF-8');
                    $groupAlert = 'последний пост в группу «ПОДРАБОТКИ» не доставлен';
                }
            }
            // Приглашённые, которые не выходят, — это не мелочь: поручительство
            // держится на том, что число «вышли» чего-то стоит. Перекос в
            // другую сторону значит, что кодом делятся с кем попало.
            $referralAlert = $refNoShow > $refWorked && $refNoShow >= 3
                ? "приглашённых не вышло на смену больше, чем вышло: {$refNoShow} против {$refWorked}" : '';

            $tomorrowMsk = gmdate('Y-m-d', $now + 3 * 3600 + 86400);
            $tomorrowShifts = sb_count('jm_vacancies', [
                'status' => 'eq.open', 'date' => 'eq.' . $tomorrowMsk,
            ]);

            $alerts = [];
            if ($applications === 0) $alerts[] = 'откликов за сутки — 0';
            if ($replyAlert !== '') $alerts[] = $replyAlert;
            if ($referralAlert !== '') $alerts[] = $referralAlert;
            if ($groupAlert !== '') $alerts[] = $groupAlert;
            if ($consentAlert !== '') $alerts[] = $consentAlert;
            if ($newWorkers === 0 && $previousWorkers > 0) {
                $alerts[] = 'новых работников — 0, хотя накануне были';
            }
            if ($metrika['visits'] === 0 && $metrika['previous_visits'] > 0) {
                $alerts[] = 'визитов за сутки — 0, хотя накануне были';
            }

            $lines = [];
            if ($alerts) $lines[] = '🚨 <b>Тревога:</b> ' . implode('; ', $alerts);
            $lines[] = '📊 <b>JobToo — отчёт за сутки</b>';
            $lines[] = '';
            $lines[] = "👷 Новых работников: <b>{$newWorkers}</b>";
            $lines[] = "📨 Откликов: <b>{$applications}</b> (смены {$shiftApplications}, вакансии {$permApplications})";
            $lines[] = $replyLine;
            $lines[] = $shiftOutcomeLine;
            $lines[] = $shiftConversionLine;
            $lines[] = $secondShiftLine;
            $lines[] = $feedImpressionLine;
            $lines[] = $guestFunnelLine;
            if ($zeroApplicationLine !== '') $lines[] = $zeroApplicationLine;
            $lines[] = "🏢 Свои публикации: вакансии <b>{$newVacancies}</b>, смены <b>{$newShifts}</b>";
            $lines[] = $referralLine;
            if ($groupLine !== '') $lines[] = $groupLine;
            $lines[] = $consentLine;
            $lines[] = "📅 Открытых смен на завтра: <b>{$tomorrowShifts}</b>";
            $bounceRate = number_format($metrika['bounce_rate'], 1, ',', ' ');
            $trafficSources = $metrika['sources'];
            $lines[] = '';
            $lines[] = "📈 Метрика за {$metrika['date']}: визиты <b>{$metrika['visits']}</b>, посетители <b>{$metrika['users']}</b>, отказы <b>{$bounceRate}%</b>";
            $lines[] = "🧭 Источники трафика: поиск <b>{$trafficSources['organic']}</b>, прямые <b>{$trafficSources['direct']}</b>, переходы <b>{$trafficSources['referral']}</b>, соцсети <b>{$trafficSources['social']}</b>";
            $lines[] = "🔎 Поиск за 30 дней: <b>{$metrika['search_30d']}</b> визитов от <b>{$metrika['search_30d_users']}</b> человек";
            $text = implode("\n", $lines);

            $sent = tg_send_message(
                (int)TG_WORK_GROUP_CHAT_ID, $text, false,
                '🚀 Откликнуться в JobToo', null, 29
            );
            $data = [
                'sent' => $sent, 'text' => $text,
                'stats' => [
                    'new_workers' => $newWorkers,
                    'applications' => $applications,
                    'shift_outcomes' => $shiftOutcomeCounts,
                    'shift_application_to_worked' => [
                        'applications' => $matureShiftApplications,
                        'worked' => $matureWorked,
                        'window' => $shiftWindow,
                    ],
                    'second_shift' => [
                        'worked_once' => $workedOnce,
                        'worked_twice' => $workedTwice,
                    ],
                    'feed_funnel' => [
                        'own_impressions' => $ownImpressions,
                        'guest_impressions' => $guestImpressions,
                        'guest_apply_intents' => $guestIntents,
                        'guest_registration_started' => $guestStarted,
                        'guest_registration_completed' => $guestCompleted,
                        'zero_application_diagnosis' => $zeroApplicationLine,
                    ],
                    'new_vacancies' => $newVacancies,
                    'new_shifts' => $newShifts,
                    'tomorrow_shifts' => $tomorrowShifts,
                    'metrika' => $metrika,
                ],
            ];
            if (!$sent && isset($GLOBALS['jt_last_tg_error'])) {
                $data['telegram_error'] = $GLOBALS['jt_last_tg_error'];
            }
            break;
        }

        case 'cronDailyNudges': {
            @set_time_limit(300);
            @ignore_user_abort(true);
            $result = ['pendingReminders' => 0, 'employerNudges' => 0, 'workerNudges' => 0];
            $dayIdx = (int)date('z');

            // ── 1. Необработанные заявки старше 24 часов ──
            $cut24 = gmdate('Y-m-d\TH:i:s\Z', time() - 86400);
            $pending = sb_select('jm_perm_applications', [
                'status' => 'eq.pending',
                'created_at' => 'lt.' . $cut24,
            ], 'employer_id');
            $byEmp = [];
            foreach ($pending as $p) {
                if (!empty($p['employer_id'])) $byEmp[$p['employer_id']] = ($byEmp[$p['employer_id']] ?? 0) + 1;
            }
            foreach ($byEmp as $eid => $cnt) {
                $emp = sb_single('jm_users', ['id' => 'eq.' . $eid], 'telegram_id,push_token');
                // Приходит через сутки после отклика — ровно посередине срока,
                // поэтому называем и остаток: «ещё день» точнее, чем «ответьте».
                $title = '⏳ Кандидаты ждут ответа';
                $body = "У вас {$cnt} " . ($cnt === 1 ? 'необработанная заявка' : 'необработанных заявок')
                    . ' на вакансии. Остался день: через 2 дня после отклика заявка закрывается'
                    . ' автоматически, и кандидат уходит к другим.';
                sb_insert('jm_notifications', ['user_id' => $eid, 'title' => $title, 'body' => $body]);
                if (jt_has_crossborder_consent((string)$eid) && $emp && !empty($emp['telegram_id'])) {
                    tg_send_message((int)$emp['telegram_id'], $title . "\n\n" . $body, true);
                } elseif ($emp && !empty($emp['push_token'])) {
                    expo_push([[ 'to' => $emp['push_token'], 'title' => $title, 'body' => $body,
                        'sound' => 'default', 'priority' => 'high', 'channelId' => 'matches', 'data' => ['type' => 'pending_apps'] ]]);
                }
                $result['pendingReminders']++;
            }

            // ── 0. Понедельник: сезонная сводка владельцу в Telegram ──
            if ((int)date('N') === 1) {
                $cutW = gmdate('Y-m-d\TH:i:s\Z', time() - 7 * 86400);
                $shiftMatches = count(sb_select('jm_likes', ['is_match' => 'eq.true', 'created_at' => 'gte.' . $cutW], 'id'));
                $permApproved = count(sb_select('jm_perm_applications', ['status' => 'eq.approved', 'created_at' => 'gte.' . $cutW], 'id'));
                $wtv = sb_select('jm_vacancies', ['created_at' => 'gte.' . $cutW], 'employer_id');
                $wpv = sb_select('jm_perm_vacancies', ['created_at' => 'gte.' . $cutW], 'employer_id');
                $wPubs = [];
                foreach (array_merge($wtv, $wpv) as $r) if (!empty($r['employer_id'])) $wPubs[$r['employer_id']] = true;
                $tgTotal = count(sb_select_all('jm_users', ['telegram_id' => 'not.is.null'], 'id'));
                $newWorkers = count(sb_select('jm_users', ['role' => 'eq.worker', 'created_at' => 'gte.' . $cutW], 'id'));
                $newApps = count(sb_select('jm_perm_applications', ['created_at' => 'gte.' . $cutW], 'id'));
                $matches = $shiftMatches + $permApproved;
                $sum = "📊 <b>JobToo — сводка за неделю</b>\n\n"
                    . "🤝 Мэтчей: <b>{$matches}</b> (цель 15) — смены {$shiftMatches}, вакансии {$permApproved}\n"
                    . "📦 Публиковали: <b>" . count($wPubs) . "</b> директоров (цель 15)\n"
                    . "📨 Новых откликов: {$newApps}\n"
                    . "✈️ Telegram привязан: {$tgTotal} чел (всего)\n"
                    . "🆕 Новых работников за неделю: {$newWorkers}";
                tg_send_message(1172082720, $sum, false);
                $result['weeklySummary'] = true;

                // Понедельничный пост в группу: актуальные постоянные вакансии со ссылками
                $result['weeklyPermDigest'] = post_weekly_perm_digest();
            }

            // ── 1б. Авто-отклонение заявок, висящих без ответа 2+ суток ──
            //
            // Было семь дней. По чатам видно, что столько ждать незачем: из 65
            // случаев, когда директор ответил, 49 ответов пришли в первый час,
            // 56 — за сутки и лишь 9 позже. Неделя не добавляла шансов, зато всё
            // это время человек сидел без ответа и уходил насовсем.
            $cutStale = gmdate('Y-m-d\TH:i:s\Z', time() - 2 * 86400);
            $stale = sb_select('jm_perm_applications', [
                'status' => 'eq.pending',
                'created_at' => 'lt.' . $cutStale,
            ], 'id,worker_id,vacancy_id');
            $result['autoRejected'] = 0;
            foreach ($stale as $srow) {
                sb_update('jm_perm_applications', ['id' => 'eq.' . $srow['id']], ['status' => 'rejected']);
                $vac = sb_single('jm_perm_vacancies', ['id' => 'eq.' . $srow['vacancy_id']], 'title');
                $vt = $vac ? $vac['title'] : 'вакансию';
                $wTitle = 'Отклик закрыт без ответа';
                $wBody = "Директор не ответил на ваш отклик на «{$vt}» за 2 дня. "
                    . 'Не ждите — посмотрите другие вакансии и смены рядом, отклик в два тапа.';
                sb_insert('jm_notifications', ['user_id' => $srow['worker_id'], 'title' => $wTitle, 'body' => $wBody]);
                $wu = sb_single('jm_users', ['id' => 'eq.' . $srow['worker_id']], 'telegram_id,push_token');
                if ($wu && jt_has_crossborder_consent((string)$srow['worker_id']) && !empty($wu['telegram_id'])) {
                    tg_send_message((int)$wu['telegram_id'], $wTitle . "\n\n" . $wBody, true);
                } elseif ($wu && !empty($wu['push_token'])) {
                    expo_push([[ 'to' => $wu['push_token'], 'title' => $wTitle, 'body' => $wBody,
                        'sound' => 'default', 'priority' => 'default', 'channelId' => 'matches', 'data' => ['type' => 'app_auto_rejected'] ]]);
                }
                $result['autoRejected']++;
            }

            // ── 1в. То же для откликов на смены: 2+ суток без решения директора ──
            $staleLikes = sb_select('jm_likes', [
                'worker_liked' => 'eq.true',
                'is_match' => 'eq.false',
                'employer_liked' => 'is.null',
                'created_at' => 'lt.' . $cutStale,
            ], 'id,worker_id,vacancy_id');
            $result['autoRejectedShifts'] = 0;
            foreach ($staleLikes as $lrow) {
                sb_update('jm_likes', ['id' => 'eq.' . $lrow['id']], ['employer_liked' => false]);
                $svac = sb_single('jm_vacancies', ['id' => 'eq.' . $lrow['vacancy_id']], 'title');
                $st = $svac ? $svac['title'] : 'смену';
                $wTitle = 'Отклик закрыт без ответа';
                $wBody = "Директор не ответил на ваш отклик на смену «{$st}» за 2 дня. "
                    . 'Посмотрите свежие смены рядом — отклик в два тапа.';
                sb_insert('jm_notifications', ['user_id' => $lrow['worker_id'], 'title' => $wTitle, 'body' => $wBody]);
                $result['autoRejectedShifts']++;
            }

            // ── 2. Директорам: пора размещать (раз в 3 дня) ──
            if ($dayIdx % 3 === 0) {
                $cut3d = gmdate('Y-m-d\TH:i:s\Z', time() - 3 * 86400);
                $employers = sb_select('jm_users', ['role' => 'eq.employer'], 'id,telegram_id,push_token');
                $recentTv = sb_select('jm_vacancies', ['created_at' => 'gte.' . $cut3d], 'employer_id');
                $recentPv = sb_select('jm_perm_vacancies', ['created_at' => 'gte.' . $cut3d], 'employer_id');
                $recentPosters = [];
                foreach (array_merge($recentTv, $recentPv) as $r) $recentPosters[$r['employer_id']] = true;
                $workersCnt = count(sb_select('jm_users', ['role' => 'eq.worker'], 'id'));

                $title = '👷 Работники ждут смен';
                $body = "В JobToo {$workersCnt}+ работников готовы выйти. Разместите смену или вакансию — отклики придут в тот же день.";
                foreach ($employers as $e) {
                    if (isset($recentPosters[$e['id']])) continue; // недавно публиковал — не трогаем
                    sb_insert('jm_notifications', ['user_id' => $e['id'], 'title' => $title, 'body' => $body]);
                    if (jt_has_crossborder_consent((string)$e['id']) && !empty($e['telegram_id'])) {
                        tg_send_message((int)$e['telegram_id'], $title . "\n\n" . $body, true);
                    } elseif (!empty($e['push_token'])) {
                        expo_push([[ 'to' => $e['push_token'], 'title' => $title, 'body' => $body,
                            'sound' => 'default', 'priority' => 'default', 'channelId' => 'default', 'data' => ['type' => 'post_nudge'] ]]);
                    }
                    $result['employerNudges']++;
                }
            }

            // ── 3. Работникам: смены рядом (раз в 2 дня и только тем, у кого рядом есть) ──
            //
            // Раньше здесь раз в три дня уходило всем «появились новые варианты
            // рядом с вашим метро» — без цифр и без проверки, есть ли там
            // что-то рядом. За этим последовало 27% блокировок бота среди тех,
            // кто телеграм подключал сам. Теперь адресно, см. shift_nudge_run().
            $nudge = shift_nudge_run();
            $result['workerNudges'] = $nudge['sent'];
            $result['workerSilent'] = $nudge['silent'];

            $data = $result;
            break;
        }

        // Отдельный вызов той же рассылки — чтобы прогнать вручную, не дожидаясь крона.
        // Догоняющее объявление: вакансии, о которых не объявили, потому что
        // запрос с телефона публикующего не дошёл. Подробности — в
        // jt_announce_missed.
        case 'cronAnnounceMissed': {
            $hours = max(1, min(48, (int)($args[0] ?? 6)));
            $limit = max(1, min(20, (int)($args[1] ?? 5)));
            $data = jt_announce_missed($hours, $limit);
            break;
        }

        case 'cronShiftNudge':
            @set_time_limit(300);
            $data = shift_nudge_run(); break;

        // args: [title, body, roleFilter 'all'|'worker'|'employer']
        // Рассылка по всем с привязанным Telegram (кнопка приложения в каждом сообщении)
        case 'adminRetireTelegram': {
            @set_time_limit(300);
            @ignore_user_abort(true);

            $title = 'Telegram-уведомления отключаются';
            $message = 'Из-за технических ограничений мы отключаем уведомления JobToo в Telegram. '
                . 'Все важные уведомления останутся доступны в приложении — в разделе с колокольчиком. '
                . 'Спасибо, что вы с нами.';

            $rows = sb_select_all('jm_users', ['telegram_id' => 'not.is.null'], 'id,telegram_id');
            $sent = 0;
            $failed = 0;
            $bell = 0;
            $unlinked = 0;

            foreach ($rows as $row) {
                $uid = (string)($row['id'] ?? '');
                $chatId = (int)($row['telegram_id'] ?? 0);
                if ($uid === '' || $chatId <= 0) continue;

                // Сначала последнее сообщение в Telegram, как договорились.
                if (tg_send_retirement_message($chatId, $message)) $sent++;
                else $failed++;

                // Затем дублируем объяснение в российский колокольчик.
                try {
                    sb_insert('jm_notifications', [
                        'user_id' => $uid,
                        'title' => $title,
                        'body' => $message,
                        'type' => 'telegram_retired',
                    ]);
                    $bell++;
                } catch (Throwable $e) {
                    try {
                        sb_insert('jm_notifications', [
                            'user_id' => $uid,
                            'title' => $title,
                            'body' => $message,
                        ]);
                        $bell++;
                    } catch (Throwable $e2) {}
                }

                // И только после попытки отправки отвязываем канал.
                try {
                    sb_update('jm_users', ['id' => 'eq.' . $uid], ['telegram_id' => null]);
                    $unlinked++;
                } catch (Throwable $e) {}
            }

            tg_pending_write([]);

            // Цель Telegram-интеграции прекращена: старый бот-инбокс больше
            // не нужен для работы JobToo и содержит Telegram ID/name/username/
            // текст. Удаляем его, а не держим персональные данные «на всякий
            // случай» после закрытия канала.
            $botRows = [];
            try { $botRows = sb_select_all('jm_bot_messages', [], 'id'); } catch (Throwable $e) {}
            $botDeleted = count($botRows);
            if ($botDeleted > 0) {
                try { sb_delete('jm_bot_messages', ['id' => 'not.is.null']); } catch (Throwable $e) {}
            }

            $data = [
                'retired' => true,
                'targets' => count($rows),
                'telegram_sent' => $sent,
                'telegram_failed' => $failed,
                'bell_written' => $bell,
                'unlinked' => $unlinked,
                'bot_messages_deleted' => $botDeleted,
            ];
            break;
        }

        case 'tgBroadcast': {
            $data = ['sent' => 0, 'total' => 0, 'disabled' => true];
            break;
        }

        // args: [[userId, …], template] — личное сообщение боту каждому из списка.
        //
        // Не рассылка: спрашиваем у конкретных людей о конкретном, и текст
        // обращается по имени — {name} подставляется. Кнопки «Открыть JobToo»
        // тут нет намеренно: мы задаём вопрос, а не зовём в приложение, и
        // кнопка превратила бы вопрос в рекламу.
        case 'tgSendToUsers': {
            $data = ['sent' => 0, 'skipped' => is_array($args[0] ?? null) ? $args[0] : [], 'disabled' => true];
            break;
        }

        // Опрос спящих соискателей «почему не пользуетесь» — в один тап.
        // Шлём только тем, у кого есть телеграм и кто спит: last_seen пусто
        // или старше 30 дней. Кнопки-ответы уходят в jm_survey_responses через
        // обработчик бота (php-proxy/tg.php).
        case 'surveyDormantSend': {
            @set_time_limit(300);
            @ignore_user_abort(true);
            $surveyKey = 'dormant_worker_v1';
            $batch = 20;                 // за один тап — не больше, чтобы уложиться в таймаут роута
            $cutoff = time() - 14 * 86400;   // спящий = не заходил 14+ дней (или ни разу)
            // Кому уже слали — тем не шлём повторно (идемпотентность по логу).
            $sentRows = sb_select('jm_survey_sends', ['survey_key' => 'eq.' . $surveyKey], 'user_id');
            $already = [];
            foreach ($sentRows as $s) { $already[(string)$s['user_id']] = true; }

            $rows = sb_select('jm_users',
                ['role' => 'eq.worker', 'telegram_id' => 'not.is.null'],
                'id,telegram_id,last_seen_at');
            $text = "Привет! Вы заводили <b>JobToo</b>, но давно не заходили 👀\n\n"
                  . "Помогите одним касанием — <b>почему пока не пользуетесь?</b>";
            $kb = [
                [['text' => 'Не нашёл смен рядом',        'callback_data' => 'survey_' . $surveyKey . '_no_shifts']],
                [['text' => 'Не было времени / забыл',     'callback_data' => 'survey_' . $surveyKey . '_no_time']],
                [['text' => 'Непонятно, как пользоваться', 'callback_data' => 'survey_' . $surveyKey . '_confusing']],
                [['text' => 'Уже нашёл работу',            'callback_data' => 'survey_' . $surveyKey . '_found_job']],
                [['text' => 'Другое',                      'callback_data' => 'survey_' . $surveyKey . '_other']],
            ];
            $sent = 0; $eligible = 0; $remaining = 0;
            foreach ($rows as $r) {
                $ls = $r['last_seen_at'] ?? null;
                $dormant = ($ls === null) || (strtotime((string)$ls) < $cutoff);
                if (!$dormant) continue;
                $eligible++;
                if (isset($already[(string)$r['id']])) continue;   // уже получил
                if ($sent >= $batch) { $remaining++; continue; }   // на следующий тап
                if (tg_send_message((int)$r['telegram_id'], $text, false, '', $kb)) {
                    $sent++;
                    sb('POST', 'jm_survey_sends', ['on_conflict' => 'survey_key,user_id'],
                        ['survey_key' => $surveyKey, 'user_id' => $r['id'], 'sent_at' => now_iso()],
                        ['Prefer: resolution=ignore-duplicates,return=minimal']);
                }
            }
            $sentTotal = count($already) + $sent;
            $data = ['sent' => $sent, 'sent_total' => $sentTotal, 'remaining' => $remaining,
                     'eligible' => $eligible, 'survey_key' => $surveyKey];
            break;
        }

        // Итоги опроса: охват (кому ушло) и ответы. args: [survey_key?]
        case 'surveyResults': {
            $key = (string)($args[0] ?? 'dormant_worker_v1');
            $rows = sb_select('jm_survey_responses', ['survey_key' => 'eq.' . $key], 'answer');
            $tally = [];
            foreach ($rows as $r) {
                $a = (string)($r['answer'] ?? '');
                if ($a === '') continue;
                $tally[$a] = ($tally[$a] ?? 0) + 1;
            }
            $sentTotal = count(sb_select('jm_survey_sends', ['survey_key' => 'eq.' . $key], 'user_id'));
            $data = ['survey_key' => $key, 'total' => count($rows), 'tally' => $tally,
                     'sent_total' => $sentTotal];
            break;
        }

        // Пересчитать рейтинги всем работникам разом. Нужно ровно дважды:
        // сразу после выкладки, чтобы уже накопленные смены и оценки
        // превратились в числа, и если формулу поменяют.
        case 'scoreRecalcAll': {
            $n = 0;
            foreach (sb_select_all('jm_users', ['role' => 'eq.worker'], 'id') as $w) {
                jt_recalc_score((string)$w['id']); $n++;
            }
            foreach (sb_select_all('jm_users', ['role' => 'eq.employer'], 'id') as $e) {
                jt_recalc_employer_score((string)$e['id']); $n++;
            }
            $data = ['пересчитано' => $n]; break;
        }

        // ── К счёту: сколько подборов состоялось у кого ────────────────────
        //
        // Первая опора монетизации из презентации — комиссия за успешный
        // подбор. Тарифа ещё нет, эквайринга тоже, но событие, за которое
        // берут деньги, происходит уже сейчас: работник вышел и отработал.
        // Считаем его с этого дня, а не с того, когда договорятся о цене:
        // выставить счёт за прошлый месяц можно только по тому, что за
        // прошлый месяц записано.
        //
        // Отдельно показываем невыходы и отмены — за них платить не за что,
        // и первый же разговор с работодателем начнётся именно с них.
        case 'billingReport': {
            $с = (string)($args[0] ?? '');   // YYYY-MM-DD, включительно
            $по = (string)($args[1] ?? '');  // YYYY-MM-DD, включительно
            $f = ['outcome' => 'not.is.null'];
            if ($с !== '')  $f['outcome_at'] = 'gte.' . $с . 'T00:00:00Z';
            // Второй фильтр по той же колонке в массив не влезает — верхнюю
            // границу отсекаем уже здесь, в разборе.
            $rows = sb_select_all('jm_likes', $f, 'employer_id,worker_id,outcome,outcome_at');

            $поКомпаниям = [];
            foreach ($rows as $r) {
                if ($по !== '' && substr((string)$r['outcome_at'], 0, 10) > $по) continue;
                $e = (string)$r['employer_id'];
                if ($e === '') continue;
                if (!isset($поКомпаниям[$e])) {
                    $поКомпаниям[$e] = [
                        'employer_id' => $e, 'выходов' => 0, 'невыходов' => 0,
                        'отменил' => 0, 'отказов' => 0, '_люди' => [],
                    ];
                }
                switch ($r['outcome']) {
                    case 'worked':
                        $поКомпаниям[$e]['выходов']++;
                        $поКомпаниям[$e]['_люди'][(string)$r['worker_id']] = true;
                        break;
                    case 'no_show':            $поКомпаниям[$e]['невыходов']++; break;
                    case 'employer_cancelled': $поКомпаниям[$e]['отменил']++;   break;
                    case 'worker_cancelled':   $поКомпаниям[$e]['отказов']++;   break;
                }
            }

            // Имя компании — здесь же: иначе панели пришлось бы тянуть всех
            // пользователей ради одной колонки.
            $имена = [];
            foreach (sb_select_all('jm_users', ['role' => 'eq.employer'],
                     'id,company,first_name,last_name') as $u) {
                $имена[(string)$u['id']] = trim((string)($u['company'] ?? ''))
                    ?: trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? ''));
            }

            $out = [];
            foreach ($поКомпаниям as $e => $v) {
                $v['компания'] = $имена[$e] ?? $e;
                $v['человек'] = count($v['_люди']);
                unset($v['_люди']);
                $out[] = $v;
            }
            usort($out, fn($a, $b) => $b['выходов'] <=> $a['выходов']);
            $data = ['с' => $с, 'по' => $по, 'компании' => $out]; break;
        }

        // ── Микро-тесты по профессиям ──────────────────────────────────────
        //
        // Сами вопросы живут в приложении (constants/skillTests.ts) — их
        // некому редактировать, редактора в панели нет. Сюда приходит только
        // результат. Значит, проверять его сервер не может, и единственное,
        // что он делает всерьёз, — считает попытки: без ограничения тест
        // перебирается наугад, и подтверждение перестаёт что-либо значить.
        case 'dbGetSkillResults':
            $data = sb_select('jm_skill_results', ['user_id' => 'eq.' . $args[0]]); break;

        // args: [userId, workType, correct, total, passed]
        case 'dbSubmitSkillTest': {
            [$uid, $wt, $correct, $total, $passed] = [
                (string)$args[0], (string)$args[1],
                (int)$args[2], (int)$args[3], (bool)$args[4],
            ];
            $известные = ['stocker', 'cook', 'shift_supervisor', 'picker'];
            if (!in_array($wt, $известные, true)) throw new Exception('неизвестная профессия');

            $было = sb_single('jm_skill_results',
                ['user_id' => 'eq.' . $uid, 'work_type' => 'eq.' . $wt]);
            $сегодня = gmdate('Y-m-d');
            $попыток = ($было && ($было['attempts_day'] ?? null) === $сегодня)
                ? (int)$было['attempts_today'] : 0;

            if ($попыток >= 3) {
                $data = ['error_попытки' => true, 'осталось' => 0];
                break;
            }

            $row = [
                'user_id'         => $uid,
                'work_type'       => $wt,
                'correct'         => $correct,
                'total'           => $total,
                // Подтверждение, однажды полученное, неудачной пересдачей не
                // отнимается: человек пробовал улучшить результат, а не
                // разучился за неделю.
                'passed'          => $passed || !empty($было['passed']),
                'passed_at'       => $passed
                    ? ($было['passed_at'] ?? now_iso())
                    : ($было['passed_at'] ?? null),
                'attempts_today'  => $попыток + 1,
                'attempts_day'    => $сегодня,
                'last_attempt_at' => now_iso(),
            ];
            sb_upsert('jm_skill_results', $row, 'user_id,work_type');

            // Короткий список подтверждённого переписываем в строку
            // пользователя: подбор кандидатов должен отвечать «у кого из
            // этих сорока подтверждён склад» без сорока запросов.
            $все = sb_select('jm_skill_results',
                ['user_id' => 'eq.' . $uid, 'passed' => 'is.true'], 'work_type');
            $навыки = array_values(array_unique(array_column($все, 'work_type')));
            sort($навыки);
            sb_update('jm_users', ['id' => 'eq.' . $uid], ['confirmed_skills' => $навыки]);

            $data = ['passed' => $row['passed'], 'осталось' => max(0, 3 - ($попыток + 1))];
            break;
        }

        // ── Ключи внешнего API ─────────────────────────────────────────────
        //
        // Управление отсюда, а не правкой таблицы руками: ключ, выданный в
        // обход учёта, живёт вечно и без имени — а потом ищи, чей он.
        case 'apiKeysList': {
            $rows = sb_select('jm_api_keys', ['order' => 'created_at.desc'],
                'id,name,scopes,created_at,revoked_at,last_used_at,hits,rate_limit');
            $data = $rows; break;
        }

        // Ключ показывается ровно один раз — здесь, в ответе. В базе только
        // отпечаток, так что «покажи ещё раз» невозможно даже для нас. Это
        // неудобно один раз при выдаче и спасает при утечке базы.
        case 'apiKeyCreate': {
            $name = trim((string)($args[0] ?? ''));
            if ($name === '') { $data = ['error' => 'нужно имя']; break; }
            $scopes = is_array($args[1] ?? null) && $args[1] ? $args[1] : ['vacancies:read'];
            $limit = (int)($args[2] ?? 1000);

            $secret = 'jt_' . bin2hex(random_bytes(24));
            sb_insert('jm_api_keys', [
                'id' => uid(),
                'name' => $name,
                'key_hash' => hash('sha256', $secret),
                'scopes' => $scopes,
                'rate_limit' => $limit,
                'created_at' => now_iso(),
            ]);
            $data = ['key' => $secret, 'name' => $name, 'scopes' => $scopes];
            break;
        }

        // Отзыв отметкой, а не удалением: строка нужна, чтобы через полгода
        // можно было ответить, кто и когда выгружал наши вакансии.
        case 'apiKeyRevoke': {
            $id = (string)($args[0] ?? '');
            if ($id === '') { $data = ['error' => 'нужен id']; break; }
            sb_update('jm_api_keys', ['id' => 'eq.' . $id], ['revoked_at' => now_iso()]);
            $data = ['ok' => true]; break;
        }

        // Кому бот пересылает то, что люди пишут ему в личку.
        case 'botAdminGet':
            $data = sb_single('jm_settings', ['key' => 'eq.admin_chat_id'], 'value'); break;

        case 'botAdminSet': {
            $v = trim((string)($args[0] ?? ''));
            if ($v === '') { sb_delete('jm_settings', ['key' => 'eq.admin_chat_id']); $data = null; break; }
            sb_upsert('jm_settings', ['key' => 'admin_chat_id', 'value' => $v, 'updated_at' => now_iso()], 'key');
            $data = $v; break;
        }

        // ── Поддержка ──────────────────────────────────────────────────────
        //
        // Тред один на человека: заводить тикеты с номерами значит заставлять
        // объяснять всё заново каждый раз.
        //
        // Часы работы честные. Обещать круглосуточный ответ и молчать до утра
        // хуже, чем сразу сказать, когда ответят: человек не сидит и не ждёт.

        case 'supportHistory':
            $data = sb_select('jm_support_messages', ['user_id' => 'eq.' . (string)($args[0] ?? ''), 'order' => 'created_at.asc'],
                'id,direction,sender,text,created_at'); break;

        case 'supportState': {
            $uid = (string)($args[0] ?? '');
            $state = support_thread_state($uid);
            $data = [
                'operator_requested_at' => $state['operator_requested_at'] ?? null,
                'closed_at' => $state['closed_at'] ?? null,
            ];
            break;
        }

        // FAQ/быстрые подсказки берём из той же базы, что и автоматический
        // помощник. Клиент не хранит второй расходящийся список ответов.
        case 'supportKnowledge':
            $data = support_knowledge_for_role((string)($acct['role'] ?? 'worker'));
            break;

        // Вопрос помощнику. Если оператор уже вызван и обращение не закрыто,
        // новое сообщение просто попадает ему в очередь — бот не перебивает.
        case 'supportAssistantAsk': {
            $uid = (string)($args[0] ?? '');
            $text = trim((string)($args[1] ?? ''));
            if ($uid === '' || $text === '') { $data = ['ok' => false, 'matched' => false]; break; }
            if ((function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text)) > 1500) {
                $text = function_exists('mb_substr') ? mb_substr($text, 0, 1500, 'UTF-8') : substr($text, 0, 1500);
            }

            sb_insert('jm_support_messages', [
                'id' => uid(), 'user_id' => $uid, 'direction' => 'in', 'sender' => 'user',
                'text' => $text, 'created_at' => now_iso(),
            ]);

            $state = support_thread_state($uid);
            $waitingOperator = !empty($state['operator_requested_at']) && empty($state['closed_at']);
            if ($waitingOperator) {
                try {
                    sb_update('jm_support_threads', ['user_id' => 'eq.' . $uid], ['updated_at' => now_iso()]);
                } catch (Throwable $e) {}
                $data = ['ok' => true, 'matched' => false, 'escalated' => true];
                break;
            }

            $article = support_best_article($text, (string)($acct['role'] ?? 'worker'));
            $matched = is_array($article);
            $answer = $matched
                ? (string)($article['answer'] ?? '')
                : 'Я не нашёл точного ответа в базе JobToo и не хочу придумывать. '
                    . 'Можно уточнить вопрос другими словами или нажать «Позвать оператора» — '
                    . 'тогда этот диалог появится у поддержки.';

            sb_insert('jm_support_messages', [
                'id' => uid(), 'user_id' => $uid, 'direction' => 'out', 'sender' => 'assistant',
                'text' => $answer, 'created_at' => now_iso(),
            ]);
            $data = ['ok' => true, 'matched' => $matched, 'article_id' => $article['id'] ?? null];
            break;
        }

        // Только это действие поднимает разговор в операторскую очередь.
        case 'supportEscalate': {
            $uid = (string)($args[0] ?? '');
            $reason = trim((string)($args[1] ?? ''));
            if ($uid === '') { $data = ['ok' => false]; break; }

            if ($reason === '') {
                $last = sb_select('jm_support_messages', [
                    'user_id' => 'eq.' . $uid, 'direction' => 'eq.in',
                    'order' => 'created_at.desc', 'limit' => '1',
                ], 'text');
                $reason = trim((string)($last[0]['text'] ?? ''));
            }

            $already = support_thread_state($uid);
            $wasWaiting = !empty($already['operator_requested_at']) && empty($already['closed_at']);
            $okRequest = support_request_operator($uid, $reason);

            if (!$wasWaiting) {
                sb_insert('jm_support_messages', [
                    'id' => uid(), 'user_id' => $uid, 'direction' => 'out', 'sender' => 'system',
                    'text' => 'Оператора позвал. Диалог уже появился у поддержки — ответ придёт сюда.',
                    'created_at' => now_iso(),
                ]);
            }

            $data = ['ok' => $okRequest];
            break;
        }

        // Закрыть обращение: сообщение оператора + служебная отметка.
        case 'supportClose': {
            $uid = (string)($args[0] ?? '');
            $text = trim((string)($args[1] ?? ''));
            if ($uid === '') { $data = ['ok' => false, 'reason' => 'no_user']; break; }
            if ($text !== '') {
                sb_insert('jm_support_messages', [
                    'id' => uid(), 'user_id' => $uid, 'direction' => 'out', 'sender' => 'operator',
                    'text' => $text, 'created_at' => now_iso(),
                ]);
                notify_user($uid, '🆘 Ответ поддержки', $text, 'support');
            }
            $marked = support_thread_set($uid, now_iso());
            $data = ['ok' => true, 'marked' => $marked]; break;
        }

        case 'supportReopen': {
            $uid = (string)($args[0] ?? '');
            if ($uid === '') { $data = ['ok' => false]; break; }
            $marked = support_thread_set($uid, null);
            $data = ['ok' => true, 'marked' => $marked]; break;
        }

        // Совместимость со старыми приложениями: их «написать нам» сразу
        // вызывает оператора. Новая сборка использует assistantAsk + escalate.
        case 'supportSend': {
            $uid = (string)($args[0] ?? '');
            $text = trim((string)($args[1] ?? ''));
            if ($uid === '' || $text === '') { $data = ['ok' => false]; break; }

            sb_insert('jm_support_messages', [
                'id' => uid(), 'user_id' => $uid, 'direction' => 'in', 'sender' => 'user',
                'text' => $text, 'created_at' => now_iso(),
            ]);
            support_request_operator($uid, $text);

            $hour = (int)gmdate('G', time() + 3 * 3600);
            if ($hour < SUPPORT_FROM_HOUR || $hour >= SUPPORT_TO_HOUR) {
                sb_insert('jm_support_messages', [
                    'id' => uid(), 'user_id' => $uid, 'direction' => 'out', 'sender' => 'system',
                    'text' => 'Сообщение получил. Оператор отвечает с '
                        . SUPPORT_FROM_HOUR . ':00 до ' . SUPPORT_TO_HOUR . ':00 по Москве.',
                    'created_at' => now_iso(),
                ]);
            }
            $data = ['ok' => true]; break;
        }

        // Ответить от имени поддержки может только adminFns + X-Admin-Token.
        case 'supportReply': {
            $uid = (string)($args[0] ?? '');
            $text = trim((string)($args[1] ?? ''));
            if ($uid === '' || $text === '') { $data = ['ok' => false]; break; }
            sb_insert('jm_support_messages', [
                'id' => uid(), 'user_id' => $uid, 'direction' => 'out', 'sender' => 'operator',
                'text' => $text, 'created_at' => now_iso(),
            ]);
            notify_user($uid, '🆘 Ответ поддержки', $text, 'support');
            $data = ['ok' => true]; break;
        }

        case 'supportThreads':
            $data = sb_select('jm_support_messages', ['order' => 'created_at.desc'],
                'id,user_id,direction,sender,text,created_at'); break;

        // Ответить человеку из дашборда — от имени бота.
        //
        // Отвечать реплаем в телеграме удобно, пока разговоров пять. Когда их
        // становится двадцать, нужен список, где видно, кто ждёт, — и отвечать
        // логично там же, а не перепрыгивая в другое приложение и обратно.
        // Ответ ложится в тот же журнал: иначе через день не вспомнить, что
        // уже сказано, и человек получит то же самое дважды.
        case 'botReply': {
            $tg = (int)($args[0] ?? 0);
            $text = trim((string)($args[1] ?? ''));
            if ($tg <= 0 || $text === '') { $data = ['ok' => false, 'reason' => 'empty']; break; }

            $ok = tg_send_message($tg, $text);
            if ($ok) {
                try {
                    sb_insert('jm_bot_messages', [
                        'id' => uid(), 'telegram_id' => $tg, 'direction' => 'out',
                        'name' => 'Никита', 'topic' => 'admin',
                        'text' => $text, 'created_at' => now_iso(),
                    ]);
                } catch (Throwable $e) {}
                sb_update('jm_bot_messages',
                    ['telegram_id' => 'eq.' . $tg, 'answered' => 'is.false'], ['answered' => true]);
            }
            $data = ['ok' => $ok, 'reason' => $ok ? '' : 'telegram_failed'];
            break;
        }

        // Ящик входящих боту — для дашборда.
        case 'botInbox':
            $data = sb_select('jm_bot_messages', ['limit' => (string)((int)($args[0] ?? 100))],
                '*', 'created_at.desc'); break;

        // args: [userId] — отвязать Telegram от аккаунта
        case 'tgUnbindTelegram': {
            sb_update('jm_users', ['id' => 'eq.' . $args[0]], ['telegram_id' => null]);
            $data = true;
            break;
        }

        // args: [userId, text] — message the user's linked Telegram account
        case 'tgNotifyUser': {
            $data = false;
            break;
        }

        // ── Vacancies ──────────────────────────────────────────────────────────
        case 'dbGetVacancies':
            $data = sb_select('jm_vacancies', [], '*', 'created_at.desc'); break;

        case 'dbUpsertVacancy':
            vacancy_dates_guard([$args[0]]);
            vacancy_content_guard($args[0]);
            save_then_geocode('jm_vacancies', $args[0]);
            sm_cache_invalidate(); break;

        case 'dbUpsertVacancyBatch': {
            // $args[0] — массив строк вакансий, пишется одним запросом.
            // Один адрес на всю пачку смен, поэтому геокодируем его однажды.
            $rows = $args[0];
            vacancy_dates_guard($rows);
            $cache = [];
            foreach ($rows as $k => $r) {
                vacancy_content_guard($r);
                $a = trim((string)($r['address'] ?? ''));
                if ($a === '' || (isset($r['lat']) && $r['lat'] !== null)) continue;
                if (!array_key_exists($a, $cache)) $cache[$a] = fill_coords($r);
                $rows[$k]['lat'] = $cache[$a]['lat'] ?? null;
                $rows[$k]['lng'] = $cache[$a]['lng'] ?? null;
            }
            sb_upsert('jm_vacancies', $rows, 'id');
            sm_cache_invalidate(); break;
        }

        case 'dbUpdateVacancy':
            // Если правят адрес, координаты пересчитываем: иначе метка
            // осталась бы висеть на старом месте.
            vacancy_dates_guard([$args[1]]);
            vacancy_content_guard($args[1]);
            sb_update('jm_vacancies', ['id' => 'eq.' . $args[0]], fill_coords($args[1]));
            sm_cache_invalidate(); break;

        // ── Likes ──────────────────────────────────────────────────────────────
        // Своё и только своё. Прежде отдавалась ВСЯ таблица откликов сервиса:
        // кто куда откликался, кому отказали, чем кончилась смена — любому
        // вошедшему, одним запросом. Приложение и само звало это на каждом
        // обновлении списка, так что заодно перестали гонять чужое.
        case 'dbGetLikes': {
            $me = (string)($authUid ?? '');
            $data = $me === '' ? [] : sb_select('jm_likes',
                ['or' => "(worker_id.eq.{$me},employer_id.eq.{$me})"]); break;
        }

        case 'dbGetLikesForUser': {
            $field = $args[1] === 'worker' ? 'worker_id' : 'employer_id';
            $data = sb_select('jm_likes', [$field => 'eq.' . $args[0]]); break;
        }

        case 'dbGetLikesByVacancy':
            $data = sb_select('jm_likes', ['vacancy_id' => 'eq.' . $args[0]]); break;

        // Счётчики по СВОИМ вакансиям. Карту читает экран «мои вакансии» и
        // больше никто, а выбиралась она по всем двум таблицам целиком — то
        // есть каждый вошедший получал отклики и просмотры всего рынка и
        // заставлял базу читать эти таблицы от начала до конца.
        case 'dbGetVacancyStatsMap': {
            $mine = jt_own_vacancy_ids('jm_vacancies', $authUid);
            if (!$mine) { $data = new stdClass(); break; }
            $rows = jt_rows_for_vacancies('jm_likes', $mine,
                'vacancy_id,worker_liked,employer_liked,worker_skipped,is_match');
            $viewRows = jt_rows_for_vacancies('jm_vacancy_views', $mine, 'vacancy_id');
            $map = [];
            foreach ($rows as $r) {
                $vid = $r['vacancy_id'];
                if (!$vid) continue;
                if (!isset($map[$vid])) $map[$vid] = ['applicants' => 0, 'rejected' => 0, 'views' => 0];
                if ($r['worker_liked'] === true && $r['is_match'] === false && $r['employer_liked'] !== false) {
                    $map[$vid]['applicants']++;
                }
                if ($r['employer_liked'] === false || ($r['worker_liked'] === false && $r['worker_skipped'] === true)) {
                    $map[$vid]['rejected']++;
                }
            }
            foreach ($viewRows as $v) {
                $vid = $v['vacancy_id'];
                if (!$vid) continue;
                if (!isset($map[$vid])) $map[$vid] = ['applicants' => 0, 'rejected' => 0, 'views' => 0];
                $map[$vid]['views']++;
            }
            $data = $map;
            break;
        }

        case 'dbGetVacancyViewers': {
            $rows = sb_select('jm_vacancy_views', ['vacancy_id' => 'eq.' . $args[0]], 'worker_id,viewed_at', 'viewed_at.desc');
            $data = array_values(array_unique(array_column($rows, 'worker_id')));
            break;
        }

        case 'dbRecordVacancyView': {
            [$vid, $wid] = [$args[0], $args[1]];
            sb('POST', 'jm_vacancy_views', ['on_conflict' => 'vacancy_id,worker_id'],
                ['vacancy_id' => $vid, 'worker_id' => $wid, 'viewed_at' => now_iso()],
                ['Prefer: resolution=merge-duplicates,return=minimal']);
            break;
        }

        case 'dbLogOpen': {
            // Событие «открыл приложение». anon_id и platform — технические
            // поля клиента. Личность и роль берём только из подписанной сессии:
            // публичный вызов без неё остаётся честно анонимным.
            $anon = isset($args[0]) ? (string)$args[0] : '';
            if ($anon === '') { $data = false; break; }
            $eventUserId = $authUid !== null ? (string)$authUid : null;
            $eventRole = $authUid !== null ? (string)($acct['role'] ?? '') : null;
            sb('POST', 'jm_app_opens', [], [
                'anon_id'   => $anon,
                'user_id'   => $eventUserId,
                'role'      => $eventRole !== '' ? $eventRole : null,
                'platform'  => $args[3] ?? null,
                'opened_at' => now_iso(),
            ], ['Prefer: return=minimal']);
            $data = true;
            break;
        }

        case 'guestEvent': {
            // Гостевая воронка: только случайный идентификатор и строгий набор
            // технических полей. Произвольный payload и персональные данные не принимаем.
            $anon = trim((string)($args[0] ?? ''));
            $event = (string)($args[1] ?? '');
            $vacancyId = isset($args[2]) ? trim((string)$args[2]) : '';
            $kind = isset($args[3]) ? (string)$args[3] : '';
            $platform = isset($args[4]) ? (string)$args[4] : '';
            $campaignId = isset($args[5]) ? trim((string)$args[5]) : '';
            $channel = isset($args[6]) ? (string)$args[6] : '';

            $events = ['guest_started', 'vacancy_impression', 'apply_intent',
                'registration_started', 'registration_completed',
                'campaign_published', 'campaign_open', 'campaign_apply', 'campaign_shared'];
            $kinds = ['', 'shift', 'permanent'];
            $platforms = ['', 'web', 'ios', 'android', 'windows', 'macos'];
            $channels = ['', 'telegram_group', 'telegram_dm', 'user_share'];
            if ($anon === '' || strlen($anon) > 128 || !preg_match('/^[A-Za-z0-9._:-]+$/', $anon)
                || !in_array($event, $events, true)
                || !in_array($kind, $kinds, true)
                || !in_array($platform, $platforms, true)
                || !in_array($channel, $channels, true)
                || strlen($vacancyId) > 160
                || strlen($campaignId) > 64
                || ($campaignId !== '' && !preg_match('/^[A-Za-z0-9-]+$/', $campaignId))) {
                jt_respond(['error' => 'Invalid guest analytics event'], 400); exit;
            }

            sb('POST', 'jm_guest_events', [], [
                'id' => uid(),
                'anon_id' => $anon,
                'event_type' => $event,
                'vacancy_id' => $vacancyId !== '' ? $vacancyId : null,
                'vacancy_kind' => $kind !== '' ? $kind : null,
                'platform' => $platform !== '' ? $platform : null,
                'campaign_id' => $campaignId !== '' ? $campaignId : null,
                'channel' => $channel !== '' ? $channel : null,
                'occurred_at' => now_iso(),
            ], ['Prefer: return=minimal']);
            $data = true;
            break;
        }

        case 'dbGetPermVacancyViewers': {
            $rows = sb_select('jm_perm_vacancy_views', ['vacancy_id' => 'eq.' . $args[0]], 'worker_id,viewed_at', 'viewed_at.desc');
            $data = array_values(array_unique(array_column($rows, 'worker_id')));
            break;
        }

        // То же самое для постоянных вакансий.
        case 'dbGetPermVacancyViewsMap': {
            $mine = jt_own_vacancy_ids('jm_perm_vacancies', $authUid);
            if (!$mine) { $data = new stdClass(); break; }
            $rows = jt_rows_for_vacancies('jm_perm_vacancy_views', $mine, 'vacancy_id');
            $map = [];
            foreach ($rows as $r) {
                $vid = $r['vacancy_id'];
                if (!$vid) continue;
                $map[$vid] = ($map[$vid] ?? 0) + 1;
            }
            $data = $map;
            break;
        }

        case 'dbRecordPermVacancyView': {
            [$vid, $wid] = [$args[0], $args[1]];
            sb('POST', 'jm_perm_vacancy_views', ['on_conflict' => 'vacancy_id,worker_id'],
                ['vacancy_id' => $vid, 'worker_id' => $wid, 'viewed_at' => now_iso()],
                ['Prefer: resolution=merge-duplicates,return=minimal']);
            break;
        }

        // Отклик видят обе стороны: сам работник и работодатель этой смены.
        // Прежде операция была в $selfArgFns, то есть работодателю отвечала
        // отказом, — и экран переписки обходил это, выкачивая ВСЕ отклики
        // сервиса, чтобы найти в них один. Проверка, которую легко обойти
        // мягким путём, хуже отсутствующей: она создаёт видимость.
        case 'dbGetLikeByVacancyWorker': {
            $me = (string)($authUid ?? '');
            if ($me !== (string)($args[1] ?? '')) {
                $vac = sb_single('jm_vacancies', ['id' => 'eq.' . (string)($args[0] ?? '')], 'employer_id');
                if (!$vac || (string)($vac['employer_id'] ?? '') !== $me) {
                    jt_respond(['error' => 'Это не ваш отклик'], 403); exit;
                }
            }
            $data = sb_single('jm_likes', ['vacancy_id' => 'eq.' . $args[0], 'worker_id' => 'eq.' . $args[1]]); break;
        }

        case 'dbUpsertLike': {
            [$vid, $wid, $eid] = [$args[0], $args[1], $args[2]];
            $upd = is_array($args[3] ?? null) ? $args[3] : [];

            // Кто вправе что менять.
            //
            // Проверок здесь не было ни одной, а владельца смены брали с
            // клиента доводом. То есть любой вошедший мог одобрить или
            // отклонить чужого кандидата на чужую смену и отозвать чужой
            // отклик. Настоящего владельца берём из самой вакансии.
            $vac = sb_single('jm_vacancies', ['id' => 'eq.' . $vid], 'employer_id,title');
            $existingLike = sb_single('jm_likes', ['vacancy_id' => 'eq.' . $vid, 'worker_id' => 'eq.' . $wid]);
            // Смену можно удалить, а отклик по ней остаётся: связи в базе нет.
            // Для такого сироты владельца берём из самого отклика — иначе
            // работодатель не смог бы закрыть собственный старый отклик.
            $vacEmployer = (string)($vac['employer_id'] ?? ($existingLike['employer_id'] ?? ''));
            if ($vacEmployer === '') { jt_respond(['error' => 'Вакансия не найдена'], 404); exit; }
            if (array_key_exists('employerLiked', $upd) && (string)$authUid !== $vacEmployer) {
                jt_respond(['error' => 'Это не ваша вакансия'], 403); exit;
            }
            if ((array_key_exists('workerLiked', $upd) || array_key_exists('workerSkipped', $upd))
                && (string)$authUid !== (string)$wid) {
                jt_respond(['error' => 'Это не ваш отклик'], 403); exit;
            }

            $base = $existingLike ?? [
                'id' => uid(), 'vacancy_id' => $vid, 'worker_id' => $wid, 'employer_id' => $vacEmployer,
                'worker_liked' => false, 'employer_liked' => null, 'worker_skipped' => false,
                'is_match' => false, 'matched_at' => null,
                'worker_confirmed' => false, 'employer_confirmed' => false,
                'worker_rated' => false, 'employer_rated' => false, 'shift_completed' => false,
            ];
            // С клиента принимаем ТОЛЬКО эти три поля. Остальные — мэтч,
            // отметки о выходе на смену и об оценках — ставит сервер в своих
            // обработчиках, и раньше их можно было прислать сюда: подписать
            // себе мэтч, выход на смену или снятие оценки. Ключи помимо этих
            // молча пропускаем, а не отвергаем: ронять из-за них запись отклика
            // было бы хуже самой подделки.
            $row = array_merge($base, [
                'worker_liked'       => $upd['workerLiked']       ?? $base['worker_liked'],
                'employer_liked'     => $upd['employerLiked']     ?? $base['employer_liked'],
                'worker_skipped'     => $upd['workerSkipped']     ?? $base['worker_skipped'],
            ]);
            $written = sb_upsert('jm_likes', $row, 'vacancy_id,worker_id', true);
            if (empty($written)) throw new RuntimeException('Like not saved: permission denied');

            // Директору об отклике на смену — тоже отсюда. Тот же случай, что
            // и с постоянными вакансиями: раньше сообщение слал телефон
            // соискателя уже после записи, и терялось оно молча.
            $justApplied = !empty($row['worker_liked']) && empty($base['worker_liked']);
            if ($justApplied && $vacEmployer !== '') {
                $w = sb_single('jm_users', ['id' => 'eq.' . $wid], 'first_name,last_name');
                $wName = trim(($w['first_name'] ?? '') . ' ' . ($w['last_name'] ?? '')) ?: 'Кандидат';
                $vTitle = (string)($vac['title'] ?? 'смена');
                notify_user($vacEmployer, '📥 Новый отклик!',
                    $wName . ' хочет выйти на смену «' . $vTitle . '». Посмотрите кандидата!',
                    'new_applicant', [],
                    // В пуш — без имени: он уходит за границу. Директор всё
                    // равно открывает приложение, чтобы посмотреть кандидата,
                    // и имя в шторке ничего не решает.
                    'Кто-то хочет выйти на смену «' . $vTitle . '». Посмотрите кандидата!');
            }

            // Отказ по смене: строку в переписку пишет сервер.
            //
            // Её писало приложение вызовом dbInsertMessage от имени «system» —
            // а это запрещено проверкой «Invalid sender», сервер отвечал 403,
            // и отказ гасился пустым .catch(). Соискатель не видел ничего,
            // зато счётчик непрочитанного ему исправно рос: значок был, а за
            // ним пусто.
            //
            // Пишем со ВСЕХ экранов, где отказывают: из переписки, с
            // «Кандидатов» и из «Мэтчей». Раньше две последние молчали вовсе —
            // человек не узнавал об отказе никак; включено по решению
            // владельца проекта.
            $justRejected = $row['employer_liked'] === false && $base['employer_liked'] !== false;
            if ($justRejected) {
                jt_shift_reject_announce((string)$wid, $vacEmployer, (string)($vac['title'] ?? ''));
            }
            $data = $row; break;
        }

        case 'dbRemoveLike':
            sb_delete('jm_likes', ['vacancy_id' => 'eq.' . $args[0], 'worker_id' => 'eq.' . $args[1]]); break;

        // Удалить отклик может только его сторона. Проверки не было: любой
        // вошедший стирал чужой отклик по id, а вместе с ним итог смены и
        // основание рейтинга.
        case 'dbDeleteMatch':
            jt_shift_party((string)($args[0] ?? ''), $authUid, false);
            sb_delete('jm_likes', ['id' => 'eq.' . $args[0]]); break;

        // ── Messages ───────────────────────────────────────────────────────────
        case 'dbGetMessages':
            $data = sb_select('jm_messages', ['chat_id' => 'eq.' . $args[0]], '*', 'created_at.asc'); break;

        case 'dbInsertMessage': {
            $chatId = (string)($args[0] ?? '');
            $senderId = (string)($args[1] ?? '');
            $text = (string)($args[2] ?? '');
            // Новые клиенты создают id до proxy(): обе сетевые попытки одного
            // логического действия несут один id. Для старых сборок без 4-го
            // аргумента оставляем серверный id — совместимость без падения.
            $messageId = trim((string)($args[3] ?? ''));
            if ($messageId === '') $messageId = uid();

            $rows = sb_rpc('jm_insert_message_atomic', [
                'p_message_id' => $messageId,
                'p_chat_id' => $chatId,
                'p_sender_id' => $senderId,
                'p_text' => $text,
            ]);
            $result = is_array($rows) && isset($rows[0]) && is_array($rows[0]) ? $rows[0] : null;
            if (!$result) throw new Exception('Не удалось записать сообщение');

            $msg = [
                'id' => (string)($result['message_id'] ?? $messageId),
                'chat_id' => (string)($result['chat_id'] ?? $chatId),
                'sender_id' => (string)($result['sender_id'] ?? $senderId),
                'text' => (string)($result['message_text'] ?? $text),
                'created_at' => (string)($result['created_at'] ?? now_iso()),
            ];

            // На retry RPC вернёт inserted=false: строка уже есть, unread уже
            // увеличен. Повторный пуш тогда тоже не нужен.
            if (!empty($result['inserted'])) {
                try {
                    $chatRow = sb_single('jm_chats', ['id' => 'eq.' . $chatId],
                        'id,worker_id,employer_id');
                    if ($chatRow) jt_notify_new_message($chatRow, $senderId, $text);
                } catch (Throwable $e) {
                    // Сообщение и unread уже атомарно записаны — внешнее
                    // уведомление не должно превращать успех в ошибку.
                }
            }
            $data = $msg; break;
        }

        case 'dbUploadFile': {
            $name = (string)($args[0] ?? '');
            $b64  = (string)($args[1] ?? '');
            $type = (string)($args[2] ?? 'application/octet-stream');

            // Бакет avatars — публичный, и лежит он на том же имени, что и сам
            // сайт: ссылка вида jobtoo.ru/storage/v1/object/public/avatars/…
            // открывается в том же origin, где работает веб-приложение.
            //
            // Значит тип файла нельзя брать с клиента. Иначе достаточно
            // зарегистрироваться, залить «аватар» с типом text/html и кинуть
            // ссылку в переписку: страница выполнится как своя, с доступом к
            // сохранённому токену сессии. Пускаем только картинки, и проверяем
            // не заявленный тип, а сами байты.
            $byType = [
                'image/jpeg' => IMAGETYPE_JPEG,
                'image/png'  => IMAGETYPE_PNG,
                'image/webp' => IMAGETYPE_WEBP,
            ];
            if (!isset($byType[$type])) {
                $data = ['error' => 'аватаром может быть только JPEG, PNG или WebP']; break;
            }

            // Имя тоже не с клиента: под ним лежит чужой аватар, а запись идёт
            // с x-upsert, то есть поверх. Единственное допустимое имя — своё.
            if ($authUid === null || $name !== 'avatar_' . $authUid . '.jpg') {
                $data = ['error' => 'плохое имя файла']; break;
            }
            if (!preg_match('#^[A-Za-z0-9._/-]{1,180}$#', $name) || str_contains($name, '..')) {
                $data = ['error' => 'плохое имя файла']; break;
            }
            $bytes = base64_decode($b64, true);
            if ($bytes === false || $bytes === '') { $data = ['error' => 'пустой файл']; break; }
            if (strlen($bytes) > 25 * 1024 * 1024) { $data = ['error' => 'файл больше 25 МБ']; break; }

            // Заявленный тип сверяем с содержимым: бывают файлы, которые и
            // картинка, и разметка сразу, — такой проходит по типу, а
            // открывается как страница.
            $probe = @getimagesizefromstring($bytes);
            if (!is_array($probe) || ($probe[2] ?? null) !== $byType[$type]) {
                $data = ['error' => 'содержимое не похоже на ' . $type]; break;
            }

            $ch = curl_init(SB_URL . '/storage/v1/object/avatars/' . $name);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CUSTOMREQUEST => 'POST',
                CURLOPT_POSTFIELDS => $bytes,
                CURLOPT_TIMEOUT => 60,
                CURLOPT_HTTPHEADER => [
                    'apikey: ' . SB_KEY,
                    'Authorization: Bearer ' . SB_KEY,
                    'Content-Type: ' . $type,
                    'Cache-Control: max-age=3600',
                    // Перезапись: аватар кладётся под одним и тем же именем,
                    // и без этого вторая смена фотографии молча не проходила бы.
                    'x-upsert: true',
                ],
            ]);
            $resp = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err  = curl_error($ch);
            curl_close($ch);

            if ($code < 200 || $code >= 300) {
                // Возвращаем причину, а не просто «не вышло»: без неё
                // разбираться придётся по чужим экранам.
                $data = ['error' => $err ?: ('хранилище ответило ' . $code . ': ' . substr((string)$resp, 0, 200))];
                break;
            }
            $data = ['url' => SB_URL . '/storage/v1/object/public/avatars/' . $name];
            break;
        }

        // ── Приватный сейф резюме ─────────────────────────────────────────────
        case 'dbGetResumeFiles': {
            $data = sb_select(
                'jm_resume_files',
                ['user_id' => 'eq.' . (string)$authUid],
                'id,user_id,file_name,storage_path,resume_data,resume_email,imported_at,selected,created_at,updated_at',
                'updated_at.desc'
            );
            break;
        }

        case 'dbSaveResumeFile': {
            $fileName = trim((string)($args[0] ?? ''));
            $b64 = (string)($args[1] ?? '');
            $resumeData = is_array($args[2] ?? null) ? $args[2] : null;
            $resumeEmail = isset($args[3]) && $args[3] !== null ? trim((string)$args[3]) : null;
            if ($fileName === '' || mb_strlen($fileName) > 180) {
                $data = ['error' => 'Некорректное имя файла']; break;
            }
            if (!preg_match('/\.pdf$/iu', $fileName)) {
                $data = ['error' => 'Можно сохранить только PDF']; break;
            }
            if ($resumeData === null) {
                $data = ['error' => 'Нет распознанных данных резюме']; break;
            }
            $bytes = base64_decode($b64, true);
            if ($bytes === false || $bytes === '') {
                $data = ['error' => 'Пустой PDF']; break;
            }
            if (strlen($bytes) > 10 * 1024 * 1024) {
                $data = ['error' => 'PDF больше 10 МБ']; break;
            }
            if (substr($bytes, 0, 4) !== '%PDF') {
                $data = ['error' => 'Файл не похож на PDF']; break;
            }

            $id = uid();
            $path = 'resume/' . (string)$authUid . '/' . $id . '.pdf';
            $now = now_iso();
            jt_resume_storage_upload($path, $bytes);

            try {
                // Частичный unique-index разрешает только одно selected=true.
                sb_update('jm_resume_files', ['user_id' => 'eq.' . (string)$authUid], ['selected' => false]);
                $rows = sb_insert('jm_resume_files', [
                    'id' => $id,
                    'user_id' => (string)$authUid,
                    'file_name' => $fileName,
                    'storage_path' => $path,
                    'resume_data' => $resumeData,
                    'resume_email' => $resumeEmail !== '' ? $resumeEmail : null,
                    'imported_at' => $now,
                    'selected' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ], true);
                $row = $rows[0] ?? sb_single('jm_resume_files', [
                    'id' => 'eq.' . $id,
                    'user_id' => 'eq.' . (string)$authUid,
                ]);
                if (!$row) throw new RuntimeException('Не удалось сохранить резюме');
                jt_resume_sync_user((string)$authUid, $row);
                $data = $row;
            } catch (Throwable $e) {
                jt_resume_storage_delete($path);
                throw $e;
            }
            break;
        }

        case 'dbSelectResumeFile': {
            $id = trim((string)($args[0] ?? ''));
            $row = $id !== '' ? sb_single('jm_resume_files', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . (string)$authUid,
            ]) : null;
            if (!$row) { $data = ['error' => 'Резюме не найдено']; break; }

            sb_update('jm_resume_files', ['user_id' => 'eq.' . (string)$authUid], ['selected' => false]);
            $now = now_iso();
            sb_update('jm_resume_files', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . (string)$authUid,
            ], ['selected' => true, 'updated_at' => $now]);
            $row['selected'] = true;
            $row['updated_at'] = $now;
            jt_resume_sync_user((string)$authUid, $row);
            $data = $row;
            break;
        }

        case 'dbRenameResumeFile': {
            $id = trim((string)($args[0] ?? ''));
            $name = trim((string)($args[1] ?? ''));
            if ($name === '' || mb_strlen($name) > 180 || !preg_match('/\.pdf$/iu', $name)) {
                $data = ['error' => 'Имя должно заканчиваться на .pdf']; break;
            }
            $row = $id !== '' ? sb_single('jm_resume_files', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . (string)$authUid,
            ]) : null;
            if (!$row) { $data = ['error' => 'Резюме не найдено']; break; }
            $now = now_iso();
            sb_update('jm_resume_files', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . (string)$authUid,
            ], ['file_name' => $name, 'updated_at' => $now]);
            $row['file_name'] = $name;
            $row['updated_at'] = $now;
            if (!empty($row['selected'])) jt_resume_sync_user((string)$authUid, $row);
            $data = $row;
            break;
        }

        case 'dbDeleteResumeFile': {
            $id = trim((string)($args[0] ?? ''));
            $row = $id !== '' ? sb_single('jm_resume_files', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . (string)$authUid,
            ]) : null;
            if (!$row) { $data = ['error' => 'Резюме не найдено']; break; }

            jt_resume_storage_delete((string)($row['storage_path'] ?? ''));
            sb_delete('jm_resume_files', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . (string)$authUid,
            ]);

            if (!empty($row['selected'])) {
                $remaining = sb_select(
                    'jm_resume_files',
                    ['user_id' => 'eq.' . (string)$authUid],
                    '*',
                    'updated_at.desc'
                );
                $next = $remaining[0] ?? null;
                if ($next) {
                    sb_update('jm_resume_files', ['user_id' => 'eq.' . (string)$authUid], ['selected' => false]);
                    sb_update('jm_resume_files', ['id' => 'eq.' . (string)$next['id']], ['selected' => true]);
                    $next['selected'] = true;
                    jt_resume_sync_user((string)$authUid, $next);
                    $data = $next;
                } else {
                    jt_resume_sync_user((string)$authUid, null);
                    $data = null;
                }
            } else {
                $selected = sb_single('jm_resume_files', [
                    'user_id' => 'eq.' . (string)$authUid,
                    'selected' => 'eq.true',
                ]);
                $data = $selected;
            }
            break;
        }

        case 'dbSignResumeFile': {
            $id = trim((string)($args[0] ?? ''));
            $row = $id !== '' ? sb_single('jm_resume_files', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . (string)$authUid,
            ], 'storage_path') : null;
            if (!$row) { $data = ['error' => 'Резюме не найдено']; break; }
            $data = ['url' => jt_resume_signed_url((string)$row['storage_path'])];
            break;
        }

        // ── Chats ──────────────────────────────────────────────────────────────
        case 'dbGetChats': {
            $field = $args[1] === 'worker' ? 'worker_id' : 'employer_id';
            $rows = sb_select('jm_chats', [$field => 'eq.' . $args[0]], '*', 'created_at.desc');
            if (empty($rows)) { $data = []; break; }
            $ids = array_map(fn($r) => $r['id'], $rows);
            $msgs = sb_select('jm_messages', ['chat_id' => 'in.(' . implode(',', $ids) . ')'], '*', 'created_at.desc');
            $last = [];
            foreach ($msgs as $m) { if (!isset($last[$m['chat_id']])) $last[$m['chat_id']] = $m; }
            $data = array_map(function($r) use ($last) { $r['_last_msg'] = $last[$r['id']] ?? null; return $r; }, $rows);
            break;
        }

        case 'dbGetChatById': {
            $chat = sb_single('jm_chats', ['id' => 'eq.' . $args[0]]);
            if (!$chat) { $data = null; break; }
            $chat['_messages'] = sb_select('jm_messages', ['chat_id' => 'eq.' . $args[0]], '*', 'created_at.asc');
            $data = $chat; break;
        }

        case 'dbCreateChat': {
            // Девятый аргумент — автор первого сообщения: true/'worker' —
            // работник, 'employer' — работодатель, иначе система. Оно и
            // отправляется от его имени, а не от системы.
            [$wid, $eid, $vid, $vt, $cn, $sm, $uw, $ue] =
                [$args[0], $args[1], $args[2], $args[3], $args[4], $args[5] ?? null,
                 $args[6] ?? 0, $args[7] ?? 0];
            $author = $authUid === (string)$wid ? 'worker' : 'employer';
            $uw = $sm && $author === 'employer' ? 1 : 0;
            $ue = $sm && $author === 'worker' ? 1 : 0;
            $data = chat_ensure($wid, $eid, (string)$vid, (string)$vt, (string)$cn,
                                $sm, (int)$uw, (int)$ue, $author);
            // О первом сообщении извещаем здесь же. Раньше это делал телефон
            // отправителя отдельным вызовом, с текстом уведомления от себя.
            //
            // Именно ЗДЕСЬ, а не внутри chat_ensure: её зовёт ещё и
            // dbApplyPermVacancy, а та извещает работодателя своим
            // «Новая заявка». Извещай chat_ensure — на одно событие приходило
            // бы два пуша.
            $senderId = ($author === true || $author === 'worker') ? (string)$wid
                      : ($author === 'employer' ? (string)$eid : '');
            if ($senderId !== '' && trim((string)$sm) !== '') {
                try {
                    jt_notify_new_message(
                        ['id' => (string)$data, 'worker_id' => (string)$wid, 'employer_id' => (string)$eid],
                        $senderId, (string)$sm);
                } catch (Throwable $e) { /* чат заведён — это главное */ }
            }
            break;
        }

        case 'dbMarkRead': {
            // Вместе со счётчиком запоминаем и время: по нему собеседник
            // увидит вторую галочку. Одно без другого бессмысленно —
            // счётчик говорит «сколько», а галочка «с какого момента».
            $f = $args[1] === 'worker' ? 'unread_worker' : 'unread_employer';
            $t = $args[1] === 'worker' ? 'worker_read_at' : 'employer_read_at';
            sb_update('jm_chats', ['id' => 'eq.' . $args[0]], [$f => 0, $t => now_iso()]); break;
        }

        case 'dbIncrementUnread': {
            // Совместимость со старыми установленными клиентами. Начиная с
            // migration 070 unread увеличивается в той же транзакции, что и
            // dbInsertMessage. Старые сборки после успешной отправки всё ещё
            // вызывают этот endpoint; второй increment дал бы двойной badge.
            // Авторизационная проверка операции выше остаётся в силе.
            $data = null; break;
        }

        case 'dbMergeDuplicateChats': {
            @set_time_limit(300);
            $apply = ($args[0] ?? false) === true;

            $all = sb_select('jm_chats', [], 'id,worker_id,employer_id,vacancy_id,unread_worker,unread_employer,created_at', 'created_at.asc');
            $groups = [];
            foreach ($all as $c) {
                $groups[$c['worker_id'] . '|' . $c['employer_id']][] = $c;
            }

            $report = ['pairs' => 0, 'chatsMerged' => 0, 'messagesMoved' => 0, 'cards' => 0, 'details' => []];
            foreach ($groups as $key => $group) {
                if (count($group) < 2) continue;
                $report['pairs']++;
                $keeper = $group[0];   // created_at.asc — первый и есть старший

                foreach ($group as $ch) {
                    $msgs = sb_select('jm_messages', ['chat_id' => 'eq.' . $ch['id']], 'id,created_at', 'created_at.asc');
                    // Карточка встаёт на секунду раньше первого сообщения блока
                    $first = $msgs[0]['created_at'] ?? $ch['created_at'];
                    $stamp = gmdate('Y-m-d\TH:i:s.v\Z', max(0, strtotime($first) - 1));
                    $card = vacancy_card_text((string)($ch['vacancy_id'] ?? ''));

                    if ($card) {
                        $report['cards']++;
                        if ($apply) {
                            sb_insert('jm_messages', ['id' => uid(), 'chat_id' => $keeper['id'],
                                'sender_id' => 'system', 'text' => $card, 'created_at' => $stamp]);
                        }
                    }

                    if ($ch['id'] === $keeper['id']) continue;

                    $report['chatsMerged']++;
                    $report['messagesMoved'] += count($msgs);
                    if ($apply && $msgs) {
                        sb_update('jm_messages', ['chat_id' => 'eq.' . $ch['id']], ['chat_id' => $keeper['id']]);
                    }
                }

                if ($apply) {
                    $uw = 0; $ue = 0;
                    foreach ($group as $ch) {
                        $uw += (int)($ch['unread_worker'] ?? 0);
                        $ue += (int)($ch['unread_employer'] ?? 0);
                    }
                    sb_update('jm_chats', ['id' => 'eq.' . $keeper['id']],
                        ['unread_worker' => $uw, 'unread_employer' => $ue]);
                    foreach ($group as $ch) {
                        // Только строку чата: сообщения уже переехали к старшему
                        if ($ch['id'] !== $keeper['id']) sb_delete('jm_chats', ['id' => 'eq.' . $ch['id']]);
                    }
                }

                $report['details'][] = ['pair' => $key, 'keep' => $keeper['id'], 'chats' => count($group)];
            }

            $report['applied'] = $apply;
            $data = $report; break;
        }

        case 'dbDeleteChat':
            sb_delete('jm_messages', ['chat_id' => 'eq.' . $args[0]]);
            sb_delete('jm_chats', ['id' => 'eq.' . $args[0]]); break;

        // ── Saved ──────────────────────────────────────────────────────────────
        case 'dbGetSaved': {
            $rows = sb_select('jm_saved', ['user_id' => 'eq.' . $args[0]], 'vacancy_id');
            $data = array_map(fn($r) => $r['vacancy_id'], $rows); break;
        }

        case 'dbAddSaved':
            sb_upsert('jm_saved', ['user_id' => $args[0], 'vacancy_id' => $args[1]]); break;

        case 'dbRemoveSaved':
            sb_delete('jm_saved', ['user_id' => 'eq.' . $args[0], 'vacancy_id' => 'eq.' . $args[1]]); break;

        // ── Complaints ─────────────────────────────────────────────────────────
        case 'dbFileComplaint': {
            $p = $args[0];
            // Заявитель — из подписанной сессии, а не из тела запроса. Прежде
            // можно было подать жалобу от чужого имени: reporterId брали как
            // прислали.
            sb_insert('jm_complaints', [
                'id' => uid(), 'reporter_id' => (string)($authUid ?? ''), 'reporter_phone' => $p['reporterPhone'],
                'reporter_company' => $p['reporterCompany'] ?? null, 'target_id' => $p['targetId'],
                'target_phone' => $p['targetPhone'], 'target_company' => $p['targetCompany'] ?? null,
                'complaint_type' => $p['complaintType'], 'description' => $p['description'] ?? null,
                'created_at' => now_iso(),
            ]); break;
        }

        // ── Match logic ────────────────────────────────────────────────────────
        case 'dbCheckAndCreateMatch': {
            $vid = (string)($args[0] ?? '');
            $wid = (string)($args[1] ?? '');
            if ($vid === '' || $wid === '') {
                jt_respond(['error' => 'Vacancy and worker required'], 400); exit;
            }

            // Проверяем право по фактической связи, а не по положению аргумента.
            // Раньше workerId лежал в $selfArgFns: работник проходил, а
            // работодатель — владелец вакансии — получал 403 и не мог завершить
            // взаимный лайк в мэтч. Теперь допустимы ровно две стороны отклика.
            $like = sb_single('jm_likes', [
                'vacancy_id' => 'eq.' . $vid,
                'worker_id' => 'eq.' . $wid,
            ], 'id,worker_id,employer_id,worker_liked,employer_liked,is_match');
            if (!$like) { $data = ['matched' => false]; break; }

            $eid = (string)($like['employer_id'] ?? '');
            $callerIsWorker = (string)$authUid === $wid;
            $callerIsEmployer = (string)$authUid === $eid;
            if (!$callerIsWorker && !$callerIsEmployer) {
                jt_respond(['error' => 'Match access denied'], 403); exit;
            }

            // Старые строки могли пережить прежнюю доверчивую запись employer_id.
            // Перед SECURITY DEFINER RPC подтверждаем владельца по самой вакансии.
            $vac = sb_single('jm_vacancies', ['id' => 'eq.' . $vid], 'employer_id');
            if (!$vac || (string)($vac['employer_id'] ?? '') !== $eid) {
                jt_respond(['error' => 'Match vacancy mismatch'], 403); exit;
            }

            $rows = sb_rpc('jm_match_shift_atomic', [
                'p_vacancy_id' => $vid,
                'p_worker_id' => $wid,
                'p_chat_id' => uid(),
            ]);
            $result = $rows[0] ?? null;
            if (!is_array($result)) {
                throw new Exception('atomic shift match returned no result');
            }

            $matched = ($result['matched'] ?? false) === true;
            $cid = trim((string)($result['chat_id'] ?? ''));

            // Набор закрыл смену — она уходит из карты сайта (там только
            // открытые). Кэш карты живёт час, и всё это время он рекламировал
            // бы роботу адрес, который уже отвечает 404.
            if (($result['vacancy_closed'] ?? false) === true) {
                sm_cache_invalidate();
            }

            // Push/Telegram — побочный эффект после commit. Его сбой не должен
            // откатывать уже созданные мэтч и чат; повтор RPC тоже безопасен.
            if ($matched) {
                try {
                    jt_notify_match((string)$vid, (string)$wid, (string)$eid, $authUid);
                } catch (Throwable $e) { /* основной commit уже состоялся */ }
            }

            $data = ['matched' => $matched];
            if ($cid !== '') $data['chatId'] = $cid;
            break;
        }

        // ── Permanent vacancies ────────────────────────────────────────────────
        case 'dbGetPermVacancies':
            $data = sb_select('jm_perm_vacancies', ['status' => 'eq.open'], '*', 'created_at.desc'); break;

        // Лента карьерных вакансий: порция под человека (php-proxy/ext_feed.php).
        // Гость получает общую ленту с чередованием компаний, вошедший — без
        // уже свайпнутых и с учётом вкуса. Кто вошёл — из подписанной сессии,
        // не из аргументов: чужие свайпы так не подсмотреть.
        case 'dbGetExtFeed': {
            $limit = max(10, min(100, (int)($args[0] ?? 60)));
            $pool = sb_rpc('jm_ext_feed_pool', ['p_user' => $authUid, 'p_per_company' => 30]);
            $history = [];
            if ($authUid !== null) {
                foreach (sb_select('jm_ext_swipes', [
                    'user_id' => 'eq.' . $authUid, 'limit' => '300',
                ], 'dir,jm_ext_vacancies(company,title)', 'created_at.desc') as $h) {
                    $v = $h['jm_ext_vacancies'] ?? [];
                    $history[] = ['dir' => $h['dir'] ?? 0, 'company' => $v['company'] ?? '', 'title' => $v['title'] ?? ''];
                }
            }
            $data = ext_feed_arrange(is_array($pool) ? $pool : [], ext_feed_taste($history), $limit,
                ($authUid ?? 'guest') . '|' . gmdate('Y-m-d'));
            break;
        }

        case 'dbExtSwipe': {
            $dir = (int)($args[2] ?? 0);
            $vacancyId = (string)($args[1] ?? '');
            if (!in_array($dir, [-1, 1], true) || $vacancyId === '') {
                jt_respond(['error' => 'Bad swipe'], 400); exit;
            }
            sb('POST', 'jm_ext_swipes', ['on_conflict' => 'user_id,vacancy_id'], [
                'user_id' => (string)$args[0], 'vacancy_id' => $vacancyId, 'dir' => $dir,
            ], ['Prefer: resolution=merge-duplicates,return=minimal']);
            $data = ['ok' => true];
            break;
        }

        // Кнопка «вернуть» в шапке ленты: свайп отменяется целиком.
        case 'dbExtUnswipe': {
            sb('DELETE', 'jm_ext_swipes', [
                'user_id' => 'eq.' . (string)$args[0], 'vacancy_id' => 'eq.' . (string)($args[1] ?? ''),
            ]);
            $data = ['ok' => true];
            break;
        }

        case 'dbGetExtVacancies': {
            $f = ['active' => 'eq.true'];
            if (!empty($args[0])) $f['company'] = 'eq.' . $args[0];
            $data = sb_select('jm_ext_vacancies', $f, '*', 'last_seen_at.desc');
            break;
        }

        case 'dbGetPermVacanciesByEmployer':
            $data = sb_select('jm_perm_vacancies', ['employer_id' => 'eq.' . $args[0]], '*', 'created_at.desc'); break;

        case 'dbUpsertPermVacancy':
            vacancy_content_guard($args[0]);
            save_then_geocode('jm_perm_vacancies', $args[0]); break;

        case 'dbClosePermVacancy':
            sb_update('jm_perm_vacancies', ['id' => 'eq.' . $args[0]], ['status' => 'closed']); break;

        case 'dbDeleteVacancy':
            sb_delete('jm_vacancies', ['id' => 'eq.' . $args[0]]);
            sm_cache_invalidate(); break;

        case 'dbDeletePermVacancy':
            sb_delete('jm_perm_vacancies', ['id' => 'eq.' . $args[0]]); break;

        // ── Permanent applications ─────────────────────────────────────────────
        case 'dbGetPermApplications': {
            $f = $args[1] === 'worker' ? 'worker_id' : 'employer_id';
            $data = sb_select('jm_perm_applications', [$f => 'eq.' . $args[0]], '*', 'created_at.desc'); break;
        }

        case 'dbGetPermApplicationsForVacancy':
            $data = sb_select('jm_perm_applications', ['vacancy_id' => 'eq.' . $args[0]], '*', 'created_at.desc'); break;

        // ── Заявки Jupiter на внешних сайтах ─────────────────────────────
        //
        // Отклик внутри JobToo (dbApplyPermVacancy) и заявка Jupiter — разные
        // вещи. Первый решает работодатель у нас, вторая живёт на чужом сайте
        // и проходит фоновым прогоном. Общего у них только слово «отклик».

        case 'jupiterMailbox': {
            $uidArg = (string)$args[0];
            $data = ['address' => jt_jupiter_mailbox($uidArg),
                'ready' => jt_secret('JUPITER_MAIL_VERIFIED') === '1'];
            break;
        }

        case 'jupiterMailList': {
            $data = sb_select('jm_jupiter_emails', [
                'user_id' => 'eq.' . (string)$args[0], 'limit' => '100',
            ], 'id,sender,subject,body,received_at,read_at', 'received_at.desc');
            break;
        }

        case 'jupiterMailRead': {
            $uidArg = (string)$args[0];
            $id = (string)($args[1] ?? '');
            sb_update('jm_jupiter_emails', [
                'id' => 'eq.' . $id, 'user_id' => 'eq.' . $uidArg, 'read_at' => 'is.null',
            ], ['read_at' => now_iso()]);
            $data = ['ok' => true];
            break;
        }

        case 'jupiterMailIngest': {
            $recipient = strtolower(trim((string)($args[0] ?? '')));
            $message = is_array($args[1] ?? null) ? $args[1] : [];
            $box = sb_single('jm_jupiter_mailboxes', ['address' => 'eq.' . $recipient], 'user_id');
            if (!$box) { $data = ['stored' => false]; break; }
            $key = trim((string)($message['imap_uid'] ?? ''));
            if ($key === '') { jt_respond(['error' => 'Missing IMAP UID'], 400); exit; }
            $key = mb_substr($key, 0, 180);
            $content = [
                'sender' => mb_substr((string)($message['sender'] ?? ''), 0, 320),
                'subject' => mb_substr((string)($message['subject'] ?? ''), 0, 998),
                'body' => mb_substr((string)($message['body'] ?? ''), 0, 100000),
            ];
            $rows = sb('POST', 'jm_jupiter_emails', ['on_conflict' => 'imap_uid'], [
                'id' => uid(), 'user_id' => $box['user_id'], 'mailbox_address' => $recipient,
                'imap_uid' => $key,
                'received_at' => $message['received_at'] ?? now_iso(),
            ] + $content, ['Prefer: resolution=ignore-duplicates,return=representation']);
            if (!$rows) {
                // Письмо уже было: служба перечитала ящик после улучшения
                // разбора (ссылки, полная HTML-версия). Обновляем текст, но
                // только у того же человека и не трогая id и отметку прочтения.
                sb_update('jm_jupiter_emails', [
                    'imap_uid' => 'eq.' . $key, 'user_id' => 'eq.' . $box['user_id'],
                ], $content);
            }
            $data = ['stored' => true];
            break;
        }

        case 'jupiterLiveStatus': {
            $user = sb_single('jm_users', ['id' => 'eq.' . (string)$args[0]], 'jupiter_live_enabled_at');
            $data = ['enabled' => !empty($user['jupiter_live_enabled_at'])];
            break;
        }

        case 'jupiterSetLive': {
            $uidArg = (string)$args[0];
            $enabled = ($args[1] ?? null) === true;
            if ($enabled && jt_secret('JUPITER_MAIL_VERIFIED') !== '1') {
                jt_respond(['error' => 'Почта JobToo ещё не подключена. Отклики пока нельзя отправлять.'], 503); exit;
            }
            if ($enabled && !sb_single('jm_resume_files', [
                'user_id' => 'eq.' . $uidArg, 'selected' => 'eq.true',
                'storage_path' => 'not.is.null',
            ], 'id')) {
                jt_respond(['error' => 'Сначала загрузите и выберите резюме PDF'], 409); exit;
            }
            if ($enabled && !jt_jupiter_mailbox($uidArg)) {
                jt_respond(['error' => 'Сначала откройте почту JobToo для создания адреса'], 409); exit;
            }
            sb_update('jm_users', ['id' => 'eq.' . $uidArg], [
                'jupiter_live_enabled_at' => $enabled ? now_iso() : null,
            ]);
            if (!$enabled) {
                // Unleased requests must not spring back to life after a later opt-in.
                sb_update('jm_jupiter_applications', [
                    'user_id' => 'eq.' . $uidArg,
                    'state' => 'in.(queued,retryable_failed,ready_to_submit)',
                    'lease_owner' => 'is.null',
                    'submission_authorized_at' => 'not.is.null',
                ], [
                    'state' => 'ready_to_submit',
                    'submission_authorized_at' => null,
                    'reason_code' => 'LIVE_AUTHORIZATION_REVOKED',
                    'updated_at' => now_iso(),
                ]);
            }
            $data = ['enabled' => $enabled];
            break;
        }

        case 'jupiterGrantThirdPartyConsent': {
            $uidArg = (string)($args[0] ?? '');
            $id = (string)($args[1] ?? '');
            $termsUrl = trim((string)($args[2] ?? ''));
            if ($termsUrl !== 'https://rabota.sber.ru/terms') {
                jt_respond(['error' => 'Неизвестные условия работодателя'], 400); exit;
            }
            $user = sb_single('jm_users', ['id' => 'eq.' . $uidArg], 'jupiter_live_enabled_at,is_blocked');
            if (!$user || empty($user['jupiter_live_enabled_at']) || !empty($user['is_blocked'])) {
                jt_respond(['error' => 'Сначала включите отправку откликов'], 403); exit;
            }
            $existing = sb_single('jm_jupiter_applications', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . $uidArg,
            ], 'id,vacancy_url,state,reason_code,lease_owner,submission_authorized_at');
            $host = $existing ? strtolower((string)(parse_url((string)$existing['vacancy_url'], PHP_URL_HOST) ?: '')) : '';
            $allowedReason = $existing && in_array(
                (string)($existing['reason_code'] ?? ''),
                ['CONSENT_REQUIRED', 'UNSUPPORTED_SCRIPT'],
                true
            );
            if (!$existing || $host !== 'rabota.sber.ru'
                || $existing['state'] !== 'action_required'
                || !$allowedReason || !empty($existing['lease_owner'])) {
                jt_respond(['error' => 'Для этой заявки согласие сейчас не требуется'], 409); exit;
            }
            $resume = sb_single('jm_resume_files', [
                'user_id' => 'eq.' . $uidArg,
                'selected' => 'eq.true',
            ], 'storage_path');
            $mailbox = ['address' => jt_jupiter_mailbox($uidArg)];
            if (jt_secret('JUPITER_MAIL_VERIFIED') !== '1'
                || empty($resume['storage_path']) || empty($mailbox['address'])) {
                jt_respond(['error' => 'Почта или выбранное PDF-резюме недоступны'], 409); exit;
            }
            $now = now_iso();
            sb_update('jm_jupiter_applications', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . $uidArg,
                'state' => 'eq.action_required',
                'lease_owner' => 'is.null',
            ], [
                'state' => 'queued',
                'reason_code' => null,
                'not_before' => null,
                'third_party_consent_at' => $now,
                'third_party_terms_url' => $termsUrl,
                'submission_authorized_at' => !empty($existing['submission_authorized_at'])
                    ? $existing['submission_authorized_at'] : $now,
                'updated_at' => $now,
            ]);
            $data = sb_single('jm_jupiter_applications', [
                'id' => 'eq.' . $id,
                'user_id' => 'eq.' . $uidArg,
            ]);
            if (!$data || empty($data['third_party_consent_at'])) {
                jt_respond(['error' => 'Не удалось сохранить согласие'], 409); exit;
            }
            break;
        }

        case 'jupiterRequeueLive': {
            $uidArg = (string)$args[0];
            $id = (string)($args[1] ?? '');
            $user = sb_single('jm_users', ['id' => 'eq.' . $uidArg], 'jupiter_live_enabled_at');
            if (empty($user['jupiter_live_enabled_at'])) {
                jt_respond(['error' => 'Сначала включите отправку откликов'], 403); exit;
            }
            if (jt_secret('JUPITER_MAIL_VERIFIED') !== '1') {
                jt_respond(['error' => 'Почта JobToo временно недоступна'], 503); exit;
            }
            $selectedResume = sb_single('jm_resume_files', [
                'user_id' => 'eq.' . $uidArg, 'selected' => 'eq.true',
            ], 'id,storage_path');
            if (empty($selectedResume['storage_path'])) {
                jt_respond(['error' => 'Сначала загрузите и выберите резюме PDF'], 409); exit;
            }
            $existing = sb_single('jm_jupiter_applications', [
                'id' => 'eq.' . $id, 'user_id' => 'eq.' . $uidArg,
            ], 'id,state,lease_owner,submission_authorized_at,reason_code');
            $canRequeue = $existing && (
                ($existing['state'] === 'ready_to_submit' && empty($existing['submission_authorized_at']))
                || ($existing['state'] === 'action_required'
                    && ($existing['reason_code'] ?? '') === 'LIVE_AUTHORIZATION_REVOKED')
            );
            if (!$canRequeue || !empty($existing['lease_owner'])) {
                jt_respond(['error' => 'Эту заявку нельзя отправить повторно'], 409); exit;
            }
            $filters = [
                'id' => 'eq.' . $id, 'user_id' => 'eq.' . $uidArg,
                'state' => 'eq.' . $existing['state'], 'lease_owner' => 'is.null',
            ];
            if ($existing['state'] === 'ready_to_submit') {
                $filters['submission_authorized_at'] = 'is.null';
            }
            sb_update('jm_jupiter_applications', $filters, [
                'state' => 'queued', 'submission_authorized_at' => now_iso(),
                'reason_code' => null, 'not_before' => null, 'updated_at' => now_iso(),
            ]);
            $data = sb_single('jm_jupiter_applications', [
                'id' => 'eq.' . $id, 'user_id' => 'eq.' . $uidArg,
            ]);
            if (!$data || empty($data['submission_authorized_at'])) {
                jt_respond(['error' => 'Не удалось поставить заявку в очередь'], 409); exit;
            }
            break;
        }

        // Данные для ручного заполнения анкеты в WebView. Отдаём только
        // собственные поля человека — без резюме, ссылок и согласий: их
        // заполняет отдельный экран, а не этот скрипт.
        case 'jupiterFillProfile': {
            $uidArg = (string)($args[0] ?? '');
            $user = sb_single('jm_users', ['id' => 'eq.' . $uidArg],
                'first_name,last_name,phone,personal_data,resume_data');
            if (!$user) { jt_respond(['error' => 'Пользователь не найден'], 404); exit; }
            $personalData = null;
            if (!empty($user['personal_data'])) {
                $personalData = is_string($user['personal_data'])
                    ? json_decode($user['personal_data'], true)
                    : $user['personal_data'];
            }
            if (!is_array($personalData)) $personalData = [];
            $resume = sb_single('jm_resume_files', [
                'user_id' => 'eq.' . $uidArg, 'selected' => 'eq.true',
            ], 'resume_data');
            $resumeData = null;
            if ($resume && !empty($resume['resume_data'])) {
                $resumeData = is_string($resume['resume_data'])
                    ? json_decode($resume['resume_data'], true)
                    : $resume['resume_data'];
            } elseif (!empty($user['resume_data'])) {
                $resumeData = is_string($user['resume_data'])
                    ? json_decode($user['resume_data'], true)
                    : $user['resume_data'];
            }
            if (!is_array($resumeData)) $resumeData = [];
            $mailbox = ['address' => jt_jupiter_mailbox($uidArg)];
            $firstName = trim((string)($user['first_name'] ?? ''));
            $lastName = trim((string)($user['last_name'] ?? ''));
            $patronymic = trim((string)($personalData['middleName'] ?? ''));
            $fullName = trim(implode(' ', array_filter(
                [$lastName, $firstName, $patronymic], fn($v) => $v !== ''
            )));
            $citizenship = trim((string)($personalData['citizenship'] ?? $resumeData['citizenship'] ?? ''));
            $city = trim((string)($resumeData['city'] ?? ''));
            $desiredRole = trim((string)($resumeData['desiredPosition'] ?? ''));
            jt_respond(['data' => [
                'first_name' => $firstName !== '' ? $firstName : null,
                'last_name' => $lastName !== '' ? $lastName : null,
                'patronymic' => $patronymic !== '' ? $patronymic : null,
                'full_name' => $fullName !== '' ? $fullName : null,
                'phone' => $user['phone'] ?? null,
                'email' => $mailbox['address'] ?? null,
                'city' => $city !== '' ? $city : null,
                'citizenship' => $citizenship !== '' ? $citizenship : null,
                'desired_role' => $desiredRole !== '' ? $desiredRole : null,
            ]]); exit;
        }

        // Человек сам прошёл капчу и нажал «Отправить» в WebView. Условное
        // обновление (state = текущее, lease_owner пуст) не даёт затереть
        // заявку, которую в этот момент уже взял в работу воркер.
        case 'jupiterMarkManualSubmitted': {
            $uidArg = (string)($args[0] ?? '');
            $id = (string)($args[1] ?? '');
            $existing = sb_single('jm_jupiter_applications', [
                'id' => 'eq.' . $id, 'user_id' => 'eq.' . $uidArg,
            ], 'id,state,lease_owner');
            $allowedStates = ['action_required', 'failed', 'retryable_failed', 'ready_to_submit'];
            $canMark = $existing && empty($existing['lease_owner'])
                && in_array((string)($existing['state'] ?? ''), $allowedStates, true);
            if (!$canMark) {
                jt_respond(['error' => 'Эту заявку нельзя отметить отправленной'], 409); exit;
            }
            $now = now_iso();
            sb_update('jm_jupiter_applications', [
                'id' => 'eq.' . $id, 'user_id' => 'eq.' . $uidArg,
                'state' => 'eq.' . $existing['state'], 'lease_owner' => 'is.null',
            ], [
                'state' => 'submitted',
                'reason_code' => 'MANUAL_WEBVIEW',
                'submitted_at' => $now,
                'updated_at' => $now,
            ]);
            $data = sb_single('jm_jupiter_applications', [
                'id' => 'eq.' . $id, 'user_id' => 'eq.' . $uidArg,
            ]);
            if (!$data || $data['state'] !== 'submitted') {
                jt_respond(['error' => 'Эту заявку нельзя отметить отправленной'], 409); exit;
            }
            rt_touch('jm_jupiter_applications');
            break;
        }

        // Поставить вакансию в очередь. Повтор не ошибка: человек мог нажать
        // дважды, и правильный ответ — отдать ту же заявку, а не завести
        // вторую. От гонки двух запросов защищает уникальный индекс в базе,
        // а не эта проверка.
        case 'jupiterEnqueue': {
            $uidArg = (string)($args[0] ?? '');
            $url = trim((string)($args[1] ?? ''));
            $company = trim((string)($args[2] ?? ''));
            if ($url === '') { jt_respond(['error' => 'Нужен адрес вакансии'], 400); exit; }
            $canonical = jupiter_canonical_url($url);
            if ($canonical === '') {
                jt_respond(['error' => 'Адрес вакансии не похож на ссылку'], 400); exit;
            }
            $selectedResume = sb_single('jm_resume_files', [
                'user_id' => 'eq.' . $uidArg, 'selected' => 'eq.true',
            ], 'id,storage_path');
            if (empty($selectedResume['storage_path'])) {
                jt_respond(['error' => 'Сначала загрузите и выберите резюме PDF'], 409); exit;
            }
            if (jt_secret('JUPITER_MAIL_VERIFIED') !== '1') {
                jt_respond(['error' => 'Почта JobToo временно недоступна'], 503); exit;
            }
            $user = sb_single('jm_users', ['id' => 'eq.' . $uidArg], 'jupiter_live_enabled_at');
            $existing = sb_single('jm_jupiter_applications', [
                'user_id' => 'eq.' . $uidArg,
                'canonical_url' => 'eq.' . $canonical,
            ]);
            if ($existing) {
                // A second swipe after live mode was enabled is an explicit
                // authorization for this vacancy. Reuse the existing row
                // (the unique index still prevents duplicate employer
                // submissions), but do not leave an old dry-run row stuck
                // forever with submission_authorized_at = null.
                $canAuthorizeExisting = !empty($user['jupiter_live_enabled_at'])
                    && empty($existing['submission_authorized_at'])
                    && empty($existing['lease_owner'])
                    && in_array((string)($existing['state'] ?? ''), ['queued', 'ready_to_submit'], true);
                if ($canAuthorizeExisting) {
                    sb_update('jm_jupiter_applications', [
                        'id' => 'eq.' . (string)$existing['id'],
                        'user_id' => 'eq.' . $uidArg,
                        'submission_authorized_at' => 'is.null',
                        'lease_owner' => 'is.null',
                    ], [
                        'state' => 'queued',
                        'submission_authorized_at' => now_iso(),
                        'reason_code' => null,
                        'not_before' => null,
                        'updated_at' => now_iso(),
                    ]);
                    $existing = sb_single('jm_jupiter_applications', [
                        'id' => 'eq.' . (string)$existing['id'],
                        'user_id' => 'eq.' . $uidArg,
                    ]);
                }
                $data = $existing;
                break;
            }
            $row = [
                'id' => uid(),
                'user_id' => $uidArg,
                'vacancy_url' => mb_substr($url, 0, 2048),
                'canonical_url' => $canonical,
                'company' => $company !== '' ? mb_substr($company, 0, 200) : null,
                'state' => 'queued',
                'submission_authorized_at' => !empty($user['jupiter_live_enabled_at']) ? now_iso() : null,
                'created_at' => now_iso(),
                'updated_at' => now_iso(),
            ];
            // При одновременных нажатиях merge-duplicates перезаписал бы
            // состояние чужого воркера обратно в queued. Вставляем только
            // отсутствующую строку, а при конфликте читаем уже существующую.
            $inserted = sb('POST', 'jm_jupiter_applications',
                ['on_conflict' => 'user_id,canonical_url'], $row,
                ['Prefer: resolution=ignore-duplicates,return=representation']);
            if ($inserted) rt_touch('jm_jupiter_applications');
            $data = $inserted[0] ?? sb_single('jm_jupiter_applications', [
                'user_id' => 'eq.' . $uidArg,
                'canonical_url' => 'eq.' . $canonical,
            ]);
            if (!$data) throw new RuntimeException('Не удалось сохранить заявку Jupiter');
            break;
        }

        // История одного своего отклика для карточки (jm_jupiter_events пишет
        // триггер). Отклик проверяется на владельца: чужой id даст пустоту.
        case 'jupiterApplicationEvents': {
            $data = sb_select('jm_jupiter_events', [
                'user_id' => 'eq.' . (string)($args[0] ?? ''),
                'application_id' => 'eq.' . (string)($args[1] ?? ''),
                'limit' => '200',
            ], 'kind,reason_code,detail,created_at', 'created_at.asc');
            break;
        }

        case 'jupiterMyApplications': {
            $data = sb_select(
                'jm_jupiter_applications',
                ['user_id' => 'eq.' . (string)($args[0] ?? '')],
                'id,vacancy_url,company,state,reason_code,resume_token,'
                . 'external_application_id,created_at,updated_at,submitted_at,verified_at,'
                . 'submission_authorized_at,third_party_consent_at,third_party_terms_url',
                'created_at.desc'
            ); break;
        }

        // Воркер берёт задачу. Аренда, а не «пометил и забыл»: воркер может
        // умереть, и тогда задача должна вернуться, но не раньше срока —
        // иначе за неё возьмутся двое и работодатель получит два отклика.
        case 'jupiterLease': {
            $worker = trim((string)($args[0] ?? ''));
            $leaseSeconds = (int)($args[1] ?? 300);
            if ($worker === '') { jt_respond(['error' => 'Нужен идентификатор воркера'], 400); exit; }
            $leaseSeconds = max(30, min(3600, $leaseSeconds));
            $task = sb_rpc('jupiter_lease_task', [
                'p_worker' => $worker,
                'p_lease_seconds' => $leaseSeconds,
            ]);
            jt_respond($task ?: null); exit;
        }

        case 'jupiterHeartbeat': {
            $id = (string)($args[0] ?? '');
            $worker = (string)($args[1] ?? '');
            $leaseSeconds = max(30, min(3600, (int)($args[2] ?? 300)));
            $task = sb_single('jm_jupiter_applications', ['id' => 'eq.' . $id], 'lease_owner');
            // Продлить аренду может только тот, кто её держит. Иначе чужой
            // воркер способен вечно держать задачу за живым владельцем.
            if (!$task || (string)($task['lease_owner'] ?? '') !== $worker) {
                jt_respond(['error' => 'Lease is held by another worker'], 409); exit;
            }
            sb_update('jm_jupiter_applications', ['id' => 'eq.' . $id], [
                'heartbeat_at' => now_iso(),
                'lease_until' => gmdate('c', time() + $leaseSeconds),
                'updated_at' => now_iso(),
            ]);
            jt_respond(['ok' => true]); exit;
        }

        case 'jupiterSubmitGuard': {
            $id = (string)($args[0] ?? '');
            $worker = (string)($args[1] ?? '');
            $task = sb_single('jm_jupiter_applications', ['id' => 'eq.' . $id],
                'user_id,vacancy_url,lease_owner,lease_until,submission_authorized_at,state,'
                . 'third_party_consent_at,third_party_terms_url');
            $user = $task ? sb_single('jm_users', ['id' => 'eq.' . $task['user_id']],
                'jupiter_live_enabled_at,is_blocked') : null;
            $taskHost = $task
                ? strtolower((string)(parse_url((string)($task['vacancy_url'] ?? ''), PHP_URL_HOST) ?: ''))
                : '';
            $missingSberConsent = $taskHost === 'rabota.sber.ru'
                && (empty($task['third_party_consent_at'])
                    || (string)($task['third_party_terms_url'] ?? '') !== 'https://rabota.sber.ru/terms');
            $resume = $task ? sb_single('jm_resume_files', [
                'user_id' => 'eq.' . $task['user_id'], 'selected' => 'eq.true',
            ], 'storage_path') : null;
            $mailbox = $task ? ['address' => jt_jupiter_mailbox((string)$task['user_id'])] : null;
            if (!$task || !$user || $worker === ''
                || jt_secret('JUPITER_MAIL_VERIFIED') !== '1'
                || empty($resume['storage_path']) || empty($mailbox['address'])
                || (string)($task['lease_owner'] ?? '') !== $worker
                || (int)strtotime((string)($task['lease_until'] ?? '')) <= time()
                || empty($task['submission_authorized_at'])
                || $missingSberConsent
                || empty($user['jupiter_live_enabled_at']) || !empty($user['is_blocked'])
                || new DateTimeImmutable((string)$task['submission_authorized_at'])
                   < new DateTimeImmutable((string)$user['jupiter_live_enabled_at'])
                || in_array($task['state'], ['submitted', 'submission_unknown', 'duplicate', 'failed'], true)) {
                jt_respond(['error' => 'Submission is not authorized'], 409); exit;
            }
            jt_respond(['ok' => true]); exit;
        }

        case 'jupiterCheckpoint': {
            $id = (string)($args[0] ?? '');
            $worker = (string)($args[1] ?? '');
            $state = (string)($args[2] ?? '');
            $data = is_array($args[3] ?? null) ? $args[3] : [];
            $task = sb_single('jm_jupiter_applications', ['id' => 'eq.' . $id], 'lease_owner');
            if (!$task || (string)($task['lease_owner'] ?? '') !== $worker) {
                jt_respond(['error' => 'Lease is held by another worker'], 409); exit;
            }
            sb_update('jm_jupiter_applications', ['id' => 'eq.' . $id], [
                'state' => $state,
                'checkpoint' => json_encode($data),
                'heartbeat_at' => now_iso(),
                'lease_until' => gmdate('c', time() + max(30, min(3600, (int)($args[4] ?? 300)))),
                'updated_at' => now_iso(),
            ]);
            jt_respond(['ok' => true]); exit;
        }

        case 'jupiterFinish': {
            $id = (string)($args[0] ?? '');
            $worker = (string)($args[1] ?? '');
            $state = (string)($args[2] ?? '');
            $extra = is_array($args[3] ?? null) ? $args[3] : [];
            $allowed = [
                'queued', 'ready_to_submit', 'submitted', 'action_required',
                'submission_unknown', 'duplicate', 'retryable_failed', 'failed',
            ];
            if (!in_array($state, $allowed, true)) {
                jt_respond(['error' => 'Unknown state'], 400); exit;
            }
            $task = sb_single('jm_jupiter_applications', ['id' => 'eq.' . $id], 'lease_owner');
            if (!$task || (string)($task['lease_owner'] ?? '') !== $worker) {
                jt_respond(['error' => 'Lease is held by another worker'], 409); exit;
            }
            $patch = [
                'state' => $state,
                'lease_owner' => null,
                'lease_until' => null,
                'updated_at' => now_iso(),
            ];
            // Белый список полей: воркер не должен уметь переписать чужой
            // user_id или подменить адрес вакансии задним числом.
            foreach ([
                'reason_code', 'resume_token', 'receipt_key',
                'external_application_id', 'last_error', 'not_before',
                'checkpoint', 'attempt_count',
            ] as $key) {
                if (array_key_exists($key, $extra)) $patch[$key] = $extra[$key];
            }
            if ($state === 'submitted') $patch['submitted_at'] = now_iso();
            if ($state === 'submitted' && !empty($extra['verified'])) {
                $patch['verified_at'] = now_iso();
            }
            sb_update('jm_jupiter_applications', ['id' => 'eq.' . $id], $patch);
            jt_respond(['ok' => true]); exit;
        }

        case 'jupiterGetCandidateProfile': {
            $uid = (string)($args[0] ?? '');
            if ($uid === '') { jt_respond(['error' => 'Нужен user_id'], 400); exit; }
            $user = sb_single('jm_users', ['id' => 'eq.' . $uid],
                'id,first_name,last_name,age,phone,resume_data,resume_email,personal_data');
            if (!$user) { jt_respond(['error' => 'Пользователь не найден'], 404); exit; }
            $resume = sb_single('jm_resume_files', [
                'user_id' => 'eq.' . $uid,
                'selected' => 'eq.true',
            ], 'id,storage_path,resume_data,resume_email');
            if (!$resume || empty($resume['storage_path'])) {
                jt_respond(['error' => 'Сначала загрузите и выберите резюме PDF'], 409); exit;
            }
            $resumeUrl = null;
            if ($resume && !empty($resume['storage_path'])) {
                try { $resumeUrl = jt_resume_signed_url($resume['storage_path']); }
                catch (Throwable $e) { /* Недоступное PDF остановит отправку ниже. */ }
            }
            if (!$resumeUrl) {
                jt_respond(['error' => 'Выбранное резюме временно недоступно'], 503); exit;
            }
            $mailbox = ['address' => jt_jupiter_mailbox($uid)];
            if (jt_secret('JUPITER_MAIL_VERIFIED') !== '1' || empty($mailbox['address'])) {
                jt_respond(['error' => 'Почта JobToo временно недоступна'], 503); exit;
            }
            $personalData = null;
            if (!empty($user['personal_data'])) {
                $personalData = is_string($user['personal_data'])
                    ? json_decode($user['personal_data'], true)
                    : $user['personal_data'];
            }
            if (!is_array($personalData)) $personalData = [];
            $resumeData = null;
            if ($resume && !empty($resume['resume_data'])) {
                $resumeData = is_string($resume['resume_data'])
                    ? json_decode($resume['resume_data'], true)
                    : $resume['resume_data'];
            } elseif (!empty($user['resume_data'])) {
                $resumeData = is_string($user['resume_data'])
                    ? json_decode($user['resume_data'], true)
                    : $user['resume_data'];
            }
            $consentRow = sb_single('jm_consents', [
                'user_id' => 'eq.' . $uid,
                'source'  => 'not.like.crossborder:%',
            ], 'stamp,accepted_at');
            if ($consentRow && !empty($consentRow['stamp'])) {
                $personalData['consent'] = true;
            }
            jt_respond([
                'user_id' => $uid,
                'first_name' => $user['first_name'] ?? null,
                'last_name' => $user['last_name'] ?? null,
                'age' => $user['age'] ?? null,
                'phone' => $user['phone'] ?? null,
                'email' => $mailbox['address'],
                'personal_data' => $personalData,
                'resume_data' => $resumeData,
                'resume_url' => $resumeUrl,
            ]); exit;
        }

        case 'dbApplyPermVacancy': {
            [$vid, $wid, $eid, $sm] = [$args[0], $args[1], $args[2], $args[3] ?? null];
            $pv = sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vid], 'employer_id,title,company');
            if (!$pv) { jt_respond(['error' => 'Вакансия не найдена'], 404); exit; }
            $vacEmployer = (string)($pv['employer_id'] ?? '');
            if ($vacEmployer === '' || (string)$eid !== $vacEmployer) {
                jt_respond(['error' => 'Vacancy owner mismatch'], 403); exit;
            }
            // Ни запись, ни чат, ни уведомление ниже больше не используют
            // клиентский employerId как источник истины.
            $eid = $vacEmployer;
            sb_upsert('jm_perm_applications', [
                'id' => uid(), 'vacancy_id' => $vid, 'worker_id' => $wid,
                'employer_id' => $eid, 'status' => 'pending', 'created_at' => now_iso(),
            ], 'vacancy_id,worker_id');

            // Отклик на постоянную вакансию раньше уходил молча: строка в
            // таблице со статусом «ожидает», и всё. Работодатель видел имя в
            // списке и решал вслепую, а сказать о себе человеку было негде —
            // при том что именно на постоянные приходится большая часть
            // откликов. Теперь отклик открывает переписку, как и на сменах.
            if ($sm) {
                $data = chat_ensure($wid, $eid, (string)$vid,
                    (string)($pv['title'] ?? ''), (string)($pv['company'] ?? ''),
                    $sm, 0, 1, true);
            }

            // Директору — здесь же, а не с телефона соискателя. Раньше отклик
            // сохранялся, а сообщение слал клиент: старая версия или обрыв
            // связи — и о кандидате никто не узнавал.
            $w = sb_single('jm_users', ['id' => 'eq.' . $wid], 'first_name,last_name');
            $wName = trim(($w['first_name'] ?? '') . ' ' . ($w['last_name'] ?? '')) ?: 'Кандидат';
            $vTitle = (string)($pv['title'] ?? 'вакансию');
            notify_user((string)$eid, '📥 Новая заявка!',
                "{$wName} откликнулся на вакансию «{$vTitle}». Посмотрите кандидата!",
                'new_perm_applicant', [],
                "Есть отклик на вакансию «{$vTitle}». Посмотрите кандидата!");
            // И карточка с кнопками «Одобрить/Отклонить» — решение в один тап,
            // не открывая приложение.
            tg_new_application_card((string)$eid, (string)$wid, (string)$vid, $vTitle);
            break;
        }

        // Решение по отклику на постоянную вакансию.
        //
        // Было в одну строку: ни проверки, чей это отклик, ни следов решения.
        // Проверки не было вовсе — то есть любой вошедший мог одобрить или
        // отклонить чужого кандидата. А сказать соискателю о решении пытался
        // телефон директора, и получалось это плохо: см. jt_perm_app_announce.
        // Одобрение постоянного отклика: статус, чат и первое сообщение —
        // одна транзакция в БД. Два последовательных HTTP-запроса оставляли
        // status=approved без чата при обрыве между ними.
        // args: [applicationId, firstEmployerMessage]
        case 'dbApprovePermApplication': {
            $appId = trim((string)($args[0] ?? ''));
            $message = trim((string)($args[1] ?? ''));
            if ($appId === '' || $message === '') {
                jt_respond(['error' => 'Нужны отклик и сообщение'], 400); exit;
            }
            if (mb_strlen($message) > 4000) {
                jt_respond(['error' => 'Сообщение слишком длинное'], 400); exit;
            }

            $app = sb_single('jm_perm_applications', ['id' => 'eq.' . $appId]);
            if (!$app) { jt_respond(['error' => 'Отклик не найден'], 404); exit; }
            if ((string)($app['employer_id'] ?? '') !== (string)$authUid) {
                jt_respond(['error' => 'Это не ваш отклик'], 403); exit;
            }

            $rows = sb_rpc('jm_approve_perm_application', [
                'p_application_id' => $appId,
                'p_employer_id' => (string)$authUid,
                'p_chat_id' => uid(),
                'p_message' => $message,
            ]);
            $result = $rows[0] ?? null;
            if (!is_array($result) || empty($result['chat_id'])) {
                throw new RuntimeException('Не удалось создать чат одобрения');
            }

            // Уведомления не являются частью транзакции: внешний push/Telegram
            // не должен откатывать уже подтверждённое решение. При новом
            // одобрении сообщаем о решении, но системную строку в чат не пишем:
            // личное сообщение директора уже создано той же транзакцией.
            try {
                if (!empty($result['status_changed'])) {
                    jt_perm_app_announce($app, 'approved', false);
                }
                if (!empty($result['message_created'])) {
                    $chatRow = sb_single('jm_chats', ['id' => 'eq.' . (string)$result['chat_id']],
                        'id,worker_id,employer_id');
                    if ($chatRow) jt_notify_new_message($chatRow, (string)$authUid, $message);
                }
            } catch (Throwable $e) {
                // Основное действие уже атомарно завершено; сбой внешней
                // доставки не превращаем в ложное «одобрение не удалось».
            }

            $data = ['chat_id' => (string)$result['chat_id']];
            break;
        }

        case 'dbSetPermApplicationStatus': {
            $appId = (string)($args[0] ?? '');
            $status = (string)($args[1] ?? '');
            if (!in_array($status, ['approved', 'rejected', 'hired'], true)) {
                throw new Exception('неизвестный статус отклика');
            }
            $app = $appId !== '' ? sb_single('jm_perm_applications', ['id' => 'eq.' . $appId],
                'id,vacancy_id,worker_id,employer_id,status') : null;
            if (!$app) { jt_respond(['error' => 'Отклик не найден'], 404); exit; }
            if ((string)($app['employer_id'] ?? '') !== (string)$authUid) {
                jt_respond(['error' => 'Это не ваш отклик'], 403); exit;
            }
            $wasStatus = (string)($app['status'] ?? '');
            sb_update('jm_perm_applications', ['id' => 'eq.' . $appId], ['status' => $status]);
            // Повторное нажатие не шлёт второго уведомления.
            if ($wasStatus !== $status) jt_perm_app_announce($app, $status);
            break;
        }

        // ── Permanent saved ────────────────────────────────────────────────────
        case 'dbGetPermSaved': {
            $rows = sb_select('jm_perm_saved', ['user_id' => 'eq.' . $args[0]], 'vacancy_id');
            $data = array_map(fn($r) => $r['vacancy_id'], $rows); break;
        }

        // Как dbGetPermSaved, но с датой: по ней экран избранного группирует
        // вакансии по дням. Аргумент 0 — владелец списка, и он в $selfArgFns:
        // чужое избранное этой операцией не прочитать.
        case 'dbGetPermSavedDetailed': {
            $rows = sb_select('jm_perm_saved', ['user_id' => 'eq.' . $args[0]], 'vacancy_id,created_at');
            $data = array_map(fn($r) => [
                'vacancyId' => $r['vacancy_id'],
                'savedAt'   => $r['created_at'] ?? null,
            ], $rows);
            break;
        }

        case 'dbAddPermSaved':
            sb_upsert('jm_perm_saved', ['user_id' => $args[0], 'vacancy_id' => $args[1]]); break;

        case 'dbRemovePermSaved':
            sb_delete('jm_perm_saved', ['user_id' => 'eq.' . $args[0], 'vacancy_id' => 'eq.' . $args[1]]); break;

        // ── Ratings ────────────────────────────────────────────────────────────
        // Отзывы о человеке. КОЛОНКИ РАЗНЫЕ в зависимости от того, о ком
        // спрашивают, и это не перестраховка — так уже устроены сами экраны.
        //
        // На СВОЁМ профиле приложение показывает имя и аватар оценившего:
        // знать, кто и за какую смену тебя оценил, ты вправе.
        // На ЧУЖОМ рисуются только звёзды, роль, дата и текст — без автора.
        //
        // А сервер до сих пор отдавал '*' по любому id. То есть экран обещал
        // анонимность, а один запрос её снимал: смотришь профиль работодателя,
        // видишь «⭐2, Работник, 03.09» — и узнаёшь, какой именно работник это
        // написал. В складской среде, где к тому же работодателю возвращаются
        // за следующей сменой, это ровно та цена, из-за которой честный отзыв
        // перестают писать. like_id и vacancy_id выдают автора не хуже: по
        // своей же смене работодатель вычислит его и без имени.
        //
        // Приложение эти поля с чужого профиля не читает вовсе — проверено по
        // экранам, а не по названиям полей.
        case 'dbGetRatingsForUser': {
            $who = (string)($args[0] ?? '');
            $mine = $authUid !== null && $authUid !== '' && $who === $authUid;
            $cols = $mine ? '*' : 'id,rating,role,review_text,created_at';
            $data = sb_select('jm_ratings', ['to_user_id' => 'eq.' . $who], $cols, 'created_at.desc');
            break;
        }

        // ── Итог смены ─────────────────────────────────────────────────────────
        // Раньше здесь было двое ворот: «подтвердить» и «отменить». Отмена
        // означала и невыход, и предупредивший отказ, и отмену самим
        // работодателем — то есть ровно то, что нужно рейтингу, и терялось.
        // Старые колонки заполняем по-прежнему: по ним написан экран «Мэтчи».
        case 'dbSetShiftOutcome': {
            $lid = $args[0];
            $out = $args[1];
            $opts = $args[2] ?? [];
            $ok = ['worked', 'no_show', 'worker_cancelled', 'employer_cancelled', 'other_cancelled'];
            if (!in_array($out, $ok, true)) throw new Exception('неизвестный итог смены');
            jt_shift_party((string)$lid, $authUid, true);
            $worked = $out === 'worked';
            sb_update('jm_likes', ['id' => 'eq.' . $lid], [
                'outcome'      => $out,
                'late_minutes' => $worked ? (int)($opts['lateMinutes'] ?? 0) : null,
                'outcome_at'   => now_iso(),
                // Кто отметил — из подписанной сессии. Раньше сюда клался
                // $opts['by'] с клиента: человек мог подписать чужой отметкой
                // кого угодно.
                'outcome_by'   => $authUid,
                'employer_confirmed' => $worked,
                'worker_confirmed'   => $worked,
                'shift_completed'    => $worked,
                'cancelled'          => !$worked,
            ]);
            // Рейтинг работника меняется именно здесь: выход, невыход и
            // опоздание — это три четверти всего, из чего он складывается.
            jt_referral_on_outcome((string)$lid, $out, $authUid);
            $lk = sb_single('jm_likes', ['id' => 'eq.' . $lid], 'worker_id,employer_id');
            if (!empty($lk['worker_id'])) jt_recalc_score((string)$lk['worker_id']);
            // И работодателя: отмена смены — это его ось, а не работника.
            if (!empty($lk['employer_id'])) jt_recalc_employer_score((string)$lk['employer_id']);
            // Работник узнаёт об итоге отсюда же. Отметку, которая пойдёт ему
            // в рейтинг, он должен увидеть: если это ошибка, успеет написать в
            // поддержку, пока помнит, как всё было.
            try {
                jt_notify_shift_outcome((string)$lid, (string)$out);
            } catch (Throwable $e) { /* итог записан — это главное */ }
            $data = true; break;
        }

        // Старые имена — для приложений, до которых обновление ещё не дошло.
        //
        // Сервер выкладывается сразу, а установленное приложение обновляется
        // при следующем запуске, и между этими двумя моментами у человека на
        // телефоне живёт прежний код. Убери эти два случая — и у него просто
        // перестала бы работать кнопка «подтвердить смену», без единого
        // слова о причине.
        //
        // Причины у такой отметки нет и быть не может: старое приложение её
        // не спрашивало. Поэтому подтверждение пишем как выход с неизвестной
        // пунктуальностью, а отмену — как cancelled_legacy, то есть «отменено,
        // виноватого не знаем». Приписать сюда невыход значило бы испортить
        // человеку рейтинг за то, о чём его не спросили.
        case 'dbConfirmShift': {
            jt_shift_party((string)$args[0], $authUid, false);
            sb_update('jm_likes', ['id' => 'eq.' . $args[0]], [
                'outcome' => 'worked', 'late_minutes' => null, 'outcome_at' => now_iso(),
                'employer_confirmed' => true, 'worker_confirmed' => true,
                'shift_completed' => true, 'cancelled' => false,
            ]);
            jt_referral_on_outcome((string)$args[0], 'worked', $authUid);
            $lk = sb_single('jm_likes', ['id' => 'eq.' . $args[0]], 'worker_id,employer_id');
            if (!empty($lk['worker_id'])) jt_recalc_score((string)$lk['worker_id']);
            if (!empty($lk['employer_id'])) jt_recalc_employer_score((string)$lk['employer_id']);
            $data = ['bothConfirmed' => true]; break;
        }

        case 'dbCancelShift': {
            jt_shift_party((string)$args[0], $authUid, false);
            sb_update('jm_likes', ['id' => 'eq.' . $args[0]], [
                'outcome' => 'cancelled_legacy', 'outcome_at' => now_iso(),
                'cancelled' => true, 'shift_completed' => false,
            ]);
            $data = true; break;
        }

        // ── Rating + match cleanup ─────────────────────────────────────────────
        case 'dbSubmitRatingAndMaybeDelete': {
            $p = $args[0];
            ['likeId' => $lid, 'fromUserId' => $fuid, 'toUserId' => $tuid,
             'vacancyId' => $vid, 'rating' => $rat, 'role' => $rol] = $p;
            // Качество и скорость необязательны: кто не захотел отвечать,
            // ставит только звёзды, как было раньше. Ноль здесь не годится —
            // «не ответили» и «работал на ноль» это разные вещи, и пустое
            // поле должно остаться пустым.
            $ш = fn(string $к) => isset($p[$к]) && $p[$к] > 0 ? (float)$p[$к] : null;
            sb_insert('jm_ratings', [
                'id' => uid(), 'from_user_id' => $fuid, 'to_user_id' => $tuid,
                'vacancy_id' => $vid, 'like_id' => $lid, 'rating' => $rat,
                // Про работника — качество и скорость; про работодателя —
                // совпало ли с описанием, как относились, заплатили ли
                // вовремя. Лишние поля просто останутся пустыми.
                'quality' => $ш('quality'), 'speed' => $ш('speed'),
                'emp_matched_desc' => $ш('matchedDesc'),
                'emp_attitude'     => $ш('attitude'),
                'emp_paid_on_time' => $ш('paidOnTime'),
                'role' => $rol, 'review_text' => $p['reviewText'] ?? null, 'created_at' => now_iso(),
            ]);
            // Сигнал тому, кого оценили: у него открыт профиль — обновится сам.
            try { rt_broadcast('ratings:' . $tuid, 'refresh'); } catch (\Throwable $e) {}
            $rf = $rol === 'worker' ? 'worker_rated' : 'employer_rated';
            sb_update('jm_likes', ['id' => 'eq.' . $lid], [$rf => true]);
            $all = sb_select('jm_ratings', ['to_user_id' => 'eq.' . $tuid], 'rating');
            if (!empty($all)) {
                $avg = round(array_sum(array_column($all, 'rating')) / count($all), 2);
                sb_update('jm_users', ['id' => 'eq.' . $tuid], ['avg_rating' => $avg, 'rating_count' => count($all)]);
            }
            // Оценка работодателя — четверть рейтинга работника, плюс
            // качество и скорость. Работника оценивают в role='employer'.
            if ($rol === 'employer') jt_recalc_score($tuid);
            else jt_recalc_employer_score($tuid);
            $lr = sb_single('jm_likes', ['id' => 'eq.' . $lid], 'worker_rated,employer_rated');
            $data = ['bothRated' => !empty($lr['worker_rated']) && !empty($lr['employer_rated'])]; break;
        }

        // ── Телеграм: пост в общую группу ─────────────────────────────────────
        // Объявления для всех разом — в группу «ПОДРАБОТКИ», а не письмами
        // каждому. Адрес группы берётся из настроек сервера и не приходит
        // в запросе: APP_SECRET лежит в открытом коде, и с параметром-адресом
        // ботом можно было бы писать в любой чат.
        // Состояние группы: жив ли доступ и не сменился ли её номер.
        //
        // Понадобилось, когда объявления перестали приходить в «ПОДРАБОТКИ»,
        // а причину было нечем посмотреть: код публикации на месте, токен
        // рабочий, а сообщений нет. Классическая причина — группу повысили
        // до супергруппы, и её номер сменился; старый перестаёт отвечать.
        // Ничего не отправляет, только спрашивает.
        case 'tgGroupInfo': {
            if (TG_BOT_TOKEN === '') { $data = ['ok' => false, 'error' => 'нет токена']; break; }
            $ch = curl_init('https://api.telegram.org/bot' . TG_BOT_TOKEN . '/getChat?chat_id=' . TG_GROUP_CHAT_ID);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15]);
            $chat = json_decode((string)curl_exec($ch), true); curl_close($ch);

            $ch = curl_init('https://api.telegram.org/bot' . TG_BOT_TOKEN . '/getMe');
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15]);
            $me = json_decode((string)curl_exec($ch), true); curl_close($ch);
            $botId = (int)($me['result']['id'] ?? 0);

            $member = null;
            if ($botId) {
                $ch = curl_init('https://api.telegram.org/bot' . TG_BOT_TOKEN
                    . '/getChatMember?chat_id=' . TG_GROUP_CHAT_ID . '&user_id=' . $botId);
                curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15]);
                $member = json_decode((string)curl_exec($ch), true); curl_close($ch);
            }
            // Проверка возможности писать — без единого видимого сообщения.
            // sendChatAction требует тех же прав, что и отправка, но в чате
            // после него ничего не остаётся. Точный текст отказа от телеграма
            // ценнее любых догадок о правах.
            $ch = curl_init('https://api.telegram.org/bot' . TG_BOT_TOKEN . '/sendChatAction');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 15,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_POSTFIELDS => json_encode(['chat_id' => TG_GROUP_CHAT_ID, 'action' => 'typing']),
            ]);
            $can = json_decode((string)curl_exec($ch), true); curl_close($ch);

            $data = ['chat_id' => TG_GROUP_CHAT_ID, 'chat' => $chat,
                     'бот_в_группе' => $member, 'может_писать' => $can];
            break;
        }

        case 'tgPostToGroup': {
            if (TG_BOT_TOKEN === '') { $data = ['ok' => false, 'error' => 'TG_BOT_TOKEN не задан на сервере']; break; }
            if (TG_GROUP_CHAT_ID === 0) { $data = ['ok' => false, 'error' => 'Группа не настроена']; break; }
            $text = trim((string)($args[0] ?? ''));
            if ($text === '') { $data = ['ok' => false, 'error' => 'Пустой текст']; break; }
            $data = ['sent' => tg_send_message(TG_GROUP_CHAT_ID, $text, true), 'chat' => TG_GROUP_CHAT_ID];
            break;
        }

        // ── Телеграм: переустановка вебхука ───────────────────────────────────
        // Нужна после смены токена бота. Токен при этом никуда не передаётся —
        // сервер берёт его сам из app_secrets.php.
        //
        // Адрес зашит здесь намеренно и не берётся из запроса: APP_SECRET лежит
        // в открытом коде, и с параметром-адресом любой желающий увёл бы
        // вебхук на себя вместе со всеми сообщениями людей.
        case 'tgSetWebhook': {
            $token = TG_BOT_TOKEN;
            if ($token === '') { $data = ['ok' => false, 'error' => 'TG_BOT_TOKEN не задан на сервере']; break; }
            // Не через дашборд: вебхук идёт прямо в обработчик, на имя без
            // A-записи. Пересылка была крюком вокруг сломанного IPv4, и
            // возвращать её этой кнопкой было бы шагом назад.
            $url = 'https://tg.jobtoo.ru/api/tg.php';
            $ch = curl_init('https://api.telegram.org/bot' . $token . '/setWebhook');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_TIMEOUT => 15,
                CURLOPT_POSTFIELDS => json_encode([
                    'url' => $url,
                    'secret_token' => jt_secret('APP_SECRET'),
                    'allowed_updates' => ['message', 'callback_query'],
                    'drop_pending_updates' => false,
                ]),
            ]);
            $resp = curl_exec($ch); curl_close($ch);
            $data = ['target' => $url, 'telegram' => json_decode($resp ?: 'null', true)];
            break;
        }

        // ── Телеграм: что сейчас с вебхуком ───────────────────────────────────
        case 'tgWebhookInfo': {
            $token = TG_BOT_TOKEN;
            if ($token === '') { $data = ['ok' => false, 'error' => 'TG_BOT_TOKEN не задан на сервере']; break; }
            $ch = curl_init('https://api.telegram.org/bot' . $token . '/getWebhookInfo');
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15]);
            $resp = curl_exec($ch); curl_close($ch);
            $data = json_decode($resp ?: 'null', true);
            break;
        }

        // ── Push tokens ────────────────────────────────────────────────────────
        // Токен принадлежит устройству, а не человеку. Если на телефоне сменили
        // аккаунт, тот же токен остался бы записан и за прежним — и уведомления
        // для обоих приходили бы на один телефон. Поэтому сначала снимаем его
        // со всех остальных.
        case 'dbSavePushToken': {
            $uid = (string)($args[0] ?? '');
            $plainToken = trim((string)($args[1] ?? ''));
            if ($plainToken === '') {
                $data = ['error' => 'Пустой push-токен']; break;
            }

            // Один provider token может принадлежать только одному текущему
            // аккаунту. Ищем и legacy plaintext, и новый keyed fingerprint.
            sb_update('jm_users',
                ['push_token' => 'eq.' . $plainToken, 'id' => 'neq.' . $uid],
                ['push_token' => null]);
            sb_update('jm_users',
                ['push_token' => 'like.' . jt_push_lookup_pattern($plainToken), 'id' => 'neq.' . $uid],
                ['push_token' => null]);

            sb_update('jm_users', ['id' => 'eq.' . $uid],
                ['push_token' => jt_push_encrypt($plainToken)]);
            $data = ['ok' => true];
            break;
        }

        // Выход из аккаунта. Без этого сервер продолжал слать уведомления на
        // телефон, с которого человек вышел: приложение он не удалял, а токен
        // так и лежал в его строке.
        case 'dbClearPushToken':
            sb_update('jm_users', ['id' => 'eq.' . $args[0]], ['push_token' => null]); break;

        // Разбор завалов: те, кто вышел до появления dbClearPushToken, так и
        // остались с токеном в базе, а войти и почиститься не могут — они же
        // вышли. Здесь ищем по самому токену, аккаунт знать не нужно.
        // Отвязывают токен, когда он достался другому человеку на том же
        // телефоне. Чужой токен отвязывать незачем ни при каком раскладе, а
        // проверки не было: зная токен (его отдавала dbGetPushToken любому),
        // можно было лишить человека уведомлений.
        case 'dbReleasePushToken': {
            $plainToken = trim((string)($args[0] ?? ''));
            $uid = (string)($authUid ?? '');
            if ($plainToken !== '' && $uid !== '') {
                sb_update('jm_users',
                    ['push_token' => 'eq.' . $plainToken, 'id' => 'eq.' . $uid],
                    ['push_token' => null]);
                sb_update('jm_users',
                    ['push_token' => 'like.' . jt_push_lookup_pattern($plainToken), 'id' => 'eq.' . $uid],
                    ['push_token' => null]);
            }
            break;
        }

        case 'dbGetPushToken': {
            $r = sb_single('jm_users', ['id' => 'eq.' . $args[0]], 'push_token');
            $stored = (string)($r['push_token'] ?? '');
            $plain = $stored !== '' ? jt_push_decrypt($stored) : '';
            $data = $plain !== '' ? 'push:' . jt_push_fingerprint($plain) : null;
            break;
        }

        case 'dbGetWorkerTokensByMetro':
            $data = sb_select('jm_users', [
                'role' => 'eq.worker',
                'metro_station' => 'eq.' . $args[0],
                'push_token' => 'not.is.null',
            ], 'id,push_token'); break;

        // ── Web push subscriptions ─────────────────────────────────────────────
        case 'dbGetWebPushSubscription': {
            $r = sb_single('jm_web_push_subscriptions', ['user_id' => 'eq.' . $args[0]], 'endpoint,p256dh,auth');
            $data = ($r && isset($r['endpoint'])) ? $r : null; break;
        }

        case 'dbSaveWebPushSubscription':
            sb_upsert('jm_web_push_subscriptions', [
                'user_id'    => $args[0],
                'endpoint'   => $args[1],
                'p256dh'     => $args[2],
                'auth'       => $args[3],
                'updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
            ], 'user_id'); break;

        // Выход из аккаунта в браузере — то же, что снятие токена на телефоне.
        case 'dbDeleteWebPushSubscription':
            sb_delete('jm_web_push_subscriptions', ['user_id' => 'eq.' . $args[0]]); break;

        // ── Push notifications ─────────────────────────────────────────────────
        case 'sendPushNotification': {
            [$to, $title, $nbody, $nd] = [$args[0], $args[1], $args[2], $args[3] ?? []];
            $tokens = is_array($to) ? $to : [$to];
            $msgs = array_map(fn($t) => [
                'to' => $t, 'title' => $title, 'body' => $nbody,
                'sound' => 'default', 'priority' => 'high',
                'channelId' => $nd['channelId'] ?? 'default', 'data' => $nd,
            ], $tokens);
            expo_push($msgs);
            $data = ['ok' => true, 'queued' => count($msgs)];
            break;
        }

        // args: [pushTitle, pushBody, tgHtml, dataType, groupHtml?, vacancyId?]
        // push + Telegram + bell + web push to ALL workers, plus a post in the group.
        // vacancyId (перм. вакансии) делает кнопку дип-линком на конкретную вакансию.
        case 'dbNotifyAllWorkersNewVacancy': {
            // Не дать хостингу убить скрипт до конца рассылки
            @set_time_limit(300);
            @ignore_user_abort(true);

            $vacancyId = (string)($args[5] ?? '');
            $dataType = (string)($args[3] ?? 'nearby_shift');
            $deepKind = $dataType === 'nearby_perm' ? 'perm' : 'shift';

            // Объявляет вакансию ТОЛЬКО тот, кто её разместил.
            //
            // Вход здесь требовался, а чья вакансия — не проверялось, и текст
            // объявления приходил с клиента готовой разметкой. То есть любой
            // зарегистрированный человек мог отправить в открытую группу
            // «ПОДРАБОТКИ» и пушем каждому работнику произвольный текст со
            // своей ссылкой. Для сервиса, где люди ищут работу, это готовая
            // площадка для обмана.
            //
            // Заодно уходит дублирование формата (задача 16): текст для группы
            // сервер собирает сам из строки вакансии тем же jt_group_html, что
            // и догоняющее задание. Клиентскую разметку для группы больше не
            // берём — второго вида объявления в одной группе не будет.
            $vacancyRow = null;
            if ($vacancyId !== '') {
                $vacancyRow = sb_single(
                    $deepKind === 'perm' ? 'jm_perm_vacancies' : 'jm_vacancies',
                    ['id' => 'eq.' . $vacancyId],
                    $deepKind === 'perm'
                        ? 'id,employer_id,title,company,metro_station,salary,schedule'
                        : 'id,employer_id,title,company,metro_station,salary,date,time_start,time_end'
                );
            }
            if ($vacancyRow === null) {
                // Без вакансии подтвердить право нечем. Отказ не теряет
                // объявление: раз в час jt_announce_missed сам догоняет
                // свежие вакансии без отметки о доставке.
                jt_respond(['error' => 'Вакансия не найдена'], 404); exit;
            }
            if ((string)($vacancyRow['employer_id'] ?? '') !== (string)$authUid) {
                jt_respond(['error' => 'Это не ваша вакансия'], 403); exit;
            }

            // Идемпотентность по вакансии. Рассылка — отдельный вызов с клиента,
            // и при обрыве сети он молча терялся: вакансия в ленте есть, а
            // объявление в группе «ПОДРАБОТКИ» не пришло. Теперь клиент вправе
            // повторить вызов, но повтор НЕ должен разослать пуши всем повторно
            // и запостить в группу дважды. Поэтому «столбим» вакансию заранее:
            // если по ней уже начинали рассылку — сразу выходим. Отметку ставим
            // ДО работы (claim), чтобы гонка повторов не дала дублей.
            //
            // ВАЖНО: отметки ДВЕ, по одной на каждый вид доставки.
            //
            // Была одна на всё, и ставилась она ДО отправки. Из-за этого сбой
            // при отправке в группу означал, что вакансия помечена разосланной
            // навсегда: повтор с клиента получал already_sent и выходил, а в
            // группе так ничего и не появлялось. Именно так вакансия могла
            // висеть в ленте сутки без единого сообщения.
            //
            // Личные сообщения по-прежнему столбим ЗАРАНЕЕ: повторная рассылка
            // всем работникам хуже неотправленной. А пост в группу — операция
            // одна и быстрая, и его отметку ставим только ПОСЛЕ успеха, чтобы
            // повтор мог доделать то, что не вышло.
            $dmAlreadySent = false;
            $groupAlreadySent = false;
            if ($vacancyId !== '') {
                $dmAlreadySent = sb_single('jm_settings', ['key' => 'eq.bcast:' . $vacancyId], 'key') !== null;
                $groupAlreadySent = sb_single('jm_settings', ['key' => 'eq.gpost:' . $vacancyId], 'key') !== null;
                if ($dmAlreadySent && $groupAlreadySent) {
                    $data = ['ok' => true, 'skipped' => 'already_sent'];
                    break;
                }
                if (!$dmAlreadySent) {
                    sb_upsert('jm_settings', [
                        'key' => 'bcast:' . $vacancyId,
                        'value' => now_iso(),
                        'updated_at' => now_iso(),
                    ], 'key');
                }
            }
            $dmCampaign = bin2hex(random_bytes(8));
            $groupCampaign = bin2hex(random_bytes(8));
            $btnUrl = $vacancyId !== ''
                ? 'https://t.me/JobToo_bot/app?startapp=' . $deepKind . '_' . $vacancyId . '_' . $dmCampaign
                : true;
            $groupBtnUrl = $vacancyId !== ''
                ? 'https://t.me/JobToo_bot/app?startapp=' . $deepKind . '_' . $vacancyId . '_' . $groupCampaign
                : true;

            // Пост в группу — ПЕРВЫМ (одна быстрая операция): длинные циклы
            // рассылки ниже могут упереться в лимит времени PHP
            // Текст собирает сервер из строки вакансии — один формат на оба
            // пути, клиентский args[4] больше не участвует. Заодно снимается
            // разнобой между версиями приложения: раньше старый клиент слал
            // один вид поста, новый — другой.
            $groupHtml = jt_group_html($vacancyRow, $deepKind);
            $groupOk = false;
            if ($groupAlreadySent) {
                $groupOk = true;
            } elseif ($groupHtml !== '' && TG_GROUP_CHAT_ID !== 0) {
                $groupOk = tg_send_message(TG_GROUP_CHAT_ID, $groupHtml, $groupBtnUrl);
                // Отметку ставим только после успеха: см. выше.
                if ($groupOk && $vacancyId !== '') {
                    sb_upsert('jm_settings', [
                        'key' => 'gpost:' . $vacancyId,
                        'value' => now_iso(),
                        'updated_at' => now_iso(),
                    ], 'key');
                }
            }
            // Итог публикации сохраняем: иначе он теряется, а следующий раз
            // выяснять причину снова будет нечем.
            try {
                sb_upsert('jm_settings', [
                    'key' => 'last_group_post',
                    'value' => json_encode([
                        'ok' => $groupOk,
                        'когда' => now_iso(),
                        'длина_текста' => strlen($groupHtml),
                        'кнопка' => is_string($groupBtnUrl) ? $groupBtnUrl : 'по умолчанию',
                        'отказ' => $GLOBALS['jt_last_tg_error'] ?? null,
                    ], JSON_UNESCAPED_UNICODE),
                    'updated_at' => now_iso(),
                ], 'key');
            } catch (Throwable $e) { /* запись отчёта не должна ломать рассылку */ }

            // Фиксируем факт публикации отдельно от открытий. Никаких данных
            // Telegram-пользователя в этой строке нет.
            if ($vacancyId !== '') {
                if ($groupOk) {
                    try {
                        sb('POST', 'jm_guest_events', [], [
                            'id' => uid(),
                            'anon_id' => 'campaign:' . $groupCampaign,
                            'event_type' => 'campaign_published',
                            'vacancy_id' => $vacancyId,
                            'vacancy_kind' => $deepKind === 'perm' ? 'permanent' : 'shift',
                            'platform' => 'web',
                            'campaign_id' => $groupCampaign,
                            'channel' => 'telegram_group',
                            'occurred_at' => now_iso(),
                        ], ['Prefer: return=minimal']);
                    } catch (Throwable $e) { /* аналитика не блокирует рассылку */ }
                }
            }

            // Старые клиенты не передают тип работы: для пользователей без
            // выбранного фильтра поведение всё равно остаётся прежним.
            $vacancyMetro = (string)($args[6] ?? '');
            $vacancyWorkType = (string)($args[7] ?? '');
            $data = $dmAlreadySent
                ? ['ok' => true, 'skipped' => 'dm_already_sent']
                : notify_workers((string)$args[0], (string)$args[1], (string)$args[2],
                                 (string)($args[3] ?? 'nearby_shift'), $btnUrl,
                                 $vacancyMetro, $vacancyWorkType);
            $data['group'] = $groupOk;

            // DM-публикация существует только если Telegram действительно
            // доставил хотя бы одно сообщение. Так отчёт не завышает охват.
            if ($vacancyId !== '' && ($data['telegram'] ?? 0) > 0) {
                try {
                    sb('POST', 'jm_guest_events', [], [
                        'id' => uid(),
                        'anon_id' => 'campaign:' . $dmCampaign,
                        'event_type' => 'campaign_published',
                        'vacancy_id' => $vacancyId,
                        'vacancy_kind' => $deepKind === 'perm' ? 'permanent' : 'shift',
                        'platform' => 'web',
                        'campaign_id' => $dmCampaign,
                        'channel' => 'telegram_dm',
                        'occurred_at' => now_iso(),
                    ], ['Prefer: return=minimal']);
                } catch (Throwable $e) { /* аналитика не блокирует рассылку */ }
            }
            break;
        }

        case 'addressSuggest': {
            $text = trim((string)($args[0] ?? ''));
            $data = mb_strlen($text) >= 3 ? geo_search($text . ', Москва') : [];
            break;
        }

        case 'dbSaveNotification': {
            // type/payload нужны, чтобы по нажатию на уведомление открылся
            // нужный экран. Колонок может ещё не быть — тогда сохраняем как
            // раньше, только заголовок и текст.
            $row = ['user_id' => $args[0], 'title' => $args[1], 'body' => $args[2]];
            $type = $args[3] ?? null;
            $payload = $args[4] ?? null;
            if ($type) $row['type'] = $type;
            if ($payload) $row['payload'] = json_encode($payload, JSON_UNESCAPED_UNICODE);
            try {
                sb_insert('jm_notifications', $row);
            } catch (\Throwable $e) {
                if (stripos($e->getMessage(), 'type') !== false || stripos($e->getMessage(), 'payload') !== false) {
                    unset($row['type'], $row['payload']);
                    sb_insert('jm_notifications', $row);
                } else {
                    throw $e;
                }
            }
            break;
        }

        case 'dbGetNotifications':
            $data = sb_select('jm_notifications', ['user_id' => 'eq.' . $args[0]], '*', 'created_at.desc'); break;

        // Своё и только своё. Прежде обе операции брали id уведомления и не
        // смотрели, чьё оно: чужое можно было пометить прочитанным или стереть.
        case 'dbMarkNotifRead':
            sb_update('jm_notifications',
                ['id' => 'eq.' . $args[0], 'user_id' => 'eq.' . (string)($authUid ?? '')],
                ['is_read' => true]); break;

        case 'dbMarkAllNotifsRead':
            sb_update('jm_notifications', ['user_id' => 'eq.' . $args[0]], ['is_read' => true]); break;

        case 'dbDeleteNotif':
            sb_delete('jm_notifications',
                ['id' => 'eq.' . $args[0], 'user_id' => 'eq.' . (string)($authUid ?? '')]); break;

        case 'dbDeleteAllNotifs':
            sb_delete('jm_notifications', ['user_id' => 'eq.' . $args[0]]); break;

        // Смены: автозакрытие в момент ОКОНЧАНИЯ смены (директора добирают людей
        // и в уже идущую смену). Ночные смены (конец меньше начала) заканчиваются
        // на следующий день. Без времени окончания — закрываем в конце дня смены.
        case 'dbAutoClosePastVacancies': {
            $today = date('Y-m-d');
            $yesterday = date('Y-m-d', time() - 86400);
            $now = time();
            $rows = sb_select('jm_vacancies', ['status' => 'eq.open', 'date' => 'lte.' . $today], 'id,date,time_start,time_end');
            $toClose = array_filter($rows, function($v) use ($now, $yesterday) {
                $d = $v['date'] ?? '';
                if ($d === '') return false;
                $ts = $v['time_start'] ?? '';
                $te = $v['time_end'] ?? '';
                if ($te !== '') {
                    $end = strtotime($d . ' ' . $te . ':00');
                    if ($end === false) return $d < $yesterday;
                    if ($ts !== '' && $te <= $ts) $end += 86400; // смена через полночь
                    return $end <= $now;
                }
                $eod = strtotime($d . ' 23:59:59');
                return $eod !== false && $eod <= $now;
            });
            foreach ($toClose as $row) {
                sb_update('jm_vacancies', ['id' => 'eq.' . $row['id']], ['status' => 'closed']);
            }
            $data = count($toClose);
            if ($data > 0) sm_cache_invalidate();
            break;
        }

        case 'dbGetAllWorkerTokens':
            $data = sb_select('jm_users', ['role' => 'eq.worker', 'push_token' => 'not.is.null'], 'id,push_token'); break;

        default:
            throw new RuntimeException('Unknown function: ' . $fn);
    }

    jt_respond(['data' => $data]);
} catch (Throwable $e) {
    jt_respond(['error' => $e->getMessage()], 500);
}
