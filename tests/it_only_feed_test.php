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

check('свои вакансии — только IT в колоде', str_contains($feed, "const matchesFilters = (v: PermVacancy) => sectionOfPerm(v.workType) === 'it'"));
check('и в счётчике «Показать N»', substr_count($feed, "sectionOfPerm(v.workType) === 'it'") >= 2);
check('сохранённые разделы не применяются', !str_contains($feed, 'getFeedSections('));
check('блока «Разделы» в шторке нет', !str_contains($feed, '<Text style={fst.label}>Разделы</Text>'));

if ($failures) {
    echo "it only feed: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "it only feed: OK\n";
