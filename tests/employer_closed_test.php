<?php
// Работодательских аккаунтов нет (решение владельца 03.10.2026): сервер
// отклоняет регистрацию с ролью employer, а экран «Компаниям» вместо формы
// открывает готовое письмо в поддержку. Тот же путь — на сайте.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$start = strpos($db, "case 'dbUpsertUser': {");
$block = substr($db, (int)$start, 12000);
check('dbUpsertUser отклоняет новую роль employer',
    str_contains($block, "if (\$role === 'employer') {")
    && str_contains($block, "'Регистрация работодателей закрыта — напишите на support@jobtoo.ru'], 403)"));
check('отказ — до записи в базу', strpos($block, "if (\$role === 'employer') {") < strpos($block, '$atCreate'));

$screen = (string)file_get_contents(__DIR__ . '/../app/register-employer.tsx');
check('экран без формы регистрации', !str_contains($screen, 'registerUser') && !str_contains($screen, 'EmailCodeStep'));
check('экран открывает письмо с темой', str_contains($screen, "Linking.openURL(businessMailto())")
    && str_contains($screen, "'Бизнес: добавление вакансий в ленту'") && str_contains($screen, "'support@jobtoo.ru'"));

$landing = (string)file_get_contents(__DIR__ . '/../constants/landing.ts');
check('сайт: «Написать нам» вместо регистрации', str_contains($landing, 'href="${BUSINESS_MAILTO}"')
    && !str_contains($landing, 'href="/register-employer"'));
check('сайт: число компаний живое', str_contains($landing, "fetch('/api/feed_stats.php')")
    && str_contains($landing, 'd.feed_companies'));

if ($failures) {
    echo "employer closed: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "employer closed: OK\n";
