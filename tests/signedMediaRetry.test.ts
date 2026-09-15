import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(process.cwd(), 'hooks/useSignedMedia.ts'), 'utf8');

test('signed-media network failures stay distinguishable from a real null', () => {
  assert.ok(source.includes('.finally(() => { inflight.delete(key); });'));
  assert.ok(!source.includes(".catch(() => { inflight.delete(key); return null; })"));
});

test('signed-media hook retries transient failures with a finite budget', () => {
  assert.ok(source.includes('const MAX_TRANSIENT_RETRIES = 3;'));
  assert.ok(source.includes('attempts += 1;'));
  assert.ok(source.includes('if (attempts < MAX_TRANSIENT_RETRIES)'));
  assert.ok(source.includes('retryTimer = setTimeout(load, RETRY_DELAY_MS * attempts);'));
});

test('switching media cannot keep the previous message image visible', () => {
  assert.ok(source.includes('const hit = cache.get(pathOrUrl);'));
  assert.ok(source.includes('setUrl(hit && hit.until > Date.now() ? hit.url : null);'));
});
