<?php
// Лента только IT (решение владельца 26.09.2026): сервер просит у базы режим
// «только IT», база его понимает, приложение не пускает в колоду свои
// вакансии не из IT и не применяет старые разделы.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$mig = (string)file_get_contents(__DIR__ . '/../supabase/migrations/120_it_only_feed.sql');
$feed = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');

check('dbGetExtFeed просит режим «только IT»', str_contains($db, "'p_it_only' => true,"));
check('в базе есть список IT-компаний', str_contains($mig, 'create table if not exists public.jm_it_companies'));
check('Яндекс в списке', str_contains($mig, "('Яндекс')"));
check('смешанных работодателей в списке нет',
    !str_contains($mig, "('Сбер')") && !str_contains($mig, "('МТС')") && !str_contains($mig, "('Магнит')"));
check('фильтр: раздел it или IT-компания',
    str_contains($mig, "not p_it_only or c.section = 'it'")
    && str_contains($mig, 'exists (select 1 from public.jm_it_companies i where i.company = c.company)'));
check('старая перегрузка функции снята', str_contains($mig, 'drop function if exists public.jm_ext_feed_pool(text, int, text[]);'));
check('функцию может звать db.php', str_contains($mig, 'grant execute on function public.jm_ext_feed_pool(text, int, text[], boolean) to service_role;'));

// Решение владельца 28.09.2026: IT-компания не тащит в ленту «рабочие»
// вакансии (миграция 132). Список в SQL совпадает с JOB_SECTIONS_BLUE_COLLAR.
require_once __DIR__ . '/../php-proxy/job_sections.php';
$mig132 = (string)file_get_contents(__DIR__ . '/../supabase/migrations/132_it_companies_no_blue_collar.sql');
preg_match("~c\\.section not in \\(([^)]*)\\)~", $mig132, $m);
$sqlList = array_map(fn($x) => trim($x, " '\n"), explode(',', $m[1] ?? ''));
sort($sqlList);
$phpList = JOB_SECTIONS_BLUE_COLLAR;
sort($phpList);
check('миграция 132: рабочие разделы IT-компаний скрыты', $sqlList === $phpList && $phpList !== []);
check('раздел it в списке рабочих быть не может', !in_array('it', JOB_SECTIONS_BLUE_COLLAR, true));
foreach (['Кладовщик на частичную занятость', 'Логист', 'Курьер', 'Водитель', 'Повар'] as $t) {
    check("«{$t}» — рабочий раздел", in_array(job_section($t), JOB_SECTIONS_BLUE_COLLAR, true));
}
foreach (['Продуктовый дизайнер', 'HR BP', 'Юрист', 'Менеджер по продажам'] as $t) {
    check("«{$t}» у IT-компании остаётся", !in_array(job_section($t), JOB_SECTIONS_BLUE_COLLAR, true));
}

// «Ближнее к IT» (решение владельца 01.10.2026, миграция 143): к it добавлен
// marketing; список в SQL совпадает с JOB_SECTIONS_FEED.
$mig143 = (string)file_get_contents(__DIR__ . '/../supabase/migrations/143_feed_near_it.sql');
preg_match("~not p_it_only or c\.section in \(([^)]*)\)~", $mig143, $m);
$feedSql = array_map(fn($x) => trim($x, " '\n"), explode(',', $m[1] ?? ''));
sort($feedSql);
$feedPhp = JOB_SECTIONS_FEED;
sort($feedPhp);
check('миграция 143: it и marketing', $feedSql === ['it', 'marketing'] && in_array('it', $feedPhp, true));
preg_match("~c\.section not in \(([^)]*)\)~", $mig143, $m);
$blue143 = array_map(fn($x) => trim($x, " '\n"), explode(',', $m[1] ?? ''));
sort($blue143);
check('миграция 143 не потеряла рабочие разделы IT-компаний', $blue143 === $phpList);
check('рабочие разделы в ленту не идут', !array_intersect(JOB_SECTIONS_FEED, JOB_SECTIONS_BLUE_COLLAR));
foreach (['Графический дизайнер', 'Бизнес-маркетолог', 'SMM-менеджер', 'Продакт менеджер (ноутбуки)'] as $t) {
    check("«{$t}» — в ленте", in_array(job_section($t), JOB_SECTIONS_FEED, true));
}
foreach (['Телемаркетолог В2С', 'Администратор магазина', 'Кассир'] as $t) {
    check("«{$t}» — не в ленте", !in_array(job_section($t), JOB_SECTIONS_FEED, true));
}

// «Офис рядом с IT» (решение владельца 02.10.2026, миграция 145): финансы,
// HR и юристы. Список в SQL совпадает с JOB_SECTIONS_FEED; администраторы,
// проектировщики и операционисты банка в ленту не идут.
$mig145 = (string)file_get_contents(__DIR__ . '/../supabase/migrations/145_feed_office.sql');
preg_match("~not p_it_only or c\.section in \(([^)]*)\)~", $mig145, $m);
$feed145 = array_map(fn($x) => trim($x, " '\n"), explode(',', $m[1] ?? ''));
sort($feed145);
check('миграция 145: разделы ленты те же, что JOB_SECTIONS_FEED', $feed145 === $feedPhp);
preg_match("~c\.section not in \(([^)]*)\)~", $mig145, $m);
$blue145 = array_map(fn($x) => trim($x, " '\n"), explode(',', $m[1] ?? ''));
sort($blue145);
check('миграция 145 не потеряла рабочие разделы IT-компаний', $blue145 === $phpList);
foreach (['Финансовый бизнес-партнер (b2c)', 'Бухгалтер', 'Старший юрисконсульт', 'HR BP', 'Специалист по кадровому делопроизводству'] as $t) {
    check("«{$t}» — в ленте", in_array(job_section($t), JOB_SECTIONS_FEED, true));
}
foreach (['Ассистент руководителя', 'Специалист по закупкам', 'Инженер-проектировщик отдела водоснабжения', 'Кассир-операционист', 'Кредитный специалист'] as $t) {
    check("«{$t}» — не в ленте", !in_array(job_section($t), JOB_SECTIONS_FEED, true));
}

check('свои вакансии — только IT в колоде', str_contains($feed, "&& sectionOfPerm(v.workType) === 'it' && matchOwnVacancy(v, filters, now)"));
// «Показать N вакансий» теперь считает сервер (dbCountExtFeed, тот же пул
// jm_ext_feed_pool с p_it_only) — экран фильтров app/filters/index.tsx.
$allFilters = (string)file_get_contents(__DIR__ . '/../app/filters/index.tsx');
check('и в счётчике «Показать N»', str_contains($allFilters, 'dbCountExtFeed(')
    && str_contains((string)file_get_contents(__DIR__ . '/../php-proxy/db.php'), "case 'dbCountExtFeed':"));
check('сохранённые разделы не применяются', !str_contains($feed, 'getFeedSections('));
check('блока «Разделы» в шторке нет', !str_contains($feed, '<Text style={fst.label}>Разделы</Text>'));

if ($failures) {
    echo "it only feed: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "it only feed: OK\n";
