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
import { PhoneInput } from '@/components/feature/PhoneInput';
import { MetroPicker } from '@/components/feature/MetroPicker';
import { AboutYouStep, isAboutYouComplete } from '@/components/feature/AboutYouStep';
import { uploadAvatar } from '@/services/avatarUpload';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO, isPhoneComplete, extractPhoneDigits } from '@/services/storage';
import { dbCheckPhoneExists, dbWarmup, dbSaveResumeFile } from '@/services/db';
import { extractResumePdf, mergeResumeIntoUser } from '@/services/resumeImport';
import { METRO_LINES } from '@/constants/metro';
import { PasswordRules } from '@/components/ui/PasswordRules';
import { firstUnmetRule } from '@/constants/passwordRules';

import { rs, rf } from '@/constants/scale';
import { BackButton } from '@/components/ui/BackButton';
import { JTProgress, JTLink, jtBackStyle } from '@/components/ui/jt';
import { ConsentChecks } from '@/components/feature/ConsentChecks';
import { JT, JT_FONT } from '@/constants/jt';

// Путь по почте (emailAuthReady, решение владельца 27.09.2026: «почта → код
// → сразу лента, как у getmatch»): один экран — почта, код и согласия внутри
// EmailCodeStep, второй его собственный шаг — код. Имя, метро и резюме
// теперь не спрашиваются: имя и резюме спросит окно первого отклика (не этот
// экран), метро и вовсе убрано.
// Путь по телефону (SMTP ещё не готов) — прежние 7 шагов: 1-Телефон,
// 2-Пароль, 3-Имя, 4-Согласие, 5-Метро, 6-Резюме, 7-О себе.

