/**
 * Капча нажатиями (03.10.2026): снимок рамки «я не робот» / сетки картинок
 * человек нажимает прямо в приложении, а Юпитер повторяет нажатия в своём
 * браузере. Здесь — чистые помощники экрана /jupiter-captcha; без импортов,
 * чтобы их проверял node:test.
 *
 * Точки — доли снимка 0..1, строкой «x,y;x,y». Формат и предел (12 точек)
 * совпадают с проверкой сервера (php-proxy/db.php, jupiterCaptchaAnswer) и
 * разбором воркера (jupiter/browser_captcha.py, parse_taps).
 */
export const MAX_TAPS = 12;

export type Tap = { x: number; y: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Нажатие в долях снимка; размер снимка нулевой — нажатия нет. */
export function tapFromPress(x: number, y: number, width: number, height: number): Tap | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp01(x / width), y: clamp01(y / height) };
}

/** Добавить нажатие; сверх предела — как есть, без добавления. */
export function addTap(taps: Tap[], tap: Tap): Tap[] {
  return taps.length >= MAX_TAPS ? taps : [...taps, tap];
}

/** Ответ для сервера: до четырёх знаков после точки, как требует проверка. */
export function tapsToAnswer(taps: Tap[]): string {
  return taps.slice(0, MAX_TAPS)
    .map(t => `${clamp01(t.x).toFixed(4)},${clamp01(t.y).toFixed(4)}`)
    .join(';');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Размер PNG по его заголовку (base64 без data:): ширина и высота лежат в
 * байтах 16–23. Нужен, чтобы показать снимок в натуральных пропорциях, не
 * дожидаясь загрузки картинки.
 */
export function pngSize(base64: string): { width: number; height: number } | null {
  const head = (base64 || '').slice(0, 32);
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of head) {
    const v = B64.indexOf(ch);
    if (v < 0) break;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
      acc &= (1 << bits) - 1;
    }
  }
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (sig.some((b, i) => bytes[i] !== b)) return null;
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Размер снимка на экране: по ширине карточки, но не выше maxHeight. */
export function fitImage(
  size: { width: number; height: number } | null, maxWidth: number, maxHeight: number,
): { width: number; height: number } {
  if (!size || !(maxWidth > 0)) return { width: Math.max(0, maxWidth), height: Math.min(180, maxHeight) };
  const k = Math.min(maxWidth / size.width, maxHeight / size.height);
  return { width: Math.round(size.width * k), height: Math.round(size.height * k) };
}
