<?php

require_once __DIR__ . '/../php-proxy/feed_funnel.php';

$failures = [];
function feed_check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

feed_check('доля партнёрских показов', feed_share(8, 10) === 80);
feed_check('без показов доли нет', feed_share(0, 0) === null);
feed_check('доля ограничена сотней', feed_share(12, 10) === 100);
feed_check('строка ленты не смешивает показы и переходы',
    feed_impression_line(2, 8, 3) === '👀 Лента за сутки: свои показы <b>2</b>, партнёрские <b>8</b> (партнёрские 80%), переходы к партнёрам <b>3</b>');
feed_check('гостевая воронка показывает все шаги',
    guest_funnel_line(10, 3, 4, 3, 2) === '🚪 Гости: показы <b>10</b> → к партнёрам <b>3</b> / хотят откликнуться <b>4</b> → начали регистрацию <b>3</b> → завершили <b>2</b>');

feed_check('при откликах диагноз не нужен', zero_application_diagnosis(1, 0, 0, 0, 0, 0, 0) === '');
feed_check('нет показов — проблема до ленты', str_contains(zero_application_diagnosis(0, 0, 0, 0, 0, 0, 0), 'карточки не показаны'));
feed_check('партнёрская лента объясняет другой целевой шаг', str_contains(zero_application_diagnosis(0, 2, 8, 3, 0, 0, 0), 'результатом считается переход (3)'));
feed_check('показы без намерения видны', str_contains(zero_application_diagnosis(0, 7, 1, 0, 4, 0, 0), 'до намерения'));
feed_check('обрыв регистрации виден', str_contains(zero_application_diagnosis(0, 7, 1, 0, 4, 2, 0), 'регистрация не завершается'));
feed_check('потеря отклика после регистрации видна', str_contains(zero_application_diagnosis(0, 7, 1, 0, 4, 2, 1), 'отклик не записывается'));

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');
feed_check('правило подключено', str_contains($db, "require_once __DIR__ . '/feed_funnel.php';"));
feed_check('диагноз попадает в отчёт', str_contains($db, '$lines[] = $zeroApplicationLine;'));
feed_check('показы своих смен считаются по времени просмотра', str_contains($db, "sb_count('jm_vacancy_views', ['viewed_at' => 'gte.' . \$cut24])"));
feed_check('партнёрский целевой шаг — переход',
    str_contains($db, "'event_type' => 'in.(impression,click)'")
    && str_contains($db, "\$partnerClicks = \$signedInPartnerClicks + \$guestExternalClicks;"));
feed_check('повторный просмотр обновляет суточное окно', substr_count($db, 'resolution=merge-duplicates,return=minimal') >= 2);

if ($failures) {
    echo "feed_funnel: ПРОВАЛЫ\n";
    foreach ($failures as $failure) echo "  - {$failure}\n";
    exit(1);
}

echo "feed_funnel: OK\n";
