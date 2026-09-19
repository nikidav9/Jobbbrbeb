<?php
// Доставка секретов на сервер.
//
// На Reg.ru секреты попадали вместе с кодом: GitHub собирал app_secrets.php
// из своих настроек и клал по FTP. Сюда положить нечем — ни FTP, ни ssh.
// Первый раз пропуск приложения я принёс разовой формой, руками; повторять
// это при каждой смене пароля нельзя.
//
// Поэтому канал: GitHub стучится сюда и приносит те же значения, что клал на
// хостинг. Доступ — по отдельному токену, который знают только сервер и
// настройки репозитория. Пропуск приложения для этого не годится: он лежит
// в собранном коде сайта, то есть известен всем, кто откроет страницу.
//
// Файл не попадает на Reg.ru: выкладка туда перечисляет файлы поимённо.

header('Content-Type: application/json; charset=utf-8');

function out(int $code, array $body): void
{
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

$file  = __DIR__ . '/deploy_token.php';
$token = is_readable($file) ? (string) @include $file : '';
$given = $_SERVER['HTTP_X_DEPLOY_TOKEN'] ?? '';

// Токена нет — значит сервер к этому не готовили, и открывать нечего.
if ($token === '' || !is_string($given) || $given === '' || !hash_equals($token, $given)) {
    out(403, ['ok' => false, 'error' => 'нет доступа']);
}

// Показать, что уже лежит. Значений не отдаём — только есть или нет.
if (($_GET['check'] ?? '') !== '') {
    $have = [];
    foreach (['app_secrets.php', 'admin_credentials.php', 'sb_service_key.php', 'sb_url.php'] as $f) {
        $p = __DIR__ . '/' . $f;
        if (!is_readable($p)) { $have[$f] = 'нет'; continue; }
        $v = @include $p;
        if (is_array($v)) {
            foreach ($v as $k => $x) $have[$k] = strlen((string) $x) ? 'есть' : 'пусто';
        } else {
            $have[$f] = strlen((string) $v) ? 'есть' : 'пусто';
        }
    }
    out(200, ['ok' => true, 'секреты' => $have]);
}

$in = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($in)) {
    out(400, ['ok' => false, 'error' => 'тело не разобрал']);
}

// Пишем через временный файл: PHP может прочитать наполовину записанный
// файл ровно в тот момент, когда мы его переписываем, и тогда отвалится
// вход в приложение — на секунду, но у всех сразу.
function put(string $path, string $php): bool
{
    $tmp = $path . '.new';
    if (@file_put_contents($tmp, $php, LOCK_EX) === false) return false;
    @chmod($tmp, 0640);
    return @rename($tmp, $path);
}

function literal(string $v): string
{
    // Через base64: в пароле могут быть кавычки и слэши, экранировать нечего.
    return "base64_decode('" . base64_encode($v) . "')";
}

$done = [];

// Пропуск приложения и токен бота.
//
// Пустые значения не затирают уже лежащее: если в настройках репозитория
// какой-то ключ не задан, это «не трогай», а не «сотри». Иначе одна забытая
// настройка молча выключила бы бота.
$app = $in['app'] ?? null;
if (is_array($app)) {
    $cur = [];
    if (is_readable(__DIR__ . '/app_secrets.php')) {
        $v = @include __DIR__ . '/app_secrets.php';
        if (is_array($v)) $cur = $v;
    }
    $appKeys = [
        'APP_SECRET', 'APP_SECRET_PREV', 'TG_BOT_TOKEN',
        'YANDEX_GEOCODER_KEY', 'YANDEX_SUGGEST_KEY',
        'SUPERJOB_SECRET_KEY', 'SUPERJOB_CLIENT_ID', 'SUPERJOB_CLIENT_SECRET',
        'HH_CLIENT_ID', 'HH_CLIENT_SECRET',
    ];
    foreach ($appKeys as $k) {
        $x = $app[$k] ?? '';
        if (is_string($x) && $x !== '') $cur[$k] = $x;
    }
    $parts = [];
    foreach ($appKeys as $k) {
        $parts[] = "'$k' => " . literal((string) ($cur[$k] ?? ''));
    }
    if (put(__DIR__ . '/app_secrets.php', "<?php return [" . implode(', ', $parts) . "];\n")) {
        $done[] = 'app_secrets.php';
    }
}

// Токен к GitHub — на случай, когда репозиторий закроют.
//
// Сейчас сервер тянет обновления и сборки без пароля, потому что всё
// открыто. Закрытый репозиторий оборвёт и то, и другое, причём загрузку
// сборок молча: сайт останется прежним, а ошибки не будет нигде.
//
// Токен нужен только на чтение. Кладём заранее, чтобы закрытие репозитория
// было одним движением, а не поводом остаться без управления сервером.
$gh = $in['github'] ?? null;
if (is_array($gh) && !empty($gh['token'])) {
    if (put(__DIR__ . '/gh_token.php', "<?php return " . literal((string) $gh['token']) . ";\n")) {
        $done[] = 'gh_token.php';
    }
}

// Ключи к объектному хранилищу — второй адрес для резервных копий.
//
// Тем же каналом, что и остальные секреты, и по той же причине: пересылать
// их перепиской или вписывать руками на сервере — значит оставить их след
// там, откуда потом не вычистишь. Здесь они лежат рядом с прочими и той же
// дорогой обновляются, если ключ придётся сменить.
//
// Ключ должен быть отдельным, с правом только на запись в один бакет: тогда
// взлом сервера не даёт доступа к самим копиям. Проверить это отсюда нельзя,
// но напомнить в документации — можно.
$s3 = $in['backup'] ?? null;
if (is_array($s3) && !empty($s3['bucket']) && !empty($s3['key'])) {
    $parts = [];
    foreach (['endpoint', 'bucket', 'key', 'secret'] as $k) {
        $parts[] = "'$k' => " . literal((string) ($s3[$k] ?? ''));
    }
    if (put(__DIR__ . '/backup_s3.php', "<?php return [" . implode(', ', $parts) . "];\n")) {
        $done[] = 'backup_s3.php';
    }
}

// Вход в панель базы.
//
// Пароль задаёт владелец у себя в настройках репозитория, а не сервер у
// себя. Разница принципиальная: сгенерированный сервером пароль пришлось бы
// как-то передать — через переписку, страницу или журнал, — и он перестал бы
// быть паролем. Заданный владельцем не передаётся вообще: он его и так знает.
$std = $in['studio'] ?? null;
if (is_array($std) && !empty($std['login']) && !empty($std['password'])) {
    $php = "<?php return ['login' => " . literal((string) $std['login'])
         . ", 'password' => " . literal((string) $std['password']) . "];\n";
    if (put(__DIR__ . '/studio_credentials.php', $php)) {
        $done[] = 'studio_credentials.php';
    }
}

// Вход в дашборд.
$adm = $in['admin'] ?? null;
if (is_array($adm) && !empty($adm['login']) && !empty($adm['password'])) {
    $php = "<?php return ['login' => " . literal((string) $adm['login'])
         . ", 'password' => " . literal((string) $adm['password']) . "];\n";
    if (put(__DIR__ . '/admin_credentials.php', $php)) {
        $done[] = 'admin_credentials.php';
    }
}

out(200, ['ok' => true, 'записано' => $done]);
