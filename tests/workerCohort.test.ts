import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWorkerActivationCohort,
  buildWorkerShiftCohort,
} from '../dashboard/lib/workerCohort.ts'

const now = new Date('2026-09-14T12:00:00.000Z')
const users = [
  { id: 'too-old', role: 'worker', created_at: '2026-08-07T11:59:59.000Z' },
  { id: 'registered', role: 'worker', created_at: '2026-08-10T12:00:00.000Z' },
  { id: 'applied', role: 'worker', created_at: '2026-08-20T12:00:00.000Z' },
  { id: 'matched', role: 'worker', created_at: '2026-08-25T12:00:00.000Z' },
  { id: 'worked', role: 'worker', created_at: '2026-09-01T12:00:00.000Z' },
  { id: 'too-new', role: 'worker', created_at: '2026-09-08T12:00:00.000Z' },
  { id: 'employer', role: 'employer', created_at: '2026-08-20T12:00:00.000Z' },
]

const profile = {
  first_name: 'Иван',
  last_name: 'Иванов',
  metro_station: 'Сухаревская',
  work_types: ['picker'],
}

test('worker cohort compares the same people through every shift stage', () => {
  const result = buildWorkerShiftCohort(users, [
    { worker_id: 'applied', worker_liked: true },
    { worker_id: 'matched', is_match: true },
    { worker_id: 'worked', outcome: 'worked' },
    { worker_id: 'too-old', outcome: 'worked' },
    { worker_id: 'too-new', worker_liked: true },
  ], now)

  assert.deepEqual(result.steps.map(step => step.value), [4, 3, 2, 1, 1])
  assert.equal(result.from, '2026-08-08T12:00:00.000Z')
  assert.equal(result.to, '2026-09-07T12:00:00.000Z')
  assert.deepEqual(result.biggestDrop, {
    from: 'Получили совпадение',
    to: 'Подтвердили',
    lost: 1,
    rate: 50,
  })
})

test('higher stages include implied earlier stages for legacy rows', () => {
  const result = buildWorkerShiftCohort(users, [
    { worker_id: 'worked', shift_completed: true, worker_liked: false, is_match: false },
  ], now)

  assert.deepEqual(result.steps.map(step => step.value), [4, 1, 1, 1, 1])
})

test('invalid dates and users outside the mature cohort are excluded', () => {
  const result = buildWorkerShiftCohort([
    ...users,
    { id: 'broken', role: 'worker', created_at: 'not-a-date' },
  ], [], now)

  assert.equal(result.steps[0].value, 4)
})

test('full activation cohort follows the same mature workers from profile to work', () => {
  const activationUsers = [
    { id: 'registered', role: 'worker', created_at: '2026-08-10T12:00:00.000Z' },
    { id: 'viewed', role: 'worker', created_at: '2026-08-15T12:00:00.000Z', ...profile },
    { id: 'applied', role: 'worker', created_at: '2026-08-20T12:00:00.000Z', ...profile },
    { id: 'approved-perm', role: 'worker', created_at: '2026-08-25T12:00:00.000Z', ...profile },
    { id: 'worked', role: 'worker', created_at: '2026-09-01T12:00:00.000Z', ...profile },
    { id: 'too-new', role: 'worker', created_at: '2026-09-08T12:00:00.000Z', ...profile },
  ]

  const result = buildWorkerActivationCohort(
    activationUsers,
    [
      { worker_id: 'applied', worker_liked: true, created_at: '2026-08-22T12:00:00.000Z' },
      { worker_id: 'worked', outcome: 'worked', created_at: '2026-09-03T12:00:00.000Z' },
      { worker_id: 'too-new', outcome: 'worked', created_at: '2026-09-10T12:00:00.000Z' },
    ],
    [
      { worker_id: 'approved-perm', status: 'approved', created_at: '2026-08-28T12:00:00.000Z' },
    ],
    [{ worker_id: 'viewed', viewed_at: '2026-08-16T12:00:00.000Z' }],
    [],
    now,
  )

  assert.deepEqual(result.steps.map(step => step.value), [5, 4, 4, 3, 2, 1])
  assert.deepEqual(result.steps.map(step => step.name), [
    'Зарегистрировались',
    'Профиль готов',
    'Посмотрели вакансию',
    'Откликнулись',
    'Получили одобрение',
    'Вышли на смену',
  ])
  assert.equal(result.legacyProfileAnomalies, 0)
})

test('permanent applications count as applications and approvals', () => {
  const result = buildWorkerActivationCohort(
    [{ id: 'perm', role: 'worker', created_at: '2026-08-20T12:00:00.000Z', ...profile }],
    [],
    [{ worker_id: 'perm', status: 'hired', created_at: '2026-08-21T12:00:00.000Z' }],
    [],
    [],
    now,
  )

  assert.deepEqual(result.steps.map(step => step.value), [1, 1, 1, 1, 1, 0])
  assert.equal(result.appliedWithin7d, 1)
})

test('a later activation fact implies missing earlier telemetry', () => {
  const result = buildWorkerActivationCohort(
    [{ id: 'worked', role: 'worker', created_at: '2026-08-20T12:00:00.000Z', ...profile }],
    [{ worker_id: 'worked', shift_completed: true, created_at: '2026-08-25T12:00:00.000Z' }],
    [],
    [],
    [],
    now,
  )

  assert.deepEqual(result.steps.map(step => step.value), [1, 1, 1, 1, 1, 1])
  assert.equal(result.appliedWithin7d, 1)
})

test('legacy activity with an incomplete profile is diagnosed, not counted as profile-ready', () => {
  const result = buildWorkerActivationCohort(
    [{ id: 'legacy', role: 'worker', created_at: '2026-08-20T12:00:00.000Z' }],
    [{ worker_id: 'legacy', outcome: 'worked', created_at: '2026-08-25T12:00:00.000Z' }],
    [],
    [],
    [],
    now,
  )

  assert.deepEqual(result.steps.map(step => step.value), [1, 0, 0, 0, 0, 0])
  assert.equal(result.legacyProfileAnomalies, 1)
})
