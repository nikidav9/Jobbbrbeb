import React, { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { PhoneInput } from '@/components/feature/PhoneInput';
import { MetroPicker } from '@/components/feature/MetroPicker';
import { WorkTypeSelector } from '@/components/feature/WorkTypeSelector';
import { AboutYouStep, isAboutYouComplete } from '@/components/feature/AboutYouStep';
import { uploadAvatar } from '@/services/avatarUpload';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO, isPhoneComplete, extractPhoneDigits } from '@/services/storage';
import { dbCheckPhoneExists, dbWarmup } from '@/services/db';
import { WorkType } from '@/constants/types';
import { METRO_LINES } from '@/constants/metro';
import { PasswordRules } from '@/components/ui/PasswordRules';
import { firstUnmetRule } from '@/constants/passwordRules';

import { rs, rf } from '@/constants/scale';

// Steps: 1-Phone, 2-Password, 3-Name, 4-Legal, 5-Metro, 6-WorkType
const TOTAL = 7;
const SUPPORT_EMAIL = 'support@jobtoo.ru';

export default function RegisterWorker() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { registerUser, showToast } = useApp();

  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('+7 ');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [metroLineId, setMetroLineId] = useState('');
  const [metroLineName, setMetroLineName] = useState('');
  const [metroStation, setMetroStation] = useState('');
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [age, setAge] = useState('');
  const [bio, setBio] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [metroPicker, setMetroPicker] = useState(false);
  const [checking, setChecking] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [passError, setPassError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [pdAgreed, setPdAgreed] = useState(false);

  // Warm up the Supabase connection so the first phone-check doesn't hang
  useEffect(() => { dbWarmup(); }, []);

  const toggleWork = (t: WorkType) => {
    setWorkTypes([t]);
  };

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
      // Фото заливаем до создания профиля: имя файла завязано на id, а если
      // загрузка не удалась — регистрацию из-за этого рушить нельзя, фото
      // необязательное.
      let avatarUrl: string | undefined;
      if (photoUri) {
        try {
          avatarUrl = await uploadAvatar(photoUri, id);
        } catch (e) {
          console.warn('[RegisterWorker] avatar upload failed', e);
        }
      }
      const user = {
        id,
        role: 'worker' as const,
        phone: extractPhoneDigits(phone),
        password,
        lastName,
        firstName,
        metroLineId,
        metroStation,
        workTypes,
        age: Number(age),
        bio: bio.trim(),
        avatarUrl,
        createdAt: nowISO(),
      };
      await registerUser(user);
      showToast('Добро пожаловать! 👋', 'success');
      router.replace(returnTo ? `/${returnTo}` : '/(tabs)');
    } catch (e) {
      console.error('[RegisterWorker] finish error', e);
      showToast('Ошибка регистрации. Попробуйте ещё раз.', 'error');
    } finally {
      setFinishing(false);
    }
  };

  const line = METRO_LINES.find(l => l.id === metroLineId);

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
              <Text style={styles.subtitle}>Работодатель увидит его только после мэтча</Text>
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

          {/* Step 3: Name */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Как тебя зовут?</Text>
              <AppInput value={lastName} onChangeText={setLastName} placeholder="Романов" label="Фамилия" autoFocus />
              <AppInput value={firstName} onChangeText={setFirstName} placeholder="Алексей" label="Имя" />
              <View style={{ marginTop: 12 }}>
                <PrimaryButton label="Продолжить →" onPress={next} disabled={!lastName.trim() || !firstName.trim()} />
              </View>
            </View>
          )}

          {/* Step 4: Legal consent */}
          {step === 4 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Согласие</Text>
              <Text style={styles.subtitle}>Для использования сервиса</Text>

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

          {/* Step 5: Metro */}
          {step === 5 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>📍 Ближайшее метро</Text>
              <Text style={styles.subtitle}>Покажем работу рядом с тобой</Text>
              {metroStation ? (
                <View style={styles.metroSelected}>
                  <View style={[styles.metroLineDot, { backgroundColor: line?.color ?? Colors.blue }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.metroLineName}>{metroLineName}</Text>
                    <Text style={styles.metroStName}>{metroStation}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setMetroPicker(true)}>
                    <Text style={styles.changeLink}>Изменить</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.metroField} onPress={() => setMetroPicker(true)} activeOpacity={0.8}>
                  <Text style={styles.metroFieldText}>🚇 Выбрать станцию</Text>
                  <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
              )}
              <View style={{ marginTop: 28 }}>
                <PrimaryButton label="Продолжить →" onPress={next} disabled={!metroStation} />
              </View>
              <MetroPicker
                visible={metroPicker}
                onClose={() => setMetroPicker(false)}
                onSelect={(lid, lname, st) => { setMetroLineId(lid); setMetroLineName(lname); setMetroStation(st); setMetroPicker(false); }}
                selectedLineId={metroLineId}
                selectedStation={metroStation}
              />
            </View>
          )}

          {/* Step 6: Work type */}
          {step === 6 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Какую работу рассматриваешь?</Text>
              <Text style={styles.subtitle}>Выбери специализацию</Text>
              <WorkTypeSelector selected={workTypes} onToggle={toggleWork} />
              <View style={{ marginTop: 28 }}>
                <PrimaryButton label="Продолжить →" onPress={next} disabled={workTypes.length === 0} />
              </View>
            </View>
          )}

          {/* Step 7: О себе — фото, возраст, описание */}
          {step === 7 && (
            <View style={styles.stepContent}>
              <AboutYouStep
                role="worker"
                age={age} onAgeChange={setAge}
                bio={bio} onBioChange={setBio}
                photoUri={photoUri} onPhotoChange={setPhotoUri}
              />
              <View style={{ marginTop: 20 }}>
                <PrimaryButton
                  label="Начать поиск →"
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
  // (метро, виды работ) ведёт себя как обычная прокрутка сверху.
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
  metroField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: Radius.md, padding: rs(16) },
  metroFieldText: { fontSize: rf(15), color: Colors.textPrimary },
  arrow: { fontSize: rf(20), color: Colors.textMuted },
  metroSelected: { flexDirection: 'row', alignItems: 'center', gap: rs(12), borderWidth: 1.5, borderColor: Colors.primary, borderRadius: Radius.md, padding: rs(16), backgroundColor: Colors.primaryLight },
  metroLineDot: { width: rs(12), height: rs(12), borderRadius: rs(6) },
  metroLineName: { fontSize: rf(12), color: Colors.textMuted },
  metroStName: { fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary, marginTop: rs(2) },
  changeLink: { color: Colors.primary, fontSize: rf(13), fontWeight: '600' },
});