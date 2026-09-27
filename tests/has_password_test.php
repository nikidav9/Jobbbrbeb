<?php
// «Задать пароль» вместо вечного «неверный пароль»: аккаунт «почта → код»
// (решение владельца 27.09.2026) пароля не заводит, и клиенту нужно знать
// об этом заранее, чтобы вести не в бесполезную форму, а сразу к коду из
// письма. Хеш при этом клиенту не должен доставаться никогда, только
// вычисленный булев признак.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

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

// ── Пароль не входит ни в публичную, ни в свою проекцию ─────────────────────
// Это старый инвариант (тест read_authz_test.php), но помощник has_password
// опирается именно на него: если password когда-нибудь попадёт в одну из
// проекций, помощник обязан его вырезать, а не просто скопировать булево поле.
if (preg_match("~define\('USER_PUBLIC_COLS',(.*?)\]\)\);~s", $db, $m)) {
    check('пароль не в публичной проекции', !str_contains($m[1], 'password'));
}
if (preg_match("~define\('USER_SELF_COLS',\s*(.*?)\);~", $db, $m)) {
    check('пароль не в своей проекции — только через отдельный точечный запрос',
        !str_contains($m[1], 'password'));
}

// ── Помощник объявлен и подключён в нужных местах ────────────────────────────
check('функция-помощник объявлена', str_contains($db, 'function jt_attach_has_password('));
foreach (['dbLogin', 'dbSession'] as $fn) {
    check("$fn отдаёт has_password через общий помощник",
        str_contains(case_body($db, $fn), 'jt_attach_has_password('));
}
$verify = case_body($db, 'dbAuthVerifyCode');
check('dbAuthVerifyCode (вход по коду) отдаёт has_password через общий помощник',
    str_contains($verify, "purpose === 'login'") && str_contains($verify, 'jt_attach_has_password('));
check('dbAuthResetPassword отдаёт has_password через общий помощник',
    str_contains(case_body($db, 'dbAuthResetPassword'), 'jt_attach_has_password('));

// ── Поведение самого помощника — на заглушке точечного запроса ──────────────
// Свою db.php целиком не подключаем: это обработчик запроса, а не библиотека
// (та же оговорка, что в consent_test.php у sb_in_list). Достаём тело функции
// и исполняем его на заглушке sb_single.
$fnBody = fn_body($db, 'jt_attach_has_password');
check('тело функции найдено', $fnBody !== '');
if ($fnBody !== '') {
    $GLOBALS['STORE'] = ['u1' => 'somehash', 'u2' => ''];
    function sb_single(string $t, array $f = [], string $sel = '*'): ?array
    {
        // Единственный запрос, который должен делать сам помощник, —
        // точечный, только за колонкой password.
        if ($sel !== 'password') throw new RuntimeException("неожиданная выборка: $sel");
        $id = substr((string)($f['id'] ?? ''), 3); // срезаем 'eq.'
        if (!array_key_exists($id, $GLOBALS['STORE'])) return null;
        return ['password' => $GLOBALS['STORE'][$id]];
    }
    eval($fnBody . "\n}\n");

    check('null остаётся null', jt_attach_has_password(null) === null);

    // Строка уже содержит password (как у dbLogin — select *).
    $withPwd = jt_attach_has_password(['id' => 'x', 'password' => 'hash123']);
    check('хеш в строке — has_password true', $withPwd['has_password'] === true);
    check('хеш вырезан из ответа', !array_key_exists('password', $withPwd));

    $emptyPwd = jt_attach_has_password(['id' => 'x', 'password' => '']);
    check('пустой пароль в строке — has_password false', $emptyPwd['has_password'] === false);
    check('поле password вырезано и при пустом значении', !array_key_exists('password', $emptyPwd));

    // Строка без колонки password (как из USER_SELF_COLS — dbSession и т.п.):
    // помощник дочитывает её отдельным запросом, а не добавляет колонку в проекцию.
    $noCol = jt_attach_has_password(['id' => 'u1', 'first_name' => 'Иван']);
    check('дочитанный пароль есть — has_password true', $noCol['has_password'] === true);
    check('колонка password не появилась в ответе', !array_key_exists('password', $noCol));

    $noCol2 = jt_attach_has_password(['id' => 'u2', 'first_name' => 'Пётр']);
    check('дочитанный пустой пароль — has_password false', $noCol2['has_password'] === false);

    $noCol3 = jt_attach_has_password(['id' => 'u3']);
    check('аккаунта в заглушке нет — считаем, что пароля нет', $noCol3['has_password'] === false);
}

if ($failures) {
    echo "has_password: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "has_password: OK\n";
