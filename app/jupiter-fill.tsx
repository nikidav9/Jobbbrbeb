// Ручной путь отклика «Ждут вас»: заявка, которую сервер сам отправить не
// может (капча, SPA, сайт ещё не в списке проверенных). Мы открываем страницу
// вакансии во встроенном браузере и заполняем анкету данными профиля —
// прикрепляет резюме, проходит капчу и жмёт «Отправить» на сайте человек сам.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import {
  jupiterFillProfile, jupiterMarkManualSubmitted, jupiterMyApplications, JupiterFillProfile,
} from '@/services/db';
import type { JupiterApplication } from '@/constants/types';
import {
  buildFillScript, fillHostFor, jupiterManualEligible, nextManualApplication,
} from '@/services/jupiterFill';

import { rs, rf } from '@/constants/scale';

export default function JupiterFillScreen() {
  const router = useRouter();
  // Адрес вакансии берём из собственной заявки человека на сервере, а не из
  // параметра маршрута: ссылку на экран можно подделать, и тогда данные
  // профиля ушли бы на чужую страницу.
  const { id, company, skip } = useLocalSearchParams<{ id: string; company?: string; skip?: string }>();
  // Очередь «Ждут вас»: после отправки или пропуска сразу открываем
  // следующую анкету, а не возвращаем человека в список. Пропущенные в этом
  // заходе едут в параметре, чтобы «Пропустить» не ходило по кругу.
  const skipped = useMemo(() => (skip ? skip.split(',').filter(Boolean) : []), [skip]);
  const [url, setUrl] = useState<string | null>(null);
  const [next, setNext] = useState<JupiterApplication | null>(null);
  const [queueLeft, setQueueLeft] = useState(0);
  const { currentUser, showToast } = useApp();

  const [profile, setProfile] = useState<JupiterFillProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filledCount, setFilledCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser?.id || !id) return;
      setLoading(true);
      setError(false);
      try {
        const [p, apps] = await Promise.all([
          jupiterFillProfile(currentUser.id),
          jupiterMyApplications(currentUser.id),
        ]);
        const own = apps.find(app => app.id === id);
        if (!own || !fillHostFor(own.vacancyUrl)) throw new Error('Заявка не найдена');
        if (!cancelled) {
          setProfile(p);
          setUrl(own.vacancyUrl);
          setNext(nextManualApplication(apps, id, skipped));
          setQueueLeft(apps.filter(a => a.id !== id && !skipped.includes(a.id)
            && jupiterManualEligible(a) && fillHostFor(a.vacancyUrl) !== null).length);
        }
      } catch (e) {
        console.warn('[jupiterFillProfile]', e);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id, id, skipped]);

  // На вебе встроенного браузера нет: сразу открываем вакансию в новой вкладке
  // и возвращаемся назад — заполнять там нечего, а WebView react-native-web
  // не рисует чужие сайты внутри iframe (запрет самого сайта).
  useEffect(() => {
    if (Platform.OS !== 'web' || !url) return;
    Linking.openURL(url).catch(() => showToast('Не удалось открыть сайт компании', 'error'));
    router.back();
  }, [url, router, showToast]);

  const fillHost = url ? fillHostFor(url) : null;
  const fillScript = profile && fillHost ? buildFillScript(profile, fillHost) : null;

  const refill = () => {
    if (!fillScript || !webRef.current) return;
    webRef.current.injectJavaScript(fillScript);
  };

  const goNext = () => {
    if (!next || !id) { router.back(); return; }
    router.replace({
      pathname: '/jupiter-fill',
      params: { id: next.id, company: next.company ?? '', skip: [...skipped, id].join(',') },
    });
  };

  const onSubmitted = async () => {
    if (!currentUser?.id || !id || submitting) return;
    setSubmitting(true);
    try {
      await jupiterMarkManualSubmitted(currentUser.id, id);
      showToast(next ? 'Отправлено. Следующая анкета' : 'Отправлено. Все анкеты разобраны', 'success');
      goNext();
    } catch (e: any) {
      showToast(e?.message || 'Не удалось отметить отклик отправленным', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (Platform.OS === 'web') {
    return <View style={{ flex: 1, backgroundColor: Colors.bg }} />;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={10} accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.headerTitle} numberOfLines={1}>{company || 'Отклик на вакансию'}</Text>
          {queueLeft > 0 ? <Text style={s.headerSub}>Ещё {queueLeft} в очереди</Text> : null}
        </View>
        {next ? (
          <TouchableOpacity onPress={goNext} hitSlop={10} accessibilityLabel="Пропустить вакансию">
            <Text style={s.skipTxt}>Пропустить</Text>
          </TouchableOpacity>
        ) : <View style={{ width: rs(24) }} />}
      </View>

      <View style={s.notice}>
        <Ionicons name="information-circle" size={18} color={Colors.primary} />
        <Text style={s.noticeTxt}>
          Мы заполнили анкету из вашего профиля. Проверьте поля, прикрепите резюме, если сайт просит,
          пройдите проверку «я не робот» и нажмите «Отправить» на сайте.
          {filledCount > 0 ? ` Заполнено полей: ${filledCount}.` : ''}
        </Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error || !url ? (
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.textMuted} />
          <Text style={s.errorTxt}>Не удалось загрузить данные профиля для заполнения анкеты.</Text>
          {url ? (
            <TouchableOpacity
              style={s.openBtn}
              onPress={() => Linking.openURL(url).catch(() => showToast('Не удалось открыть сайт компании', 'error'))}
            >
              <Text style={s.openBtnTxt}>Открыть в браузере</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: url }}
          injectedJavaScript={fillScript ?? undefined}
          onMessage={(e) => {
            try {
              const data = JSON.parse(e.nativeEvent.data);
              if (data?.type === 'jt-filled' && typeof data.count === 'number') setFilledCount(data.count);
            } catch { /* сообщение не наше — игнорируем */ }
          }}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
          )}
          style={{ flex: 1 }}
        />
      )}

      <View style={s.footer}>
        <TouchableOpacity style={s.secondaryBtn} onPress={refill} disabled={!fillScript} activeOpacity={0.8}>
          <Text style={s.secondaryBtnTxt}>Заполнить ещё раз</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.primaryBtn, submitting && { opacity: 0.6 }]}
          onPress={onSubmitted}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.primaryBtnTxt}>Я отправил отклик</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(12), paddingVertical: rs(10),
  },
  backBtn: { padding: rs(4) },
  headerMid: { flex: 1, alignItems: 'center' },
  headerTitle: { textAlign: 'center', fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: rf(12), color: Colors.textSecondary, marginTop: rs(2) },
  skipTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.primary },
  notice: {
    flexDirection: 'row', gap: rs(8), alignItems: 'flex-start',
    marginHorizontal: rs(16), marginBottom: rs(10),
    backgroundColor: Colors.primaryLight, borderRadius: Radius.md, padding: rs(12),
  },
  noticeTxt: { flex: 1, fontSize: rf(13), lineHeight: rf(18), color: Colors.textPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: rs(12), paddingHorizontal: rs(24) },
  errorTxt: { fontSize: rf(14), color: Colors.textSecondary, textAlign: 'center' },
  openBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: rs(20), paddingVertical: rs(12) },
  openBtnTxt: { color: '#FFFFFF', fontWeight: '700', fontSize: rf(14) },
  footer: {
    flexDirection: 'row', gap: rs(10), padding: rs(16),
    borderTopWidth: 1, borderTopColor: Colors.divider, backgroundColor: Colors.bg,
  },
  secondaryBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.inputBorder, paddingVertical: rs(13),
  },
  secondaryBtnTxt: { color: Colors.textPrimary, fontWeight: '700', fontSize: rf(14) },
  primaryBtn: {
    flex: 1.4, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, backgroundColor: Colors.primary, paddingVertical: rs(13), ...Shadow.card,
  },
  primaryBtnTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: rf(14) },
});
