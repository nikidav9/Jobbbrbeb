/**
 * Почта → код из письма → квитанция.
 *
 * Один компонент на все три случая (решение владельца 25.09.2026): первый шаг
 * регистрации, восстановление пароля и окно «Укажите почту» для старых
 * аккаунтов по телефону. Код сверяет сервер и отдаёт квитанцию — её и
 * получает onVerified; сам код дальше никуда не идёт.
 *
 * Вид — макет «JT-auth-and-details» (27.09.2026): поле и кнопка-«наклейка»,
 * код — шесть отдельных ячеек (у макета четыре, но сервер шлёт шесть цифр —
 * решение владельца оставить шесть), проверка сама после последней цифры.
 * `hero` — полноэкранный вариант шага кода (иллюстрация «письмо», заголовок,
 * плашка «Письма нет?»): вход и регистрация. Без него — компактный, для окон.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { JTButton, JTInput, JTLink, JT_ERROR } from '@/components/ui/jt';
import { JT, JT_FONT } from '@/constants/jt';
import { dbAuthSendCode, dbAuthVerifyCode, type EmailCodePurpose } from '@/services/db';
import { rs, rf } from '@/constants/scale';

const RESEND_SECONDS = 60;
const CODE_LEN = 6;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

type Props = {
  purpose: EmailCodePurpose;
  onVerified: (email: string, ticket: string) => void;
  /** Подпись над полем почты. */
  emailLabel?: string;
  /** Пришло ли письмо: сбой отправки или первая отправка (для «Напомнить позже»). */
  onSendAttempt?: (ok: boolean) => void;
  /**
   * Свой шаг проверки кода вместо запроса квитанции (dbAuthVerifyCode +
   * onVerified) — например вход: код одноразовый, сервер отдаёт сессию сразу,
   * квитанция не нужна. Бросает ошибку — компонент покажет её текст.
   */
  verify?: (email: string, code: string) => Promise<void>;
  /**
   * Доп. содержимое под полем почты, пока не отправлен код — например,
   * галочки согласий при регистрации (решение владельца 27.09.2026: почта →
   * код → сразу лента, согласия спрашиваются тут же, а не отдельным шагом).
   * На шаге ввода кода не показывается — подтверждать там уже нечего.
   */
  belowEmail?: React.ReactNode;
  /**
   * Доп. условие, запрещающее отправку кода, помимо заполненности самой
   * почты, — например, не отмечены обязательные согласия из `belowEmail`.
   */
  disabled?: boolean;
  /** Полноэкранный шаг кода: иллюстрация, заголовок, «Письма нет?» внизу. */
  hero?: boolean;
  /** Кнопка «Получить код» прижата к низу экрана (регистрация по макету). */
  pinButton?: boolean;
  /** Смена фазы — экран прячет свою шапку на шаге кода. */
  onPhaseChange?: (phase: 'email' | 'code') => void;
};

