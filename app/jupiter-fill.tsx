// Путь отклика «Ждут вас»: заявка, которую сервер сам отправить не может
// (капча, SPA, сайт ещё не в списке проверенных). Страница вакансии
// открывается во встроенном браузере на телефоне, и автопилот
// (services/jupiterAutopilot.ts) у человека на глазах открывает анкету,
// заполняет её, прикладывает резюме и ставит разрешённые поручением галочки.
// Отправляет человек сам — кнопкой «Отправить отклик»; проверку «я не робот»
// тоже проходит он. Решение владельца 27.09.2026: без скрытой отправки.
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
import { fillHostFor, jupiterManualEligible, nextManualApplication } from '@/services/jupiterFill';
import {
  buildAutopilotScript, rerunAutopilotScript, SUBMIT_BY_USER_SCRIPT, type AutopilotResult,
} from '@/services/jupiterAutopilot';

import { rs, rf } from '@/constants/scale';
import { BackButton } from '@/components/ui/BackButton';

type FillStatus =
  | 'loading' | 'filling' | 'ready' | 'captcha' | 'missing' | 'consent'
  | 'no_form' | 'no_submit' | 'submitting' | 'unknown' | 'error';

// Резюме больше 8 МБ в анкету не вкладываем: base64 внутри скрипта страницы
// раздуется ещё на треть, а сайты такие файлы всё равно не принимают.
const RESUME_LIMIT = 8 * 1024 * 1024;

/** Скачать своё резюме и отдать base64 без префикса data:…;base64,. */
async function loadResumeBase64(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.size || blob.size > RESUME_LIMIT) return null;
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? null : dataUrl.slice(comma + 1);
}

