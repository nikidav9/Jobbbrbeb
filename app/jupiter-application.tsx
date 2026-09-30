// Карточка отклика Юпитера: статус, действие и история шагов — как у Sorce.
//
// Сюда ведёт строка отклика в «Откликах». Шаги пишет триггер базы
// (миграция 111, jm_jupiter_events), экран их только показывает. Согласие для
// Сбера и повторная постановка в очередь после включения автоотклика —
// действия этого экрана (перенесены сюда из строки списка, где раньше были
// кнопками под строкой).
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { JupiterApplication } from '@/constants/types';
import { useApp } from '@/hooks/useApp';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import {
  jupiterApplicationEvents, jupiterMyApplications, jupiterGrantThirdPartyConsent,
  jupiterRequeueLive, dbGetResumeFiles, jupiterMarkManualSubmitted, jupiterFillProfile, jupiterLiveState,
} from '@/services/db';
import { requestJupiterLive } from '@/services/jupiterLive';
import { confirmAsync } from '@/services/confirm';
import { jupiterManualEligible } from '@/services/jupiterFill';
import {
  buildTimeline, jupiterBadge, jupiterNeedsCaptcha, jupiterNeedsSberConsent, jupiterRowSummary, jupiterStatus, jupiterVacancyClosed,
  TimelineStep,
} from '@/services/jupiterTimeline';
import { getInitials, nameColorFromString } from '@/services/storage';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { companyLogo } from '@/constants/companyLogos';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { BackIcon, CloseIcon } from '@/components/profile/edit/icons';
import {
  CheckMarkIcon, ClockIcon, ExternalLinkIcon, HandIcon, LockIcon, SendIcon, ShieldCheckIcon,
} from '@/components/response/icons';

const SBER_TERMS_URL = 'https://rabota.sber.ru/terms';

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');
}

