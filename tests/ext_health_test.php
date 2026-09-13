<?php
// Проверка тревоги по источникам партнёрских вакансий.
//
// Тревога здесь нужна не ради красоты отчёта: если источник умрёт незаметно,
// витрина неделями будет показывать протухшие вакансии, и узнаем мы об этом
// от работника, который приехал на несуществующую смену. Поэтому проверяем
// именно то, ради чего всё писалось: что смерть ОДНОГО источника видна,
// когда остальные живы.

require_once __DIR__ . '/../php-proxy/ext_health.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

/** Метка времени «столько-то секунд назад» в том виде, в каком её пишет ingest. */
function ago(int $now, int $seconds): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $now - $seconds);
}

$now = 1_757_700_000; // фиксированное «сейчас»: тест не должен зависеть от часа запуска

$alive = ['id' => 'hh', 'name' => 'hh.ru', 'period_min' => 60, 'last_success_at' => ago($now, 3600)];
$dead  = ['id' => 'sj', 'name' => 'SuperJob', 'period_min' => 60, 'last_success_at' => ago($now, 5 * 86400)];

// ── Главное: один живой источник больше не прячет мёртвый ─────────────────────
$h = ext_source_health([$alive, $dead], ['hh' => 100, 'sj' => 40], $now);
check('мёртвый источник назван', (bool)preg_grep('/SuperJob/u', $h['alerts']));
check('живой источник не в тревоге', !preg_grep('/hh\.ru/u', $h['alerts']));
check('срок молчания посчитан', (bool)preg_grep('/5 дней/u', $h['alerts']));

// ── Порог зависит от расписания источника ─────────────────────────────────────
// Опрос раз в 12 часов: 30 часов молчания — это два с половиной пропуска,
// тревожиться рано. Опрос раз в час: те же 30 часов — сто пропусков.
$slow = ['id' => 'x', 'name' => 'Раз в 12 часов', 'period_min' => 720, 'last_success_at' => ago($now, 30 * 3600)];
$fast = ['id' => 'y', 'name' => 'Раз в час', 'period_min' => 60, 'last_success_at' => ago($now, 30 * 3600)];
check('редкий источник не поднимает тревогу', ext_source_health([$slow], ['x' => 5], $now)['alerts'] === []);
check('частый источник поднимает тревогу', ext_source_health([$fast], ['y' => 5], $now)['alerts'] !== []);

// Ниже суток не тревожим даже самый частый источник: ночная пауза — не авария.
$hourly = ['id' => 'z', 'name' => 'Ежеминутный', 'period_min' => 1, 'last_success_at' => ago($now, 20 * 3600)];
check('20 часов молчания — ещё не авария', ext_source_health([$hourly], ['z' => 5], $now)['alerts'] === []);

// ── Ни разу не отработавший источник ──────────────────────────────────────────
$never = ['id' => 'n', 'name' => 'Новый', 'period_min' => 60, 'last_success_at' => null];
check('источник без единого успеха замечен',
    (bool)preg_grep('/ни разу не отработал/u', ext_source_health([$never], [], $now)['alerts']));

// ── Перекос в один источник ───────────────────────────────────────────────────
// Ровно тот риск, ради которого всё затевалось: hh закроет доступ — витрина
// опустеет на 95%.
$h = ext_source_health([$alive, $dead], ['hh' => 950, 'sj' => 50], $now);
check('перекос замечен', (bool)preg_grep('/95% живых вакансий/u', $h['alerts']));
check('доля посчитана', abs($h['top_share'] - 0.95) < 0.001);
check('всего живых посчитано', $h['total_live'] === 1000);

$h = ext_source_health([$alive, ['id' => 'sj', 'name' => 'SuperJob', 'period_min' => 60,
    'last_success_at' => ago($now, 3600)]], ['hh' => 600, 'sj' => 400], $now);
check('ровная доля тревоги не поднимает', !preg_grep('/живых вакансий/u', $h['alerts']));

