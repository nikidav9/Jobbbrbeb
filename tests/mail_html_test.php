<?php
// Письмо целиком: хранится при приёме, отдаётся только владельцу и по одному.
$fails = [];
function check(string $name, bool $ok): void { global $fails; if (!$ok) $fails[] = $name; }
$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
check('jupiterMailHtml — только свои письма ($selfArgFns)', str_contains($db, "'jupiterMailHtml' => 0,"));
preg_match("~case 'jupiterMailHtml': \\{.*?break;~s", $db, $m);
check('выборка по id и владельцу', str_contains($m[0] ?? '', "'user_id' => 'eq.' . (string)\$args[0]")
    && str_contains($m[0] ?? '', "'id' => 'eq.'"));
check('одно письмо, не список', str_contains($m[0] ?? '', 'sb_single('));
preg_match("~case 'jupiterMailList': \\{.*?break;~s", $db, $l);
check('в список HTML не входит', !str_contains($l[0] ?? '', 'html'));
preg_match("~case 'jupiterMailIngest': \\{.*?break;\\n        \\}~s", $db, $i);
check('при приёме HTML сохраняется и обновляется', substr_count($i[0] ?? '', '$stored') >= 3);
check('подтверждению отклика HTML не передаётся', str_contains($i[0] ?? '', "jt_mail_confirm_applications((string)\$box['user_id'], \$content)"));
check('предел 2 МБ', str_contains($i[0] ?? '', '0, 2000000)'));
$mig = (string)@file_get_contents(__DIR__ . '/../supabase/migrations/143_mail_html.sql');
check('миграция 143 добавляет колонку', str_contains($mig, 'add column if not exists html text'));
if ($fails) { echo "mail html: ПРОВАЛЫ\n"; foreach ($fails as $x) echo "  - $x\n"; exit(1); }
echo "mail html: OK\n";
