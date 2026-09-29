// Капча карьерного сайта: Юпитер остановился на картинке, человек вводит слово.
//
// Серверные функции jupiterCaptchaGet / jupiterCaptchaAnswer живут в
// services/db.ts (proxy там не экспортируется, свой fetch с токеном не
// дублируем). Импорт через пространство имён и приведение типа — чтобы
// экран собирался и до появления этих функций; когда они появятся, обёртки
// ниже начнут работать без правок.
import * as db from '@/services/db';

export type JupiterCaptcha = {
  id: string;
  /** PNG в base64, без префикса data:. */
  imagePng: string;
  company: string | null;
  expiresAt: string;
};

type CaptchaApi = {
  jupiterCaptchaGet?: (userId: string, applicationId: string) => Promise<JupiterCaptcha | null>;
  jupiterCaptchaAnswer?: (userId: string, captchaId: string, answer: string) => Promise<{ ok: boolean }>;
};

const api = db as unknown as CaptchaApi;

export async function jupiterCaptchaGet(userId: string, applicationId: string): Promise<JupiterCaptcha | null> {
  if (!api.jupiterCaptchaGet) throw new Error('Проверка сайта пока недоступна');
  return api.jupiterCaptchaGet(userId, applicationId);
}

export async function jupiterCaptchaAnswer(userId: string, captchaId: string, answer: string): Promise<{ ok: boolean }> {
  if (!api.jupiterCaptchaAnswer) throw new Error('Проверка сайта пока недоступна');
  return api.jupiterCaptchaAnswer(userId, captchaId, answer);
}