// Единственный источник — это состояние, а не событие. Ежедневная тревога о
// нём ничего не сообщает, и её перестают читать заодно со всеми остальными.
$h = ext_source_health([$alive], ['hh' => 500], $now);
check('единственный источник не поднимает тревогу о перекосе', $h['alerts'] === []);
check('единственный источник всё равно виден в строке', str_contains($h['line'], 'hh.ru 500 (100%)'));

// ── Пустой список ─────────────────────────────────────────────────────────────
$h = ext_source_health([], [], $now);
check('отсутствие источников замечено', (bool)preg_grep('/источников вакансий нет/u', $h['alerts']));
check('строка не пустая', str_contains($h['line'], 'ни одного включённого'));
check('деления на ноль нет', $h['top_share'] === 0.0 && $h['total_live'] === 0);

// ── Строка отчёта ─────────────────────────────────────────────────────────────
$h = ext_source_health([$alive, $dead], ['hh' => 100, 'sj' => 40], $now);
check('в строке есть оба источника', str_contains($h['line'], 'hh.ru 100 (71%)') && str_contains($h['line'], 'SuperJob 40 (29%)'));
check('молчание видно в строке', str_contains($h['line'], 'SuperJob 40 (29%) — молчит 5 дней'));

// Источник без вакансий не должен выпадать из строки: ноль — тоже новость.
$h = ext_source_health([$alive, ['id' => 'sj', 'name' => 'SuperJob', 'period_min' => 60,
    'last_success_at' => ago($now, 3600)]], ['hh' => 100], $now);
check('источник с нулём вакансий показан', str_contains($h['line'], 'SuperJob 0 (0%)'));

// ── Разметка ──────────────────────────────────────────────────────────────────
// Строка уходит в Телеграм разметкой. Незакрытый тег в названии уронил бы
// разбор, и отчёт не пришёл бы вовсе — молча.
$evil = ['id' => 'e', 'name' => 'Злой <b>источник', 'period_min' => 60, 'last_success_at' => ago($now, 3600)];
$h = ext_source_health([$evil], ['e' => 1], $now);
check('теги в названии экранированы', !str_contains($h['line'], '<b>источник'));
check('название всё же читаемо', str_contains($h['line'], '&lt;b&gt;источник'));

$evilDead = ['id' => 'e', 'name' => 'Злой <b>источник', 'period_min' => 60, 'last_success_at' => ago($now, 5 * 86400)];
$h = ext_source_health([$evilDead], ['e' => 1], $now);
check('теги экранированы и в тревоге', !preg_grep('/<b>источник/u', $h['alerts']));

// ── Склонение срока ───────────────────────────────────────────────────────────
check('1 день', ext_source_age(86400) === '1 день');
check('2 дня', ext_source_age(2 * 86400) === '2 дня');
check('5 дней', ext_source_age(5 * 86400) === '5 дней');
check('11 дней', ext_source_age(11 * 86400) === '11 дней');
check('21 день', ext_source_age(21 * 86400) === '21 день');
check('1 час', ext_source_age(3600) === '1 час');
check('3 часа', ext_source_age(3 * 3600) === '3 часа');
check('13 часов', ext_source_age(13 * 3600) === '13 часов');
// Меньше часа всё равно называем часом: «0 часов» читается как ошибка.
check('меньше часа — всё равно час', ext_source_age(120) === '1 час');

// ── Отчёт действительно использует новую тревогу ──────────────────────────────
// Функцию легко написать и забыть подключить. Проверяем, что старая общая
// тревога из db.php ушла, а новая на месте.
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
check('отчёт зовёт проверку источников', str_contains($db, 'ext_source_health($extSources, $liveCounts, $now)'));
check('тревоги источников попадают в отчёт', str_contains($db, "foreach (\$health['alerts'] as \$sourceAlert)"));
check('строка источников попадает в отчёт', str_contains($db, "\$lines[] = \$health['line'];"));
check('общая тревога по максимуму убрана', !str_contains($db, '$importSilent'));

if ($failures) {
    echo "ext source health: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "ext source health: OK\n";
