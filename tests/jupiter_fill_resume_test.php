<?php
// Отклик с телефона (решение владельца 27.09.2026): анкету на сайтах, куда
// сервер не может подать сам (капча, форма на JS), человек заполняет во
// встроенном браузере в app/jupiter-fill.tsx и отправляет своей рукой,
// нажав «Отправить отклик» — jupiterMarkManualSubmitted помечает результат.
// jupiterFillProfile должен приложить к этим данным ссылку на своё же
// выбранное резюме, иначе прикрепить файл на этом экране будет нечем.

$failures = [];
function check(string $name, bool $ok): void
{
    global $failures;
    if (!$ok) $failures[] = $name;
}

/** Тело одного `case` до начала следующего — как отдельных функций, их нет. */
function case_body(string $src, string $name): string
{
    $start = strpos($src, "case '{$name}':");
    if ($start === false) return '';
    $next = strpos($src, "\n        case '", $start + 1);
    return $next !== false ? substr($src, $start, $next - $start) : substr($src, $start);
}

$db = (string)file_get_contents(__DIR__ . '/../php-proxy/db.php');

$selfBlock = substr($db, strpos($db, '$selfArgFns = ['),
    strpos($db, '];', strpos($db, '$selfArgFns = [')) - strpos($db, '$selfArgFns = ['));
check('jupiterFillProfile привязан к владельцу (позиция 0)',
    str_contains($selfBlock, "'jupiterFillProfile' => 0"));

$fillProfile = case_body($db, 'jupiterFillProfile');
check('jupiterFillProfile найден', $fillProfile !== '');
check('резюме берётся только выбранное (selected = true) своего пользователя',
    str_contains($fillProfile, "'user_id' => 'eq.' . \$uidArg, 'selected' => 'eq.true',"));
check('resume_url строится через jt_resume_signed_url по storage_path',
    str_contains($fillProfile, 'jt_resume_signed_url((string)$resume[\'storage_path\'])'));
check('отсутствие подписанной ссылки не роняет запрос',
    (bool)preg_match(
        '~try \{ \$resumeUrl = jt_resume_signed_url.*?catch \(Throwable \$e\)~s',
        $fillProfile
    ));
check('resume_name берёт file_name резюме, иначе запасное имя',
    str_contains($fillProfile, "\$resume && !empty(\$resume['file_name'])")
    && str_contains($fillProfile, "'resume.pdf'"));
check('resume_url и resume_name уходят в ответ',
    str_contains($fillProfile, "'resume_url' => \$resumeUrl,")
    && str_contains($fillProfile, "'resume_name' => \$resumeName,"));
check('jupiterFillProfile по-прежнему не отдаёт согласия',
    !str_contains($fillProfile, 'consent'));

if ($failures) {
    echo "jupiter_fill_resume: ПРОВАЛЫ\n";
    foreach ($failures as $f) echo "  - $f\n";
    exit(1);
}
echo "jupiter_fill_resume: OK\n";
