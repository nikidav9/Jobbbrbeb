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
check('наружу уходит единый нейтральный заголовок',
    ($prepared['title'] ?? '') === JT_PUSH_PUBLIC_TITLE);
check('наружу уходит единый нейтральный текст',
    ($prepared['body'] ?? '') === JT_PUSH_PUBLIC_BODY);
check('идентификаторы события вычищены',
    ($prepared['data'] ?? null) === ['type' => 'refresh']);
check('канал не раскрывает категорию события',
    ($prepared['channelId'] ?? '') === 'default');

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