export function EmailCodeStep({
  purpose, onVerified, emailLabel = 'Почта', onSendAttempt, verify: customVerify, belowEmail, disabled,
  hero, pinButton, onPhaseChange,
}: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhaseState] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeRef = useRef<TextInput>(null);
  // Код, который уже проверяли: неверный не отправляем повторно сам по себе,
  // пока человек его не исправит.
  const triedCode = useRef('');

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const setPhase = (p: 'email' | 'code') => { setPhaseState(p); onPhaseChange?.(p); };

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
    // Enter в поле почты зовёт send мимо погашенной кнопки: без этой строки
    // код уходил бы при неотмеченных обязательных согласиях.
    if (disabled) return;
    if (!EMAIL_RE.test(normalized)) { setError('Проверьте адрес почты'); return; }
    setBusy(true);
    setError('');
    try {
      await dbAuthSendCode(normalized, purpose);
      setPhase('code');
      setCode('');
      triedCode.current = '';
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
    triedCode.current = digits;
    setBusy(true);
    setError('');
    try {
      if (customVerify) {
        await customVerify(normalized, digits);
      } else {
        const ticket = await dbAuthVerifyCode(normalized, purpose, digits);
        onVerified(normalized, ticket);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить код');
    } finally {
      setBusy(false);
    }
  };

  // Кнопки подтверждения нет: код проверяется сам после последней цифры.
  useEffect(() => {
    if (phase === 'code' && code.length === CODE_LEN && !busy && triedCode.current !== code) void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, phase]);

  const changeEmail = () => { setPhase('email'); setError(''); };

  if (phase === 'email') {
    const button = (
      <JTButton label="Получить код" onPress={send} busy={busy} disabled={!normalized || disabled} testID="email-send" />
    );
    return (
      <View style={[styles.wrap, pinButton && styles.grow]}>
        <JTInput
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
        {/* Регистрация отвечает 409 «Аккаунт с этой почтой уже есть»
            (dbAuthSendCode) ещё на отправке кода — почта на этом шаге не
            меняется на другой экран, а человека уводило обратно на ввод
            почты без объяснений. Ссылка ведёт туда, где есть вход по этой
            же почте. Только для регистрации: у входа и восстановления такой
            ошибки не бывает. */}
        {purpose === 'register' && /уже есть/i.test(error) ? (
          <TouchableOpacity onPress={() => router.push('/login')} accessibilityRole="button">
            <Text style={styles.linkTxt}>Войти →</Text>
          </TouchableOpacity>
        ) : null}
        {belowEmail}
        {pinButton ? <View style={styles.grow} /> : null}
        <View style={styles.btn}>{button}</View>
      </View>
    );
  }

  const mm = Math.floor(resendIn / 60);
  const ss = String(resendIn % 60).padStart(2, '0');
  const cells = (
    <View>
      <View style={styles.cells}>
        {Array.from({ length: CODE_LEN }, (_, i) => {
          const ch = code[i] ?? '';
          const active = focused && !busy && i === Math.min(code.length, CODE_LEN - 1) && code.length < CODE_LEN;
          return (
            <View key={i} style={styles.cellBox}>
              {active ? <View style={styles.cellShadow} /> : null}
              <View style={[styles.cell, !ch && !active && styles.cellEmpty, !!error && styles.cellErr]}>
                {ch ? <Text style={styles.cellTxt}>{ch}</Text> : active ? <View style={styles.caret} /> : null}
              </View>
            </View>
          );
        })}
      </View>
      {/* Одно настоящее поле поверх ячеек: вставка кода целиком и
          автоподстановка из письма (one-time-code) работают как раньше. */}
      <TextInput
        ref={codeRef}
        value={code}
        onChangeText={v => { setCode(v.replace(/\D/g, '').slice(0, 6)); setError(''); }}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        caretHidden
        editable={!busy}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel="Код из письма"
        testID="email-code-input"
        style={styles.codeInput}
      />
    </View>
  );

  const resend = resendIn > 0 ? (
    <Text style={styles.timer}>
      Новый код можно получить через <Text style={styles.timerNum}>{mm}:{ss}</Text>
    </Text>
  ) : (
    <Text style={styles.timer}>
      <JTLink onPress={() => { if (!busy) void send(); }}>Отправить код ещё раз</JTLink>
    </Text>
  );

  if (!hero) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.sentSmall}>
          Мы отправили код на <Text style={styles.sentEmail}>{normalized}</Text>. Проверьте и папку «Спам».
        </Text>
        {cells}
        {error ? <Text style={styles.err}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={JT.accent} /> : resend}
        <Text style={styles.timer}><JTLink onPress={changeEmail}>Изменить почту</JTLink></Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, styles.grow]}>
      <Image
        source={require('@/assets/images/auth-code-letter.png')}
        style={styles.heroImg}
        resizeMode="contain"
        accessibilityLabel="Письмо с кодом"
      />
      <Text style={styles.heroTitle}>Введите код</Text>
      <Text style={styles.heroSub}>
        Отправили 6 цифр на{'\n'}<Text style={styles.heroEmail}>{normalized}</Text>
      </Text>
      <View style={styles.heroCells}>{cells}</View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <View style={styles.timerRow}>{busy ? <ActivityIndicator color={JT.accent} /> : resend}</View>
      <View style={styles.grow} />
      <View style={styles.noMail}>
        <View style={styles.noMailIcon}>
          <Ionicons name="mail-outline" size={rs(18)} color={JT.ink} />
        </View>
        <View style={{ flex: 1, gap: rs(4) }}>
          <Text style={styles.noMailTitle}>Письма нет?</Text>
          <Text style={styles.noMailTxt}>
            Проверьте папку «Спам» или <JTLink onPress={changeEmail} testID="email-change">измените почту</JTLink>
          </Text>
        </View>
      </View>
    </View>
  );
}

