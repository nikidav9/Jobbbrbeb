import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_VERSION,
  normalizeOnboardingPath,
  onboardingSteps,
  onboardingStorageKey,
} from '../lib/onboardingFlow.ts';

test('новый онбординг имеет отдельный versioned-ключ', () => {
  assert.equal(ONBOARDING_VERSION, 3);
  assert.equal(onboardingStorageKey('user-1'), 'jm_onboarding_v3_user-1');
});

test('сценарии обеих ролей подробные и не содержат повторяющихся шагов', () => {
  for (const role of ['worker', 'employer'] as const) {
    const steps = onboardingSteps(role);
    assert.ok(steps.length >= 12);
    assert.equal(new Set(steps.map(step => step.id)).size, steps.length);
    assert.equal(steps[0].path, '/feed');
    assert.equal(steps.at(-1)?.path, '/profile');
    assert.ok(steps.some(step => step.path === '/matches'));
    assert.ok(steps.some(step => step.path === '/chats'));
  }
});

test('соискатель проходит избранное, работодатель — форму вакансии', () => {
  const worker = onboardingSteps('worker');
  const employer = onboardingSteps('employer');

  assert.ok(worker.some(step => step.path === '/saved'));
  assert.ok(employer.some(step => step.path === '/create-perm-vacancy'));
  assert.ok(employer.some(step => step.target === 'employer.create.publish'));
});

test('пути вкладок нормализуются для сравнения с expo-router', () => {
  assert.equal(normalizeOnboardingPath('/(tabs)/feed'), '/feed');
  assert.equal(normalizeOnboardingPath('/matches/'), '/matches');
  assert.equal(normalizeOnboardingPath('/create-perm-vacancy?onboarding=1'), '/create-perm-vacancy');
});
