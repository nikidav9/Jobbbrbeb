import { Like, User, Vacancy } from '@/constants/types';

/**
 * Подбор — в обе стороны.
 *
 * До этого он был один и состоял из трёх чисел: та же станция — 100, та же
 * ветка — 60, всё прочее — 20. Это не подбор, а сортировка по метро; и
 * обратной стороны — кого показать работодателю первым — не существовало
 * вовсе: кандидаты шли в том порядке, в каком откликнулись.
 *
 * Обе оценки здесь и в одном месте намеренно. Они пользуются одними и теми
 * же понятиями (близость, подтверждённый навык, надёжность), и разъехавшись
 * по экранам разъехались бы и по смыслу — а объяснять людям, почему их
 * ставят выше или ниже, придётся одинаково с обеих сторон.
 *
 * Обе возвращают число, у которого нет единиц измерения: оно годится только
 * на то, чтобы сравнить два варианта между собой. Показывать его человеку
 * нельзя — «ваша вакансия набрала 137» не значит ничего.
 */

// ─── Работнику: какую вакансию показать раньше ────────────────────────────────

const WEIGHT_STATION = 100;   // та же станция
const WEIGHT_LINE = 55;       // та же ветка
const WEIGHT_SKILL = 45;      // навык подтверждён тестом
const WEIGHT_URGENT = 25;     // срочная — их и надо закрывать первыми
const WEIGHT_KNOWN = 30;      // уже работал у этого работодателя, и всё прошло хорошо
const WEIGHT_EMP_TRUST = 40;  // рейтинг работодателя, целиком

export function scoreVacancyForWorker(
  vacancy: Vacancy,
  user: User,
  ctx: { employer?: User | null; myLikes?: Like[] } = {},
): number {
  let s = 20; // всем поровну, чтобы вакансия без совпадений не уходила в ноль

  if (user.metroStation && user.metroStation === vacancy.metroStation) s += WEIGHT_STATION;
  else if (user.metroLineId && user.metroLineId === vacancy.metroLineId) s += WEIGHT_LINE;

  if ((user.confirmedSkills ?? []).includes(vacancy.workType)) s += WEIGHT_SKILL;
  if (vacancy.isUrgent) s += WEIGHT_URGENT;

  // Работодатель, у которого человек уже отработал без происшествий, стоит
  // выше незнакомого: это самая надёжная рекомендация из существующих.
  const работалУНего = (ctx.myLikes ?? []).some(
    l => l.employerId === vacancy.employerId && l.outcome === 'worked',
  );
  if (работалУНего) s += WEIGHT_KNOWN;

  // Рейтинг компании. Не карает новых работодателей: пока рейтинга нет,
  // слагаемое просто не добавляется — а не вычитается.
  const emp = ctx.employer;
  if (emp?.empScore != null) s += WEIGHT_EMP_TRUST * (emp.empScore / 100);

  return s;
}

// ─── Работодателю: кого из откликнувшихся показать раньше ─────────────────────

const CAND_SCORE = 100;       // JobToo Score, целиком
const CAND_STATION = 55;      // живёт на той же станции
const CAND_LINE = 30;         // на той же ветке
const CAND_SKILL = 45;        // подтверждённый навык под эту вакансию
const CAND_REPEAT = 60;       // уже работал у этого работодателя
const CAND_NEW = 25;          // новичок без истории — не в самый низ

type CandidateRank = {
  score: number;
  /** Почему он здесь: короткие причины, которые не стыдно показать. */
  reasons: string[];
};

/**
 * Оценка кандидата под конкретную вакансию.
 *
 * Вместе с числом возвращаются причины. Это не украшение: подбор, который
 * молча переставляет людей местами, работодатель либо не заметит, либо не
 * поверит. «Подтверждён навык, работал у вас дважды, живёт на этой станции» —
 * это то, ради чего он вообще стал бы смотреть на порядок.
 */
export function rankCandidate(
  worker: User,
  vacancy: Vacancy,
  allLikes: Like[],
): CandidateRank {
  const reasons: string[] = [];
  let s = 0;

  if (worker.score != null) {
    s += CAND_SCORE * (worker.score / 100);
    if (worker.score >= 85) reasons.push(`Рейтинг ${worker.score}`);
  } else {
    // Без истории — не в самый низ. Новичок, которого никогда не показывают,
    // истории и не наберёт, и подбор навсегда останется с теми же людьми.
    s += CAND_NEW;
    reasons.push('Новичок');
  }

  if (worker.metroStation && worker.metroStation === vacancy.metroStation) {
    s += CAND_STATION;
    reasons.push('Та же станция');
  } else if (worker.metroLineId && worker.metroLineId === vacancy.metroLineId) {
    s += CAND_LINE;
  }

  if ((worker.confirmedSkills ?? []).includes(vacancy.workType)) {
    s += CAND_SKILL;
    reasons.push('Навык подтверждён');
  }

  const уНего = allLikes.filter(
    l => l.workerId === worker.id && l.employerId === vacancy.employerId && l.outcome === 'worked',
  ).length;
  if (уНего > 0) {
    s += CAND_REPEAT;
    reasons.push(уНего === 1 ? 'Уже работал у вас' : `Работал у вас ${уНего} раза`);
  }

  // Невыходы показываем отдельной причиной, даже если рейтинг их уже учёл:
  // это то, из-за чего решение меняется, а не съезжает на пару позиций.
  if (worker.scoreReliability != null && worker.scoreReliability < 0.8
      && (worker.scoreShifts ?? 0) >= 3) {
    reasons.push('Бывают невыходы');
  }

  return { score: s, reasons };
}
