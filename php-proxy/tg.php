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

/** Отдать ответ, отбросив всё, что случайно напечаталось до него. */
function jt_respond(array $payload, int $code = 200): void {
    if (ob_get_level() > 0) ob_end_clean();
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
}

// Telegram bot webhook:
// - /start и любые сообщения в личке → приветствие с кнопкой приложения
// - callback-кнопки «Одобрить/Отклонить» под заявками на вакансии
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

// Секреты приложения — из окружения либо из файла app_secrets.php рядом
// (см. app_secrets.example.php). Та же функция есть в db.php: файлы на хостинг
// кладутся по отдельности, общий include лишний раз всё усложнил бы.
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

// Запасного значения тут нарочно нет. Прежний токен утёк вместе с открытым
// репозиторием, и посторонний переписывал боту описание на рекламу. Токен
// отозван и живёт только в GitHub Secrets (TG_BOT_TOKEN), откуда выкладка
// собирает app_secrets.php. Если он не задан — лучше явная тишина, чем
// работа на ключе, который знает чужой.
define('TG_BOT_TOKEN', jt_secret('TG_BOT_TOKEN'));
define('TG_WORK_GROUP_CHAT_ID', (int)(getenv('TG_WORK_GROUP_CHAT_ID') ?: -1004358116342));
define('TG_CLAUDE_BOT_USERNAME', ltrim((string)(getenv('TG_CLAUDE_BOT_USERNAME') ?: 'JobTooClaudebot'), '@'));
define('TG_CODEX_BRIDGE_PR', (int)(getenv('TG_CODEX_BRIDGE_PR') ?: 62));
define('JT_CROSSBORDER_CONSENT_VERSION', '2026-09-19');

// Ключ доступа к базе — та же схема, что и в db.php: сервисный ключ с
// хостинга, анонимный лишь как запасной вариант. Подробности там же.

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

// ── Supabase helpers ──────────────────────────────────────────────────────────

function sb(string $method, string $table, array $query = [], $body_data = null,
           string $prefer = 'return=minimal'): array {
    $url = SB_URL . '/rest/v1/' . $table;
    if (!empty($query)) $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => [
            'apikey: ' . SB_KEY,
            'Authorization: Bearer ' . SB_KEY,
            'Content-Type: application/json',
            'Prefer: ' . $prefer,
        ],
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($body_data !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body_data));
    $resp = curl_exec($ch); curl_close($ch);
    $dec = json_decode($resp ?: '[]', true);
    return is_array($dec) ? $dec : [];
}

function sb_one(string $table, array $filters, string $select = '*'): ?array {
    $rows = sb('GET', $table, array_merge(['select' => $select, 'limit' => '1'], $filters));
    return !empty($rows) && isset($rows[0]) ? $rows[0] : null;
}

/**
 * Есть ли у пользователя отдельное действующее согласие на трансграничную
 * передачу. Вебхук Telegram — отдельная точка входа и не может полагаться
 * только на проверки db.php.
 */
function jt_has_crossborder_consent(string $userId): bool {
    if ($userId === '') return false;
    $rows = sb('GET', 'jm_consents', [
        'select' => 'docs,source,accepted_at',
        'user_id' => 'eq.' . $userId,
        'order' => 'accepted_at.desc',
        'limit' => '20',
    ]);

    foreach ($rows as $row) {
        $source = (string)($row['source'] ?? '');
        $docs = $row['docs'] ?? [];
        if (is_string($docs)) $docs = json_decode($docs, true) ?: [];
        $version = is_array($docs) ? (string)($docs['crossBorderConsent'] ?? '') : '';

        if (str_starts_with($source, 'crossborder:')) {
            return $source !== 'crossborder:revoked'
                && $version !== ''
                && hash_equals(JT_CROSSBORDER_CONSENT_VERSION, $version);
        }

        // Короткий переходный период: отдельная галочка уже существовала,
        // но её версия ещё лежала внутри общей записи согласия.
        if ($version !== '' && hash_equals(JT_CROSSBORDER_CONSENT_VERSION, $version)) {
            return true;
        }
    }
    return false;
}

function uid(): string {
    return base_convert(time(), 10, 36) . substr(base_convert(mt_rand(), 10, 36), 2, 5);
}

function now_iso(): string {
    $ms = intval(microtime(true) * 1000) % 1000;
    return gmdate('Y-m-d\TH:i:s') . '.' . str_pad((string)$ms, 3, '0', STR_PAD_LEFT) . 'Z';
}

// ── Настройки ────────────────────────────────────────────────────────────────
// Пока в них лежит одно: кому пересылать то, что люди пишут боту.

function setting_get(string $key): string {
    $row = sb_one('jm_settings', ['key' => 'eq.' . $key], 'value');
    return (string)($row['value'] ?? '');
}

function setting_set(string $key, string $value): void {
    sb('POST', 'jm_settings', ['on_conflict' => 'key'],
        [['key' => $key, 'value' => $value, 'updated_at' => now_iso()]],
        'return=minimal,resolution=merge-duplicates');
}

// ── Ящик переписки с ботом ───────────────────────────────────────────────────
//
// Пишем обе стороны. Раньше сохранялись только входящие, и карточка
// администратору приходила голой строкой: человек отвечал на вопрос, заданный
// шесть часов назад, а в телеграм прилетало «Да я работаю щас» с пометкой
// «нужен ваш ответ» — понять, о чём это, было нельзя.

