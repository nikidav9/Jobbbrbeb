<?php
// «Задать пароль» для аккаунта без пароля (27.09).
//
// После регистрации «почта → код» пароля у человека нет, а экран настроек об
// этом не знал: «Сменить пароль» просил текущий и отвечал «неверный пароль».
// Сервер теперь отдаёт в СВОЁМ профиле признак has_password — но не сам
// пароль и не хеш. Проверка текстовая: живой базы отсюда нет.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
$start = strpos($db, 'function jt_self_user(');
$end = $start !== false ? strpos($db, "\n}\n", $start) : false;
$fn = ($start !== false && $end !== false) ? substr($db, $start, $end - $start) : '';

check('jt_self_user есть', $fn !== '');
check('признак считается по паролю', str_contains($fn, "\$row['has_password'] = (string)(\$row['password'] ?? '') !== '';"));
check('сам пароль из ответа убирается', str_contains($fn, "unset(\$row['password']);"));
check('unset после признака', strpos($fn, "has_password") < strpos($fn, "unset(\$row['password'])"));
// Свой профиль отдаётся только через jt_self_user — иначе признак где-то
// потеряется, а где-то (если кто-то допишет password в USER_SELF_COLS)
// утечёт хеш.
check('USER_SELF_COLS не читается мимо jt_self_user',
    substr_count((string)preg_replace('~^\s*//.*$~m', '', $db), 'USER_SELF_COLS') === 2); // определение + внутри jt_self_user
check('в USER_SELF_COLS нет пароля',
    (bool)preg_match("~define\('USER_SELF_COLS',[^;]*;~", $db, $m) && !str_contains($m[0], 'password'));
check('сессия отдаёт признак', str_contains($db, '$row = jt_self_user($authUid);'));
check('вход по паролю ставит признак', str_contains($db, "\$row['has_password'] = true;"));

$ts = (string)file_get_contents(__DIR__ . '/../services/db.ts');
check('клиент читает признак только как boolean',
    str_contains($ts, "hasPassword: typeof r.has_password === 'boolean' ? r.has_password : undefined,"));

$settings = (string)file_get_contents(__DIR__ . '/../app/profile-settings.tsx');
check('без пароля — «Задать пароль» по коду из письма',
    str_contains($settings, "currentUser.hasPassword === false ? 'Задать пароль' : 'Сменить пароль'")
    && str_contains($settings, "params: { returnTo: 'profile-settings', mode: 'set' }"));

if ($failures) {
    echo "has_password: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "has_password: OK\n";
