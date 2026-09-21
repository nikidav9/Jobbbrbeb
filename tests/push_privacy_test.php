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

echo "ok\n";