function bot_log(int $chatId, string $direction, string $text, array $extra = []): void {
    sb('POST', 'jm_bot_messages', [], array_merge([
        'id' => uid(),
        'telegram_id' => $chatId,
        'direction' => $direction,
        'text' => $text,
        'created_at' => now_iso(),
    ], array_filter($extra, fn($v) => $v !== null)));
}

/** Последние ходы переписки, свежие первыми. */
function bot_history(int $chatId, int $limit = 4): array {
    return sb('GET', 'jm_bot_messages', [
        'select' => 'direction,text,created_at',
        'telegram_id' => 'eq.' . $chatId,
        'order' => 'created_at.desc',
        'limit' => (string)$limit,
    ]);
}

/** Блок «до этого» для карточки. Пусто — значит человек пишет впервые. */
function bot_history_block(array $rows): string {
    if (empty($rows)) return "\n\n<i>Пишет впервые.</i>";
    $lines = [];
    foreach (array_reverse($rows) as $r) {
        $t = trim(preg_replace('/\s+/u', ' ', (string)($r['text'] ?? '')));
        if ($t === '') continue;
        if (mb_strlen($t, 'UTF-8') > 90) $t = mb_substr($t, 0, 90, 'UTF-8') . '…';
        $lines[] = (($r['direction'] ?? 'in') === 'out' ? '🤖 ' : '👤 ')
                 . htmlspecialchars($t, ENT_QUOTES, 'UTF-8');
    }
    return $lines ? "\n\n<i>До этого:</i>\n" . implode("\n", $lines) : '';
}

/** Создаёт чат работник↔директор по вакансии (или возвращает существующий) */
function ensure_chat(string $workerId, string $employerId, string $vacancyId, string $vacTitle, string $company, string $systemMsg): string {
    $ex = sb_one('jm_chats', ['vacancy_id' => 'eq.' . $vacancyId, 'worker_id' => 'eq.' . $workerId], 'id');
    if ($ex) return $ex['id'];
    $cid = uid();
    sb('POST', 'jm_chats', [], [
        'id' => $cid, 'vacancy_id' => $vacancyId, 'worker_id' => $workerId,
        'employer_id' => $employerId, 'vac_title' => $vacTitle, 'company_name' => $company,
        'unread_worker' => 1, 'unread_employer' => 0, 'created_at' => now_iso(),
    ]);
    sb('POST', 'jm_messages', [], [
        'id' => uid(), 'chat_id' => $cid, 'sender_id' => 'system',
        'text' => $systemMsg, 'created_at' => now_iso(),
    ]);
    return $cid;
}

// ── Telegram helpers ──────────────────────────────────────────────────────────

function tg(string $method, array $payload): array {
    // Два захода: сперва по IPv6, потом как выйдет. К Телеграму с этой
    // машины IPv4 не доходит — 0 ответов из 2 в каждом замере, — а когда
    // стек не указан, система нет-нет да и выберет именно его. Здесь это
    // означало бы, что человек нажал кнопку в боте и не получил ответа.
    foreach ([CURL_IPRESOLVE_V6, CURL_IPRESOLVE_WHATEVER] as $mode) {
        $ch = curl_init('https://api.telegram.org/bot' . TG_BOT_TOKEN . '/' . $method);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT => 10,
            CURLOPT_IPRESOLVE => $mode,
            CURLOPT_POSTFIELDS => json_encode($payload),
        ]);
        $resp = curl_exec($ch); curl_close($ch);
        $dec = json_decode($resp ?: 'null', true);
        if (is_array($dec)) return $dec;
    }
    return [];
}

/** Токен GitHub хранится отдельно от секретов приложения и наружу не уходит. */
function github_token(): string {
    $file = '/var/www/api/gh_token.php';
    $value = is_readable($file) ? @include $file : null;
    return is_string($value) ? trim($value) : '';
}

/** Запрос к GitHub от имени служебного пользователя. */
function github_api(string $token, string $method, string $path, $payload = null): array {
    $ch = curl_init('https://api.github.com/repos/nikidav9/Jobbbrbeb' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => [
            'Accept: application/vnd.github+json',
            'Authorization: Bearer ' . $token,
            'X-GitHub-Api-Version: 2022-11-28',
            'User-Agent: JobToo-Telegram-Bridge',
            'Content-Type: application/json',
        ],
    ]);
    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
    }
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $result = json_decode($raw ?: 'null', true);
    return ['status' => $status, 'data' => is_array($result) ? $result : []];
}

/**
 * Публикует задачу в постоянном PR-мосте. Комментарий к PR — поддерживаемое
 * событие Codex Work: оно будит исполнителя сразу, а не ждёт опроса. Метка
 * сохраняет тему Telegram и позволяет не выполнить повторно ретрай вебхука.
 */
