// Уровень и формат работы вакансии — для фильтров ленты (как у Cofinder).
//
// Отдельного поля у вакансий нет: источники присылают уровень прямо в
// названии («Senior Go-разработчик», «Стажёр-аналитик»), а формат — в графике
// («Гибридный», «Удалённо») или в тексте. Поэтому вычисляем здесь, одной
// чистой функцией: сервер для этого не нужен, и правило одно и для своих
// вакансий, и для карьерных. Не нашли признака — null: такая вакансия не
// проходит фильтр по уровню или формату, но и не выдаётся за чужой уровень.

export type VacancyLevel = 'intern' | 'junior' | 'middle' | 'senior' | 'lead' | 'head';
export type VacancyFormat = 'remote' | 'hybrid' | 'office';

export const VACANCY_LEVELS: { id: VacancyLevel; label: string }[] = [
  { id: 'intern', label: 'Стажёр' },
  { id: 'junior', label: 'Junior' },
  { id: 'middle', label: 'Middle' },
  { id: 'senior', label: 'Senior' },
  { id: 'lead', label: 'Lead' },
  { id: 'head', label: 'Head' },
];

export const VACANCY_FORMATS: { id: VacancyFormat; label: string }[] = [
  { id: 'remote', label: 'Удалённо' },
  { id: 'hybrid', label: 'Гибрид' },
  { id: 'office', label: 'Офис' },
];

// Порядок важен: «Head of Engineering» и «Team Lead» раньше «Senior», а
// «Senior Team Lead» — это лид. Кириллица без \b: в JS граница слова знает
// только латиницу, поэтому для русских слов — явные границы.
const LEVEL_RULES: [VacancyLevel, RegExp][] = [
  ['head', /\bhead\b|\bcto\b|\bcpo\b|\bvp\b|директор|(^|[^а-яё])(руководитель|начальник)([^а-яё]|$)/iu],
  ['lead', /\b(team\s*|tech\s*)?lead\b|\blead\b|тимлид|техлид|(^|[^а-яё])ведущ(ий|ая|его)([^а-яё]|$)/iu],
  ['intern', /\bintern(ship)?\b|\btrainee\b|стаж[её]р|стажировк|практикант/iu],
  ['junior', /\bjunior\b|\bjun\b|(^|[^а-яё])младш(ий|ая|его)([^а-яё]|$)|без опыта/iu],
  ['senior', /\bsenior\b|\bsr\.?\b|(^|[^а-яё])старш(ий|ая|его)([^а-яё]|$)/iu],
  ['middle', /\bmiddle\b|\bmid\b/iu],
];

/** Уровень по названию вакансии; null — в названии уровня нет. */
export function vacancyLevel(title: string | null | undefined): VacancyLevel | null {
  const t = (title ?? '').trim();
  if (!t) return null;
  for (const [level, re] of LEVEL_RULES) if (re.test(t)) return level;
  return null;
}

const REMOTE_RE = /удал[её]нн|удал[её]нк|\bremote\b|из дома|home office/iu;
const HYBRID_RE = /гибрид|\bhybrid\b|\bmixed\b/iu;
const OFFICE_RE = /(^|[^а-яё])(офис|в офисе|офисн)|\boffice\b/iu;

/**
 * Формат по графику, а если там пусто — по тексту вакансии. Гибрид раньше
 * «удалёнки» и «офиса»: «гибрид: 3 дня в офисе» — это гибрид, а не офис.
 */
export function vacancyFormat(schedule: string | null | undefined, text?: string | null): VacancyFormat | null {
  for (const s of [schedule ?? '', text ?? '']) {
    if (!s.trim()) continue;
    if (HYBRID_RE.test(s)) return 'hybrid';
    if (REMOTE_RE.test(s)) return 'remote';
    if (OFFICE_RE.test(s)) return 'office';
  }
  return null;
}

// Специализация — фильтр «Специализация» в шторке ленты, по названию
// вакансии. Зеркало на сервере — php-proxy/vacancy_facets.php (vf_specs),
// паритет держит общий tests/fixtures/vacancy_facets_cases.json.
export type VacancySpec =
  | 'backend' | 'frontend' | 'mobile' | 'qa' | 'devops' | 'data'
  | 'analytics' | 'design' | 'management' | 'security' | 'support' | 'onec';

