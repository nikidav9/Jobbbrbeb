import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { JT, JT_FONT } from '@/constants/jt';
import { JTInput, JT_ERROR } from '@/components/ui/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { useApp } from '@/hooks/useApp';
import { dbDeleteAccount, dbDeleteAccountByCode, dbSendDeleteAccountCode } from '@/services/db';
import { rs, rf } from '@/constants/scale';

/**
 * Удаление аккаунта (решение владельца 01.10.2026: «приходит код на почту,
 * вводишь — и аккаунт удалён»). Одно окно для настроек соискателя и профиля
 * работодателя, в стиле JT, как окно «да/нет».
 *
 * Есть подтверждённая почта — код из письма, пароль не нужен (у аккаунтов
 * «почта → код» его и нет). Почты нет (старые аккаунты по телефону) — по
 * паролю, как раньше: код отправить некуда.
 *
 * Само удаление и проверку делает сервер (dbDeleteAccountByCode): код
 * уходит только на почту аккаунта из сессии. Выход и переход — у вызывающего
 * в onDeleted.
 */
export function DeleteAccountSheet({ visible, onClose, onDeleted }: {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const { currentUser } = useApp();
  const byCode = !!currentUser?.email && !!currentUser?.emailVerifiedAt;

  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) { setCodeSent(false); setCode(''); setPassword(''); setBusy(false); setError(''); }
  }, [visible]);

  if (!currentUser) return null;

  const sendCode = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await dbSendDeleteAccountCode();
      setCodeSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось отправить код');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (byCode) await dbDeleteAccountByCode(currentUser.id, code.trim());
      else await dbDeleteAccount(currentUser.id, password);
      await onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить аккаунт');
      setBusy(false);
    }
  };

  const canDelete = byCode ? code.trim().length === 6 : password.trim().length > 0;
  const step: 'intro' | 'code' | 'password' = !byCode ? 'password' : codeSent ? 'code' : 'intro';

  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={busy ? undefined : onClose}>
        <View style={s.overlay} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.center} pointerEvents="box-none">
        <HardShadowBox offset={5} radius={rs(24)} style={s.cardWrap}>
          <View style={s.card} accessibilityViewIsModal testID="delete-account-sheet">
            <Text style={s.title} accessibilityRole="header">Удалить аккаунт?</Text>
            <Text style={s.body}>
              {step === 'code'
                ? `Мы отправили код на ${currentUser.email}. Введите его — и аккаунт удалится.`
                : 'Профиль, отклики и резюме удалятся навсегда. Это нельзя отменить.'}
            </Text>

            {step === 'code' ? (
              <View style={s.field}>
                <JTInput
                  label="Код из письма"
                  value={code}
                  onChangeText={t => { setCode(t.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                  placeholder="000000"
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  testID="delete-account-code"
                />
              </View>
            ) : null}
            {step === 'password' ? (
              <View style={s.field}>
                <JTInput
                  label="Пароль"
                  value={password}
                  onChangeText={t => { setPassword(t); setError(''); }}
                  placeholder="Подтвердите пароль"
                  secureTextEntry
                  autoFocus
                  testID="delete-account-password"
                />
              </View>
            ) : null}

            {error ? <Text style={s.error}>{error}</Text> : null}

            <HardShadowBox offset={3} radius={rs(26)} style={s.mainWrap}>
              <TouchableOpacity
                style={[s.main, step !== 'intro' && !canDelete && s.mainOff]}
                onPress={step === 'intro' ? sendCode : remove}
                disabled={busy || (step !== 'intro' && !canDelete)}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID="delete-account-ok"
              >
                <Text style={s.mainTxt}>
                  {busy
                    ? (step === 'intro' ? 'Отправляем…' : 'Удаляем…')
                    : (step === 'intro' ? 'Прислать код на почту' : 'Удалить аккаунт')}
                </Text>
              </TouchableOpacity>
            </HardShadowBox>

            {step === 'code' ? (
              <TouchableOpacity style={s.ghost} onPress={sendCode} disabled={busy} accessibilityRole="button">
                <Text style={s.ghostTxt}>Отправить код ещё раз</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={s.ghost} onPress={onClose} disabled={busy} accessibilityRole="button">
              <Text style={s.ghostTxt}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </HardShadowBox>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,20,20,0.45)' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: rs(24) },
  cardWrap: { width: '100%', maxWidth: 400 },
  card: {
    backgroundColor: JT.background, borderRadius: rs(24), borderWidth: 2, borderColor: JT.ink,
    paddingHorizontal: rs(22), paddingTop: rs(24), paddingBottom: rs(12),
  },
  title: { fontFamily: JT_FONT.head, fontSize: rf(19), lineHeight: rf(24), color: JT.ink },
  body: { marginTop: rs(10), fontFamily: JT_FONT.medium, fontSize: rf(15), lineHeight: rf(21), color: JT.textSecondary },
  field: { marginTop: rs(16) },
  error: { marginTop: rs(10), fontFamily: JT_FONT.bold, fontSize: rf(14), color: JT_ERROR },
  mainWrap: { marginTop: rs(20) },
  main: {
    minHeight: rs(52), borderRadius: rs(26), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT_ERROR,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(16), paddingVertical: rs(10),
  },
  mainOff: { opacity: 0.5 },
  mainTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(16), color: '#FFFFFF', textAlign: 'center' },
  ghost: { minHeight: rs(44), alignItems: 'center', justifyContent: 'center', marginTop: rs(4) },
  ghostTxt: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textTertiary },
});
