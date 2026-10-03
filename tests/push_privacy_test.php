<?php

putenv('PUSH_TOKEN_ENCRYPTION_KEY=ci-push-privacy-key');
require_once __DIR__ . '/../php-proxy/push_privacy.php';

function check(string $name, bool $ok): void {
    if (!$ok) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    echo "ok: {$name}\n";
}

$plain = 'ExponentPushToken[test-device-token-123]';
$encrypted = jt_push_encrypt($plain);

check('token зашифрован', str_starts_with($encrypted, JT_PUSH_ENC_PREFIX));
check('plaintext не лежит внутри ciphertext', !str_contains($encrypted, $plain));
check('token расшифровывается только сервером', jt_push_decrypt($encrypted) === $plain);
check('lookup fingerprint стабилен',
    jt_push_lookup_pattern($plain) === jt_push_lookup_pattern($plain));

$prepared = jt_push_prepare_expo_message([
    'to' => $encrypted,
    'title' => 'Иван ответил на вакансию',
    'body' => 'Персональный текст сообщения',
    'channelId' => 'matches',
    'data' => [
        'type' => 'message',
        'userId' => 'user-123',
        'chatId' => 'chat-456',
        'vacancyId' => 'vac-789',
    ],
]);

check('Expo получает исходный provider token для доставки',
    is_array($prepared) && ($prepared['to'] ?? '') === $plain);
check('текст — из таблицы по виду события, а не вызывающего',
    ($prepared['title'] ?? '') === JT_PUSH_EVENTS['message']['title']
    && ($prepared['body'] ?? '') === JT_PUSH_EVENTS['message']['body']);
check('персональное из вызывающего наружу не уходит',
    !str_contains(json_encode($prepared, JSON_UNESCAPED_UNICODE), 'Иван')
    && !str_contains(json_encode($prepared, JSON_UNESCAPED_UNICODE), 'Персональный'));
check('идентификаторы события вычищены, остаётся только вид',
    ($prepared['data'] ?? null) === ['type' => 'message']);

// Неизвестный вид и пустой data — единый нейтральный пуш, как раньше.
$generic = jt_push_prepare_expo_message(['to' => $encrypted, 'title' => 'Секрет', 'body' => 'Секрет',
    'data' => ['type' => 'что-то-новое', 'chatId' => 'c1']]);
check('неизвестный вид: единый заголовок и текст',
    ($generic['title'] ?? '') === JT_PUSH_PUBLIC_TITLE && ($generic['body'] ?? '') === JT_PUSH_PUBLIC_BODY);
check('неизвестный вид: канал default, data.type = refresh',
    ($generic['channelId'] ?? '') === 'default' && ($generic['data'] ?? null) === ['type' => 'refresh']);
$noData = jt_push_prepare_expo_message(['to' => $encrypted, 'title' => 'Секрет']);
check('без data: единый нейтральный пуш', ($noData['title'] ?? '') === JT_PUSH_PUBLIC_TITLE && ($noData['data'] ?? null) === ['type' => 'refresh']);

// Таблица: каждый вид из неё знает свой маршрут по нажатию, ни один текст не личный.
foreach (JT_PUSH_EVENTS as $type => $ev) {
    check("вид $type: есть заголовок, текст и канал",
        $ev['title'] !== '' && $ev['body'] !== '' && in_array($ev['channel'], ['matches', 'vacancies', 'default'], true));
    check("вид $type: без эмодзи и персональных данных в тексте",
        !preg_match('/[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]/u', $ev['title'] . $ev['body']));
}

// Токены двух проектов Expo: пачка отвергается, шлём по одному.
$mixed = [['to' => 'ExponentPushToken[a]'], ['to' => 'ExponentPushToken[b]']];
$calls = [];
$fake = function (array $body, int $t) use (&$calls): array {
    $calls[] = $body;
    if (array_is_list($body)) {
        return ['http' => 400, 'json' => ['errors' => [['code' => 'PUSH_TOO_MANY_EXPERIENCE_IDS', 'message' => 'x']]]];
    }
    // Для одиночного сообщения Expo отвечает объектом, а не списком.
    return ['http' => 200, 'json' => ['data' => ['status' => 'ok', 'id' => 'id-' . $body['to']]]];
};
$r = jt_expo_send($mixed, 5, $fake);
check('смешанные проекты: после отказа пачки шлём по одному (1 пачка + 2 одиночных)', count($calls) === 3);
check('смешанные проекты: билеты собраны со всех одиночных', count($r['data']) === 2 && $r['split'] === true);
check('билеты разобраны: статус и id на месте', ($r['data'][0]['status'] ?? '') === 'ok' && str_starts_with((string)($r['data'][1]['id'] ?? ''), 'id-'));
$calls = [];
$ok = function (array $body, int $t) use (&$calls): array {
    $calls[] = $body;
    return ['http' => 200, 'json' => ['data' => [['status' => 'ok']]]];
};
$r = jt_expo_send($mixed, 5, $ok);
check('один проект: уходит одна пачка', count($calls) === 1 && $r['split'] === false);
$calls = [];
jt_expo_send([['to' => 'ExponentPushToken[a]']], 5, $ok);
check('одно сообщение уходит не списком', count($calls) === 1 && !array_is_list($calls[0]));
check('пустой список ничего не шлёт', jt_expo_send([], 5, $ok)['http'] === 0);

echo "ok\n";
