/**
 * Почта → код из письма → квитанция.
 *
 * Один компонент на все три случая (решение владельца 25.09.2026): первый шаг
 * регистрации, восстановление пароля и окно «Укажите почту» для старых
 * аккаунтов по телефону. Код сверяет сервер и отдаёт квитанцию — её и
 * получает onVerified; сам код дальше никуда не идёт.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/theme';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { dbAuthSendCode, dbAuthVerifyCode, type EmailCodePurpose } from '@/services/db';
import { rs, rf } from '@/constants/scale';

const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

type Props = {
  purpose: EmailCodePurpose;
  onVerified: (email: string, ticket: string) => void;
  /** Подпись над полем почты. */
  emailLabel?: string;
  /** Пришло ли письмо: сбой отправки или первая отправка (для «Напомнить позже»). */
  onSendAttempt?: (ok: boolean) => void;
};

export function EmailCodeStep({ purpose, onVerified, emailLabel = 'Почта', onSendAttempt }: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const startCountdown = () => {
    setResendIn(RESEND_SECONDS);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setResendIn(s => {
        if (s <= 1 && timer.current) { clearInterval(timer.current); timer.current = null; }
        return Math.max(0, s - 1);
      });
    }, 1000);
  };

  const normalized = email.trim().toLowerCase();

  const send = async () => {
    if (!EMAIL_RE.test(normalized)) { setError('Проверьте адрес почты'); return; }
    setBusy(true);
    setError('');
    try {
      await dbAuthSendCode(normalized, purpose);
      setPhase('code');
      setCode('');
      startCountdown();
      onSendAttempt?.(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить письмо');
      onSendAttempt?.(false);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) { setError('Код — шесть цифр из письма'); return; }
    setBusy(true);
    setError('');
    try {
      const ticket = await dbAuthVerifyCode(normalized, purpose, digits);
      onVerified(normalized, ticket);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить код');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'email') {
    return (
      <View style={styles.wrap}>
        <AppInput
          label={emailLabel}
          value={email}
          onChangeText={v => { setEmail(v); setError(''); }}
          placeholder="name@mail.ru"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          inputMode="email"
          accessibilityLabel="Почта"
          error={error}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <View style={styles.btn}>
          {busy
            ? <ActivityIndicator color={Colors.primary} />
            : <PrimaryButton label="Получить код →" onPress={send} disabled={!normalized} />}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.sent}>
        Мы отправили код на <Text style={styles.sentEmail}>{normalized}</Text>. Проверьте и папку «Спам».
      </Text>
      <AppInput
        label="Код из письма"
        value={code}
        onChangeText={v => { setCode(v.replace(/\D/g, '').slice(0, 6)); setError(''); }}
        placeholder="000000"
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        accessibilityLabel="Код из письма"
        error={error}
        onSubmitEditing={verify}
        style={styles.codeInput}
      />
      <View style={styles.btn}>
        {busy
          ? <ActivityIndicator color={Colors.primary} />
          : <PrimaryButton label="Подтвердить →" onPress={verify} disabled={code.length !== 6} />}
      </View>
      <View style={styles.row}>
        <TouchableOpacity onPress={() => { setPhase('email'); setError(''); }} accessibilityRole="button">
          <Text style={styles.link}>Изменить почту</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={send} disabled={resendIn > 0 || busy} accessibilityRole="button">
          <Text style={[styles.link, (resendIn > 0 || busy) && styles.linkOff]}>
            {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : 'Отправить код ещё раз'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: rs(12) },
  btn: { marginTop: rs(4), minHeight: rs(48), justifyContent: 'center' },
  sent: { fontSize: rf(14), color: Colors.textSecondary, lineHeight: rf(20) },
  sentEmail: { fontWeight: '700', color: Colors.textPrimary },
  codeInput: { fontSize: rf(22), letterSpacing: 6, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: rs(8) },
  link: { fontSize: rf(13), color: Colors.primary, fontWeight: '600' },
  linkOff: { color: Colors.textMuted },
});
