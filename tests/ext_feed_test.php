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
check('пустой фильтр не сужает: salary_from 0', $emptyFilters['salary_from'] === 0);

// ── Б1: пул шире при любом третьем доводе, а не только при активном фильтре ─
// Раньше «Всего N» без фильтра считалось по ≤30 карточкам на компанию, а с
// фильтром — по 200, и включение фильтра само по себе УВЕЛИЧИВАЛО N. Проверка
// по исходнику db.php — как и раньше в этом файле: dbGetExtFeed читает
// сессию и авторизацию, самим запуском в node:test/php CLI без базы его не
// вызвать.
$dbSrc = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
check('dbGetExtFeed расширяет пул до 200 при любом переданном (даже пустом) фильтре, не только при активном',
    str_contains($dbSrc, '$perCompany = $filters !== null ? 200 : 30;'));
check('расширение пула больше не зависит от ext_feed_filters_active', !str_contains($dbSrc, 'ext_feed_filters_active'));

// ── Б1: пул зовётся с select без тяжёлых колонок ────────────────────────────
check('EXT_FEED_POOL_SELECT не тянет description_full', !str_contains(EXT_FEED_POOL_SELECT, 'description_full'));
check('EXT_FEED_POOL_SELECT не тянет described_at', !str_contains(EXT_FEED_POOL_SELECT, 'described_at'));
check('EXT_FEED_POOL_SELECT не тянет detail_spec', !str_contains(EXT_FEED_POOL_SELECT, 'detail_spec'));
// Нужные карточке колонки на месте (services/db.ts: toExtVacancy, ext_feed_score/match).
foreach (['id', 'title', 'company', 'schedule', 'description', 'salary', 'first_seen_at', 'section',
          'metro_station_norm', 'url'] as $col) {
    check("EXT_FEED_POOL_SELECT содержит $col", in_array($col, explode(',', EXT_FEED_POOL_SELECT), true));
}
check('dbGetExtFeed зовёт пул с select=EXT_FEED_POOL_SELECT',
    str_contains($dbSrc, "sb_rpc('jm_ext_feed_pool', [") && str_contains($dbSrc, "['select' => EXT_FEED_POOL_SELECT]"));

// ── Б1: дотягивание description_full только для отданных карточек ──────────
check('ext_feed_attach_full_descriptions дотягивает description_full одним sb_select по id',
    str_contains($dbSrc, "function ext_feed_attach_full_descriptions")
    && str_contains($dbSrc, "sb_select('jm_ext_vacancies', ['id' => sb_in_list(\$ids)], 'id,description_full')"));
check('обе ветки dbGetExtFeed дотягивают описание перед ext_feed_public_row',
    substr_count($dbSrc, 'ext_feed_attach_full_descriptions(ext_feed_arrange(') === 2);
check('сбой дотягивания не роняет ленту — try/catch вокруг sb_select',
    (bool)preg_match('~try\s*\{\s*\$full = sb_select\(\'jm_ext_vacancies\'.*?catch \(Throwable \$e\) \{\s*return \$rows;~s', $dbSrc));

check('posted принимает month (30 суток)', ext_feed_filters(['posted' => 'month'])['posted'] === 'month');

$baseFilters = ext_feed_filters([]);
check('пустой фильтр пропускает всё', ext_feed_match(['company' => 'Сбер', 'title' => 'Курьер', 'salary' => null], $baseFilters));

// Поиск «Вакансия или стек»: все слова, без регистра, по названию, компании и описанию.
$q = ext_feed_filters(['query' => '  Python   SENIOR, python ']);
check('поиск: слова в нижнем регистре и без повторов', $q['query'] === ['python', 'senior']);
check('поиск: все слова нашлись — проходит',
    ext_feed_match(['title' => 'Senior Python-разработчик', 'company' => 'Ozon'], $q));
check('поиск: одно слово не нашлось — не проходит',
    !ext_feed_match(['title' => 'Python-разработчик', 'company' => 'Ozon'], $q));
