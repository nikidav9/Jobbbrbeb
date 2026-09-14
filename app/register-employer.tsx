import React, { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { PhoneInput } from '@/components/feature/PhoneInput';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO, isPhoneComplete, extractPhoneDigits } from '@/services/storage';
import { dbCheckPhoneExists, dbWarmup } from '@/services/db';
import { PasswordRules } from '@/components/ui/PasswordRules';
import { firstUnmetRule } from '@/constants/passwordRules';
import { AboutYouStep, isAboutYouComplete } from '@/components/feature/AboutYouStep';
import { uploadAvatar } from '@/services/avatarUpload';

import { rs, rf } from '@/constants/scale';

// Steps: 1-Phone, 2-Password, 3-Name+Company, 4-Legal
const TOTAL = 5;
const SUPPORT_EMAIL = 'support@jobtoo.ru';
const COMPANY_OPTIONS = ['Лавка'] as const;
type CompanyOption = typeof COMPANY_OPTIONS[number];

export default function RegisterEmployer() {
  const router = useRouter();
  const { registerUser, showToast } = useApp();

  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('+7 ');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [company, setCompany] = useState<CompanyOption | ''>('');
  const [age, setAge] = useState('');
  const [bio, setBio] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passError, setPassError] = useState('');

  // Warm up the Supabase connection so the first phone-check doesn't hang
  useEffect(() => { dbWarmup(); }, []);

  const back = () => { if (step === 1) router.back(); else setStep(s => s - 1); };
  const next = () => setStep(s => s + 1);

  // Step 1 → 2: check phone uniqueness
  const continueFromPhone = async () => {
    setPhoneError('');
    setChecking(true);
    try {
      const digits = extractPhoneDigits(phone);
      const exists = await dbCheckPhoneExists(digits);
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
        phone: extractPhoneDigits(phone),
        password,
        lastName,
        firstName,
        company: company || '',
        age: Number(age),
        bio: bio.trim(),
        avatarUrl,
        createdAt: nowISO(),
      };
      await registerUser(user);
      showToast('Добро пожаловать! 👋', 'success');
      router.replace('/(tabs)');
    } catch (e) {
      console.error('[RegisterEmployer] finish error', e);
      showToast('Ошибка регистрации. Попробуйте ещё раз.', 'error');
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

          {/* Step 1: Phone */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Введи номер телефона</Text>
              <Text style={styles.subtitle}>Работник увидит его только после мэтча</Text>
              <PhoneInput value={phone} onChange={v => { setPhone(v); setPhoneError(''); }} />
              {phoneError ? <Text style={styles.fieldError}>{phoneError}</Text> : null}
              <View style={{ marginTop: 8 }}>
                {checking ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <PrimaryButton label="Продолжить →" onPress={continueFromPhone} disabled={!isPhoneComplete(phone)} />
                )}
              </View>
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
              <Text style={styles.subtitle}>Запомни его — восстановления нет.</Text>
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

              {/* Подсказка про почту стоит после кнопки: она нужна тем, кто
                  сюда вернётся, и не должна перебивать главное действие */}
              <TouchableOpacity
                onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Восстановление пароля JobToo`)}
                activeOpacity={0.8}
              >
                <View style={styles.forgotBanner}>
                  <Text style={styles.forgotText}>
                    Забыли пароль? Обращайтесь на{' '}
                    <Text style={styles.forgotLink}>{SUPPORT_EMAIL}</Text>
                  </Text>
                </View>
              </TouchableOpacity>
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
                    Ставя галочку, я подтверждаю, что ознакомлен(а) и согласен(на) с{' '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'terms' } })}>
                      Пользовательским соглашением
                    </Text>
                    {', '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}>
                      Политикой конфиденциальности
                    </Text>
                    {', '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'dataPolicy' } })}>
                      Политикой обработки персональных данных
                    </Text>
                    {' и '}
                    <Text style={styles.link} onPress={() => router.push({ pathname: '/legal', params: { doc: 'consent' } })}>
                      Согласием на обработку персональных данных
                    </Text>
                    .
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={{ marginTop: 16 }}>
                <PrimaryButton label="Продолжить →" onPress={next} disabled={!agreed} />
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
  forgotBanner: {
    backgroundColor: '#F0F4FF', borderRadius: rs(10), padding: rs(12),
    borderWidth: 1, borderColor: '#BFCBF5',
  },
  forgotText: { fontSize: rf(12), color: Colors.textSecondary, lineHeight: rf(17) },
  forgotLink: { color: Colors.primary, fontWeight: '600' },
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