import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { dbUploadFile } from '@/services/db';

/**
 * Обрезка, сжатие и загрузка фото профиля.
 *
 * Раньше это жило внутри экрана профиля, а фото понадобилось ещё и при
 * регистрации. Копировать было нельзя: тут два неочевидных места, на которых
 * уже спотыкались, — чтение файла в браузере и обязательная проверка ошибки
 * загрузки.
 */

/** base64 → байты. Своя реализация: atob есть не везде, где мы работаем. */
function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bufLen = Math.floor((clean.length * 3) / 4);
  const buf = new Uint8Array(bufLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0;
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
    buf[p++] = (a << 2) | (b >> 4);
    if (p < bufLen) buf[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < bufLen) buf[p++] = ((c & 3) << 6) | d;
  }
  return buf;
}

/**
 * Готовит и заливает фото, возвращает публичную ссылку.
 *
 * Бросает исключение, если загрузка не удалась: молча вернуть ссылку нельзя —
 * в профиль записался бы адрес файла, которого нет. Ровно так месяцами
 * прятались неудачные загрузки голосовых.
 */
export async function uploadAvatar(sourceUri: string, userId: string): Promise<string> {
  // Квадрат по центру, 600×600 — больше для аватарки не нужно, а трафик экономит.
  const info = await ImageManipulator.manipulateAsync(sourceUri, [], {
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const size = Math.min(info.width, info.height);
  const processed = await ImageManipulator.manipulateAsync(
    sourceUri,
    [
      {
        crop: {
          originX: Math.floor((info.width - size) / 2),
          originY: Math.floor((info.height - size) / 2),
          width: size,
          height: size,
        },
      },
      { resize: { width: 600, height: 600 } },
    ],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );

  // На телефоне uri — путь, и читает его expo-file-system. В браузере тот же
  // модуль пустая заглушка, а ссылка выглядит как blob:, поэтому содержимое
  // берём запросом. Раньше звали expo-file-system всегда, и на вебе смена фото
  // падала.
  let bytes: Uint8Array;
  if (Platform.OS === 'web') {
    const resp = await fetch(processed.uri);
    bytes = new Uint8Array(await (await resp.blob()).arrayBuffer());
  } else {
    const base64 = await FileSystem.readAsStringAsync(processed.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    bytes = base64ToUint8Array(base64);
  }

  const fileName = `avatar_${userId}.jpg`;
  // Через прокси, а не ключом из сборки: см. dbUploadFile в services/db.ts.
  const publicUrl = await dbUploadFile(fileName, bytes, 'image/jpeg');
  // Метка времени — иначе после смены фото и телефон, и браузер показывают
  // старую картинку из кэша.
  return `${publicUrl}?t=${Date.now()}`;
}
