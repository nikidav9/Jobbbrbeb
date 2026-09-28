import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/hooks/useApp';
import {
  dbSupportAssistantAsk,
  dbSupportEscalate,
  dbSupportHistory,
  dbSupportKnowledge,
  dbSupportState,
  SupportKnowledgeItem,
  SupportMessage,
  SupportState,
} from '@/services/db';
import { JT } from '@/constants/jt';
import { EditColors, EditFonts } from '@/constants/profileEditTheme';
import { BottomSheet, HardShadowBox } from '@/components/profile/edit';
import { BackIcon, ChevronDownIcon } from '@/components/profile/edit/icons';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';

const EMPTY_STATE: SupportState = { operatorRequestedAt: null, closedAt: null };

export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useWarmSystemBar();
  const { currentUser, showToast } = useApp();

  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [knowledge, setKnowledge] = useState<SupportKnowledgeItem[]>([]);
  const [state, setState] = useState<SupportState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [faqVisible, setFaqVisible] = useState(false);
  const [faqOpen, setFaqOpen] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const loadConversation = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [history, nextState] = await Promise.all([
        dbSupportHistory(currentUser.id),
        dbSupportState(currentUser.id),
      ]);
      setMsgs(history);
      setState(nextState);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  const loadKnowledge = useCallback(async () => {
    if (!currentUser) return;
    try {
      setKnowledge(await dbSupportKnowledge());
    } catch {
      // Чат остаётся рабочим даже если список подсказок временно не загрузился.
    }
  }, [currentUser?.id]);

  useEffect(() => {
    void loadConversation();
    void loadKnowledge();
  }, [loadConversation, loadKnowledge]);

  // После вызова оператора ответы должны появляться почти сразу, а не через
  // 30 секунд. До эскалации лишний polling не нужен.
  useEffect(() => {
    if (!state.operatorRequestedAt || state.closedAt) return;
    const timer = setInterval(() => void loadConversation(), 5000);
    return () => clearInterval(timer);
  }, [state.operatorRequestedAt, state.closedAt, loadConversation]);

  const goBack = () => {
    // Помощь открывается из профиля/настроек. После OTA/PWA reload стек может
    // восстановиться без предыдущего route, поэтому возвращаемся явно.
    router.replace('/(tabs)/profile');
  };

  const send = async (preset?: string) => {
    const body = (preset ?? text).trim();
    if (!body || !currentUser || sending) return;

    setSending(true);
    setText('');
    const optimistic: SupportMessage = {
      id: 'local-' + Date.now(),
      direction: 'in',
      sender: 'user',
      text: body,
      createdAt: new Date().toISOString(),
    };
    setMsgs(prev => [...prev, optimistic]);

    try {
      await dbSupportAssistantAsk(currentUser.id, body);
      await loadConversation();
    } catch {
      setMsgs(prev => prev.filter(m => m.id !== optimistic.id));
      setText(body);
      showToast('Не удалось отправить сообщение. Попробуйте ещё раз.', 'error');
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  const callOperator = async () => {
    if (!currentUser || escalating) return;
    setEscalating(true);
    try {
      const lastUser = [...msgs].reverse().find(m => m.sender === 'user')?.text ?? text.trim();
      const result = await dbSupportEscalate(currentUser.id, lastUser);
      if (!result?.ok) throw new Error('Не удалось вызвать оператора');
      await loadConversation();
      showToast('Оператор подключён к диалогу', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось вызвать оператора', 'error');
    } finally {
      setEscalating(false);
    }
  };

  const operatorWaiting = !!state.operatorRequestedAt && !state.closedAt;
  const suggestions = knowledge.slice(0, 3);

  const senderLabel = (m: SupportMessage) => {
    if (m.sender === 'assistant') return 'JobToo · бот';
    if (m.sender === 'operator') return 'Оператор JobToo';
    if (m.sender === 'system') return 'JobToo';
    return '';
  };

  const canSend = !!text.trim() && !sending;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={goBack}
          style={s.backBtn}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          testID="back-button"
        >
          <BackIcon size={20} />
        </TouchableOpacity>

        <Text style={s.headerTitle}>Помощь</Text>

        <TouchableOpacity
          onPress={() => setFaqVisible(true)}
          style={s.faqBtn}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel="Частые вопросы"
        >
          <Ionicons name="help-circle-outline" size={20} color={EditColors.ink} />
          <Text style={s.faqText}>FAQ</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={s.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.chat}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={s.theirWrap}>
            <Text style={s.senderLabel}>JobToo · бот</Text>
            <View style={[s.bubble, s.bot]}>
              <Text style={s.bubbleTxt}>
                Привет! Я помощник JobToo. Спросите меня о резюме, откликах,
                профиле, уведомлениях или аккаунте. Если не помогу — нажмите
                «Позвать оператора», и весь этот диалог увидит поддержка.
              </Text>
            </View>
          </View>

          {loading && msgs.length === 0 ? (
            <ActivityIndicator color={JT.accent} style={{ marginTop: 18 }} />
          ) : loadFailed && msgs.length === 0 ? (
            <View style={s.errorCard}>
              <Text style={s.errorTitle}>Не удалось загрузить чат</Text>
              <TouchableOpacity onPress={() => void loadConversation()} style={s.retryBtn}>
                <Text style={s.retryText}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : (
            msgs.map(m => m.sender === 'user' ? (
              <View key={m.id} style={[s.bubble, s.mine]}>
                <Text style={[s.bubbleTxt, s.mineTxt]}>{m.text}</Text>
              </View>
            ) : (
              <View key={m.id} style={s.theirWrap}>
                <Text style={s.senderLabel}>{senderLabel(m)}</Text>
                <View style={[s.bubble, m.sender === 'operator' ? s.operator : s.bot]}>
                  <Text style={s.bubbleTxt}>{m.text}</Text>
                </View>
              </View>
            ))
          )}

          {!operatorWaiting && suggestions.length > 0 && msgs.length < 4 ? (
            <View style={s.suggestions}>
              {suggestions.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={s.suggestion}
                  onPress={() => void send(item.question)}
                  disabled={sending}
                  activeOpacity={0.72}
                >
                  <Text style={s.suggestionText}>{item.question}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            style={[s.operatorBtn, operatorWaiting && s.operatorBtnActive]}
            onPress={callOperator}
            disabled={operatorWaiting || escalating}
            activeOpacity={0.8}
          >
            <Ionicons
              name={operatorWaiting ? 'headset' : 'person-add-outline'}
              size={20}
              color={EditColors.ink}
            />
            <Text style={s.operatorText}>
              {operatorWaiting
                ? 'Оператор уже подключён'
                : escalating ? 'Подключаем…' : 'Позвать оператора'}
            </Text>
          </TouchableOpacity>

          {operatorWaiting ? (
            <Text style={s.operatorHint}>
              Новые сообщения идут прямо оператору. Ответ появится в этом чате.
            </Text>
          ) : null}
        </ScrollView>

        <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder={operatorWaiting ? 'Сообщение оператору' : 'Сообщение'}
            placeholderTextColor={EditColors.placeholder}
            multiline
            maxLength={1500}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[s.sendBtn, canSend && s.sendBtnOn]}
            onPress={() => void send()}
            disabled={!canSend}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Отправить"
          >
            {sending
              ? <ActivityIndicator size="small" color={EditColors.ink} />
              : <Ionicons name="arrow-up" size={22} color={canSend ? EditColors.ink : EditColors.disabledText} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <BottomSheet
        visible={faqVisible}
        onClose={() => setFaqVisible(false)}
        title="Частые вопросы"
        height="92%"
        backgroundColor={JT.background}
      >
        <ScrollView
          contentContainerStyle={s.faqList}
          showsVerticalScrollIndicator={false}
        >
          {knowledge.length === 0 ? (
            <Text style={s.faqEmpty}>Список вопросов временно недоступен. Можно спросить в чате.</Text>
          ) : knowledge.map(item => {
            const expanded = faqOpen === item.id;
            const card = (
              <View style={[s.faqItem, expanded && s.faqItemOpen]}>
                <TouchableOpacity
                  style={s.faqQuestionRow}
                  activeOpacity={0.75}
                  onPress={() => setFaqOpen(expanded ? null : item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                >
                  <Text style={s.faqQuestion}>{item.question}</Text>
                  <View style={expanded ? s.chevUp : undefined}>
                    <ChevronDownIcon size={18} />
                  </View>
                </TouchableOpacity>
                {expanded ? <Text style={s.faqAnswer}>{item.answer}</Text> : null}
              </View>
            );
            return expanded
              ? <HardShadowBox key={item.id} offset={4} radius={20}>{card}</HardShadowBox>
              : <View key={item.id}>{card}</View>;
          })}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: JT.background,
    borderBottomWidth: 1.5,
    borderBottomColor: '#EFE7DC',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: JT.ink,
    backgroundColor: JT.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: EditFonts.heading,
    fontSize: 20,
    letterSpacing: -0.2,
    color: JT.ink,
  },
  faqBtn: {
    height: 44,
    borderRadius: 22,
    paddingLeft: 12,
    paddingRight: 16,
    borderWidth: 2,
    borderColor: JT.ink,
    backgroundColor: JT.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  faqText: { fontFamily: EditFonts.text800, fontSize: 15, color: JT.ink },
  body: { flex: 1 },
  chat: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 12,
  },
  theirWrap: { alignSelf: 'flex-start', maxWidth: '84%' },
  senderLabel: {
    fontFamily: EditFonts.text800,
    fontSize: 12,
    color: JT.textTertiary,
    marginBottom: 6,
    marginLeft: 4,
  },
  bubble: {
    maxWidth: '100%',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  bot: {
    backgroundColor: JT.accentSoft,
    borderBottomLeftRadius: 6,
  },
  operator: {
    backgroundColor: JT.surface,
    borderWidth: 1.5,
    borderColor: '#EFE7DC',
    borderBottomLeftRadius: 6,
  },
  mine: {
    alignSelf: 'flex-end',
    maxWidth: '84%',
    backgroundColor: JT.accent,
    borderWidth: 2,
    borderColor: JT.ink,
    borderBottomRightRadius: 6,
  },
  bubbleTxt: {
    fontFamily: EditFonts.text600,
    fontSize: 15,
    lineHeight: 22,
    color: JT.ink,
  },
  mineTxt: { fontFamily: EditFonts.text700 },
  suggestions: { gap: 10, marginTop: 6 },
  suggestion: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: JT.borderSoft,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: JT.surface,
  },
  suggestionText: {
    fontFamily: EditFonts.text700,
    fontSize: 14,
    lineHeight: 19,
    color: JT.ink,
  },
  operatorBtn: {
    marginTop: 4,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: JT.ink,
    backgroundColor: JT.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  operatorBtnActive: { backgroundColor: JT.accentSoft },
  operatorText: { fontFamily: EditFonts.text700, fontSize: 16, color: JT.ink },
  operatorHint: {
    fontFamily: EditFonts.text600,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    color: JT.textTertiary,
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1.5,
    borderTopColor: '#EFE7DC',
    backgroundColor: JT.background,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 52,
    maxHeight: 120,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: EditColors.borderSoft,
    backgroundColor: JT.surface,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 14,
    fontFamily: EditFonts.text600,
    fontSize: 16,
    color: JT.ink,
  },
  sendBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: JT.stack2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOn: {
    backgroundColor: JT.accent,
    borderWidth: 2,
    borderColor: JT.ink,
  },
  errorCard: { alignItems: 'center', marginTop: 24, gap: 10 },
  errorTitle: { fontFamily: EditFonts.text600, fontSize: 14, color: JT.textTertiary },
  retryBtn: {
    borderRadius: 20,
    backgroundColor: JT.accent,
    borderWidth: 2,
    borderColor: JT.ink,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: { fontFamily: EditFonts.text700, color: JT.ink, fontSize: 14 },
  faqList: { paddingTop: 18, paddingBottom: 40, paddingRight: 4, gap: 10 },
  faqItem: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#EFE7DC',
    backgroundColor: JT.surface,
  },
  faqItemOpen: { borderWidth: 2, borderColor: JT.ink },
  faqQuestionRow: {
    minHeight: 60,
    paddingLeft: 18,
    paddingRight: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  faqQuestion: {
    flex: 1,
    fontFamily: EditFonts.text800,
    fontSize: 16,
    lineHeight: 22,
    color: JT.ink,
  },
  chevUp: { transform: [{ rotate: '180deg' }] },
  faqAnswer: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    fontFamily: EditFonts.text600,
    fontSize: 14,
    lineHeight: 21,
    color: JT.textBody,
  },
  faqEmpty: {
    paddingVertical: 20,
    textAlign: 'center',
    fontFamily: EditFonts.text600,
    color: JT.textTertiary,
    fontSize: 13,
  },
});
