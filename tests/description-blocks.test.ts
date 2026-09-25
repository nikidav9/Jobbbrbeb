import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDescriptionBlocks } from '../services/descriptionBlocks.ts';

// Разбор описания вакансии на блоки (services/descriptionBlocks.ts) кормит
// components/ui/DescriptionBlocks.tsx — ломается молча: заголовок разъедет
// вёрстку, если строка `## ...` вдруг попадёт в абзац как обычный текст.

test('пустой текст — пустой список блоков', () => {
  assert.deepEqual(parseDescriptionBlocks(''), []);
  assert.deepEqual(parseDescriptionBlocks(null), []);
  assert.deepEqual(parseDescriptionBlocks(undefined), []);
});

test('заголовок распознаётся и теряет маркер', () => {
  assert.deepEqual(parseDescriptionBlocks('## Обязанности'), [
    { type: 'heading', text: 'Обязанности' },
  ]);
});

test('пункт списка — маркеры «•», «-», «*»', () => {
  assert.deepEqual(parseDescriptionBlocks('• Раз\n- Два\n* Три'), [
    { type: 'bullet', text: 'Раз' },
    { type: 'bullet', text: 'Два' },
    { type: 'bullet', text: 'Три' },
  ]);
});

test('обычная строка — абзац', () => {
  assert.deepEqual(parseDescriptionBlocks('Просто текст.'), [
    { type: 'para', text: 'Просто текст.' },
  ]);
});

test('пустые строки — только разделители, блоков не порождают', () => {
  assert.deepEqual(parseDescriptionBlocks('Раз\n\n\nДва'), [
    { type: 'para', text: 'Раз' },
    { type: 'para', text: 'Два' },
  ]);
});

test('полное описание целиком: заголовки, списки и абзацы вперемешку', () => {
  const text = 'Вступление.\n\n## Обязанности\n\n• Первое\n• Второе\n\n## Условия\n\nОбычный абзац.';
  assert.deepEqual(parseDescriptionBlocks(text), [
    { type: 'para', text: 'Вступление.' },
    { type: 'heading', text: 'Обязанности' },
    { type: 'bullet', text: 'Первое' },
    { type: 'bullet', text: 'Второе' },
    { type: 'heading', text: 'Условия' },
    { type: 'para', text: 'Обычный абзац.' },
  ]);
});
