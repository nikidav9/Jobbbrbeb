// Требования к паролю — одни и те же для работника и работодателя.
//
// Правила нарочно простые (восстановление есть — кодом из письма, но каждый
// лишний сброс — это человек, который мог и не вернуться). Спецсимвол не требуем: люди вводят с телефона, где он
// спрятан на третьей клавиатуре, и чем сложнее правило, тем больше народу
// не дойдёт до конца регистрации или потом потеряет доступ.
//
// Буквы перечислены явно, латиница и кириллица: так надёжнее, чем полагаться
// на поддержку юникодных классов в движке.

export type PasswordRule = {
  id: string;
  label: string;
  ok: (password: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'Не меньше 8 символов', ok: p => p.length >= 8 },
  { id: 'letter', label: 'Есть буква', ok: p => /[a-zA-Zа-яА-ЯёЁ]/.test(p) },
  { id: 'digit', label: 'Есть цифра', ok: p => /\d/.test(p) },
];

export const isPasswordStrong = (password: string): boolean =>
  PASSWORD_RULES.every(r => r.ok(password));

/** Первое невыполненное требование — для текста ошибки под полем. */
export const firstUnmetRule = (password: string): PasswordRule | null =>
  PASSWORD_RULES.find(r => !r.ok(password)) ?? null;
