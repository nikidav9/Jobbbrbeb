/**
 * Чистая логика смешанной ленты: свои вакансии JobToo + карьерные с внешних
 * сайтов в одной колоде. Без React и без сети — чтобы проверять node:test,
 * как соседние services/dayGroups.ts и services/energy.ts.
 */
import type { WorkType } from '../constants/types.ts';
import type { JobSection } from '../constants/jobSections.ts';
import { SECTION_BY_WORK_TYPE } from '../constants/jobSections.ts';

/** Раздел своей вакансии по виду работ. Незнакомый/пустой вид — «other». */
export function sectionOfPerm(workType: WorkType | undefined | null): JobSection {
  return (workType && SECTION_BY_WORK_TYPE[workType]) ?? 'other';
}

/** Станция без учёта регистра и «ё»/«е» — «Тёплый Стан» и «теплый стан» совпадают. */
function normalizeMetro(station: string | null | undefined): string {
  return (station ?? '').trim().toLowerCase().replace(/ё/g, 'е');
}

/**
 * Ранжирует свои вакансии под вкус человека: +2 за раздел из его видов
 * работ, +1 за совпадение станции метро. Сортировка стабильная — при
 * равенстве очков порядок не трогается, сервер уже отдаёт свежие первыми.
 */
export function rankOwn<T extends { workType?: WorkType | null; metroStation?: string | null }>(
  items: T[],
  prefs: { sections: JobSection[]; metro?: string | null },
): T[] {
  const metro = normalizeMetro(prefs.metro);
  const score = (v: T) => {
    let s = 0;
    if (prefs.sections.includes(sectionOfPerm(v.workType))) s += 2;
    if (metro && normalizeMetro(v.metroStation) === metro) s += 1;
    return s;
  };
  return items
    .map((v, i) => ({ v, i, s: score(v) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(x => x.v);
}

/**
 * Чередует две колоды по схеме «своя, карьерная, карьерная, своя, …» —
 * каждая `every`-я карта своя, начиная с первой. Когда один из списков
 * кончается, хвост другого идёт подряд, в исходном порядке.
 */
export function interleaveDeck<A, B>(
  own: A[],
  ext: B[],
  every = 3,
): Array<{ own: true; v: A } | { own: false; v: B }> {
  const out: Array<{ own: true; v: A } | { own: false; v: B }> = [];
  let oi = 0;
  let ei = 0;
  let slot = 0;
  while (oi < own.length || ei < ext.length) {
    const wantOwn = slot % every === 0;
    if (wantOwn && oi < own.length) {
      out.push({ own: true, v: own[oi++] });
    } else if (ei < ext.length) {
      out.push({ own: false, v: ext[ei++] });
    } else if (oi < own.length) {
      out.push({ own: true, v: own[oi++] });
    }
    slot += 1;
  }
  return out;
}
