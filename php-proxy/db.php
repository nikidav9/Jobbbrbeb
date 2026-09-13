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
require_once __DIR__ . '/partner_billing.php';
require_once __DIR__ . '/superjob_oauth_lib.php';
require_once __DIR__ . '/ext_health.php';
require_once __DIR__ . '/referral.php';

/** Отдать ответ, отбросив всё, что случайно напечаталось до него. */
function jt_respond(array $payload, int $code = 200): void {
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
    'tgBroadcast', 'tgSendToUsers', 'surveyDormantSend', 'surveyResults',
    'scoreRecalcAll', 'billingReport',
    'extSourcesList', 'extSourceSave', 'extSourceDelete', 'extStats',
    'partnerTariffsList', 'partnerTariffSave', 'partnerBillableEventRecord',
    'partnerReconciliationRecord', 'partnerBillingReport', 'partnerReportSnapshotSave',
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
        $acct = sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked,sessions_valid_from');
    } catch (\Throwable $e) {
        try { $acct = sb_single('jm_users', ['id' => 'eq.' . $authUid], 'id,is_blocked'); }
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
    'extVacancies', 'extVacancyCount', 'extSourceOptions', 'extClick', 'addressSuggest', 'dbLogOpen', 'guestEvent',
    'dbResponsivenessMap',
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
    'tgBindTelegram' => 0, 'tgUnbindTelegram' => 0,
    'dbGetSkillResults' => 0, 'dbSubmitSkillTest' => 0,
    'supportHistory' => 0, 'supportSend' => 0,
    'dbGetLikesForUser' => 0, 'dbGetChats' => 0,
    'dbGetMyReferral' => 0,
    'dbGetSaved' => 0, 'dbAddSaved' => 0, 'dbRemoveSaved' => 0,
    'dbGetPermVacanciesByEmployer' => 0, 'dbGetPermApplications' => 0,
    'dbGetPermSaved' => 0, 'dbAddPermSaved' => 0, 'dbRemovePermSaved' => 0,
    'dbSavePushToken' => 0, 'dbClearPushToken' => 0,
    'dbGetWebPushSubscription' => 0, 'dbSaveWebPushSubscription' => 0,
    'dbDeleteWebPushSubscription' => 0, 'dbGetNotifications' => 0,
    'dbMarkAllNotifsRead' => 0, 'dbDeleteAllNotifs' => 0,
    'dbRecordVacancyView' => 1, 'dbRecordPermVacancyView' => 1,
    'dbGetLikeByVacancyWorker' => 1, 'dbRemoveLike' => 1,
    'dbCheckAndCreateMatch' => 1, 'dbApplyPermVacancy' => 1,
];
if (isset($selfArgFns[$fn])) {
    $pos = $selfArgFns[$fn];
    if ($authUid === null || (string)($args[$pos] ?? '') !== $authUid) {
        jt_respond(['error' => 'Forbidden for this user'], 403); exit;
    }
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
}
if ($fn === 'dbCreateChat') {
    $workerId = (string)($args[0] ?? '');
    $employerId = (string)($args[1] ?? '');
    if ($authUid !== $workerId && $authUid !== $employerId) {
        jt_respond(['error' => 'Chat access denied'], 403); exit;
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
    'avatar_url', 'avg_rating', 'rating_count', 'is_blocked',
    'created_at', 'last_seen_at',
]));

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

function sb_rpc(string $fn, array $params = []): mixed {
    $url = SB_URL . '/rest/v1/rpc/' . $fn;
    $hdrs = ['apikey: ' . SB_KEY, 'Authorization: Bearer ' . SB_KEY, 'Content-Type: application/json'];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_HTTPHEADER => $hdrs, CURLOPT_TIMEOUT => 10, CURLOPT_SSL_VERIFYPEER => true]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($params));
    $resp = curl_exec($ch); curl_close($ch);
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
 * Sends a message to a Telegram user via Bot API. Never throws.
 * $withAppButton: true — кнопка на главную мини-аппа; string — свой URL кнопки.
 */
