/**
 * «Укажите почту» — для старых аккаунтов, заведённых по телефону.
 *
 * Решение владельца 25.09.2026: вход и восстановление пароля теперь по почте.
 * У кого её нет, тот, забыв пароль, не восстановит его ничем, поэтому окно
 * обязательное — и сразу после входа по номеру, и у тех, кто уже вошёл.
 *
 * Запасной выход: если письмо не пришло (сбой почты у Timeweb — не повод
 * запереть снаружи сотни людей), через минуту после отправки или сразу после
 * неудачной появляется «Напомнить позже». Окно вернётся при следующем
 * открытии приложения.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { EmailCodeStep } from '@/components/feature/EmailCodeStep';
import { dbAuthAttachEmail } from '@/services/db';
import { rs, rf } from '@/constants/scale';

const SNOOZE_AFTER_MS = 60_000;

export default function EmailRequiredGate() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const user = app?.currentUser ?? null;
  const [snoozed, setSnoozed] = useState(false);
  const [canSnooze, setCanSnooze] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Другой человек вошёл на этом устройстве — «позже» прежнего к нему не относится.
  useEffect(() => { setSnoozed(false); setCanSnooze(false); setError(''); }, [user?.id]);

  // Пока почта не готова (сервер не достучался до SMTP) — не просим вовсе:
  // письмо всё равно не уйдёт.
  const needed = !!user && !user.isGuest && !user.emailVerifiedAt && !app.loading && !snoozed && app.emailAuthReady;
  if (!needed) return null;

  const onSendAttempt = (ok: boolean) => {
    if (!ok) { setCanSnooze(true); return; }
    if (canSnooze || timer.current) return;
    timer.current = setTimeout(() => { setCanSnooze(true); timer.current = null; }, SNOOZE_AFTER_MS);
  };

  const onVerified = async (_email: string, ticket: string) => {
    setError('');
    try {
      const updated = await dbAuthAttachEmail(ticket);
      await app.adoptUser(updated);
      app.showToast('Почта подтверждена ✓', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить почту');
      setCanSnooze(true);
    }
  };

  return (
    <View
      style={[styles.overlay, { paddingTop: insets.top + rs(12), paddingBottom: Math.max(insets.bottom, rs(12)) }]}
      accessibilityViewIsModal
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.iconWrap}>
              <Ionicons name="mail-outline" size={rf(26)} color={Colors.primary} />
            </View>
            <Text style={styles.title}>Укажите почту</Text>
            <Text style={styles.lead}>
              Теперь в JobToo входят по почте. Подтвердите её кодом из письма — по ней
              вы сможете восстановить пароль. Номер телефона останется в профиле.
            </Text>
            <EmailCodeStep purpose="attach" onVerified={onVerified} onSendAttempt={onSendAttempt} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {canSnooze ? (
              <TouchableOpacity style={styles.later} onPress={() => setSnoozed(true)} accessibilityRole="button">
                <Text style={styles.laterText}>Письмо не пришло — напомнить позже</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.logout} onPress={() => { app.logout().catch(() => {}); }} accessibilityRole="button">
              <Text style={styles.logoutText}>Выйти из аккаунта</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,17,17,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: rs(16),
    // Под окном согласия (1000): сначала документы, потом почта.
    zIndex: 999,
    elevation: 999,
  },
  kav: { width: '100%', alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: rs(440),
    maxHeight: '100%',
    backgroundColor: Colors.bg,
    borderRadius: rs(20),
    overflow: 'hidden',
  },
  content: { padding: rs(22), gap: rs(12) },
  iconWrap: {
    width: rs(48), height: rs(48), borderRadius: rs(24),
    backgroundColor: '#FFF1E8', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary },
  lead: { fontSize: rf(14), color: Colors.textSecondary, lineHeight: rf(20) },
  error: { fontSize: rf(13), color: Colors.red },
  later: { alignItems: 'center', paddingVertical: rs(6) },
  laterText: { fontSize: rf(14), color: Colors.primary, fontWeight: '600' },
  logout: { alignItems: 'center', paddingVertical: rs(4) },
  logoutText: { fontSize: rf(13), color: Colors.textMuted },
});
