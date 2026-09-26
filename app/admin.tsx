import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useApp } from '@/hooks/useApp';

import { rs, rf } from '@/constants/scale';
import { BackButton, BACK_BUTTON_SIZE } from '@/components/ui/BackButton';

const sb = () => getSupabaseClient();

const ADMIN_PHONE = '89933431523';

interface Complaint {
  id: string;
  reporter_id: string;
  reporter_phone: string;
  reporter_company?: string;
  target_id: string;
  target_phone: string;
  target_company?: string;
  complaint_type: string;
  description?: string;
  created_at: string;
}

interface AdminUser {
  id: string;
  phone: string;
  first_name: string;
  last_name: string;
  role: string;
  company?: string;
  is_blocked: boolean;
  password?: string;
}

interface AdminVacancy {
  id: string;
  title: string;
  company: string;
  status: string;
  employer_id: string;
  date?: string;
  created_at: string;
}

interface AdminPermVacancy {
  id: string;
  title: string;
  company: string;
  status: string;
  employer_id: string;
  salary: number;
  schedule: string;
  metro_station?: string;
  created_at: string;
}

type Tab = 'worker-complaints' | 'employer-complaints' | 'users' | 'vacancies' | 'perm-vacancies';

export default function AdminScreen() {
  const router = useRouter();
  const { currentUser } = useApp();

  const [tab, setTab] = useState<Tab>('worker-complaints');
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [vacancies, setVacancies] = useState<AdminVacancy[]>([]);
  const [permVacancies, setPermVacancies] = useState<AdminPermVacancy[]>([]);
  const [loading, setLoading] = useState(true);

  // Access guard
  const isAdmin = currentUser?.phone === ADMIN_PHONE;

  useEffect(() => {
    if (!isAdmin) return;
    loadAll();
  }, [isAdmin]);

  const loadAll = async () => {
    setLoading(true);
    const [
      { data: c },
      { data: u },
      { data: v },
      { data: pv },
    ] = await Promise.all([
      sb().from('jm_complaints').select('*').order('created_at', { ascending: false }),
      sb().from('jm_users').select('id,phone,first_name,last_name,role,company,is_blocked,password').order('created_at', { ascending: false }),
      sb().from('jm_vacancies').select('id,title,company,status,employer_id,date,created_at').order('created_at', { ascending: false }),
      sb().from('jm_perm_vacancies').select('id,title,company,status,employer_id,salary,schedule,metro_station,created_at').order('created_at', { ascending: false }),
    ]);
    setComplaints((c ?? []) as Complaint[]);
    setUsers((u ?? []) as AdminUser[]);
    setVacancies((v ?? []) as AdminVacancy[]);
    setPermVacancies((pv ?? []) as AdminPermVacancy[]);
    setLoading(false);
  };

  // ── Not admin ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <BackButton />
          <Text style={styles.headerTitle}>Администрирование</Text>
          <View style={{ width: BACK_BUTTON_SIZE }} />
        </View>
        <View style={styles.center}>
          <Text style={{ fontSize: rf(48) }}>🔒</Text>
          <Text style={[styles.emptyTxt, { marginTop: 12, fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary }]}>
            Доступ запрещён
          </Text>
          <Text style={[styles.emptyTxt, { marginTop: 6 }]}>
            Эта страница доступна только администратору
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  const blockUser = async (userId: string, block: boolean) => {
    await sb().from('jm_users').update({ is_blocked: block }).eq('id', userId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_blocked: block } : u));
  };

  const deleteUser = async (userId: string) => {
    Alert.alert(
      'Удалить пользователя',
      'Это действие нельзя отменить. Удалить пользователя?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            await sb().from('jm_users').delete().eq('id', userId);
            setUsers(prev => prev.filter(u => u.id !== userId));
          },
        },
      ]
    );
  };

  const deleteAllUsersExceptAdmin = async () => {
    const nonAdminUsers = users.filter(u => u.phone !== ADMIN_PHONE);
    if (nonAdminUsers.length === 0) {
      Alert.alert('Нет пользователей для удаления');
      return;
    }
    Alert.alert(
      'Удалить всех кроме админа',
      `Будет удалено ${nonAdminUsers.length} пользователей. Это нельзя отменить.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить всех',
          style: 'destructive',
          onPress: async () => {
            const ids = nonAdminUsers.map(u => u.id);
            await sb().from('jm_users').delete().in('id', ids);
            setUsers(prev => prev.filter(u => u.phone === ADMIN_PHONE));
          },
        },
      ]
    );
  };

  const closeVacancy = async (id: string) => {
    await sb().from('jm_vacancies').update({ status: 'closed' }).eq('id', id);
    setVacancies(prev => prev.map(v => v.id === id ? { ...v, status: 'closed' } : v));
  };

  const closePermVacancy = async (id: string) => {
    await sb().from('jm_perm_vacancies').update({ status: 'closed' }).eq('id', id);
    setPermVacancies(prev => prev.map(v => v.id === id ? { ...v, status: 'closed' } : v));
  };

  const deletePermVacancy = async (id: string) => {
    Alert.alert('Удалить вакансию', 'Удалить постоянную вакансию?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await sb().from('jm_perm_vacancies').delete().eq('id', id);
          setPermVacancies(prev => prev.filter(v => v.id !== id));
        },
      },
    ]);
  };

  // ── Renders ────────────────────────────────────────────────────────────────

  const workerComplaints = complaints.filter(c => c.complaint_type === 'worker');
  const employerComplaints = complaints.filter(c => c.complaint_type === 'employer');

  const formatDT = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const renderComplaint = ({ item }: { item: Complaint }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>От:</Text>
        <Text style={styles.cardVal}>{item.reporter_phone}{item.reporter_company ? ` · ${item.reporter_company}` : ''}</Text>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>На:</Text>
        <Text style={styles.cardVal}>{item.target_phone}{item.target_company ? ` · ${item.target_company}` : ''}</Text>
      </View>
      {item.description ? (
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Причина:</Text>
          <Text style={[styles.cardVal, { flex: 1 }]}>{item.description}</Text>
        </View>
      ) : null}
      <Text style={styles.cardDate}>{formatDT(item.created_at)}</Text>
    </View>
  );

  const renderUser = ({ item }: { item: AdminUser }) => (
    <View style={[styles.card, item.is_blocked && styles.blockedCard]}>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>{item.role === 'worker' ? '👷' : '🏢'}</Text>
        <Text style={styles.cardVal}>{item.first_name} {item.last_name}</Text>
        {item.is_blocked ? <View style={styles.blockedBadge}><Text style={styles.blockedBadgeTxt}>Заблокирован</Text></View> : null}
        <View style={[styles.roleBadge, { backgroundColor: item.role === 'worker' ? Colors.primaryLight : '#EDE9FE' }]}>
          <Text style={[styles.roleBadgeTxt, { color: item.role === 'worker' ? Colors.primary : '#7C3AED' }]}>
            {item.role === 'worker' ? 'Работник' : 'Работодатель'}
          </Text>
        </View>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>Тел:</Text>
        <Text style={styles.cardVal}>{item.phone}</Text>
      </View>
      {/* Пароль здесь больше не показываем. Ради этой строчки список
          пользователей приезжал на устройство вместе с паролями всех —
          а пропуск к этому запросу лежит в бандле сайта, открытый. */}
      {item.company ? (
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Компания:</Text>
          <Text style={styles.cardVal}>{item.company}</Text>
        </View>
      ) : null}
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.actionBtn, item.is_blocked ? styles.unblockBtn : styles.blockBtn, { flex: 1 }]}
          onPress={() => blockUser(item.id, !item.is_blocked)}
        >
          <Text style={[styles.actionBtnTxt, item.is_blocked ? { color: Colors.green } : { color: Colors.red }]}>
            {item.is_blocked ? 'Разблокировать' : 'Заблокировать'}
          </Text>
        </TouchableOpacity>
        {item.phone !== ADMIN_PHONE && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn, { flex: 1 }]}
            onPress={() => deleteUser(item.id)}
          >
            <Text style={[styles.actionBtnTxt, { color: Colors.red }]}>Удалить</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderVacancy = ({ item }: { item: AdminVacancy }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>⚡</Text>
        <Text style={[styles.cardVal, { flex: 1, fontWeight: '700' }]}>{item.title}</Text>
        <View style={[styles.statusDot, { backgroundColor: item.status === 'open' ? Colors.green : Colors.textMuted }]} />
        <Text style={[styles.cardVal, { color: item.status === 'open' ? Colors.green : Colors.textMuted, fontSize: rf(12) }]}>
          {item.status === 'open' ? 'Открыта' : 'Закрыта'}
        </Text>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>Компания:</Text>
        <Text style={styles.cardVal}>{item.company}</Text>
      </View>
      {item.date ? (
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Дата:</Text>
          <Text style={styles.cardVal}>{item.date}</Text>
        </View>
      ) : null}
      <Text style={styles.cardDate}>{formatDT(item.created_at)}</Text>
      {item.status === 'open' ? (
        <TouchableOpacity style={[styles.actionBtn, styles.blockBtn]} onPress={() => closeVacancy(item.id)}>
          <Text style={[styles.actionBtnTxt, { color: Colors.red }]}>Закрыть вакансию</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderPermVacancy = ({ item }: { item: AdminPermVacancy }) => (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: '#7C3AED' }]}>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>💼</Text>
        <Text style={[styles.cardVal, { flex: 1, fontWeight: '700' }]}>{item.title}</Text>
        <View style={[styles.statusDot, { backgroundColor: item.status === 'open' ? Colors.green : Colors.textMuted }]} />
        <Text style={[styles.cardVal, { color: item.status === 'open' ? Colors.green : Colors.textMuted, fontSize: rf(12) }]}>
          {item.status === 'open' ? 'Открыта' : 'Закрыта'}
        </Text>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>Компания:</Text>
        <Text style={styles.cardVal}>{item.company}</Text>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>Зарплата:</Text>
        <Text style={[styles.cardVal, { color: Colors.green, fontWeight: '700' }]}>
          {item.salary.toLocaleString('ru-RU')} ₽/мес
        </Text>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>График:</Text>
        <Text style={styles.cardVal}>{item.schedule}</Text>
      </View>
      {item.metro_station ? (
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Метро:</Text>
          <Text style={styles.cardVal}>🚇 {item.metro_station}</Text>
        </View>
      ) : null}
      <Text style={styles.cardDate}>{formatDT(item.created_at)}</Text>
      <View style={styles.btnRow}>
        {item.status === 'open' ? (
          <TouchableOpacity style={[styles.actionBtn, styles.blockBtn, { flex: 1 }]} onPress={() => closePermVacancy(item.id)}>
            <Text style={[styles.actionBtnTxt, { color: Colors.red }]}>Закрыть</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn, { flex: 1 }]} onPress={() => deletePermVacancy(item.id)}>
          <Text style={[styles.actionBtnTxt, { color: Colors.red }]}>Удалить</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'worker-complaints',   label: '👷 Жалобы на работников',     count: workerComplaints.length },
    { key: 'employer-complaints', label: '🏢 Жалобы на работодателей',   count: employerComplaints.length },
    { key: 'users',               label: '👥 Пользователи',              count: users.length },
    { key: 'vacancies',           label: '⚡ Смены',                     count: vacancies.length },
    { key: 'perm-vacancies',      label: '💼 Постоянные',                count: permVacancies.length },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>Администрирование</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TouchableOpacity
            onPress={() => router.push('/analytics' as any)}
            style={{ backgroundColor: Colors.primaryLight, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}
          >
            <Text style={{ fontSize: rf(13), color: Colors.primary, fontWeight: '600' }}>📊 Аналитика</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={loadAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.refreshBtn}>↻</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{users.length}</Text>
          <Text style={styles.statLbl}>Польз.</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{vacancies.filter(v => v.status === 'open').length}</Text>
          <Text style={styles.statLbl}>Смены</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{permVacancies.filter(v => v.status === 'open').length}</Text>
          <Text style={styles.statLbl}>Пост. вак.</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statNum, complaints.length > 0 && { color: Colors.red }]}>{complaints.length}</Text>
          <Text style={styles.statLbl}>Жалобы</Text>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabBtnTxt, tab === t.key && styles.tabBtnTxtActive]}>
              {t.label}
              {t.count > 0 ? ` (${t.count})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <>
          {tab === 'users' ? (
            <>
              <View style={styles.bulkActions}>
                <TouchableOpacity style={styles.bulkBtn} onPress={deleteAllUsersExceptAdmin}>
                  <Text style={styles.bulkBtnTxt}>Удалить всех кроме админа</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={users}
                keyExtractor={u => u.id}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                renderItem={renderUser}
              />
            </>
          ) : tab === 'vacancies' ? (
            <FlatList
              data={vacancies}
              keyExtractor={v => v.id}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              renderItem={renderVacancy}
              ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyTxt}>Нет смен</Text></View>}
            />
          ) : tab === 'perm-vacancies' ? (
            <FlatList
              data={permVacancies}
              keyExtractor={v => v.id}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              renderItem={renderPermVacancy}
              ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyTxt}>Нет постоянных вакансий</Text></View>}
            />
          ) : (
            <FlatList
              data={tab === 'worker-complaints' ? workerComplaints : employerComplaints}
              keyExtractor={i => i.id}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              renderItem={renderComplaint}
              ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyTxt}>Жалоб нет</Text></View>}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: rs(16), paddingVertical: rs(14),
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  headerTitle: { fontSize: rf(16), fontWeight: '800', color: Colors.textPrimary },
  refreshBtn: { fontSize: rf(22), color: Colors.primary, fontWeight: '700', width: rs(40), textAlign: 'right' },

  statsBar: {
    flexDirection: 'row', paddingHorizontal: rs(16), paddingVertical: rs(12),
    backgroundColor: Colors.surface, gap: 0,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  statItem: { flex: 1, alignItems: 'center', gap: rs(2) },
  statNum: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary },
  statLbl: { fontSize: rf(10), color: Colors.textMuted, textTransform: 'uppercase', fontWeight: '600' },

  tabBar: { borderBottomWidth: 1, borderBottomColor: Colors.divider, flexGrow: 0 },
  tabBarContent: { paddingHorizontal: rs(12), paddingVertical: rs(8), gap: rs(8) },
  tabBtn: {
    paddingHorizontal: rs(14), paddingVertical: rs(8), borderRadius: rs(100),
    backgroundColor: Colors.surface,
  },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabBtnTxt: { fontSize: rf(13), color: Colors.textMuted, fontWeight: '500' },
  tabBtnTxtActive: { color: '#fff', fontWeight: '700' },

  list: { padding: rs(16), gap: rs(10), paddingBottom: rs(100) },
  card: { backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: rs(14), ...Shadow.card, gap: rs(8) },
  blockedCard: { borderWidth: 1.5, borderColor: Colors.red, opacity: 0.8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8), flexWrap: 'wrap' },
  cardLabel: { fontSize: rf(12), color: Colors.textMuted, fontWeight: '500', minWidth: rs(60) },
  cardVal: { fontSize: rf(13), color: Colors.textPrimary, fontWeight: '500' },
  cardDate: { fontSize: rf(11), color: Colors.textMuted },
  statusDot: { width: rs(8), height: rs(8), borderRadius: rs(4) },

  blockedBadge: { backgroundColor: '#FEE2E2', borderRadius: rs(100), paddingHorizontal: rs(8), paddingVertical: rs(2) },
  blockedBadgeTxt: { fontSize: rf(11), color: Colors.red, fontWeight: '600' },
  roleBadge: { borderRadius: rs(100), paddingHorizontal: rs(8), paddingVertical: rs(2) },
  roleBadgeTxt: { fontSize: rf(11), fontWeight: '600' },

  btnRow: { flexDirection: 'row', gap: rs(8), marginTop: rs(4) },
  actionBtn: {
    borderWidth: 1.5, borderRadius: rs(100),
    paddingVertical: rs(8), alignItems: 'center',
  },
  blockBtn: { borderColor: Colors.red },
  unblockBtn: { borderColor: Colors.green },
  deleteBtn: { borderColor: Colors.red },
  actionBtnTxt: { fontSize: rf(13), fontWeight: '600' },

  bulkActions: { padding: rs(16), borderBottomWidth: 1, borderBottomColor: Colors.divider },
  bulkBtn: { backgroundColor: Colors.red, paddingHorizontal: rs(16), paddingVertical: rs(10), borderRadius: Radius.md, alignItems: 'center' },
  bulkBtnTxt: { color: 'white', fontSize: rf(14), fontWeight: '600' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: rs(32) },
  emptyTxt: { fontSize: rf(15), color: Colors.textMuted, textAlign: 'center' },
});
