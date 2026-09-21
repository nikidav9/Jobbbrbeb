<?php

// Privacy boundary for native Expo push.
//
// The provider token has to be sent to Expo/APNs/FCM in plaintext at delivery
// time, otherwise delivery is impossible. Everywhere else we keep it encrypted
// and make the outbound payload identical for every personal event.

const JT_PUSH_ENC_PREFIX = 'jtenc1.';
const JT_PUSH_AAD = 'jobtoo:push-token:v1';
const JT_PUSH_PUBLIC_TITLE = 'JobToo';
const JT_PUSH_PUBLIC_BODY = 'У вас новое уведомление';

function jt_push_b64url_encode(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function jt_push_b64url_decode(string $raw): string|false {
    $pad = strlen($raw) % 4;
    if ($pad) $raw .= str_repeat('=', 4 - $pad);
    return base64_decode(strtr($raw, '-_', '+/'), true);
}

/**
 * Server-only key. Production creates it once beside the PHP proxy and keeps
 * it across code deploys; php-proxy/*.php is copied without deleting local
 * secret files. An explicit env/app secret is useful for tests or managed hosts.
 */
function jt_push_key(): string {
    static $key = null;
    if (is_string($key)) return $key;

    $explicit = getenv('PUSH_TOKEN_ENCRYPTION_KEY');
    if (is_string($explicit) && trim($explicit) !== '') {
        $key = hash('sha256', trim($explicit), true);
        return $key;
    }

    $secretsPath = __DIR__ . '/app_secrets.php';
    if (is_readable($secretsPath)) {
        $secrets = @include $secretsPath;
        $explicit = is_array($secrets) ? (string)($secrets['PUSH_TOKEN_ENCRYPTION_KEY'] ?? '') : '';
        if ($explicit !== '') {
            $key = hash('sha256', $explicit, true);
            return $key;
        }
    }

    $keyPath = __DIR__ . '/push_token_key.php';
    if (is_readable($keyPath)) {
        $saved = @include $keyPath;
        if (is_string($saved)) {
            $decoded = base64_decode($saved, true);
            if (is_string($decoded) && strlen($decoded) === 32) {
                $key = $decoded;
                return $key;
            }
        }
    }

    $generated = random_bytes(32);
    $encoded = base64_encode($generated);
    $fh = @fopen($keyPath, 'x');
    if (is_resource($fh)) {
        @fwrite($fh, "<?php return '" . $encoded . "';\n");
        @fclose($fh);
        @chmod($keyPath, 0600);
        $key = $generated;
        return $key;
    }

    // Another request may have won the first-write race.
    if (is_readable($keyPath)) {
        $saved = @include $keyPath;
        $decoded = is_string($saved) ? base64_decode($saved, true) : false;
        if (is_string($decoded) && strlen($decoded) === 32) {
            $key = $decoded;
            return $key;
        }
    }

    throw new RuntimeException('Push token encryption key is unavailable');
}

function jt_push_fingerprint(string $plainToken): string {
    $lookupKey = hash_hmac('sha256', 'lookup', jt_push_key(), true);
    return substr(hash_hmac('sha256', $plainToken, $lookupKey), 0, 32);
}

function jt_push_is_encrypted(string $value): bool {
    return str_starts_with($value, JT_PUSH_ENC_PREFIX);
}

function jt_push_encrypt(string $plainToken): string {
    $plainToken = trim($plainToken);
    if ($plainToken === '') return '';

    $nonce = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt(
        $plainToken,
        'aes-256-gcm',
        jt_push_key(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        JT_PUSH_AAD,
        16,
    );
    if (!is_string($cipher) || strlen($tag) !== 16) {
        throw new RuntimeException('Push token encryption failed');
    }

    return JT_PUSH_ENC_PREFIX
        . jt_push_fingerprint($plainToken) . '.'
        . jt_push_b64url_encode($nonce . $tag . $cipher);
}

/**
 * Legacy plaintext values stay readable during rollout. New writes are always
 * encrypted, and db.php rewrites the legacy rows once on first live use.
 */
function jt_push_decrypt(string $storedToken): string {
    $storedToken = trim($storedToken);
    if ($storedToken === '' || !jt_push_is_encrypted($storedToken)) return $storedToken;

    $parts = explode('.', $storedToken, 3);
    if (count($parts) !== 3 || $parts[0] !== rtrim(JT_PUSH_ENC_PREFIX, '.')) return '';

    $raw = jt_push_b64url_decode($parts[2]);
    if (!is_string($raw) || strlen($raw) < 29) return '';

    $nonce = substr($raw, 0, 12);
    $tag = substr($raw, 12, 16);
    $cipher = substr($raw, 28);
    $plain = openssl_decrypt(
        $cipher,
        'aes-256-gcm',
        jt_push_key(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        JT_PUSH_AAD,
    );
    return is_string($plain) ? $plain : '';
}

/** PostgREST LIKE pattern for the same plaintext token without storing it. */
function jt_push_lookup_pattern(string $plainToken): string {
    return JT_PUSH_ENC_PREFIX . jt_push_fingerprint(trim($plainToken)) . '.*';
}

/**
 * Whatever a caller tried to put into a remote native push is collapsed to a
 * provider endpoint plus one generic wake-up signal. Personal/event details
 * remain in jm_notifications on the Moscow server.
 */
function jt_push_prepare_expo_message(array $message): ?array {
    $token = jt_push_decrypt((string)($message['to'] ?? ''));
    if ($token === '') return null;

    return [
        'to' => $token,
        'title' => JT_PUSH_PUBLIC_TITLE,
        'body' => JT_PUSH_PUBLIC_BODY,
        'sound' => 'default',
        'priority' => $message['priority'] ?? 'high',
        'channelId' => 'default',
        'data' => ['type' => 'refresh'],
    ];
}

function jt_push_prepare_expo_messages(array $messages): array {
    $out = [];
    foreach ($messages as $message) {
        if (!is_array($message)) continue;
        $prepared = jt_push_prepare_expo_message($message);
        if ($prepared !== null) $out[] = $prepared;
    }
    return $out;
}
