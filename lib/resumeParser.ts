import type {
  ResumeAward,
  ResumeCertification,
  ResumeCoursework,
  ResumeEducation,
  ResumeExam,
  ResumeExperience,
  ResumeLanguage,
  ResumeProfile,
  ResumeProject,
  WorkType,
} from '@/constants/types';

const MONTHS = 'январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]';
const DATE_START = new RegExp(`^(${MONTHS})\\s+\\d{4}\\s*[—-]`, 'i');

const SECTION_HEADING = /^(?:опыт работы(?:\s*—.*)?|work experience|experience|образование|education|проекты|projects|экзамены|exams?|tests?|навыки|skills|знание языков|языки|languages|интересы|interests|hobbies|лицензии и сертификаты|сертификаты|certifications?|licenses?\s*&\s*certifications?|награды|awards?|курсы|coursework|courses|дополнительная информация|additional information|обо мне|about me|summary|profile|рекомендации|references)$/i;

const SKILL_DICTIONARY = [
  'Деловая переписка', 'Деловое общение', 'Урегулирование конфликтов',
  'Работа с клиентами', 'Работа с жалобами клиентов', 'Сопровождение клиентов',
  'Работа с возражениями', 'Консультирование клиентов', 'Клиентоориентированность',
  'Коммуникабельность', 'Грамотная речь', '1С: Торговля и склад',
  '1С: Предприятие 8', '1С: Торговля', 'MS PowerPoint', 'MS Word',
  'MS Outlook', 'MS Excel', 'Работа с кассой', 'Уверенный пользователь ПК',
  'Работа с оргтехникой', 'Кассовые операции', 'Обучение персонала',
  'Управление командой', 'Управление персоналом', 'Ответственность',
  'Работоспособность', 'Стрессоустойчивость', 'Обучаемость', 'Исполнительность',
  'WMS', 'ТСД', 'Инвентаризация', 'Управление запасами', 'Документооборот',
];

function clean(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:;)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .replace(/\s+([»])/g, '$1')
    .replace(/([«])\s+/g, '$1')
    .trim();
}

function headingText(line: string): string {
  return clean(line)
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s*:\s*$/, '');
}

function isSectionHeading(line: string): boolean {
  return SECTION_HEADING.test(headingText(line));
}

function afterColon(line: string): string | undefined {
  const index = line.indexOf(':');
  return index >= 0 ? clean(line.slice(index + 1)) || undefined : undefined;
}

function firstMatch(lines: string[], pattern: RegExp): string | undefined {
  return lines.find(line => pattern.test(line));
}

function findValue(lines: string[], label: RegExp): string | undefined {
  const line = firstMatch(lines, label);
  return line ? afterColon(line) : undefined;
}

