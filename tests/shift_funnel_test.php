<?php

require_once __DIR__ . '/../php-proxy/shift_funnel.php';

$failures = [];
function shift_check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

$now = 1_757_800_000;
$window = shift_application_window($now);
shift_check('когорта длится 30 дней', strtotime($window['to']) - strtotime($window['from']) === 30 * 86400);
shift_check('когорта дозревает 7 дней', strtotime($window['to']) === $now - 7 * 86400);

shift_check('доля считается', shift_ratio(3, 10) === 0.3);
shift_check('без знаменателя доли нет', shift_ratio(0, 0) === null);
shift_check('доля не выше 100%', shift_ratio(12, 10) === 1.0);

$outcome = shift_outcome_line([
    'worked' => 5,
    'no_show' => 2,
    'worker_cancelled' => 3,
    'employer_cancelled' => 1,
    'cancelled_legacy' => 4,
]);
shift_check('исходы показывают выходы и невыходы', str_contains($outcome, 'вышли <b>5</b>') && str_contains($outcome, 'не вышли <b>2</b>'));
shift_check('отмены сложены', str_contains($outcome, 'отменены <b>8</b>'));
shift_check('причины отмен не потеряны', str_contains($outcome, 'работник 3, работодатель 1, без причины 4'));

shift_check('конверсия подписана числами и процентом', shift_conversion_line(20, 5) === '🎯 Отклик → выход за 30 дней: <b>5</b> из <b>20</b> (25%)');
shift_check('пустая когорта не становится нулевой конверсией', !str_contains(shift_conversion_line(0, 0), '%'));
shift_check('повторная смена считается от первой', second_shift_line(8, 3) === '🔁 Повторный выход: <b>3</b> из <b>8</b> работников (38%)');

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
shift_check('правило подключено', str_contains($db, "require_once __DIR__ . '/shift_funnel.php';"));
shift_check('исходы попадают в отчёт', str_contains($db, '$lines[] = $shiftOutcomeLine;'));
shift_check('конверсия попадает в отчёт', str_contains($db, '$lines[] = $shiftConversionLine;'));
shift_check('повторный выход попадает в отчёт', str_contains($db, '$lines[] = $secondShiftLine;'));
shift_check('суточные исходы считаются по времени исхода', str_contains($db, "'outcome_at' => 'gte.' . \$cut24"));
shift_check('повторные смены считаются по подтверждённому счётчику', str_contains($db, "'score_shifts' => 'gte.2'"));

if ($failures) {
    echo "shift_funnel: ПРОВАЛЫ\n";
    foreach ($failures as $failure) echo "  - {$failure}\n";
    exit(1);
}

echo "shift_funnel: OK\n";