function github_queue_work_message(
    string $text,
    int $chatId,
    int $threadId,
    int $messageId,
    string $source
): array {
    $token = github_token();
    if ($token === '') return ['ok' => false, 'error' => 'GitHub-токен не настроен'];
    $pr = TG_CODEX_BRIDGE_PR;
    $source = preg_replace('/[^A-Za-z0-9_@.-]/', '', $source) ?: 'unknown';
    $marker = "<!-- jobtoo-telegram-task chat={$chatId} thread={$threadId} message={$messageId} source={$source} -->";

    // Telegram повторяет обновление, если не получил 200 вовремя. Не будим
    // Codex второй раз для того же исходного сообщения.
    $recent = github_api($token, 'GET', "/issues/{$pr}/comments?per_page=100");
    if ($recent['status'] === 200) {
        foreach ($recent['data'] as $comment) {
            if (strpos((string)($comment['body'] ?? ''), $marker) !== false) {
                return ['ok' => true, 'duplicate' => true, 'number' => $pr,
                    'url' => "https://github.com/nikidav9/Jobbbrbeb/pull/{$pr}"];
            }
        }
    }

    $body = $text . "\n\n" . $marker;
    $r = github_api($token, 'POST', "/issues/{$pr}/comments", ['body' => $body]);
    if ($r['status'] !== 201) {
        return ['ok' => false, 'error' => (string)($r['data']['message'] ?? "GitHub HTTP {$r['status']}")];
    }
    return ['ok' => true, 'duplicate' => false, 'number' => $pr,
        'url' => (string)($r['data']['html_url'] ?? "https://github.com/nikidav9/Jobbbrbeb/pull/{$pr}")];
}

/** Ответ в ту же тему форума, откуда пришла задача. */
function tg_work_reply(int $chatId, int $threadId, string $text): array {
    $payload = ['chat_id' => $chatId, 'text' => $text, 'disable_web_page_preview' => true];
    if ($threadId > 0) $payload['message_thread_id'] = $threadId;
    return tg('sendMessage', $payload);
}

function expo_push_one(string $token, string $title, string $body): void {
    require_once __DIR__ . '/apns.php';
    $parts = jt_push_token_parts($token);

    if ($parts['apns'] !== '' && jt_apns_ready()) {
        $result = jt_apns_push_generic('apns:' . $parts['apns'], 'perm_status');
        if (!empty($result['ok'])) return;
    }

    if ($parts['expo'] === '') return;
    $ch = curl_init('https://exp.host/--/api/v2/push/send');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
        CURLOPT_TIMEOUT => 10,
        CURLOPT_POSTFIELDS => json_encode([
            'to' => $parts['expo'], 'title' => $title, 'body' => $body,
            'sound' => 'default', 'priority' => 'high', 'channelId' => 'matches',
            'data' => ['type' => 'perm_status'],
        ]),
    ]);
    curl_exec($ch); curl_close($ch);
}

/** Уведомляет работника по всем доступным каналам */
function notify_worker(string $workerId, string $title, string $body): void {
    // Колокольчик — всегда: он хранится в российской базе.
    sb('POST', 'jm_notifications', [], ['user_id' => $workerId, 'title' => $title, 'body' => $body]);

    // Telegram и Expo — иностранные каналы. Без отдельного действующего
    // согласия пользователь увидит событие только внутри JobToo.
    if (!jt_has_crossborder_consent($workerId)) return;

    $w = sb_one('jm_users', ['id' => 'eq.' . $workerId], 'telegram_id,push_token');
    if (!$w) return;
    if (!empty($w['telegram_id'])) {
        tg('sendMessage', [
            'chat_id' => (int)$w['telegram_id'],
            'text' => $title . "\n\n" . $body,
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => '🚀 Открыть JobToo', 'url' => 'https://t.me/JobToo_bot/app'],
            ]]],
        ]);
    }
    if (!empty($w['push_token'])) {
        expo_push_one($w['push_token'], $title, $body);
    }
}

// ── Кто прислал обновление ───────────────────────────────────────────────────
//
// Адрес обработчика публичен и угадывается с первого раза. Без проверки любой
// желающий может прислать поддельное обновление — например, привязать свой
// телеграм к чужой учётной записи. Раньше от этого закрывала пересылка через
// Vercel: она проверяла заголовок сама. Теперь Телеграм ходит сюда напрямую и
// шлёт тот же заголовок нам, если при setWebhook задан secret_token.
//
// Послабление на время переезда. Выложенная на Vercel пересылка заголовок
// проверяет, но дальше не передаёт: для неё мы — доверенный адрес. Пока
// вебхук может откатиться туда, отсутствие заголовка приходится считать
// допустимым. Управляет этим сторож: он создаёт метку, когда возвращает
// вебхук на пересылку, и убирает её, когда путь прямой. Так строгая проверка
// не превращается в молчащего бота в ту минуту, когда что-то пойдёт не так.
$tgSecret = $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '';
if ($tgSecret !== '' || !file_exists('/var/www/api/tg_relay_mode')) {
    $sec = @include '/var/www/api/app_secrets.php';
    $ok = [];
    if (is_array($sec)) {
        foreach (['APP_SECRET', 'APP_SECRET_PREV'] as $k) {
            $v = (string)($sec[$k] ?? '');
            if ($v !== '') $ok[] = $v;
        }
    }
    $pass = false;
    foreach ($ok as $v) { if (hash_equals($v, $tgSecret)) { $pass = true; break; } }
    if (!$pass) { jt_respond(['ok' => false], 401); exit; }
}

// ── Update parsing ────────────────────────────────────────────────────────────

$update = json_decode(file_get_contents('php://input'), true);
if (!is_array($update)) { echo json_encode(['ok' => true]); exit; }

// ── Callback-кнопки (Одобрить/Отклонить заявку) ──────────────────────────────