function sectionBlock(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex(line => heading.test(headingText(line)));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && isSectionHeading(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLocaleLowerCase('ru-RU');
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitListValues(lines: string[]): string[] {
  const result: string[] = [];
  for (const raw of lines) {
    const line = clean(raw.replace(/^[•·▪◦*—-]\s*/, ''));
    if (!line || isSectionHeading(line)) continue;
    const pieces = line
      .split(/\s*[•·▪◦;|]\s*/g)
      .map(clean)
      .filter(Boolean);
    result.push(...(pieces.length > 1 ? pieces : [line]));
  }
  return uniq(result);
}

function parseLanguages(text: string, lines: string[]): ResumeLanguage[] {
  const result: ResumeLanguage[] = [];
  const add = (name: string, level: string) => {
    const normalizedName = clean(name);
    const normalizedLevel = clean(level).replace(/^(?:—|-|:|\|)\s*/, '');
    if (!normalizedName || !normalizedLevel) return;
    if (result.some(item => item.name.toLocaleLowerCase('ru-RU') === normalizedName.toLocaleLowerCase('ru-RU'))) return;
    result.push({ name: normalizedName, level: normalizedLevel });
  };

  const known = 'Русский|Английский|Немецкий|Французский|Испанский|Итальянский|Китайский|Турецкий|Арабский|Russian|English|German|French|Spanish|Italian|Chinese|Turkish|Arabic';
  const pattern = new RegExp(`(${known})\\s*[—:|-]\\s*((?:[ABC][12]\\s*[—-]\\s*)?[^\\n•]+)`, 'gi');
  for (const match of text.matchAll(pattern)) {
    add(match[1], clean(match[2]).split(/\s{2,}|(?=Навыки\s)/)[0]);
  }

  const block = sectionBlock(lines, /^(?:знание языков|языки|languages)$/i);
  for (const line of block) {
    const match = clean(line).match(new RegExp(`^(${known})\\s+(.*)$`, 'i'));
    if (match) add(match[1], match[2]);
  }
  return result;
}

function parseExperience(lines: string[]): ResumeExperience[] {
  const start = lines.findIndex(line => /^Опыт работы(?:\s|$|—)|^(?:Work Experience|Experience)$/i.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && isSectionHeading(line));
  const block = lines.slice(start + 1, end < 0 ? lines.length : end);
  const markers = block
    .map((line, index) => DATE_START.test(line) ? index : -1)
    .filter(index => index >= 0);

  if (markers.length === 0) return [];

  return markers.map((marker, markerIndex) => {
    const chunk = block.slice(marker, markers[markerIndex + 1] ?? block.length);
    const startLine = chunk[0];
    const companyIndex = chunk.findIndex((line, index) => index > 0 && /(?:ООО|АО|ПАО|ИП|«|»|LLC|Inc\.?|Ltd\.?|Company)/i.test(line));
    const company = companyIndex >= 0 ? chunk[companyIndex] : '';
    const dateTail = clean(startLine.replace(new RegExp(`^(${MONTHS})\\s+\\d{4}\\s*[—-]?\\s*`, 'i'), ''));
    const endDatePattern = new RegExp(`^(?:настоящее время|present|current|(?:${MONTHS})\\s+\\d{4})$`, 'i');
    const endLine = chunk.slice(1, companyIndex < 0 ? 3 : companyIndex + 3)
      .find(line => endDatePattern.test(line));
    const positionLineIndex = chunk.findIndex((line, index) => index > companyIndex && /^(?:\d+\s+(?:года|год|лет|месяцев|месяца|месяц)\s*)+/i.test(line));
    const positionRaw = positionLineIndex >= 0 ? chunk[positionLineIndex] : chunk[companyIndex + 1] ?? '';
    const duration = positionRaw.match(/^(?:(?:\d+)\s+(?:года|год|лет|месяцев|месяца|месяц)\s*)+/i)?.[0]?.trim();
    const position = clean(positionRaw.replace(/^(?:(?:\d+)\s+(?:года|год|лет|месяцев|месяца|месяц)\s*)+/i, ''));
    const description = clean(chunk.slice((positionLineIndex >= 0 ? positionLineIndex : companyIndex + 1) + 1).join(' '))
      .replace(/\s*Резюме обновлено.*$/i, '')
      .trim();
    const startDate = clean(startLine.replace(/[—-].*$/, ''));
    return {
      company,
      position,
      start: startDate,
      end: clean(endLine ?? dateTail ?? 'настоящее время'),
      ...(duration ? { duration } : {}),
      ...(description ? { description } : {}),
    };
  }).filter(item => item.company || item.position);
}

function parseEducation(lines: string[]): ResumeEducation[] {
  const block = sectionBlock(lines, /^(?:образование|education)$/i);
  if (block.length === 0) return [];

  const levelLine = block.find(line => /^Уровень(?:\s|$)/i.test(line));
  const level = levelLine ? clean(levelLine.replace(/^Уровень\s*/i, '')) : undefined;
  const period = block.find(line => /(?:19|20)\d{2}.*(?:19|20)\d{2}|^(?:19|20)\d{2}$/i.test(line));
  const specialtyLine = block.find(line => /^(?:Специальность|Направление|Факультет|Majors?|Field of study)\s*:/i.test(line));
  const institutionLine = block.find(line =>
    !/^Уровень(?:\s|$)/i.test(line)
    && !/^(?:Специальность|Направление|Факультет|Majors?|Field of study)\s*:/i.test(line)
    && !/(?:19|20)\d{2}/.test(line)
    && /университет|институт|академи|колледж|техникум|училищ|школ|university|college|school|institute/i.test(line),
  );

  if (level || institutionLine || specialtyLine || period) {
    return [{
      ...(level ? { level } : {}),
      ...(institutionLine ? { institution: institutionLine } : {}),
      ...(specialtyLine ? { specialty: afterColon(specialtyLine) ?? specialtyLine } : {}),
      ...(period ? { period } : {}),
    }];
  }

  const values = splitListValues(block);
  return values.slice(0, 3).map(value => ({ institution: value }));
}

function parseSkills(text: string, lines: string[]): string[] {
  const normalized = clean(text).toLocaleLowerCase('ru-RU').replace(/1\s*с\s*:/g, '1с:');
  const dictionary = SKILL_DICTIONARY.filter(skill => normalized.includes(
    skill.toLocaleLowerCase('ru-RU').replace(/1\s*с\s*:/g, '1с:'),
  ));

  const explicit: string[] = [];
  const block = sectionBlock(lines, /^(?:навыки|skills)$/i);
  for (const line of block) {
    const cleaned = clean(line.replace(/^[•·▪◦*—-]\s*/, ''));
    if (!cleaned || /^(?:знание языков|языки|languages)/i.test(cleaned)) continue;
    if (cleaned.length <= 140) {
      explicit.push(...cleaned.split(/\s*[;,•·▪◦|]\s*/).map(clean).filter(value => value.length > 1));
    }
  }

  return uniq([...dictionary, ...explicit]).slice(0, 80);
}

function parseSummary(lines: string[]): string | undefined {
  const block = sectionBlock(lines, /^(?:обо мне|about me|summary|profile)$/i);
  const value = clean(block.join(' '));
  return value || undefined;
}

function parseNamedSection(lines: string[], heading: RegExp): string[] {
  return splitListValues(sectionBlock(lines, heading));
}

function splitDash(value: string): string[] {
  return value.split(/\s+[—–-]\s+/).map(clean).filter(Boolean);
}

function parseProjects(lines: string[]): ResumeProject[] {
  return parseNamedSection(lines, /^(?:проекты|projects)$/i).map(value => {
    const url = value.match(/https?:\/\/\S+/i)?.[0];
    const parts = splitDash(value.replace(url ?? '', '').trim());
    return {
      name: parts[0] || value,
      ...(parts[1] ? { role: parts[1] } : {}),
      ...(parts.length > 2 ? { description: parts.slice(2).join(' — ') } : {}),
      ...(url ? { url } : {}),
    };
  });
}

function parseExams(lines: string[]): ResumeExam[] {
  return parseNamedSection(lines, /^(?:экзамены|exams?|tests?)$/i).map(value => {
    const parts = splitDash(value);
    return {
      name: parts[0] || value,
      ...(parts[1] ? { score: parts[1] } : {}),
      ...(parts[2] ? { date: parts[2] } : {}),
    };
  });
}

function parseCertifications(lines: string[]): ResumeCertification[] {
  return parseNamedSection(lines, /^(?:лицензии и сертификаты|сертификаты|certifications?|licenses?\s*&\s*certifications?)$/i).map(value => {
    const url = value.match(/https?:\/\/\S+/i)?.[0];
    const parts = splitDash(value.replace(url ?? '', '').trim());
    return {
      name: parts[0] || value,
      ...(parts[1] ? { issuer: parts[1] } : {}),
      ...(parts[2] ? { date: parts[2] } : {}),
      ...(url ? { credentialUrl: url } : {}),
    };
  });
}

function parseAwards(lines: string[]): ResumeAward[] {
  return parseNamedSection(lines, /^(?:награды|awards?)$/i).map(value => {
    const parts = splitDash(value);
    return {
      name: parts[0] || value,
      ...(parts[1] ? { issuer: parts[1] } : {}),
      ...(parts[2] ? { date: parts[2] } : {}),
      ...(parts.length > 3 ? { description: parts.slice(3).join(' — ') } : {}),
    };
  });
}

function parseCoursework(lines: string[]): ResumeCoursework[] {
  return parseNamedSection(lines, /^(?:курсы|coursework|courses)$/i).map(value => {
    const parts = splitDash(value);
    return {
      name: parts[0] || value,
      ...(parts[1] ? { institution: parts[1] } : {}),
      ...(parts[2] ? { period: parts[2] } : {}),
      ...(parts.length > 3 ? { description: parts.slice(3).join(' — ') } : {}),
    };
  });
}

export function inferWorkTypes(profile: ResumeProfile): WorkType[] {
  const haystack = clean([
    profile.desiredPosition,
    ...profile.specializations,
    ...profile.experience.flatMap(item => [item.position, item.description]),
    ...profile.skills,
  ].filter(Boolean).join(' ')).toLocaleLowerCase('ru-RU');
  const result: WorkType[] = [];
  if (/кладовщик|товаровед|размещени|приемк|запас|склад/.test(haystack)) result.push('stocker');
  if (/повар|кухн|приготовлен/.test(haystack)) result.push('cook');
  if (/супервайзер|руководител|директор|управлени[ея] (?:команд|персонал)|начальник смен/.test(haystack)) result.push('shift_supervisor');
  if (/комплектовщик|сборщик|сбор заказ|пикер/.test(haystack)) result.push('picker');
  return result;
}

export function parseResumeText(rawText: string, sourceFileName: string, now = new Date()): ResumeProfile {
  const lines = rawText.split(/\r?\n/).map(clean).filter(Boolean);
  const text = lines.join('\n');
  const desiredIndex = lines.findIndex(line => /^Желаемая должность/i.test(line));
  const desiredLine = desiredIndex >= 0 ? lines[desiredIndex + 1] ?? '' : '';
  const salaryMatch = desiredLine.match(/(\d[\d\s]{2,}\s*(?:₽|руб\.?)(?:\s*на руки)?)/i)
    ?? text.match(/(\d[\d\s]{2,}\s*(?:₽|руб\.?)(?:\s*на руки)?)/i);
  const salary = salaryMatch ? clean(salaryMatch[1]) : undefined;
  const desiredPosition = clean(desiredLine.replace(salaryMatch?.[1] ?? '', '')) || undefined;

  const specStart = lines.findIndex(line => /^Специализации\s*:/i.test(line));
  const specializations: string[] = [];
  if (specStart >= 0) {
    for (const line of lines.slice(specStart + 1)) {
      if (/^(Тип занятости|Формат работы|Опыт работы)/i.test(line)) break;
      const value = clean(line.replace(/^[—-]\s*/, ''));
      if (value) specializations.push(value);
    }
  }

  const email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-zА-Яа-я]{2,}/)?.[0];

  return {
    desiredPosition,
    salary,
    summary: parseSummary(lines),
    specializations,
    employmentType: findValue(lines, /^Тип занятости\s*:/i),
    workFormat: findValue(lines, /^Формат работы\s*:/i),
    city: findValue(lines, /^Проживает\s*:/i),
    email,
    citizenship: findValue(lines, /^Гражданство\s*:/i)?.split(',')[0]?.trim(),
    workPermit: findValue(lines, /^Гражданство\s*:/i)?.match(/разрешение на работу\s*:\s*([^,]+)/i)?.[1]?.trim(),
    businessTrips: firstMatch(lines, /командировк/i),
    experience: parseExperience(lines),
    education: parseEducation(lines),
    projects: parseProjects(lines),
    exams: parseExams(lines),
    languages: parseLanguages(text, lines),
    skills: parseSkills(text, lines),
    interests: parseNamedSection(lines, /^(?:интересы|interests|hobbies)$/i),
    certifications: parseCertifications(lines),
    awards: parseAwards(lines),
    coursework: parseCoursework(lines),
    sourceFileName,
    importedAt: now.toISOString(),
  };
}

export function parseResumeIdentity(rawText: string): { firstName?: string; lastName?: string; age?: number } {
  const lines = rawText.split(/\r?\n/).map(clean).filter(Boolean);
  const name = lines.find(line =>
    /^[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?$/.test(line)
    || /^[A-Z][A-Za-z'-]+\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?$/.test(line),
  )?.split(' ');
  const age = Number(firstMatch(lines, /\d{1,2}\s+(?:год|года|лет)(?:\s|,|$)/i)?.match(/\d{1,2}/)?.[0] ?? '') || undefined;
  return { lastName: name?.[0], firstName: name?.[1], age };
}
