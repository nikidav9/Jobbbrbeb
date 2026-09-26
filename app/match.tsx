import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';

import { rs, rf } from '@/constants/scale';

// Single confetti dot — hooks called at component level (Rules of Hooks compliant)
function ConfettiDot({ index, color, offsetX, size }: { index: number; color: string; offsetX: number; size: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const delay = index * 60;
    const duration = 1200 + (index * 97) % 800;
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    }, delay);
  }, []);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 280] });
  const translateX = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, offsetX / 2, offsetX] });
  const opacity = anim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.8, 0] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        width: size,
        height: size,
        borderRadius: 100,
        backgroundColor: color,
        transform: [{ translateX }, { translateY }],
        opacity,
      }}
    />
  );
}

const CONFETTI_COLORS = [Colors.primary, Colors.blue, Colors.green, Colors.purple, '#FFD700'];
const CONFETTI_DOTS = Array.from({ length: 20 }, (_, i) => ({
  index: i,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  offsetX: ((i * 47 + 13) % 300) - 150,
  size: 8 + (i * 13) % 6,
}));

function Confetti() {
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300, overflow: 'hidden' }} pointerEvents="none">
      {CONFETTI_DOTS.map(d => (
        <ConfettiDot key={d.index} {...d} />
      ))}
    </View>
  );
}

export default function MatchScreen() {
  const router = useRouter();
  const { vacancyId, chatId } = useLocalSearchParams<{ vacancyId: string; chatId: string }>();
  const { currentUser, vacancies, users, chats } = useApp();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const vac = vacancies.find(v => v.id === vacancyId);
  const employer = users.find(u => u.id === vac?.employerId);

  if (!vac || !currentUser) return null;

  const openChat = () => {
    router.replace('/(tabs)/chats');
    setTimeout(() => {
      if (chatId) router.push({ pathname: '/chat-room', params: { chatId } });
    }, 300);
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <Confetti />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.matchTitle}>Мэтч!</Text>
          <Text style={styles.matchSubtitle}>
            {vac.company} хотят взять вас на смену!
          </Text>

          {/* Contact card */}
          <View style={styles.infoCard}>
            <Text style={styles.cardBadge}>КОНТАКТ</Text>
            <View style={styles.divider} />
            <Text style={styles.contactName}>{employer ? `${employer.firstName} ${employer.lastName}` : vac.company}</Text>
            <Text style={styles.contactPhone}>{employer?.phone || '—'}</Text>
          </View>

          {/* Vacancy card */}
          <View style={styles.infoCard}>
            <Text style={styles.cardBadge}>ДЕТАЛИ СМЕНЫ</Text>
            <View style={styles.divider} />
            <Text style={styles.vacTitle}>{vac.title}</Text>
            <Text style={styles.vacMeta}>
              🚇 {vac.metroStation} · 📅 {vac.date} · ⏰ {vac.timeStart}–{vac.timeEnd}
            </Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={openChat}>
            <Text style={styles.primaryBtnText}>💬 Открыть чат</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Продолжить поиск</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  body: { padding: rs(24), alignItems: 'center', gap: rs(16), paddingBottom: rs(40) },
  emoji: { fontSize: rf(64), marginTop: rs(20) },
  matchTitle: { fontSize: rf(38), fontWeight: '800', color: Colors.primary, letterSpacing: -1 },
  matchSubtitle: { fontSize: rf(15), color: '#374151', textAlign: 'center', lineHeight: rf(22) },
  infoCard: { width: '100%', backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(16), ...Shadow.card, gap: rs(8) },
  cardBadge: { fontSize: rf(10), fontWeight: '700', color: Colors.primary, letterSpacing: 1, textTransform: 'uppercase' },
  divider: { height: 1, backgroundColor: Colors.divider },
  contactName: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },
  contactPhone: { fontSize: rf(15), fontWeight: '600', color: Colors.primary },
  vacTitle: { fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  vacMeta: { fontSize: rf(13), color: '#374151' },
  primaryBtn: {
    width: '100%', backgroundColor: Colors.primary,
    borderRadius: rs(100), paddingVertical: rs(16), alignItems: 'center', marginTop: rs(8),
  },
  primaryBtnText: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  secondaryBtn: {
    width: '100%', backgroundColor: Colors.bg,
    borderRadius: rs(100), borderWidth: 1.5, borderColor: Colors.inputBorder,
    paddingVertical: rs(16), alignItems: 'center',
  },
  secondaryBtnText: { color: Colors.textPrimary, fontSize: rf(16), fontWeight: '600' },
});