$cb = $update['callback_query'] ?? null;
if ($cb) {
    $data = (string)($cb['data'] ?? '');
    $cbId = $cb['id'] ?? '';
    $chatId = $cb['message']['chat']['id'] ?? null;
    $msgId = $cb['message']['message_id'] ?? null;
    $origText = $cb['message']['text'] ?? '';

    // Ответ на опрос в один тап (первый опрос — «почему не пользуетесь» для
    // спящих). Записываем выбор, благодарим и мягко зовём обратно кнопкой.
    // callback_data вида survey_<ключ>_<ответ>.
    if (preg_match('/^survey_([a-z0-9_]+)_(no_shifts|no_time|confusing|found_job|other)$/', $data, $sm)) {
        $surveyKey = $sm[1];
        $answer = $sm[2];
        $u = $chatId ? sb_one('jm_users', ['telegram_id' => 'eq.' . $chatId], 'id') : null;
        // Один ответ на человека на опрос: повтор обновляет прежний выбор.
        sb('POST', 'jm_survey_responses', ['on_conflict' => 'survey_key,user_id'], [
            'survey_key' => $surveyKey,
            'user_id'    => $u['id'] ?? null,
            'answer'     => $answer,
            'created_at' => now_iso(),
        ], ['Prefer: resolution=merge-duplicates,return=minimal']);
        tg('answerCallbackQuery', ['callback_query_id' => $cbId, 'text' => 'Спасибо! 🙏']);
        tg('editMessageText', [
            'chat_id' => $chatId,
            'message_id' => $msgId,
            'text' => 'Спасибо — это правда помогает нам стать лучше 🙏',
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => '🔎 Посмотреть смены рядом', 'url' => 'https://t.me/JobToo_bot/app'],
            ]]],
        ]);
        echo json_encode(['ok' => true]); exit;
    }

    // Настройки рекламных уведомлений о вакансиях. По умолчанию остаётся
    // прежний режим «все»: фильтрация включается только явным выбором человека.
    if (preg_match('/^vacnotif_(all|work_types|metro|work_types_metro|off)$/', $data, $nm)) {
        $mode = $nm[1];
        $u = $chatId ? sb_one('jm_users', ['telegram_id' => 'eq.' . $chatId], 'id') : null;
        if (!$u) {
            tg('answerCallbackQuery', ['callback_query_id' => $cbId,
                'text' => 'Сначала подключите Telegram в профиле JobToo']);
            echo json_encode(['ok' => true]); exit;
        }
        sb('PATCH', 'jm_users', ['id' => 'eq.' . $u['id']], [
            'vacancy_delivery_mode' => $mode,
            // Старое «не писать» относится к тем же рекламным сообщениям.
            'nudge_off' => $mode === 'off',
        ]);
        $labels = [
            'all' => 'Все вакансии',
            'work_types' => 'Только мои профессии',
            'metro' => 'Только у моего метро',
            'work_types_metro' => 'Мои профессии у моего метро',
            'off' => 'Рассылка выключена',
        ];
        tg('answerCallbackQuery', ['callback_query_id' => $cbId,
            'text' => 'Сохранено: ' . $labels[$mode]]);
        if ($chatId) {
            tg('sendMessage', [
                'chat_id' => $chatId,
                'text' => "✅ <b>Настройки сохранены</b>\n\n" . $labels[$mode]
                    . "\n\nПрофессии и метро берутся из вашего профиля JobToo.",
                'parse_mode' => 'HTML',
                'reply_markup' => ['inline_keyboard' => [[
                    ['text' => '🚀 Открыть профиль', 'url' => 'https://t.me/JobToo_bot/app?startapp=profile'],
                ]]],
            ]);
        }
        echo json_encode(['ok' => true]); exit;
    }

    // «💬 Написать кандидату» — создаёт чат (без смены статуса заявки) и даёт кнопку в него
    if (preg_match('/^appmsg_(.+)$/', $data, $mm)) {
        $appId = $mm[1];
        $app = sb_one('jm_perm_applications', ['id' => 'eq.' . $appId], 'id,worker_id,employer_id,vacancy_id,status');
        if (!$app) {
            tg('answerCallbackQuery', ['callback_query_id' => $cbId, 'text' => 'Заявка не найдена']);
            echo json_encode(['ok' => true]); exit;
        }
        $vac = sb_one('jm_perm_vacancies', ['id' => 'eq.' . $app['vacancy_id']], 'title,company');
        $vTitle = $vac['title'] ?? 'вакансию';
        $chatId2 = ensure_chat(
            $app['worker_id'], $app['employer_id'] ?? '', $app['vacancy_id'],
            $vTitle, $vac['company'] ?? '',
            "💬 Директор хочет обсудить ваш отклик на «{$vTitle}». Напишите ему!"
        );
        // Кандидату — знать, что ему написали
        notify_worker($app['worker_id'],
            '💬 Директор написал вам',
            "По вашему отклику на «{$vTitle}» открыт чат — ответьте в разделе «Чаты»!");
        // Директору — кнопка прямо в чат
        if ($chatId) {
            tg('sendMessage', [
                'chat_id' => $chatId,
                'text' => "💬 Чат с кандидатом открыт — можно писать:",
                'reply_markup' => ['inline_keyboard' => [[
                    ['text' => '💬 Открыть чат', 'url' => 'https://t.me/JobToo_bot/app?startapp=chat_' . $chatId2],
                ]]],
            ]);
        }
        tg('answerCallbackQuery', ['callback_query_id' => $cbId, 'text' => 'Чат создан!']);
        echo json_encode(['ok' => true]); exit;
    }

    if (preg_match('/^app(ok|no)_(.+)$/', $data, $m)) {
        $approve = $m[1] === 'ok';
        $appId = $m[2];

        $app = sb_one('jm_perm_applications', ['id' => 'eq.' . $appId], 'id,worker_id,employer_id,vacancy_id,status');
        if (!$app) {
            tg('answerCallbackQuery', ['callback_query_id' => $cbId, 'text' => 'Заявка не найдена']);
            echo json_encode(['ok' => true]); exit;
        }

        if ($app['status'] !== 'pending') {
            tg('answerCallbackQuery', ['callback_query_id' => $cbId, 'text' => 'Уже обработана ранее']);
            echo json_encode(['ok' => true]); exit;
        }

        // Обновляем статус
        sb('PATCH', 'jm_perm_applications', ['id' => 'eq.' . $appId], ['status' => $approve ? 'approved' : 'rejected']);

        // Уведомляем работника (при одобрении — открываем чат, как делает приложение)
        $vac = sb_one('jm_perm_vacancies', ['id' => 'eq.' . $app['vacancy_id']], 'title,company');
        $vTitle = $vac['title'] ?? 'вакансию';
        if ($approve) {
            $employerId = $app['employer_id'] ?? '';
            $newChatId = '';
            if ($employerId !== '') {
                // Кнопкой в телеграме директор написать не может, поэтому первый
                // ход прямо отдаём работнику. Прежний текст «свяжитесь с
                // кандидатом» уходил обоим сразу, и оба ждали друг друга: в
                // переписке так и оставалось два системных сообщения.
                $newChatId = ensure_chat(
                    $app['worker_id'], $employerId, $app['vacancy_id'],
                    $vTitle, $vac['company'] ?? '',
                    "✅ Вас одобрили на вакансию «{$vTitle}». Напишите директору первым: когда сможете выйти и какой у вас опыт."
                );
            }
            notify_worker($app['worker_id'],
                '✅ Заявка одобрена!',
                "Вашу заявку на «{$vTitle}» одобрили. Откройте чат и напишите директору — он ждёт вашего сообщения.");
            if ($chatId && $newChatId !== '') {
                tg('sendMessage', [
                    'chat_id' => $chatId,
                    'text' => "💬 Чат с кандидатом открыт. Напишите ему первым — так договоритесь быстрее.",
                    'reply_markup' => ['inline_keyboard' => [[
                        ['text' => '💬 Открыть чат', 'url' => 'https://t.me/JobToo_bot/app?startapp=chat_' . $newChatId],
                    ]]],
                ]);
            }
        } else {
            notify_worker($app['worker_id'],
                'По заявке отказ',
                "По вакансии «{$vTitle}» вам отказали. Посмотрите другие открытые вакансии — их много!");
        }

        // Обновляем сообщение у директора
        $mark = $approve ? '✅ ВЫ ОДОБРИЛИ ЭТУ ЗАЯВКУ' : '❌ Вы отклонили эту заявку';
        if ($chatId && $msgId) {
            tg('editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => $origText . "\n\n" . $mark,
                'reply_markup' => ['inline_keyboard' => [[
                    ['text' => '🚀 Открыть JobToo', 'url' => 'https://t.me/JobToo_bot/app'],
                ]]],
            ]);
        }
        tg('answerCallbackQuery', ['callback_query_id' => $cbId, 'text' => $approve ? 'Одобрено! Работник уведомлён' : 'Отклонено. Работник уведомлён']);
        echo json_encode(['ok' => true]); exit;
    }

    tg('answerCallbackQuery', ['callback_query_id' => $cbId]);
    echo json_encode(['ok' => true]); exit;
}

