// Капча карьерного сайта: Юпитер остановился на картинке, человек вводит слово.
//
// Тонкая обёртка над jupiterCaptchaGet / jupiterCaptchaAnswer из services/db.ts:
// переводит ответ сервера (snake_case) в вид, удобный экрану.
import {
  jupiterCaptchaAnswer as dbJupiterCaptchaAnswer,
  jupiterCaptchaGet as dbJupiterCaptchaGet,
} from '@/services/db';

export type JupiterCaptcha = {
  id: string;
  /** text — ввести слово; tap — нажать на снимок (галочка, сетка картинок). */
  kind: 'text' | 'tap';
  /** PNG в base64, без префикса data:. */
  imagePng: string;
  company: string | null;
  expiresAt: string;
};

/** Ждущая капча заявки или null, если её нет или она просрочена. */
export async function jupiterCaptchaGet(userId: string, applicationId: string): Promise<JupiterCaptcha | null> {
  const r = await dbJupiterCaptchaGet(userId, applicationId);
  if (!r) return null;
  return {
    id: r.id, kind: r.kind === 'tap' ? 'tap' : 'text',
    imagePng: r.image_png, company: null, expiresAt: r.expires_at,
  };
}

/** Ответ человека на капчу заявки. Сервер ищет ждущую капчу по заявке сам. */
export async function jupiterCaptchaAnswer(userId: string, applicationId: string, answer: string): Promise<void> {
  await dbJupiterCaptchaAnswer(userId, applicationId, answer);
}
