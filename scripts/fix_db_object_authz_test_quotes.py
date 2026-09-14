from pathlib import Path

p = Path('tests/db_object_authz_test.php')
s = p.read_text()
replacements = {
    'str_contains($db, "$chatVacancy = $vacancyId !== \'\'")': 'str_contains($db, "\\$chatVacancy = \\$vacancyId !== \'\'")',
    'str_contains($db, "sb_single(\'jm_vacancies\', [\'id\' => \'eq.\' . $vacancyId], \'employer_id\')")': 'str_contains($db, "sb_single(\'jm_vacancies\', [\'id\' => \'eq.\' . \\$vacancyId], \'employer_id\')")',
    'str_contains($db, "sb_single(\'jm_perm_vacancies\', [\'id\' => \'eq.\' . $vacancyId], \'employer_id\')")': 'str_contains($db, "sb_single(\'jm_perm_vacancies\', [\'id\' => \'eq.\' . \\$vacancyId], \'employer_id\')")',
    'str_contains($db, "(string)($chatVacancy[\'employer_id\'] ?? \'\') !== $employerId")': 'str_contains($db, "(string)(\\$chatVacancy[\'employer_id\'] ?? \'\') !== \\$employerId")',
    'str_contains($db, "$chatCallerRole = (string)($acct[\'role\'] ?? \'\');")': 'str_contains($db, "\\$chatCallerRole = (string)(\\$acct[\'role\'] ?? \'\');")',
    'str_contains($logOpen, "\'user_id\'   => $eventUserId")': 'str_contains($logOpen, "\'user_id\'   => \\$eventUserId")',
    'str_contains($logOpen, "\'role\'      => $eventRole !== \'\' ? $eventRole : null")': 'str_contains($logOpen, "\'role\'      => \\$eventRole !== \'\' ? \\$eventRole : null")',
    '!str_contains($logOpen, "\'user_id\'   => $args[1] ?? null")': '!str_contains($logOpen, "\'user_id\'   => \\$args[1] ?? null")',
    '!str_contains($logOpen, "\'role\'      => $args[2] ?? null")': '!str_contains($logOpen, "\'role\'      => \\$args[2] ?? null")',
}
for old, new in replacements.items():
    count = s.count(old)
    if count != 1:
        raise SystemExit(f'quote fix expected one match, got {count}: {old}')
    s = s.replace(old, new, 1)
p.write_text(s)
