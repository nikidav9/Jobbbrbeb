import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { registerProfileGateOpener } from '@/services/resumeGate';
import { decideProfileGateStep } from '@/services/profileGateDecision';
import { ProfileGateSheet } from '@/components/feature/ProfileGateSheet';

type SheetStep = 'choose' | 'names';
type Request = { step: SheetStep; resolve: (accepted: boolean) => void };

/**
 * Монтируется один раз в `app/_layout.tsx` внутри `AppProvider` и
 * регистрирует в `services/resumeGate.ts` функцию открытия окна «Чтобы
 * откликнуться, создайте профиль за минуту» (решение владельца 27.09.2026).
 *
 * Сам `resumeGate.ts` — обычный модуль без доступа к контексту, поэтому
 * решение «что показать» просит принять здесь: только тут известен текущий
 * пользователь. Без хоста (тесты, редкий случай) `ensureResumeForApply`
 * падает на запасной confirm/Alert.
 */
export function ProfileGateHost() {
  const { currentUser, updateUser } = useApp();
  const [request, setRequest] = useState<Request | null>(null);

  // Открыватель регистрируется один раз и живёт дольше любого конкретного
  // рендера — читает пользователя из рефа, чтобы не помнить его старым.
  const userRef = useRef(currentUser);
  userRef.current = currentUser;

  const open = useCallback((hasResume: boolean): Promise<boolean> => {
    const user = userRef.current;
    if (!user) return Promise.resolve(hasResume);
    const step = decideProfileGateStep(hasResume, user.firstName, user.lastName);
    if (step === 'skip') return Promise.resolve(true);
    return new Promise<boolean>(resolve => setRequest({ step, resolve }));
  }, []);

  useEffect(() => {
    registerProfileGateOpener(open);
    return () => registerProfileGateOpener(null);
  }, [open]);

  if (!currentUser) return null;

  return (
    <ProfileGateSheet
      visible={!!request}
      step={request?.step ?? 'choose'}
      user={currentUser}
      onUpdateUser={updateUser}
      onResolve={accepted => {
        request?.resolve(accepted);
        setRequest(null);
      }}
    />
  );
}
