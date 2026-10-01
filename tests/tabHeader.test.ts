import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Верх вкладок «Вакансии», «Отклики», «Профиль» не прыгает при переключении
// (просьба владельца 01.10.2026): логотип и поля шапки у всех трёх берутся из
// components/ui/TabLogo.tsx. Своя картинка или свои размеры в одной из вкладок —
// и логотип снова поедет.
const read = (p: string) => readFileSync(p, 'utf8');

test('шапки трёх вкладок берут логотип и поля из TabLogo', () => {
  const screens = {
    'app/(tabs)/feed.tsx': read('app/(tabs)/feed.tsx'),
    'app/(tabs)/matches.tsx': read('app/(tabs)/matches.tsx'),
    'components/profile/ProfileHeader.tsx': read('components/profile/ProfileHeader.tsx'),
  };
  for (const [file, src] of Object.entries(screens)) {
    assert.match(src, /<TabLogo \/>/, `${file}: нет общего логотипа`);
    assert.match(src, /TAB_TOP\.row/, `${file}: нет общих полей шапки`);
    assert.doesNotMatch(src, /header-jt-logo|jt-logo-wide/, `${file}: своя картинка логотипа`);
  }
});

test('шапки «Откликов» и «Профиля» стоят над прокруткой', () => {
  const matches = read('app/(tabs)/matches.tsx');
  const head = matches.indexOf('<View style={[TAB_TOP.row, wm.header]}>');
  assert.ok(head > 0 && head < matches.indexOf('<JTPullRefresh', head), 'шапка «Откликов» уехала в прокрутку');

  const profile = read('app/(tabs)/profile.tsx');
  const bar = profile.indexOf('<ProfileTopBar');
  assert.ok(bar > 0 && bar < profile.indexOf('<JTPullRefresh'), 'шапка «Профиля» уехала в прокрутку');
});
