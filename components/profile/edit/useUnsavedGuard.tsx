import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * Перехват выхода с несохранёнными изменениями — «Общие правила экранов»
 * в `docs/design/profile-edit/README.md`: «Сохранить изменения?» (Сохранить /
 * Не сохранять). Ловит и кнопку «назад» в шапке (через `requestClose`), и
 * системный жест/кнопку «назад» (`beforeRemove` навигации, Android `BackHandler`).
 */
export function useUnsavedGuard({
  dirty, onSave,
}: {
  dirty: boolean;
  onSave: () => Promise<boolean | void> | void;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const [visible, setVisible] = useState(false);
  // После «Не сохранять»/«Сохранить» уходим сами — beforeRemove не должен
  // перехватить это повторно и зациклить диалог.
  const leavingRef = useRef(false);

  const leave = () => {
    leavingRef.current = true;
    setVisible(false);
    router.back();
  };

  const requestClose = () => {
    if (!dirty) {
      leave();
      return;
    }
    setVisible(true);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!dirty || leavingRef.current) return;
      e.preventDefault();
      setVisible(true);
    });
    return unsubscribe;
  }, [navigation, dirty]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty || leavingRef.current) return false;
      setVisible(true);
      return true;
    });
    return () => sub.remove();
  }, [dirty]);

  const handleSave = async () => {
    setVisible(false);
    // false — сохранение не удалось (экран сам показал ошибку): остаёмся.
    if ((await onSave()) === false) return;
    leave();
  };

  const dialog = (
    <ConfirmDialog
      visible={visible}
      title="Сохранить изменения?"
      confirmLabel="Сохранить"
      cancelLabel="Не сохранять"
      onConfirm={handleSave}
      onCancel={leave}
      onDismiss={() => setVisible(false)}
    />
  );

  // leave — уход без вопроса: экран зовёт его после успешного «Сохранить»
  // внизу, пока dirty ещё true (иначе beforeRemove снова спросил бы).
  return { requestClose, dialog, leave };
}