const CELL_H = rs(64);

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: rs(14) },
  grow: { flexGrow: 1 },
  btn: { marginTop: rs(0) },
  linkTxt: { fontFamily: JT_FONT.heavy, fontSize: rf(14), color: JT.ink },
  err: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT_ERROR, textAlign: 'center' },

  sentSmall: { fontFamily: JT_FONT.medium, fontSize: rf(14), color: JT.textSecondary, lineHeight: rf(20) },
  sentEmail: { fontFamily: JT_FONT.heavy, color: JT.ink },

  cells: { flexDirection: 'row', gap: rs(8) },
  cellBox: { flex: 1, height: CELL_H },
  cellShadow: {
    position: 'absolute', left: rs(4), top: rs(4), right: -rs(4), bottom: -rs(4),
    borderRadius: rs(16), backgroundColor: JT.accent,
  },
  cell: {
    flex: 1, borderRadius: rs(16), borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  cellEmpty: { borderWidth: 1.5, borderColor: JT.borderSoft },
  cellErr: { borderColor: JT_ERROR },
  cellTxt: { fontFamily: JT_FONT.head, fontSize: rf(26), color: JT.ink },
  caret: { width: 2.5, height: rs(28), borderRadius: 2, backgroundColor: JT.accent },
  codeInput: {
    position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
    opacity: 0, color: 'transparent', fontSize: rf(16),
  },

  timerRow: { alignItems: 'center', minHeight: rs(22) },
  timer: { fontFamily: JT_FONT.bold, fontSize: rf(14), color: JT.textTertiary, textAlign: 'center' },
  timerNum: { fontFamily: JT_FONT.heavy, color: JT.ink },

  heroImg: { width: rs(220), height: rs(176), alignSelf: 'center', marginTop: rs(4) },
  heroTitle: {
    fontFamily: JT_FONT.head, fontSize: rf(29), lineHeight: rf(33), letterSpacing: -0.3,
    color: JT.ink, textAlign: 'center', marginTop: rs(6),
  },
  heroSub: {
    fontFamily: JT_FONT.medium, fontSize: rf(16), lineHeight: rf(23), color: JT.textSecondary,
    textAlign: 'center', marginTop: rs(-4),
  },
  heroEmail: { fontFamily: JT_FONT.heavy, color: JT.ink },
  heroCells: { marginTop: rs(12) },

  noMail: {
    flexDirection: 'row', gap: rs(12), alignItems: 'flex-start',
    padding: rs(14), paddingHorizontal: rs(16), borderRadius: rs(18), backgroundColor: JT.surface,
  },
  noMailIcon: {
    width: rs(36), height: rs(36), borderRadius: rs(11), backgroundColor: JT.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  noMailTitle: { fontFamily: JT_FONT.heavy, fontSize: rf(14), color: JT.ink },
  noMailTxt: { fontFamily: JT_FONT.bold, fontSize: rf(13), lineHeight: rf(19), color: JT.textBody },
});
