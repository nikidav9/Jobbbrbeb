<?php
// Смену закрывает её сторона, а не любой вошедший.
//
// dbSetShiftOutcome, dbConfirmShift и dbCancelShift требовали входа, но не
// спрашивали, ЧЬЯ смена: владелец там не довод запроса, а поле в строке, и в
// $selfArgFns такие не попадают. Любой вошедший мог поставить чужой смене
// невыход — а невыход бьёт по рейтингу человека сильнее всего остального.
//
// Проверка текстовая: обработчик нельзя подключить, не выполнив запрос. Зато
// она ловит то, ради чего писалась, — исчезновение сторожа.

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

check('сторож заведён', str_contains($db, 'function jt_shift_party('));
check('чужая смена — отказ', str_contains($db, "jt_respond(['error' => 'Это не ваша смена'], 403)"));
check('несуществующая смена — не отказ, а «не найдено»',
    str_contains($db, "jt_respond(['error' => 'Смена не найдена'], 404)"));
// Пустой $authUid не должен проходить как «совпал с пустым employer_id».
check('без входа не пускаем', str_contains($db, "\$uid !== '' && (\$uid === \$employerId"));

// Нынешнюю отметку ставит работодатель и только он: в приложении она живёт на
// экране EmployerMatches.
check('итог смены — только работодатель',
    str_contains($db, 'jt_shift_party((string)$lid, $authUid, true);'));
// Старые операции принимают обе стороны: какая из них зовёт их в давно
// установленном приложении, мы не знаем, а сломать его — ровно то, ради чего
// они оставлены.
check('старое подтверждение — любая сторона',
    str_contains($db, "jt_shift_party((string)\$args[0], \$authUid, false);"));
check('старая отмена тоже прикрыта',
    substr_count($db, "jt_shift_party((string)\$args[0], \$authUid, false);") >= 2);

// Кто отметил — из подписанной сессии. Раньше сюда клали присланное клиентом
// поле, и человек мог подписать чужой отметкой кого угодно.
check('отметивший берётся из сессии', str_contains($db, "'outcome_by'   => \$authUid,"));
check('присланное клиентом поле больше не пишется', !str_contains($db, "'outcome_by'   => \$opts['by']"));

// Сторож должен стоять ДО записи, а не после: проверка после sb_update ничего
// не защищает — чужая смена к тому моменту уже переписана.
foreach ([
    ['dbSetShiftOutcome', 'jt_shift_party((string)$lid, $authUid, true);'],
    ['dbConfirmShift', "jt_shift_party((string)\$args[0], \$authUid, false);"],
] as [$case, $guard]) {
    $start = strpos($db, "case '$case': {");
    check("$case: сторож найден", $start !== false);
    if ($start === false) continue;
    $guardAt = strpos($db, $guard, $start);
    $updateAt = strpos($db, "sb_update('jm_likes'", $start);
    check("$case: сторож стоит до записи",
        $guardAt !== false && $updateAt !== false && $guardAt < $updateAt);
}

if ($failures) {
    echo "shift authz: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "shift authz: OK\n";
