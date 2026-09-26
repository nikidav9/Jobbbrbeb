import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow } from '@/constants/theme';
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
import { rs, rf } from '@/constants/scale';
import { BackButton } from '@/components/ui/BackButton';

const EMPTY_STATE: SupportState = { operatorRequestedAt: null, closedAt: null };

export default function SupportScreen() {
  const router = useRouter();
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
    if (m.sender === 'assistant') return 'Помощник JobToo';
    if (m.sender === 'operator') return 'Оператор JobToo';
    if (m.sender === 'system') return 'JobToo';
    return '';
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <BackButton onPress={goBack} />

        <Text style={s.headerTitle}>Помощь</Text>

        <TouchableOpacity
          onPress={() => setFaqVisible(true)}
          style={s.faqBtn}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel="Частые вопросы"
        >
          <Ionicons name="help-circle-outline" size={rf(20)} color={Colors.primary} />
          <Text style={s.faqText}>FAQ</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={s.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={rs(8)}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.chat}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={s.assistantHead}>
            <Ionicons name="sparkles" size={rf(17)} color={Colors.textSecondary} />
            <Text style={s.assistantHeadText}>Помощник JobToo</Text>
          </View>
          <View style={[s.bubble, s.theirs]}>
            <Text style={s.bubbleTxt}>
              Привет! Я помощник JobToo. Спросите меня о резюме, откликах,
              профиле, уведомлениях или аккаунте. Если не помогу — нажмите
              «Позвать оператора», и весь этот диалог увидит поддержка.
            </Text>
          </View>

          {loading && msgs.length === 0 ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: rs(18) }} />
          ) : loadFailed && msgs.length === 0 ? (
            <View style={s.errorCard}>
              <Text style={s.errorTitle}>Не удалось загрузить чат</Text>
              <TouchableOpacity onPress={() => void loadConversation()} style={s.retryBtn}>
                <Text style={s.retryText}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : (
            msgs.map(m => (
              <View
                key={m.id}
                style={[
                  s.messageWrap,
                  m.sender === 'user' ? s.messageMineWrap : s.messageTheirWrap,
                ]}
              >
                {m.sender !== 'user' ? (
                  <Text style={s.senderLabel}>{senderLabel(m)}</Text>
                ) : null}
                <View style={[
                  s.bubble,
                  m.sender === 'user' ? s.mine : s.theirs,
                  m.sender === 'system' && s.systemBubble,
                ]}>
                  <Text style={[s.bubbleTxt, m.sender === 'user' && s.mineTxt]}>{m.text}</Text>
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
              size={rf(18)}
              color={operatorWaiting ? '#FFFFFF' : Colors.primary}
            />
            <Text style={[s.operatorText, operatorWaiting && s.operatorTextActive]}>
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

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder={operatorWaiting ? 'Сообщение оператору' : 'Сообщение'}
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={1500}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnOff]}
            onPress={() => void send()}
            disabled={!text.trim() || sending}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Отправить"
          >
            {sending
              ? <ActivityIndicator size="small" color="#FFFFFF" />
              : <Ionicons name="arrow-up" size={rf(21)} color="#FFFFFF" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={faqVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFaqVisible(false)}
      >
        <View style={s.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setFaqVisible(false)}
          />
          <SafeAreaView style={s.faqSheet} edges={['bottom']}>
            <View style={s.sheetHandle} />
            <View style={s.faqHeader}>
              <Text style={s.faqTitle}>Частые вопросы</Text>
              <TouchableOpacity onPress={() => setFaqVisible(false)} style={s.closeBtn}>
                <Ionicons name="close" size={rf(22)} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={s.faqList}
              showsVerticalScrollIndicator={false}
            >
              {knowledge.length === 0 ? (
                <Text style={s.faqEmpty}>Список вопросов временно недоступен. Можно спросить в чате.</Text>
              ) : knowledge.map(item => {
                const expanded = faqOpen === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={s.faqItem}
                    activeOpacity={0.75}
                    onPress={() => setFaqOpen(expanded ? null : item.id)}
                  >
                    <View style={s.faqQuestionRow}>
                      <Text style={s.faqQuestion}>{item.question}</Text>
                      <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={rf(18)}
                        color={Colors.textMuted}
                      />
                    </View>
                    {expanded ? <Text style={s.faqAnswer}>{item.answer}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    minHeight: rs(72),
    paddingHorizontal: rs(18),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(12),
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    flex: 1,
    fontSize: rf(21),
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  faqBtn: {
    minHeight: rs(46),
    borderRadius: rs(23),
    paddingHorizontal: rs(15),
    borderWidth: 1,
    borderColor: Colors.divider,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(6),
    ...Shadow.card,
  },
  faqText: { fontSize: rf(14), fontWeight: '800', color: Colors.primary },
  body: { flex: 1 },
  chat: {
    paddingHorizontal: rs(18),
    paddingTop: rs(18),
    paddingBottom: rs(24),
  },
  assistantHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(7),
    marginBottom: rs(8),
    paddingLeft: rs(4),
  },
  assistantHeadText: {
    fontSize: rf(14),
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  messageWrap: { marginTop: rs(10), maxWidth: '88%' },
  messageMineWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageTheirWrap: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderLabel: {
    fontSize: rf(11.5),
    color: Colors.textMuted,
    marginBottom: rs(4),
    marginLeft: rs(6),
  },
  bubble: {
    maxWidth: '100%',
    borderRadius: rs(18),
    paddingHorizontal: rs(15),
    paddingVertical: rs(12),
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
    borderBottomLeftRadius: rs(6),
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: rs(6),
  },
  systemBubble: {
    backgroundColor: '#FFF4EC',
    borderWidth: 1,
    borderColor: '#FFD9C2',
  },
  bubbleTxt: {
    fontSize: rf(14.5),
    lineHeight: rf(20.5),
    color: Colors.textPrimary,
  },
  mineTxt: { color: '#FFFFFF' },
  suggestions: { gap: rs(9), marginTop: rs(18) },
  suggestion: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: rs(22),
    borderWidth: 1.5,
    borderColor: '#FFB487',
    paddingHorizontal: rs(15),
    paddingVertical: rs(10),
    backgroundColor: '#FFFFFF',
  },
  suggestionText: {
    fontSize: rf(13.5),
    lineHeight: rf(18),
    color: Colors.primary,
  },
  operatorBtn: {
    marginTop: rs(18),
    minHeight: rs(48),
    borderRadius: rs(24),
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: rs(8),
    paddingHorizontal: rs(16),
  },
  operatorBtnActive: { backgroundColor: Colors.primary },
  operatorText: { fontSize: rf(14), fontWeight: '800', color: Colors.primary },
  operatorTextActive: { color: '#FFFFFF' },
  operatorHint: {
    marginTop: rs(7),
    fontSize: rf(11.5),
    lineHeight: rf(16),
    textAlign: 'center',
    color: Colors.textMuted,
  },
  inputRow: {
    minHeight: rs(70),
    paddingHorizontal: rs(16),
    paddingVertical: rs(10),
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: rs(9),
  },
  input: {
    flex: 1,
    minHeight: rs(48),
    maxHeight: rs(120),
    borderRadius: rs(24),
    backgroundColor: '#F4F5F7',
    paddingHorizontal: rs(17),
    paddingTop: rs(13),
    paddingBottom: rs(12),
    fontSize: rf(14.5),
    color: Colors.textPrimary,
  },
  sendBtn: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.38 },
  errorCard: { alignItems: 'center', marginTop: rs(24), gap: rs(10) },
  errorTitle: { fontSize: rf(14), color: Colors.textSecondary },
  retryBtn: {
    borderRadius: rs(18),
    backgroundColor: Colors.primary,
    paddingHorizontal: rs(16),
    paddingVertical: rs(9),
  },
  retryText: { color: '#FFFFFF', fontSize: rf(13), fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  faqSheet: {
    maxHeight: '82%',
    backgroundColor: '#F7F7F9',
    borderTopLeftRadius: rs(26),
    borderTopRightRadius: rs(26),
    overflow: 'hidden',
  },
  sheetHandle: {
    width: rs(42),
    height: rs(5),
    borderRadius: rs(3),
    backgroundColor: '#D6D8DE',
    alignSelf: 'center',
    marginTop: rs(10),
  },
  faqHeader: {
    paddingHorizontal: rs(18),
    paddingVertical: rs(14),
    flexDirection: 'row',
    alignItems: 'center',
  },
  faqTitle: {
    flex: 1,
    fontSize: rf(19),
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  closeBtn: {
    width: rs(38),
    height: rs(38),
    borderRadius: rs(19),
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faqList: { paddingHorizontal: rs(18), paddingBottom: rs(28), gap: rs(9) },
  faqItem: {
    borderRadius: rs(16),
    backgroundColor: '#FFFFFF',
    paddingHorizontal: rs(15),
    paddingVertical: rs(13),
    ...Shadow.card,
  },
  faqQuestionRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  faqQuestion: {
    flex: 1,
    fontSize: rf(14),
    lineHeight: rf(19),
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  faqAnswer: {
    marginTop: rs(9),
    fontSize: rf(13),
    lineHeight: rf(19),
    color: Colors.textSecondary,
  },
  faqEmpty: {
    paddingVertical: rs(20),
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: rf(13),
  },
});
