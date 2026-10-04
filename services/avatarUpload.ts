import * as ImageManipulator from 'expo-image-manipulator';
import { readFileBytes } from '@/lib/fileBytes';
import { dbUploadFile } from '@/services/db';

/**
 * Обрезка, сжатие и загрузка фото профиля.
 *
 * Раньше это жило внутри экрана профиля, а фото понадобилось ещё и при
 * регистрации. Копировать было нельзя: тут два неочевидных места, на которых
 * уже спотыкались, — чтение файла в браузере и обязательная проверка ошибки
 * загрузки.
 */

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
  const bytes = await readFileBytes(processed.uri);

  const fileName = `avatar_${userId}.jpg`;
  // Через прокси, а не ключом из сборки: см. dbUploadFile в services/db.ts.
  const publicUrl = await dbUploadFile(fileName, bytes, 'image/jpeg');
  // Метка времени — иначе после смены фото и телефон, и браузер показывают
  // старую картинку из кэша.
  return `${publicUrl}?t=${Date.now()}`;
}
