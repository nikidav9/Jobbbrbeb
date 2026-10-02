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

import { JT, JT_FONT } from '@/constants/jt';
import { rs, rf } from '@/constants/scale';
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
            : <Ionicons name="refresh" size={18} color={JT.ink} />}
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
              contentContainerStyle={[styles.list, messages.length === 0 && { flexGrow: 1 }]}
              ListEmptyComponent={!error ? (
                <View style={styles.emptyFill}>
                  <Ionicons name="mail-outline" size={48} color={JT.ink} />
                  <Text style={styles.emptyTitle}>Писем пока нет</Text>
                  <Text style={styles.emptySub}>Ответы работодателей на отклики придут сюда</Text>
                </View>
              ) : null}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={[styles.row, index === 0 && styles.rowFirst, index === messages.length - 1 && styles.rowLast]}
                  onPress={() => open(item)} activeOpacity={0.6}>
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

// Стиль JT, как «Отклики» (просьба владельца 02.10.2026): тёплый фон,
// заголовок фирменным шрифтом, кнопка обновления — круглая с тонким
// контуром, письма — в белой карточке с тёплым контуром, пустое — по центру.
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: JT.background },
  header: { paddingHorizontal: rs(16), paddingTop: rs(6), paddingBottom: rs(12), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: rf(20), fontFamily: JT_FONT.head, color: JT.ink },
  refreshBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: JT.ink, alignItems: 'center', justifyContent: 'center' },
  banner: { marginHorizontal: rs(20), marginBottom: rs(14), paddingVertical: rs(12), paddingHorizontal: rs(16), backgroundColor: JT.accentSoft, borderRadius: rs(18) },
  label: { color: JT.textSecondary, fontFamily: JT_FONT.medium, fontSize: rf(12), marginBottom: 2 },
  address: { fontSize: rf(15), fontFamily: JT_FONT.heavy, color: JT.ink },
  notice: { marginTop: 6, color: '#8B4A2B', fontFamily: JT_FONT.medium, fontSize: rf(13), lineHeight: rf(18) },
  loading: { marginTop: 40 },
  error: { marginBottom: rs(12), color: '#B91C1C', fontFamily: JT_FONT.medium },
  list: { paddingHorizontal: rs(20), paddingBottom: rs(32) },
  emptyFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(24), paddingBottom: rs(120), minHeight: rs(260) },
  emptyTitle: { fontFamily: JT_FONT.head, fontSize: rf(18), lineHeight: rf(24), color: JT.ink, textAlign: 'center', marginTop: rs(10) },
  emptySub: { fontFamily: JT_FONT.medium, fontSize: rf(14), color: JT.textTertiary, marginTop: rs(6), textAlign: 'center', lineHeight: rf(20) },
  // Строка как в почтовых приложениях: отправитель, тема и одна строка текста.
  // Строки складываются в одну белую карточку: у первой — верх, у последней — низ.
  row: {
    flexDirection: 'row', paddingVertical: rs(12), paddingRight: rs(16), paddingLeft: rs(10),
    backgroundColor: JT.surface, borderColor: '#E3D9CC', borderLeftWidth: 1.5, borderRightWidth: 1.5,
    borderBottomWidth: 1.5, borderBottomColor: '#EFE7DC',
  },
  rowFirst: { borderTopWidth: 1.5, borderTopLeftRadius: rs(22), borderTopRightRadius: rs(22) },
  rowLast: { borderBottomColor: '#E3D9CC', borderBottomLeftRadius: rs(22), borderBottomRightRadius: rs(22) },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7, marginRight: 8, backgroundColor: 'transparent' },
  dotUnread: { backgroundColor: JT.accent },
  rowMain: { flex: 1, minWidth: 0 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  rowSender: { flex: 1, fontFamily: JT_FONT.bold, fontSize: rf(15), color: JT.ink },
  unread: { fontFamily: JT_FONT.heavy },
  date: { fontFamily: JT_FONT.medium, fontSize: rf(12), color: JT.textTertiary },
  rowSubject: { fontFamily: JT_FONT.semi, fontSize: rf(14), color: JT.ink, marginTop: 2 },
  preview: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: JT.textTertiary, marginTop: 1 },
  content: { padding: rs(20) },
  subject: { fontSize: rf(20), fontFamily: JT_FONT.head, lineHeight: rf(26), color: JT.ink, marginBottom: 12 },
  sender: { fontFamily: JT_FONT.bold, color: JT.ink, marginBottom: 4 },
  meta: { fontFamily: JT_FONT.medium, fontSize: rf(13), color: JT.textTertiary, marginBottom: 2 },
  body: { fontFamily: JT_FONT.medium, fontSize: rf(16), lineHeight: rf(23), color: JT.ink, marginTop: 16 },
  full: { flex: 1 },
  fullHead: { paddingHorizontal: rs(20), paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1.5, borderBottomColor: '#E3D9CC' },
  link: { color: JT.accent, textDecorationLine: 'underline' },
});
