<?php
// Мэтч и итог смены: извещает сервер, а не телефон.
//
// Вторая часть задачи 20. Оба события целиком серверные — мэтч заводит
// dbCheckAndCreateMatch, итог записывает dbSetShiftOutcome, — так что телефону
// там делать было нечего: обрыв связи терял уведомление, а текст, собранный на
// клиенте, можно было подменить.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$notif = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

function fn_body(string $src, string $name): string
{
    $start = strpos($src, "function {$name}(");
    if ($start === false) return '';
    $end = strpos($src, "\n}\n", $start);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

function case_body(string $src, string $fn): string
{
    $start = strpos($src, "case '{$fn}':");
    if ($start === false) return '';
    $end = strpos($src, "\n        case '", $start + 10);
    return $end !== false ? substr($src, $start, $end - $start) : substr($src, $start);
}

// ── Мэтч ─────────────────────────────────────────────────────────────────────
$m = fn_body($db, 'jt_notify_match');
check('уведомление о мэтче есть на сервере', $m !== '');
// Извещаем ту сторону, которая мэтч НЕ нажимала: свой нажим человек и так
// видит на экране, а второй пуш об одном событии — шум.
check('нажавшего не извещаем',
    str_contains($m, "if (\$actor !== \$workerId && \$workerId !== '')")
    && str_contains($m, "if (\$actor !== \$employerId && \$employerId !== '')"));
check('работнику — свой текст', str_contains($m, "'🎉 Мэтч! Вас хотят взять!'"));
check('работодателю — свой', str_contains($m, "'🎉 Мэтч!'"));
// Имя кандидата в пуш не кладём: он уходит за границу. Название смены
// оставляем — без него уведомление перестаёт что-либо значить.
check('в пуше работодателю имени нет',
    str_contains($m, "'Кандидат готов выйти на смену «' . \$title . '». Откройте чат!'"));
check('имя кандидата берётся из базы',
    str_contains($m, "sb_single('jm_users', ['id' => 'eq.' . \$workerId], 'first_name,last_name')"));
$createMatch = case_body($db, 'dbCheckAndCreateMatch');
check('мэтч извещает при создании', str_contains($createMatch, 'jt_notify_match((string)$vid,'));
check('сбой уведомления не роняет мэтч',
    str_contains($createMatch, 'try {') && str_contains($createMatch, '} catch (Throwable'));

// ── Итог смены ───────────────────────────────────────────────────────────────
$o = fn_body($db, 'jt_notify_shift_outcome');
check('уведомление об итоге есть на сервере', $o !== '');
// Текст разный не для красоты: прежде на все случаи был один — «компания
// отменила смену», — и человек, которого отметили не вышедшим, получал письмо
// про отмену работодателем. Неправда, да ещё и отметку, которая пойдёт ему в
// рейтинг, он бы так и не увидел.
check('невыход назван невыходом', str_contains($o, "'⚠️ Отмечен невыход'"));
check('про рейтинг сказано прямо', str_contains($o, 'Это влияет на рейтинг'));
check('свой отказ работника не путается с отменой',
    str_contains($o, "'worker_cancelled' => ['Смена отменена',"));
check('прочая причина — своя', str_contains($o, "'other_cancelled' => ['Смена отменена',"));
check('отмена работодателем — по умолчанию', str_contains($o, "default => ['❌ Смена отменена',"));
check('подтверждённая смена зовёт на отзыв', str_contains($o, 'Хотите оставить отзыв?'));
// Канал у подтверждённой смены был 'default', и он должен таким остаться:
// иначе уведомление уедет в другую группу настроек телефона.
check('канал подтверждения сохранён', str_contains($o, "'shift_confirmed_by_employer', [], null, null, 'default'"));
$nu = fn_body($db, 'notify_user');
check('notify_user умеет канал',
    str_contains($nu, '?string $channelId = null') && str_contains($nu, "\$channelId ?? 'matches'"));
$outcome = case_body($db, 'dbSetShiftOutcome');
check('итог извещает', str_contains($outcome, 'jt_notify_shift_outcome((string)$lid,'));

// Вакансию могли удалить, а отклик остаться: связи в базе нет.
$t = fn_body($db, 'jt_shift_titles');
check('без вакансии текст не пустеет',
    str_contains($t, "?: 'смену'") && str_contains($t, "?: 'Работодатель'"));

// ── Приложение это делать перестало ─────────────────────────────────────────
foreach (['notifyWorkerGotMatch', 'notifyEmployerGotMatch',
          'notifyWorkerShiftConfirmedByEmployer', 'notifyWorkerShiftCancelled',
          'notifyEmployerNewApplicant', 'notifyWorkerPermApplicationApproved',
          'notifyWorkerPermApplicationRejected', 'notifyEmployerNewPermApplicant'] as $helper) {
    check("помощник {$helper} убран", !str_contains($notif, "function {$helper}("));
}
// Вся цепочка отправки с телефона тоже: без неё некому звать закрытые операции.
foreach (['pushTo', 'sendExpoPush', 'sendTelegramTo', 'sendWebPushTo'] as $helper) {
    check("цепочка отправки: {$helper} убран", !str_contains($notif, "function {$helper}("));
}
// Осталось ровно одно — рассылка о новой вакансии: это не событие одного
// человека, и у неё свой серверный обработчик.
check('рассылка о вакансии осталась',
    str_contains($notif, 'export async function notifyWorkersNewVacancy'));

if ($failures) {
    echo "match/outcome notify: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "match/outcome notify: OK\n";
