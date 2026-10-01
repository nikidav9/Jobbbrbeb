import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/hooks/useApp';
import { JupiterEmail, jupiterMailbox, jupiterMailHtml, jupiterMailList, jupiterMailRead } from '@/services/db';
import { MailHtmlView } from '@/components/feature/MailHtmlView';
import { Colors } from '@/constants/theme';
import { mailDate, mailPreview, senderName, splitMailLinks } from '@/services/mailLinks';
import { BackButton } from '@/components/ui/BackButton';

import { JT_FONT } from '@/constants/jt';
export default function JupiterMail() {
  const { currentUser, showToast } = useApp();
  const [address, setAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<JupiterEmail[]>([]);
  const [selected, setSelected] = useState<JupiterEmail | null>(null);
  const [loading, setLoading] = useState(true);
  // Отдельно от первой загрузки: кнопка и «потянуть вниз» должны показывать,
  // что обновление идёт, а список при этом не исчезает.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  // Письмо целиком (HTML): null — ещё грузим, '' — у письма только текст.
  const [html, setHtml] = useState<string | null>(null);
  const openedId = useRef<string | null>(null);
  const uid = currentUser?.id;

  const load = useCallback(async (): Promise<boolean> => {
    if (!uid || currentUser?.isGuest) { setLoading(false); return false; }
    try {
      const [box, letters] = await Promise.all([jupiterMailbox(uid), jupiterMailList(uid)]);
      setAddress(box.address);
      setReady(box.ready);
      setMessages(letters);
      setError('');
      return true;
    } catch (e: any) {
      setError(e?.message || 'Не удалось получить письма');
      return false;
    } finally { setLoading(false); }
  }, [uid, currentUser?.isGuest]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const ok = await load();
    setRefreshing(false);
    showToast(ok ? 'Почта обновлена' : 'Не удалось обновить почту', ok ? 'success' : 'error');
  }, [load, refreshing, showToast]);

  const open = async (message: JupiterEmail) => {
    setSelected(message);
    setHtml(null);
    if (uid) {
      // Ответ по прежнему письму не должен лечь в открытое следующим.
      openedId.current = message.id;
      jupiterMailHtml(uid, message.id)
        .then(h => { if (openedId.current === message.id) setHtml(h); })
        .catch(() => { if (openedId.current === message.id) setHtml(''); });
    }
    if (!message.read_at && uid) {
      try {
        await jupiterMailRead(uid, message.id);
        setMessages(items => items.map(item => item.id === message.id
          ? { ...item, read_at: new Date().toISOString() } : item));
      } catch { /* Recheck read status on refresh. */ }
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <BackButton onPress={selected ? () => setSelected(null) : undefined} />
        <Text style={styles.heading}>{selected ? 'Письмо' : 'Почта JobToo'}</Text>
        <TouchableOpacity onPress={refresh} disabled={refreshing} style={styles.refreshBtn} accessibilityLabel="Обновить почту">
          {refreshing
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Ionicons name="refresh" size={22} color={Colors.textPrimary} />}
        </TouchableOpacity>
      </View>
      {selected && html ? (
        // Письмо целиком, как в почте: шапка сверху, само письмо — ниже.
        <View style={styles.full}>
          <View style={styles.fullHead}>
            <Text style={styles.subject} numberOfLines={3}>{selected.subject || '(Без темы)'}</Text>
            <Text style={styles.sender} numberOfLines={1}>От: {selected.sender}</Text>
            <Text style={styles.meta}>{new Date(selected.received_at).toLocaleString('ru-RU')}</Text>
          </View>
          <MailHtmlView html={html} />
        </View>
      ) : selected && html === null ? (
        <ActivityIndicator style={styles.loading} color={Colors.primary} />
      ) : selected ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.subject}>{selected.subject || '(Без темы)'}</Text>
          <Text style={styles.sender}>От: {selected.sender}</Text>
          <Text style={styles.meta}>Кому: {address}</Text>
          <Text style={styles.meta}>{new Date(selected.received_at).toLocaleString('ru-RU')}</Text>
          <Text selectable style={styles.body}>
            {selected.body
              ? splitMailLinks(selected.body).map((part, i) => part.url ? (
                <Text key={i} style={styles.link} onPress={() => { Linking.openURL(part.url!).catch(() => {}); }}>
                  {part.text}
                </Text>
              ) : part.text)
              : 'В письме нет текстовой части.'}
          </Text>
        </ScrollView>
      ) : (
        <>
          <View style={styles.banner}>
            <Text style={styles.label}>Ваш адрес для откликов</Text>
            <Text selectable style={styles.address}>{address || 'Адрес создаётся…'}</Text>
            {!ready && <Text style={styles.notice}>Приём писем настраивается. Юпитер пока не отправляет внешние отклики.</Text>}
          </View>
          {loading ? <ActivityIndicator style={styles.loading} color={Colors.primary} /> : (
            <FlatList
              data={messages}
              keyExtractor={item => item.id}
              refreshing={refreshing}
              onRefresh={refresh}
              ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
              ListEmptyComponent={!error ? <Text style={styles.empty}>Пока нет писем от работодателей.</Text> : null}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => open(item)} activeOpacity={0.6}>
                  <View style={[styles.dot, !item.read_at && styles.dotUnread]} />
                  <View style={styles.rowMain}>
                    <View style={styles.rowHead}>
                      <Text numberOfLines={1} style={[styles.rowSender, !item.read_at && styles.unread]}>{senderName(item.sender)}</Text>
                      <Text style={styles.date}>{mailDate(item.received_at)}</Text>
                    </View>
                    <Text numberOfLines={1} style={[styles.rowSubject, !item.read_at && styles.unread]}>{item.subject || '(Без темы)'}</Text>
                    <Text numberOfLines={1} style={styles.preview}>{mailPreview(item.body)}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 19, fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  refreshBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  banner: { marginHorizontal: 16, marginBottom: 8, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#FFF3EC', borderRadius: 14 },
  label: { color: '#6B7280', fontFamily: JT_FONT.medium, fontSize: 12, marginBottom: 2 },
  address: { fontSize: 15, fontFamily: JT_FONT.bold, color: Colors.textPrimary },
  notice: { marginTop: 6, color: '#8B4A2B', fontFamily: JT_FONT.medium, fontSize: 13, lineHeight: 18 },
  loading: { marginTop: 40 },
  error: { margin: 16, color: '#B91C1C' },
  empty: { textAlign: 'center', marginTop: 50, color: '#6B7280' },
  // Строка как в почтовых приложениях: отправитель, тема и одна строка текста.
  row: { flexDirection: 'row', paddingVertical: 10, paddingRight: 16, paddingLeft: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 8, backgroundColor: 'transparent' },
  dotUnread: { backgroundColor: Colors.primary },
  rowMain: { flex: 1, minWidth: 0 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  rowSender: { flex: 1, fontFamily: JT_FONT.medium, fontSize: 15, color: Colors.textPrimary },
  unread: { fontFamily: JT_FONT.bold },
  date: { fontFamily: JT_FONT.medium, fontSize: 12, color: '#6B7280' },
  rowSubject: { fontFamily: JT_FONT.medium, fontSize: 14, color: Colors.textPrimary, marginTop: 2 },
  preview: { fontFamily: JT_FONT.medium, fontSize: 13, color: '#6B7280', marginTop: 1 },
  content: { padding: 16 },
  subject: { fontSize: 20, fontFamily: JT_FONT.bold, color: Colors.textPrimary, marginBottom: 12 },
  sender: { fontFamily: JT_FONT.bold, color: Colors.textPrimary, marginBottom: 4 },
  meta: { fontFamily: JT_FONT.medium, fontSize: 13, color: '#6B7280', marginBottom: 2 },
  body: { fontFamily: JT_FONT.medium, fontSize: 16, lineHeight: 23, color: Colors.textPrimary, marginTop: 16 },
  full: { flex: 1 },
  fullHead: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  link: { color: Colors.primary, textDecorationLine: 'underline' },
});