// ── Обычные сообщения в личке ────────────────────────────────────────────────

$msg = $update['message'] ?? null;
if (!$msg || empty($msg['chat']['id'])) { echo json_encode(['ok' => true]); exit; }

$chatId = (int)$msg['chat']['id'];
$chatType = (string)($msg['chat']['type'] ?? '');

// Внутренняя рабочая группа: сообщения администраторов превращаются в задачи
// Codex. Все ответы остаются в исходной теме Telegram. Публичные группы с
// вакансиями сюда не попадают и продолжают жить по прежней логике.
if ($chatId === TG_WORK_GROUP_CHAT_ID && in_array($chatType, ['group', 'supergroup'], true)) {
    $text = trim((string)($msg['text'] ?? $msg['caption'] ?? ''));
    $threadId = (int)($msg['message_thread_id'] ?? 0);
    $messageId = (int)($msg['message_id'] ?? 0);
    $fromId = (int)($msg['from']['id'] ?? 0);
    $fromUsername = ltrim((string)($msg['from']['username'] ?? ''), '@');
    $fromBot = !empty($msg['from']['is_bot']);
    if ($text === '' || $fromId === 0) {
        echo json_encode(['ok' => true]); exit;
    }

    if ($fromBot) {
        // В BotFather для обоих включается Bot-to-Bot Communication Mode.
        // Здесь доверяем только рабочему боту Claude.
        if (strcasecmp($fromUsername, TG_CLAUDE_BOT_USERNAME) !== 0) {
            echo json_encode(['ok' => true]); exit;
        }

        // Обычные ответы Claude пользователю не должны становиться задачами
        // Codex. Принимаем только явное обращение или прямой reply нашему боту.
        $mentioned = stripos($text, '@JobToo_bot') !== false
            || preg_match('/^\s*Codex\s*:/iu', $text) === 1;
        $replyUsername = ltrim((string)($msg['reply_to_message']['from']['username'] ?? ''), '@');
        if (!$mentioned && strcasecmp($replyUsername, 'JobToo_bot') !== 0) {
            echo json_encode(['ok' => true]); exit;
        }
        $text = trim((string)preg_replace('/@JobToo_bot\b|^\s*Codex\s*:\s*/iu', '', $text));
        if ($text === '') { echo json_encode(['ok' => true]); exit; }
    } else {
        $member = tg('getChatMember', ['chat_id' => $chatId, 'user_id' => $fromId]);
        $status = (string)($member['result']['status'] ?? '');
        if (!in_array($status, ['creator', 'administrator'], true)) {
            tg_work_reply($chatId, $threadId, '⛔ Задачи принимаются только от администраторов рабочей группы.');
            echo json_encode(['ok' => true]); exit;
        }
    }

    $source = $fromBot ? '@' . $fromUsername : ($fromUsername !== '' ? '@' . $fromUsername : (string)$fromId);
    $queued = github_queue_work_message($text, $chatId, $threadId, $messageId, $source);
    if (empty($queued['ok'])) {
        tg_work_reply($chatId, $threadId,
            '⚠️ Не удалось передать задачу Codex: ' . (string)($queued['error'] ?? 'неизвестная ошибка'));
        echo json_encode(['ok' => true]); exit;
    }

    // Claude не подтверждаем отдельным сообщением: его автоответ на квитанцию
    // мог бы создать бесконечный диалог двух ботов. Итог всё равно вернётся в
    // эту тему. Человеку квитанция полезна и безопасна.
    if (!$fromBot && empty($queued['duplicate'])) {
        tg_work_reply($chatId, $threadId,
            "📥 Задачу получил. Codex начал работу.\n{$queued['url']}\n\nГотовый результат пришлю отдельным сообщением сюда.");
    }
    echo json_encode(['ok' => true]); exit;
}

