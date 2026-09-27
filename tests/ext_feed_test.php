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
check('detail_spec не долетает до клиента', !array_key_exists('detail_spec', ext_feed_public_row(['detail_spec' => ['url' => 'https://a.ru/1']])));
check('described_at не долетает до клиента', !array_key_exists('described_at', ext_feed_public_row(['described_at' => 'x'])));

check('старый вызов ext_feed_score без section/metro в $taste не падает',
    is_float(ext_feed_score(['company' => 'a', 'title' => 'b'], ['company' => [], 'tokens' => []], 0.0)));

// ── Фильтры на сервере (ext_feed_filters, ext_feed_match) ───────────────────
$junkFilters = ext_feed_filters([
    'salary_from' => '999999999', 'specs' => ['onec', 'onec', 'bogus', 42],
    'levels' => ['senior', 'nope'], 'formats' => ['remote', 'atlantis'],
    'companies' => array_merge(array_fill(0, 60, 'X'), [str_repeat('Y', 300), '  Сбер  ', '']),
    'posted' => 'never',
]);
check('зарплата зажата потолком', $junkFilters['salary_from'] === 10_000_000);
check('specs — только известные, без дублей', $junkFilters['specs'] === ['onec']);
check('levels — только известные', $junkFilters['levels'] === ['senior']);
check('formats — только известные', $junkFilters['formats'] === ['remote']);
check('companies — не больше 50, длинные и пустые отсеяны, обрезаны', count($junkFilters['companies']) <= 50 && in_array('Сбер', $junkFilters['companies'], true) && !in_array(str_repeat('Y', 300), $junkFilters['companies'], true));
check('posted — мусор превращается в all', $junkFilters['posted'] === 'all');

$emptyFilters = ext_feed_filters('мусор не массив');
check('нестроковый мусор целиком — пустой фильтр', $emptyFilters === ext_feed_filters([]));
check('пустой фильтр — не включён', !ext_feed_filters_active($emptyFilters));
foreach ([['salary_from' => 150000], ['specs' => ['qa']], ['levels' => ['senior']], ['formats' => ['remote']],
          ['companies' => ['Сбер']], ['posted' => 'day']] as $one) {
    check('включён фильтр ' . array_key_first($one), ext_feed_filters_active(ext_feed_filters($one)));
}
check('dbGetExtFeed расширяет пул при любом фильтре',
    str_contains((string)file_get_contents(__DIR__ . '/../php-proxy/db.php'), 'ext_feed_filters_active($filters)) ? 200 : 30'));
check('пустой фильтр не сужает: salary_from 0', $emptyFilters['salary_from'] === 0);

check('posted принимает month (30 суток)', ext_feed_filters(['posted' => 'month'])['posted'] === 'month');

$baseFilters = ext_feed_filters([]);
check('пустой фильтр пропускает всё', ext_feed_match(['company' => 'Сбер', 'title' => 'Курьер', 'salary' => null], $baseFilters));

$salaryFilter = ext_feed_filters(['salary_from' => 100000]);
check('зарплата ниже порога не проходит', !ext_feed_match(['salary' => 90000], $salaryFilter));
check('без зарплаты при фильтре не проходит', !ext_feed_match(['salary' => null], $salaryFilter));
check('зарплата равна порогу проходит', ext_feed_match(['salary' => 100000], $salaryFilter));
check('зарплата выше порога проходит', ext_feed_match(['salary' => 150000], $salaryFilter));

$now = time();
$postedFilter = ext_feed_filters(['posted' => 'day']);
check('вакансия за сегодня проходит фильтр «за день»', ext_feed_match(['first_seen_at' => date('c', $now - 3600)], $postedFilter));
check('вакансия недельной давности не проходит «за день»', !ext_feed_match(['first_seen_at' => date('c', $now - 3 * 86400)], $postedFilter));
$monthFilter = ext_feed_filters(['posted' => 'month']);
check('вакансия месячной давности проходит «за месяц»', ext_feed_match(['first_seen_at' => date('c', $now - 20 * 86400)], $monthFilter));
check('вакансия старше месяца не проходит «за месяц»', !ext_feed_match(['first_seen_at' => date('c', $now - 40 * 86400)], $monthFilter));

$levelFilter = ext_feed_filters(['levels' => ['senior']]);
check('уровень совпал — проходит', ext_feed_match(['title' => 'Senior Go-разработчик'], $levelFilter));
check('уровень не совпал — не проходит', !ext_feed_match(['title' => 'Junior QA'], $levelFilter));
check('без уровня в названии — не проходит', !ext_feed_match(['title' => 'Курьер'], $levelFilter));

$formatFilter = ext_feed_filters(['formats' => ['remote']]);
check('формат по графику совпал', ext_feed_match(['schedule' => 'Удалённо'], $formatFilter));
check('формат не совпал — не проходит', !ext_feed_match(['schedule' => 'Офис'], $formatFilter));

$specFilter = ext_feed_filters(['specs' => ['qa', 'mobile']]);
check('специализация пересекается — проходит', ext_feed_match(['title' => 'Java QA Automation'], $specFilter));
check('специализация не пересекается — не проходит', !ext_feed_match(['title' => 'Java-разработчик'], $specFilter));

$companyFilter = ext_feed_filters(['companies' => ['Сбер']]);
check('компания совпала', ext_feed_match(['company' => 'Сбер', 'title' => ''], $companyFilter));
check('компания не совпала', !ext_feed_match(['company' => 'Магнит', 'title' => ''], $companyFilter));
check('ignoreCompany пропускает фильтр по компании', ext_feed_match(['company' => 'Магнит', 'title' => ''], $companyFilter, true));

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo "ext feed: ok\n";
