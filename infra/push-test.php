<?php
// Проверка доставки пуша (03.10.2026): берёт сохранённые токены со stdin,
// шлёт тот же обезличенный пуш, что и боевой код, и печатает ответ Expo —
// билеты и через 20 с квитанции. Боевая отправка ответ выбрасывает, поэтому
// причину тишины (нет ключа FCM, токен чужого проекта, устройство не
// найдено) видно только здесь. Токены в вывод не попадают.
$proxy = $argv[1] ?? '/opt/jobtoo-proxy';
require $proxy . '/push_privacy.php';

function clean(string $s): string {
    return substr(preg_replace('/Expo(nent)?PushToken\[[^\]]*\]/', '<токен>', $s), 0, 200);
}
function expo(string $path, array $body): array {
    $ch = curl_init('https://exp.host/--/api/v2/push/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $j = is_string($raw) ? json_decode($raw, true) : null;
    return ['http' => $code, 'json' => is_array($j) ? $j : []];
}

$stored = array_values(array_filter(array_map('trim', file('php://stdin') ?: [])));
$out = ['tokens_in_db' => count($stored), 'decrypted' => 0, 'send_http' => null, 'tickets' => [], 'receipts' => []];
$msgs = array_map(fn($s) => ['to' => $s, 'priority' => 'high'], $stored);
$prep = jt_push_prepare_expo_messages($msgs);
$out['decrypted'] = count($prep);
if ($prep) {
    // Токены двух проектов Expo в одной пачке дают 400; jt_expo_send тогда шлёт по одному.
    $r = jt_expo_send($prep, 20);
    $out['send_http'] = $r['http'];
    $out['split'] = $r['split'];
    $ids = [];
    foreach ($r['data'] as $t) {
        $out['tickets'][] = [
            'status' => $t['status'] ?? '?',
            'error' => clean((string)($t['details']['error'] ?? '')),
            'message' => clean((string)($t['message'] ?? '')),
        ];
        if (!empty($t['id'])) $ids[] = $t['id'];
    }
    if (!$out['tickets'] && !empty($r['errors'])) {
        $out['tickets'][] = ['status' => 'error', 'error' => '', 'message' => clean(json_encode($r['errors'], JSON_UNESCAPED_UNICODE))];
    }
    if ($ids) {
        sleep(20);
        $rc = expo('getReceipts', ['ids' => $ids]);
        foreach (($rc['json']['data'] ?? []) as $t) {
            $out['receipts'][] = [
                'status' => $t['status'] ?? '?',
                'error' => clean((string)($t['details']['error'] ?? '')),
                'message' => clean((string)($t['message'] ?? '')),
            ];
        }
    }
}
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
