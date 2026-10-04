const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 → байты. Своя реализация: atob есть не везде, где мы работаем. */
export function base64ToBytes(base64: string): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < CHARS.length; i++) lookup[CHARS.charCodeAt(i)] = i;
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const size = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(size);
  let position = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0;
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
    bytes[position++] = (a << 2) | (b >> 4);
    if (position < size) bytes[position++] = ((b & 15) << 4) | (c >> 2);
    if (position < size) bytes[position++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

/** байты → base64. Своя реализация: `btoa` не годится для бинарных данных повсюду. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += CHARS[a >> 2];
    out += CHARS[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    out += b === undefined ? '=' : CHARS[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    out += c === undefined ? '=' : CHARS[c & 63];
  }
  return out;
}