function statusText(status: FillStatus, result: AutopilotResult | null): string {
  const missing = result?.missing?.length ? ` Не хватает: ${result.missing.slice(0, 3).join('; ')}.` : '';
  switch (status) {
    case 'loading': return 'Открываем анкету…';
    case 'filling': return 'Юпитер заполняет анкету данными из вашего профиля…';
    case 'ready': return `Анкета заполнена${result?.resume ? ', резюме приложено' : ''}. Проверьте и нажмите «Отправить отклик».`;
    case 'captcha': return 'Анкета заполнена. Остался один шаг: подтвердите на странице, что вы не робот, и нажмите «Отправить отклик».';
    case 'missing': return `Заполните на странице то, чего нет в профиле, и нажмите «Отправить отклик».${missing}`;
    case 'consent': return 'Сайт просит согласие, которое вместе с обязательным включает рекламу или что-то ещё. Решите сами на странице, затем «Отправить отклик».';
    case 'no_form': return 'Анкету не нашли. Нажмите «Откликнуться» на странице — Юпитер заполнит её.';
    case 'no_submit': return 'Не нашли кнопку отправки. Нажмите «Отправить» на самой странице, затем «Я отправил».';
    case 'submitting': return 'Отправляем и ждём подтверждения от сайта…';
    case 'unknown': return 'Сайт не показал подтверждения. Если на странице видно «спасибо» — нажмите «Я отправил».';
    default: return 'Не удалось заполнить анкету автоматически. Заполните её на странице и нажмите «Отправить» на сайте.';
  }
}

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
  const [delegated, setDelegated] = useState(false);
  const [resume, setResume] = useState<{ b64: string; name: string } | null>(null);
  const [status, setStatus] = useState<FillStatus>('loading');
  const [result, setResult] = useState<AutopilotResult | null>(null);
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
        // Резюме — своё, по короткой подписанной ссылке. Не скачалось — анкета
        // всё равно заполняется, файл человек приложит на странице сам.
        let file: { b64: string; name: string } | null = null;
        if (p?.resume_url) {
          try {
            const b64 = await loadResumeBase64(p.resume_url);
            if (b64) file = { b64, name: p.resume_name || 'resume.pdf' };
          } catch { /* без резюме */ }
        }
        if (!cancelled) {
          setResume(file);
          // Согласия от имени человека — только если поручение записано в
          // заявке (Соглашение п. 8.2); иначе галочки ставит он сам.
          setDelegated(!!own.thirdPartyConsentAt);
          setStatus('filling');
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
    if (router.canGoBack()) router.back();
  }, [url, router, showToast]);

  const fillHost = url ? fillHostFor(url) : null;
  const fillScript = useMemo(() => {
    if (!profile || !fillHost) return null;
    // Ссылка на резюме в страницу работодателя не уходит — только содержимое.
    const { resume_url: _u, resume_name: _n, ...values } = profile;
    return buildAutopilotScript(values as JupiterFillProfile, fillHost, {
      submit: false, delegated, resumeBase64: resume?.b64 ?? null, resumeName: resume?.name ?? null, deadlineMs: 45000,
    });
  }, [profile, fillHost, delegated, resume]);

  const refill = () => {
    if (!fillScript || !webRef.current) return;
    setStatus('filling');
    webRef.current.injectJavaScript(rerunAutopilotScript(fillScript));
  };

  // «Отправить отклик» — нажатие человека; скрипт лишь передаёт его на кнопку
  // отправки анкеты на сайте и ждёт подтверждения.
  const sendApplication = () => {
    if (!webRef.current || status === 'submitting') return;
    setStatus('submitting');
    webRef.current.injectJavaScript(SUBMIT_BY_USER_SCRIPT);
  };

  const onAutopilot = (msg: AutopilotResult) => {
    setResult(msg);
    if (msg.outcome === 'submitted') { void onSubmitted(); return; }
    if (msg.outcome === 'ready') { setStatus('ready'); return; }
    if (msg.outcome === 'needs_user') {
      const map: Record<string, FillStatus> = { captcha: 'captcha', missing: 'missing', consent: 'consent', no_submit: 'no_submit' };
      setStatus(map[msg.reason] ?? 'missing');
      return;
    }
    if (msg.outcome === 'no_form') { setStatus('no_form'); return; }
    if (msg.outcome === 'unknown') { setStatus('unknown'); return; }
    setStatus('error');
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

  // На вебе анкета открывается на сайте компании в новой вкладке. Здесь —
  // только выход: без него страница, открытая по прямой ссылке, оставалась
  // пустой и без единой кнопки.
  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <View style={s.header}><BackButton fallback="/(tabs)/matches" /></View>
        <Text style={s.webNote}>
          {error ? 'Не удалось открыть анкету. Попробуйте ещё раз из раздела «Отклики».'
            : 'Анкета компании открывается в новой вкладке браузера.'}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <BackButton />
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
        <Text style={s.noticeTxt}>{statusText(status, result)}</Text>
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
              if (data?.type === 'jt-autopilot' && typeof data.outcome === 'string') onAutopilot(data as AutopilotResult);
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
          style={[s.primaryBtn, (submitting || status === 'submitting' || status === 'loading') && { opacity: 0.6 }]}
          onPress={sendApplication}
          disabled={submitting || status === 'submitting' || status === 'loading' || !fillScript}
          activeOpacity={0.85}
        >
          {submitting || status === 'submitting'
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Text style={s.primaryBtnTxt}>Отправить отклик</Text>}
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={s.manualLink} onPress={onSubmitted} disabled={submitting} hitSlop={8}>
        <Text style={s.manualLinkTxt}>Я уже отправил на сайте</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(12), paddingVertical: rs(10),
  },
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
  manualLink: { alignItems: 'center', paddingBottom: rs(14), backgroundColor: Colors.bg },
  manualLinkTxt: { fontSize: rf(13), color: Colors.textSecondary, textDecorationLine: 'underline' },
  webNote: { padding: rs(24), fontSize: rf(15), lineHeight: rf(21), color: Colors.textSecondary, textAlign: 'center' },
});
