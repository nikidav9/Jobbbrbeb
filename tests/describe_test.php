<?php
// Дозагрузка полного описания вакансии: троттлер, выбор очереди и решение
// «что писать в описание» — чистые функции, сеть и базу не трогаем.
//
// DESCRIBE_LIBRARY_ONLY гасит точку входа (сам заход и проверку токена),
// как и INGEST_LIBRARY_ONLY у ingest.php, который describe.php тоже тянет.

define('DESCRIBE_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/describe.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// ── Троттлер: не чаще раза в секунду на хост ────────────────────────────────

check('первый заход на хост — ждать не нужно',
    ds_throttle_wait([], 'a.ru', 1000.0) === 0.0);
check('заход сразу после предыдущего — ждать почти секунду',
    abs(ds_throttle_wait(['a.ru' => 1000.0], 'a.ru', 1000.2) - 0.8) < 1e-9);
check('секунда прошла — ждать не нужно',
    ds_throttle_wait(['a.ru' => 1000.0], 'a.ru', 1001.0) === 0.0);
check('с запасом — тоже не нужно (не отрицательное)',
    ds_throttle_wait(['a.ru' => 1000.0], 'a.ru', 1005.0) === 0.0);
check('другой хост под тем же временем не ждёт вовсе',
    ds_throttle_wait(['a.ru' => 1000.0], 'b.ru', 1000.1) === 0.0);

// ── Очередь: активные без описания или с устаревшим ─────────────────────────

$now = strtotime('2026-09-25T12:00:00Z');
$cond = ds_queue_condition($now);
check('очередь — только активные', $cond['active'] === 'is.true');
check('очередь — без описания или устаревшее (30 дней)',
    $cond['or'] === '(described_at.is.null,described_at.lt.2026-08-26T12:00:00Z)');

$filter = ds_queue_filter($now);
check('выборка пачкой сортирована по свежести', $filter['order'] === 'first_seen_at.desc');
check('условие очереди то же самое, что и у одиночного count', $filter['active'] === $cond['active'] && $filter['or'] === $cond['or']);
check('размер пачки — константа DS_BATCH', $filter['limit'] === (string)DS_BATCH);

// Другой порог «устарелости» — свежая граница сдвигается вместе с ним.
check('порог устарелости настраивается',
    ds_queue_condition($now, 7)['or'] === '(described_at.is.null,described_at.lt.2026-09-18T12:00:00Z)');

// ── Что писать в description_full ───────────────────────────────────────────

check('страница не открылась — description_full пуст', ds_describe_html(null) === null);
check('текста на странице мало — тоже пуст',
    ds_describe_html('<p>Коротко.</p>') === null);
// vt_extract без разметки JobPosting ищет минимум два раздела — одного
// заголовка ему мало, поэтому в примере их два.
$html = '<h2>Обязанности:</h2><ul><li>' . str_repeat('Пункт про задачу. ', 10) . '</li></ul>'
    . '<h2>Требования:</h2><ul><li>' . str_repeat('Другой пункт. ', 10) . '</li></ul>';
check('текста достаточно — описание пишем, со структурой',
    str_contains((string)ds_describe_html($html), '## Обязанности'));

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo "describe: ok\n";