const MONTHS = ['янв.', 'февр.', 'марта', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

// «27 сент., 12:01» — как в макете; toLocaleString у разных движков даёт «в» и другие сокращения.
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const C = EditColors;
const F = EditFonts;

/** Ссылка с оранжевым подчёркиванием 2 px — из макета (textDecorationColor есть не везде, поэтому рамка). */
function UnderlinedLink({ children, onPress, label, color = C.ink, underline = C.accent, trailing, style }: {
  children: string; onPress: () => void; label: string; color?: string; underline?: string;
  trailing?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="link" accessibilityLabel={label} style={style}>
      <View style={s.linkRow}>
        <View style={{ borderBottomWidth: 2, borderBottomColor: underline, paddingBottom: 1, flexShrink: 1 }}>
          <Text style={[s.linkTxt, { color }]} numberOfLines={1}>{children}</Text>
        </View>
        {trailing}
      </View>
    </TouchableOpacity>
  );
}

/** Главная оранжевая кнопка с жёсткой тенью 4/4. */
function PrimaryButton({ label, onPress, arrow }: { label: string; onPress: () => void; arrow?: boolean }) {
  return (
    <HardShadowBox style={s.primaryWrap} offset={4} radius={29}>
      <TouchableOpacity style={s.primaryBtn} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
        <Text style={s.primaryTxt}>{label}</Text>
        {arrow ? <ExternalLinkIcon size={18} /> : null}
      </TouchableOpacity>
    </HardShadowBox>
  );
}

type Row = {
  key: string;
  circle: 'active' | 'hand' | 'clock' | 'check' | 'send' | 'fail' | 'dots' | 'lock';
  title: string;
  note?: string;
  at?: string;
  muted?: boolean;
};

function Circle({ kind }: { kind: Row['circle'] }) {
  switch (kind) {
    case 'active':
      return (
        <HardShadowBox offset={3} radius={20}>
          <View style={[s.dot, { backgroundColor: C.accent, borderWidth: 2, borderColor: C.ink }]}>
            <HandIcon size={19} strokeWidth={2.3} />
          </View>
        </HardShadowBox>
      );
    case 'hand':
      return <View style={[s.dot, { backgroundColor: C.surface, borderWidth: 2, borderColor: C.ink }]}><HandIcon size={19} strokeWidth={2.3} /></View>;
    case 'clock':
      return <View style={[s.dot, { backgroundColor: C.accentSoft }]}><ClockIcon /></View>;
    case 'check':
      return <View style={[s.dot, { backgroundColor: C.ink }]}><CheckMarkIcon color={C.accent} /></View>;
    case 'send':
      return <View style={[s.dot, { backgroundColor: C.ink }]}><SendIcon color={C.accent} /></View>;
    case 'fail':
      return <View style={[s.dot, { backgroundColor: C.surface, borderWidth: 2, borderColor: C.danger }]}><CloseIcon size={18} color={C.danger} /></View>;
    case 'lock':
      return <View style={[s.dot, s.dotDashed]}><LockIcon size={18} color={C.textTertiary} strokeWidth={2.3} /></View>;
    default:
      return (
        <View style={[s.dot, s.dotDashed, { flexDirection: 'row', gap: 3 }]}>
          {[0, 1, 2].map(n => <View key={n} style={s.miniDot} />)}
        </View>
      );
  }
}

function circleFor(kind: TimelineStep['kind'], active: boolean): Row['circle'] {
  switch (kind) {
    case 'action_required':
    case 'ready_to_submit': return active ? 'active' : 'hand';
    case 'queued': case 'submission_unknown': case 'retryable_failed': case 'duplicate': return 'clock';
    case 'submitted': return 'send';
    case 'failed': return 'fail';
    default: return 'check';
  }
}

export default function JupiterApplicationScreen() {
  useWarmSystemBar(true, EditColors.bg);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser, showToast } = useApp();
  const [app, setApp] = useState<JupiterApplication | null>(null);
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [serverSends, setServerSends] = useState(false);

  const load = useCallback(async () => {
    if (!currentUser?.id || !id) return;
    try {
      const [apps, events, live] = await Promise.all([
        jupiterMyApplications(currentUser.id),
        jupiterApplicationEvents(currentUser.id, id),
        // Не знаем — значит, кнопки «Попробовать ещё раз» нет; карточке это не мешает.
        jupiterLiveState(currentUser.id).catch(() => null),
      ]);
      const own = apps.find(a => a.id === id) ?? null;
      setApp(own);
      setServerSends(live?.serverSends === true);
      setSteps(buildTimeline(events));
      setError(own ? '' : 'Отклик не найден');
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить отклик');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, id]);

  useEffect(() => { load(); }, [load]);

  const company = app?.company?.trim() || 'Карьерный сайт';
  const vacancyTitle = app?.vacancyTitle?.trim() || '';
  const status = app ? jupiterStatus(app) : null;
  const waiting = app?.state === 'submitted';
  // Работодатель закрыл вакансию, отклик не ушёл: отправлять некуда — ни
  // анкеты, ни Юпитера, ни согласия Сбера (решение владельца 26.09).
  const closed = !!app && jupiterVacancyClosed(app);
  // Браузер Юпитера держит анкету открытой и ждёт слово с картинки: главное
  // действие — ввести его. Ручную анкету рядом не предлагаем, чтобы человек
  // не отправил отклик второй раз параллельно с Юпитером.
  const needsCaptcha = !!app && !closed && jupiterNeedsCaptcha(app);
  const canFill = !!app && !needsCaptcha && jupiterManualEligible(app);
  const needsSberConsent = !!app && !closed && jupiterNeedsSberConsent(app);
  // Автоотклик был выключен, когда заявка встала в очередь (или его отозвали
  // именно для неё) — пока человек не включит его заново, Юпитер к заявке не
  // вернётся.
  const needsRequeue = !!app && !closed && (
    (app.state === 'ready_to_submit' && !app.submissionAuthorizedAt)
    || (app.state === 'action_required' && app.reasonCode === 'LIVE_AUTHORIZATION_REVOKED')
  );
  // Честные исходы (решение владельца 01.10.2026). «Скорее всего, ушёл»: заявка
  // ушла на сайт, но он промолчал — повторять вслепую нельзя, человек может
  // проверить на сайте и отметить сам. «Не ушёл»: Юпитер споткнулся до
  // отправки — повтор безопасен, если Юпитер отправляет с сервера.
  const unknown = !!app && !closed && app.state === 'submission_unknown';
  const canRetry = !!app && !closed && app.state === 'failed' && serverSends;
  const canSelfMark = !!app && !closed && (canFill || unknown);

  const openSite = () => {
    if (!app) return;
    Linking.openURL(app.vacancyUrl).catch(() => showToast('Не удалось открыть сайт компании', 'error'));
  };
  const openForm = () => {
    if (!app) return;
    // На вебе встроенного браузера нет — там анкета открывается на сайте.
    if (Platform.OS === 'web') { openSite(); return; }
    router.push({ pathname: '/jupiter-fill', params: { id: app.id, company } });
  };
  const openCaptcha = () => {
    if (!app) return;
    router.push({ pathname: '/jupiter-captcha', params: { id: app.id } });
  };
  const openSberTerms = () => {
    Linking.openURL(app?.thirdPartyTermsUrl || SBER_TERMS_URL)
      .catch(() => showToast('Не удалось открыть условия Сбера', 'error'));
  };
  // Условия и политика работодателя — в каждой карточке (Соглашение п. 8.4).
  // Точный адрес знаем не для всех сайтов; иначе — сам сайт работодателя.
  const openEmployerTerms = () => {
    if (!app) return;
    let url = app.thirdPartyTermsUrl || '';
    if (!url) {
      try { url = new URL(app.vacancyUrl).origin; } catch { url = app.vacancyUrl; }
    }
    Linking.openURL(url).catch(() => showToast('Не удалось открыть сайт работодателя', 'error'));
  };
  // Перенесено из matches.tsx без изменения поведения: те же вызовы, та же
  // проверка резюме и тот же текст согласия.
  const grantSberConsent = async () => {
    if (!app || !currentUser?.id) return;
    const message = 'Сбер просит согласие на обработку персональных данных. Если продолжить, JobToo передаст Сберу имя, фамилию, телефон, ваш адрес JobToo и выбранное PDF-резюме только для этой вакансии.';
    // confirmAsync: на вебе Alert.alert — пустышка, кнопка выглядела бы мёртвой.
    const approved = await confirmAsync({
      title: 'Согласие для отклика в Сбер', body: message, confirmLabel: 'Согласен и отправить',
    });
    if (!approved) return;
    try {
      await jupiterGrantThirdPartyConsent(currentUser.id, app.id, SBER_TERMS_URL);
      showToast('Согласие сохранено. Юпитер отправляет отклик в Сбер', 'success');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Не удалось запустить отклик в Сбер', 'error');
    }
  };
  const requeueLive = async () => {
    if (!app || !currentUser?.id) return;
    try {
      const resumes = await dbGetResumeFiles();
      if (!resumes.some(file => file.selected && file.storagePath)) {
        showToast('Сначала загрузите PDF-резюме в профиле', 'error');
        router.push({ pathname: '/(tabs)/profile', params: { tab: 'files' } });
        return;
      }
      if (!await requestJupiterLive(currentUser.id)) return;
      await jupiterRequeueLive(currentUser.id, app.id);
      showToast('Юпитер повторно откроет анкету и отправит отклик', 'success');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Не удалось поставить отклик в очередь', 'error');
    }
  };

  const markSentMyself = async () => {
    if (!app || !currentUser?.id) return;
    const ok = await confirmAsync({
      title: 'Вы отправили отклик сами?',
      body: 'Отметим отклик как «Отправлено вами». Юпитер к нему больше не вернётся.',
      confirmLabel: 'Да, отправил',
    });
    if (!ok) return;
    try {
      await jupiterMarkManualSubmitted(currentUser.id, app.id);
      showToast('Отклик отмечен отправленным', 'success');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Не удалось отметить отклик', 'error');
    }
  };
  const retry = async () => {
    if (!app || !currentUser?.id) return;
    try {
      await jupiterRequeueLive(currentUser.id, app.id);
      showToast('Юпитер попробует отправить ещё раз', 'success');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'Не удалось повторить отклик', 'error');
    }
  };
  // Сайт открыт без автопилота (веб и PWA): свои данные — одной кнопкой в буфер,
  // вставить в анкету. Только то, что человек и так вписал бы сам.
  const copyMyData = async () => {
    if (!currentUser?.id) return;
    try {
      const p = await jupiterFillProfile(currentUser.id);
      const lines = [
        p.full_name && `ФИО: ${p.full_name}`,
        p.phone && `Телефон: ${p.phone}`,
        p.email && `Почта: ${p.email}`,
        p.city && `Город: ${p.city}`,
        p.desired_role && `Должность: ${p.desired_role}`,
      ].filter(Boolean);
      if (!lines.length) { showToast('В профиле пока пусто — заполните его', 'error'); return; }
      await Clipboard.setStringAsync(lines.join('\n'));
      showToast('Данные скопированы — вставьте в анкету', 'success');
    } catch (error: any) {
      showToast(error?.message || 'Не удалось скопировать данные', 'error');
    }
  };

  const badge = app ? jupiterBadge(app) : null;
  const needsAction = canFill || needsRequeue || needsSberConsent || needsCaptcha || unknown;
  const summary = app ? jupiterRowSummary(app) : '';
  const manualSent = app?.state === 'submitted' && app.reasonCode === 'MANUAL_WEBVIEW';

  // Бейдж по тону jupiterBadge: три состояния из макета плюс «в работе» и «не получилось».
  const badgeView = (() => {
    if (!badge) return null;
    switch (badge.tone) {
      case 'needs_you':
        return {
          label: needsCaptcha ? 'Нужна проверка сайта' : 'Нужны вы · отклик сохранён',
          box: s.badgeNeeds, color: C.ink, icon: <HandIcon />,
        };
      case 'sent':
        return {
          label: manualSent ? 'Отправлено вами' : 'Отправлено', box: s.badgeSent, color: '#FFFFFF',
          icon: <CheckMarkIcon size={14} color={C.accent} strokeWidth={3.4} />,
        };
      case 'closed':
        return { label: 'Вакансия закрыта работодателем', box: s.badgeClosed, color: C.label, icon: <LockIcon color={C.label} /> };
      case 'failed':
        return { label: 'Не ушёл', box: s.badgeFailed, color: C.danger, icon: null };
      default:
        return { label: status?.label || 'Юпитер обрабатывает', box: s.badgeWorking, color: C.ink, icon: <ClockIcon size={15} strokeWidth={2.4} /> };
    }
  })();
  // Пояснение — как в макете: у «Отправлено» и «Закрыта» под бейджем текста нет.
  const showSummary = !!badge && badge.tone !== 'sent' && badge.tone !== 'closed';

  const rows: Row[] = [];
  if (closed) {
    rows.push({ key: 'closed', circle: 'lock', title: 'Работодатель закрыл вакансию', muted: true,
      note: 'Отклик не отправлен — отправлять его уже некуда' });
  }
  if (waiting) {
    rows.push({ key: 'waiting', circle: 'dots', title: 'Ждём ответа работодателя', muted: true,
      note: 'Ответ придёт в раздел «Почта»' });
  }
  steps.forEach((step, i) => {
    rows.push({
      key: `${step.at}-${i}`, circle: circleFor(step.kind, i === 0 && needsAction),
      title: step.title, note: step.note, at: step.at,
    });
  });

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      {/* Высоты у шапки нет: safe-area сверху даёт SafeAreaView, иначе они складывались и шапка наезжала. */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.back}
          onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/matches'); }}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel="Назад к откликам"
          testID="back-button"
        >
          <BackIcon />
        </TouchableOpacity>
        <Text style={s.headerTitle} pointerEvents="none">Отклик</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.accent} />
      ) : !app ? (
        <Text style={s.error}>{error || 'Отклик не найден'}</Text>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {/* Карточка вакансии: у закрытой — приглушённый контур без тени. */}
          <HardShadowBox offset={closed ? 0 : 5} radius={24} style={s.cardWrap}>
            <View style={[s.hero, closed && { borderColor: C.border }]}>
              <View style={closed ? { opacity: 0.5 } : undefined}>
                {companyLogo(company) ? <CompanyMark company={company} size={64} /> : (
                  <View style={[s.logo, { backgroundColor: nameColorFromString(company) }]}>
                    <Text style={s.logoTxt}>{getInitials(company)}</Text>
                  </View>
                )}
              </View>
              {vacancyTitle ? (
                <Text style={[s.vacancyTitle, closed && { color: C.label }]}>{vacancyTitle}</Text>
              ) : null}
              <Text style={vacancyTitle ? s.company : s.vacancyTitle} numberOfLines={2}>{company}</Text>
              {/* Отклик ждёт человека — сайт открываем во встроенном браузере с
                  автопилотом: во внешнем браузере анкету никто не заполнит, и
                  человек видел пустую форму (МТС, 30.09.2026). */}
              <UnderlinedLink
                onPress={canFill && Platform.OS !== 'web' ? openForm : openSite}
                label="Открыть сайт вакансии"
                color={closed ? C.label : C.ink}
                underline={closed ? C.border : C.accent}
                style={{ marginTop: 6 }}
                trailing={<ExternalLinkIcon color={closed ? C.label : C.ink} />}
              >
                {hostOf(app.vacancyUrl)}
              </UnderlinedLink>

              {badgeView ? (
                <View style={[s.badge, badgeView.box]}>
                  {badgeView.icon}
                  <Text style={[s.badgeTxt, { color: badgeView.color }]}>{badgeView.label}</Text>
                </View>
              ) : null}
              {showSummary ? <Text style={s.summary}>{summary}</Text> : null}

              {needsCaptcha ? <PrimaryButton label="Ввести слово с картинки" onPress={openCaptcha} /> : null}
              {canRetry ? <PrimaryButton label="Попробовать ещё раз" onPress={() => void retry()} /> : null}
              {canFill && !canRetry ? (
                <PrimaryButton
                  label={Platform.OS === 'web' ? 'Отправить самому на сайте' : 'Открыть анкету и отправить'}
                  onPress={openForm}
                  arrow
                />
              ) : null}
              {/* Рядом с «Попробовать ещё раз» — вторая, белая: одна главная кнопка на экран. */}
              {canFill && canRetry ? (
                <TouchableOpacity style={s.secondaryBtn} onPress={openForm} activeOpacity={0.85} accessibilityRole="button">
                  <Text style={s.secondaryTxt}>{Platform.OS === 'web' ? 'Отправить самому на сайте' : 'Открыть анкету и отправить'}</Text>
                </TouchableOpacity>
              ) : null}
              {unknown ? <PrimaryButton label="Открыть вакансию" onPress={openSite} arrow /> : null}
              {canSelfMark && Platform.OS === 'web' ? (
                <TouchableOpacity style={s.secondaryBtn} onPress={() => void copyMyData()} activeOpacity={0.85}
                  accessibilityRole="button">
                  <Text style={s.secondaryTxt}>Скопировать мои данные</Text>
                </TouchableOpacity>
              ) : null}
              {canFill && Platform.OS !== 'web' ? (
                <TouchableOpacity onPress={openSite} hitSlop={8} style={s.browserLink}
                  accessibilityRole="link" accessibilityLabel="Открыть в браузере телефона, без автозаполнения">
                  <Text style={s.browserLinkTxt}>Открыть в браузере телефона — без автозаполнения</Text>
                </TouchableOpacity>
              ) : null}
              {canSelfMark ? (
                <TouchableOpacity style={s.secondaryBtn} onPress={() => void markSentMyself()} activeOpacity={0.85}
                  accessibilityRole="button" testID="jupiter-mark-sent">
                  <Text style={s.secondaryTxt}>Я отправил сам</Text>
                </TouchableOpacity>
              ) : null}
              {needsRequeue ? <PrimaryButton label="Отправить через Юпитер" onPress={() => void requeueLive()} /> : null}
              {needsSberConsent ? (
                <>
                  <PrimaryButton label="Согласиться и отправить" onPress={() => void grantSberConsent()} />
                  <UnderlinedLink
                    onPress={openSberTerms}
                    label="Условия Сбера"
                    style={{ marginTop: 14 }}
                    trailing={<ExternalLinkIcon />}
                  >
                    Условия Сбера
                  </UnderlinedLink>
                </>
              ) : null}
              {closed ? (
                <TouchableOpacity
                  style={s.secondaryBtn}
                  onPress={() => router.push('/(tabs)/feed')}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Text style={s.secondaryTxt}>Смотреть похожие вакансии</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </HardShadowBox>

          <View style={s.delegation}>
            <View style={{ marginTop: 1 }}><ShieldCheckIcon /></View>
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={s.delegationTxt}>
                {app.thirdPartyConsentAt
                  ? `Согласия, без которых работодатель не принимает отклик, Юпитер дал от вашего имени ${when(app.thirdPartyConsentAt)} — по поручению из Пользовательского соглашения, п. 8.2. Рекламу, кадровый резерв и передачу третьим лицам Юпитер не отмечает никогда.`
                  : 'Анкету отправляете вы сами на сайте компании: согласия, которые она просит, отмечаете тоже вы. Рекламу, кадровый резерв и передачу третьим лицам автопилот не отмечает никогда.'}
              </Text>
              <UnderlinedLink
                onPress={openEmployerTerms}
                label="Условия и политика работодателя"
                style={{ alignSelf: 'flex-start' }}
              >
                Условия и политика работодателя ↗
              </UnderlinedLink>
            </View>
          </View>

          <Text style={s.historyTitle}>История отклика</Text>
          <View style={s.history}>
            {rows.length === 0 ? (
              <Text style={s.empty}>Истории пока нет — она появится со следующим шагом.</Text>
            ) : rows.map((row, i) => (
              <View key={row.key} style={s.step}>
                <View style={s.rail}>
                  <Circle kind={row.circle} />
                  {i < rows.length - 1 ? <View style={s.line} /> : null}
                </View>
                <View style={[s.stepBody, { paddingTop: row.note ? 2 : 9 }]}>
                  <Text style={[s.stepTitle, row.muted && { color: C.label }]}>{row.title}</Text>
                  {row.note ? <Text style={s.stepNote}>{row.note}</Text> : null}
                  {row.at ? <Text style={s.stepAt}>{when(row.at)}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  browserLink: { marginTop: 12, alignSelf: 'center' },
  browserLinkTxt: { fontFamily: F.text600, fontSize: 13, color: C.label, textDecorationLine: 'underline' },
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    height: 44, marginTop: 12, marginHorizontal: 20, justifyContent: 'center', alignItems: 'flex-start',
  },
  back: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.ink, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  headerTitle: {
    position: 'absolute', left: 0, right: 0, textAlign: 'center',
    fontFamily: F.heading, fontSize: 18, color: C.ink,
  },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 },
  error: { margin: 20, color: C.danger, textAlign: 'center', fontFamily: F.text700, fontSize: 15 },
  cardWrap: {},
  hero: {
    paddingTop: 24, paddingBottom: 20, paddingHorizontal: 18, borderRadius: 24, backgroundColor: C.surface,
    borderWidth: 2, borderColor: C.ink, alignItems: 'center',
  },
  logo: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  logoTxt: { color: '#FFFFFF', fontFamily: F.heading, fontSize: 26 },
  vacancyTitle: {
    marginTop: 16, fontFamily: F.heading, fontSize: 20, lineHeight: 25, color: C.ink, textAlign: 'center',
  },
  company: { marginTop: 6, fontFamily: F.text700, fontSize: 15, color: C.textTertiary, textAlign: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkTxt: { fontFamily: F.text800, fontSize: 14 },
  badge: {
    marginTop: 16, height: 32, paddingHorizontal: 14, borderRadius: 16, flexDirection: 'row',
    alignItems: 'center', gap: 6, maxWidth: '100%',
  },
  badgeTxt: { fontFamily: F.text800, fontSize: 13, flexShrink: 1 },
  badgeNeeds: { backgroundColor: C.accent, borderWidth: 2, borderColor: C.ink },
  badgeSent: { backgroundColor: C.ink },
  badgeClosed: { backgroundColor: '#EDE6DC', borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.placeholder },
  badgeWorking: { backgroundColor: C.accentSoft, borderWidth: 1.5, borderColor: C.ink },
  badgeFailed: { backgroundColor: C.surface, borderWidth: 2, borderColor: C.danger },
  summary: {
    marginTop: 14, fontFamily: F.text600, fontSize: 14, lineHeight: 20, color: C.label, textAlign: 'center',
  },
  primaryWrap: { marginTop: 16, alignSelf: 'stretch' },
  primaryBtn: {
    height: 58, borderRadius: 29, borderWidth: 2, borderColor: C.ink, backgroundColor: C.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20,
  },
  primaryTxt: { fontFamily: F.text800, fontSize: 17, color: C.ink, flexShrink: 1, textAlign: 'center' },
  secondaryBtn: {
    marginTop: 18, alignSelf: 'stretch', height: 54, borderRadius: 27, borderWidth: 2, borderColor: C.ink,
    backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center',
  },
  secondaryTxt: { fontFamily: F.text800, fontSize: 16, color: C.ink },
  delegation: {
    marginTop: 16, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, backgroundColor: C.surface,
    flexDirection: 'row', gap: 12,
  },
  delegationTxt: { fontFamily: F.text600, fontSize: 13, lineHeight: 19.5, color: C.label },
  historyTitle: { marginTop: 24, fontFamily: F.heading, fontSize: 15, color: C.ink },
  history: {
    marginTop: 12, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, borderRadius: 22,
    backgroundColor: C.surface,
  },
  empty: { fontFamily: F.text600, fontSize: 14, color: C.textTertiary, paddingBottom: 14 },
  step: { flexDirection: 'row', gap: 14 },
  rail: { width: 40, alignItems: 'center' },
  dot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dotDashed: { borderWidth: 2, borderStyle: 'dashed', borderColor: C.placeholder, backgroundColor: C.surface },
  miniDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.textTertiary },
  line: { width: 2, flexGrow: 1, minHeight: 14, marginVertical: 6, backgroundColor: C.borderSoft },
  stepBody: { flex: 1, paddingBottom: 18, gap: 3 },
  stepTitle: { fontFamily: F.text800, fontSize: 16, color: C.ink },
  stepNote: { fontFamily: F.text600, fontSize: 14, lineHeight: 19.6, color: C.label },
  stepAt: { fontFamily: F.text600, fontSize: 13, color: C.textTertiary },
});
