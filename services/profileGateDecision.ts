/**
 * Что показать при первом отклике без готового профиля (решение владельца
 * 27.09.2026, как у getmatch): у нового соискателя после «почта → код →
 * лента» нет ни резюме, ни имени.
 *
 * Чистая функция, без React Native и сети — держит `ProfileGateHost`
 * (`components/feature/ProfileGateHost.tsx`) и проверяется node-тестом
 * (`tests/profileGateDecision.test.ts`), в который RN-модули не тянутся.
 */
export type ProfileGateStep = 'choose' | 'names' | 'skip';

export function decideProfileGateStep(
  hasResume: boolean,
  firstName?: string | null,
  lastName?: string | null,
): ProfileGateStep {
  if (!hasResume) return 'choose';
  if (!firstName?.trim() || !lastName?.trim()) return 'names';
  return 'skip';
}
