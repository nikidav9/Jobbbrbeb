import React, { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { EmailCodeStep } from '@/components/feature/EmailCodeStep';
import { PhoneInput } from '@/components/feature/PhoneInput';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO, isPhoneComplete, extractPhoneDigits } from '@/services/storage';
import { dbCheckPhoneExists, dbWarmup } from '@/services/db';
import { PasswordRules } from '@/components/ui/PasswordRules';
import { firstUnmetRule } from '@/constants/passwordRules';
import { AboutYouStep, isAboutYouComplete } from '@/components/feature/AboutYouStep';
import { uploadAvatar } from '@/services/avatarUpload';

import { rs, rf } from '@/constants/scale';

// Steps: 1-Email+code, 2-Password, 3-Name+Company, 4-Legal
const TOTAL = 5;
const COMPANY_OPTIONS = ['Лавка'] as const;
type CompanyOption = typeof COMPANY_OPTIONS[number];

export default function RegisterEmployer() {
  const router = useRouter();
  const { emailAuthReady, registerUser, showToast } = useApp();

  const [step, setStep] = useState(1);
  // Шаг 1 — почта с кодом из письма (решение владельца 25.09.2026).
  const [email, setEmail] = useState('');
  const [emailTicket, setEmailTicket] = useState('');
  // Пока почта не готова (сервер не достучался до SMTP) — как раньше, по
  // телефону: регистрация не должна вставать из-за почты.
  const [phone, setPhone] = useState('+7 ');
  const [checking, setChecking] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [company, setCompany] = useState<CompanyOption | ''>('');
  const [age, setAge] = useState('');
  const [bio, setBio] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [pdAgreed, setPdAgreed] = useState(false);
  const [passError, setPassError] = useState('');

  // Warm up the Supabase connection so the first phone-check doesn't hang
  useEffect(() => { dbWarmup(); }, []);

  const back = () => { if (step === 1) router.back(); else setStep(s => s - 1); };
  const next = () => setStep(s => s + 1);

  // Step 1 → 2 (режим телефона): номер ещё не занят
  const continueFromPhone = async () => {
    setPhoneError('');
    setChecking(true);
    try {
      const exists = await dbCheckPhoneExists(extractPhoneDigits(phone));
      if (exists) {
        setPhoneError('Аккаунт с этим номером уже существует. Войдите в систему.');
        return;
      }
      setStep(2);
    } catch {
      // Проверка уникальности — часть самой регистрации. При обрыве связи
      // нельзя делать вид, что номер свободен: иначе создадим дубликат.
      setPhoneError('Не удалось проверить номер. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setChecking(false);
    }
  };

  // Step 2 → 3: validate password
  const continueFromPassword = () => {
    setPassError('');
    const unmet = firstUnmetRule(password);
    if (unmet) {
      setPassError(`Пароль не подходит: ${unmet.label.toLowerCase()}`);
      return;
    }
    if (password !== passwordConfirm) {
      setPassError('Пароли не совпадают');
      return;
    }
    setStep(3);
  };

  const [finishing, setFinishing] = useState(false);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const id = uid();
      // Фото необязательное: не залилось — регистрацию из-за этого не рушим.
      let avatarUrl: string | undefined;
      if (photoUri) {
        try {
          avatarUrl = await uploadAvatar(photoUri, id);
        } catch (e) {
          console.warn('[RegisterEmployer] avatar upload failed', e);
        }
      }
      const user = {
        id,
        role: 'employer' as const,
        // По почте — телефона нет; по телефону (почта не готова) — как раньше.
        phone: emailTicket ? '' : extractPhoneDigits(phone),
        ...(emailTicket ? { email, emailVerifiedAt: nowISO() } : {}),
        password,
        lastName,
        firstName,
        company: company || '',
        age: Number(age),
        bio: bio.trim(),
        avatarUrl,
        createdAt: nowISO(),
      };
      await registerUser(user, emailTicket || undefined);
      showToast('Добро пожаловать! 👋', 'success');
      router.replace('/(tabs)');
    } catch (e) {
      console.error('[RegisterEmployer] finish error', e);
      const msg = e instanceof Error && e.message ? e.message : 'Ошибка регистрации. Попробуйте ещё раз.';
      showToast(msg, 'error');
      if (/почт/i.test(msg)) { setEmailTicket(''); setStep(1); }
    } finally {
      setFinishing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={back}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.stepLabel}>{step} из {TOTAL}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.progress}>
        <View style={[styles.progressFill, { width: `${(step / TOTAL) * 100}%` }]} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

          {/* Step 1: Email + code */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>{emailAuthReady ? 'Рабочая почта' : 'Введи номер телефона'}</Text>
              <Text style={styles.subtitle}>
                {emailAuthReady
                  ? 'Пришлём код — по почте будете входить и восстанавливать пароль'
                  : 'Работник увидит его только после мэтча'}
              </Text>
              {emailAuthReady ? (
                <EmailCodeStep
                  purpose="register"
                  onVerified={(e, t) => { setEmail(e); setEmailTicket(t); setStep(2); }}
                />
              ) : (
                <>
                  <PhoneInput value={phone} onChange={v => { setPhone(v); setPhoneError(''); }} />
                  {phoneError ? <Text style={styles.fieldError}>{phoneError}</Text> : null}
                  <View style={{ marginTop: 8 }}>
                    {checking ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <PrimaryButton label="Продолжить →" onPress={continueFromPhone} disabled={!isPhoneComplete(phone)} />
                    )}
                  </View>
                </>
              )}
              <TouchableOpacity style={styles.loginHint} onPress={() => router.push('/login')}>
                <Text style={styles.loginHintTxt}>
                  Уже есть аккаунт?{' '}
                  <Text style={{ color: Colors.primary, fontWeight: '700' }}>Войти →</Text>
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: Password */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Создай пароль</Text>
              <Text style={styles.subtitle}>{emailTicket ? 'Забудете — восстановите кодом из письма.' : 'Запомните его. Забудете — пишите на support@jobtoo.ru.'}</Text>
              <AppInput
                label="Пароль"
                value={password}
                onChangeText={v => { setPassword(v); setPassError(''); }}
                secureTextEntry
                placeholder="Придумайте пароль"
                autoFocus
              />
              <PasswordRules password={password} />
              <AppInput
                label="Повторите пароль"
                value={passwordConfirm}
                onChangeText={v => { setPasswordConfirm(v); setPassError(''); }}
                secureTextEntry
                placeholder="Повторите пароль"
              />
              {passError ? <Text style={styles.fieldError}>{passError}</Text> : null}

              <PrimaryButton
                label="Продолжить →"
                onPress={continueFromPassword}
                disabled={!password.trim() || !passwordConfirm.trim()}
              />

            </View>
          )}

          {/* Step 3: Name + Company */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Как тебя зовут?</Text>
              <AppInput value={lastName} onChangeText={setLastName} placeholder="Иванов" label="Фамилия" autoFocus />
              <AppInput value={firstName} onChangeText={setFirstName} placeholder="Дмитрий" label="Имя" />
              <Text style={[styles.subtitle, { marginTop: 8 }]}>Название компании</Text>
              {COMPANY_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.companyOption, company === opt && styles.companyOptionActive]}
                  onPress={() => setCompany(opt)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.companyRadio, company === opt && styles.companyRadioActive]}>
                    {company === opt ? <View style={styles.companyRadioDot} /> : null}
                  </View>
                  <Text style={[styles.companyLabel, company === opt && styles.companyLabelActive]}>{opt}</Text>
                </TouchableOpacity>
              ))}
              <View style={{ marginTop: 4 }}>
                <PrimaryButton label="Продолжить →" onPress={next} disabled={!lastName.trim() || !firstName.trim() || !company} />
              </View>
            </View>
          )}

          {/* Step 4: Legal consent */}
          {step === 4 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Согласие</Text>
              <Text style={styles.subtitle}>Для завершения регистрации</Text>

              <TouchableOpacity style={styles.checkRow} onPress={() => setAgreed(v => !v)} activeOpacity={0.8}>
                <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
                  {agreed ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkLabel}>
                    Я принимаю{' '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'terms' } })}>
                      Пользовательское соглашение
                    </Text>
                    {' '}и подтверждаю, что ознакомлен(а) с{' '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}>
                      Политикой конфиденциальности
                    </Text>
                    {' и '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'dataPolicy' } })}>
                      Политикой обработки персональных данных
                    </Text>
                    .
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.checkRow} onPress={() => setPdAgreed(v => !v)} activeOpacity={0.8}>
                <View style={[styles.checkbox, pdAgreed && styles.checkboxActive]}>
                  {pdAgreed ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkLabel}>
                    Отдельно даю{' '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'consent' } })}>
                      Согласие на обработку персональных данных
                    </Text>
                    . Это отдельное действие, не являющееся частью принятия Пользовательского соглашения.
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={{ marginTop: 16 }}>
                <PrimaryButton label="Продолжить →" onPress={next} disabled={!agreed || !pdAgreed} />
              </View>
            </View>
          )}

          {/* Step 5: О компании — фото, возраст, описание */}
          {step === 5 && (
            <View style={styles.stepContent}>
              <AboutYouStep
                role="employer"
                age={age} onAgeChange={setAge}
                bio={bio} onBioChange={setBio}
                photoUri={photoUri} onPhotoChange={setPhotoUri}
              />
              <View style={{ marginTop: 20 }}>
                <PrimaryButton
                  label="Начать работу →"
                  onPress={finish}
                  loading={finishing}
                  disabled={!isAboutYouComplete(age, bio) || finishing}
                />
              </View>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: rs(16), paddingVertical: rs(12) },
  backBtn: { width: rs(40), height: rs(40), borderRadius: rs(20), backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: rf(18), color: Colors.textSecondary },
  stepLabel: { fontSize: rf(13), color: Colors.textMuted },
  progress: { height: rs(3), backgroundColor: Colors.divider },
  progressFill: { height: rs(3), backgroundColor: Colors.primary },
  // flexGrow + center: короткий шаг встаёт по центру экрана, длинный
  // ведёт себя как обычная прокрутка сверху.
  body: { padding: rs(24), paddingBottom: rs(40), flexGrow: 1, justifyContent: 'center' },
  stepContent: { gap: rs(16) },
  title: { fontSize: rf(24), fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: rf(14), color: Colors.textMuted, marginTop: rs(-8), lineHeight: rf(20) },
  fieldError: { fontSize: rf(13), color: Colors.red, lineHeight: rf(18) },
  loginHint: { marginTop: rs(8), alignItems: 'center' },
  loginHintTxt: { fontSize: rf(14), color: Colors.textMuted },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(14), paddingVertical: rs(8) },
  checkbox: { width: rs(24), height: rs(24), borderRadius: rs(6), borderWidth: 1.5, borderColor: Colors.inputBorder, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', marginTop: rs(2), flexShrink: 0 },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: rf(14) },
  checkLabel: { fontSize: rf(14), color: Colors.textPrimary, lineHeight: rf(22), flex: 1 },
  link: { color: Colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  companyOption: {
    flexDirection: 'row', alignItems: 'center', gap: rs(14),
    padding: rs(16), borderRadius: rs(12), borderWidth: 1.5, borderColor: Colors.inputBorder,
    backgroundColor: Colors.surface,
  },
  companyOptionActive: { borderColor: Colors.primary, backgroundColor: '#F0EEFF' },
  companyRadio: {
    width: rs(22), height: rs(22), borderRadius: rs(11), borderWidth: 2, borderColor: Colors.inputBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  companyRadioActive: { borderColor: Colors.primary },
  companyRadioDot: { width: rs(10), height: rs(10), borderRadius: rs(5), backgroundColor: Colors.primary },
  companyLabel: { fontSize: rf(16), color: Colors.textPrimary, fontWeight: '500' },
  companyLabelActive: { color: Colors.primary, fontWeight: '700' },
});