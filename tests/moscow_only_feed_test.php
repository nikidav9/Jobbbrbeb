<?php
// Лента только по Москве (решение владельца 26.09.2026): db.php просит режим,
// база его понимает, шаблон города в базе и в счётчиках один и тот же.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

define('FEED_STATS_LIBRARY_ONLY', true);
require_once __DIR__ . '/../php-proxy/feed_stats.php';

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$mig = (string)file_get_contents(__DIR__ . '/../supabase/migrations/121_moscow_only_feed.sql');

check('dbGetExtFeed просит режим «только Москва»', str_contains($db, "'p_moscow_only' => true,"));
check('и не теряет «только IT»', str_contains($db, "'p_it_only' => true, 'p_moscow_only' => true,"));
check('шаблон в базе тот же, что в счётчиках', str_contains($mig, "c.address ~* '" . FS_MOSCOW_RE . "'"));
check('метро и пустой адрес пускаются',
    str_contains($mig, 'c.metro_station_norm is not null') && str_contains($mig, "coalesce(btrim(c.address), '') = ''"));
check('IT-фильтр на месте', str_contains($mig, "not p_it_only or c.section = 'it'"));
check('старая перегрузка снята', str_contains($mig, 'drop function if exists public.jm_ext_feed_pool(text, int, text[], boolean);'));
check('функцию может звать db.php',
    str_contains($mig, 'grant execute on function public.jm_ext_feed_pool(text, int, text[], boolean, boolean) to service_role;'));

// Регулярка Postgres (~*) и PHP (~iu) должны понимать шаблон одинаково:
// никаких \b, классов вида [[:alpha:]] и прочего, что они читают по-разному.
check('шаблон без синтаксиса, который Postgres и PHP читают по-разному', !preg_match('~[\\\\\[]{2}|\\\\[bBdwsy]~', FS_MOSCOW_RE));
foreach (['Москва' => true, 'г. Москва, ул. Льва Толстого' => true, 'Moscow' => true, 'Зеленоград' => true,
          'Удаленно' => true, 'Удалённая работа' => true, 'Remote' => true, 'МОСКВА' => true, 'moscow, russia' => true,
          'Санкт-Петербург' => false, 'Минск' => false, 'Томск' => false, 'Московская область, Химки' => false] as $a => $want) {
    check("город: $a", fs_is_moscow(['address' => $a]) === $want);
}

if ($failures) {
    echo "moscow only feed: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "moscow only feed: OK\n";
