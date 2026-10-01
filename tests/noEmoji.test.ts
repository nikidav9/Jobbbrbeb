import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Смайликов в приложении нет (решение владельца 01.10.2026): вместо них —
// фирменные иконки. Сторож ищет в экранах и компонентах символы, которые
// телефон рисует цветной картинкой. Комментарии не в счёт. Обычные значки
// шрифта (→ ★ ✓ ✕) — текст, их можно.
const ROOTS = ['app', 'components', 'services', 'lib', 'contexts', 'constants', 'hooks'];
// Распознавание, а не показ: колокольчик узнаёт старые заголовки по эмодзи,
// которыми их писал сервер; разбор резюме — маркеры списка из PDF.
const ALLOWED_FILES = new Set([
  'services/notificationRoute.ts', 'lib/stripEmoji.ts', 'components/ui/NotifBell.tsx', 'lib/resumeParser.ts',
]);
const PICTO = /[\p{Extended_Pictographic}️]/u;
const ALWAYS_TEXT = new Set(['©', '®', '™', '★', '☆', '✓', '✕', '✔', '↺', '↻', '↩']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

test('в интерфейсе нет смайликов', () => {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const f of files(root)) {
      if (ALLOWED_FILES.has(f)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/\/\*.*?\*\//g, '');
        for (const ch of code) {
          if ((PICTO.test(ch) && !ALWAYS_TEXT.has(ch)) || ch === '↗') hits.push(`${f}:${i + 1} ${ch}`);
        }
      });
    }
  }
  assert.deepEqual(hits, []);
});
