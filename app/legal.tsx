import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { JT, JT_FONT } from '@/constants/jt';
import { useWarmSystemBar } from '@/hooks/useWarmSystemBar';

import { rs, rf } from '@/constants/scale';

import { LEGAL_DOCS, formatLegalDate, type LegalDocKey } from '@/constants/legal';
import { BackButton, BACK_BUTTON_SIZE } from '@/components/ui/BackButton';
import { useHydrated } from '@/hooks/useHydrated';

const ALL_DOC_KEYS: LegalDocKey[] = [
  'terms',
  'privacy',
  'dataPolicy',
  'consent',
  'marketing',
  'employers',
];

// Тексты и редакции лежат в constants/legal.ts. /legal без параметра показывает
// весь действующий набор документов; /legal?doc=... открывает конкретный текст.
export default function LegalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ doc?: string }>();
  // Параметр — после первого рендера: иначе расхождение со статическим HTML (#418).
  const doc = useHydrated() ? params.doc : undefined;
  const content = doc ? LEGAL_DOCS[doc as LegalDocKey] ?? null : null;
  useWarmSystemBar();

  if (!doc) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <BackButton style={styles.backBtn} />
          <Text style={styles.headerTitle}>Документы</Text>
          <View style={{ width: BACK_BUTTON_SIZE }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.libraryBody}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.libraryHero}>
            <View style={styles.libraryIcon}>
              <Ionicons name="documents-outline" size={rf(26)} color={JT.ink} />
            </View>
            <Text style={styles.libraryTitle}>Все документы JobToo</Text>
            <Text style={styles.librarySubtitle}>
              Здесь собраны все действующие юридические документы и их текущие редакции.
            </Text>
          </View>

          <View style={styles.libraryList}>
            {ALL_DOC_KEYS.map((key) => {
              const item = LEGAL_DOCS[key];
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.libraryRow}
                  activeOpacity={0.75}
                  onPress={() => router.push({ pathname: '/legal', params: { doc: key } })}
                >
                  <View style={styles.libraryRowIcon}>
                    <Ionicons name="document-text-outline" size={rf(20)} color={JT.ink} />
                  </View>
                  <View style={styles.libraryRowText}>
                    <Text style={styles.libraryRowTitle}>{item.title}</Text>
                    <Text style={styles.libraryRowVersion}>
                      Редакция от {formatLegalDate(item.version)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={rf(20)} color={JT.ink} />
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.libraryNote}>
            Отдельное согласие на трансграничную передачу показано здесь вместе с остальными документами, даже если пользователь решил его не предоставлять.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!content) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <BackButton style={styles.backBtn} />
          <Text style={styles.headerTitle}>Документ</Text>
          <View style={{ width: BACK_BUTTON_SIZE }} />
        </View>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Документ не найден</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <BackButton style={styles.backBtn} />
        <Text style={styles.headerTitle} numberOfLines={1}>{content.title}</Text>
        <View style={{ width: BACK_BUTTON_SIZE }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.docTitle}>{content.title}</Text>
        <Text style={styles.version}>Редакция от {formatLegalDate(content.version)}</Text>
        {content.sections.map((section, i) => (
          <View key={i} style={styles.section}>
            {section.heading ? <Text style={styles.heading}>{section.heading}</Text> : null}
            <Text style={styles.docBody}>{section.body}</Text>
          </View>
        ))}
        <View style={{ height: rs(40) }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Стиль JT (28.09.2026): кремовый фон, Unbounded — заголовки, Manrope — текст,
// белые карточки с контуром — как на экранах настроек и помощи.
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: JT.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: rs(8),
    paddingHorizontal: rs(16),
    paddingVertical: rs(12),
    backgroundColor: JT.background,
    borderBottomWidth: 1,
    borderBottomColor: JT.stack2,
  },
  backBtn: { borderWidth: 2, borderColor: JT.ink, backgroundColor: JT.surface, shadowOpacity: 0, elevation: 0 },
  headerTitle: {
    fontFamily: JT_FONT.head,
    fontSize: rf(16),
    color: JT.ink,
    flex: 1,
    textAlign: 'center',
  },

  libraryBody: {
    padding: rs(20),
    paddingBottom: rs(36),
  },
  libraryHero: {
    alignItems: 'center',
    paddingTop: rs(10),
    paddingBottom: rs(22),
  },
  libraryIcon: {
    width: rs(64),
    height: rs(64),
    borderRadius: rs(32),
    backgroundColor: JT.accentSoft,
    borderWidth: 2,
    borderColor: JT.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: rs(14),
  },
  libraryTitle: {
    fontFamily: JT_FONT.head,
    fontSize: rf(22),
    lineHeight: rf(28),
    color: JT.ink,
    textAlign: 'center',
  },
  librarySubtitle: {
    marginTop: rs(8),
    maxWidth: rs(330),
    fontFamily: JT_FONT.medium,
    fontSize: rf(15),
    lineHeight: rf(22),
    color: JT.textSecondary,
    textAlign: 'center',
  },
  libraryList: { gap: rs(10) },
  libraryRow: {
    minHeight: rs(72),
    borderWidth: 2,
    borderColor: JT.ink,
    borderRadius: rs(20),
    backgroundColor: JT.surface,
    paddingHorizontal: rs(14),
    paddingVertical: rs(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(12),
  },
  libraryRowIcon: {
    width: rs(40),
    height: rs(40),
    borderRadius: rs(12),
    backgroundColor: JT.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  libraryRowText: { flex: 1, minWidth: 0 },
  libraryRowTitle: {
    fontFamily: JT_FONT.bold,
    fontSize: rf(15),
    lineHeight: rf(20),
    color: JT.ink,
  },
  libraryRowVersion: {
    marginTop: rs(3),
    fontFamily: JT_FONT.bold,
    fontSize: rf(12.5),
    color: JT.textTertiary,
  },
  libraryNote: {
    marginTop: rs(18),
    fontFamily: JT_FONT.medium,
    fontSize: rf(13),
    lineHeight: rf(19),
    color: JT.textTertiary,
    textAlign: 'center',
  },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.textTertiary },
  body: { padding: rs(20), paddingBottom: rs(40), gap: rs(18) },
  docTitle: { fontFamily: JT_FONT.head, fontSize: rf(22), color: JT.ink, lineHeight: rf(28) },
  section: { gap: rs(6) },
  heading: { fontFamily: JT_FONT.heavy, fontSize: rf(16), color: JT.ink, lineHeight: rf(22) },
  version: { fontFamily: JT_FONT.bold, fontSize: rf(13), color: JT.textTertiary, marginTop: rs(-8) },
  docBody: { fontFamily: JT_FONT.medium, fontSize: rf(15), color: JT.textBody, lineHeight: rf(24) },
});
