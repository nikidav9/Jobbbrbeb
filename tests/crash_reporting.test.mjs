// Отчёты о падениях (AppMetrica, 03.10.2026): только сбои, только с согласием,
// без идентификатора человека. Читает исходники — SDK в node не запустить.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const svc = read('services/crashReporting.ts');

test('только сбои: сессии, геолокация и рекламные ID выключены', () => {
  for (const line of [
    'crashReporting: true', 'nativeCrashReporting: true', 'sessionsAutoTracking: false',
    'appOpenTrackingEnabled: false', 'locationTracking: false', 'advIdentifiersTracking: false',
  ]) assert.ok(svc.includes(line), line);
});

test('человека в отчёт не кладём, событий нет', () => {
  const files = ['services', 'app', 'components', 'contexts', 'hooks', 'lib']
    .flatMap(d => fs.readdirSync(path.join(root, d), { recursive: true, withFileTypes: true })
      .filter(e => e.isFile() && /\.tsx?$/.test(e.name))
      .map(e => path.join(e.parentPath, e.name)));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const bad of ['userProfileID', 'setUserProfileID', 'AppMetrica.reportEvent', 'reportUserProfile', 'reportRevenue']) {
      assert.ok(!src.includes(bad), `${path.relative(root, f)}: ${bad}`);
    }
  }
});

test('ключ — из окружения сборки, в коде его нет; без ключа и на вебе — ничего', () => {
  assert.match(svc, /process\.env\.EXPO_PUBLIC_APPMETRICA_API_KEY/);
  assert.match(svc, /Platform\.OS !== 'web' && API_KEY !== ''/);
  assert.ok(!/apiKey:\s*'[0-9a-f-]{20,}'/i.test(svc));
  assert.ok(!read('eas.json').includes('APPMETRICA'));
});

test('нативный модуль подключается через require, а не import (веб его не трогает)', () => {
  assert.match(svc, /require\('@appmetrica\/react-native-analytics'\)/);
  assert.ok(!/^import .*appmetrica/m.test(svc));
});

test('запуск и отключение — только по согласию (ConsentGate)', () => {
  const gate = read('components/ConsentGate.tsx');
  assert.match(gate, /const consentOk = !!user && !user\.isGuest && checked && !needed && !checkFailed;/);
  assert.match(gate, /setCrashReportingAllowed\(consentOk\)/);
  assert.equal(
    (svc.match(/r\.activate\(/g) ?? []).length, 1, 'SDK запускается в одном месте',
  );
});

test('версия SDK закреплена точно', () => {
  assert.equal(JSON.parse(read('package.json')).dependencies['@appmetrica/react-native-analytics'], '4.2.0');
});

test('отчёты о сбоях записаны в документы: перечень данных, получатель, версии', () => {
  const legal = read('constants/legal.ts');
  assert.equal((legal.match(/Отчёты о сбоях мобильного приложения: тип устройства/g) ?? []).length, 2, 'Политика и Согласие');
  assert.equal((legal.match(/сервис отчётов о сбоях приложения AppMetrica \(ООО «ЯНДЕКС»\)/g) ?? []).length, 2, 'Согласие и dataPolicy');
  assert.equal((legal.match(/для выявления сбоев приложение передаёт отчёты о сбоях сервису AppMetrica/g) ?? []).length, 2, 'Политика и dataPolicy о cookie');
  for (const key of ['privacy', 'consent']) {
    const i = legal.indexOf(`  ${key}: {`);
    assert.match(legal.slice(i, i + 400), /consentVersion: '2026-10-03'/, key);
  }
  // Открытые документы на сайте пересобраны из тех же текстов.
  assert.ok(read('public/landing/docs.json').includes('AppMetrica'));
});

test('нативная сборка и обновление по воздуху получают одни и те же ключи', () => {
  const build = read('.github/workflows/eas-build.yml');
  const update = read('.github/workflows/eas-update.yml');
  // Ключ приложения в бинарнике: без него первый запуск получает «Forbidden».
  assert.match(build, /EXPO_PUBLIC_APP_SECRET = \$k/);
  assert.match(build, /Секрет EXPO_PUBLIC_APP_SECRET пуст/);
  assert.match(build, /\.build\.production\.env\.EXPO_PUBLIC_APPMETRICA_API_KEY = \$k/);
  // Обновление по воздуху заменяет встроенный бандл — ключ AppMetrica нужен и там.
  assert.match(update, /EXPO_PUBLIC_APPMETRICA_API_KEY: \$\{\{ secrets\.EXPO_PUBLIC_APPMETRICA_API_KEY \}\}/);
  assert.match(update, /EXPO_PUBLIC_APP_SECRET: \$\{\{ secrets\.EXPO_PUBLIC_APP_SECRET \}\}/);
});

test('резервная копия данных Android выключена (токен сессии не уезжает в облако)', () => {
  assert.equal(JSON.parse(read('app.json')).expo.android.allowBackup, false);
});
