<?php
// Личное уведомление владельцу поддержки: один адресат, без текста обращения.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$deploy = (string)file_get_contents(__DIR__ . '/../php-proxy/deploy.php');
$workflow = (string)file_get_contents(__DIR__ . '/../.github/workflows/deploy-regru.yml');

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

check('есть одна серверная настройка адресата',
    str_contains($db, "define('SUPPORT_NOTIFY_TELEGRAM_ID'"));
check('уведомление вызывается при новом обращении',
    str_contains($db, 'if (!$wasWaiting) support_notify_owner();'));
check('личная доставка ограничена только настроенным chat_id',
    str_contains($db, '$chatId !== SUPPORT_NOTIFY_TELEGRAM_ID'));
check('в Telegram уходит только факт и ссылка на поддержку',
    str_contains($db, 'Новое обращение в поддержку JobToo')
    && str_contains($db, '"/support"'));
check('текст обращения не передаётся в функцию уведомления',
    str_contains($db, 'function support_notify_owner(): void'));
check('секрет разрешён deploy.php',
    str_contains($deploy, "'SUPPORT_NOTIFY_TELEGRAM_ID'"));
check('секрет доставляется workflow',
    substr_count($workflow, 'SUPPORT_NOTIFY_TELEGRAM_ID') >= 2);

if ($failures) {
    fwrite(STDERR, "FAIL:\n - " . implode("\n - ", $failures) . "\n");
    exit(1);
}
echo "ok\n";
