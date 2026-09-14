<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$ch = curl_init('http://127.0.0.1:3000/');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 1,
    CURLOPT_TIMEOUT => 3,
]);
$response = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_errno($ch);
curl_close($ch);

$ok = $error === 0 && $response !== false && $status === 200;
http_response_code($ok ? 200 : 503);
echo json_encode(['ok' => $ok], JSON_UNESCAPED_SLASHES) . "\n";
