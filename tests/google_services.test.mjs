// google-services.json должен знать пакет нового приложения: без него сборка
// com.jobtoo не получит ключи Firebase и пуши на Android не заработают.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const gs = JSON.parse(fs.readFileSync(path.join(root, 'google-services.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

test('в google-services.json есть пакет, под которым собирается приложение', () => {
  const pkgs = gs.client.map(c => c.client_info.android_client_info.package_name);
  assert.ok(pkgs.includes(app.android.package), `нет ${app.android.package} среди ${pkgs}`);
});

test('app.json указывает на этот файл', () => {
  assert.equal(app.android.googleServicesFile, './google-services.json');
});