check('поиск: слово из описания и компании засчитывается',
    ext_feed_match(['title' => 'Разработчик', 'company' => 'Senior Group', 'description' => 'Пишем на Python'], $q));
check('поиск: не строка — пустой запрос', ext_feed_filters(['query' => ['x']])['query'] === []);
check('поиск: не больше 6 слов', count(ext_feed_filters(['query' => 'a b c d e f g h'])['query']) === 6);

// Переключатели экрана фильтров (макет «JT-filters»).
check('по умолчанию просмотренные скрыты', ext_feed_filters([])['hide_seen'] === true);
check('скрыть просмотренные выключается только явным false', ext_feed_filters(['hide_seen' => false])['hide_seen'] === false
    && ext_feed_filters(['hide_seen' => 'нет'])['hide_seen'] === true);
check('«только с зарплатой» по умолчанию выключен', ext_feed_filters([])['salary_known'] === false);
$known = ext_feed_filters(['salary_known' => true]);
check('«только с зарплатой»: без суммы не проходит', !ext_feed_match(['salary' => null], $known));
check('«только с зарплатой»: с суммой проходит', ext_feed_match(['salary' => 90000], $known));
check('hide_seen уходит в jm_ext_feed_pool', str_contains($dbSrc, "'p_hide_seen' => \$filters['hide_seen'] ?? true,"));
check('счётчик «Показать N» — без карточек и публичный',
    str_contains($dbSrc, "case 'dbCountExtFeed':") && str_contains($dbSrc, "'dbGetExtFeed', 'dbCountExtFeed',")
    && str_contains($dbSrc, "\$data = ['total' => count(array_filter(\$countPool, fn(\$row) => ext_feed_match(\$row, \$countFor)))];"));
// «Всего N» не сходился с дашбордом (28.09.2026): счёт шёл по пулу выдачи с
// потолком 200 на компанию. Теперь — отдельный пул без потолка.
$mig134 = (string)file_get_contents(__DIR__ . '/../supabase/migrations/134_ext_feed_count_uncapped.sql');
check('счёт — по пулу без потолка на компанию',
    str_contains($dbSrc, "'p_per_company' => 5000")
    && str_contains($mig134, 'least(p_per_company, 5000)')
    && str_contains($dbSrc, "'total' => \$total,"));
check('счёт без потолка сохраняет фильтры IT и «рабочих» разделов',
    str_contains($mig134, "c.section not in ('warehouse', 'delivery', 'transport', 'retail',"));
$mig130 = (string)file_get_contents(__DIR__ . '/../supabase/migrations/130_feed_hide_seen.sql');
check('миграция 130: старая перегрузка снята', str_contains($mig130, 'drop function if exists public.jm_ext_feed_pool(text, int, text[], boolean, boolean);'));
check('миграция 130: выключено — возвращаются только смахнутые влево', str_contains($mig130, 'and (p_hide_seen or s.dir = 1)'));
check('миграция 130: функцию зовёт только сервер',
    str_contains($mig130, 'grant execute on function public.jm_ext_feed_pool(text, int, text[], boolean, boolean, boolean) to service_role;'));

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

// Автоотклик: компании из apply_unsupported.php не обещают «отклик через приложение».
$unsup = require __DIR__ . '/../php-proxy/apply_unsupported.php';
check('список компаний без автоотклика не пуст и в нижнем регистре', count($unsup) > 50 && $unsup === array_map(fn($x) => mb_strtolower($x, 'UTF-8'), $unsup));
check('компания из списка: auto_apply=false (регистр и пробелы не важны)',
    ext_feed_public_row(['company' => '  ' . mb_strtoupper($unsup[0], 'UTF-8') . ' '])['auto_apply'] === false);
check('чужая компания: auto_apply=true', ext_feed_public_row(['company' => 'Сбер'])['auto_apply'] === true);
check('пустая компания: auto_apply=true', ext_feed_public_row([])['auto_apply'] === true);

if ($failures) {
    fwrite(STDERR, "FAIL:\n  " . implode("\n  ", $failures) . "\n");
    exit(1);
}
echo "ext feed: ok\n";
