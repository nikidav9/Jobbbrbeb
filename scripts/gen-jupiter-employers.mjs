// Перечень работодателей Юпитера для документа «Работодатели Юпитера»
// (constants/legal.ts, Соглашение п. 8.4) — из каталога разведки
// scripts/career-sites.tsv. Боевая подача идёт только на хосты этого каталога
// (jupiter/site_compat.live_ready), поэтому перечень полный.
//   node scripts/gen-jupiter-employers.mjs
// Сверку с каталогом держит tests/jupiter-employers.test.mjs.
import { readFileSync, writeFileSync } from 'node:fs';

export function employersFromTsv(text) {
  const byHost = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [rawName, rawUrl] = line.split('\t');
    let host;
    try { host = new URL((rawUrl || '').trim()).hostname.toLowerCase(); } catch { continue; }
    host = host.replace(/^www\./, '');
    // «Сбер — IT» и «Сбер — розница» — один работодатель на одном сайте.
    const name = rawName.trim().split(' — ')[0].replace(/\s*\(.*\)$/, '').trim();
    if (!byHost.has(host)) byHost.set(host, name);
  }
  return [...byHost].map(([host, name]) => [name, host])
    .sort((a, b) => a[0].localeCompare(b[0], 'ru') || a[1].localeCompare(b[1]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = employersFromTsv(readFileSync('scripts/career-sites.tsv', 'utf8'));
  const body = rows.map(([n, h]) => `  [${JSON.stringify(n)}, ${JSON.stringify(h)}],`).join('\n');
  writeFileSync('constants/jupiterEmployers.ts',
    `// Сгенерировано scripts/gen-jupiter-employers.mjs из scripts/career-sites.tsv — не править руками.\n` +
    `export const JUPITER_EMPLOYERS: [name: string, host: string][] = [\n${body}\n];\n`);
  console.log(rows.length);
}
