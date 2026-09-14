import assert from 'node:assert/strict'
import test from 'node:test'

import { buildWorkerShiftCohort } from '../dashboard/lib/workerCohort.ts'

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