export const VACANCY_SPECS: { id: VacancySpec; label: string; icon: string }[] = [
  { id: 'backend', label: 'Бэкенд', icon: 'server-outline' },
  { id: 'frontend', label: 'Фронтенд', icon: 'browsers-outline' },
  { id: 'mobile', label: 'Мобильная разработка', icon: 'phone-portrait-outline' },
  { id: 'qa', label: 'Тестирование', icon: 'bug-outline' },
  { id: 'devops', label: 'DevOps и SRE', icon: 'git-network-outline' },
  { id: 'data', label: 'Data Science и ML', icon: 'analytics-outline' },
  { id: 'analytics', label: 'Аналитика', icon: 'bar-chart-outline' },
  { id: 'design', label: 'Дизайн', icon: 'color-palette-outline' },
  { id: 'management', label: 'Менеджмент', icon: 'people-outline' },
  { id: 'security', label: 'Безопасность', icon: 'shield-checkmark-outline' },
  { id: 'support', label: 'Поддержка', icon: 'headset-outline' },
  { id: 'onec', label: '1С', icon: 'calculator-outline' },
];

// Порядок важен: первое совпавшее правило побеждает, поэтому узкое и редкое
// стоит выше широкого — «Java QA Automation» это тестирование, а не бэкенд;
// «Android-разработчик (Kotlin)» — мобильная, а не бэкенд; «Аналитик данных» —
// аналитика, а не data; «Data Engineer (Python)» — data, а не бэкенд.
// Кириллица — без \b (в JS граница слова знает только латиницу), латиница —
// с \b, чтобы не поймать «go» внутри «google» или «java» внутри «javascript».
// «Разработчик»/«программист»/developer сами по себе ничего не значат — иначе
// любая вакансия разработчика молча становилась бы бэкендом.
const SPEC_RULES: [VacancySpec[], RegExp][] = [
  [['onec'], /(^|[^a-zа-яё0-9])1[сc]([^a-zа-яё0-9]|$)/iu],
  [['security'], /\bsecurity\b|безопасност|\bpentest\b|\bappsec\b|\bdevsecops\b|soc[\s-]*аналитик/iu],
  [['frontend', 'backend'], /\bfull[\s-]?stack\b|фулстек|фулстак/iu],
  [['devops'], /\bdevops\b|\bsre\b|site\s+reliability|platform\s+engineer|инфраструктур|системн\S* администратор|\bsysadmin\b|kubernetes/iu],
  [['qa'], /\bqa\b|\baqa\b|\bsdet\b|тестировщик|тестирован|test\s+engineer/iu],
  [['mobile'], /\bios\b|\bandroid\b|\bmobile\b|мобильн|\bflutter\b|react[\s-]?native/iu],
  [['data'], /data\s*scien|machine\s+learning|\bml\b|машинн|data\s+engineer|инженер данных|\bdwh\b|big\s+data|\bnlp\b|computer\s+vision|\bllm\b/iu],
  [['analytics'], /аналитик|analyst|\bbi\b/iu],
  [['design'], /дизайн|designer|\bux\b|ui\/ux/iu],
  [['frontend'], /frontend|front-end|фронтенд|\breact\b|\bvue\b|\bangular\b|верстальщик/iu],
  [['management'], /product\s+manager|продакт|project\s+manager|проджект|руководител\S* проект|delivery\s+manager|\bscrum\b|\bcto\b|head\s+of/iu],
  [['support'], /поддержк|\bsupport\b|helpdesk|service\s+desk/iu],
  [['backend'], /backend|back-end|бэкенд|бекенд|\bjava\b|golang|\bgo\b|\bpython\b|\bphp\b|c#|\.net|c\+\+|\bnode\b|\bruby\b|\bscala\b|\brust\b|\bkotlin\b/iu],
];

/** Специализации по названию вакансии; неизвестное название — пустой список. */
export function vacancySpecs(title: string | null | undefined): VacancySpec[] {
  const t = (title ?? '').trim();
  if (!t) return [];
  for (const [specs, re] of SPEC_RULES) if (re.test(t)) return specs;
  return [];
}
