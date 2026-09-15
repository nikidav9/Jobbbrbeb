import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, AppState } from 'react-native';
import Svg, { Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors, Radius } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { dbGetUserById, dbTgPrepareLink } from '@/services/db';
import { isTelegramMiniApp } from '@/lib/telegram';

import { rs, rf } from '@/constants/scale';

const BOT_URL = 'https://t.me/JobToo_bot';

function TgLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="tgBanGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2AABEE" />
          <Stop offset="1" stopColor="#229ED9" />
        </LinearGradient>
      </Defs>
      <Circle cx="12" cy="12" r="12" fill="url(#tgBanGrad)" />
      <Path
        d="M5.45 11.9l11.2-4.32c.52-.19.98.12.81.9l-1.91 9c-.14.64-.52.8-1.05.5l-2.91-2.15-1.4 1.35c-.16.16-.29.29-.59.29l.21-2.98 5.42-4.9c.24-.21-.05-.33-.37-.12l-6.7 4.22-2.89-.9c-.63-.2-.64-.63.18-.89z"
        fill="#fff"
      />
      <Path d="M9.81 16.47l.21-2.98 1.3 1.63-1.51 1.35z" fill="#C8DAEA" />
    </Svg>
  );
}

/**
 * Плашка в формах создания смены/вакансии: напоминает директору привязать
 * Telegram, чтобы отклики приходили карточками с кнопками одобрения.
 * Показывается только работодателям без привязки и вне Mini App.
 */
export function TelegramLinkBanner() {
  const app = useApp();
  const userId = app?.currentUser?.id ?? null;
  const isEmployer = app?.currentUser?.role === 'employer';
  const [linked, setLinked] = useState<boolean>(!!app?.currentUser?.telegramId);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (!userId || linked) return;
    let cancelled = false;
    const check = () => {
      dbGetUserById(userId).then(u => { if (!cancelled && u?.telegramId) setLinked(true); }).catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
    return () => { cancelled = true; sub.remove(); };
  }, [userId, linked]);

  if (!userId || !isEmployer || linked || isTelegramMiniApp()) return null;

  const openTelegram = () => {
    setLinkError('');
    // Как и большая кнопка в шапке, заранее регистрируем намерение привязки:
    // если чат с ботом уже существовал, Telegram может прислать голый /start.
    void dbTgPrepareLink(userId).catch(() => {
      setLinkError('Не удалось подготовить привязку. Проверьте связь и попробуйте ещё раз.');
    });
    Linking.openURL(`${BOT_URL}?start=link_${userId}`).catch(() => {
      setLinkError('Не удалось открыть Telegram. Откройте вручную: t.me/JobToo_bot');
    });
  };

  return (
    <TouchableOpacity
      style={st.banner}
      onPress={openTelegram}
      activeOpacity={0.85}
    >
      <TgLogo size={34} />
      <View style={{ flex: 1 }}>
        <Text style={st.title}>Привяжите Telegram</Text>
        {linkError ? (
          <Text style={st.error}>{linkError}</Text>
        ) : (
          <Text style={st.sub}>Отклики на эту вакансию придут вам в Телеграм с кнопками «Одобрить / Отклонить»</Text>
        )}
      </View>
      <View style={st.cta}><Text style={st.ctaTxt}>Привязать</Text></View>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    backgroundColor: '#EFF8FF', borderWidth: 1, borderColor: '#BEE3FF',
    borderRadius: Radius.lg, padding: rs(12), marginBottom: rs(14),
  },
  title: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  sub: { fontSize: rf(12), color: Colors.textSecondary, marginTop: rs(2), lineHeight: rf(16) },
  error: { fontSize: rf(12), color: Colors.red, marginTop: rs(2), lineHeight: rf(16) },
  cta: {
    backgroundColor: '#2AABEE', borderRadius: rs(100),
    paddingHorizontal: rs(12), paddingVertical: rs(7),
  },
  ctaTxt: { color: '#fff', fontSize: rf(13), fontWeight: '700' },
});