export default function RegisterWorker() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { emailAuthReady, registerUser, updateUser, showToast } = useApp();
  const TOTAL = emailAuthReady ? 2 : 7;

  const [step, setStep] = useState(1);
  // Код отправлен — второй (свой) шаг EmailCodeStep. Только для прогресса в
  // шапке: сам переход между «почта» и «код» держит компонент у себя.
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  // Растёт при ошибке квитанции — пересоздаёт EmailCodeStep, возвращая его
  // внутреннюю фазу на «почта» (снаружи её не сбросить иначе).
  const [emailStepKey, setEmailStepKey] = useState(0);
  // Шаг 1 — почта с кодом из письма (решение владельца 25.09.2026, телефон
  // из регистрации убран). Квитанцию предъявляем в самом конце, в registerUser.
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
  // Реклама — отдельная необязательная галочка, по умолчанию снята (38-ФЗ, ст. 18).
  const [adsAgreed, setAdsAgreed] = useState(false);

  // Warm up the Supabase connection so the first phone-check doesn't hang
  useEffect(() => { dbWarmup(); }, []);

  // Первый шаг, открытый по прямой ссылке: истории нет, router.back() молчит.
  const back = () => {
    if (step > 1) setStep(s => s - 1);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };
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
        // По почте — телефона нет; по телефону (почта не готова) — как раньше.
        phone: emailTicket ? '' : extractPhoneDigits(phone),
        ...(emailTicket ? { email, emailVerifiedAt: nowISO() } : {}),
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
      await registerUser(user, emailTicket || undefined, { marketing: adsAgreed });
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

  // Почта → код → сразу лента (решение владельца 27.09.2026, как у
  // getmatch): код подтверждён — регистрируем минимальный профиль без
  // пароля и без имени. Имя и резюме спросит окно первого отклика.
  const finishByEmail = async (verifiedEmail: string, ticket: string) => {
    if (finishing) return;
    setFinishing(true);
    try {
      const id = uid();
      const user = {
        id,
        role: 'worker' as const,
        phone: '',
        email: verifiedEmail,
        emailVerifiedAt: nowISO(),
        lastName: '',
        firstName: '',
        createdAt: nowISO(),
      };
      await registerUser(user, ticket, { marketing: adsAgreed });
      showToast('Добро пожаловать! 👋', 'success');
      router.replace(returnTo ? `/${returnTo}` : '/(tabs)');
    } catch (e) {
      console.error('[RegisterWorker] finishByEmail error', e);
      const msg = e instanceof Error && e.message ? e.message : 'Ошибка регистрации. Попробуйте ещё раз.';
      showToast(msg, 'error');
      // Квитанция устарела или почту успели занять — вернуть на шаг почты:
      // EmailCodeStep сам такого не умеет, поэтому пересоздаём его через key.
      if (/почт/i.test(msg)) { setEmailCodeSent(false); setEmailStepKey(k => k + 1); }
      setFinishing(false);
    }
  };

  // Общие для обоих путей: почта (под полем, до отправки кода) и телефон
  // (отдельный шаг 4) показывают одни и те же три галочки.
  const renderConsentCheckboxes = () => (
    <ConsentChecks
      agreed={agreed} onAgreed={() => setAgreed(v => !v)}
      pdAgreed={pdAgreed} onPdAgreed={() => setPdAgreed(v => !v)}
      adsAgreed={adsAgreed} onAdsAgreed={() => setAdsAgreed(v => !v)}
    />
  );

  const line = METRO_LINES.find(l => l.id === metroLineId);
  const displayedStep = emailAuthReady ? (emailCodeSent ? 2 : 1) : step;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <BackButton onPress={back} style={jtBackStyle} />
        <JTProgress step={displayedStep} total={TOTAL} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

          {/* Step 1: Email + code (или Phone — пока почта не готова) */}
          {step === 1 && (
            <View style={[styles.stepContent, emailAuthReady && styles.grow]}>
              {!(emailAuthReady && emailCodeSent) ? (
                <>
                <Text style={styles.title}>{emailAuthReady ? 'Регистрация по\u00A0почте' : 'Введите номер телефона'}</Text>
                <Text style={styles.subtitle}>
                  {emailAuthReady
                    ? (finishing ? 'Создаём аккаунт…' : 'Пришлём код — пароль не нужен')
                    : 'Работодатель увидит его только после мэтча'}
                </Text>
                </>
              ) : null}
              {emailAuthReady ? (
                finishing ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <EmailCodeStep
                    key={emailStepKey}
                    purpose="register"
                    hero
                    pinButton
                    onPhaseChange={p => setEmailCodeSent(p === 'code')}
                    disabled={!agreed || !pdAgreed}
                    belowEmail={renderConsentCheckboxes()}
                    onSendAttempt={ok => { if (ok) setEmailCodeSent(true); }}
                    onVerified={(e, t) => { setEmail(e); setEmailTicket(t); void finishByEmail(e, t); }}
                  />
                )
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

          {/* Step 2: Password */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Придумайте пароль</Text>
              <Text style={styles.subtitle}>{emailTicket ? 'Забудете — восстановите кодом из письма.' : 'Запомните его. Если забудете — напишите на support@jobtoo.ru.'}</Text>
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

          {/* Step 3: Name */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>Как вас зовут?</Text>
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

              {renderConsentCheckboxes()}

              <View style={{ marginTop: 16 }}>
                <PrimaryButton label="Продолжить →" onPress={next} disabled={!agreed || !pdAgreed} />
              </View>
            </View>
          )}

          {/* Step 5: Metro */}
          {step === 5 && (
            <View style={styles.stepContent}>
              <Text style={styles.title}>📍 Ближайшее метро</Text>
              <Text style={styles.subtitle}>Покажем работу рядом с вами</Text>
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
              <Text style={styles.title}>Загрузите резюме</Text>
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
                <Text style={styles.loginHintTxt}>Пропустить — загружу позже</Text>
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
  safe: { flex: 1, backgroundColor: JT.background },
  grow: { flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: rs(14), paddingHorizontal: rs(24), paddingTop: rs(12), height: rs(56) },
  // flexGrow + center: короткий шаг встаёт по центру экрана, длинный
  // (метро, виды работ) ведёт себя как обычная прокрутка сверху.
  body: { paddingHorizontal: rs(24), paddingTop: rs(26), paddingBottom: rs(28), flexGrow: 1 },
  stepContent: { gap: rs(16) },
  title: { fontFamily: JT_FONT.head, fontSize: rf(27), lineHeight: rf(31), letterSpacing: -0.3, color: JT.ink },
  subtitle: { fontFamily: JT_FONT.medium, fontSize: rf(16), color: JT.textSecondary, marginTop: rs(-6), lineHeight: rf(23) },
  fieldError: { fontSize: rf(13), color: Colors.red, lineHeight: rf(18) },
  loginHint: { marginTop: rs(8), alignItems: 'center' },
  loginHintTxt: { fontFamily: JT_FONT.medium, fontSize: rf(15), color: JT.ink, textAlign: 'center', marginTop: rs(4) },
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