function tg_send_message(int $chatId, string $text, bool|string $withAppButton = false, string $btnText = '🚀 Откликнуться в JobToo', ?array $keyboard = null, ?int $messageThreadId = null): bool {
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
 * ВАЖНО про содержимое. Это единственное место, откуда данные уходят на
 * exp.host, то есть в США, а США нет в перечне государств с адекватной
 * защитой прав субъектов персональных данных (приказ РКН № 128 от
 * 05.08.2022). Значит, в title и body не должно быть ни имён, ни телефонов,
 * ни текста переписки — ничего, что относится к конкретному человеку.
 *
 * Названия смен и вакансий, компании и числа — можно: это не персональные
 * данные, а без них уведомление перестаёт что-либо значить.
 *
 * Полный текст с именем при этом никуда не девается: он идёт в колокольчик
 * (наша база в Москве) и в телеграм. Развилка — в notify_user(), параметр
 * $pushBody.
 */
function expo_push(array $messages): void {
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
            $emp = sb_single('jm_users', ['id' => 'eq.' . $employerId], 'telegram_id');
            if (!$emp || empty($emp['telegram_id'])) return false;

            $app = sb_single('jm_perm_applications', [
                'vacancy_id' => 'eq.' . $vacancyId,
                'worker_id'  => 'eq.' . $workerId,
                'order'      => 'created_at.desc',
            ], 'id');
            if (!$app) return false;

            $w = sb_single('jm_users', ['id' => 'eq.' . $workerId], 'first_name,last_name,age,metro_station,phone,avg_rating,rating_count');
            $name = trim(($w['first_name'] ?? '') . ' ' . ($w['last_name'] ?? '')) ?: 'Кандидат';
            $lines = ["📥 <b>Новая заявка на «{$vTitle}»</b>", ''];
            $lines[] = '👤 ' . $name . (!empty($w['age']) ? ", {$w['age']} лет" : '');
            if (!empty($w['metro_station'])) $lines[] = '🚇 м. ' . $w['metro_station'];
            if (!empty($w['avg_rating']) && (float)$w['avg_rating'] > 0) {
                $lines[] = '⭐ Рейтинг ' . $w['avg_rating'] . (!empty($w['rating_count']) ? " ({$w['rating_count']} оценок)" : '');
            }
            if (!empty($w['phone'])) $lines[] = '📞 +' . ltrim($w['phone'], '+');
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
function notify_user(string $userId, string $title, string $body, string $type = '',
                     array $data = [], ?string $pushBody = null): void {
    if ($userId === '') return;

    $since = gmdate('Y-m-d\TH:i:s\Z', time() - 60);
    $dup = sb_select('jm_notifications', [
        'user_id'    => 'eq.' . $userId,
        'title'      => 'eq.' . $title,
        'created_at' => 'gte.' . $since,
    ], 'id');
    if ($dup) return;

    $row = ['user_id' => $userId, 'title' => $title, 'body' => $body];
    if ($type !== '') $row['type'] = $type;
    try {
        sb_insert('jm_notifications', $row);
    } catch (Throwable $e) {
        // Колонки type может не быть — пишем без неё, колокольчик важнее.
        sb_insert('jm_notifications', ['user_id' => $userId, 'title' => $title, 'body' => $body]);
    }

    $u = sb_single('jm_users', ['id' => 'eq.' . $userId], 'telegram_id,push_token');
    if (!$u) return;
    if (!empty($u['telegram_id'])) {
        tg_send_message((int)$u['telegram_id'],
            '<b>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . "</b>\n\n"
            . htmlspecialchars($body, ENT_QUOTES, 'UTF-8'), true, '🚀 Открыть JobToo');
    }
    if (!empty($u['push_token'])) {
        expo_push([[
            'to' => $u['push_token'], 'title' => $title, 'body' => $pushBody ?? $body,
            'sound' => 'default', 'priority' => 'high', 'channelId' => 'matches',
            'data' => array_merge(['type' => $type], $data),
        ]]);
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

    $pushMsgs = []; $tgOk = 0; $mute = 0; $capped = 0; $filtered = 0; $webIds = [];
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
            'muted' => $mute, 'filtered' => $filtered, 'capped' => $capped, 'bell' => count($bell)];
}

/**
 * Push в браузер тем, у кого нет ни телеграма, ни приложения.
 *
 * Уходит через дашборд: ключи подписи (VAPID) лежат там, и держать их вторым
 * экземпляром здесь — лишний способ их потерять.
 */
function web_push_to(array $userIds, string $title, string $body, string $dataType): int {
    if (empty($userIds)) return 0;
    $ok = 0;
    try {
        $subs = sb_select('jm_web_push_subscriptions', [], 'user_id,endpoint,p256dh,auth');
        $appSecret = jt_secret('APP_SECRET');
        foreach ($subs as $s) {
            if (!isset($userIds[$s['user_id']]) || empty($s['endpoint'])) continue;
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
function jt_shift_party(string $likeId, ?string $authUid, bool $employerOnly): array
{
    $like = sb_single('jm_likes', ['id' => 'eq.' . $likeId], 'id,worker_id,employer_id');
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

        $existing = sb_single('jm_referral_rewards', ['invitee_id' => 'eq.' . $workerId], 'id');
        $verdict = ref_should_award($outcome, $invitedBy, $workerId, $existing !== null, $employerId);
        if (!$verdict['ok']) return;

        // Размер вознаграждения не зашит в код: его назначает владелец, и
        // менять его правкой исходника было бы неудобно и опасно. Пока не
        // назначен — запись всё равно заводится со статусом pending, чтобы
        // потом было по чему платить: событие произошло, и потерять его
        // нельзя, даже если цена ещё не решена.
        sb_insert('jm_referral_rewards', [
            'id' => uid(),
            'inviter_id' => $invitedBy,
            'invitee_id' => $workerId,
            'like_id' => $likeId,
            'status' => 'pending',
            'qualified_at' => now_iso(),
        ]);
    } catch (Throwable $e) {
        // См. выше: итог смены важнее начисления.
    }
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
            // Размер вознаграждения — в настройках, а не в коде: его назначает
            // владелец, и менять его правкой исходника с выкладкой было бы
            // неудобно и опасно. Не назначен — экран просто не называет сумму,
            // а не выдумывает её и не обещает пустое.
            $rewardRow = sb_single('jm_settings', ['key' => 'eq.referral_reward_rub'], 'value');
            $reward = (int)($rewardRow['value'] ?? 0);

            $data = [
                'code' => $code,
                // Сколько позвал и за скольких начислено. Разница между этими
                // числами — те, кто зарегистрировался, но ещё не вышел на
                // смену: платим за выход, а не за регистрацию.
                'invited' => sb_count('jm_users', ['invited_by' => 'eq.' . $me]),
                'rewarded' => sb_count('jm_referral_rewards', ['inviter_id' => 'eq.' . $me]),
                'rewardRub' => $reward > 0 ? $reward : null,
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
            $all = tg_pending_read();
            $all[(string)$args[0]] = time();
            tg_pending_write($all);
            $data = true; break;
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
            if ($existing && $authUid !== $uid) {
                jt_respond(['error' => 'Authentication required'], 401); exit;
            }
            if (!$existing && (empty($u['phone']) || empty($u['password']))) {
                throw new RuntimeException('Для регистрации нужны телефон и пароль');
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
                'work_types', 'company', 'bio', 'avatar_url',
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
            sb_upsert('jm_users', $u, 'id');
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
            if (!$existing) jt_referral_attach($uid, (string)($args[1] ?? ''));
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
            $row = sb_single('jm_users', ['id' => 'eq.' . $authUid], USER_PUBLIC_COLS);
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
        // ответа на вопрос «спрашивать ли заново».
        case 'dbGetConsent': {
            $rows = sb_select('jm_consents', ['user_id' => 'eq.' . (string)($args[0] ?? '')],
                              'stamp,docs,source,accepted_at', 'accepted_at.desc');
            $data = $rows[0] ?? null;
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
            $v = tg_validate_init_data($args[0] ?? '');
            if (!$v || empty($v['user']['id'])) { $data = ['ok' => false]; break; }
            $tgId = (int)$v['user']['id'];
            $u = sb_single('jm_users', ['telegram_id' => 'eq.' . $tgId]);
            if (is_array($u)) unset($u['password'], $u['push_token']);
            $data = [
                'ok' => true,
                'user' => $u,
                'session_token' => $u ? jt_session_issue((string)$u['id']) : null,
                'tg' => [
                    'id' => $tgId,
                    'first_name' => $v['user']['first_name'] ?? '',
                    'last_name' => $v['user']['last_name'] ?? '',
                    'username' => $v['user']['username'] ?? '',
                ],
            ];
            break;
        }

        // args: [userId, initDataString] — link a Telegram account to a user
        case 'tgBindTelegram': {
            $v = tg_validate_init_data($args[1] ?? '');
            if (!$v || empty($v['user']['id'])) { $data = false; break; }
            sb_update('jm_users', ['id' => 'eq.' . $args[0]], ['telegram_id' => (int)$v['user']['id']]);
            $data = true;
            break;
        }

        // args: [employerId, workerId, vacancyId, vacancyTitle]
        // Директору в Telegram: карточка кандидата + кнопки Одобрить/Отклонить
        // args: [employerId, workerId, vacancyId, vacancyTitle]
        case 'tgNotifyNewApplication':
            $data = tg_new_application_card((string)$args[0], (string)$args[1], (string)$args[2], (string)($args[3] ?? ''));
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
            $newShifts = sb_count('jm_vacancies', ['created_at' => 'gte.' . $cut24]);
            $newVacancies = sb_count('jm_perm_vacancies', ['created_at' => 'gte.' . $cut24]);
            $partnerVacancies = sb_count('jm_ext_vacancies', [
                'environment' => 'eq.production', 'first_seen_at' => 'gte.' . $cut24,
            ]);

            $extSources = sb_select_all('jm_ext_sources', [
                'environment' => 'eq.production', 'enabled' => 'is.true',
            ], 'id,name,period_min,last_success_at');
            // Живые вакансии считаем по источникам, а не одним числом: пока не
            // видно, на ком держится витрина, зависимостью нельзя управлять.
            // Выборка одноколоночная — строк много, но это та же цена, какую
            // платит сводка extStats.
            $liveCounts = [];
            foreach (sb_select_all('jm_ext_vacancies', [
                'active' => 'is.true', 'environment' => 'eq.production',
            ], 'source_id') as $row) {
                $k = (string)($row['source_id'] ?? '');
                $liveCounts[$k] = ($liveCounts[$k] ?? 0) + 1;
            }
            $health = ext_source_health($extSources, $liveCounts, $now);

            $lastImportTs = null;
            foreach ($extSources as $source) {
                $ts = !empty($source['last_success_at'])
                    ? strtotime((string)$source['last_success_at']) : false;
                if ($ts !== false && ($lastImportTs === null || $ts > $lastImportTs)) {
                    $lastImportTs = $ts;
                }
            }
            $lastImport = 'никогда';
            if ($lastImportTs !== null) {
                $lastImport = (new DateTimeImmutable('@' . $lastImportTs))
                    ->setTimezone(new DateTimeZone('Europe/Moscow'))
                    ->format('d.m.Y H:i') . ' МСК';
            }

            // Приглашения. Начисления копятся со статусом pending и ждут
            // решения владельца — а узнать о них ему неоткуда, кроме этого
            // отчёта: события есть, сигнала нет.
            //
            // Миграция 064 применяется руками, и до неё таблицы нет. Отчёт от
            // этого не падает: sb_count возвращает 0 на любой неудаче, включая
            // отсутствующую таблицу, — она не бросает исключений вовсе. То
            // есть до миграции здесь будут честные нули, а не поломка.
            $refPending = sb_count('jm_referral_rewards', ['status' => 'eq.pending']);
            $refDay = sb_count('jm_users', [
                'invited_by' => 'not.is.null', 'created_at' => 'gte.' . $cut24,
            ]);
            $referralLine = "🎁 Приглашения: пришли по коду за сутки <b>{$refDay}</b>"
                . ", начислений ждёт решения <b>{$refPending}</b>";

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
            // Накопившиеся начисления — долг перед людьми, которые свою часть
            // уже сделали. Молчать о нём нельзя.
            $referralAlert = $refPending >= 5
                ? "начислений по приглашениям ждёт решения: {$refPending}" : '';

            $tomorrowMsk = gmdate('Y-m-d', $now + 3 * 3600 + 86400);
            $tomorrowShifts = sb_count('jm_vacancies', [
                'status' => 'eq.open', 'date' => 'eq.' . $tomorrowMsk,
            ]);

            $alerts = [];
            if ($applications === 0) $alerts[] = 'откликов за сутки — 0';
            // Тревога по каждому источнику отдельно: общий максимум по всем
            // молчал, только когда умирали все сразу.
            foreach ($health['alerts'] as $sourceAlert) $alerts[] = $sourceAlert;
            if ($referralAlert !== '') $alerts[] = $referralAlert;
            if ($groupAlert !== '') $alerts[] = $groupAlert;
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
            $lines[] = "🏢 Свои публикации: вакансии <b>{$newVacancies}</b>, смены <b>{$newShifts}</b>";
            $lines[] = "🤝 Новых партнёрских вакансий: <b>{$partnerVacancies}</b>";
            $lines[] = "🔄 Последний успешный импорт: {$lastImport}";
            $lines[] = $health['line'];
            $lines[] = $referralLine;
            if ($groupLine !== '') $lines[] = $groupLine;
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
                    'new_vacancies' => $newVacancies,
                    'new_shifts' => $newShifts,
                    'partner_vacancies' => $partnerVacancies,
                    'last_import_at' => $lastImportTs !== null ? gmdate('c', $lastImportTs) : null,
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
                if ($emp && !empty($emp['telegram_id'])) {
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
                if ($wu && !empty($wu['telegram_id'])) {
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
                    if (!empty($e['telegram_id'])) {
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
        case 'cronShiftNudge':
            @set_time_limit(300);
            $data = shift_nudge_run(); break;

        // args: [title, body, roleFilter 'all'|'worker'|'employer']
        // Рассылка по всем с привязанным Telegram (кнопка приложения в каждом сообщении)
        case 'tgBroadcast': {
            @set_time_limit(300);
            @ignore_user_abort(true);
            [$bTitle, $bBody, $roleF] = [(string)$args[0], (string)$args[1], (string)($args[2] ?? 'all')];
            $filters = ['telegram_id' => 'not.is.null'];
            if ($roleF === 'worker' || $roleF === 'employer') $filters['role'] = 'eq.' . $roleF;
            $recipients = sb_select('jm_users', $filters, 'telegram_id');
            $text = '<b>' . $bTitle . '</b>' . ($bBody !== '' ? "\n\n" . $bBody : '');
            $sent = 0;
            foreach ($recipients as $r) {
                if (tg_send_message((int)$r['telegram_id'], $text, true)) $sent++;
            }
            $data = ['sent' => $sent, 'total' => count($recipients)];
            break;
        }

        // args: [[userId, …], template] — личное сообщение боту каждому из списка.
        //
        // Не рассылка: спрашиваем у конкретных людей о конкретном, и текст
        // обращается по имени — {name} подставляется. Кнопки «Открыть JobToo»
        // тут нет намеренно: мы задаём вопрос, а не зовём в приложение, и
        // кнопка превратила бы вопрос в рекламу.
        case 'tgSendToUsers': {
            @set_time_limit(300);
            $ids = is_array($args[0] ?? null) ? $args[0] : [];
            $tpl = (string)($args[1] ?? '');
            if (empty($ids) || $tpl === '') { $data = ['error' => 'нужны список и текст']; break; }
            $sent = []; $skipped = [];
            foreach ($ids as $uid) {
                $u = sb_single('jm_users', ['id' => 'eq.' . $uid], 'id,first_name,telegram_id');
                if (!$u || empty($u['telegram_id'])) { $skipped[] = $uid; continue; }
                $name = htmlspecialchars((string)($u['first_name'] ?? ''), ENT_QUOTES, 'UTF-8');
                $text = str_replace('{name}', $name, $tpl);
                if (tg_send_message((int)$u['telegram_id'], $text)) {
                    $sent[] = $uid;
                    // В журнал: без этого ответ человека прилетит без вопроса,
                    // на который он отвечает, и понять его будет нельзя.
                    try {
                        sb_insert('jm_bot_messages', [
                            'id' => uid(), 'user_id' => $u['id'], 'telegram_id' => (int)$u['telegram_id'],
                            'direction' => 'out', 'name' => 'Никита', 'topic' => 'outreach',
                            'text' => $text, 'created_at' => now_iso(),
                        ]);
                    } catch (Throwable $e) {}
                } else $skipped[] = $uid;
            }
            $data = ['sent' => count($sent), 'skipped' => $skipped];
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

        // ── Источники чужих вакансий ───────────────────────────────────────
        case 'extSourcesList':
            // Никогда не отдаём auth_header/auth_value в браузер дашборда.
            // Даже администратору достаточно знать, что секрет настроен.
            $rows = sb_select('jm_ext_sources', ['order' => 'created_at.desc'],
                'id,name,url,enabled,period_min,last_run_at,last_status,last_count,'
                . 'last_success_at,consecutive_failures,last_duration_ms,last_pages,'
                . 'last_skipped,last_deactivated,created_at,auth_header,environment,notifications_enabled,'
                . 'connector_kind,integration_mode,connector_config,webhook_secret');
            foreach ($rows as &$source) {
                $source['auth_configured'] = !empty($source['auth_header']);
                $config = is_array($source['connector_config'] ?? null) ? $source['connector_config'] : [];
                $source['integration_configured'] = !empty($config['application_submit_url'])
                    && !empty($source['webhook_secret']);
                unset($source['auth_header'], $source['connector_config'], $source['webhook_secret']);
            }
            unset($source);
            $data = $rows; break;

        // args: [{id?, name, url, auth_header?, auth_value?, period_min?, enabled?}]
        case 'extSourceSave': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $name = trim((string)($v['name'] ?? ''));
            $url  = trim((string)($v['url'] ?? ''));
            if ($name === '' || !preg_match('~^https://~i', $url)) {
                $data = ['error' => 'нужны имя и публичный HTTPS-адрес фида']; break;
            }
            $isNew = (string)($v['id'] ?? '') === '';
            $row = [
                'id' => $isNew ? uid() : (string)$v['id'],
                'name' => $name,
                'url' => $url,
                'period_min' => max(5, (int)($v['period_min'] ?? 30)),
                'enabled' => array_key_exists('enabled', $v) ? (bool)$v['enabled'] : true,
            ];
            // Новые источники всегда начинаются в sandbox. Продвижение в production
            // должно быть явным; в sandbox уведомления невозможно включить даже ошибочно.
            if ($isNew || array_key_exists('environment', $v)) {
                $environment = (($v['environment'] ?? 'sandbox') === 'production') ? 'production' : 'sandbox';
                $row['environment'] = $environment;
                $row['notifications_enabled'] = $environment === 'production'
                    && !empty($v['notifications_enabled']);
            }
            // При переключении enabled браузер не знает секрет и не должен
            // стирать его. Меняем доступ только когда поля присланы явно.
            if ($isNew || array_key_exists('auth_header', $v)) {
                $row['auth_header'] = $v['auth_header'] ?? null;
            }
            if ($isNew || array_key_exists('auth_value', $v)) {
                $row['auth_value'] = $v['auth_value'] ?? null;
            }
            if ($isNew || array_key_exists('connector_kind', $v)) {
                $row['connector_kind'] = trim((string)($v['connector_kind'] ?? 'redirect')) ?: 'redirect';
            }
            if ($isNew || array_key_exists('integration_mode', $v)) {
                $mode = (string)($v['integration_mode'] ?? 'redirect');
                if (!in_array($mode, ['redirect', 'embedded_test', 'embedded'], true)) {
                    $data = ['error' => 'неизвестный режим интеграции']; break;
                }
                $row['integration_mode'] = $mode;
            }
            if (array_key_exists('application_submit_url', $v)) {
                $submitUrl = trim((string)($v['application_submit_url'] ?? ''));
                if ($submitUrl !== '' && !preg_match('~^https://~i', $submitUrl)) {
                    $data = ['error' => 'endpoint отклика должен использовать HTTPS']; break;
                }
                $previous = !$isNew
                    ? sb_single('jm_ext_sources', ['id' => 'eq.' . $row['id']], 'connector_config') : null;
                $config = is_array($previous['connector_config'] ?? null)
                    ? $previous['connector_config'] : [];
                $config['application_submit_url'] = $submitUrl;
                $row['connector_config'] = $config;
            }
            if (array_key_exists('webhook_secret', $v)) {
                $row['webhook_secret'] = trim((string)($v['webhook_secret'] ?? '')) ?: null;
            }
            sb_upsert('jm_ext_sources', $row, 'id');
            $data = ['ok' => true, 'id' => $row['id']]; break;
        }

        case 'extSourceDelete': {
            $id = (string)($args[0] ?? '');
            if ($id === '') { $data = ['error' => 'нужен id']; break; }
            sb_delete('jm_ext_vacancies', ['source_id' => 'eq.' . $id]);
            sb_delete('jm_ext_sources', ['id' => 'eq.' . $id]);
            $data = ['ok' => true]; break;
        }

        // Чужие вакансии — приложению. Возвращаем вместе с названием
        // источника: на карточке обязана быть надпись, откуда она, иначе это
        // не агрегатор, а перепечатка чужого под своим именем.
        case 'extVacancies': {
            $offset = max(0, (int)($args[0] ?? 0));
            $limit = max(1, min(1000, (int)($args[1] ?? 1000)));
            $sourceRows = sb_select('jm_ext_sources', [
                'enabled' => 'is.true', 'environment' => 'eq.production',
            ], 'id,name,connector_kind,integration_mode');
            $sources = [];
            foreach ($sourceRows as $s) { $sources[(string)$s['id']] = $s; }
            $sourceIds = array_keys($sources);
            $filters = [
                'active' => 'is.true', 'environment' => 'eq.production',
                'limit' => (string)$limit, 'offset' => (string)$offset,
            ];
            if (is_array($args[2] ?? null)) {
                $requestedSourceIds = array_values(array_filter(array_map(
                    fn($id) => preg_match('/^[a-z0-9_-]{1,64}$/i', (string)$id) ? (string)$id : '',
                    $args[2]
                )));
                $sourceIds = array_values(array_intersect($sourceIds, $requestedSourceIds));
                // Пустой массив означает «ни одного внешнего источника».
            }
            if (!$sourceIds) { $data = []; break; }
            $filters['source_id'] = 'in.(' . implode(',', $sourceIds) . ')';
            $rows = sb_select('jm_ext_vacancies', $filters, '*', 'id.asc');
            foreach ($rows as &$r) {
                $source = $sources[(string)$r['source_id']] ?? [];
                $r['source_name'] = $source['name'] ?? null;
                $r['connector_kind'] = $source['connector_kind'] ?? 'redirect';
                $r['integration_mode'] = $source['integration_mode'] ?? 'redirect';
                // Идентификатор у источника наружу не нужен: по нему ничего
                // не показывают, а знать чужие внутренние номера незачем.
                // dedupe_key, наоборот, нужен — по нему приложение прячет
                // одну и ту же смену, приехавшую из двух источников.
                unset($r['external_id']);
            }
            unset($r);
            $data = $rows; break;
        }

        case 'extSourceOptions': {
            $rows = sb_select('jm_ext_sources', [
                'enabled' => 'is.true', 'environment' => 'eq.production',
            ], 'id,name', 'name.asc');
            $data = array_values(array_map(fn($r) => [
                'id' => (string)$r['id'], 'name' => (string)$r['name'],
            ], $rows));
            break;
        }

        case 'extVacancyCount': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $clean = [
                'query' => mb_substr(trim((string)($v['query'] ?? '')), 0, 120),
                'search_in' => array_values(array_intersect(
                    is_array($v['search_in'] ?? null) ? $v['search_in'] : [], ['title', 'desc'])),
                'posted' => in_array(($v['posted'] ?? 'all'), ['all', 'week', '3days'], true)
                    ? $v['posted'] : 'all',
                'stations' => array_slice(array_values(array_filter(array_map(
                    fn($x) => mb_substr(trim((string)$x), 0, 100),
                    is_array($v['stations'] ?? null) ? $v['stations'] : []
                ))), 0, 50),
                'salary_from' => (string)max(0, (int)($v['salary_from'] ?? 0)),
                'schedules' => array_slice(array_values(array_filter(array_map(
                    fn($x) => mb_substr(trim((string)$x), 0, 100),
                    is_array($v['schedules'] ?? null) ? $v['schedules'] : []
                ))), 0, 20),
            ];
            // Отсутствие sources = все партнёры; [] = только JobToo.
            if (array_key_exists('sources', $v) && is_array($v['sources'])) {
                $clean['sources'] = array_values(array_filter(array_map(
                    fn($id) => preg_match('/^[a-z0-9_-]{1,64}$/i', (string)$id) ? (string)$id : '',
                    $v['sources']
                )));
            }
            $rows = sb_rpc('jm_ext_vacancy_filter_count', ['p_filters' => $clean]);
            $data = (int)($rows[0]['total'] ?? 0);
            break;
        }

        // События партнёрской воронки. Показы принимаются только от
        // авторизованного пользователя; переход может быть анонимным.
        case 'extImpression': {
            $extId = (string)($args[0] ?? '');
            $sourceId = (string)($args[1] ?? '');
            $vac = ($extId !== '' && $sourceId !== '')
                ? sb_single('jm_ext_vacancies', [
                    'id' => 'eq.' . $extId,
                    'source_id' => 'eq.' . $sourceId,
                    'active' => 'is.true',
                ], 'id')
                : null;
            if (!$vac) { $data = false; break; }
            sb_insert('jm_ext_events', [
                'id' => uid(), 'ext_id' => $extId, 'source_id' => $sourceId,
                'event_type' => 'impression', 'user_id' => $authUid,
                'occurred_at' => now_iso(),
            ]);
            $data = true; break;
        }

        // Переход на чужую вакансию. Отдельную старую таблицу сохраняем для
        // совместимости, а универсальный журнал строит полную воронку.
        case 'extClick': {
            $extId = (string)($args[0] ?? '');
            $sourceId = (string)($args[1] ?? '');
            $vac = ($extId !== '' && $sourceId !== '')
                ? sb_single('jm_ext_vacancies', [
                    'id' => 'eq.' . $extId,
                    'source_id' => 'eq.' . $sourceId,
                    'active' => 'is.true',
                ], 'id')
                : null;
            if (!$vac) { $data = false; break; }
            // Непрозрачный click_id создаётся клиентом до открытия URL, чтобы
            // браузер не блокировал переход ожиданием API. В нём нет user_id.
            $clickId = trim((string)($args[3] ?? ''));
            if (!preg_match('~^[A-Za-z0-9_-]{16,80}$~', $clickId)) $clickId = uid();
            try {
                sb_insert('jm_ext_clicks', [
                    'id' => $clickId, 'ext_id' => $extId, 'source_id' => $sourceId,
                    'user_id' => $authUid, 'clicked_at' => now_iso(),
                ]);
                sb_insert('jm_ext_events', [
                    'id' => uid(), 'ext_id' => $extId, 'source_id' => $sourceId,
                    'event_type' => 'click', 'user_id' => $authUid,
                    'attribution_id' => $clickId, 'occurred_at' => now_iso(),
                ]);
            } catch (Throwable $e) {
                // Повтор того же click_id идемпотентен: двойной tap не должен
                // превращаться в два оплачиваемых перехода.
                if (stripos($e->getMessage(), 'duplicate') === false
                    && stripos($e->getMessage(), 'unique') === false) throw $e;
            }
            $data = ['recorded' => true, 'click_id' => $clickId]; break;
        }

        // Сводка по партнёрским вакансиям: объём, качество фида и воронка.
        case 'extStats': {
            $sources = sb_select_all('jm_ext_sources', [], 'id,name,environment');
            $production = [];
            foreach ($sources as $source) {
                if (($source['environment'] ?? 'production') === 'production') {
                    $production[(string)$source['id']] = (string)$source['name'];
                }
            }

            $allVacancies = sb_select_all('jm_ext_vacancies', ['active' => 'is.true'],
                'source_id,kind,metro_station,metro_station_norm,work_type');
            $rows = array_values(array_filter($allVacancies,
                fn($r) => isset($production[(string)($r['source_id'] ?? '')])));
            $by = []; $withoutStation = 0; $withoutProfession = 0;
            foreach ($rows as $r) {
                $k = (string)$r['source_id'];
                $by[$k] = ($by[$k] ?? 0) + 1;
                if (!empty($r['metro_station']) && empty($r['metro_station_norm'])) $withoutStation++;
                if (empty($r['work_type'])) $withoutProfession++;
            }

            $c7 = gmdate('Y-m-d\\TH:i:s', time() - 7 * 86400) . 'Z';
            $c30 = gmdate('Y-m-d\\TH:i:s', time() - 30 * 86400) . 'Z';
            $date30 = gmdate('Y-m-d', time() - 30 * 86400);
            $onlyProduction = fn($r) => isset($production[(string)($r['source_id'] ?? '')]);
            $events7 = array_values(array_filter(sb_select_all('jm_ext_events',
                ['occurred_at' => 'gte.' . $c7], 'id,source_id,event_type,user_id,new_candidate'), $onlyProduction));
            $events30 = array_values(array_filter(sb_select_all('jm_ext_events',
                ['occurred_at' => 'gte.' . $c30], 'id,source_id,event_type,user_id,new_candidate'), $onlyProduction));
            $runs7 = array_values(array_filter(sb_select_all('jm_ext_ingest_runs',
                ['ran_at' => 'gte.' . $c7], 'source_id,success,received,status,ran_at'), $onlyProduction));

            $summarize = function(array $events): array {
                $totals = ['impression' => 0, 'click' => 0, 'conversion' => 0];
                $perSource = [];
                foreach ($events as $e) {
                    $type = (string)($e['event_type'] ?? '');
                    $source = (string)($e['source_id'] ?? '');
                    if (!isset($totals[$type])) continue;
                    $totals[$type]++;
                    if (!isset($perSource[$source])) {
                        $perSource[$source] = ['impressions' => 0, 'clicks' => 0, 'conversions' => 0];
                    }
                    $field = $type === 'impression' ? 'impressions' : ($type === 'click' ? 'clicks' : 'conversions');
                    $perSource[$source][$field]++;
                }
                return ['totals' => $totals, 'sources' => $perSource];
            };
            $s7 = $summarize($events7);
            $s30 = $summarize($events30);
            $impressions = $s7['totals']['impression'];
            $clicks = $s7['totals']['click'];
            $conversions = $s7['totals']['conversion'];
            $errors7 = count(array_filter($runs7, fn($r) => empty($r['success'])));

            // Аудитория JobToo: только реальные незаблокированные работники.
            $workers = sb_select_all('jm_users', ['role' => 'eq.worker', 'is_blocked' => 'not.is.true'],
                'id,metro_station,created_at,last_seen_at');
            $workerById = []; $regions = []; $activeRegions = [];
            $active30 = 0; $registered30 = 0;
            foreach ($workers as $worker) {
                $uid = (string)($worker['id'] ?? '');
                if ($uid !== '') $workerById[$uid] = $worker;
                $region = trim((string)($worker['metro_station'] ?? ''));
                if ($region !== '') $regions[$region] = ($regions[$region] ?? 0) + 1;
                if (!empty($worker['last_seen_at']) && (string)$worker['last_seen_at'] >= $c30) {
                    $active30++;
                    if ($region !== '') $activeRegions[$region] = ($activeRegions[$region] ?? 0) + 1;
                }
                if (!empty($worker['created_at']) && (string)$worker['created_at'] >= $c30) $registered30++;
            }
            arsort($regions); arsort($activeRegions);

            $unique = ['impression' => [], 'click' => [], 'conversion' => []];
            $activityRegions = []; $newYes = 0; $newNo = 0; $newUnknown = 0;
            $perSourceBusiness = [];
            foreach ($events30 as $event) {
                $type = (string)($event['event_type'] ?? '');
                $sid = (string)($event['source_id'] ?? '');
                $uid = trim((string)($event['user_id'] ?? ''));
                if (!isset($perSourceBusiness[$sid])) {
                    $perSourceBusiness[$sid] = [
                        'source_name' => $production[$sid] ?? $sid,
                        'unique_reached' => [], 'unique_interested' => [], 'unique_converted' => [],
                        'new_yes' => 0, 'new_no' => 0, 'new_unknown' => 0, 'spend_rub' => 0.0,
                    ];
                }
                if ($uid !== '' && isset($unique[$type])) {
                    $unique[$type][$uid] = true;
                    $field = $type === 'impression' ? 'unique_reached'
                        : ($type === 'click' ? 'unique_interested' : 'unique_converted');
                    $perSourceBusiness[$sid][$field][$uid] = true;
                    $region = trim((string)($workerById[$uid]['metro_station'] ?? ''));
                    if ($region !== '') $activityRegions[$region] = ($activityRegions[$region] ?? 0) + 1;
                }
                if ($type === 'conversion') {
                    if (($event['new_candidate'] ?? null) === true) {
                        $newYes++; $perSourceBusiness[$sid]['new_yes']++;
                    } elseif (($event['new_candidate'] ?? null) === false) {
                        $newNo++; $perSourceBusiness[$sid]['new_no']++;
                    } else {
                        $newUnknown++; $perSourceBusiness[$sid]['new_unknown']++;
                    }
                }
            }
            arsort($activityRegions);

            $costs = array_values(array_filter(sb_select_all('jm_partner_costs',
                ['incurred_at' => 'gte.' . $date30], 'source_id,amount_rub,incurred_at'), $onlyProduction));
            $spend30 = 0.0;
            foreach ($costs as $cost) {
                $sid = (string)($cost['source_id'] ?? '');
                $amount = (float)($cost['amount_rub'] ?? 0);
                $spend30 += $amount;
                if (!isset($perSourceBusiness[$sid])) {
                    $perSourceBusiness[$sid] = [
                        'source_name' => $production[$sid] ?? $sid,
                        'unique_reached' => [], 'unique_interested' => [], 'unique_converted' => [],
                        'new_yes' => 0, 'new_no' => 0, 'new_unknown' => 0, 'spend_rub' => 0.0,
                    ];
                }
                $perSourceBusiness[$sid]['spend_rub'] += $amount;
            }

            foreach ($perSourceBusiness as $sid => &$metric) {
                $metric['unique_reached'] = count($metric['unique_reached']);
                $metric['unique_interested'] = count($metric['unique_interested']);
                $metric['unique_converted'] = count($metric['unique_converted']);
                $known = $metric['new_yes'] + $metric['new_no'];
                $metric['new_candidate_share_pct'] = $known > 0
                    ? round($metric['new_yes'] * 100 / $known, 2) : null;
                $metric['cost_per_conversion_rub'] = $metric['unique_converted'] > 0
                    && $metric['spend_rub'] > 0
                    ? round($metric['spend_rub'] / $metric['unique_converted'], 2) : null;
            }
            unset($metric);

            $uniqueReached = count($unique['impression']);
            $uniqueInterested = count($unique['click']);
            $uniqueConverted = count($unique['conversion']);
            $knownNew = $newYes + $newNo;

            $data = [
                'всего' => count($rows),
                'по_источникам' => $by,
                'без_станции' => $withoutStation,
                'без_профессии' => $withoutProfession,
                'показы_7дней' => $impressions,
                'переходов_7дней' => $clicks,
                'конверсии_7дней' => $conversions,
                'ctr_7дней' => $impressions > 0 ? round($clicks * 100 / $impressions, 2) : 0,
                'конверсия_из_переходов_7дней' => $clicks > 0 ? round($conversions * 100 / $clicks, 2) : 0,
                'ошибок_фида_7дней' => $errors7,
                'воронка_по_источникам_7дней' => $s7['sources'],
                'воронка_30дней' => $s30['totals'],
                'партнёрский_отчёт_30дней' => [
                    'аудитория_работников' => count($workers),
                    'активных_работников' => $active30,
                    'новых_регистраций' => $registered30,
                    'уникальный_охват' => $uniqueReached,
                    'уникальный_интерес' => $uniqueInterested,
                    'уникальные_конверсии' => $uniqueConverted,
                    'конверсия_охват_интерес_pct' => $uniqueReached > 0
                        ? round($uniqueInterested * 100 / $uniqueReached, 2) : null,
                    'конверсия_интерес_отклик_pct' => $uniqueInterested > 0
                        ? round($uniqueConverted * 100 / $uniqueInterested, 2) : null,
                    'расходы_rub' => round($spend30, 2),
                    'стоимость_отклика_rub' => $uniqueConverted > 0 && $spend30 > 0
                        ? round($spend30 / $uniqueConverted, 2) : null,
                    'новых_для_партнёра' => $newYes,
                    'известных_партнёру' => $newNo,
                    'статус_новизны_не_передан' => $newUnknown,
                    'доля_новых_pct' => $knownNew > 0 ? round($newYes * 100 / $knownNew, 2) : null,
                    'регионы_аудитории' => array_slice($regions, 0, 15, true),
                    'регионы_активной_аудитории' => array_slice($activeRegions, 0, 15, true),
                    'регионы_партнёрской_активности' => array_slice($activityRegions, 0, 15, true),
                    'по_источникам' => $perSourceBusiness,
                ],
            ];
            break;
        }

        // Расходы пилота вводятся фактами. Нулевое или отсутствующее значение
        // не считается бесплатным откликом и не искажает коммерческий отчёт.
        case 'extPartnerCostSave': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $sourceId = trim((string)($v['source_id'] ?? ''));
            $amount = (float)($v['amount_rub'] ?? 0);
            $date = trim((string)($v['incurred_at'] ?? ''));
            if ($sourceId === '' || $amount <= 0 || !preg_match('~^\\d{4}-\\d{2}-\\d{2}$~', $date)) {
                $data = ['error' => 'нужны источник, положительная сумма и дата']; break;
            }
            $source = sb_single('jm_ext_sources', ['id' => 'eq.' . $sourceId], 'id');
            if (!$source) { $data = ['error' => 'источник не найден']; break; }
            sb_insert('jm_partner_costs', [
                'id' => uid(), 'source_id' => $sourceId,
                'amount_rub' => round($amount, 2), 'incurred_at' => $date,
                'note' => trim((string)($v['note'] ?? '')) ?: null,
                'created_at' => now_iso(),
            ]);
            $data = ['ok' => true]; break;
        }

        // ── Биллинг и сверка партнёрского пилота ─────────────────────────
        case 'partnerTariffsList': {
            $sourceId = trim((string)($args[0] ?? ''));
            $filters = $sourceId !== '' ? ['source_id' => 'eq.' . $sourceId] : [];
            $data = sb_select_all('jm_partner_tariffs', $filters,
                'id,source_id,name,billing_model,amount_rub,fixed_monthly_rub,effective_from,effective_to,active,terms_version,created_at');
            break;
        }

        case 'partnerTariffSave': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $sourceId = trim((string)($v['source_id'] ?? ''));
            $model = trim((string)($v['billing_model'] ?? ''));
            $allowed = ['first_completed_shift','completed_shift','qualified_application','fixed_monthly','hybrid'];
            $from = trim((string)($v['effective_from'] ?? ''));
            if ($sourceId === '' || !in_array($model, $allowed, true)
                || !preg_match('~^\\d{4}-\\d{2}-\\d{2}$~', $from)) {
                $data = ['error' => 'Нужны источник, модель и дата начала тарифа']; break;
            }
            $row = [
                'id' => trim((string)($v['id'] ?? '')) ?: uid(),
                'source_id' => $sourceId,
                'name' => trim((string)($v['name'] ?? '')) ?: $model,
                'billing_model' => $model,
                'amount_rub' => max(0, round((float)($v['amount_rub'] ?? 0), 2)),
                'fixed_monthly_rub' => max(0, round((float)($v['fixed_monthly_rub'] ?? 0), 2)),
                'effective_from' => $from,
                'effective_to' => !empty($v['effective_to']) ? (string)$v['effective_to'] : null,
                'active' => ($v['active'] ?? true) !== false,
                'terms_version' => trim((string)($v['terms_version'] ?? '')) ?: $from,
                'created_at' => now_iso(),
            ];
            sb_upsert('jm_partner_tariffs', $row, 'id');
            $data = $row; break;
        }

        case 'partnerBillableEventRecord': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $sourceId = trim((string)($v['source_id'] ?? ''));
            $occurredAt = trim((string)($v['occurred_at'] ?? '')) ?: now_iso();
            $tariffs = sb_select_all('jm_partner_tariffs',
                ['source_id' => 'eq.' . $sourceId, 'active' => 'is.true'],
                'id,source_id,billing_model,amount_rub,effective_from,effective_to,active');
            $v['occurred_at'] = $occurredAt;
            try {
                $dedupe = pb_dedupe_key($v);
                $existing = sb_single('jm_partner_billable_events',
                    ['source_id' => 'eq.' . $sourceId, 'dedupe_key' => 'eq.' . $dedupe], 'id,dedupe_key,status');
                if ($existing) { $data = ['created' => false, 'reason' => 'duplicate', 'event' => $existing]; break; }
                $built = pb_build_billable_event($v, $tariffs);
                if (!$built['created']) { $data = $built; break; }
                sb_insert('jm_partner_billable_events', $built['billable_event']);
                $data = $built;
            } catch (Throwable $e) {
                if (stripos($e->getMessage(), 'duplicate') !== false
                    || stripos($e->getMessage(), 'unique') !== false) {
                    $data = ['created' => false, 'reason' => 'duplicate'];
                } else throw $e;
            }
            break;
        }

        case 'partnerReconciliationRecord': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $eventId = trim((string)($v['billable_event_id'] ?? ''));
            $event = $eventId !== '' ? sb_single('jm_partner_billable_events',
                ['id' => 'eq.' . $eventId], 'id,source_id,application_id,status') : null;
            if (!$event) { $data = ['error' => 'Оплачиваемое событие не найдено']; break; }
            $issue = pb_reconciliation_issue($event, [
                'status' => (string)($v['partner_status'] ?? ''),
                'reason_code' => (string)($v['reason_code'] ?? 'status_mismatch'),
                'reason_text' => $v['reason_text'] ?? null,
            ]);
            if ($issue === null) { $data = ['created' => false, 'reason' => 'statuses_match']; break; }
            $issue['id'] = uid();
            try { sb_insert('jm_partner_reconciliation_issues', $issue); }
            catch (Throwable $e) {
                if (stripos($e->getMessage(), 'duplicate') === false
                    && stripos($e->getMessage(), 'unique') === false) throw $e;
            }
            $data = ['created' => true, 'issue' => $issue]; break;
        }

        case 'partnerConsentRecord': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            if ($authUid === null || (string)($v['worker_id'] ?? '') !== $authUid) {
                $data = ['error' => 'Нельзя записать согласие за другого пользователя']; break;
            }
            $required = ['source_id','worker_id','ext_vacancy_id','recipient_name','consent_version'];
            foreach ($required as $key) {
                if (trim((string)($v[$key] ?? '')) === '') {
                    $data = ['error' => 'Не заполнено поле согласия: ' . $key]; break 2;
                }
            }
            $categories = is_array($v['data_categories'] ?? null)
                ? array_values(array_intersect($v['data_categories'], ['profile','application','messages','statuses'])) : [];
            if (!$categories) { $data = ['error' => 'Не указан состав передаваемых данных']; break; }
            $row = [
                'id' => uid(), 'source_id' => (string)$v['source_id'],
                'worker_id' => (string)$v['worker_id'], 'ext_vacancy_id' => (string)$v['ext_vacancy_id'],
                'application_id' => $v['application_id'] ?? null,
                'recipient_name' => (string)$v['recipient_name'], 'data_categories' => $categories,
                'purpose' => trim((string)($v['purpose'] ?? '')) ?: 'Передача отклика, сообщений и статусов по выбранной смене',
                'consent_version' => (string)$v['consent_version'], 'accepted_at' => now_iso(),
                'evidence' => [
                    'ip_hash' => isset($v['ip']) ? hash('sha256', (string)$v['ip']) : null,
                    'user_agent' => substr((string)($v['user_agent'] ?? ''), 0, 300),
                ],
            ];
            $previous = sb_single('jm_partner_data_consents', [
                'source_id' => 'eq.' . $row['source_id'], 'worker_id' => 'eq.' . $row['worker_id'],
                'ext_vacancy_id' => 'eq.' . $row['ext_vacancy_id'],
                'consent_version' => 'eq.' . $row['consent_version'],
            ], 'id');
            if ($previous) {
                $row['id'] = $previous['id'];
                $row['revoked_at'] = null;
                sb_upsert('jm_partner_data_consents', $row, 'id');
            } else {
                sb_insert('jm_partner_data_consents', $row);
            }
            $data = ['recorded' => true, 'consent_version' => $row['consent_version']]; break;
        }

        // SuperJob OAuth начинается только для вошедшего пользователя. В state
        // нет user_id — наружу уходит случайная строка, а в базе лежит её хеш.
        case 'superjobOauthStart': {
            if ($authUid === null) throw new RuntimeException('Нужна авторизация JobToo');
            $clientId = sjo_cfg('SUPERJOB_CLIENT_ID');
            if ($clientId === '' || sjo_client_secret() === '') {
                throw new RuntimeException('SuperJob OAuth ещё не настроен');
            }
            $state = jt_b64url_encode(random_bytes(32));
            $returnUrl = trim((string)($args[0] ?? ''));
            if (!preg_match('~^(?:https://jobtoo\.ru/|onspaceapp://)~i', $returnUrl)) {
                $returnUrl = 'https://jobtoo.ru/';
            }
            sb_insert('jm_superjob_oauth_states', [
                'state_hash' => hash('sha256', $state),
                'worker_id' => $authUid,
                'return_url' => $returnUrl,
                'expires_at' => gmdate('Y-m-d\TH:i:s', time() + 600) . '.000Z',
            ]);
            $redirectUri = 'https://jobtoo.ru/api/superjob_oauth.php';
            $data = ['url' => 'https://www.superjob.ru/authorize/?' . http_build_query([
                'client_id' => $clientId,
                'redirect_uri' => $redirectUri,
                'state' => $state,
            ], '', '&', PHP_QUERY_RFC3986)];
            break;
        }

        case 'superjobOauthStatus': {
            if ($authUid === null) { $data = ['connected' => false]; break; }
            $connection = sb_single('jm_superjob_connections', ['worker_id' => 'eq.' . $authUid],
                'resume_id,expires_at,connected_at,last_error');
            $data = $connection ? [
                'connected' => true,
                'has_resume' => !empty($connection['resume_id']),
                'connected_at' => $connection['connected_at'] ?? null,
                'last_error' => $connection['last_error'] ?? null,
            ] : ['connected' => false];
            break;
        }

        case 'superjobOauthDisconnect': {
            if ($authUid === null) throw new RuntimeException('Нужна авторизация JobToo');
            sb_delete('jm_superjob_connections', ['worker_id' => 'eq.' . $authUid]);
            $data = ['disconnected' => true];
            break;
        }

        // Отправляем только ID резюме, выбранный самим SuperJob как основной,
        // и ID вакансии из нашей серверной копии. Клиент не может подставить их.
        case 'superjobApply': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $vacancyId = trim((string)($v['ext_vacancy_id'] ?? ''));
            $consentVersion = trim((string)($v['consent_version'] ?? ''));
            $comment = mb_substr(trim((string)($v['comment'] ?? '')), 0, 1000);
            if ($authUid === null || $vacancyId === '' || $consentVersion === '') {
                throw new RuntimeException('Не хватает данных для отклика');
            }
            $vacancy = sb_single('jm_ext_vacancies', [
                'id' => 'eq.' . $vacancyId, 'source_id' => 'eq.superjob',
                'active' => 'is.true', 'environment' => 'eq.production',
            ], 'id,external_id');
            $consent = sb_single('jm_partner_data_consents', [
                'source_id' => 'eq.superjob', 'worker_id' => 'eq.' . $authUid,
                'ext_vacancy_id' => 'eq.' . $vacancyId,
                'consent_version' => 'eq.' . $consentVersion, 'revoked_at' => 'is.null',
            ], 'id');
            if (!$vacancy || !$consent) throw new RuntimeException('Вакансия или согласие не найдены');

            $existing = sb_single('jm_partner_applications', [
                'source_id' => 'eq.superjob', 'worker_id' => 'eq.' . $authUid,
                'ext_vacancy_id' => 'eq.' . $vacancyId,
            ], 'id,status');
            if ($existing && ($existing['status'] ?? '') !== 'failed') {
                $data = ['id' => $existing['id'], 'status' => $existing['status'], 'created' => false]; break;
            }
            $connection = sb_single('jm_superjob_connections', ['worker_id' => 'eq.' . $authUid]);
            if (!$connection) throw new RuntimeException('Подключите аккаунт SuperJob');
            if (empty($connection['resume_id'])) throw new RuntimeException('В SuperJob нет основного резюме');

            try {
                $access = sjo_decrypt((string)$connection['access_token_enc'], SB_KEY);
                if (strtotime((string)$connection['expires_at']) <= time() + 60) {
                    $refresh = sjo_decrypt((string)$connection['refresh_token_enc'], SB_KEY);
                    $token = sjo_request('GET', 'https://api.superjob.ru/2.0/oauth2/refresh_token/?' . http_build_query([
                        'refresh_token' => $refresh,
                        'client_id' => sjo_cfg('SUPERJOB_CLIENT_ID'),
                        'client_secret' => sjo_client_secret(),
                    ], '', '&', PHP_QUERY_RFC3986));
                    $access = (string)($token['access_token'] ?? '');
                    $newRefresh = (string)($token['refresh_token'] ?? $refresh);
                    if ($access === '') throw new RuntimeException('SuperJob did not refresh the token');
                    $ttl = (int)($token['ttl'] ?? 0);
                    $expires = $ttl > time() ? $ttl : time() + max(300, (int)($token['expires_in'] ?? 3600));
                    sb_update('jm_superjob_connections', ['worker_id' => 'eq.' . $authUid], [
                        'access_token_enc' => sjo_encrypt($access, SB_KEY),
                        'refresh_token_enc' => sjo_encrypt($newRefresh, SB_KEY),
                        'expires_at' => gmdate('Y-m-d\TH:i:s', $expires) . '.000Z',
                        'updated_at' => now_iso(), 'last_error' => null,
                    ]);
                }
                sjo_request('POST', 'https://api.superjob.ru/2.0/send_cv_on_vacancy/', [
                    'id_cv' => (string)$connection['resume_id'],
                    'id_vacancy' => (string)$vacancy['external_id'],
                    'comment' => $comment,
                ], $access);
                $applicationId = $existing['id'] ?? uid();
                sb_upsert('jm_partner_applications', [
                    'id' => $applicationId, 'source_id' => 'superjob',
                    'ext_vacancy_id' => $vacancyId, 'worker_id' => $authUid,
                    'status' => 'submitted', 'consent_version' => $consentVersion,
                    'failure_code' => null, 'failure_message' => null,
                    'updated_at' => now_iso(), 'partner_updated_at' => now_iso(),
                ], 'id');
                $data = ['id' => $applicationId, 'status' => 'submitted', 'created' => !$existing];
            } catch (Throwable $e) {
                sb_update('jm_superjob_connections', ['worker_id' => 'eq.' . $authUid], [
                    'last_error' => mb_substr($e->getMessage(), 0, 300), 'updated_at' => now_iso(),
                ]);
                throw new RuntimeException('SuperJob не принял отклик. Попробуйте ещё раз.');
            }
            break;
        }

        // Отклик внутри JobToo доступен только для боевой embedded-интеграции.
        // В очередь кладём непрозрачные ID; профиль партнёру собирает уже
        // серверный адаптер, поэтому клиент не может подменить персональные данные.
        case 'partnerApplicationCreate': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $workerId = trim((string)($v['worker_id'] ?? ''));
            $sourceId = trim((string)($v['source_id'] ?? ''));
            $vacancyId = trim((string)($v['ext_vacancy_id'] ?? ''));
            $consentVersion = trim((string)($v['consent_version'] ?? ''));
            if ($authUid === null || $workerId === '' || $workerId !== $authUid) {
                $data = ['error' => 'Нельзя отправить отклик за другого пользователя']; break;
            }
            if ($sourceId === '' || $vacancyId === '' || $consentVersion === '') {
                $data = ['error' => 'Не хватает данных для отклика']; break;
            }
            $source = sb_single('jm_ext_sources', [
                'id' => 'eq.' . $sourceId, 'enabled' => 'is.true',
                'environment' => 'eq.production', 'integration_mode' => 'eq.embedded',
            ], 'id');
            $vacancy = sb_single('jm_ext_vacancies', [
                'id' => 'eq.' . $vacancyId, 'source_id' => 'eq.' . $sourceId,
                'active' => 'is.true', 'environment' => 'eq.production',
            ], 'id');
            if (!$source || !$vacancy) {
                $data = ['error' => 'Встроенный отклик для этой вакансии недоступен']; break;
            }
            $existing = sb_single('jm_partner_applications', [
                'source_id' => 'eq.' . $sourceId, 'ext_vacancy_id' => 'eq.' . $vacancyId,
                'worker_id' => 'eq.' . $workerId,
            ], 'id,status');
            if ($existing) {
                try {
                    sb_insert('jm_partner_outbox', [
                        'id' => uid(), 'source_id' => $sourceId,
                        'aggregate_type' => 'application', 'aggregate_id' => $existing['id'],
                        'event_kind' => 'application.submit',
                        'idempotency_key' => 'application.submit:' . $existing['id'],
                        'payload' => ['application_id' => $existing['id'], 'ext_vacancy_id' => $vacancyId],
                        'delivery_status' => 'pending', 'attempts' => 0,
                        'next_attempt_at' => now_iso(), 'created_at' => now_iso(),
                    ]);
                } catch (Throwable $e) {
                    if (stripos($e->getMessage(), 'duplicate') === false
                        && stripos($e->getMessage(), 'unique') === false) throw $e;
                }
                $data = ['id' => $existing['id'], 'status' => $existing['status'], 'created' => false]; break;
            }
            $consent = sb_single('jm_partner_data_consents', [
                'source_id' => 'eq.' . $sourceId, 'worker_id' => 'eq.' . $workerId,
                'ext_vacancy_id' => 'eq.' . $vacancyId, 'consent_version' => 'eq.' . $consentVersion,
                'revoked_at' => 'is.null',
            ], 'id');
            if (!$consent) { $data = ['error' => 'Сначала подтвердите передачу данных партнёру']; break; }

            $applicationId = uid();
            $createdAt = now_iso();
            try {
                sb_insert('jm_partner_applications', [
                    'id' => $applicationId, 'source_id' => $sourceId,
                    'ext_vacancy_id' => $vacancyId, 'worker_id' => $workerId,
                    'status' => 'local_created', 'status_version' => 1,
                    'consent_version' => $consentVersion,
                    'created_at' => $createdAt, 'updated_at' => $createdAt,
                ]);
                sb_insert('jm_partner_outbox', [
                    'id' => uid(), 'source_id' => $sourceId,
                    'aggregate_type' => 'application', 'aggregate_id' => $applicationId,
                    'event_kind' => 'application.submit',
                    'idempotency_key' => 'application.submit:' . $applicationId,
                    'payload' => ['application_id' => $applicationId, 'ext_vacancy_id' => $vacancyId],
                    'delivery_status' => 'pending', 'attempts' => 0,
                    'next_attempt_at' => $createdAt, 'created_at' => $createdAt,
                ]);
                sb_update('jm_partner_data_consents', ['id' => 'eq.' . $consent['id']], [
                    'application_id' => $applicationId,
                ]);
            } catch (Throwable $e) {
                $existing = sb_single('jm_partner_applications', [
                    'source_id' => 'eq.' . $sourceId, 'ext_vacancy_id' => 'eq.' . $vacancyId,
                    'worker_id' => 'eq.' . $workerId,
                ], 'id,status');
                if (!$existing) throw $e;
                $data = ['id' => $existing['id'], 'status' => $existing['status'], 'created' => false]; break;
            }
            $data = ['id' => $applicationId, 'status' => 'local_created', 'created' => true]; break;
        }

        case 'partnerApplicationsGet': {
            $workerId = trim((string)($args[0] ?? ''));
            if ($authUid === null || $workerId === '' || $workerId !== $authUid) {
                $data = ['error' => 'Нельзя читать чужие отклики']; break;
            }
            $rows = sb_select('jm_partner_applications', [
                'worker_id' => 'eq.' . $workerId,
            ], 'id,source_id,ext_vacancy_id,worker_id,status,created_at,updated_at', 'updated_at.desc');
            $vacancyIds = [];
            $sourceIds = [];
            foreach ($rows as $row) {
                $vacancyIds[(string)$row['ext_vacancy_id']] = true;
                $sourceIds[(string)$row['source_id']] = true;
            }
            $vacancies = [];
            if ($vacancyIds) {
                foreach (sb_select('jm_ext_vacancies', [
                    'id' => 'in.(' . implode(',', array_keys($vacancyIds)) . ')',
                ], 'id,title,company,address,salary,pay_period') as $vacancy) {
                    $vacancies[(string)$vacancy['id']] = $vacancy;
                }
            }
            $sources = [];
            if ($sourceIds) {
                foreach (sb_select('jm_ext_sources', [
                    'id' => 'in.(' . implode(',', array_keys($sourceIds)) . ')',
                ], 'id,name') as $source) {
                    $sources[(string)$source['id']] = $source['name'];
                }
            }
            foreach ($rows as &$row) {
                $vacancy = $vacancies[(string)$row['ext_vacancy_id']] ?? [];
                $row['title'] = $vacancy['title'] ?? null;
                $row['company'] = $vacancy['company'] ?? null;
                $row['address'] = $vacancy['address'] ?? null;
                $row['salary'] = $vacancy['salary'] ?? null;
                $row['pay_period'] = $vacancy['pay_period'] ?? null;
                $row['source_name'] = $sources[(string)$row['source_id']] ?? null;
            }
            unset($row);
            $data = $rows; break;
        }

        case 'partnerBillingReport': {
            $sourceId = trim((string)($args[0] ?? ''));
            $from = trim((string)($args[1] ?? ''));
            $to = trim((string)($args[2] ?? ''));
            if ($sourceId === '' || !preg_match('~^\\d{4}-\\d{2}-\\d{2}$~', $from)
                || !preg_match('~^\\d{4}-\\d{2}-\\d{2}$~', $to)) {
                $data = ['error' => 'Нужны источник и границы периода']; break;
            }
            $events = sb_select_all('jm_partner_billable_events', [
                'source_id' => 'eq.' . $sourceId,
                'occurred_at' => 'gte.' . $from . 'T00:00:00Z',
                'and' => '(occurred_at.lt.' . $to . 'T23:59:59Z)',
            ], 'id,source_id,application_id,worker_id,ext_vacancy_id,partner_event_id,event_kind,occurred_at,amount_rub,status,partner_status,rejection_reason');
            $issues = sb_select_all('jm_partner_reconciliation_issues', [
                'source_id' => 'eq.' . $sourceId,
                'detected_at' => 'gte.' . $from . 'T00:00:00Z',
            ], 'id,billable_event_id,local_status,partner_status,reason_code,reason_text,resolution_status,detected_at,resolved_at');
            $approved = array_values(array_filter($events, fn($e) => in_array($e['status'] ?? '', ['approved','invoiced','paid'], true)));
            $amount = array_sum(array_map(fn($e) => (float)($e['amount_rub'] ?? 0), $approved));
            $data = [
                'source_id' => $sourceId, 'period_start' => $from, 'period_end' => $to,
                'events' => $events, 'discrepancies' => $issues,
                'summary' => [
                    'events' => count($events), 'approved' => count($approved),
                    'rejected' => count(array_filter($events, fn($e) => ($e['status'] ?? '') === 'rejected')),
                    'open_discrepancies' => count(array_filter($issues, fn($i) => ($i['resolution_status'] ?? '') === 'open')),
                    'amount_rub' => round($amount, 2),
                ],
            ];
            break;
        }

        case 'partnerReportSnapshotSave': {
            $v = is_array($args[0] ?? null) ? $args[0] : [];
            $required = ['source_id','period_start','period_end','checksum_sha256'];
            foreach ($required as $key) {
                if (trim((string)($v[$key] ?? '')) === '') {
                    $data = ['error' => 'Не заполнено поле отчёта: ' . $key]; break 2;
                }
            }
            $row = [
                'id' => trim((string)($v['id'] ?? '')) ?: uid(),
                'source_id' => (string)$v['source_id'],
                'period_start' => (string)$v['period_start'],
                'period_end' => (string)$v['period_end'],
                'status' => 'generated',
                'event_count' => max(0, (int)($v['event_count'] ?? 0)),
                'amount_rub' => max(0, round((float)($v['amount_rub'] ?? 0), 2)),
                'approved_count' => max(0, (int)($v['approved_count'] ?? 0)),
                'rejected_count' => max(0, (int)($v['rejected_count'] ?? 0)),
                'discrepancy_count' => max(0, (int)($v['discrepancy_count'] ?? 0)),
                'checksum_sha256' => (string)$v['checksum_sha256'],
                'generated_at' => now_iso(),
            ];
            sb_upsert('jm_partner_report_runs', $row, 'source_id,period_start,period_end');
            $data = ['saved' => true, 'report' => $row]; break;
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
            $data = sb_select('jm_support_messages', ['user_id' => 'eq.' . (string)($args[0] ?? '')],
                'id,direction,text,created_at', 'created_at.asc'); break;

        // Закрыть обращение: прощальное слово человеку + отметка «закрыто».
        //
        // Текст обязателен и приходит из дашборда: закрывать молча — значит
        // оборвать разговор на полуслове, а человек не знает, ждать ему ещё
        // или нет. Отметка отдельно от переписки (см. 023_support_close.sql).
        case 'supportClose': {
            $uid = (string)($args[0] ?? '');
            $text = trim((string)($args[1] ?? ''));
            if ($uid === '') { $data = ['ok' => false, 'reason' => 'no_user']; break; }
            if ($text !== '') {
                sb_insert('jm_support_messages', [
                    'id' => uid(), 'user_id' => $uid, 'direction' => 'out',
                    'text' => $text, 'created_at' => now_iso(),
                ]);
                notify_user($uid, '🆘 Ответ поддержки', $text, 'support');
            }
            $marked = support_thread_set($uid, now_iso());
            $data = ['ok' => true, 'marked' => $marked]; break;
        }

        // Снова открыть — если закрыли по ошибке.
        case 'supportReopen': {
            $uid = (string)($args[0] ?? '');
            if ($uid === '') { $data = ['ok' => false]; break; }
            $marked = support_thread_set($uid, null);
            $data = ['ok' => true, 'marked' => $marked]; break;
        }

        case 'supportSend': {
            $uid = (string)($args[0] ?? '');
            $text = trim((string)($args[1] ?? ''));
            if ($uid === '' || $text === '') { $data = ['ok' => false]; break; }

            // Написал снова — обращение снова открыто, даже если мы его
            // закрывали. Иначе человек пишет в пустоту: у нас в списке
            // «закрыто», а он ждёт ответа.
            support_thread_set($uid, null);

            sb_insert('jm_support_messages', [
                'id' => uid(), 'user_id' => $uid, 'direction' => 'in',
                'text' => $text, 'created_at' => now_iso(),
            ]);

            // Никите — в телеграм, сразу и с контекстом. Без этого обращение
            // лежало бы в базе, пока кто-нибудь не откроет дашборд.
            $adm = sb_single('jm_settings', ['key' => 'eq.admin_chat_id'], 'value');
            if ($adm && !empty($adm['value'])) {
                $u = sb_single('jm_users', ['id' => 'eq.' . $uid],
                    'first_name,last_name,phone,role,metro_station');
                $who = trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? '')) ?: 'Без имени';
                $meta = array_filter([$u['role'] ?? null, $u['phone'] ?? null, $u['metro_station'] ?? null]);
                $prev = sb_select('jm_support_messages', ['user_id' => 'eq.' . $uid],
                    'direction,text,created_at', 'created_at.desc');
                $first = count($prev) <= 1;
                tg_send_message((int)$adm['value'],
                    "🆘 <b>Поддержка</b> — " . htmlspecialchars($who, ENT_QUOTES, 'UTF-8')
                    . ($meta ? "\n" . htmlspecialchars(implode(' · ', $meta), ENT_QUOTES, 'UTF-8') : '')
                    . ($first ? "\n<i>Пишет впервые.</i>" : '')
                    . "\n\n" . htmlspecialchars($text, ENT_QUOTES, 'UTF-8')
                    . "\n\n<i>Ответить — в дашборде, раздел «Поддержка».</i>",
                    DASHBOARD_URL . '/support', '🖥 Открыть дашборд');
            }

            // Вне часов работы — сразу говорим, когда ответим.
            $hour = (int)gmdate('G', time() + 3 * 3600);
            if ($hour < SUPPORT_FROM_HOUR || $hour >= SUPPORT_TO_HOUR) {
                sb_insert('jm_support_messages', [
                    'id' => uid(), 'user_id' => $uid, 'direction' => 'out',
                    'text' => 'Спасибо, получили! Поддержка отвечает с '
                        . SUPPORT_FROM_HOUR . ':00 до ' . SUPPORT_TO_HOUR . ':00 по Москве — '
                        . 'ответим, как начнём. Если вопрос срочный, напишите об этом здесь же.',
                    'created_at' => now_iso(),
                ]);
            }
            $data = ['ok' => true]; break;
        }

        // Ответ поддержки. Человеку — всеми каналами: он ждёт именно его.
        case 'supportReply': {
            $uid = (string)($args[0] ?? '');
            $text = trim((string)($args[1] ?? ''));
            if ($uid === '' || $text === '') { $data = ['ok' => false]; break; }
            sb_insert('jm_support_messages', [
                'id' => uid(), 'user_id' => $uid, 'direction' => 'out',
                'text' => $text, 'created_at' => now_iso(),
            ]);
            notify_user($uid, '🆘 Ответ поддержки', $text, 'support');
            $data = ['ok' => true]; break;
        }

        // Все обращения для дашборда — свежие сверху.
        case 'supportThreads':
            $data = sb_select('jm_support_messages', [], 'id,user_id,direction,text,created_at',
                'created_at.desc'); break;

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
            $u = sb_single('jm_users', ['id' => 'eq.' . $args[0]], 'telegram_id');
            $btn = isset($args[2]) && $args[2] ? true : false; // показать кнопку «Открыть JobToo»
            $data = ($u && !empty($u['telegram_id']))
                ? tg_send_message((int)$u['telegram_id'], (string)$args[1], $btn, '🚀 Открыть JobToo')
                : false;
            break;
        }

        // ── Vacancies ──────────────────────────────────────────────────────────
        case 'dbGetVacancies':
            $data = sb_select('jm_vacancies', [], '*', 'created_at.desc'); break;

        case 'dbUpsertVacancy':
            vacancy_dates_guard([$args[0]]);
            vacancy_content_guard($args[0]);
            save_then_geocode('jm_vacancies', $args[0]); break;

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
            sb_upsert('jm_vacancies', $rows, 'id'); break;
        }

        case 'dbUpdateVacancy':
            // Если правят адрес, координаты пересчитываем: иначе метка
            // осталась бы висеть на старом месте.
            vacancy_dates_guard([$args[1]]);
            vacancy_content_guard($args[1]);
            sb_update('jm_vacancies', ['id' => 'eq.' . $args[0]], fill_coords($args[1])); break;

        // ── Likes ──────────────────────────────────────────────────────────────
        case 'dbGetLikes':
            $data = sb_select('jm_likes'); break;

        case 'dbGetLikesForUser': {
            $field = $args[1] === 'worker' ? 'worker_id' : 'employer_id';
            $data = sb_select('jm_likes', [$field => 'eq.' . $args[0]]); break;
        }

        case 'dbGetLikesByVacancy':
            $data = sb_select('jm_likes', ['vacancy_id' => 'eq.' . $args[0]]); break;

        case 'dbGetVacancyStatsMap': {
            $rows = sb_select_all('jm_likes', [], 'vacancy_id,worker_liked,employer_liked,worker_skipped,is_match');
            $viewRows = sb_select_all('jm_vacancy_views', [], 'vacancy_id');
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
                ['Prefer: resolution=ignore-duplicates,return=minimal']);
            break;
        }

        case 'dbLogOpen': {
            // Событие «открыл приложение». args: [anon_id, user_id|null, role|null, platform|null]
            $anon = isset($args[0]) ? (string)$args[0] : '';
            if ($anon === '') { $data = false; break; }
            sb('POST', 'jm_app_opens', [], [
                'anon_id'   => $anon,
                'user_id'   => $args[1] ?? null,
                'role'      => $args[2] ?? null,
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
            $sourceId = isset($args[4]) ? trim((string)$args[4]) : '';
            $platform = isset($args[5]) ? (string)$args[5] : '';
            $campaignId = isset($args[6]) ? trim((string)$args[6]) : '';
            $channel = isset($args[7]) ? (string)$args[7] : '';

            $events = ['guest_started', 'vacancy_impression', 'apply_intent',
                'registration_started', 'registration_completed', 'external_click',
                'campaign_published', 'campaign_open', 'campaign_apply', 'campaign_shared'];
            $kinds = ['', 'shift', 'permanent', 'external'];
            $platforms = ['', 'web', 'ios', 'android', 'windows', 'macos'];
            $channels = ['', 'telegram_group', 'telegram_dm', 'user_share'];
            if ($anon === '' || strlen($anon) > 128 || !preg_match('/^[A-Za-z0-9._:-]+$/', $anon)
                || !in_array($event, $events, true)
                || !in_array($kind, $kinds, true)
                || !in_array($platform, $platforms, true)
                || !in_array($channel, $channels, true)
                || strlen($vacancyId) > 160 || strlen($sourceId) > 160
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
                'source_id' => $sourceId !== '' ? $sourceId : null,
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

        case 'dbGetPermVacancyViewsMap': {
            $rows = sb_select_all('jm_perm_vacancy_views', [], 'vacancy_id');
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
                ['Prefer: resolution=ignore-duplicates,return=minimal']);
            break;
        }

        case 'dbGetLikeByVacancyWorker':
            $data = sb_single('jm_likes', ['vacancy_id' => 'eq.' . $args[0], 'worker_id' => 'eq.' . $args[1]]); break;

        case 'dbUpsertLike': {
            [$vid, $wid, $eid, $upd] = [$args[0], $args[1], $args[2], $args[3]];
            $base = sb_single('jm_likes', ['vacancy_id' => 'eq.' . $vid, 'worker_id' => 'eq.' . $wid]) ?? [
                'id' => uid(), 'vacancy_id' => $vid, 'worker_id' => $wid, 'employer_id' => $eid,
                'worker_liked' => false, 'employer_liked' => null, 'worker_skipped' => false,
                'is_match' => false, 'matched_at' => null,
                'worker_confirmed' => false, 'employer_confirmed' => false,
                'worker_rated' => false, 'employer_rated' => false, 'shift_completed' => false,
            ];
            $row = array_merge($base, [
                'worker_liked'       => $upd['workerLiked']       ?? $base['worker_liked'],
                'employer_liked'     => $upd['employerLiked']     ?? $base['employer_liked'],
                'worker_skipped'     => $upd['workerSkipped']     ?? $base['worker_skipped'],
                'is_match'           => $upd['isMatch']           ?? $base['is_match'],
                'matched_at'         => $upd['matchedAt']         ?? $base['matched_at'],
                'worker_confirmed'   => $upd['workerConfirmed']   ?? $base['worker_confirmed'],
                'employer_confirmed' => $upd['employerConfirmed'] ?? $base['employer_confirmed'],
                'worker_rated'       => $upd['workerRated']       ?? $base['worker_rated'],
                'employer_rated'     => $upd['employerRated']     ?? $base['employer_rated'],
                'shift_completed'    => $upd['shiftCompleted']    ?? $base['shift_completed'],
            ]);
            $written = sb_upsert('jm_likes', $row, 'vacancy_id,worker_id', true);
            if (empty($written)) throw new RuntimeException('Like not saved: permission denied');

            // Директору об отклике на смену — тоже отсюда. Тот же случай, что
            // и с постоянными вакансиями: раньше сообщение слал телефон
            // соискателя уже после записи, и терялось оно молча.
            $justApplied = !empty($row['worker_liked']) && empty($base['worker_liked']);
            if ($justApplied && !empty($eid)) {
                $w = sb_single('jm_users', ['id' => 'eq.' . $wid], 'first_name,last_name');
                $v = sb_single('jm_vacancies', ['id' => 'eq.' . $vid], 'title');
                $wName = trim(($w['first_name'] ?? '') . ' ' . ($w['last_name'] ?? '')) ?: 'Кандидат';
                $vTitle = (string)($v['title'] ?? 'смена');
                notify_user((string)$eid, '📥 Новый отклик!',
                    $wName . ' хочет выйти на смену «' . $vTitle . '». Посмотрите кандидата!',
                    'new_applicant', [],
                    // В пуш — без имени: он уходит за границу. Директор всё
                    // равно открывает приложение, чтобы посмотреть кандидата,
                    // и имя в шторке ничего не решает.
                    'Кто-то хочет выйти на смену «' . $vTitle . '». Посмотрите кандидата!');
            }
            $data = $row; break;
        }

        case 'dbRemoveLike':
            sb_delete('jm_likes', ['vacancy_id' => 'eq.' . $args[0], 'worker_id' => 'eq.' . $args[1]]); break;

        case 'dbDeleteMatch':
            sb_delete('jm_likes', ['id' => 'eq.' . $args[0]]); break;

        // ── Messages ───────────────────────────────────────────────────────────
        case 'dbGetMessages':
            $data = sb_select('jm_messages', ['chat_id' => 'eq.' . $args[0]], '*', 'created_at.asc'); break;

        case 'dbInsertMessage': {
            $msg = ['id' => uid(), 'chat_id' => $args[0], 'sender_id' => $args[1], 'text' => $args[2], 'created_at' => now_iso()];
            msg_insert($msg);
            $data = $msg; break;
        }

        // ── Файлы ──────────────────────────────────────────────────────────────
        // Аватары, фотографии и голосовые из чатов.
        //
        // Раньше приложение клало их в хранилище само, ключом, который лежит
        // в каждой установленной сборке. Чтобы это работало, тому ключу нужно
        // право записи — то есть любой, кто достанет его из сборки, мог бы
        // залить в наше хранилище что угодно и сколько угодно.
        //
        // Теперь файл идёт сюда, а отсюда в хранилище служебным ключом,
        // который не покидает сервер. Заодно здесь же проверяется пропуск
        // приложения — там его не было вовсе.
        //
        // args: [имя файла, содержимое в base64, тип]
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
            $author = $args[8] ?? false;
            $data = chat_ensure($wid, $eid, (string)$vid, (string)$vt, (string)$cn,
                                $sm, (int)$uw, (int)$ue,
                                is_string($author) ? $author : (bool)$author);
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
            $row = sb_single('jm_chats', ['id' => 'eq.' . $args[0]], 'unread_worker,unread_employer');
            if (!$row) break;
            $f = $args[1] === 'worker' ? 'unread_worker' : 'unread_employer';
            $cur = $args[1] === 'worker' ? ($row['unread_worker'] ?? 0) : ($row['unread_employer'] ?? 0);
            sb_update('jm_chats', ['id' => 'eq.' . $args[0]], [$f => $cur + 1]); break;
        }

        // Разовая уборка после перехода на «один чат — одна пара людей».
        // Пары, у которых чатов больше одного, сливаем в старший: перед каждым
        // блоком ставим карточку его вакансии, сообщения переносим с их
        // временем, лишний чат удаляем (сообщения к этому моменту уже не его).
        //
        // args: [apply] — без true только считает и показывает план.
        // Повторный запуск безопасен: сливать станет нечего.
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
            sb_insert('jm_complaints', [
                'id' => uid(), 'reporter_id' => $p['reporterId'], 'reporter_phone' => $p['reporterPhone'],
                'reporter_company' => $p['reporterCompany'] ?? null, 'target_id' => $p['targetId'],
                'target_phone' => $p['targetPhone'], 'target_company' => $p['targetCompany'] ?? null,
                'complaint_type' => $p['complaintType'], 'description' => $p['description'] ?? null,
                'created_at' => now_iso(),
            ]); break;
        }

        // ── Match logic ────────────────────────────────────────────────────────
        case 'dbCheckAndCreateMatch': {
            [$vid, $wid] = [$args[0], $args[1]];
            $like = sb_single('jm_likes', ['vacancy_id' => 'eq.' . $vid, 'worker_id' => 'eq.' . $wid]);
            if (!$like) { $data = ['matched' => false]; break; }
            $eid = $like['employer_id'];
            if ($like['is_match']) {
                $ec = sb_single('jm_chats', ['worker_id' => 'eq.' . $wid, 'employer_id' => 'eq.' . $eid], 'id');
                $data = ['matched' => false, 'chatId' => $ec['id'] ?? null]; break;
            }
            if (!$like['worker_liked'] || $like['employer_liked'] !== true) { $data = ['matched' => false]; break; }
            sb_update('jm_likes', ['vacancy_id' => 'eq.' . $vid, 'worker_id' => 'eq.' . $wid],
                ['is_match' => true, 'matched_at' => now_iso()]);
            $vac = sb_single('jm_vacancies', ['id' => 'eq.' . $vid]);

            // Чат ищем по паре людей: со вторым мэтчем разговор продолжается
            // там же, где начался, а не заводится заново.
            $ec2 = sb_single('jm_chats', ['worker_id' => 'eq.' . $wid, 'employer_id' => 'eq.' . $eid], 'id');
            $isNewChat = !$ec2;
            $cid = $ec2['id'] ?? uid();
            if ($isNewChat) {
                sb_insert('jm_chats', [
                    'id' => $cid, 'vacancy_id' => $vid, 'worker_id' => $wid,
                    'employer_id' => $eid, 'vac_title' => $vac['title'] ?? '',
                    'company_name' => $vac['company'] ?? '', 'unread_worker' => 1, 'unread_employer' => 1,
                    'created_at' => now_iso(),
                ]);
            } else {
                sb_update('jm_chats', ['id' => 'eq.' . $cid], [
                    'vacancy_id' => $vid,
                    'vac_title' => $vac['title'] ?? '',
                    'company_name' => $vac['company'] ?? '',
                ]);
            }

            // Карточка смены открывает блок: дальше в чате может идти речь о
            // другой смене, и без неё непонятно, к чему относится разговор.
            $card = vacancy_card_text($vid);
            if ($card) {
                msg_insert(['id' => uid(), 'chat_id' => $cid, 'sender_id' => 'system',
                    'text' => $card, 'created_at' => now_iso()]);
            }
            msg_insert(['id' => uid(), 'chat_id' => $cid, 'sender_id' => 'system',
                'text' => '🎉 У вас мэтч! Вы подошли друг другу. Познакомьтесь и обсудите детали!', 'created_at' => now_iso()]);
            // Предупреждение о безопасности — один раз, при заведении чата.
            // Повторять его на каждую смену незачем: читать перестанут.
            if ($isNewChat) {
                msg_insert(['id' => uid(), 'chat_id' => $cid, 'sender_id' => 'system_safety',
                    'text' => "🔒 Рекомендуем не переводить общение в сторонние мессенджеры или почту, а продолжить его в чате JobToo: так у мошенников будет меньше шансов вас обмануть.\n\nГде бы вы ни общались — не сообщайте свой CVV-код, код из SMS и не вводите данные карты по ссылке.",
                    'created_at' => now_iso()]);
            }
            if ($vac) {
                $nf = ($vac['workers_found'] ?? 0) + 1;
                sb_update('jm_vacancies', ['id' => 'eq.' . $vid],
                    ['workers_found' => $nf, 'status' => $nf >= ($vac['workers_needed'] ?? 999) ? 'closed' : 'open']);
            }
            $data = ['matched' => true, 'chatId' => $cid]; break;
        }

        // ── Permanent vacancies ────────────────────────────────────────────────
        case 'dbGetPermVacancies':
            $data = sb_select('jm_perm_vacancies', ['status' => 'eq.open'], '*', 'created_at.desc'); break;

        case 'dbGetPermVacanciesByEmployer':
            $data = sb_select('jm_perm_vacancies', ['employer_id' => 'eq.' . $args[0]], '*', 'created_at.desc'); break;

        case 'dbUpsertPermVacancy':
            vacancy_content_guard($args[0]);
            save_then_geocode('jm_perm_vacancies', $args[0]); break;

        case 'dbClosePermVacancy':
            sb_update('jm_perm_vacancies', ['id' => 'eq.' . $args[0]], ['status' => 'closed']); break;

        case 'dbDeleteVacancy':
            sb_delete('jm_vacancies', ['id' => 'eq.' . $args[0]]); break;

        case 'dbDeletePermVacancy':
            sb_delete('jm_perm_vacancies', ['id' => 'eq.' . $args[0]]); break;

        // ── Permanent applications ─────────────────────────────────────────────
        case 'dbGetPermApplications': {
            $f = $args[1] === 'worker' ? 'worker_id' : 'employer_id';
            $data = sb_select('jm_perm_applications', [$f => 'eq.' . $args[0]], '*', 'created_at.desc'); break;
        }

        case 'dbGetPermApplicationsForVacancy':
            $data = sb_select('jm_perm_applications', ['vacancy_id' => 'eq.' . $args[0]], '*', 'created_at.desc'); break;

        case 'dbApplyPermVacancy': {
            [$vid, $wid, $eid, $sm] = [$args[0], $args[1], $args[2], $args[3] ?? null];
            sb_upsert('jm_perm_applications', [
                'id' => uid(), 'vacancy_id' => $vid, 'worker_id' => $wid,
                'employer_id' => $eid, 'status' => 'pending', 'created_at' => now_iso(),
            ], 'vacancy_id,worker_id');

            // Отклик на постоянную вакансию раньше уходил молча: строка в
            // таблице со статусом «ожидает», и всё. Работодатель видел имя в
            // списке и решал вслепую, а сказать о себе человеку было негде —
            // при том что именно на постоянные приходится большая часть
            // откликов. Теперь отклик открывает переписку, как и на сменах.
            $pv = sb_single('jm_perm_vacancies', ['id' => 'eq.' . $vid], 'title,company');
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

        case 'dbSetPermApplicationStatus':
            sb_update('jm_perm_applications', ['id' => 'eq.' . $args[0]], ['status' => $args[1]]); break;

        // ── Permanent saved ────────────────────────────────────────────────────
        case 'dbGetPermSaved': {
            $rows = sb_select('jm_perm_saved', ['user_id' => 'eq.' . $args[0]], 'vacancy_id');
            $data = array_map(fn($r) => $r['vacancy_id'], $rows); break;
        }

        case 'dbAddPermSaved':
            sb_upsert('jm_perm_saved', ['user_id' => $args[0], 'vacancy_id' => $args[1]]); break;

        case 'dbRemovePermSaved':
            sb_delete('jm_perm_saved', ['user_id' => 'eq.' . $args[0], 'vacancy_id' => 'eq.' . $args[1]]); break;

        // ── Ratings ────────────────────────────────────────────────────────────
        case 'dbGetRatingsForUser':
            $data = sb_select('jm_ratings', ['to_user_id' => 'eq.' . $args[0]], '*', 'created_at.desc'); break;

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
        case 'dbSavePushToken':
            sb_update('jm_users', ['push_token' => 'eq.' . $args[1], 'id' => 'neq.' . $args[0]], ['push_token' => null]);
            sb_update('jm_users', ['id' => 'eq.' . $args[0]], ['push_token' => $args[1]]); break;

        // Выход из аккаунта. Без этого сервер продолжал слать уведомления на
        // телефон, с которого человек вышел: приложение он не удалял, а токен
        // так и лежал в его строке.
        case 'dbClearPushToken':
            sb_update('jm_users', ['id' => 'eq.' . $args[0]], ['push_token' => null]); break;

        // Разбор завалов: те, кто вышел до появления dbClearPushToken, так и
        // остались с токеном в базе, а войти и почиститься не могут — они же
        // вышли. Здесь ищем по самому токену, аккаунт знать не нужно.
        case 'dbReleasePushToken':
            sb_update('jm_users', ['push_token' => 'eq.' . $args[0]], ['push_token' => null]); break;

        case 'dbGetPushToken': {
            $r = sb_single('jm_users', ['id' => 'eq.' . $args[0]], 'push_token');
            $data = $r['push_token'] ?? null; break;
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
            $payload = count($msgs) === 1 ? $msgs[0] : $msgs;
            $ch = curl_init('https://exp.host/--/api/v2/push/send');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($payload),
                CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
                CURLOPT_TIMEOUT => 15,
            ]);
            $resp = curl_exec($ch); curl_close($ch);
            $data = json_decode($resp ?: 'null', true); break;
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
            $groupHtml = (string)($args[4] ?? '');
            // Старые клиенты не шлют groupHtml — собираем пост из tgHtml,
            // чтобы группа получала ВСЕ вакансии независимо от версии приложения
            if ($groupHtml === '' && (string)($args[2] ?? '') !== '') {
                $groupHtml = (string)$args[2]
                    . "\n\n⚡ В приложении смены появляются раньше — откликайся первым 👇";
            }
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

        case 'dbMarkNotifRead':
            sb_update('jm_notifications', ['id' => 'eq.' . $args[0]], ['is_read' => true]); break;

        case 'dbMarkAllNotifsRead':
            sb_update('jm_notifications', ['user_id' => 'eq.' . $args[0]], ['is_read' => true]); break;

        case 'dbDeleteNotif':
            sb_delete('jm_notifications', ['id' => 'eq.' . $args[0]]); break;

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
