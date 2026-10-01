<?php
// Отклик письмом (п.4, решение владельца 01.10.2026).
//
// Юпитер не нашёл анкету, но на странице вакансии есть HR-почта компании
// (jupiter/email_apply.py) — итог EMAIL_APPLY с адресом. Письмо шлёт сервер:
// - только по разрешению отправлять отклики (submission_authorized_at);
// - только на домен самой вакансии — адрес от воркера перепроверяется здесь;
// - с выбранным PDF-резюме во вложении;
// - «Имя Фамилия через JobToo» <ящик входа SMTP> (Timeweb не пускает иной
//   отправитель), Reply-To — личный адрес кандидата имя.фамилия@jobtoo.ru:
//   ответ работодателя придёт в «Почту JobToo» и подтвердит отклик;
// - в письме только то, что человек сам указал в профиле, ничего не выдумываем;
// - общий потолок JT_EMAIL_APPLY_PER_HOUR — репутация домена важнее скорости.

const JT_EMAIL_APPLY_PER_HOUR = 60;
const JT_EMAIL_APPLY_MAX_PDF = 10 * 1024 * 1024;

/** Зарегистрированный домен: career.sibur.ru → sibur.ru, x.com.ru → x.com.ru. */
function jt_email_apply_registrable(string $host): string
{
    $parts = explode('.', strtolower(trim($host, '.')));
    $n = count($parts);
    if ($n >= 3 && in_array($parts[$n - 2] . '.' . $parts[$n - 1], ['com.ru', 'net.ru', 'org.ru', 'msk.ru', 'spb.ru'], true)) {
        return implode('.', array_slice($parts, -3));
    }
    return implode('.', array_slice($parts, -2));
}

/** Адрес годится: корректный и на домене самой вакансии. */
function jt_email_apply_domain_ok(string $to, string $vacancyUrl): bool
{
    if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n<>]/', $to)) return false;
    $host = (string)parse_url($vacancyUrl, PHP_URL_HOST);
    $domain = substr($to, strrpos($to, '@') + 1);
    return $host !== '' && jt_email_apply_registrable($domain) === jt_email_apply_registrable($host);
}

/** [тема, текст, подпись отправителя] — из того, что человек указал сам. */
function jt_email_apply_letter(array $user, string $company, string $vacancyUrl, string $replyTo): array
{
    $name = trim(trim((string)($user['first_name'] ?? '')) . ' ' . trim((string)($user['last_name'] ?? '')));
    $who = $name !== '' ? $name : 'Кандидат';
    $lines = [
        'Здравствуйте!',
        '',
        'Откликаюсь на вашу вакансию' . ($company !== '' ? ' в ' . $company : '') . ':',
        $vacancyUrl,
        '',
        'Резюме — во вложении.',
        '',
        'Контакты для связи:',
        $who,
    ];
    $phone = trim((string)($user['phone'] ?? ''));
    if ($phone !== '') $lines[] = 'Телефон: ' . $phone;
    $lines[] = 'Почта: ' . $replyTo;
    $lines[] = '';
    $lines[] = '—';
    $lines[] = 'Письмо отправлено через JobToo по поручению кандидата. Ответ на него придёт кандидату.';
    return ['Отклик на вакансию — ' . $who, implode("\n", $lines), $who . ' через JobToo'];
}

/** Занять место под письмо в общем часовом потолке. false — потолок исчерпан. */
function jt_email_apply_cap_take(?string $file = null, ?int $now = null): bool
{
    $file ??= sys_get_temp_dir() . '/jt-email-apply-hour.json';
    $now ??= time();
    $fh = @fopen($file, 'c+');
    if (!$fh) return false;
    try {
        flock($fh, LOCK_EX);
        $st = json_decode((string)stream_get_contents($fh), true);
        if (!is_array($st) || (int)($st['since'] ?? 0) + 3600 <= $now) $st = ['since' => $now, 'sent' => 0];
        if ((int)$st['sent'] >= JT_EMAIL_APPLY_PER_HOUR) return false;
        $st['sent'] = (int)$st['sent'] + 1;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($st));
        return true;
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

/** Байты выбранного PDF-резюме или null. */
function jt_email_apply_resume(string $userId): ?array
{
    $resume = sb_single('jm_resume_files', ['user_id' => 'eq.' . $userId, 'selected' => 'eq.true'],
        'storage_path,file_name');
    if (!$resume || empty($resume['storage_path'])) return null;
    $ch = curl_init(jt_resume_signed_url((string)$resume['storage_path']));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_MAXFILESIZE => JT_EMAIL_APPLY_MAX_PDF]);
    $bytes = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || !is_string($bytes) || strncmp($bytes, '%PDF', 4) !== 0
        || strlen($bytes) > JT_EMAIL_APPLY_MAX_PDF) {
        return null;
    }
    $name = basename((string)($resume['file_name'] ?? '')) ?: 'resume.pdf';
    if (!str_ends_with(strtolower($name), '.pdf')) $name .= '.pdf';
    return [$name, $bytes];
}

/**
 * Отправить отклик письмом. null — письмо принято почтовым сервером, иначе
 * причина. $deps — для теста: resume(uid), mailbox(uid), user(uid), send(...).
 */
function jt_email_apply_send(array $task, string $to, array $deps = []): ?string
{
    $uid = (string)($task['user_id'] ?? '');
    $vacancyUrl = (string)($task['vacancy_url'] ?? '');
    if (empty($task['submission_authorized_at'])) return 'отправка не разрешена';
    if (!jt_email_apply_domain_ok($to, $vacancyUrl)) return 'адрес не на домене вакансии';
    $user = ($deps['user'] ?? fn($u) => sb_single('jm_users', ['id' => 'eq.' . $u], 'first_name,last_name,phone,is_blocked'))($uid);
    if (!$user || !empty($user['is_blocked'])) return 'нет пользователя';
    $replyTo = ($deps['mailbox'] ?? 'jt_jupiter_mailbox')($uid);
    if (!$replyTo) return 'нет личного адреса JobToo';
    $file = ($deps['resume'] ?? 'jt_email_apply_resume')($uid);
    if (!$file) return 'резюме PDF недоступно';
    if (!($deps['cap'] ?? 'jt_email_apply_cap_take')()) return 'исчерпан часовой потолок писем';
    [$subject, $text, $fromName] = jt_email_apply_letter($user, (string)($task['company'] ?? ''), $vacancyUrl, $replyTo);
    $send = $deps['send'] ?? fn(...$a) => jt_mail_send($a[0], $a[1], $a[2], null, false, $log, $a[3]);
    return $send($to, $subject, $text, [
        'from_name' => $fromName, 'reply_to' => $replyTo, 'deadline' => 40,
        'attachments' => [[$file[0], 'application/pdf', $file[1]]],
    ]);
}