if ($chatType !== 'private') { echo json_encode(['ok' => true]); exit; }

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

$text = trim($msg['text'] ?? '');
$firstName = $msg['from']['first_name'] ?? '';

// ── Привязка аккаунта из приложения: /start link_<userId> ───────────────────
if (preg_match('/^\/start\s+link_([a-z0-9]+)$/i', $text, $lm)) {
    $userId = $lm[1];
    $pending = tg_pending_read();
    $hasPending = isset($pending[$userId]);
    $u = $hasPending && jt_has_crossborder_consent($userId)
        ? sb_one('jm_users', ['id' => 'eq.' . $userId], 'id,first_name')
        : null;
    if ($u) {
        unset($pending[$userId]);
        tg_pending_write($pending);
        // Один Telegram — один аккаунт: освобождаем этот telegram_id у других
        sb('PATCH', 'jm_users', ['telegram_id' => 'eq.' . $chatId], ['telegram_id' => null]);
        sb('PATCH', 'jm_users', ['id' => 'eq.' . $userId], ['telegram_id' => $chatId]);
        tg('sendMessage', [
            'chat_id' => $chatId,
            'text' => "✅ <b>Telegram подключён!</b>\n\nТеперь сюда будут приходить:\n⚡ новые смены и вакансии\n📥 ответы директоров на отклики\n💬 уведомления о сообщениях\n\nМожно вернуться в приложение 👌",
            'parse_mode' => 'HTML',
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => '🚀 Открыть JobToo', 'url' => 'https://t.me/JobToo_bot/app'],
            ]]],
        ]);
    } else {
        tg('sendMessage', [
            'chat_id' => $chatId,
            'text' => 'Не удалось подтвердить запрос на привязку. Откройте JobToo, подтвердите отдельное согласие на трансграничную передачу и подключите Telegram ещё раз.',
        ]);
    }
    echo json_encode(['ok' => true]); exit;
}

// Голый «/start»: метка не дошла (чат с ботом уже существовал). Берём
// самую свежую заявку, оставленную приложением, и привязываем к ней.
if (preg_match('/^\/start\s*$/', $text)) {
    $pending = tg_pending_read();
    if (!empty($pending)) {
        arsort($pending);                       // самая свежая — первая
        // Идём по заявкам, пока не найдём живой аккаунт. Раньше смотрели
        // только на первую: если она осталась от удалённого аккаунта, привязка
        // не срабатывала ни у кого следующие 15 минут, и заявка так и висела.
        $userId = null; $u = null;
        foreach (array_keys($pending) as $cand) {
            if (!jt_has_crossborder_consent((string)$cand)) {
                unset($pending[$cand]);
                continue;
            }
            $row = sb_one('jm_users', ['id' => 'eq.' . $cand], 'id,first_name');
            if ($row) { $userId = (string)$cand; $u = $row; break; }
            unset($pending[$cand]);             // такого аккаунта нет — выбрасываем
        }
        if ($u) {
            unset($pending[$userId]);
            tg_pending_write($pending);
            sb('PATCH', 'jm_users', ['telegram_id' => 'eq.' . $chatId], ['telegram_id' => null]);
            sb('PATCH', 'jm_users', ['id' => 'eq.' . $userId], ['telegram_id' => $chatId]);
            tg('sendMessage', [
                'chat_id' => $chatId,
                'text' => "✅ <b>Telegram подключён!</b>\n\nТеперь сюда будут приходить:\n⚡ новые смены и вакансии\n📥 ответы директоров на отклики\n💬 уведомления о сообщениях\n\nМожно вернуться в приложение 👌",
                'parse_mode' => 'HTML',
                'reply_markup' => ['inline_keyboard' => [[
                    ['text' => '🚀 Открыть JobToo', 'url' => 'https://t.me/JobToo_bot/app'],
                ]]],
            ]);
            echo json_encode(['ok' => true]); exit;
        }
        tg_pending_write($pending);             // мусор из мёртвых заявок не копим
    }
}

