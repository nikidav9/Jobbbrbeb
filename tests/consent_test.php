<?php
// Согласие на обработку персональных данных: запись не должна теряться.
//
// Написано после разбора жалобы на молчащие объявления: там нашлась целая
// порода ошибок — вызов с клиента «выстрелил и забыл», который сервер не может
// доделать, потому что просто не знает о событии. Согласие было устроено ровно
// так же: void dbRecordConsent(...) без ожидания и без повтора.
//
// Ставка здесь выше, чем у объявления. Запись согласия — не аналитика, а
// доказательство: именно её предъявляют, когда спрашивают, на каком основании
// мы обрабатываем данные человека. Регистрация идёт с телефона на плохой
// связи, и потеря была бы тихой.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$ctx = (string)file_get_contents(__DIR__ . '/../contexts/AppContext.tsx');
$dbts = (string)file_get_contents(__DIR__ . '/../services/db.ts');

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

// ── Согласие пишется тем же заходом, что создаёт человека ─────────────────────
check('серверная запись согласия есть', str_contains($db, 'function jt_consent_attach('));
check('регистрация её зовёт', str_contains($db, 'jt_consent_attach($uid, $args[2] ?? null);'));
check('клиент передаёт согласие третьим доводом',
    str_contains($dbts, '[row, referralCode ?? \'\', consent]'));
check('регистрация собирает основное согласие',
    str_contains($ctx, 'const coreDocs = legalVersions();')
    && str_contains($ctx, 'stamp: LEGAL_STAMP')
    && str_contains($ctx, 'docs: coreDocs'));
check('регистрация больше не передаёт отдельное трансграничное согласие',
    !str_contains($ctx, 'crossBorderVersion:')
    && !str_contains($ctx, 'crossBorderConsent'));

$attach = fn_body($db, 'jt_consent_attach');
check('тело записи найдено', $attach !== '');
// Идентификатор строки тот же, что у dbRecordConsent: иначе повторный вызов со
// старого клиента завёл бы вторую запись вместо перезаписи своей.
check('идентификатор строки совпадает с прежним',
    str_contains($attach, "\$uid . ':' . substr(hash('sha256', \$stamp), 0, 16)"));
check('источник помечен регистрацией', str_contains($attach, "'source'      => 'registration'"));
// Отказать человеку в регистрации из-за сбоя записи было бы хуже самой потери.
check('сбой записи не роняет регистрацию',
    str_contains($attach, 'try {') && str_contains($attach, '} catch (Throwable'));
check('без отпечатка не пишем', str_contains($attach, "if (\$stamp === '') return;"));

// ── Но и молчать о потере нельзя ──────────────────────────────────────────────
// try/catch без счётчика вернул бы ту же тишину, из-за которой и не замечали
// пропаж.
check('отчёт считает зарегистрировавшихся без согласия',
    str_contains($db, '$consentGap') && str_contains($db, "'📝 Согласий: '"));
check('пропажа поднимает тревогу',
    str_contains($db, 'зарегистрировались без записи о согласии'));
check('тревога попадает в список', str_contains($db, "if (\$consentAlert !== '') \$alerts[] = \$consentAlert;"));
check('строка попадает в отчёт', str_contains($db, '$lines[] = $consentLine;'));

// ── Список для фильтра in.(…) экранируется ────────────────────────────────────
// Счётчик выше подставляет в фильтр id людей, а id приходит с клиента при
// регистрации, и формат его никто не проверяет. Запятая внутри разорвала бы
// список на два значения, скобка — сломала бы запрос, а sb_select_all в db.php
// бросает исключение на ответ 4xx: упал бы весь суточный отчёт целиком.
//
// Проверяем не текст функции, а её поведение — текстовые проверки в этой
// сессии уже дважды оказывались пустыми. Тело достаём из db.php и исполняем:
// целиком db.php подключить нельзя, это обработчик запроса, а не библиотека.
$inList = fn_body($db, 'sb_in_list');
check('sb_in_list найдена', $inList !== '');
if ($inList !== '') {
    eval($inList . "\n}\n");
    check('запятая не разрывает список', sb_in_list(['a,b']) === 'in.("a,b")');
    check('скобка не ломает запрос', sb_in_list(['a)b(']) === 'in.("a)b(")');
    check('кавычка экранируется', sb_in_list(['a"b']) === 'in.("a\"b")');
    check('обратная косая экранируется', sb_in_list(['a\\b']) === 'in.("a\\\\b")');
    check('обычные значения не портятся', sb_in_list(['u1', 'u2']) === 'in.("u1","u2")');
}
check('счётчик согласий берёт список через неё',
    str_contains($db, '\'user_id\' => sb_in_list($chunk),'));

if ($failures) {
    echo "consent: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "consent: OK\n";
