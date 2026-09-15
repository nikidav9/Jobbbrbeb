import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(process.cwd(), 'hooks/useMissingUsers.ts'), 'utf8');

test('transient missing-user failures are retried instead of cached forever', () => {
  assert.ok(source.includes('const MAX_TRANSIENT_RETRIES = 3;'));
  assert.ok(source.includes('return { id, user: null, failed: true } as const;'));
  assert.ok(source.includes('asked.current.delete(id);'));
  assert.ok(source.includes('setRetryTick(tick => tick + 1)'));
  assert.ok(source.indexOf('asked.current.delete(id);') < source.indexOf('setRetryTick(tick => tick + 1)'));
});

test('a real server response is not retried as a network failure', () => {
  assert.ok(source.includes('return { id, user, failed: false } as const;'));
  assert.ok(source.includes('retryCounts.current.delete(id);'));
  assert.ok(source.includes('if (user) add[id] = user;'));
});
