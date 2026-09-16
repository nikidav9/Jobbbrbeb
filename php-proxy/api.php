<?php
// Внешнее API JobToo, версия 1.
//
// Зачем отдельный файл, а не ещё несколько функций в db.php. Тот устроен для
// своего приложения: один общий пропуск, внутренние имена полей, ответы
// меняются вместе с продуктом. Всё это правильно для своего клиента, который
// обновляется вместе с сервером, и всё это недопустимо для чужого, который
// узнает об изменении, когда у него сломается.
//
// Поэтому здесь три вещи делаются иначе:
//
//   1. Ключи отдельные, по одному на партнёра, с правами и отзывом. Пропуск
//      приложения сюда не подходит: он лежит в собранном коде сайта.
//   2. Имена полей публичные и наши внутренние не повторяют. jm_perm_vacancies
//      завтра может стать чем угодно, а `type: "permanent"` останется.
//   3. Версия в адресе. Ломающее изменение — это /v2, а не сюрприз у партнёра
//      в понедельник утром.
//
// Персональных данных здесь нет вовсе, и это не предосторожность, а условие
// существования: как только в выдаче появится телефон или имя человека, всё
// это перестанет быть техническим вопросом и станет юридическим.

@ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');

// Общие обращения к базе — в отдельном файле: тем же набором пользуется
// забор чужих фидов, и держать две расходящиеся копии одних и тех же
// двадцати строк себе дороже.
require_once __DIR__ . '/sb_lite.php';

