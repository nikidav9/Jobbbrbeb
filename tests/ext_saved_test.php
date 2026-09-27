<?php
// Закладки карьерных вакансий (миграция 129, решение владельца 27.09.2026):
// чужие закладки не прочитать и не изменить, таблица закрыта RLS, клиент
// показывает отметку в ленте, на «Вакансии подробно» и в избранном.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$root = __DIR__ . '/..';
$db = (string)file_get_contents("$root/php-proxy/db.php");
$mig = (string)file_get_contents("$root/supabase/migrations/129_ext_saved.sql");
$rls = (string)file_get_contents("$root/infra/verify-rls.sh");

// Права: аргумент 0 — владелец, сверяется с сессией.
$selfStart = strpos($db, '$selfArgFns = [');
$selfEnd = $selfStart !== false ? strpos($db, '];', $selfStart) : false;
$selfBlock = ($selfStart !== false && $selfEnd !== false) ? substr($db, $selfStart, $selfEnd - $selfStart) : '';
foreach (['dbGetExtSaved', 'dbAddExtSaved', 'dbRemoveExtSaved'] as $fn) {
    check("$fn — только свои (\$selfArgFns, аргумент 0)", str_contains($selfBlock, "'$fn' => 0"));
}
$publicStart = strpos($db, '$publicFns = [');
$publicEnd = $publicStart !== false ? strpos($db, '];', $publicStart) : false;
$publicBlock = ($publicStart !== false && $publicEnd !== false) ? substr($db, $publicStart, $publicEnd - $publicStart) : '';
check('список публичных функций найден', $publicBlock !== '');
check('закладки не публичные', !str_contains($publicBlock, 'ExtSaved'));
check('id вакансии проверяется', str_contains($db, "if (\$vid === '' || strlen(\$vid) > 200)"));

// Таблица: ссылки с каскадом, RLS включён и доступ снят, сторож её знает.
check('ссылка на человека с каскадом', str_contains($mig, 'references public.jm_users(id) on delete cascade'));
check('ссылка на вакансию с каскадом', str_contains($mig, 'references public.jm_ext_vacancies(id) on delete cascade'));
check('RLS включён', str_contains($mig, 'alter table public.jm_ext_saved enable row level security;'));
check('anon и authenticated без доступа', str_contains($mig, 'revoke all on public.jm_ext_saved from anon, authenticated;'));
check('миграция в транзакции', str_contains($mig, 'begin;') && str_contains($mig, 'commit;'));
check('RLS-сторож проверяет таблицу', str_contains($rls, "('jm_ext_saved')"));

// Клиент: одно хранилище на три места.
$feed = (string)file_get_contents("$root/app/(tabs)/feed.tsx");
$detail = (string)file_get_contents("$root/app/ext-vacancy.tsx");
$saved = (string)file_get_contents("$root/app/saved.tsx");
check('лента: закладка на карьерной карточке', str_contains($feed, 'onSave={() => { void toggleExtSave(ev); }}'));
check('«Подробно»: кнопка «Сохранить»', str_contains($detail, 'testID="detail-save"') && str_contains($detail, 'toggleExtSaved('));
check('избранное показывает карьерные', str_contains($saved, 'useExtSaved()') && str_contains($saved, "kind: 'ext'"));

if ($failures) {
    echo "ext saved: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "ext saved: OK\n";