if (preg_match('/^\/(settings|notifications)(?:@\\w+)?$/i', $text)) {
    $u = sb_one('jm_users', ['telegram_id' => 'eq.' . $chatId],
        'id,metro_station,work_types,vacancy_delivery_mode');
    if (!$u) {
        tg('sendMessage', [
            'chat_id' => $chatId,
            'text' => "Сначала подключите Telegram в профиле JobToo — после этого я смогу сохранить ваши настройки.",
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => '🚀 Открыть JobToo', 'url' => 'https://t.me/JobToo_bot/app'],
            ]]],
        ]);
        echo json_encode(['ok' => true]); exit;
    }
    $mode = (string)($u['vacancy_delivery_mode'] ?? 'all');
    $metro = trim((string)($u['metro_station'] ?? ''));
    $workTypes = $u['work_types'] ?? [];
    if (is_string($workTypes)) {
        $decoded = json_decode($workTypes, true);
        $workTypes = is_array($decoded) ? $decoded : [];
    }
    $profile = "Метро: " . ($metro !== '' ? $metro : 'не указано')
        . "\nПрофессий в профиле: " . count(is_array($workTypes) ? $workTypes : []);
    tg('sendMessage', [
        'chat_id' => $chatId,
        'text' => "🔔 <b>Какие вакансии присылать?</b>\n\n" . $profile
            . "\n\nПо умолчанию JobToo присылает все вакансии. Выберите фильтр:",
        'parse_mode' => 'HTML',
        'reply_markup' => ['inline_keyboard' => [
            [['text' => ($mode === 'all' ? '✓ ' : '') . 'Все вакансии', 'callback_data' => 'vacnotif_all']],
            [['text' => ($mode === 'work_types' ? '✓ ' : '') . 'Только мои профессии', 'callback_data' => 'vacnotif_work_types']],
            [['text' => ($mode === 'metro' ? '✓ ' : '') . 'Только у моего метро', 'callback_data' => 'vacnotif_metro']],
            [['text' => ($mode === 'work_types_metro' ? '✓ ' : '') . 'Профессия + метро', 'callback_data' => 'vacnotif_work_types_metro']],
            [['text' => ($mode === 'off' ? '✓ ' : '') . 'Не присылать вакансии', 'callback_data' => 'vacnotif_off']],
            [['text' => '✏️ Изменить профиль', 'url' => 'https://t.me/JobToo_bot/app?startapp=profile']],
        ]],
    ]);
    echo json_encode(['ok' => true]); exit;
}

if (str_starts_with($text, '/start')) {
    tg('sendMessage', [
        'chat_id' => $chatId,
        'text' => "Привет" . ($firstName !== '' ? ", $firstName" : '') . "! 👋\n\n"
            . "<b>JobToo</b> — подработки и постоянные вакансии на складах Москвы.\n\n"
            . "⚡ Смены рядом с твоим метро\n"
            . "💼 Постоянная работа от проверенных директоров\n"
            . "💬 Отклик и чат с работодателем в два тапа\n\n"
            . "Открой приложение — без установки, прямо здесь 👇",
        'parse_mode' => 'HTML',
        'reply_markup' => ['inline_keyboard' => [[
            ['text' => '🚀 Открыть JobToo', 'url' => 'https://t.me/JobToo_bot/app'],
        ]]],
    ]);
    echo json_encode(['ok' => true]); exit;
}

// ── Живые сообщения боту ─────────────────────────────────────────────────────
//
// Раньше на любое человеческое сообщение бот отвечал «Все смены и вакансии —
// в приложении 👇» и выбрасывал его. Мы даже не знали, сколько людей нам
// писали: следов не оставалось.
//
// Всплыло, когда понадобилось спросить работников, почему они заходят и не
// откликаются. Спрашивать через бота было бессмысленно — ответы утекали бы
// в никуда.

$adminChat = (int)setting_get('admin_chat_id');

// Кому пересылать. Один раз: первый, кто скажет боту это слово, и становится
// адресатом. Переназначить можно через прокси (fn botAdminSet) — то есть
// зная X-App-Secret, а не угадав команду.
if (preg_match('/^\/admin$/i', $text)) {
    if ($adminChat === 0) {
        setting_set('admin_chat_id', (string)$chatId);
        tg('sendMessage', ['chat_id' => $chatId,
            'text' => "✅ Готово. Сюда будут приходить сообщения, которые люди пишут боту.\n\n"
                    . "Чтобы ответить — просто ответьте (reply) на пересланное сообщение, "
                    . "и человек получит ваш текст от бота."]);
    } else {
        tg('sendMessage', ['chat_id' => $chatId,
            'text' => $chatId === $adminChat
                ? 'Вы уже назначены получателем.'
                : 'Получатель уже назначен.']);
    }
    echo json_encode(['ok' => true]); exit;
}

