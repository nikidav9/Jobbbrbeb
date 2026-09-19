<?php
require_once __DIR__ . '/../php-proxy/apns.php';

function check(string $name, bool $ok): void {
    if (!$ok) {
        fwrite(STDERR, "FAIL: {$name}\n");
        exit(1);
    }
    echo "ok: {$name}\n";
}

$key = openssl_pkey_new([
    'private_key_type' => OPENSSL_KEYTYPE_EC,
    'curve_name' => 'prime256v1',
]);
$pem = '';
check('ephemeral EC key generated', $key !== false && openssl_pkey_export($key, $pem));

putenv('APNS_TEAM_ID=TEAM123456');
putenv('APNS_KEY_ID=KEY1234567');
putenv('APNS_BUNDLE_ID=com.nikidav23.onspaceapp');
putenv('APNS_PRIVATE_KEY_B64=' . base64_encode($pem));

check('APNs credentials detected', jt_apns_ready());
$jwt = jt_apns_jwt();
$parts = explode('.', $jwt);
check('provider JWT has three segments', count($parts) === 3);

$decode = static function (string $part): string {
    $part = strtr($part, '-_', '+/');
    $part .= str_repeat('=', (4 - strlen($part) % 4) % 4);
    return (string)base64_decode($part, true);
};

$header = json_decode($decode($parts[0]), true);
$claims = json_decode($decode($parts[1]), true);
$signature = $decode($parts[2]);

check('provider JWT uses ES256 and key id',
    ($header['alg'] ?? '') === 'ES256' && ($header['kid'] ?? '') === 'KEY1234567');
check('provider JWT carries Apple team id', ($claims['iss'] ?? '') === 'TEAM123456');
check('provider JWT signature is JOSE 64 bytes', strlen($signature) === 64);

$dual = jt_push_token_parts('apns:abcdef|expo:ExponentPushToken[xyz]');
check('dual token parser keeps APNs token', $dual['apns'] === 'abcdef');
check('dual token parser keeps Expo fallback', $dual['expo'] === 'ExponentPushToken[xyz]');

$legacy = jt_push_token_parts('ExponentPushToken[legacy]');
check('legacy Android/Expo token still works',
    $legacy['apns'] === '' && $legacy['expo'] === 'ExponentPushToken[legacy]');

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$admin = (string)file_get_contents(__DIR__ . '/../php-proxy/admin.php');
$tg = (string)file_get_contents(__DIR__ . '/../php-proxy/tg.php');

check('server prefers direct APNs', str_contains($db, 'jt_apns_push_generic'));
check('admin broadcast supports direct APNs', str_contains($admin, 'jt_apns_push_generic'));
check('legacy webhook push supports direct APNs', str_contains($tg, 'jt_apns_push_generic'));

echo "APNs direct transport checks passed\n";
