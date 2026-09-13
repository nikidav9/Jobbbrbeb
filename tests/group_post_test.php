<?php
// Объявление в группу «ПОДРАБОТКИ»: доставка и её видимость.
//
// Написано по живой жалобе: постоянная вакансия висела в ленте восемнадцать
// часов, а сообщения в группе не было. Разбор показал две причины, и обе
// молчаливые.
//
// Проверка текстовая: dbNotifyAllWorkersNewVacancy живёт внутри обработчика
// запроса, подключить его как библиотеку нельзя.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

// ── Отметка о доставке ────────────────────────────────────────────────────────
// Была одна отметка на всё, и ставилась она ДО отправки: сбой при отправке в
// группу означал, что вакансия помечена разосланной навсегда, а повтор с
// клиента получал already_sent и выходил ни с чем.
check('отметки раздельные: письма и группа',
    str_contains($db, "'eq.bcast:' . \$vacancyId") && str_contains($db, "'eq.gpost:' . \$vacancyId"));
check('отметка группы ставится ПОСЛЕ успеха',
    str_contains($db, "if (\$groupOk && \$vacancyId !== '') {"));
check('ранний выход только когда доставлено и то и другое',
    str_contains($db, 'if ($dmAlreadySent && $groupAlreadySent) {'));
// Личные сообщения по-прежнему столбим заранее: повторная рассылка всем
// работникам хуже неотправленной.
check('письма столбятся заранее', str_contains($db, "if (!\$dmAlreadySent) {"));
check('письма не уходят повторно', str_contains($db, "'skipped' => 'dm_already_sent'"));

// Порядок важен: отметка после отправки, а не до.
$claim = strpos($db, "'key' => 'gpost:' . \$vacancyId");
$send = strpos($db, '$groupOk = tg_send_message(TG_GROUP_CHAT_ID');
check('в коде отправка стоит раньше отметки', $send !== false && $claim !== false && $send < $claim);

// ── Видимость отказа ──────────────────────────────────────────────────────────
// Итог последней публикации писался в jm_settings и не читался нигде: в самом
// коде сказано «иначе выяснять причину будет нечем», а читателя не было.
check('итог публикации записывается', str_contains($db, "'key' => 'last_group_post'"));
check('итог публикации читается', str_contains($db, "['key' => 'eq.last_group_post']"));
check('недоставленный пост виден в отчёте', str_contains($db, 'НЕ доставлен'));
check('недоставленный пост поднимает тревогу',
    str_contains($db, "\$groupAlert = 'последний пост в группу"));
check('тревога попадает в список', str_contains($db, "if (\$groupAlert !== '') \$alerts[] = \$groupAlert;"));
check('строка попадает в отчёт', str_contains($db, "if (\$groupLine !== '') \$lines[] = \$groupLine;"));

// Причина отказа приходит из Telegram и уходит в разметку сообщения.
check('причина отказа экранируется', str_contains($db, 'htmlspecialchars(mb_substr($whyText'));

if ($failures) {
    echo "group post: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "group post: OK\n";
