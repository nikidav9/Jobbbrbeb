import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Linking,
  AppState, ActivityIndicator,
} from 'react-native';
import Svg, { Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomSafe } from '@/lib/androidInsets';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import {
  dbGetUserById, dbUnbindTelegram, dbTgPrepareLink, dbGetConsent,
  dbGetCrossBorderConsent, dbRecordCrossBorderConsent,
} from '@/services/db';
import { LEGAL_DOCS, needsReconsent } from '@/constants/legal';
import { isTelegramMiniApp } from '@/lib/telegram';
import { setOnboardingTarget, registerOnboardingMeasurer } from '@/lib/onboardingTargets';

import { rs, rf } from '@/constants/scale';

const TG_BLUE = '#2AABEE';
const BOT_URL = 'https://t.me/JobToo_bot';

// Оригинальный логотип Telegram: градиентный круг + белый самолётик со сгибом
function TelegramLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="tgGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2AABEE" />
          <Stop offset="1" stopColor="#229ED9" />
        </LinearGradient>
      </Defs>
      <Circle cx="12" cy="12" r="12" fill="url(#tgGrad)" />
      <Path
        d="M5.45 11.9l11.2-4.32c.52-.19.98.12.81.9l-1.91 9c-.14.64-.52.8-1.05.5l-2.91-2.15-1.4 1.35c-.16.16-.29.29-.59.29l.21-2.98 5.42-4.9c.24-.21-.05-.33-.37-.12l-6.7 4.22-2.89-.9c-.63-.2-.64-.63.18-.89z"
        fill="#fff"
      />
      <Path d="M9.81 16.47l.21-2.98 1.3 1.63-1.51 1.35z" fill="#C8DAEA" />
    </Svg>
  );
}

