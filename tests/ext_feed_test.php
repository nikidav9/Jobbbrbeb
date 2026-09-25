<?php
// Лента карьерных вакансий: компании чередуются, свайпы меняют порядок.

require __DIR__ . '/../php-proxy/ext_feed.php';

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// Каталог как в жизни: Сбера много, остальных мало.
$pool = [];
for ($i = 0; $i < 30; $i++) $pool[] = ['id' => "s$i", 'company' => 'Сбер', 'title' => "Менеджер по продажам $i"];
for ($i = 0; $i < 10; $i++) $pool[] = ['id' => "m$i", 'company' => 'Магнит', 'title' => "Продавец-кассир $i"];
for ($i = 0; $i < 3; $i++) $pool[] = ['id' => "k$i", 'company' => 'Контур', 'title' => "Java-разработчик $i"];
for ($i = 0; $i < 3; $i++) $pool[] = ['id' => "x$i", 'company' => 'X5 Tech', 'title' => "Python-разработчик $i"];

$plain = ext_feed_arrange($pool, ext_feed_taste([]), 20, 'seed');
check('отдаёт не больше лимита', count($plain) === 20);
$companies = array_column($plain, 'company');
$twice = 0;
for ($i = 1; $i < count($companies); $i++) if ($companies[$i] === $companies[$i - 1]) $twice++;
check('одна компания не идёт два раза подряд, пока есть другие', $twice === 0 || count(array_unique(array_slice($companies, 0, 12))) === 4);
check('в первых восьми есть все четыре компании', count(array_unique(array_slice($companies, 0, 8))) === 4);

// Человек лайкает разработчиков и смахивает продажи.
$taste = ext_feed_taste([
    ['dir' => 1, 'company' => 'Контур', 'title' => 'Java-разработчик'],
    ['dir' => 1, 'company' => 'X5 Tech', 'title' => 'Python-разработчик'],
    ['dir' => -1, 'company' => 'Сбер', 'title' => 'Менеджер по продажам'],
    ['dir' => -1, 'company' => 'Магнит', 'title' => 'Продавец-кассир'],
]);
$liked = ext_feed_arrange($pool, $taste, 6, 'seed');
$top = array_column(array_slice($liked, 0, 2), 'company');
check('лайкнутое поднимается наверх', !array_diff($top, ['Контур', 'X5 Tech']));
check('похожие должности выше: разработчик в первой двойке',
    str_contains($liked[0]['title'], 'разработчик') && str_contains($liked[1]['title'], 'разработчик'));

check('вес одной компании ограничен', ext_feed_taste(array_fill(0, 10, ['dir' => 1, 'company' => 'Сбер', 'title' => 'x']))['company']['сбер'] === 3);
check('слова названия', ext_feed_tokens('Ведущий Java-разработчик (для B2B)') === ['ведущий', 'java', 'разработчик', 'b2b']);
check('одинаковый сид — одинаковая лента', ext_feed_arrange($pool, $taste, 10, 'a') === ext_feed_arrange($pool, $taste, 10, 'a'));
check('пустой пул', ext_feed_arrange([], $taste, 10, 'a') === []);

// ── Разделы и профиль ────────────────────────────────────────────────────────
$sectionTaste = ext_feed_taste([
    ['dir' => 1, 'company' => 'CompanyA', 'title' => 'Water', 'section' => 'delivery'],
    ['dir' => 1, 'company' => 'CompanyB', 'title' => 'Vodka', 'section' => 'delivery'],
]);
$deliveryRow = ['company' => 'Z1', 'title' => 'Zebra', 'section' => 'delivery'];
$itRow = ['company' => 'Z2', 'title' => 'Zeppelin', 'section' => 'it'];
check('лайки раздела delivery поднимают его вакансию выше it при прочих равных',
    ext_feed_score($deliveryRow, $sectionTaste, 0.5) > ext_feed_score($itRow, $sectionTaste, 0.5));

check('вид работ stocker в профиле даёт вес складу',
    ext_feed_taste([], ['work_types' => ['stocker']])['section']['warehouse'] === 2);

$resumeTaste = ext_feed_taste([], ['resume_data' => ['experience' => [['position' => 'Курьер']]]]);
check('должность «Курьер» из резюме поднимает раздел доставки', ($resumeTaste['section']['delivery'] ?? 0) > 0);
check('должность «Курьер» из резюме добавляет токен', in_array('курьер', array_keys($resumeTaste['tokens']), true));

$metroTaste = ext_feed_taste([], ['metro_station' => 'Тёплый Стан']);
$metroRow = ['company' => 'M', 'title' => 'M', 'section' => '', 'metro_station_norm' => 'теплый стан'];
check('совпадение станции метро даёт +0.5',
    abs(ext_feed_score($metroRow, $metroTaste, 0.0) - 0.5) < 1e-9);

check('вес раздела ограничен 3 при 10 лайках',
    ext_feed_taste(array_fill(0, 10, ['dir' => 1, 'company' => 'x', 'title' => 'x', 'section' => 'delivery']))['section']['delivery'] === 3);

// ── Полное описание в ответе клиенту (миграция 117) ─────────────────────────
check('полное описание занимает место короткого',
    ext_feed_public_row(['description' => 'коротко', 'description_full' => 'длинно и со структурой'])['description']
        === 'длинно и со структурой');
check('пустое description_full не перекрывает короткое описание',
    ext_feed_public_row(['description' => 'коротко', 'description_full' => ''])['description'] === 'коротко');
check('description_full не долетает до клиента', !array_key_exists('description_full', ext_feed_public_row(['description_full' => 'x'])));
check('described_at не долетает до клиента', !array_key_exists('described_at', ext_feed_public_row(['described_at' => 'x'])));

check('старый вызов ext_feed_score без section/metro в $taste не падает',
    is_float(ext_feed_score(['company' => 'a', 'title' => 'b'], ['company' => [], 'tokens' => []], 0.0)));

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo "ext feed: ok\n";