// Ответ администратора реплаем на пересланное — доносим человеку. Адрес
// зашит в самом пересланном сообщении меткой #w<id>: держать переписку
// в памяти негде, а реплай её и так помнит.
if ($adminChat !== 0 && $chatId === $adminChat && $text !== '') {
    $src = (string)($msg['reply_to_message']['text'] ?? '');
    if ($src !== '' && preg_match('/#w(\d+)/', $src, $rm)) {
        $to = (int)$rm[1];
        $ok = tg('sendMessage', ['chat_id' => $to, 'text' => $text]);
        // Свой ответ тоже в журнал: иначе через день не вспомнить, что уже сказано.
        bot_log($to, 'out', $text, ['name' => 'Никита', 'topic' => 'admin']);
        tg('sendMessage', ['chat_id' => $chatId,
            'text' => ($ok['ok'] ?? false) ? '✅ Отправлено' : '⚠️ Не доставлено']);
        sb('PATCH', 'jm_bot_messages', ['telegram_id' => 'eq.' . $to, 'answered' => 'is.false'],
            ['answered' => true]);
        echo json_encode(['ok' => true]); exit;
    }
}

// Всё остальное: сохраняем, пробуем ответить сами, пересылаем.
if ($text !== '' && $chatId !== $adminChat) {
    $u = sb_one('jm_users', ['telegram_id' => 'eq.' . $chatId],
        'id,first_name,last_name,phone,role,metro_station');
    $who = trim(($u['first_name'] ?? $firstName) . ' ' . ($u['last_name'] ?? ''));

    // Переписку читаем ДО того, как записать новое сообщение: в карточке
    // нужно «что было раньше», а не «что было раньше вместе с этим».
    $history = bot_history($chatId, 4);

    bot_log($chatId, 'in', $text, [
        'user_id' => $u['id'] ?? null,
        'name' => $who,
        'username' => $msg['from']['username'] ?? null,
    ]);

    require_once __DIR__ . '/bot_brain.php';
    $ans = bot_answer($u ?? [], $text);

    // Назвал станцию, а в профиле пусто — запоминаем. Именно этого нам не
    // хватает, чтобы предлагать смены рядом, а не веером по всей Москве.
    if ($ans && !empty($ans['station']) && $u && empty($u['metro_station'])) {
        $stations = bot_stations();
        sb('PATCH', 'jm_users', ['id' => 'eq.' . $u['id']], [
            'metro_station' => $ans['station'],
            'metro_line_id' => $stations[$ans['station']] ?? null,
        ]);
    }

    // Попросил не писать — запоминаем, иначе через два дня напоминание придёт
    // снова, и вежливый ответ окажется враньём. Ответы директоров и сообщения
    // в чате это не отключает: отписка от напоминаний — не отписка от работы.
    if ($ans && ($ans['topic'] ?? '') === 'stop' && $u) {
        sb('PATCH', 'jm_users', ['id' => 'eq.' . $u['id']], ['nudge_off' => true]);
    }

    if ($ans) {
        $payload = ['chat_id' => $chatId, 'text' => $ans['text']];
        if (!empty($ans['button'])) {
            $payload['reply_markup'] = ['inline_keyboard' => [[
                ['text' => '🚀 Открыть JobToo', 'url' => BOT_APP_URL],
            ]]];
        }
        tg('sendMessage', $payload);
        bot_log($chatId, 'out', $ans['text'], ['name' => 'JobToo', 'topic' => $ans['topic'] ?? null]);
        sb('PATCH', 'jm_bot_messages',
            ['telegram_id' => 'eq.' . $chatId, 'answered' => 'is.false'], ['answered' => true]);
    } else {
        // Не поняли — так и говорим. Придумывать ответ хуже, чем передать
        // человеку: выдуманному ответу человек поверит.
        $ack = 'Спасибо, получил. Передал Никите — он ответит здесь же.';
        tg('sendMessage', ['chat_id' => $chatId, 'text' => $ack]);
        bot_log($chatId, 'out', $ack, ['name' => 'JobToo', 'topic' => 'ack']);
    }

    if ($adminChat !== 0) {
        $mark = $ans === null                     ? '❗ <b>нужен ваш ответ</b>'
              : ($ans['escalate'] === 'urgent'    ? '🔴 <b>срочно</b>'
              : ($ans['escalate'] === 'need'      ? '❗ <b>нужен ваш ответ</b>'
              : '🤖 бот ответил сам'));
        $meta = array_filter([
            $u['role'] ?? null,
            $u['phone'] ?? null,
            $ans['station'] ?? ($u['metro_station'] ?? null),
        ]);
        // Копию шлём всегда, даже когда бот справился: видеть разговор целиком
        // важнее, чем беречь ленту — вмешаться можно в любой момент.
        if ($ans === null || $ans['escalate'] !== 'none') {
            tg('sendMessage', [
                'chat_id' => $adminChat,
                'text' => "📩 <b>" . htmlspecialchars($who ?: 'Без имени', ENT_QUOTES, 'UTF-8') . "</b>  " . $mark
                    . ($meta ? "\n" . htmlspecialchars(implode(' · ', $meta), ENT_QUOTES, 'UTF-8') : '')
                    . "\n\n" . htmlspecialchars($text, ENT_QUOTES, 'UTF-8')
                    . bot_history_block($history)
                    . "\n\n<i>Ответьте на это сообщение — человек получит ваш текст.</i> #w{$chatId}",
                'parse_mode' => 'HTML',
            ]);
        }
    }

    echo json_encode(['ok' => true]); exit;
}

tg('sendMessage', [
    'chat_id' => $chatId,
    'text' => 'Все смены и вакансии — в приложении 👇',
    'reply_markup' => ['inline_keyboard' => [[
        ['text' => '🚀 Открыть JobToo', 'url' => 'https://t.me/JobToo_bot/app'],
    ]]],
]);

echo json_encode(['ok' => true]);