function api_out(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function api_error(int $code, string $slug, string $message): void
{
    // Со словами, а не только с номером. Партнёр читает это в чужой стране
    // и в чужой день, и «400» без объяснения стоит ему часа переписки.
    api_out($code, ['error' => ['code' => $slug, 'message' => $message]]);
}

// ── Кто пришёл ────────────────────────────────────────────────────────────

function api_key_row(): array
{
    $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($hdr === '' && function_exists('apache_request_headers')) {
        $h = apache_request_headers();
        $hdr = $h['Authorization'] ?? '';
    }
    if (!preg_match('/^Bearer\s+(\S+)$/i', trim($hdr), $m)) {
        api_error(401, 'no_key', 'Нужен заголовок Authorization: Bearer <ключ>');
    }

    // Сверяем по отпечатку: сам ключ у нас не хранится, и восстановить его
    // из базы нельзя даже нам.
    $hash = hash('sha256', $m[1]);
    $row = sb_single('jm_api_keys', ['key_hash' => 'eq.' . $hash, 'revoked_at' => 'is.null']);
    if (!$row) api_error(401, 'bad_key', 'Ключ неизвестен или отозван');

    // Ограничение частоты. Счётчик в пределах часа: сменился час — начали
    // заново. Грубо, зато без отдельного хранилища и без фонового чистильщика.
    $bucket = gmdate('Y-m-d\TH');
    $hits = ($row['hour_bucket'] ?? '') === $bucket ? (int)$row['hits'] + 1 : 1;
    $limit = (int)($row['rate_limit'] ?? 1000);
    if ($hits > $limit) {
        header('Retry-After: ' . (3600 - (int)gmdate('i') * 60));
        api_error(429, 'rate_limit', "Не больше $limit запросов в час");
    }
    sb_update('jm_api_keys', ['id' => 'eq.' . $row['id']], [
        'hour_bucket' => $bucket, 'hits' => $hits, 'last_used_at' => now_iso(),
    ]);

    header('X-RateLimit-Limit: ' . $limit);
    header('X-RateLimit-Remaining: ' . max(0, $limit - $hits));
    return $row;
}

function api_require_scope(array $key, string $scope): void
{
    $have = $key['scopes'] ?? [];
    if (!is_array($have)) $have = [];
    if (!in_array($scope, $have, true)) {
        api_error(403, 'no_scope', "У ключа нет права «$scope»");
    }
}

// ── Публичная форма вакансии ──────────────────────────────────────────────
//
// Отдаём только то, что нужно, чтобы показать смену человеку и привести его
// к нам. Ни employer_id, ни телефонов, ни счётчиков просмотров: чужой системе
// они не нужны, а нам потом объясняй, зачем отдали.

function api_shift(array $r): array
{
    return [
        'id'          => 'shift_' . $r['id'],
        'type'        => 'shift',
        'title'       => $r['title'] ?? null,
        'company'     => $r['company'] ?? null,
        'category'    => $r['work_type'] ?? null,
        'category_label' => $r['work_type_label'] ?? null,
        'metro'       => $r['metro_station'] ?? null,
        'address'     => $r['address'] ?? null,
        'location'    => isset($r['lat'], $r['lng']) && $r['lat'] !== null
                         ? ['lat' => (float)$r['lat'], 'lon' => (float)$r['lng']] : null,
        'date'        => $r['date'] ?? null,
        'time_start'  => $r['time_start'] ?? null,
        'time_end'    => $r['time_end'] ?? null,
        'pay'         => $r['salary'] !== null ? (float)$r['salary'] : null,
        'currency'    => 'RUB',
        'pay_period'  => 'shift',
        // Сколько ещё нужно людей — это и есть смысл публикации.
        'spots_total' => (int)($r['workers_needed'] ?? 0),
        'spots_left'  => max(0, (int)($r['workers_needed'] ?? 0) - (int)($r['workers_found'] ?? 0)),
        'urgent'      => (bool)($r['is_urgent'] ?? false),
        'no_experience' => (bool)($r['no_experience_needed'] ?? false),
        'conditions'  => $r['conditions'] ?? null,
        'status'      => $r['status'] ?? null,
        'url'         => 'https://jobtoo.ru/vacancy-detail?id=' . rawurlencode((string)$r['id']),
        'created_at'  => $r['created_at'] ?? null,
        'updated_at'  => $r['updated_at'] ?? $r['created_at'] ?? null,
    ];
}

function api_perm(array $r): array
{
    return [
        'id'          => 'perm_' . $r['id'],
        'type'        => 'permanent',
        'title'       => $r['title'] ?? null,
        'company'     => $r['company'] ?? null,
        'metro'       => $r['metro_station'] ?? null,
        'address'     => $r['address'] ?? null,
        'pay'         => $r['salary'] !== null ? (float)$r['salary'] : null,
        'currency'    => 'RUB',
        'pay_period'  => 'month',
        'schedule'    => $r['schedule'] ?? null,
        'description' => $r['description'] ?? null,
        'status'      => $r['status'] ?? null,
        'url'         => 'https://jobtoo.ru/perm-vacancy-detail?id=' . rawurlencode((string)$r['id']),
        'created_at'  => $r['created_at'] ?? null,
        'updated_at'  => $r['created_at'] ?? null,
    ];
}

// ── Маршруты ──────────────────────────────────────────────────────────────

$path = trim((string)($_SERVER['PATH_INFO'] ?? ''), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Описание отдаём без ключа: чтобы получить ключ, надо сперва понять, что
// здесь вообще есть.
if ($path === 'openapi.json') {
    readfile(__DIR__ . '/openapi.json');
    exit;
}

if ($path === 'health') {
    api_out(200, ['status' => 'ok', 'time' => now_iso()]);
}

if ($method !== 'GET') {
    api_error(405, 'method_not_allowed', 'Поддерживается только GET');
}

$key = api_key_row();

switch ($path) {
    case 'vacancies': {
        api_require_scope($key, 'vacancies:read');

        $limit  = min(200, max(1, (int)($_GET['limit'] ?? 50)));
        $offset = max(0, (int)($_GET['offset'] ?? 0));
        $type   = (string)($_GET['type'] ?? 'all');
        $metro  = trim((string)($_GET['metro'] ?? ''));
        // Для догрузки, а не выкачивания всего каждый раз. Партнёру нужен
        // способ спросить «что изменилось с прошлого раза», иначе он будет
        // тянуть весь список по кругу.
        $since  = trim((string)($_GET['updated_since'] ?? ''));

        $items = [];

        if ($type === 'all' || $type === 'shift') {
            $f = ['status' => 'eq.open', 'order' => 'created_at.desc', 'limit' => (string)($limit + $offset)];
            if ($metro !== '') $f['metro_station'] = 'eq.' . $metro;
            if ($since !== '') $f['updated_at'] = 'gte.' . $since;
            foreach (sb_select('jm_vacancies', $f) as $r) $items[] = api_shift($r);
        }
        if ($type === 'all' || $type === 'permanent') {
            $f = ['status' => 'eq.open', 'order' => 'created_at.desc', 'limit' => (string)($limit + $offset)];
            if ($metro !== '') $f['metro_station'] = 'eq.' . $metro;
            if ($since !== '') $f['created_at'] = 'gte.' . $since;
            foreach (sb_select('jm_perm_vacancies', $f) as $r) $items[] = api_perm($r);
        }

        usort($items, fn($a, $b) => strcmp((string)$b['created_at'], (string)$a['created_at']));
        $page = array_slice($items, $offset, $limit);

        api_out(200, [
            'items' => $page,
            'count' => count($page),
            'has_more' => count($items) > $offset + $limit,
        ]);
    }

    case 'metro': {
        api_require_scope($key, 'vacancies:read');
        // Справочник станций, по которым сейчас есть открытые смены. Нужен,
        // чтобы партнёр не гадал, какие значения подставлять в фильтр.
        $seen = [];
        foreach (['jm_vacancies', 'jm_perm_vacancies'] as $t) {
            foreach (sb_select($t, ['status' => 'eq.open', 'select' => 'metro_station', 'limit' => '2000']) as $r) {
                $m = trim((string)($r['metro_station'] ?? ''));
                if ($m !== '') $seen[$m] = ($seen[$m] ?? 0) + 1;
            }
        }
        arsort($seen);
        api_out(200, ['items' => array_map(
            fn($n, $c) => ['name' => $n, 'open_vacancies' => $c],
            array_keys($seen), array_values($seen)
        )]);
    }
}

api_error(404, 'not_found', 'Такого раздела нет. См. /api/v1/openapi.json');
