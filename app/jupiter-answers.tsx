// Мои ответы для работодателей: что Юпитер подставляет в анкеты сам (банк
// ответов-фактов, решение владельца 30.09.2026). Здесь их видно и можно
// удалить — тогда при следующей анкете Юпитер снова спросит.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';
import { JT, JT_FONT } from '@/constants/jt';
import { HardShadowBox } from '@/components/profile/edit/HardShadowBox';
import { BackIcon } from '@/components/profile/edit/icons';
import { jupiterAnswerDelete, jupiterAnswers, type JupiterSavedAnswer } from '@/services/db';

export default function JupiterAnswersScreen() {
  useWarmSystemBar(true, JT.background);
  const router = useRouter();
  const { currentUser, showToast } = useApp();
  const [items, setItems] = useState<JupiterSavedAnswer[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      setItems(await jupiterAnswers(currentUser.id));
    } catch (e: any) {
      showToast(e?.message || 'Не удалось загрузить ответы', 'error');
      setItems([]);
    }
  }, [currentUser?.id, showToast]);

  useEffect(() => { void load(); }, [load]);

  const remove = async (key: string) => {
    if (!currentUser?.id || removing) return;
    setRemoving(key);
    try {
      await jupiterAnswerDelete(currentUser.id, key);
      setItems(list => (list ?? []).filter(a => a.question_key !== key));
    } catch (e: any) {
      showToast(e?.message || 'Не удалось удалить', 'error');
    } finally {
      setRemoving(null);
    }
  };

  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/profile'); };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={goBack} activeOpacity={0.72}
          accessibilityRole="button" accessibilityLabel="Назад" testID="back-button">
          <BackIcon />
        </TouchableOpacity>
        <Text style={s.headerTitle} pointerEvents="none">Мои ответы</Text>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.lead}>
          Эти ответы Юпитер подставляет в анкеты работодателей сам. Удалите ответ — и при следующей анкете он спросит снова.
        </Text>
        {items === null ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={JT.accent} />
        ) : items.length === 0 ? (
          <Text style={s.empty}>Пока пусто: ответы появятся, когда работодатель задаст вопрос, а вы ответите.</Text>
        ) : items.map(a => (
          <HardShadowBox key={a.question_key} offset={4} radius={18} style={{ marginTop: 14 }}>
            <View style={s.card}>
              <Text style={s.q}>{a.question_text}</Text>
              <Text style={s.a}>{a.answer}</Text>
              <TouchableOpacity
                style={s.del}
                onPress={() => void remove(a.question_key)}
                disabled={removing === a.question_key}
                accessibilityRole="button"
                accessibilityLabel={`Удалить ответ: ${a.question_text}`}
              >
                {removing === a.question_key
                  ? <ActivityIndicator color={JT.ink} />
                  : <Text style={s.delTxt}>Удалить</Text>}
              </TouchableOpacity>
            </View>
          </HardShadowBox>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  header: { height: 44, marginTop: 12, marginHorizontal: 20, justifyContent: 'center', alignItems: 'flex-start' },
  back: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  headerTitle: {
    position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: JT_FONT.head, fontSize: 18, color: JT.ink,
  },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  lead: { fontFamily: JT_FONT.medium, fontSize: 14, lineHeight: 20, color: JT.textSecondary },
  empty: { marginTop: 24, fontFamily: JT_FONT.bold, fontSize: 15, lineHeight: 21, color: JT.textTertiary },
  card: { padding: 16, borderRadius: 18, borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface },
  q: { fontFamily: JT_FONT.medium, fontSize: 13, lineHeight: 18, color: JT.textTertiary },
  a: { marginTop: 6, fontFamily: JT_FONT.heavy, fontSize: 16, lineHeight: 22, color: JT.ink },
  del: {
    marginTop: 12, alignSelf: 'flex-start', height: 38, paddingHorizontal: 16, borderRadius: 19,
    borderWidth: 2, borderColor: JT.ink, justifyContent: 'center',
  },
  delTxt: { fontFamily: JT_FONT.bold, fontSize: 14, color: JT.ink },
});
