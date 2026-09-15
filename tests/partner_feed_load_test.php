<?php
// Безопасный нагрузочный прогон нормализации большого партнёрского фида.
// Никакой production-сети/БД: подключается ровно production-код нормализации.
define('INGEST_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/ingest.php';

function load_fail(string $message): void {
    fwrite(STDERR, "partner feed load: FAIL: $message\n");
    exit(1);
}

$rows = (int)(getenv('PARTNER_LOAD_ROWS') ?: '50000');
if ($rows < 1000 || $rows > 250000) load_fail('PARTNER_LOAD_ROWS out of safe range');

$start = hrtime(true);
$memStart = memory_get_usage(true);
$keys = [];
$batches = 0;
$batch = [];
$sampleMetro = null;

for ($i = 0; $i < $rows; $i++) {
    $title = match ($i % 3) {
        0 => 'Сборщик заказов',
        1 => 'Кладовщик',
        default => 'Повар',
    };
    $item = [
        'id' => 'load-' . $i,
        'title' => $title,
        'company' => 'Load Partner ' . ($i % 17),
        'metro' => 'м. Тёплый Стан, 7 минут пешком',
        'address' => 'Москва, тестовый адрес ' . $i,
        'kind' => ($i % 5 === 0) ? 'permanent' : 'shift',
        'date' => '2026-09-' . sprintf('%02d', 16 + ($i % 10)),
        'time_start' => '09:00',
        'time_end' => '18:00',
        'pay' => 5000 + ($i % 3000),
        'pay_period' => ($i % 5 === 0) ? 'month' : 'shift',
        'url' => 'https://partner.example/v/' . $i,
        'description' => 'Синтетическая запись для безопасного нагрузочного прогона.',
        'active' => true,
    ];
    $row = ing_normalize($item, 'load-source');
    if (!is_array($row)) load_fail("row $i did not normalize");
    if ($sampleMetro === null) $sampleMetro = $row['metro_station_norm'] ?? null;
    $key = (string)($row['id'] ?? '');
    if ($key === '' || isset($keys[$key])) load_fail("duplicate normalized id at row $i");
    $keys[$key] = true;
    $batch[] = $row;
    if (count($batch) === 200) {
        // Та же форма пачки, с которой production идёт в upsert; БД не трогаем.
        json_encode($batch, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $batches++;
        $batch = [];
    }
}
if ($batch) {
    json_encode($batch, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $batches++;
}

$elapsedMs = (hrtime(true) - $start) / 1_000_000;
$peakDeltaMb = max(0, memory_get_peak_usage(true) - $memStart) / 1048576;
if (count($keys) !== $rows) load_fail('normalized row count mismatch');
if ($sampleMetro !== 'Тёплый Стан') load_fail('production metro normalization changed');
if ($elapsedMs > 30000) load_fail(sprintf('normalization too slow: %.0f ms', $elapsedMs));
if ($peakDeltaMb > 256) load_fail(sprintf('memory spike too high: %.1f MB', $peakDeltaMb));

printf(
    "partner feed load: OK rows=%d batches=%d elapsed_ms=%.0f peak_delta_mb=%.1f rows_per_sec=%.0f\n",
    $rows, $batches, $elapsedMs, $peakDeltaMb,
    $elapsedMs > 0 ? ($rows * 1000 / $elapsedMs) : 0
);
