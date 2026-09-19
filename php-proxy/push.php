<?php
/**
 * Direct Apple Push Notification service transport.
 *
 * iOS tokens are stored as "apns:<native-token>" in jm_users.push_token.
 * Android keeps the existing Expo token format. APNs credentials live only
 * in app_secrets.php / environment and are never committed.
 */

function jt_push_secret(string $name, string $fallback = ''): string {
    $env = getenv($name);
    if (is_string($env) && trim($env) !== '') return trim($env);

    static $file = null;
    if ($file === null) {
        $path = __DIR__ . '/app_secrets.php';
        $value = is_readable($path) ? @include $path : null;
        $file = is_array($value) ? $value : [];
    }

    $value = $file[$name] ?? '';
    return is_string($value) && $value !== '' ? $value : $fallback;
}

function jt_b64url(string $value): string {
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

/** Convert OpenSSL's ASN.1 DER ECDSA signature into JWT's raw R||S form. */
function jt_apns_der_to_jose(string $der): ?string {
    $len = strlen($der);
    if ($len < 8 || ord($der[0]) !== 0x30) return null;

    $pos = 1;
    $seqLen = ord($der[$pos++]);
    if (($seqLen & 0x80) !== 0) {
        $n = $seqLen & 0x7f;
        if ($n < 1 || $n > 2 || $pos + $n > $len) return null;
        $seqLen = 0;
        for ($i = 0; $i < $n; $i++) $seqLen = ($seqLen << 8) | ord($der[$pos++]);
    }

    if ($pos >= $len || ord($der[$pos++]) !== 0x02 || $pos >= $len) return null;
    $rLen = ord($der[$pos++]);
    if ($pos + $rLen > $len) return null;
    $r = substr($der, $pos, $rLen);
    $pos += $rLen;

    if ($pos >= $len || ord($der[$pos++]) !== 0x02 || $pos >= $len) return null;
    $sLen = ord($der[$pos++]);
    if ($pos + $sLen > $len) return null;
    $s = substr($der, $pos, $sLen);

    $r = ltrim($r, "\x00");
    $s = ltrim($s, "\x00");
    if (strlen($r) > 32 || strlen($s) > 32) return null;

    return str_pad($r, 32, "\x00", STR_PAD_LEFT)
         . str_pad($s, 32, "\x00", STR_PAD_LEFT);
}

function jt_apns_provider_token(): ?string {
    static $cached = null;
    static $issuedAt = 0;

    // Apple accepts provider tokens for up to one hour. Refresh at 50 minutes.
    if (is_string($cached) && $cached !== '' && time() - $issuedAt < 3000) {
        return $cached;
    }

    $keyId = jt_push_secret('APNS_KEY_ID');
    $teamId = jt_push_secret('APNS_TEAM_ID');
    $p8 = jt_push_secret('APNS_AUTH_KEY_P8');
    if ($keyId === '' || $teamId === '' || $p8 === '') {
        error_log('[apns] credentials are not configured');
        return null;
    }

    // Accept either a literal multiline GitHub secret or a value with escaped \n.
    if (!str_contains($p8, "\n") && str_contains($p8, '\\n')) {
        $p8 = str_replace('\\n', "\n", $p8);
    }

    $issuedAt = time();
    $header = jt_b64url(json_encode(['alg' => 'ES256', 'kid' => $keyId], JSON_UNESCAPED_SLASHES));
    $claims = jt_b64url(json_encode(['iss' => $teamId, 'iat' => $issuedAt], JSON_UNESCAPED_SLASHES));
    $input = $header . '.' . $claims;

    $key = @openssl_pkey_get_private($p8);
    if ($key === false) {
        error_log('[apns] invalid APNs .p8 private key');
        return null;
    }

    $der = '';
    if (!@openssl_sign($input, $der, $key, OPENSSL_ALGO_SHA256)) {
        error_log('[apns] failed to sign provider token');
        return null;
    }

    $raw = jt_apns_der_to_jose($der);
    if ($raw === null) {
        error_log('[apns] failed to convert ECDSA signature');
        return null;
    }

    $cached = $input . '.' . jt_b64url($raw);
    return $cached;
}

/**
 * Send a privacy-minimized alert directly to APNs.
 *
 * Apple receives only the native device token, neutral alert text and a coarse
 * event type used for navigation. Names, message text, phones, emails, vacancy
 * titles and other JobToo content are deliberately not placed in this payload.
 *
 * @return array{ok:bool,status:int,reason:string}
 */
function jt_apns_push_one(string $deviceToken, string $type = ''): array {
    $jwt = jt_apns_provider_token();
    $bundleId = jt_push_secret('APNS_BUNDLE_ID', 'com.nikidav23.onspaceapp');
    if ($jwt === null || $bundleId === '' || $deviceToken === '') {
        return ['ok' => false, 'status' => 0, 'reason' => 'not_configured'];
    }

    $payload = [
        'aps' => [
            'alert' => ['title' => 'JobToo', 'body' => 'У вас новое событие'],
            'sound' => 'default',
        ],
    ];
    if ($type !== '') $payload['type'] = $type;

    $ch = curl_init('https://api.push.apple.com/3/device/' . rawurlencode($deviceToken));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_2_0,
        CURLOPT_HTTPHEADER => [
            'authorization: bearer ' . $jwt,
            'apns-topic: ' . $bundleId,
            'apns-push-type: alert',
            'apns-priority: 10',
            'apns-expiration: 0',
            'content-type: application/json',
        ],
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $decoded = json_decode(is_string($body) ? $body : '', true);
    $reason = is_array($decoded) ? (string)($decoded['reason'] ?? '') : '';
    $ok = $status === 200;

    if (!$ok) {
        error_log('[apns] push failed: HTTP ' . $status . ' ' . ($reason !== '' ? $reason : $curlError));
    }

    return ['ok' => $ok, 'status' => $status, 'reason' => $reason];
}
