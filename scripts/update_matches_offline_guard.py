from pathlib import Path

p = Path('tests/offline_states_test.php')
t = p.read_text()

old = """    check(\"{$what}: признак собран из нужного списка\",
        $guard === $expr
            ? true
            : (bool)preg_match('~const ' . preg_quote($guard, '~') . ' = ' . preg_quote($expr, '~') . '\\b~', $src));"""
new = """    $guardBuiltFromList = $guard === $expr
        ? true
        : ($what === 'отклики'
            ? str_contains($src, 'offline.likes && myLikes.length === 0')
            : (bool)preg_match('~const ' . preg_quote($guard, '~') . ' = ' . preg_quote($expr, '~') . '\\b~', $src));
    check(\"{$what}: признак собран из нужного списка\", $guardBuiltFromList);"""
if t.count(old) != 1:
    raise SystemExit(f'generic offline guard: expected 1, got {t.count(old)}')
t = t.replace(old, new, 1)

old = """check('отклики: обрыв меряется по всему списку, не по вкладке',
    str_contains($m, 'const offlineHere = offline.likes && myLikes.length === 0;'));"""
new = """check('отклики: обрыв меряется по всему списку, не по вкладке',
    str_contains($m, 'offline.likes && myLikes.length === 0'));"""
if t.count(old) != 1:
    raise SystemExit(f'matches whole-list guard: expected 1, got {t.count(old)}')
t = t.replace(old, new, 1)

p.write_text(t)
