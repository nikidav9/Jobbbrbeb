import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Modal, Animated, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { pickAndImportResume } from '@/services/resumeImport';
import { User } from '@/constants/types';

import { JT_FONT } from '@/constants/jt';
type Step = 'choose' | 'names';

type Props = {
  visible: boolean;
  /** Что открыть: выбор способа завести профиль или сразу поля имени. */
  step: Step;
  user: User;
  onUpdateUser: (u: User) => Promise<void>;
  /** true — отклик можно продолжать, false — человек ушёл заполнять сам или отложил. */
  onResolve: (accepted: boolean) => void;
};

/**
 * «Чтобы откликнуться, создайте профиль за минуту» (решение владельца
 * 27.09.2026, как у getmatch): у нового соискателя после «почта → код →
 * лента» нет ни имени, ни резюме, и первый отклик — самое подходящее место
 * это спросить. Открывает и закрывает `ProfileGateHost`
 * (`app/_layout.tsx`), сама логика решения — `services/profileGateDecision.ts`.
 *
 * Шаг «выбор» может сам перейти в «имя»: файл загрузился, но в нём не нашлись
 * имя/фамилия — заставлять нажимать что-то второй раз незачем.
 */
export function ProfileGateSheet({ visible, step, user, onUpdateUser, onResolve }: Props) {
  const insets = useSafeAreaInsets();
  const swipe = useSwipeToDismiss(() => onResolve(false), visible);

  const [localStep, setLocalStep] = useState<Step>(step);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Сброс — только при открытии, а не на каждое изменение user/step: пока
  // окно открыто, пользователь уже мог перейти в «имя» после импорта, и
  // обновление currentUser из контекста не должно откатить эту работу назад.
  useEffect(() => {
    if (visible) {
      setLocalStep(step);
      setError('');
      setImporting(false);
      setSubmitting(false);
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
    }
  }, [visible]);

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    setError('');
    try {
      const picked = await pickAndImportResume(user);
      if (!picked) return; // выбор файла отменён — окно остаётся открытым

      await onUpdateUser(picked.updatedUser);

      if (picked.updatedUser.firstName?.trim() && picked.updatedUser.lastName?.trim()) {
        onResolve(true);
      } else {
        setFirstName(picked.updatedUser.firstName ?? '');
        setLastName(picked.updatedUser.lastName ?? '');
        setLocalStep('names');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обработать резюме');
    } finally {
      setImporting(false);
    }
  };

  const canSubmitNames = firstName.trim().length > 0 && lastName.trim().length > 0;

  const handleSubmitNames = async () => {
    if (!canSubmitNames || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onUpdateUser({ ...user, firstName: firstName.trim(), lastName: lastName.trim() });
      onResolve(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить имя');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent
      navigationBarTranslucent onRequestClose={() => onResolve(false)}>
      <View style={s.overlay} testID="profile-gate">
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => onResolve(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + rs(12) }, swipe.animStyle]}>
            <View {...swipe.panHandlers}>
              <SheetHandle />
              {localStep === 'choose' ? (
                <>
                  <Text style={s.title}>Чтобы откликнуться, создайте профиль за минуту</Text>
                  <Text style={s.subtitle}>Загрузите резюме в PDF — имя и опыт возьмём из него</Text>
                </>
              ) : (
                <>
                  <Text style={s.title}>Как вас зовут?</Text>
                  <Text style={s.subtitle}>Имя понадобится работодателю в переписке</Text>
                </>
              )}
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            {localStep === 'choose' ? (
              <>
                <TouchableOpacity
                  style={s.row}
                  onPress={handleImport}
                  disabled={importing}
                  activeOpacity={0.8}
                  testID="profile-gate-pdf"
                >
                  <View style={s.rowIcon}>
                    {importing
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <Ionicons name="document-text-outline" size={rf(20)} color="#FFFFFF" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>Загрузить резюме PDF</Text>
                    <Text style={s.rowSub}>{importing ? 'Распознаём резюме…' : 'Файл до 10 МБ'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={rf(18)} color={Colors.textMuted} />
                </TouchableOpacity>

              </>
            ) : (
              <View style={s.names}>
                <AppInput
                  label="Имя"
                  value={firstName}
                  onChangeText={v => { setFirstName(v); setError(''); }}
                  placeholder="Имя"
                  autoCapitalize="words"
                  testID="profile-gate-first-name"
                />
                <AppInput
                  label="Фамилия"
                  value={lastName}
                  onChangeText={v => { setLastName(v); setError(''); }}
                  placeholder="Фамилия"
                  autoCapitalize="words"
                  testID="profile-gate-last-name"
                />
                <View style={s.submitWrap} testID="profile-gate-submit">
                  <PrimaryButton
                    label="Откликнуться"
                    onPress={handleSubmitNames}
                    disabled={!canSubmitNames}
                    loading={submitting}
                  />
                </View>
              </View>
            )}

            <TouchableOpacity onPress={() => onResolve(false)} activeOpacity={0.7} testID="profile-gate-later">
              <Text style={s.later}>Позже</Text>
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: rs(20), borderTopRightRadius: rs(20),
    paddingHorizontal: rs(20),
  },
  title: { fontSize: rf(18), fontFamily: JT_FONT.bold, color: Colors.textPrimary, paddingTop: rs(4) },
  subtitle: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: Colors.textSecondary, marginTop: rs(6), marginBottom: rs(4) },

  error: {
    fontFamily: JT_FONT.medium, fontSize: rf(12.5), color: Colors.red, marginTop: rs(8),
    backgroundColor: '#FEF2F2', borderRadius: rs(10), padding: rs(10),
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    backgroundColor: Colors.surface, borderRadius: rs(14),
    borderWidth: 1, borderColor: Colors.divider,
    paddingHorizontal: rs(14), paddingVertical: rs(12),
    marginTop: rs(12),
  },
  rowIcon: {
    width: rs(40), height: rs(40), borderRadius: rs(20),
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: rf(15), fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  rowSub: { fontFamily: JT_FONT.medium, fontSize: rf(12.5), color: Colors.textSecondary, marginTop: rs(2) },

  names: { marginTop: rs(14), gap: rs(12) },
  submitWrap: { marginTop: rs(4), ...Shadow.card },

  later: {
    textAlign: 'center', fontSize: rf(13.5), fontFamily: JT_FONT.semi, color: Colors.textMuted,
    marginTop: rs(16), marginBottom: rs(4),
  },
});
