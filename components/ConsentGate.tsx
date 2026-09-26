import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useApp } from '@/hooks/useApp';
import { Colors, Radius } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import {
  dbGetConsent, dbRecordConsent, dbSetMarketingConsent,
} from '@/services/db';
import {
  LEGAL_DOCS, LEGAL_KEYS, LEGAL_STAMP, legalVersions,
  needsReconsent, formatLegalDate, type LegalDocKey,
} from '@/constants/legal';

/**
 * Окно, без которого дальше нельзя: документы приняты или выход.
 *
 * ── Кому оно показывается ─────────────────────────────────────────────────
 *
 * Тем, у кого записанное согласие не совпадает с нынешним набором редакций.
 * Сегодня это только те, кто регистрировался до 25 июня 2026: экрана с
 * документами тогда не существовало, и согласия у них нет вовсе — в базе так
 * и записано, пустым отпечатком. Раньше профиль честно сообщал им «Согласие
 * ещё не давали» и не предлагал ничего сделать. Тупик закрыт.
 *
 * Сравнение идёт по `consentVersion`, а не по дате редакции. Разница не
 * формальная: 18 августа в документах поменялся адрес поддержки, редакция
 * поднялась — и по датам окно выскочило бы у всех четырёхсот двадцати из-за
 * смены почты. См. пояснение в constants/legal.ts.
 *
 * ── Почему «Выйти», а не «Закрыть приложение» ─────────────────────────────
 *
 * Закрыть приложение программно нельзя на iOS: Apple это прямо запрещает и
 * заворачивает такие сборки. В вебе вкладку тоже не закроешь. Кнопка, которая
 * работает на одной платформе из трёх, — это не кнопка. Выход из аккаунта
 * работает везде и означает ровно то же самое: пользоваться без согласия
 * нельзя, но человек не заперт.
 *
 * ── Чего здесь намеренно нет ──────────────────────────────────────────────
 *
 * Крестика, свайпа вниз и закрытия по кнопке «назад». Окно, которое можно
 * смахнуть, — это не согласие, а уведомление, и доказательной силы у него
 * столько же.
 */

