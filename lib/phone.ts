/** Телефон: цифры, отображение, национальная часть. Одна копия вместо четырёх. */

/** Все цифры номера как есть («+7 999 003-10-23» → «79990031023»). */
export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Номер в человеческом виде: +7 916 587-08-77. Не 11 цифр — вернуть как был. */
export function formatPhoneRu(raw: string): string {
  const d = phoneDigits(raw);
  if (d.length !== 11) return raw;
  return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}

/** Цифры без кода страны: 11 цифр с 7/8 в начале — отрезать первую, иначе первые 10. */
export function nationalDigits(phone: string | null | undefined): string {
  const d = phoneDigits(phone);
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return d.slice(1);
  return d.slice(0, 10);
}

/** «9990000000» → «999 000-00-00» — маска шторки «Телефон». */
export function formatNationalDigits(d: string): string {
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 8);
  const e = d.slice(8, 10);
  let out = a;
  if (b) out += ` ${b}`;
  if (c) out += `-${c}`;
  if (e) out += `-${e}`;
  return out;
}
