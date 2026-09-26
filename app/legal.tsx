import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/theme';

import { rs, rf } from '@/constants/scale';

import { LEGAL_DOCS, formatLegalDate, type LegalDocKey } from '@/constants/legal';

const ALL_DOC_KEYS: LegalDocKey[] = [
  'terms',
  'privacy',
  'dataPolicy',
  'consent',
  'marketing',
];

// Тексты и редакции лежат в constants/legal.ts. /legal без параметра показывает
// весь действующий набор документов; /legal?doc=... открывает конкретный текст.
export default function LegalScreen() {
  const router = useRouter();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const content = doc ? LEGAL_DOCS[doc as LegalDocKey] ?? null : null;

  if (!doc) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backTxt}>← Назад</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Документы</Text>
          <View style={{ width: rs(70) }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.libraryBody}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.libraryHero}>
            <View style={styles.libraryIcon}>
              <Ionicons name="documents-outline" size={rf(24)} color={Colors.primary} />
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
                    <Ionicons name="document-text-outline" size={rf(19)} color={Colors.primary} />
                  </View>
                  <View style={styles.libraryRowText}>
                    <Text style={styles.libraryRowTitle}>{item.title}</Text>
                    <Text style={styles.libraryRowVersion}>
                      Редакция от {formatLegalDate(item.version)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={rf(18)} color={Colors.textMuted} />
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
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backTxt}>← Назад</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Документ</Text>
          <View style={{ width: rs(70) }} />
        </View>
        <View style={styles.notFound}>
          <Text style={{ color: Colors.textMuted }}>Документ не найден</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{content.title}</Text>
        <View style={{ width: rs(70) }} />
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: rs(16),
    paddingVertical: rs(14),
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backBtn: { width: rs(70) },
  backTxt: { fontSize: rf(15), color: '#6B7280', fontWeight: '500' },
  headerTitle: {
    fontSize: rf(15),
    fontWeight: '700',
    color: '#111827',
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
    width: rs(52),
    height: rs(52),
    borderRadius: rs(26),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: rs(12),
  },
  libraryTitle: {
    fontSize: rf(23),
    lineHeight: rf(29),
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  librarySubtitle: {
    marginTop: rs(7),
    maxWidth: rs(330),
    fontSize: rf(14),
    lineHeight: rf(20),
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  libraryList: { gap: rs(10) },
  libraryRow: {
    minHeight: rs(72),
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    borderRadius: rs(14),
    backgroundColor: '#FFFFFF',
    paddingHorizontal: rs(14),
    paddingVertical: rs(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(12),
  },
  libraryRowIcon: {
    width: rs(38),
    height: rs(38),
    borderRadius: rs(19),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  libraryRowText: { flex: 1, minWidth: 0 },
  libraryRowTitle: {
    fontSize: rf(15),
    lineHeight: rf(20),
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  libraryRowVersion: {
    marginTop: rs(3),
    fontSize: rf(12.5),
    color: Colors.textMuted,
  },
  libraryNote: {
    marginTop: rs(18),
    fontSize: rf(12.5),
    lineHeight: rf(18),
    color: Colors.textMuted,
    textAlign: 'center',
  },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: rs(20), paddingBottom: rs(40), gap: rs(16) },
  docTitle: { fontSize: rf(20), fontWeight: '800', color: '#111827', lineHeight: rf(26) },
  section: { gap: rs(6) },
  heading: { fontSize: rf(15), fontWeight: '700', color: '#111827' },
  version: { fontSize: rf(12.5), color: Colors.textMuted, marginTop: rs(-8) },
  docBody: { fontSize: rf(15), color: '#374151', lineHeight: rf(24) },
});
