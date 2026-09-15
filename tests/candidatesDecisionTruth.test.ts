import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(process.cwd(), 'app/candidates.tsx'), 'utf8');

const decideStart = source.indexOf('  const onDecide = async');
const shownStart = source.indexOf('  const shown =', decideStart);
const decide = decideStart >= 0 && shownStart > decideStart
  ? source.slice(decideStart, shownStart)
  : '';

test('rejected candidates do not remain in the actionable list', () => {
  assert.match(source, /l\.workerLiked && !l\.isMatch && l\.employerLiked !== false/);
});

test('candidate decision UI changes only after the server write', () => {
  const rejectWrite = decide.indexOf("await dbUpsertLike(vacancyId, workerId, currentUser.id, { employerLiked: false });");
  const rejectLocal = decide.indexOf("rememberDecision(workerId, 'rejected');");
  const acceptWrite = decide.indexOf("await dbUpsertLike(vacancyId, workerId, currentUser.id, { employerLiked: true });");
  const matchCheck = decide.indexOf('result = await dbCheckAndCreateMatch(vacancyId, workerId);');

  assert.ok(rejectWrite >= 0 && rejectLocal > rejectWrite);
  assert.ok(acceptWrite >= 0 && matchCheck > acceptWrite);
});

test('refresh after a confirmed decision is best-effort', () => {
  assert.match(source, /void refreshAll\(\)\.catch\(\(\) => \{\}\);/);
  assert.ok(decide.includes('refreshAfterDecision();'));
  assert.ok(decide.includes("showToast('Не удалось сохранить решение. Проверьте связь и попробуйте ещё раз.', 'error');"));
});

test('lost match response is not reported as a lost employer decision', () => {
  assert.ok(decide.includes("rememberDecision(workerId, 'accepted');"));
  assert.ok(decide.includes('Решение сохранено, но статус мэтча не подтверждён. Обновите экран.'));
});

test('double taps are blocked while a decision is pending', () => {
  assert.ok(decide.includes('decidingIds.has(workerId)'));
  assert.match(source, /disabled=\{deciding\}/);
});
