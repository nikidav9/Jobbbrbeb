import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(process.cwd(), 'components/CompleteProfileSheet.tsx'), 'utf8');
const saveStart = source.indexOf('  const save = async');
const renderStart = source.indexOf('  if (!visible || !currentUser', saveStart);
const save = saveStart >= 0 && renderStart > saveStart
  ? source.slice(saveStart, renderStart)
  : '';

test('photo failure does not claim age was saved before updateUser succeeds', () => {
  const update = save.indexOf('await updateUser({');
  const ageSaved = save.indexOf('Возраст сохранён. Фото не загрузилось');
  assert.ok(update >= 0 && ageSaved > update);
});

test('photo-only upload failure stays retryable and is not remembered', () => {
  const photoOnlyFailure = save.indexOf('if (photoUploadFailed && !needsAge)');
  const update = save.indexOf('await updateUser({');
  assert.ok(photoOnlyFailure >= 0 && photoOnlyFailure < update);
  assert.match(save, /Фото не загрузилось\. Проверьте связь и попробуйте ещё раз\./);
});

test('partial success keeps the sheet open for a photo retry', () => {
  const partial = save.indexOf("showToast('Возраст сохранён. Фото не загрузилось — попробуйте ещё раз.', 'error');");
  const remember = save.indexOf('remember();');
  assert.ok(partial >= 0 && remember > partial);
  assert.ok(save.slice(partial, remember).includes('return;'));
});
