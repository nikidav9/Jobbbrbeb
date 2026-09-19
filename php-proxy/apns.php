<?php
/**
 * Direct Apple Push Notification service transport.
 *
 * Secrets are read from the environment first and then from app_secrets.php.
 * The .p8 key is stored as base64 (APNS_PRIVATE_KEY_B64), so deploy tooling
 * never has to preserve PEM newlines.
 *
 * Privacy invariant: jt_apns_push_generic() never accepts notification title
 * or body from callers. Apple receives only the APNs device token, a generic
 * JobToo alert and an optional technical event type.
 */

function jt_apns_secret(string $name, string $fallback = ''): string {
    static $file = null;
    $env = getenv($name);
    if (is_string($env) && trim($env) !== '') return trim($env);

    if ($file === null) {
        $path = __DIR__ . '/app_secrets.php';
        $loaded = is_readable($path) ? @include $path : null;
        $file = is_array($loaded) ? $loaded : [];
    }
    $value = $file[$name] ?? '';
    return is_string($value) && trim($value) !== '' ? trim($value) : $fallback;
}

function jt_apns_b64url(string $value): string {
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function jt_apns_der_length(string $der, int &$offset): ?int {
    if ($offset >= strlen($der)) return null;
    $first = ord($der[$offset++]);
    if (($first & 0x80) === 0) return $first;

    $bytes = $first & 0x7f;
    if ($bytes < 1 || $bytes > 4 || $offset + $bytes > strlen($der)) return null;
    $length = 0;
    for ($i = 0; $i < $bytes; $i++) {
        $length = ($length << 8) | ord($der[$offset++]);
    }
    return $length;
}

/** Convert OpenSSL's DER ECDSA signature to the 64-byte JOSE R||S form. */
function jt_apns_der_to_jose(string $der): ?string {
    $offset = 0;
    if ($der === '' || ord($der[$offset++]) !== 0x30) return null;
    $sequenceLength = jt_apns_der_length($der, $offset);
    if ($sequenceLength === null || $offset + $sequenceLength > strlen($der)) return null;

    if ($offset >= strlen($der) || ord($der[$offset++]) !== 0x02) return null;
    $rLength = jt_apns_der_length($der, $offset);
    if ($rLength === null || $offset + $rLength > strlen($der)) return null;
    $r = substr($der, $offset, $rLength);
    $offset += $rLength;

    if ($offset >= strlen($der) || ord($der[$offset++]) !== 0x02) return null;
    $sLength = jt_apns_der_length($der, $offset);
    if ($sLength === null || $offset + $sLength > strlen($der)) return null;
    $s = substr($der, $offset, $sLength);

    $r = ltrim($r, "\x00");
    $s = ltrim($s, "\x00");
    if (strlen($r) > 32 || strlen($s) > 32) return null;

    return str_pad($r, 32, "\x00", STR_PAD_LEFT)
        . str_pad($s, 32, "\x00", STR_PAD_LEFT);
}

function jt_apns_ready(): bool {
    return jt_apns_secret('APNS_TEAM_ID') !== ''
        && jt_apns_secret('APNS_KEY_ID') !== ''
        && jt_apns_secret('APNS_PRIVATE_KEY_B64') !== '';
}

function jt_apns_jwt(): string {
    static $cached = '';
    static $issuedAt = 0;

    $now = time();
    if ($cached !== '' && $issuedAt > 0 && ($now - $issuedAt) < 3000) return $cached;
    if (!jt_apns_ready()) return '';

    $encodedKey = preg_replace('/\s+/', '', jt_apns_secret('APNS_PRIVATE_KEY_B64'));
    $pem = is_string($encodedKey) ? base64_decode($encodedKey, true) : false;
    if (!is_string($pem) || $pem === '') return '';

    $key = @openssl_pkey_get_private($pem);
    if ($key === false) return '';

    $header = jt_apns_b64url(json_encode([
        'alg' => 'ES256',
        'kid' => jt_apns_secret('APNS_KEY_ID'),
    ], JSON_UNESCAPED_SLASHES));
    $claims = jt_apns_b64url(json_encode([
        'iss' => jt_apns_secret('APNS_TEAM_ID'),
        'iat' => $now,
    ], JSON_UNESCAPED_SLASHES));
    $input = $header . '.' . $claims;

    $der = '';
    if (!openssl_sign($input, $der, $key, OPENSSL_ALGO_SHA256)) return '';
    $raw = jt_apns_der_to_jose($der);
    if ($raw === null) return '';

    $issuedAt = $now;
    $cached = $input . '.' . jt_apns_b64url($raw);
    return $cached;
}

/**
 * Stored iOS values may temporarily contain both transports:
 *   apns:<native-token>|expo:<ExpoPushToken...>
 * This makes rollout fail-safe: direct APNs is preferred when credentials are
 * installed, while the existing Expo token remains a temporary fallback.
 */
function jt_push_token_parts(string $stored): array {
    $stored = trim($stored);
    if (!str_starts_with($stored, 'apns:')) {
        return ['apns' => '', 'expo' => $stored];
    }

    $rest = substr($stored, 5);
    $separator = strpos($rest, '|expo:');
    if ($separator === false) {
        return ['apns' => $rest, 'expo' => ''];
    }

    return [
        'apns' => substr($rest, 0, $separator),
        'expo' => substr($rest, $separator + 6),
    ];
}

/**
 * Send an intentionally generic iOS alert directly to APNs.
 * No caller-controlled title/body is accepted by design.
 */
function jt_apns_push_generic(string $storedOrNativeToken, string $type = ''): array {
    if (!jt_apns_ready()) {
        return ['ok' => false, 'status' => 0, 'reason' => 'APNs credentials are not configured'];
    }

    $parts = jt_push_token_parts($storedOrNativeToken);
    $token = $parts['apns'] !== '' ? $parts['apns'] : $storedOrNativeToken;
    $token = preg_replace('/[^a-fA-F0-9]/', '', $token);
    if (!is_string($token) || strlen($token) < 32) {
        return ['ok' => false, 'status' => 0, 'reason' => 'Invalid APNs device token'];
    }

    $jwt = jt_apns_jwt();
    if ($jwt === '') {
        return ['ok' => false, 'status' => 0, 'reason' => 'Could not create APNs provider token'];
    }

    $bundleId = jt_apns_secret('APNS_BUNDLE_ID', 'com.nikidav23.onspaceapp');
    $environment = strtolower(jt_apns_secret('APNS_ENVIRONMENT', 'production'));
    $host = $environment === 'sandbox'
        ? 'https://api.sandbox.push.apple.com'
        : 'https://api.push.apple.com';

    $payload = [
        'aps' => [
            'alert' => [
                'title' => 'JobToo',
                'body' => 'У вас новое событие',
            ],
            'sound' => 'default',
        ],
    ];
    $safeType = preg_replace('/[^a-zA-Z0-9_.-]/', '', $type);
    if (is_string($safeType) && $safeType !== '') $payload['type'] = $safeType;

    $ch = curl_init($host . '/3/device/' . $token);
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER => [
            'authorization: bearer ' . $jwt,
            'apns-topic: ' . $bundleId,
            'apns-push-type: alert',
            'apns-priority: 10',
            'apns-expiration: 0',
            'content-type: application/json',
        ],
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ];
    if (defined('CURL_HTTP_VERSION_2TLS')) {
        $options[CURLOPT_HTTP_VERSION] = CURL_HTTP_VERSION_2TLS;
    }
    curl_setopt_array($ch, $options);

    $response = curl_exec($ch);
    $curlError = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($status === 200) return ['ok' => true, 'status' => 200, 'reason' => ''];

    $decoded = json_decode(is_string($response) ? $response : '', true);
    $reason = is_array($decoded) ? (string)($decoded['reason'] ?? '') : '';
    if ($reason === '') $reason = $curlError !== '' ? $curlError : 'APNs HTTP ' . $status;
    $GLOBALS['jt_last_apns_error'] = ['status' => $status, 'reason' => $reason, 'when' => gmdate('c')];

    return ['ok' => false, 'status' => $status, 'reason' => $reason];
}