export default function ConsentGate() {
  const app = useApp();
  const insets = useSafeAreaInsets();

  const user = app?.currentUser ?? null;
  const [checked, setChecked] = useState(false);   // ответ базы получен
  const [needed, setNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkFailed, setCheckFailed] = useState(false);
  const [checkRetry, setCheckRetry] = useState(0);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [coreAccepted, setCoreAccepted] = useState(false);
  // Реклама — по желанию, по умолчанию снята. Снятая галочка ничего не
  // отзывает: отзыв — переключатель в настройках. Здесь только «дать».
  const [adsAccepted, setAdsAccepted] = useState(false);
  // Раскрытый документ. Тексты показываем прямо здесь, а не отправляем на
  // экран /legal: окно перекрывает всё, что под ним, — человек ушёл бы читать
  // и упёрся в него же поверх документа.
  const [open, setOpen] = useState<LegalDocKey | null>(null);

  useEffect(() => {
    // Гость ничего не подписывает: аккаунта нет, согласие писать не за кого и
    // некому. Требовать его — тупик (запись за синтетического гостя не
    // сохраняется, отсюда «Согласие не сохранилось»). Согласие спросим при
    // регистрации, как и раньше.
    if (!user || user.isGuest) {
      setChecked(false);
      setNeeded(false);
      setCheckFailed(false);
      return;
    }
    let alive = true;
    setChecked(false);
    setCheckFailed(false);
    dbGetConsent(user.id)
      .then(c => {
        if (!alive) return;
        setNeeded(needsReconsent(c?.stamp));
        setTermsAccepted(false);
        setCoreAccepted(false);
        setCheckFailed(false);
        setChecked(true);
      })
      .catch(() => {
        // Невозможность проверить согласие — не доказательство, что оно есть.
        // Не пропускаем человека дальше молча: показываем понятную ошибку и
        // даём повторить проверку или выйти из аккаунта.
        if (alive) { setCheckFailed(true); setChecked(true); }
      });
    return () => { alive = false; };
  }, [user?.id, checkRetry]);

  // Пока окно открыто или ещё проверяем — шторка профиля и обучение ждут.
  const blocking = !!user && !user.isGuest && (!checked || needed || checkFailed);
  const setConsentPending = app?.setConsentPending;
  useEffect(() => { setConsentPending?.(blocking); }, [blocking, setConsentPending]);

  async function accept() {
    if (!user || busy || !termsAccepted || !coreAccepted) return;
    setBusy(true);
    setError('');
    try {
      await dbRecordConsent(user.id, LEGAL_STAMP, legalVersions(), 'reconsent');

      // Перечитываем запись: кнопка не должна пропускать дальше по
      // оптимистичному состоянию интерфейса.
      const core = await dbGetConsent(user.id);
      if (needsReconsent(core?.stamp)) {
        setError('Согласие не сохранилось. Проверьте связь и попробуйте ещё раз.');
      } else {
        if (adsAccepted) {
          // Необязательное: не удалось — окно всё равно закрываем, включить
          // рассылку можно в настройках. Держать человека из-за рекламы нельзя.
          await dbSetMarketingConsent(user.id, true, LEGAL_DOCS.marketing.version, 'reconsent')
            .catch(e => console.warn('[consent] реклама не записалась', e));
        }
        setNeeded(false);
      }
    } catch (e: any) {
      // Показываем то, что сказал сервер, а не общую фразу. Общая фраза
      // красивее, но по ней невозможно понять, связь оборвалась или база
      // отказала, — а разбираться в этом придётся по одному-единственному
      // скриншоту от человека, который до нас не дозвонится.
      setError(String(e?.message || e) || 'Не удалось сохранить. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  if (!user || !checked) return null;

  if (checkFailed) {
    return (
      <View style={[
      styles.overlay,
      {
        paddingTop: insets.top + rs(12),
        paddingBottom: Math.max(insets.bottom, rs(12)),
      },
    ]}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-offline-outline" size={rf(26)} color={Colors.primary} />
          </View>
          <Text style={styles.title}>Не удалось проверить документы</Text>
          <Text style={styles.lead}>
            Сервер не ответил, поэтому JobToo не может подтвердить, что у аккаунта есть актуальное согласие. Проверьте связь и повторите проверку.
          </Text>
          <TouchableOpacity
            style={styles.accept}
            activeOpacity={0.85}
            onPress={() => setCheckRetry(v => v + 1)}
          >
            <Text style={styles.acceptText}>Повторить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.leave} activeOpacity={0.7} onPress={() => app?.logout()}>
            <Text style={styles.leaveText}>Выйти</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!needed) return null;

  const дата = formatLegalDate(LEGAL_DOCS.terms.version);

  return (
    <View style={[
      styles.overlay,
      {
        paddingTop: insets.top + rs(12),
        paddingBottom: Math.max(insets.bottom, rs(12)),
      },
    ]}>
      <View style={styles.card}>
        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.iconWrap}>
            <Ionicons name="document-text-outline" size={rf(26)} color={Colors.primary} />
          </View>

          <Text style={styles.title}>Примите документы</Text>
          <Text style={styles.lead}>
            Документы JobToo обновились. Ознакомьтесь с ними и подтвердите
            отдельное согласие на обработку персональных данных.
          </Text>

          <View style={styles.docs}>
            {[...LEGAL_KEYS, 'marketing' as const].map(key => {
              const раскрыт = open === key;
              return (
                <View key={key} style={styles.docWrap}>
                  <TouchableOpacity
                    style={styles.doc}
                    activeOpacity={0.7}
                    onPress={() => setOpen(раскрыт ? null : key)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docTitle}>{LEGAL_DOCS[key].title}</Text>
                      <Text style={styles.docVersion}>
                        Редакция от {formatLegalDate(LEGAL_DOCS[key].version)}
                      </Text>
                    </View>
                    <Ionicons
                      name={раскрыт ? 'chevron-up' : 'chevron-down'}
                      size={rf(18)}
                      color={Colors.textMuted}
                    />
                  </TouchableOpacity>

                  {раскрыт ? (
                    <View style={styles.docBody}>
                      {LEGAL_DOCS[key].sections.map((sec, i) => (
                        <View key={i} style={i > 0 ? { marginTop: rs(12) } : undefined}>
                          {sec.heading ? (
                            <Text style={styles.secHeading}>{sec.heading}</Text>
                          ) : null}
                          <Text style={styles.secBody}>{sec.body}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.consentRow}
            activeOpacity={0.8}
            onPress={() => setTermsAccepted(v => !v)}
          >
            <View style={[styles.checkbox, termsAccepted && styles.checkboxActive]}>
              {termsAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>
              Я принимаю Пользовательское соглашение и подтверждаю, что ознакомлен(а) с Политикой.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.consentRow}
            activeOpacity={0.8}
            onPress={() => setCoreAccepted(v => !v)}
          >
            <View style={[styles.checkbox, coreAccepted && styles.checkboxActive]}>
              {coreAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>
              Отдельно даю Согласие на обработку персональных данных. Это самостоятельное действие, не являющееся частью принятия Пользовательского соглашения.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.consentRow}
            activeOpacity={0.8}
            onPress={() => setAdsAccepted(v => !v)}
          >
            <View style={[styles.checkbox, adsAccepted && styles.checkboxActive]}>
              {adsAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.consentText}>
              По желанию: даю Согласие на получение рекламной рассылки о JobToo на почту и в уведомлениях. Можно отключить в настройках.
            </Text>
          </TouchableOpacity>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.note}>
            Основные документы — редакция от {дата}.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.accept, (busy || !termsAccepted || !coreAccepted) && styles.acceptBusy]}
            activeOpacity={0.85}
            onPress={accept}
            disabled={busy || !termsAccepted || !coreAccepted}
          >
            {busy
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.acceptText}>Принять</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.leave}
            activeOpacity={0.7}
            onPress={() => app?.logout()}
            disabled={busy}
          >
            <Text style={styles.leaveText}>Выйти</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,17,17,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: rs(20),
    // Выше вкладок и всего прочего: окно не должно оказаться под чем-нибудь
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    width: '100%',
    maxWidth: rs(420),
    maxHeight: '100%',
    backgroundColor: Colors.card,
    borderRadius: rs(Radius.xl),
    overflow: 'hidden',
  },
  contentScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  contentContainer: {
    paddingHorizontal: rs(22),
    paddingTop: rs(22),
    paddingBottom: rs(14),
  },
  footer: {
    flexShrink: 0,
    paddingHorizontal: rs(22),
    paddingBottom: rs(14),
    backgroundColor: Colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.divider,
  },
  iconWrap: {
    width: rs(52), height: rs(52), borderRadius: rs(26),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: rs(14),
  },
  title: { fontSize: rf(21), fontWeight: '800', color: Colors.textPrimary },
  lead: {
    marginTop: rs(8),
    fontSize: rf(14.5),
    lineHeight: rf(21),
    color: Colors.textSecondary,
  },
  docs: { marginTop: rs(16) },
  docWrap: { marginBottom: rs(8) },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: rs(12),
    paddingHorizontal: rs(14),
    backgroundColor: Colors.surface,
    borderRadius: rs(12),
  },
  docTitle: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  docVersion: { marginTop: rs(2), fontSize: rf(12.5), color: Colors.textMuted },
  docBody: {
    paddingHorizontal: rs(14),
    paddingTop: rs(12),
    paddingBottom: rs(4),
  },
  secHeading: {
    fontSize: rf(13.5), fontWeight: '700',
    color: Colors.textPrimary, marginBottom: rs(4),
  },
  secBody: { fontSize: rf(13.5), lineHeight: rf(20), color: Colors.textSecondary },
  consentRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(10),
    paddingVertical: rs(8),
  },
  checkbox: {
    width: rs(22), height: rs(22), borderRadius: rs(6), borderWidth: 1.5,
    borderColor: Colors.inputBorder, alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: rs(1),
  },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkmark: { color: '#fff', fontWeight: '800', fontSize: rf(13) },
  consentText: { flex: 1, fontSize: rf(13), lineHeight: rf(18), color: Colors.textSecondary },
  link: { color: Colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  crossLinkButton: {
    alignSelf: 'flex-start',
    paddingTop: rs(6),
    paddingBottom: rs(2),
  },
  crossDocBody: {
    padding: rs(12), borderRadius: rs(10),
    backgroundColor: Colors.surface, marginTop: rs(4), marginBottom: rs(6),
  },
  error: {
    marginTop: rs(10),
    fontSize: rf(13.5),
    color: Colors.red,
  },
  accept: {
    marginTop: rs(12),
    height: rs(52),
    borderRadius: rs(14),
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBusy: { opacity: 0.7 },
  acceptText: { fontSize: rf(16), fontWeight: '800', color: '#FFFFFF' },
  leave: {
    marginTop: rs(6),
    height: rs(46),
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveText: { fontSize: rf(15), fontWeight: '600', color: Colors.textSecondary },
  note: {
    marginTop: rs(12),
    marginBottom: rs(4),
    fontSize: rf(12),
    lineHeight: rf(17),
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
