import type { ResumeExperience, ResumeLanguage, ResumeProfile, WorkType } from '@/constants/types';

const MONTHS = 'январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]';
const DATE_START = new RegExp(`^(${MONTHS})\\s+\\d{4}\\s*[—-]`, 'i');
const SECTION = /^(образование|навыки|дополнительная информация|обо мне|рекомендации)$/i;

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

function parseLanguages(text: string): ResumeLanguage[] {
  const result: ResumeLanguage[] = [];
  const pattern = /(Русский|Английский|Немецкий|Французский|Испанский|Итальянский|Китайский|Турецкий|Арабский)\s*[—-]\s*((?:[ABC][12]\s*[—-]\s*)?[^\n•]+)/gi;
  for (const match of text.matchAll(pattern)) {
    const level = clean(match[2]).split(/\s{2,}|(?=Навыки\s)/)[0];
    result.push({ name: clean(match[1]), level });
  }
  return result;
}

function parseExperience(lines: string[]): ResumeExperience[] {
  const start = lines.findIndex(line => /^Опыт работы(?:\s|$|—)/i.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && SECTION.test(line));
  const block = lines.slice(start + 1, end < 0 ? lines.length : end);
  const markers = block
    .map((line, index) => DATE_START.test(line) ? index : -1)
    .filter(index => index >= 0);

  return markers.map((marker, markerIndex) => {
    const chunk = block.slice(marker, markers[markerIndex + 1] ?? block.length);
    const startLine = chunk[0];
    const companyIndex = chunk.findIndex((line, index) => index > 0 && /(?:ООО|АО|ПАО|ИП|«|»)/i.test(line));
    const company = companyIndex >= 0 ? chunk[companyIndex] : '';
    const dateTail = clean(startLine.replace(new RegExp(`^(${MONTHS})\\s+\\d{4}\\s*[—-]?\\s*`, 'i'), ''));
    const endDatePattern = new RegExp(`^(?:настоящее время|(?:${MONTHS})\\s+\\d{4})$`, 'i');
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

function parseSkills(text: string): string[] {
  const normalized = clean(text).toLocaleLowerCase('ru-RU').replace(/1\s*с\s*:/g, '1с:');
  return SKILL_DICTIONARY.filter(skill => normalized.includes(
    skill.toLocaleLowerCase('ru-RU').replace(/1\s*с\s*:/g, '1с:'),
  ));
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

  const educationIndex = lines.findIndex(line => /^Образование$/i.test(line));
  const educationEnd = lines.findIndex((line, index) => index > educationIndex && /^Навыки$/i.test(line));
  const educationLines = educationIndex >= 0
    ? lines.slice(educationIndex + 1, educationEnd < 0 ? lines.length : educationEnd)
    : [];
  const levelLine = educationLines.find(line => /^Уровень(?:\s|$)/i.test(line));
  const education = levelLine
    ? [{ level: clean(levelLine.replace(/^Уровень\s*/i, '')) }]
    : [];

  const email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-zА-Яа-я]{2,}/)?.[0];

  return {
    desiredPosition,
    salary,
    specializations,
    employmentType: findValue(lines, /^Тип занятости\s*:/i),
    workFormat: findValue(lines, /^Формат работы\s*:/i),
    city: findValue(lines, /^Проживает\s*:/i),
    email,
    citizenship: findValue(lines, /^Гражданство\s*:/i)?.split(',')[0]?.trim(),
    workPermit: findValue(lines, /^Гражданство\s*:/i)?.match(/разрешение на работу\s*:\s*([^,]+)/i)?.[1]?.trim(),
    businessTrips: firstMatch(lines, /командировк/i),
    experience: parseExperience(lines),
    education,
    skills: parseSkills(text),
    languages: parseLanguages(text),
    sourceFileName,
    importedAt: now.toISOString(),
  };
}

export function parseResumeIdentity(rawText: string): { firstName?: string; lastName?: string; age?: number } {
  const lines = rawText.split(/\r?\n/).map(clean).filter(Boolean);
  const name = lines.find(line => /^[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?$/.test(line))?.split(' ');
  const age = Number(firstMatch(lines, /\d{1,2}\s+(?:год|года|лет)(?:\s|,|$)/i)?.match(/\d{1,2}/)?.[0] ?? '') || undefined;
  return { lastName: name?.[0], firstName: name?.[1], age };
}
