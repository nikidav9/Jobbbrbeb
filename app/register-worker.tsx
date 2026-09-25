import React, { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Colors, Radius } from '@/constants/theme';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { EmailCodeStep } from '@/components/feature/EmailCodeStep';
import { MetroPicker } from '@/components/feature/MetroPicker';
import { AboutYouStep, isAboutYouComplete } from '@/components/feature/AboutYouStep';
import { uploadAvatar } from '@/services/avatarUpload';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO } from '@/services/storage';
import { dbWarmup, dbSaveResumeFile } from '@/services/db';
import { extractResumePdf, mergeResumeIntoUser } from '@/services/resumeImport';
import { METRO_LINES } from '@/constants/metro';
import { PasswordRules } from '@/components/ui/PasswordRules';
import { firstUnmetRule } from '@/constants/passwordRules';

import { rs, rf } from '@/constants/scale';

// Steps: 1-Phone, 2-Password, 3-Name, 4-Legal, 5-Metro, 6-Резюме
const TOTAL = 7;

export default function RegisterWorker() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { registerUser, updateUser, showToast } = useApp();

  const [step, setStep] = useState(1);
  // Шаг 1 — почта с кодом из письма (решение владельца 25.09.2026, телефон
  // из регистрации убран). Квитанцию предъявляем в самом конце, в registerUser.
  const [email, setEmail] = useState('');
  const [emailTicket, setEmailTicket] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [metroLineId, setMetroLineId] = useState('');
  const [metroLineName, setMetroLineName] = useState('');
  const [metroStation, setMetroStation] = useState('');
  const [resumeFile, setResumeFile] = useState<Awaited<ReturnType<typeof extractResumePdf>> & { fileName: string } | null>(null);
  const [resumeParsing, setResumeParsing] = useState(false);
  const [age, setAge] = useState('');
  const [bio, setBio] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [metroPicker, setMetroPicker] = useState(false);
  const [passError, setPassError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [pdAgreed, setPdAgreed] = useState(false);

  // Warm up the Supabase connection so the first phone-check doesn't hang
  useEffect(() => { dbWarmup(); }, []);

  const back = () => { if (step === 1) router.back(); else setStep(s => s - 1); };
  const next = () => setStep(s => s + 1);

  // Разбор PDF идёт на устройстве (services/resumeImport.ts), файл в сейф
  // ложится только после регистрации — до неё нет сессии, которой его подписать.
  const pickResume = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      setResumeParsing(true);
      const asset = picked.assets[0];
      const parsed = await extractResumePdf(asset);
      setResumeFile({ ...parsed, fileName: asset.name || parsed.resume.sourceFileName || 'resume.pdf' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось прочитать резюме', 'error');
    } finally {
      setResumeParsing(false);
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
        phone: '',
        email,
        emailVerifiedAt: nowISO(),
        password,
        lastName,
        firstName,
        metroLineId,
        metroStation,
        workTypes: [],
        age: Number(age),
        bio: bio.trim(),
        avatarUrl,
        createdAt: nowISO(),
      };
      await registerUser(user, emailTicket);
      // Сейф резюме требует сессии — её выдаёт registerUser чуть выше.
      // Сбой сохранения не откатывает уже созданный аккаунт: резюме можно
      // загрузить и позже в профиле.
      if (resumeFile) {
        try {
          const saved = await dbSaveResumeFile(resumeFile.fileName, resumeFile.bytes, resumeFile.resume);
          // Имя, фамилию и возраст человек только что ввёл руками — они
          // главнее того, что парсер достал из PDF. Из резюме берём отчество.
          const middleName = resumeFile.identity?.middleName;
          await updateUser(mergeResumeIntoUser(user, saved.resume, middleName ? { middleName } : undefined));
        } catch (e) {
          console.warn('[RegisterWorker] resume save failed', e);
          showToast('Резюме не сохранилось — загрузите его в профиле', 'error');
        }
      }
      showToast('Добро пожаловать! 👋', 'success');
      router.replace(returnTo ? `/${returnTo}` : '/(tabs)');
    } catch (e) {
      console.error('[RegisterWorker] finish error', e);
      const msg = e instanceof Error && e.message ? e.message : 'Ошибка регистрации. Попробуйте ещё раз.';
      showToast(msg, 'error');
      // Квитанция устарела или почту успели занять — вернуть на шаг почты.
      if (/почт/i.test(msg)) { setEmailTicket(''); setStep(1); }
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

          {/* Step 1: Email + code */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Твоя почта</Text>
              <Text style={styles.subtitle}>Пришлём код — по почте будешь входить и восстанавливать пароль</Text>
              <EmailCodeStep
                purpose="register"
                onVerified={(e, t) => { setEmail(e); setEmailTicket(t); setStep(2); }}
              />
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
              <Text style={styles.subtitle}>Забудешь — восстановишь кодом из письма.</Text>
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

          {/* Step 6: Резюме */}
          {step === 6 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Загрузи резюме</Text>
              <Text style={styles.subtitle}>По резюме подберём вакансии. Без резюме откликаться нельзя — его можно загрузить и позже в профиле.</Text>
              {resumeParsing ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : resumeFile ? (
                <View style={styles.metroSelected}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.metroStName}>{resumeFile.fileName}</Text>
                    {resumeFile.resume.experience[0]?.position ? (
                      <Text style={styles.metroLineName}>{resumeFile.resume.experience[0].position}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={pickResume}>
                    <Text style={styles.changeLink}>Заменить</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.metroField} onPress={pickResume} activeOpacity={0.8}>
                  <Text style={styles.metroFieldText}>📄 Выбрать PDF</Text>
                  <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
              )}
              <View style={{ marginTop: 28 }}>
                <PrimaryButton label="Продолжить →" onPress={next} />
              </View>
              <TouchableOpacity style={styles.loginHint} onPress={() => { setResumeFile(null); next(); }}>
                <Text style={styles.loginHintTxt}>Пропустить — выберу разделы сам</Text>
              </TouchableOpacity>
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