// Постоянная кнопка в шапке: логотип Telegram → модалка подключения уведомлений.
// Не исчезает после подключения — через неё же можно отключить или открыть бота.
// size/pad подбираются под соседний колокольчик конкретной шапки.
export function TelegramConnectButton({ size = 24, pad = 6, onboardingAnchor = false }: { size?: number; pad?: number; onboardingAnchor?: boolean }) {
  const app = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = app?.currentUser?.id ?? null;
  const isEmployer = app?.currentUser?.role === 'employer';

  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(
    app?.currentUser?.telegramId ? true : null,
  );
  const [busy, setBusy] = useState(false);
  // Телеграм может не открыться — не установлен, запрещены переходы.
  // Молчать нельзя: человек жмёт кнопку и не понимает, живая она вообще или нет.
  const [failed, setFailed] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const [actionError, setActionError] = useState('');
  const [crossBorderAccepted, setCrossBorderAccepted] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const btnRef = useRef<View>(null);
  // Способ перемерить по требованию: первый замер при раскладке часто
  // приходит с нулями, и цель для подсветки не регистрируется вовсе.
  const measureAnchor = useCallback(() => {
    btnRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setOnboardingTarget('telegram', { x, y, w, h });
    });
  }, []);
  useEffect(() => {
    if (!onboardingAnchor) return;
    return registerOnboardingMeasurer('telegram', measureAnchor);
  }, [onboardingAnchor, measureAnchor]);
  const openRef = useRef(false);
  openRef.current = open;

  const refreshStatus = useCallback(async () => {
    if (!userId) return;
    setStatusFailed(false);
    try {
      const u = await dbGetUserById(userId);
      setLinked(!!u?.telegramId);
    } catch {
      // При первом открытии linked=null. Без отдельной ошибки модалка могла
      // крутить спиннер бесконечно и выдавать обрыв сети за «ещё грузимся».
      setStatusFailed(true);
    }
  }, [userId]);

  // Статус при появлении кнопки
  useEffect(() => {
    if (userId) refreshStatus();
  }, [userId, refreshStatus]);

  useEffect(() => {
    if (!userId) {
      setCrossBorderAccepted(false);
      return;
    }
    let alive = true;
    dbGetCrossBorderConsent(userId)
      .then(c => { if (alive) setCrossBorderAccepted(c?.accepted === true); })
      .catch(() => { if (alive) setCrossBorderAccepted(false); });
    return () => { alive = false; };
  }, [userId]);

  async function acceptCrossBorderConsent() {
    if (!userId || consentBusy || crossBorderAccepted) return;
    setConsentBusy(true);
    setActionError('');
    try {
      const current = await dbGetConsent(userId);
      if (!current || needsReconsent(current.stamp)) {
        setActionError('Сначала примите актуальные основные документы JobToo.');
        return;
      }
      await dbRecordCrossBorderConsent(
        userId,
        LEGAL_DOCS.crossBorderConsent.version,
        'crossborder:telegram',
      );
      const saved = await dbGetCrossBorderConsent(userId);
      if (saved?.accepted !== true) {
        setActionError('Согласие не сохранилось. Проверьте связь и попробуйте ещё раз.');
        return;
      }
      setCrossBorderAccepted(true);
    } catch {
      setActionError('Не удалось сохранить отдельное согласие. Попробуйте ещё раз.');
    } finally {
      setConsentBusy(false);
    }
  }

  // Вернулись из Телеграма с открытой модалкой — перепроверяем привязку
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && openRef.current) refreshStatus();
    });
    return () => sub.remove();
  }, [refreshStatus]);

  // Внутри Telegram Mini App уведомления и так идут в Телеграм — кнопка не нужна
  if (!userId || isTelegramMiniApp()) return null;

  const connect = () => {
    setFailed(false);
    setActionError('');
    if (!crossBorderAccepted) {
      setActionError('Сначала подтвердите отдельное согласие на трансграничную передачу.');
      return;
    }
    // Заявку серверу шлём параллельно, а НЕ перед переходом. Она нужна на
    // случай, когда чат с ботом уже был: Telegram тогда не доносит метку из
    // ссылки и присылает голый «/start», и бот привязывает по заявке.
    // Но ждать её ответа нельзя:
    //  • в браузере открыть Телеграм разрешено только внутри самого нажатия —
    //    после await это уже «всплывающее окно», и его молча блокируют;
    //  • если сеть подвисла, запрос висел без ограничения по времени, и
    //    кнопка просто ничего не делала — ни перехода, ни слова о причине.
    // Пока человек переключается в Телеграм, заявка успевает дойти. Promise
    // всё равно завершаем catch: fire-and-forget не должен стать unhandled rejection.
    void dbTgPrepareLink(userId).catch(() => {
      setActionError('Не удалось подготовить привязку. Вернитесь в JobToo и попробуйте ещё раз.');
    });
    Linking.openURL(`${BOT_URL}?start=link_${userId}`).catch(() => setFailed(true));
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      await dbUnbindTelegram(userId);
      setLinked(false);
    } catch {
      setActionError('Не удалось отключить Telegram. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const openBot = () => {
    setActionError('');
    Linking.openURL(BOT_URL).catch(() => {
      setActionError('Не удалось открыть Telegram. Откройте бота вручную: t.me/JobToo_bot');
    });
  };

  const connectedText = isEmployer
    ? 'Отклики кандидатов и напоминания о заявках приходят в Telegram мгновенно'
    : 'Новые смены, ответы директоров и сообщения приходят в Telegram мгновенно';

  return (
    <>
      <TouchableOpacity
        ref={btnRef}
        onLayout={onboardingAnchor ? measureAnchor : undefined}
        style={{ position: 'relative', padding: pad }}
        onPress={() => { setOpen(true); refreshStatus(); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <TelegramLogo size={size} />
        {linked === false && <View style={st.attentionDot} />}
      </TouchableOpacity>

      <Modal statusBarTranslucent navigationBarTranslucent visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={st.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setOpen(false)} />
          {/* Отступ снизу считаем от системной панели: на Android с тремя
              кнопками фиксированные 34 не спасают — подсказка уезжает под них */}
          <View style={[st.sheet, { paddingBottom: bottomSafe(insets.bottom, 34) }]}>
            <View style={st.grabber} />

            <View style={st.titleRow}>
              <TelegramLogo size={46} />
              <View style={{ flex: 1 }}>
                <Text style={st.title}>
                  {linked ? 'Telegram подключён' : 'Уведомления в Telegram'}
                </Text>
                <Text style={st.subtitle}>
                  {linked
                    ? 'Всё важное приходит вам в личку'
                    : 'Самый быстрый способ ничего не пропустить'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {linked !== null && !crossBorderAccepted ? (
              <TouchableOpacity
                style={st.consentRow}
                onPress={() => void acceptCrossBorderConsent()}
                activeOpacity={0.8}
                disabled={consentBusy}
              >
                <View style={[st.checkbox, crossBorderAccepted && st.checkboxActive]}>
                  {crossBorderAccepted ? <Text style={st.checkmark}>✓</Text> : null}
                </View>
                <Text style={st.consentText}>
                  {consentBusy ? 'Сохраняем отдельное согласие…' : 'Согласен(на) на '}
                  {!consentBusy ? (
                    <Text
                      style={st.consentLink}
                      onPress={() => router.push({ pathname: '/legal', params: { doc: 'crossBorderConsent' } })}
                    >
                      трансграничную передачу ПДн
                    </Text>
                  ) : null}
                  {!consentBusy ? ' для Telegram. Подключение добровольно.' : ''}
                </Text>
              </TouchableOpacity>
            ) : null}

            {linked === null && statusFailed ? (
              <View style={st.statusErrorBox}>
                <Text style={st.statusErrorTitle}>Не удалось проверить Telegram</Text>
                <Text style={st.statusErrorText}>Проверьте связь и попробуйте ещё раз.</Text>
                <TouchableOpacity onPress={() => void refreshStatus()} activeOpacity={0.8}>
                  <Text style={st.retryText}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : linked === null ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator color={TG_BLUE} />
              </View>
            ) : linked ? (
              <>
                <View style={st.connectedBox}>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.green} />
                  <Text style={st.connectedText}>{connectedText}</Text>
                </View>
                <TouchableOpacity style={st.secondaryBtn} onPress={openBot} activeOpacity={0.8}>
                  <Text style={st.secondaryText}>Открыть бота</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.dangerBtn} onPress={disconnect} disabled={busy} activeOpacity={0.7}>
                  <Text style={st.dangerText}>{busy ? 'Отключаем…' : 'Отключить уведомления'}</Text>
                </TouchableOpacity>
                {actionError ? <Text style={st.actionError}>{actionError}</Text> : null}
              </>
            ) : (
              <>
                {isEmployer ? (
                  <View style={st.benefits}>
                    <Benefit icon="mail-unread-outline" text="Отклики кандидатов — мгновенно в личку" />
                    <Benefit icon="checkmark-done-outline" text="Одобряйте или отклоняйте заявки прямо из Telegram" />
                    <Benefit icon="alarm-outline" text="Напоминания о кандидатах, которые ждут ответа" />
                  </View>
                ) : (
                  <View style={st.benefits}>
                    <Benefit icon="flash-outline" text="Новые смены и вакансии — сразу в личку, раньше всех" />
                    <Benefit icon="mail-unread-outline" text="Ответ директора на отклик — мгновенным сообщением" />
                    <Benefit icon="chatbubble-ellipses-outline" text="Ничего не потеряется, даже если пуши отключены" />
                  </View>
                )}
                <TouchableOpacity
                  style={[st.connectBtn, (!crossBorderAccepted || consentBusy) && { opacity: 0.55 }]}
                  onPress={connect}
                  activeOpacity={0.85}
                  disabled={!crossBorderAccepted || consentBusy}
                >
                  <Ionicons name="paper-plane" size={17} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={st.connectText}>Подключить Telegram</Text>
                </TouchableOpacity>
                {failed ? (
                  <Text style={st.failHint}>
                    Телеграм не открылся. Проверьте, что он установлен, и откройте бота
                    вручную: t.me/JobToo_bot — там нажмите «Start».
                  </Text>
                ) : actionError ? (
                  <Text style={st.failHint}>{actionError}</Text>
                ) : (
                  <Text style={st.hint}>
                    Откроется Телеграм — нажмите «Start». Вернитесь сюда, статус обновится сам.
                  </Text>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function Benefit({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={st.benefitRow}>
      <View style={st.benefitIcon}>
        <Ionicons name={icon} size={16} color={TG_BLUE} />
      </View>
      <Text style={st.benefitText}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  attentionDot: {
    position: 'absolute', top: rs(2), right: rs(2),
    width: rs(10), height: rs(10), borderRadius: rs(5),
    backgroundColor: Colors.primary,
    borderWidth: 1.5, borderColor: '#fff',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(17,17,17,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: rs(24), borderTopRightRadius: rs(24),
    paddingHorizontal: rs(20), paddingTop: rs(10),
  },
  grabber: {
    alignSelf: 'center', width: rs(40), height: rs(4), borderRadius: rs(2),
    backgroundColor: '#E5E7EB', marginBottom: rs(16),
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: rs(12), marginBottom: rs(18) },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
  subtitle: { fontSize: rf(13), color: Colors.textSecondary, marginTop: rs(2) },
  benefits: { gap: rs(12), marginBottom: rs(20) },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },
  benefitIcon: {
    width: rs(32), height: rs(32), borderRadius: rs(16),
    backgroundColor: '#E7F3FB',
    alignItems: 'center', justifyContent: 'center',
  },
  benefitText: { flex: 1, fontSize: rf(14), lineHeight: rf(19), color: Colors.textPrimary, fontWeight: '500' },
  connectBtn: {
    height: rs(52), borderRadius: Radius.lg,
    backgroundColor: TG_BLUE,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  connectText: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  hint: { fontSize: rf(12.5), lineHeight: rf(17), color: Colors.textMuted, textAlign: 'center', marginTop: rs(10) },
  failHint: { fontSize: rf(12.5), lineHeight: rf(17), color: Colors.red, textAlign: 'center', marginTop: rs(10) },
  actionError: { fontSize: rf(12.5), lineHeight: rf(17), color: Colors.red, textAlign: 'center', marginTop: rs(8) },
  statusErrorBox: { alignItems: 'center', gap: rs(8), paddingVertical: rs(24), paddingHorizontal: rs(12) },
  statusErrorTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  statusErrorText: { fontSize: rf(13), color: Colors.textMuted, textAlign: 'center' },
  retryText: { fontSize: rf(14), fontWeight: '700', color: TG_BLUE, marginTop: rs(2) },
  consentRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(10),
    padding: rs(12), marginBottom: rs(14), borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  checkbox: {
    width: rs(22), height: rs(22), borderRadius: rs(6), borderWidth: 1.5,
    borderColor: Colors.inputBorder, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxActive: { backgroundColor: TG_BLUE, borderColor: TG_BLUE },
  checkmark: { color: '#fff', fontSize: rf(13), fontWeight: '800' },
  consentText: { flex: 1, fontSize: rf(12.5), lineHeight: rf(18), color: Colors.textSecondary },
  consentLink: { color: TG_BLUE, fontWeight: '700', textDecorationLine: 'underline' },
  connectedBox: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    backgroundColor: Colors.greenLight, borderRadius: Radius.md,
    padding: rs(12), marginBottom: rs(16),
  },
  connectedText: { flex: 1, fontSize: rf(13.5), lineHeight: rf(18), color: Colors.textPrimary },
  secondaryBtn: {
    height: rs(48), borderRadius: Radius.lg,
    backgroundColor: '#E7F3FB',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: rs(8),
  },
  secondaryText: { color: TG_BLUE, fontSize: rf(15), fontWeight: '700' },
  dangerBtn: { alignItems: 'center', paddingVertical: rs(12) },
  dangerText: { color: Colors.red, fontSize: rf(14), fontWeight: '600' },
});
