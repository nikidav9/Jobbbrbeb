/**
 * Полное описание вакансии (php-proxy/vacancy_text.php, vt_extract) приходит
 * лёгким markdown: `## Заголовок` для разделов, `• пункт` для списков,
 * остальное — обычные абзацы. Здесь разбор этого текста на блоки для
 * components/ui/DescriptionBlocks.tsx — сама разметка (жирный заголовок,
 * точка у пункта) там, чтение текста здесь, чтобы разбор можно было
 * проверить тестом без рендера.
 */

export type DescriptionBlock =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'para'; text: string };

/** Разбить текст описания на блоки. Пустые строки — только разделители. */
export function parseDescriptionBlocks(text?: string | null): DescriptionBlock[] {
  if (!text) return [];
  const blocks: DescriptionBlock[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      blocks.push({ type: 'heading', text: line.slice(3).trim() });
    } else if (line.startsWith('• ') || line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({ type: 'bullet', text: line.slice(2).trim() });
    } else {
      blocks.push({ type: 'para', text: line });
    }
  }
  return blocks;
}
