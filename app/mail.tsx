import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { JupiterEmail, jupiterMailbox, jupiterMailList, jupiterMailRead } from '@/services/db';
import { Colors } from '@/constants/theme';

export default function JupiterMail() {
  const router = useRouter();
  const { currentUser } = useApp();
  const [address, setAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<JupiterEmail[]>([]);
  const [selected, setSelected] = useState<JupiterEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const uid = currentUser?.id;

  const refresh = useCallback(async () => {
    if (!uid || currentUser?.isGuest) { setLoading(false); return; }
    try {
      const [box, letters] = await Promise.all([jupiterMailbox(uid), jupiterMailList(uid)]);
      setAddress(box.address);
      setReady(box.ready);
      setMessages(letters);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Не удалось получить письма');
    } finally { setLoading(false); }
  }, [uid, currentUser?.isGuest]);

  useEffect(() => { refresh(); }, [refresh]);

  const open = async (message: JupiterEmail) => {
    setSelected(message);
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
        <TouchableOpacity onPress={() => selected ? setSelected(null) : router.back()} accessibilityLabel="Назад">
          <Ionicons name="arrow-back" size={26} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>{selected ? 'Письмо' : 'Почта JobToo'}</Text>
        <TouchableOpacity onPress={refresh} accessibilityLabel="Обновить почту">
          <Ionicons name="refresh" size={23} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>
      {selected ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.subject}>{selected.subject || '(Без темы)'}</Text>
          <Text style={styles.sender}>От: {selected.sender}</Text>
          <Text style={styles.meta}>Кому: {address}</Text>
          <Text style={styles.meta}>{new Date(selected.received_at).toLocaleString('ru-RU')}</Text>
          <Text selectable style={styles.body}>{selected.body || 'В письме нет текстовой части.'}</Text>
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
              refreshing={loading}
              onRefresh={refresh}
              ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
              ListEmptyComponent={!error ? <Text style={styles.empty}>Пока нет писем от работодателей.</Text> : null}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => open(item)}>
                  <View style={styles.rowHead}>
                    <Text numberOfLines={1} style={[styles.rowSender, !item.read_at && styles.unread]}>{item.sender}</Text>
                    <Text style={styles.date}>{new Date(item.received_at).toLocaleDateString('ru-RU')}</Text>
                  </View>
                  <Text numberOfLines={1} style={[styles.rowSubject, !item.read_at && styles.unread]}>{item.subject || '(Без темы)'}</Text>
                  <Text numberOfLines={2} style={styles.preview}>{item.body}</Text>
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
  header: { paddingHorizontal: 20, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 21, fontWeight: '700', color: Colors.textPrimary },
  banner: { margin: 18, padding: 18, backgroundColor: '#FFF3EC', borderRadius: 20 },
  label: { color: '#6B7280', marginBottom: 5 },
  address: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  notice: { marginTop: 10, color: '#8B4A2B', lineHeight: 20 },
  loading: { marginTop: 40 },
  error: { margin: 20, color: '#B91C1C' },
  empty: { textAlign: 'center', marginTop: 50, color: '#6B7280' },
  row: { padding: 19, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  rowSender: { flex: 1, fontSize: 16, color: Colors.textPrimary },
  unread: { fontWeight: '700' },
  date: { color: '#6B7280' },
  rowSubject: { fontSize: 16, color: Colors.textPrimary, marginTop: 8 },
  preview: { color: '#6B7280', marginTop: 5, lineHeight: 20 },
  content: { padding: 20 },
  subject: { fontSize: 23, fontWeight: '700', color: Colors.textPrimary, marginBottom: 20 },
  sender: { fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  meta: { color: '#6B7280', marginBottom: 6 },
  body: { fontSize: 17, lineHeight: 26, color: Colors.textPrimary, marginTop: 24 },
});
