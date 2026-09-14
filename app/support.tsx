import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, LayoutAnimation, UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { helpSectionsFor, supportIsOpen, SUPPORT_FROM_HOUR, SUPPORT_TO_HOUR } from '@/constants/help';
import { dbSupportHistory, dbSupportSend, SupportMessage } from '@/services/db';
import { rs, rf } from '@/constants/scale';

/**
 * Помощь и поддержка.
 *
 * До сих пор написать нам было некуда: в форме входа стоял адрес почты, на
 * которую никто не смотрит, а часть людей случайно нашла телеграм-бота.
 *
 * Сверху — ответы на то, что спрашивают чаще всего: половина обращений в
 * любую поддержку это «как» и «почему», и прочитать быстрее, чем ждать.
 * Ниже — живая переписка с нами, если ответа в списке не нашлось.
 */

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function SupportScreen() {
  const router = useRouter();
  const { currentUser, showToast } = useApp();

  // Вопросы у директора и у работника разные, и общий список означал бы,
  // что каждый читает половину чужого.
  const sections = helpSectionsFor(currentUser?.role);

  const [tab, setTab] = useState<'help' | 'chat'>('help');
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!currentUser) return;
    try {
      setMsgs(await dbSupportHistory(currentUser.id));
      setLoadFailed(false);
    } catch {
      // Не подменяем сетевую ошибку фразой «Напишите нам»: пустой ответ и
      // непринесённая история — разные состояния.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { load(); }, [load]);

  // Пока экран открыт, подтягиваем ответ: он может прийти в любой момент.
  useEffect(() => {
    if (tab !== 'chat') return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [tab, load]);

  const send = async () => {
    const t = text.trim();
    if (!t || !currentUser || sending) return;
    setSending(true);
    // Показываем сразу: ждать ответа сервера, глядя в пустое поле, незачем.
    setMsgs(prev => [...prev, {
      id: 'local-' + Date.now(), direction: 'in', text: t, createdAt: new Date().toISOString(),
    }]);
    setText('');
    try {
      await dbSupportSend(currentUser.id, t);
      await load();
    } catch (e) {
      showToast('Не отправилось — попробуйте ещё раз', 'error');
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const openNow = supportIsOpen();

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.back}>← Назад</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Помощь</Text>
        <View style={{ width: rs(70) }} />
      </View>

      <View style={s.tabs}>
        {(['help', 'chat'] as const).map(t => (
          <TouchableOpacity key={t} style={s.tab} onPress={() => setTab(t)} activeOpacity={0.8}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtOn]}>
              {t === 'help' ? 'Вопросы и ответы' : 'Написать нам'}
            </Text>
            {tab === t ? <View style={s.tabLine} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'help' ? (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {sections.map(sec => (
            <View key={sec.title} style={s.card}>
              <View style={s.secHead}>
                <View style={s.secIcon}>
                  <Ionicons name={sec.icon as any} size={16} color="#fff" />
                </View>
                <Text style={s.secTitle}>{sec.title}</Text>
              </View>
              {sec.items.map(item => {
                const key = sec.title + item.q;
                const isOpen = open === key;
                return (
                  <View key={key} style={s.qaWrap}>
                    <TouchableOpacity
                      style={s.qRow}
                      activeOpacity={0.7}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setOpen(isOpen ? null : key);
                      }}
                    >
                      <Text style={s.q}>{item.q}</Text>
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={Colors.textMuted}
                      />
                    </TouchableOpacity>
                    {isOpen ? <Text style={s.a}>{item.a}</Text> : null}
                  </View>
                );
              })}
            </View>
          ))}

          <TouchableOpacity style={s.askBtn} activeOpacity={0.85} onPress={() => setTab('chat')}>
            <Text style={s.askTxt}>Не нашли ответ? Написать нам</Text>
          </TouchableOpacity>
          <Text style={s.hours}>
            Поддержка отвечает с {SUPPORT_FROM_HOUR}:00 до {SUPPORT_TO_HOUR}:00 по Москве
          </Text>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={rs(90)}
        >
          <View style={[s.status, !openNow && s.statusOff]}>
            <Text style={[s.statusTxt, !openNow && s.statusTxtOff]}>
              {openNow
                ? `Поддержка на связи · до ${SUPPORT_TO_HOUR}:00`
                : `Сейчас нерабочее время · ответим с ${SUPPORT_FROM_HOUR}:00`}
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={s.chatScroll}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {loading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: rs(24) }} />
            ) : loadFailed && msgs.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>Не удалось загрузить переписку</Text>
                <Text style={s.emptySub}>Проверьте связь и попробуйте ещё раз.</Text>
                <TouchableOpacity style={s.retryBtn} onPress={() => void load()} activeOpacity={0.85}>
                  <Text style={s.retryTxt}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : msgs.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>Напишите нам</Text>
                <Text style={s.emptySub}>
                  Не работает что-то в приложении, не заплатили за смену, не можете войти —
                  пишите сюда. Отвечаем лично.
                </Text>
              </View>
            ) : msgs.map(m => (
              <View key={m.id} style={[s.bubble, m.direction === 'in' ? s.mine : s.theirs]}>
                <Text style={[s.bubbleTxt, m.direction === 'in' && s.mineTxt]}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={text}
              onChangeText={setText}
              placeholder="Опишите вопрос"
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={1500}
            />
            <TouchableOpacity
              style={[s.send, !text.trim() && s.sendOff]}
              onPress={send}
              disabled={!text.trim() || sending}
              activeOpacity={0.85}
            >
              {sending ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="arrow-up" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(12),
    borderBottomWidth: 1, borderBottomColor: Colors.divider, backgroundColor: Colors.bg,
  },
  back: { fontSize: rf(15), color: Colors.primary, fontWeight: '600', width: rs(70) },
  headerTitle: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },

  tabs: { flexDirection: 'row', backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  tab: { flex: 1, alignItems: 'center', paddingVertical: rs(12) },
  tabTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textMuted },
  tabTxtOn: { color: Colors.primary },
  tabLine: { position: 'absolute', bottom: 0, height: rs(2), width: '60%', backgroundColor: Colors.primary },

  scroll: { padding: rs(16), gap: rs(12), paddingBottom: rs(40) },
  card: { backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(14), ...Shadow.card },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: rs(10), marginBottom: rs(2) },
  secIcon: {
    width: rs(30), height: rs(30), borderRadius: rs(9), backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  secTitle: { fontSize: rf(15), fontWeight: '800', color: Colors.textPrimary },
  qaWrap: { borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: rs(10), marginTop: rs(10) },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  q: { flex: 1, fontSize: rf(14.5), fontWeight: '600', color: Colors.textPrimary, lineHeight: rf(20) },
  a: { fontSize: rf(14), color: Colors.textSecondary, lineHeight: rf(21), marginTop: rs(8) },

  askBtn: {
    backgroundColor: Colors.primary, borderRadius: rs(100),
    paddingVertical: rs(14), alignItems: 'center', ...Shadow.card,
  },
  askTxt: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
  hours: { fontSize: rf(12.5), color: Colors.textMuted, textAlign: 'center', marginTop: rs(4) },

  status: { backgroundColor: '#D1FAE5', paddingVertical: rs(8), alignItems: 'center' },
  statusOff: { backgroundColor: '#FEF3C7' },
  statusTxt: { fontSize: rf(12.5), fontWeight: '600', color: '#065F46' },
  statusTxtOff: { color: '#92400E' },

  chatScroll: { padding: rs(16), gap: rs(8), paddingBottom: rs(20) },
  empty: { alignItems: 'center', paddingTop: rs(40), paddingHorizontal: rs(20) },
  emptyTitle: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },
  emptySub: { fontSize: rf(14), color: Colors.textMuted, textAlign: 'center', marginTop: rs(8), lineHeight: rf(20) },
  retryBtn: { marginTop: rs(16), backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) },
  retryTxt: { color: '#fff', fontSize: rf(14), fontWeight: '700' },

  bubble: { maxWidth: '86%', borderRadius: rs(16), paddingHorizontal: rs(13), paddingVertical: rs(10) },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.primary, borderBottomRightRadius: rs(4) },
  theirs: { alignSelf: 'flex-start', backgroundColor: Colors.bg, borderBottomLeftRadius: rs(4), ...Shadow.card },
  bubbleTxt: { fontSize: rf(14.5), color: Colors.textPrimary, lineHeight: rf(20) },
  mineTxt: { color: '#fff' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: rs(8),
    padding: rs(12), borderTopWidth: 1, borderTopColor: Colors.divider, backgroundColor: Colors.bg,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: Colors.inputBorder, borderRadius: rs(18),
    paddingHorizontal: rs(14), paddingVertical: rs(10),
    fontSize: rf(15), color: Colors.textPrimary, maxHeight: rs(120),
  },
  send: {
    width: rs(44), height: rs(44), borderRadius: rs(22), backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendOff: { backgroundColor: Colors.textMuted },
  sendTxt: { color: '#fff', fontSize: rf(24), fontWeight: '800', marginTop: -rs(3) },
});
