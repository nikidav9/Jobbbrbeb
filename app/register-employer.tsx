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
import { BackButton } from '@/components/ui/BackButton';
import { JTProgress, JTLink, jtBackStyle } from '@/components/ui/jt';
import { ConsentChecks } from '@/components/feature/ConsentChecks';
import { JT, JT_FONT } from '@/constants/jt';

// Путь по почте (emailAuthReady, решение владельца «позже отдельно» от
// 27.09.2026, сделано следующим срезом — как у соискателя): один экран
// «почта + согласия» → код → «Как называется компания?» → сразу в кабинет,
// без пароля и без остальных прежних шагов. Пароль и имя человека спросит
// профиль/настройки, если понадобятся.
// Путь по телефону (SMTP ещё не готов) — прежние 5 шагов без изменений:
// 1-Телефон, 2-Пароль, 3-Имя+Компания, 4-Согласие, 5-О компании.
const COMPANY_OPTIONS = ['Лавка'] as const;
type CompanyOption = typeof COMPANY_OPTIONS[number];

export default function RegisterEmployer() {
  const router = useRouter();
  const { emailAuthReady, registerUser, showToast } = useApp();
  const TOTAL = emailAuthReady ? 3 : 5;

  const [step, setStep] = useState(1);
  // Код отправлен — второй (свой) шаг EmailCodeStep. Только для прогресса в
  // шапке: сам переход между «почта» и «код» держит компонент у себя.
  const [emailCodeSent, setEmailCodeSent] = useState(false);
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
  // Шаг 2 короткого пути по почте — свободное название компании, без списка.
  const [companyName, setCompanyName] = useState('');
  const [age, setAge] = useState('');
  const [bio, setBio] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [pdAgreed, setPdAgreed] = useState(false);
  // Реклама — отдельная необязательная галочка, по умолчанию снята (38-ФЗ, ст. 18).
  const [adsAgreed, setAdsAgreed] = useState(false);
  const [passError, setPassError] = useState('');

  // Warm up the Supabase connection so the first phone-check doesn't hang
  useEffect(() => { dbWarmup(); }, []);

  // Первый шаг, открытый по прямой ссылке: истории нет, router.back() молчит.
  const back = () => {
    if (step > 1) {
      // Возврат с шага компании на шаг почты размонтирует EmailCodeStep
      // (условный рендер по step === 1) — его фаза сама вернётся на «почта».
      if (emailAuthReady) setEmailCodeSent(false);
      setStep(s => s - 1);
    }
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };
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
      await registerUser(user, emailTicket || undefined, { marketing: adsAgreed });
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

  // Почта → код → «Как называется компания?» → сразу в кабинет (решение
  // владельца, тот же срез, что у соискателя 27.09.2026): без пароля и без
  // прежних шагов «Имя», «О компании». Название компании вводит человек сам —
  // это и есть кабинет, показывать пустое имя в вакансиях/чате нечем.
  const finishByEmail = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const id = uid();
      const user = {
        id,
        role: 'employer' as const,
        phone: '',
        email,
        emailVerifiedAt: nowISO(),
        lastName: '',
        firstName: '',
        company: companyName.trim(),
        createdAt: nowISO(),
      };
      await registerUser(user, emailTicket, { marketing: adsAgreed });
      showToast('Добро пожаловать! 👋', 'success');
      router.replace('/(tabs)');
    } catch (e) {
      console.error('[RegisterEmployer] finishByEmail error', e);
      const msg = e instanceof Error && e.message ? e.message : 'Ошибка регистрации. Попробуйте ещё раз.';
      showToast(msg, 'error');
      // Квитанция устарела или почту успели занять — вернуть на шаг почты:
      // step === 1 размонтирует EmailCodeStep и его фаза сама сбросится.
      if (/почт/i.test(msg)) { setEmailTicket(''); setEmailCodeSent(false); setStep(1); }
    } finally {
      setFinishing(false);
    }
  };

  // Общие для почты (под полем, до отправки кода) и телефона (отдельный шаг
  // 4) — одни и те же три галочки.
  const renderConsentCheckboxes = () => (
    <ConsentChecks
      agreed={agreed} onAgreed={() => setAgreed(v => !v)}
      pdAgreed={pdAgreed} onPdAgreed={() => setPdAgreed(v => !v)}
      adsAgreed={adsAgreed} onAdsAgreed={() => setAdsAgreed(v => !v)}
    />
  );

  // Шаг «почта» и шаг «код» внутри EmailCodeStep считаются одним шагом снаружи
  // (свой переход держит сам компонент) — тот же приём, что у register-worker.
  const displayedStep = emailAuthReady ? (step === 1 ? (emailCodeSent ? 2 : 1) : 3) : step;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <BackButton onPress={back} style={jtBackStyle} />
        <JTProgress step={displayedStep} total={TOTAL} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

          {/* Step 1: Email + code */}
          {step === 1 && (
            <View style={[styles.stepContent, emailAuthReady && styles.grow]}>
              {!(emailAuthReady && emailCodeSent) ? (
                <>
                <Text style={styles.title}>{emailAuthReady ? 'Регистрация компании' : 'Введите номер телефона'}</Text>
                <Text style={styles.subtitle}>
                  {emailAuthReady
                    ? 'Пришлём код — пароль не нужен'
                    : 'Работник увидит его только после мэтча'}
                </Text>
                </>
              ) : null}
              {emailAuthReady ? (
                <EmailCodeStep
                  purpose="register"
                  hero
                  pinButton
                  onPhaseChange={p => setEmailCodeSent(p === 'code')}
                  disabled={!agreed || !pdAgreed}
                  belowEmail={renderConsentCheckboxes()}
                  onSendAttempt={ok => { if (ok) setEmailCodeSent(true); }}
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
              {!(emailAuthReady && emailCodeSent) ? (
                <Text style={styles.loginHintTxt}>
                  Уже есть аккаунт? <JTLink onPress={() => router.push('/login')}>Войти</JTLink>
                </Text>
              ) : null}
            </View>
          )}

          {/* Step 2 (почта): «Как называется компания?» — одно поле, без пароля */}
          {step === 2 && emailAuthReady && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Как называется компания?</Text>
              <Text style={styles.subtitle}>Работники увидят это название в вакансиях</Text>
              <AppInput
                label="Название компании"
                value={companyName}
                onChangeText={setCompanyName}
                placeholder="Лавка"
                autoFocus
              />
              <View style={{ marginTop: 4 }}>
                <PrimaryButton
                  label="Готово →"
                  onPress={finishByEmail}
                  loading={finishing}
                  disabled={!companyName.trim() || finishing}
                />
              </View>
            </View>
          )}

          {/* Step 2 (телефон): Password */}
          {step === 2 && !emailAuthReady && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Придумайте пароль</Text>
              <Text style={styles.subtitle}>{emailTicket ? 'Забудете — восстановите кодом из письма.' : 'Запомните его. Забудете — пишите на support@jobtoo.ru.'}</Text>
              <AppInput
                label="Пароль"
                value={password}
                onChangeText={v => { setPassword(v); setPassError(''); }}
                secureTextEntry
                placeholder="Пароль"
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
              <Text style={styles.title}>Как вас зовут?</Text>
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

              {renderConsentCheckboxes()}

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
  safe: { flex: 1, backgroundColor: JT.background },
  grow: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: rs(14), paddingHorizontal: rs(24), paddingTop: rs(12), height: rs(56) },
  // flexGrow + center: короткий шаг встаёт по центру экрана, длинный
  // ведёт себя как обычная прокрутка сверху.
  body: { paddingHorizontal: rs(24), paddingTop: rs(26), paddingBottom: rs(28), flexGrow: 1 },
  stepContent: { gap: rs(16) },
  title: { fontFamily: JT_FONT.head, fontSize: rf(27), lineHeight: rf(31), letterSpacing: -0.3, color: JT.ink },
  subtitle: { fontFamily: JT_FONT.medium, fontSize: rf(16), color: JT.textSecondary, marginTop: rs(-6), lineHeight: rf(23) },
  fieldError: { fontSize: rf(13), color: Colors.red, lineHeight: rf(18) },
  loginHintTxt: { fontFamily: JT_FONT.medium, fontSize: rf(15), color: JT.ink, textAlign: 'center', marginTop: rs(4) },
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