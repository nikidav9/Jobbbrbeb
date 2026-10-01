import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Modal, Animated, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Shadow } from '@/constants/theme';
import { rs, rf } from '@/constants/scale';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';

import { JT_FONT } from '@/constants/jt';
/**
 * Окно отклика: человек пишет пару слов о себе, и это уходит первым
 * сообщением от его имени.
 *
 * Раньше отклик отправлял шаблон «Здравствуйте! Меня заинтересовала ваша
 * вакансия» — причём от имени системы. На той стороне видели автоответчик,
 * и отвечать было нечему: из 132 переписок в 50 не прозвучало ни одного
 * живого слова, а разговором становилась четверть.
 *
 * Поле обязательное. Пустой отклик вернул бы ровно то же молчание, только
 * с лишним экраном. Чтобы это не превратилось в сочинение, рядом лежат
 * готовые фразы — нажатие подставляет текст, дописать можно.
 */

export const APPLY_MIN_LENGTH = 10;

export type ApplyChip = { id: string; label: string; text: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  onSend: (message: string) => Promise<void> | void;
  /** Строки карточки вакансии: «Смена: …», «Когда: …», «Где: …» */
  info: string[];
  chips: ApplyChip[];
  title?: string;
  /**
   * Тем же окном директор пишет первое сообщение одобренному кандидату,
   * поэтому подписи — параметры, а не константы: «Отправить отклик» на
   * стороне работодателя звучало бы наоборот.
   */
  label?: string;
  placeholder?: string;
  sendLabel?: string;
  hint?: string;
};

export function ApplySheet({
  visible, onClose, onSend, info, chips, title,
  label, placeholder, sendLabel, hint,
}: Props) {
  const insets = useSafeAreaInsets();
  const swipe = useSwipeToDismiss(onClose, visible);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { if (visible) { setText(''); setSending(false); } }, [visible]);

  const trimmed = text.trim();
  const enough = trimmed.length >= APPLY_MIN_LENGTH;

  const send = async () => {
    if (!enough || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent
      navigationBarTranslucent onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={[s.sheet, { paddingBottom: insets.bottom + rs(12) }, swipe.animStyle]}>
            <View {...swipe.panHandlers}>
              <SheetHandle />
              <Text style={s.title}>{title ?? 'Отклик'}</Text>
            </View>

            {/* Та же справка, что уйдёт в переписку системным сообщением —
                человек должен видеть, на что откликается. */}
            {info.length > 0 && (
              <View style={s.info}>
                {info.map((line, i) => (
                  <Text key={i} style={i === 0 ? s.infoHead : s.infoLine} numberOfLines={2}>{line}</Text>
                ))}
              </View>
            )}

            <Text style={s.label}>{label ?? 'Напишите пару слов о себе'}</Text>
            <TextInput
              style={s.input}
              value={text}
              onChangeText={setText}
              placeholder={placeholder ?? 'Например: 3 года во фронтенде, готов выйти через две недели'}
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={300}
              editable={!sending}
            />

            {chips.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
                {chips.map(c => (
                  <TouchableOpacity key={c.id} style={s.chip} activeOpacity={0.8}
                    onPress={() => setText(prev => (prev.trim() ? prev.trim() + ' ' : '') + c.text)}>
                    <Text style={s.chipTxt}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[s.send, !enough && s.sendOff]}
              onPress={send}
              disabled={!enough || sending}
              activeOpacity={0.85}
            >
              {sending
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.sendTxt}>{sendLabel ?? 'Отправить отклик'}</Text>}
            </TouchableOpacity>

            {!enough && (
              <Text style={s.hint}>
                {hint ?? 'Пара слов о себе поднимает шанс ответа — работодатель увидит человека, а не шаблон'}
              </Text>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: rs(20), borderTopRightRadius: rs(20),
    paddingHorizontal: rs(20),
  },
  title: { fontSize: rf(18), fontFamily: JT_FONT.bold, color: Colors.textPrimary, paddingBottom: rs(10) },

  info: {
    backgroundColor: Colors.surface, borderRadius: rs(12), padding: rs(12),
    borderWidth: 1, borderColor: Colors.divider, gap: rs(2),
  },
  infoHead: { fontSize: rf(14), fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  infoLine: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: Colors.textSecondary },

  label: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: Colors.textSecondary, marginTop: rs(14), marginBottom: rs(6) },
  input: {
    borderWidth: 1, borderColor: Colors.inputBorder, borderRadius: rs(12),
    paddingHorizontal: rs(12), paddingVertical: rs(10),
    fontFamily: JT_FONT.medium, fontSize: rf(15), color: Colors.textPrimary,
    minHeight: rs(84), textAlignVertical: 'top',
  },

  chips: { gap: rs(8), paddingVertical: rs(10) },
  chip: {
    backgroundColor: Colors.primaryLight, borderRadius: rs(100),
    paddingHorizontal: rs(12), paddingVertical: rs(7),
    borderWidth: 1, borderColor: Colors.primaryBorder,
  },
  chipTxt: { fontSize: rf(12), fontFamily: JT_FONT.semi, color: Colors.primary },

  send: {
    backgroundColor: Colors.primary, borderRadius: rs(14),
    alignItems: 'center', justifyContent: 'center',
    height: rs(50), marginTop: rs(4), ...Shadow.card,
  },
  sendOff: { backgroundColor: Colors.textMuted, shadowOpacity: 0 },
  sendTxt: { color: '#fff', fontSize: rf(16), fontFamily: JT_FONT.bold },

  hint: {
    fontFamily: JT_FONT.medium, fontSize: rf(12), color: Colors.textMuted, textAlign: 'center',
    marginTop: rs(8), lineHeight: rf(16),
  },
});
