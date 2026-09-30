// Проверка сайта: Юпитер дошёл до капчи и просит человека прочитать слово.
// Картинку отдаёт сервер (services/jupiterCaptcha.ts), ответ уходит туда же —
// вводит его на сайте сам Юпитер. Капчу не обходим: только человек.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import { JT, JT_FONT } from '@/constants/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { BackIcon } from '@/components/profile/edit/icons';
import { jupiterCaptchaAnswer, jupiterCaptchaGet, type JupiterCaptcha } from '@/services/jupiterCaptcha';

type Phase = 'loading' | 'ready' | 'sending' | 'sent' | 'expired';

function minutesLeft(expiresAt: string, now: number): number {
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 60000));
}

export default function JupiterCaptchaScreen() {
  useWarmSystemBar(true, JT.background);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, showToast } = useApp();
  const [captcha, setCaptcha] = useState<JupiterCaptcha | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [answer, setAnswer] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!currentUser?.id || !id) return;
    setPhase('loading');
    try {
      const c = await jupiterCaptchaGet(currentUser.id, id);
      setCaptcha(c);
      setAnswer('');
      setNow(Date.now());
      setPhase(c && new Date(c.expiresAt).getTime() > Date.now() ? 'ready' : 'expired');
    } catch (e: any) {
      showToast(e?.message || 'Не удалось загрузить картинку', 'error');
      setPhase('expired');
    }
  }, [currentUser?.id, id, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Раз в 15 секунд сверяем срок: точность до минуты не нужна.
  useEffect(() => {
    if (!captcha || (phase !== 'ready' && phase !== 'sending')) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (new Date(captcha.expiresAt).getTime() <= n) setPhase(p => (p === 'ready' ? 'expired' : p));
    }, 15000);
    return () => clearInterval(t);
  }, [captcha, phase]);

  const submit = async () => {
    const text = answer.trim();
    if (!captcha || !currentUser?.id || !id || !text || phase !== 'ready') return;
    setPhase('sending');
    try {
      await jupiterCaptchaAnswer(currentUser.id, id, text);
      setPhase('sent');
    } catch (e: any) {
      showToast(e?.message || 'Не удалось отправить слово', 'error');
      setPhase('ready');
    }
  };

  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/matches'); };
  // После ответа — обратно к заявке: replace, чтобы «назад» с карточки не
  // возвращал на отправленную капчу.
  const toApplication = useCallback(() => {
    if (!id) { router.replace('/(tabs)/matches'); return; }
    router.replace({ pathname: '/jupiter-application', params: { id } });
  }, [id, router]);

  useEffect(() => {
    if (phase !== 'sent') return;
    const t = setTimeout(toApplication, 2000);
    return () => clearTimeout(t);
  }, [phase, toApplication]);
  const company = captcha?.company?.trim() || 'Карьерный сайт';
  const left = captcha ? minutesLeft(captcha.expiresAt, now) : 0;
  const busy = phase === 'loading' || phase === 'sending';

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity
          style={s.back}
          onPress={goBack}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          testID="back-button"
        >
          <BackIcon />
        </TouchableOpacity>
        <Text style={s.headerTitle} pointerEvents="none">Проверка сайта</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <HardShadowBox offset={5} radius={24}>
            <View style={s.card}>
              <Text style={s.company} numberOfLines={2}>{company}</Text>

              {phase === 'sent' ? (
                <View style={s.stateBox}>
                  <ActivityIndicator color={JT.accent} />
                  <Text style={s.stateTxt}>Юпитер вводит слово на сайте…</Text>
                  <TouchableOpacity style={s.secondaryBtn} onPress={toApplication} activeOpacity={0.85} accessibilityRole="button">
                    <Text style={s.secondaryTxt}>К отклику</Text>
                  </TouchableOpacity>
                </View>
              ) : phase === 'expired' ? (
                <View style={s.stateBox}>
                  <Text style={s.stateTxt}>Время вышло — откройте отклик снова</Text>
                  <TouchableOpacity style={s.secondaryBtn} onPress={goBack} activeOpacity={0.85} accessibilityRole="button">
                    <Text style={s.secondaryTxt}>К откликам</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={s.hint}>Сайт просит подтвердить, что вы человек. Введите слово с картинки.</Text>
                  <View style={s.imageBox}>
                    {captcha && phase !== 'loading' ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${captcha.imagePng}` }}
                        style={s.image}
                        resizeMode="contain"
                        accessibilityLabel="Картинка с проверочным словом"
                      />
                    ) : <ActivityIndicator color={JT.accent} />}
                  </View>
                  <TextInput
                    style={s.input}
                    value={answer}
                    onChangeText={setAnswer}
                    placeholder="Слово с картинки"
                    placeholderTextColor={JT.textTertiary}
                    autoFocus
                    autoCorrect={false}
                    autoCapitalize="none"
                    spellCheck={false}
                    editable={!busy}
                    returnKeyType="send"
                    onSubmitEditing={() => void submit()}
                    accessibilityLabel="Слово с картинки"
                  />
                  {phase === 'ready' || phase === 'sending' ? (
                    <Text style={s.timer}>Осталось {left} мин</Text>
                  ) : null}
                  <HardShadowBox style={s.primaryWrap} offset={4} radius={29}>
                    <TouchableOpacity
                      style={[s.primaryBtn, (busy || !answer.trim()) && { opacity: 0.6 }]}
                      onPress={() => void submit()}
                      disabled={busy || !answer.trim()}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                    >
                      {phase === 'sending' ? <ActivityIndicator color={JT.ink} /> : <Text style={s.primaryTxt}>Отправить</Text>}
                    </TouchableOpacity>
                  </HardShadowBox>
                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={() => void load()}
                    disabled={busy}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                  >
                    <Text style={s.secondaryTxt}>Обновить картинку</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </HardShadowBox>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  header: {
    height: 44, marginTop: 12, marginHorizontal: 20, justifyContent: 'center', alignItems: 'flex-start',
  },
  back: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  headerTitle: {
    position: 'absolute', left: 0, right: 0, textAlign: 'center',
    fontFamily: JT_FONT.head, fontSize: 18, color: JT.ink,
  },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 },
  card: {
    padding: 20, borderRadius: 24, backgroundColor: JT.surface, borderWidth: 2, borderColor: JT.ink,
  },
  company: { fontFamily: JT_FONT.head, fontSize: 20, lineHeight: 26, color: JT.ink, textAlign: 'center' },
  hint: {
    marginTop: 10, fontFamily: JT_FONT.bold, fontSize: 14, lineHeight: 20, color: JT.textSecondary, textAlign: 'center',
  },
  imageBox: {
    marginTop: 16, height: 120, borderRadius: 16, borderWidth: 2, borderColor: JT.borderSoft,
    backgroundColor: JT.background, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  input: {
    marginTop: 16, height: 54, borderRadius: 16, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    paddingHorizontal: 16, fontFamily: JT_FONT.bold, fontSize: 18, color: JT.ink,
  },
  timer: { marginTop: 10, fontFamily: JT_FONT.medium, fontSize: 13, color: JT.textTertiary, textAlign: 'center' },
  primaryWrap: { marginTop: 16, alignSelf: 'stretch' },
  primaryBtn: {
    height: 58, borderRadius: 29, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryTxt: { fontFamily: JT_FONT.heavy, fontSize: 17, color: JT.ink },
  secondaryBtn: {
    marginTop: 18, alignSelf: 'stretch', height: 54, borderRadius: 27, borderWidth: 2, borderColor: JT.ink,
    backgroundColor: JT.surface, alignItems: 'center', justifyContent: 'center',
  },
  secondaryTxt: { fontFamily: JT_FONT.heavy, fontSize: 16, color: JT.ink },
  stateBox: { marginTop: 20, gap: 14, alignItems: 'center' },
  stateTxt: { fontFamily: JT_FONT.bold, fontSize: 16, lineHeight: 22, color: JT.ink, textAlign: 'center' },
});
