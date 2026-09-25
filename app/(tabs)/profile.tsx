
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Modal, KeyboardAvoidingView, Platform, TextInput, Alert,
  ActivityIndicator, FlatList, LayoutAnimation, UIManager, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { ScoreCard } from '@/components/feature/ScoreCard';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { uploadAvatar } from '@/services/avatarUpload';
import { getInitials, nameColorFromString } from '@/services/storage';
import {
  dbGetRatingsForUser, dbChangePassword, dbDeleteAccount,
  dbGetConsent,
  dbGetResumeFiles, dbSaveResumeFile, dbSelectResumeFile, dbDeleteResumeFile,
  dbSignResumeFile, UserRating, type ResumeVaultItem,
} from '@/services/db';
import { LEGAL_DOCS, formatLegalDate } from '@/constants/legal';
import { getSupabaseClient } from '@/template';
import { resetOnboarding } from '@/components/OnboardingOverlay';
import { TabHeader } from '@/components/ui/TabHeader';
import GuestGate from '@/components/GuestGate';
import { AppInput } from '@/components/ui/AppInput';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { MetroPicker } from '@/components/feature/MetroPicker';
import { PersonalDetails, ResumeProfile, User } from '@/constants/types';
import { extractResumePdf, mergeResumeIntoUser } from '@/services/resumeImport';
import { METRO_LINES } from '@/constants/metro';
import { NotifBell } from '@/components/ui/NotifBell';
import { OnboardingTarget } from '@/components/OnboardingTarget';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { rs, rf } from '@/constants/scale';

const COMPANY_OPTIONS = ['Лавка'] as const;
type CompanyOption = typeof COMPANY_OPTIONS[number];

type EditSection = 'personal' | 'metro' | 'company' | 'bio' | null;
type ProfileTab = 'resume' | 'personal' | 'files' | 'reviews';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Плавное раскрытие секций. На старой архитектуре Android LayoutAnimation
// нужно включать вручную, иначе секции просто «прыгают».
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function StarRating({ rating, count, onPress }: { rating: number; count: number; onPress?: () => void }) {
  const content = (
    <View style={rS.row}>
      {[1, 2, 3, 4, 5].map(s => (
        <Text key={s} style={[rS.star, rating >= s - 0.5 ? rS.starFilled : rS.starEmpty]}>★</Text>
      ))}
      <Text style={rS.count}>
        {count > 0 ? `${rating.toFixed(1)} (${count} отз.)` : 'Нет оценок'}
      </Text>
      {count > 0 && onPress ? <Text style={rS.viewAll}>Смотреть все ›</Text> : null}
    </View>
  );
  if (onPress && count > 0) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const rS = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: rs(2), marginTop: rs(2) },
  star: { fontSize: rf(18) },
  starFilled: { color: '#FBBF24' },
  starEmpty: { color: '#E5E7EB' },
  count: { fontSize: rf(13), color: Colors.textMuted, marginLeft: rs(4) },
  viewAll: { fontSize: rf(12), color: Colors.primary, fontWeight: '600', marginLeft: rs(6) },
});

// ─── Ratings Modal ────────────────────────────────────────────────────────────
function RatingsModal({ userId, users, onClose }: { userId: string; users: any[]; onClose: () => void }) {
  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingsLoadFailed, setRatingsLoadFailed] = useState(false);
  const reviewsSwipe = useSwipeToDismiss(onClose);

  const fetchRatings = () => {
    setLoading(true);
    setRatingsLoadFailed(false);
    dbGetRatingsForUser(userId)
      .then(setRatings)
      .catch(() => setRatingsLoadFailed(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRatings(); }, [userId]);

  // Real-time: new rating arrives while modal is open → refresh instantly (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    try {
      const sb = getSupabaseClient();
      channel = sb
        // Сигнал от сервера вместо подписки на таблицу: к таблицам доступ
        // закрыт, а канал трансляции их не касается.
        .channel(`ratings:${userId}`)
        .on('broadcast', { event: 'refresh' }, fetchRatings)
        .subscribe();
    } catch (e) {
      console.warn('[RatingsModal] realtime subscription failed:', e);
    }
    return () => {
      try { channel?.unsubscribe(); } catch {}
    };
  }, [userId]);

  const avg = ratings.length > 0
    ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length
    : 0;

  const renderItem = ({ item }: { item: UserRating }) => {
    const reviewer = users.find(u => u.id === item.fromUserId);
    const name = reviewer
      ? `${reviewer.firstName} ${reviewer.lastName}`
      : (item.role === 'worker' ? 'Работник' : 'Работодатель');
    const color = reviewer ? nameColorFromString(reviewer.id) : '#9CA3AF';
    const initials = reviewer ? getInitials(name) : '?';
    const date = new Date(item.createdAt);
    const dateStr = `${date.getDate().toString().padStart(2,'0')}.${(date.getMonth()+1).toString().padStart(2,'0')}.${date.getFullYear()}`;

    return (
      <View style={rmS.card}>
        <View style={rmS.cardTop}>
          {reviewer?.avatarUrl ? (
            <View style={[rmS.avatar, { overflow: 'hidden' }]}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={rmS.avatarTxt}>{initials}</Text>
              </View>
            </View>
          ) : (
            <View style={[rmS.avatar, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={rmS.avatarTxt}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={rmS.name}>{name}</Text>
            <Text style={rmS.role}>{item.role === 'employer' ? 'Работодатель' : 'Работник'} · {dateStr}</Text>
          </View>
          <View style={rmS.starsRow}>
            {[1,2,3,4,5].map(s => (
              <Text key={s} style={[rmS.star, item.rating >= s ? rmS.starFilled : rmS.starEmpty]}>★</Text>
            ))}
          </View>
        </View>
        {item.reviewText ? (
          <Text style={rmS.review}>«{item.reviewText}»</Text>
        ) : (
          <Text style={rmS.noReview}>Комментарий не оставлен</Text>
        )}
      </View>
    );
  };

  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={rmS.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[rmS.sheet, reviewsSwipe.animStyle]}>
          <View {...reviewsSwipe.panHandlers}>
            <SheetHandle />
            <View style={rmS.header}>
              <Text style={rmS.title}>Мои отзывы</Text>
            </View>
          </View>

          {/* Summary */}
          {ratings.length > 0 ? (
            <View style={rmS.summary}>
              <Text style={rmS.summaryAvg}>{avg.toFixed(1)}</Text>
              <View>
                <View style={{ flexDirection: 'row', gap: 2 }}>
                  {[1,2,3,4,5].map(s => (
                    <Text key={s} style={[rmS.sumStar, avg >= s - 0.5 ? rmS.starFilled : rmS.starEmpty]}>★</Text>
                  ))}
                </View>
                <Text style={rmS.summaryCount}>{ratings.length} {ratings.length === 1 ? 'отзыв' : ratings.length < 5 ? 'отзыва' : 'отзывов'}</Text>
              </View>
            </View>
          ) : null}

          {loading ? (
            <View style={{ padding: 48, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : ratingsLoadFailed && ratings.length === 0 ? (
            <View style={rmS.empty}>
              <Text style={rmS.emptyTitle}>Не удалось загрузить отзывы</Text>
              <Text style={rmS.emptySub}>Проверьте связь и попробуйте ещё раз.</Text>
              <TouchableOpacity onPress={fetchRatings} activeOpacity={0.8}>
                <Text style={{ color: Colors.primary, fontWeight: '700', marginTop: rs(4) }}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : ratings.length === 0 ? (
            <View style={rmS.empty}>
              <Text style={{ fontSize: rf(44) }}>⭐</Text>
              <Text style={rmS.emptyTitle}>Отзывов пока нет</Text>
              <Text style={rmS.emptySub}>Оценки появятся после завершённых смен</Text>
            </View>
          ) : (
            <FlatList
              data={ratings}
              keyExtractor={r => r.id}
              renderItem={renderItem}
              contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const rmS = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.bg, borderTopLeftRadius: rs(24), borderTopRightRadius: rs(24), maxHeight: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: rs(20), paddingTop: rs(16), paddingBottom: rs(12) },
  title: { fontSize: rf(18), fontWeight: '800', color: Colors.textPrimary },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: rs(16),
    marginHorizontal: rs(16), marginBottom: rs(8),
    backgroundColor: '#FFFBEB', borderRadius: rs(14),
    padding: rs(14), borderWidth: 1, borderColor: '#FDE68A',
  },
  summaryAvg: { fontSize: rf(44), fontWeight: '800', color: '#92400E' },
  sumStar: { fontSize: rf(20) },
  starFilled: { color: '#FBBF24' },
  starEmpty: { color: '#E5E7EB' },
  summaryCount: { fontSize: rf(13), color: '#B45309', fontWeight: '600', marginTop: rs(2) },
  empty: { alignItems: 'center', padding: rs(48), gap: rs(10) },
  emptyTitle: { fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary },
  emptySub: { fontSize: rf(13), color: Colors.textMuted, textAlign: 'center' },
  card: { backgroundColor: Colors.surface, borderRadius: rs(14), padding: rs(14), gap: rs(10) },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  avatar: { width: rs(36), height: rs(36), borderRadius: rs(18) },
  avatarTxt: { color: '#fff', fontSize: rf(13), fontWeight: '700' },
  name: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  role: { fontSize: rf(11), color: Colors.textMuted, marginTop: rs(1) },
  starsRow: { flexDirection: 'row', gap: rs(1) },
  star: { fontSize: rf(16) },
  review: { fontSize: rf(13), color: Colors.textPrimary, lineHeight: rf(18), fontStyle: 'italic', paddingLeft: rs(4) },
  noReview: { fontSize: rf(12), color: Colors.textMuted, fontStyle: 'italic', paddingLeft: rs(4) },
});


type PersonalFieldKey = keyof PersonalDetails;

const PERSONAL_FIELD_LABELS: Record<PersonalFieldKey, string> = {
  middleName: 'Отчество',
  preferredName: 'Как к вам обращаться',
  // Legacy-поле из старой US-анкеты. Сохраняем совместимость с данными,
  // но отдельный пункт «Обращение» в русской анкете больше не показываем.
  title: 'Форма обращения',
  contactEmail: 'Email',
  links: 'Ссылки',
  citizenship: 'Гражданство',
  workAuthorization: 'Статус разрешения на работу',
  location: 'Местоположение',
  workAvailability: 'Когда вы готовы работать',
  relocation: 'Готовы к переезду?',
  driversLicense: 'Есть водительские права?',
  employmentRestrictions: 'Ограничения по трудоустройству',
};

const PERSONAL_MULTILINE = new Set<PersonalFieldKey>([
  'links',
  'employmentRestrictions',
]);

type PersonalChoice = { label: string; value: string };

const PERSONAL_FIELD_CHOICES: Partial<Record<PersonalFieldKey, PersonalChoice[]>> = {
  workAuthorization: [
    { label: 'Есть разрешение', value: 'Есть разрешение' },
    { label: 'Не требуется', value: 'Не требуется' },
    { label: 'Нет', value: 'Нет' },
  ],
  relocation: [
    { label: 'Да', value: 'Да' },
    { label: 'Нет', value: 'Нет' },
    { label: 'Готов(а) рассмотреть', value: 'Готов(а) рассмотреть' },
  ],
  driversLicense: [
    { label: 'Да', value: 'Да' },
    { label: 'Нет', value: 'Нет' },
  ],
};

const PERSONAL_FIELD_PLACEHOLDERS: Partial<Record<PersonalFieldKey, string>> = {
  middleName: 'Например, Сергеевич',
  preferredName: 'Например, Никита',
  contactEmail: 'name@example.com',
  links: 'Ссылка на портфолио, сайт или профиль',
  citizenship: 'Например, Россия',
  location: 'Например, Москва',
  workAvailability: 'Например, полная занятость, будни',
  employmentRestrictions: 'Опишите ограничение, если оно есть',
};

function normalizePersonalChoiceValue(field: PersonalFieldKey, value?: string): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (['yes', 'true'].includes(v)) return 'Да';
  if (['no', 'false'].includes(v)) return 'Нет';
  return value;
}

function PersonalRow({
  label, value, onPress, last = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[personalS.row, !last && personalS.rowBorder]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.72}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={personalS.rowLabel}>{label}</Text>
        <Text style={[personalS.rowValue, !value && personalS.rowValueEmpty]} numberOfLines={3}>
          {value || 'Не указано'}
        </Text>
      </View>
      {onPress ? <Ionicons name="create-outline" size={rf(18)} color={Colors.primary} /> : null}
    </TouchableOpacity>
  );
}

function PersonalAddCard({
  icon, title, subtitle, onPress,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={personalS.addCard} onPress={onPress} activeOpacity={0.75}>
      <View style={personalS.addIcon}>
        <Ionicons name={icon} size={rf(21)} color={Colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={personalS.addTitle}>{title}</Text>
        <Text style={personalS.addSubtitle}>{subtitle}</Text>
      </View>
      <View style={personalS.plusCircle}>
        <Ionicons name="add" size={rf(19)} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );
}

function PersonalSection({
  title, children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={personalS.section}>
      <Text style={personalS.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PersonalTab({
  user,
  onEditCore,
  onEditField,
  onEditMetro,
}: {
  user: User;
  onEditCore: () => void;
  onEditField: (field: PersonalFieldKey) => void;
  onEditMetro: () => void;
}) {
  const p = user.personalDetails ?? {};
  const resume = user.resume;

  const contactEmail = p.contactEmail || resume?.email;
  const citizenship = p.citizenship || resume?.citizenship;
  const workAuthorization = p.workAuthorization || resume?.workPermit;
  const location = p.location || resume?.city;
  const workAvailability = p.workAvailability
    || [resume?.employmentType, resume?.workFormat].filter(Boolean).join(' · ');
  const relocationFromResume = resume?.businessTrips?.match(/(?:не\s+)?готов[а]?\s+к\s+переезд\w*/i)?.[0];
  const relocation = p.relocation || relocationFromResume;

  return (
    <View style={personalS.content}>
      <PersonalSection title="Основная информация">
        <View style={personalS.card}>
          <PersonalRow label="Имя" value={user.firstName} onPress={onEditCore} />
          <PersonalRow label="Отчество" value={p.middleName} onPress={() => onEditField('middleName')} />
          <PersonalRow label="Фамилия" value={user.lastName} onPress={onEditCore} />
          <PersonalRow label="Как к вам обращаться" value={p.preferredName} onPress={() => onEditField('preferredName')} />
          <PersonalRow label="Возраст" value={user.age ? `${user.age} лет` : undefined} onPress={onEditCore} last />
        </View>
      </PersonalSection>

      <PersonalSection title="Контактная информация">
        <View style={personalS.card}>
          <PersonalRow label="Email" value={contactEmail} onPress={() => onEditField('contactEmail')} />
          <PersonalRow label="Телефон" value={user.phone} onPress={onEditCore} last />
        </View>
      </PersonalSection>

      <PersonalSection title="Ссылки">
        {p.links ? (
          <View style={personalS.card}>
            <PersonalRow label="Ссылки" value={p.links} onPress={() => onEditField('links')} last />
          </View>
        ) : (
          <PersonalAddCard
            icon="link-outline"
            title="Добавить ссылки"
            subtitle="Портфолио, профиль или другой профессиональный ресурс."
            onPress={() => onEditField('links')}
          />
        )}
      </PersonalSection>

      <PersonalSection title="Разрешение на работу">
        <View style={personalS.card}>
          <PersonalRow label="Гражданство" value={citizenship} onPress={() => onEditField('citizenship')} />
          <PersonalRow label="Статус разрешения на работу" value={normalizePersonalChoiceValue('workAuthorization', workAuthorization)} onPress={() => onEditField('workAuthorization')} last />
        </View>
      </PersonalSection>

      <PersonalSection title="Местоположение">
        <View style={personalS.card}>
          <PersonalRow label="Город" value={location} onPress={() => onEditField('location')} />
          <PersonalRow label="Метро" value={user.metroStation} onPress={onEditMetro} last />
        </View>
      </PersonalSection>

      <PersonalSection title="Доступность к работе">
        {workAvailability ? (
          <View style={personalS.card}>
            <PersonalRow label="Условия" value={workAvailability} onPress={() => onEditField('workAvailability')} last />
          </View>
        ) : (
          <PersonalAddCard
            icon="calendar-outline"
            title="Добавить доступность"
            subtitle="Когда и в каком формате вы готовы работать."
            onPress={() => onEditField('workAvailability')}
          />
        )}
      </PersonalSection>

      <PersonalSection title="Переезд">
        {relocation ? (
          <View style={personalS.card}>
            <PersonalRow label="Готовы к переезду?" value={normalizePersonalChoiceValue('relocation', relocation)} onPress={() => onEditField('relocation')} last />
          </View>
        ) : (
          <PersonalAddCard
            icon="airplane-outline"
            title="Добавить готовность к переезду"
            subtitle="Укажите, готовы ли вы переехать ради работы."
            onPress={() => onEditField('relocation')}
          />
        )}
      </PersonalSection>

      <PersonalSection title="Водительские права">
        {p.driversLicense ? (
          <View style={personalS.card}>
            <PersonalRow label="Есть водительские права?" value={normalizePersonalChoiceValue('driversLicense', p.driversLicense)} onPress={() => onEditField('driversLicense')} last />
          </View>
        ) : (
          <PersonalAddCard
            icon="car-outline"
            title="Добавить водительские права"
            subtitle="Категории и наличие личного автомобиля."
            onPress={() => onEditField('driversLicense')}
          />
        )}
      </PersonalSection>

      <PersonalSection title="Ограничения по трудоустройству">
        {p.employmentRestrictions ? (
          <View style={personalS.card}>
            <PersonalRow label="Ограничения" value={p.employmentRestrictions} onPress={() => onEditField('employmentRestrictions')} last />
          </View>
        ) : (
          <PersonalAddCard
            icon="document-text-outline"
            title="Добавить ограничения"
            subtitle="Обязательства или договорённости, которые могут повлиять на следующую работу."
            onPress={() => onEditField('employmentRestrictions')}
          />
        )}
      </PersonalSection>
    </View>
  );
}

function ResumeVaultTab({
  items,
  loading,
  loadFailed,
  legacyResume,
  busyId,
  importing,
  onAdd,
  onOpen,
  onSelect,
  onDelete,
}: {
  items: ResumeVaultItem[];
  loading: boolean;
  loadFailed: boolean;
  legacyResume?: ResumeProfile;
  busyId: string | null;
  importing: boolean;
  onAdd: () => void;
  onOpen: (item: ResumeVaultItem) => void;
  onSelect: (item: ResumeVaultItem) => void;
  onDelete: (item: ResumeVaultItem) => void;
}) {
  const active = items.find(item => item.selected) ?? null;

  return (
    <View style={filesS.content}>
      <View style={filesS.intro}>
        <View style={filesS.introIcon}>
          <Ionicons name="folder-open-outline" size={rf(22)} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={filesS.introTitle}>Сейф резюме</Text>
          <Text style={filesS.introText}>
            Храните несколько PDF и выбирайте активное. Выбранное резюме сразу синхронизируется с профилем.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={filesS.addCard}
        onPress={onAdd}
        disabled={importing}
        activeOpacity={0.78}
      >
        <View style={filesS.addIcon}>
          {importing
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Ionicons name="add" size={rf(24)} color="#FFFFFF" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={filesS.addTitle}>{importing ? 'Добавляем PDF…' : 'Добавить резюме'}</Text>
          <Text style={filesS.addSub}>PDF до 10 МБ · файл сохранится приватно</Text>
        </View>
        <Ionicons name="chevron-forward" size={rf(18)} color={Colors.textMuted} />
      </TouchableOpacity>

      {loading ? (
        <View style={filesS.state}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={filesS.stateText}>Загружаем ваши резюме…</Text>
        </View>
      ) : loadFailed ? (
        <View style={filesS.state}>
          <Ionicons name="cloud-offline-outline" size={rf(22)} color={Colors.textMuted} />
          <Text style={filesS.stateText}>Не удалось загрузить сейф. Откройте вкладку ещё раз.</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={filesS.state}>
          <Ionicons name="document-text-outline" size={rf(26)} color={Colors.textMuted} />
          <Text style={filesS.stateTitle}>В сейфе пока нет PDF</Text>
          <Text style={filesS.stateText}>
            {legacyResume
              ? 'Текущее резюме было загружено до появления сейфа. Добавьте PDF ещё раз — после этого его можно будет смотреть и переключать здесь.'
              : 'Добавьте первое резюме — оно автоматически станет активным в профиле.'}
          </Text>
        </View>
      ) : (
        <>
          {active ? (
            <View style={filesS.activeCard}>
              <View style={filesS.activeTop}>
                <View style={filesS.pdfIcon}>
                  <Text style={filesS.pdfText}>PDF</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={filesS.activeLabel}>Сейчас в профиле</Text>
                  <Text style={filesS.fileName} numberOfLines={2}>{active.fileName}</Text>
                  <Text style={filesS.position} numberOfLines={1}>
                    {active.resume.desiredPosition ?? 'Должность не указана'}
                  </Text>
                </View>
                <View style={filesS.selectedPill}>
                  <Ionicons name="checkmark-circle" size={rf(15)} color="#FFFFFF" />
                  <Text style={filesS.selectedPillText}>Выбрано</Text>
                </View>
              </View>
              <TouchableOpacity
                style={filesS.previewButton}
                onPress={() => onOpen(active)}
                disabled={busyId === active.id}
                activeOpacity={0.78}
              >
                {busyId === active.id
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <Ionicons name="eye-outline" size={rf(17)} color={Colors.primary} />}
                <Text style={filesS.previewButtonText}>Посмотреть PDF</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={filesS.listHeader}>
            <Text style={filesS.listTitle}>Все резюме</Text>
            <Text style={filesS.listCount}>{items.length}</Text>
          </View>

          {items.map(item => {
            const selected = item.selected;
            const busy = busyId === item.id;
            const date = item.importedAt ? new Date(item.importedAt).toLocaleDateString('ru-RU') : '';
            return (
              <View key={item.id} style={[filesS.rowCard, selected && filesS.rowCardSelected]}>
                <TouchableOpacity
                  style={filesS.rowMain}
                  onPress={() => onOpen(item)}
                  disabled={busy}
                  activeOpacity={0.76}
                >
                  <View style={[filesS.smallPdf, selected && filesS.smallPdfSelected]}>
                    <Ionicons name="document-text-outline" size={rf(22)} color={selected ? Colors.primary : Colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={filesS.rowName} numberOfLines={2}>{item.fileName}</Text>
                    <Text style={filesS.rowMeta} numberOfLines={1}>
                      {[item.resume.desiredPosition, date].filter(Boolean).join(' · ') || 'PDF-резюме'}
                    </Text>
                  </View>
                  <Ionicons name="eye-outline" size={rf(18)} color={Colors.textMuted} />
                </TouchableOpacity>

                <View style={filesS.rowActions}>
                  <TouchableOpacity
                    style={[filesS.selectButton, selected && filesS.selectButtonActive]}
                    onPress={() => onSelect(item)}
                    disabled={selected || busy}
                    activeOpacity={0.78}
                  >
                    {busy
                      ? <ActivityIndicator size="small" color={selected ? '#FFFFFF' : Colors.primary} />
                      : <Ionicons name={selected ? 'checkmark' : 'swap-horizontal'} size={rf(15)} color={selected ? '#FFFFFF' : Colors.primary} />}
                    <Text style={[filesS.selectText, selected && filesS.selectTextActive]}>
                      {selected ? 'Активное' : 'Выбрать'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={filesS.deleteButton}
                    onPress={() => onDelete(item)}
                    disabled={busy}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="trash-outline" size={rf(17)} color={Colors.red} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const tabBarHeight = useBottomTabBarHeight();
  const { currentUser, logout, users, showToast, updateUser, unreadCount } = useApp();
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [profileTab, setProfileTab] = useState<ProfileTab>('resume');
  useEffect(() => { if (tab === 'files') setProfileTab('files'); }, [tab]);
  const [importingResume, setImportingResume] = useState(false);
  const [resumeFiles, setResumeFiles] = useState<ResumeVaultItem[]>([]);
  const [resumeFilesLoading, setResumeFilesLoading] = useState(false);
  const [resumeFilesLoadFailed, setResumeFilesLoadFailed] = useState(false);
  const [resumeFileBusyId, setResumeFileBusyId] = useState<string | null>(null);
  // Раскрыта всегда не больше одной секции: экран остаётся коротким
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [showRatings, setShowRatings] = useState(false);
  const [showConfirmLogout, setShowConfirmLogout] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  // Что человек принял и когда. Показываем прямо в профиле: запись о
  // согласии нужна не только нам для доказательства — человеку тоже
  // полезно видеть, под чем он подписался и какой редакцией.
  const [consent, setConsent] = useState<{
    stamp: string; docs: Record<string, string>; accepted_at: string;
  } | null>(null);
  const [consentLoadFailed, setConsentLoadFailed] = useState(false);
  const [consentRetry, setConsentRetry] = useState(0);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    setConsent(null);
    setConsentLoadFailed(false);
    dbGetConsent(currentUser.id)
      .then(core => {
        if (!alive) return;
        setConsent(core);
        setConsentLoadFailed(false);
      })
      .catch(() => { if (alive) setConsentLoadFailed(true); });
    return () => { alive = false; };
  }, [currentUser?.id, consentRetry]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'worker' || profileTab !== 'files') return;
    let alive = true;
    setResumeFilesLoading(true);
    setResumeFilesLoadFailed(false);
    dbGetResumeFiles()
      .then(items => { if (alive) setResumeFiles(items); })
      .catch(() => { if (alive) setResumeFilesLoadFailed(true); })
      .finally(() => { if (alive) setResumeFilesLoading(false); });
    return () => { alive = false; };
  }, [currentUser?.id, currentUser?.role, profileTab]);

  const consentLine = consentLoadFailed && !consent
    ? 'Не удалось проверить статус согласий'
    : !consent
    ? 'Проверяем соглашения…'
    : consent.stamp === ''
    // Так у тех, кто регистрировался до 25 июня 2026: экрана с документами
    // тогда не было, и записывать им согласие задним числом мы не стали.
    ? 'Согласие ещё не давали'
    : `Приняты ${formatLegalDate(consent.accepted_at.slice(0, 10))}`;
  const [metroPicker, setMetroPicker] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [personalField, setPersonalField] = useState<PersonalFieldKey | null>(null);
  const [personalEditValue, setPersonalEditValue] = useState('');
  // Полоска сверху обещает смахивание — значит оно должно работать
  const editSwipe = useSwipeToDismiss(() => {
    setEditSection(null);
    setPersonalField(null);
  });
  const notifSwipe = useSwipeToDismiss(() => setShowNotifications(false));
  const pwdSwipe = useSwipeToDismiss(() => setShowSettings(false));
  const [showPhotoSource, setShowPhotoSource] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [curPassword, setCurPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [editPhone, setEditPhone] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editFirst, setEditFirst] = useState('');
  const [editMetroLineId, setEditMetroLineId] = useState('');
  const [editMetroLineName, setEditMetroLineName] = useState('');
  const [editMetroStation, setEditMetroStation] = useState('');
  const [editCompany, setEditCompany] = useState<CompanyOption | ''>('');
  const [editBio, setEditBio] = useState('');
  const [editAge, setEditAge] = useState('');

  if (!currentUser) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  if (currentUser.isGuest) return <GuestGate title="Профиль — после регистрации" subtitle="Заведите аккаунт, чтобы заполнить анкету и откликаться на вакансии." />;

  const initials = getInitials(`${currentUser.firstName} ${currentUser.lastName}`);
  const avatarColor = nameColorFromString(currentUser.id);
  const line = METRO_LINES.find(l => l.id === currentUser.metroLineId);

  const personalFallback = (field: PersonalFieldKey): string => {
    const resume = currentUser.resume;
    if (field === 'contactEmail') return resume?.email ?? '';
    if (field === 'citizenship') return resume?.citizenship ?? '';
    if (field === 'workAuthorization') return resume?.workPermit ?? '';
    if (field === 'location') return resume?.city ?? '';
    if (field === 'workAvailability') {
      return [resume?.employmentType, resume?.workFormat].filter(Boolean).join(' · ');
    }
    if (field === 'relocation') {
      return resume?.businessTrips?.match(/(?:не\s+)?готов[а]?\s+к\s+переезд\w*/i)?.[0] ?? '';
    }
    return '';
  };

  const toggleSection = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(
      200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity,
    ));
    setOpenSection(prev => (prev === key ? null : key));
  };

  const openEdit = (section: EditSection) => {
    setPersonalField(null);
    setEditSection(section);
    setEditPhone(currentUser.phone);
    setEditLast(currentUser.lastName);
    setEditFirst(currentUser.firstName);
    setEditMetroLineId(currentUser.metroLineId ?? '');
    setEditMetroStation(currentUser.metroStation ?? '');
    setEditMetroLineName(line?.name ?? '');
    const savedCompany = currentUser.company ?? '';
    setEditCompany(COMPANY_OPTIONS.includes(savedCompany as CompanyOption) ? savedCompany as CompanyOption : '');
    setEditBio(currentUser.bio ?? '');
    setEditAge(currentUser.age ? String(currentUser.age) : '');
  };

  const openPersonalField = (field: PersonalFieldKey) => {
    setEditSection(null);
    setPersonalField(field);
    setPersonalEditValue(
      (currentUser.personalDetails?.[field] as string | undefined)
      ?? personalFallback(field)
      ?? '',
    );
  };

  const saveEdit = async () => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const updated = { ...currentUser };
      if (personalField) {
        updated.personalDetails = {
          ...(currentUser.personalDetails ?? {}),
          [personalField]: personalEditValue.trim() || undefined,
        };
      }
      if (editSection === 'personal') {
        updated.phone = editPhone; updated.lastName = editLast; updated.firstName = editFirst;
        // Пустое поле — «не указан», а не ноль: иначе в карточке появилось бы «0 лет».
        updated.age = editAge.trim() === '' ? undefined : Number(editAge);
      }
      if (editSection === 'metro') { updated.metroLineId = editMetroLineId; updated.metroStation = editMetroStation; }
      if (editSection === 'company') { updated.company = editCompany; updated.bio = editBio; }
      if (editSection === 'bio') updated.bio = editBio;
      await updateUser(updated);
      setEditSection(null);
      setPersonalField(null);
      showToast('Сохранено', 'success');
    } catch {
      // Форму не закрываем: введённые значения остаются на месте для повтора.
      showToast('Не удалось сохранить. Проверьте связь и попробуйте ещё раз', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  // ── Base64 → Uint8Array (без atob — работает на всех RN платформах) ─────
  // ── Shared upload helper ──────────────────────────────────────────────────
  // Обрезка, сжатие и заливка живут в services/avatarUpload: та же логика
  // понадобилась при регистрации, а мест, где легко ошибиться, там два —
  // чтение файла в браузере и обязательная проверка ошибки загрузки.
  const processAndUpload = async (sourceUri: string) => {
    setUploadingPhoto(true);
    try {
      const avatarUrl = await uploadAvatar(sourceUri, currentUser.id);
      await updateUser({ ...currentUser, avatarUrl });
      showToast('Фото обновлено', 'success');
    } catch (e) {
      console.error('[Avatar] processAndUpload error', e);
      showToast('Не удалось обновить фото. Проверьте связь или доступ к памяти.', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // ── Pick from gallery ────────────────────────────────────────────────────
  const pickFromGallery = async () => {
    setShowPhotoSource(false);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Нет доступа к галерее. Разрешите доступ в настройках.', 'error');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false, // We handle crop ourselves via ImageManipulator
        quality: 1,           // Take full quality; we compress in processAndUpload
      });
      if (!result.canceled && result.assets[0]) {
        await processAndUpload(result.assets[0].uri);
      }
    } catch (e) {
      console.error('[Avatar] pickFromGallery error', e);
      showToast('Не удалось открыть галерею.', 'error');
    }
  };

  // ── Pick from camera ─────────────────────────────────────────────────────
  const pickFromCamera = async () => {
    setShowPhotoSource(false);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToast('Нет доступа к камере. Разрешите доступ в настройках.', 'error');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });
      if (!result.canceled && result.assets[0]) {
        await processAndUpload(result.assets[0].uri);
      }
    } catch (e) {
      console.error('[Avatar] pickFromCamera error', e);
      showToast('Не удалось открыть камеру.', 'error');
    }
  };

  const pickAndUploadPhoto = () => {
    setShowPhotoSource(true);
  };

  const importResume = async () => {
    if (importingResume) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      setImportingResume(true);

      const asset = picked.assets[0];
      const { resume, identity, bytes } = await extractResumePdf(asset);
      // Сначала сохраняем исходный PDF в приватный сейф. Сервер делает его
      // активным и синхронизирует структурированное резюме с jm_users.
      const saved = await dbSaveResumeFile(asset.name || resume.sourceFileName || 'resume.pdf', bytes, resume);

      // Локальный контекст обновляем теми же данными, чтобы вкладки
      // «Резюме» и «Личные» поменялись сразу, без перезапуска приложения.
      await updateUser(mergeResumeIntoUser(currentUser, saved.resume, identity));

      try {
        setResumeFiles(await dbGetResumeFiles());
        setResumeFilesLoadFailed(false);
      } catch {
        // Само резюме уже сохранено; сбой обновления списка не отменяет импорт.
      }
      showToast('Резюме сохранено в сейф и выбрано', 'success');
      setProfileTab('resume');
    } catch (error) {
      console.warn('[Profile] resume import failed', error);
      showToast(error instanceof Error ? error.message : 'Не удалось обработать резюме', 'error');
    } finally {
      setImportingResume(false);
    }
  };

  const openResumePdf = async (item: ResumeVaultItem) => {
    if (resumeFileBusyId) return;
    setResumeFileBusyId(item.id);
    try {
      const url = await dbSignResumeFile(item.id);
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось открыть PDF', 'error');
    } finally {
      setResumeFileBusyId(null);
    }
  };

  const selectResumeFromVault = async (item: ResumeVaultItem) => {
    if (item.selected || resumeFileBusyId) return;
    setResumeFileBusyId(item.id);
    try {
      const selected = await dbSelectResumeFile(item.id);
      await updateUser(mergeResumeIntoUser(currentUser, selected.resume));
      setResumeFiles(prev => prev.map(file => ({
        ...file,
        selected: file.id === selected.id,
        ...(file.id === selected.id ? { resume: selected.resume, importedAt: selected.importedAt } : {}),
      })));
      showToast('Резюме выбрано — профиль обновлён', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось выбрать резюме', 'error');
    } finally {
      setResumeFileBusyId(null);
    }
  };

  const deleteResumeFromVault = (item: ResumeVaultItem) => {
    if (resumeFileBusyId) return;
    Alert.alert(
      'Удалить резюме?',
      item.selected
        ? 'Это активное резюме. После удаления профиль переключится на следующее сохранённое резюме.'
        : 'PDF будет удалён из сейфа без возможности восстановления.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            setResumeFileBusyId(item.id);
            try {
              const nextActive = await dbDeleteResumeFile(item.id);
              if (item.selected) {
                if (nextActive) {
                  await updateUser(mergeResumeIntoUser(currentUser, nextActive.resume));
                } else {
                  await updateUser({ ...currentUser, resume: undefined });
                }
              }
              setResumeFiles(await dbGetResumeFiles());
              showToast('Резюме удалено', 'success');
            } catch (error) {
              showToast(error instanceof Error ? error.message : 'Не удалось удалить резюме', 'error');
            } finally {
              setResumeFileBusyId(null);
            }
          },
        },
      ],
    );
  };

  const handleLogout = async () => {
    setShowConfirmLogout(false);
    try {
      await logout();
      showToast('Вы успешно вышли', 'success');
    } catch (error) {
      console.warn('[Profile] logout failed', error);
      showToast('Ошибка при выходе, попробуйте снова', 'error');
    }
    // Navigation is handled by <Redirect href="/" /> in (tabs)/_layout.tsx
  };

  /**
   * Удалить аккаунт.
   *
   * Прежняя версия звала базу напрямую анонимным ключом, а у него с
   * миграции 013 нет прав на jm_users. Запрос отклонялся, ответ никто не
   * читал, и человек видел «Аккаунт удалён», когда не удалялось ничего.
   *
   * Теперь через прокси, с паролем, и окно закрывается только после
   * подтверждённого удаления — ошибка остаётся на экране, а не тонет
   * в исчезнувшем диалоге.
   */
  const handleDeleteAccount = async () => {
    if (!currentUser || deletingAccount) return;
    if (!deletePassword.trim()) { setDeleteError('Введите пароль'); return; }
    setDeleteError('');
    setDeletingAccount(true);
    try {
      await dbDeleteAccount(currentUser.id, deletePassword);
      setShowConfirmDelete(false);
      setDeletePassword('');
      await logout();
      showToast('Аккаунт удалён', 'success');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Не удалось удалить, попробуйте снова');
    } finally {
      setDeletingAccount(false);
    }
    // Navigation is handled by <Redirect href="/" /> in (tabs)/_layout.tsx
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <TabHeader
        left={
          <TouchableOpacity
            onPress={() => router.push('/support')}
            style={styles.helpHeaderBtn}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel="Помощь"
          >
            <Ionicons name="help-circle-outline" size={18} color={Colors.textPrimary} />
            <Text style={styles.helpHeaderText}>Помощь</Text>
          </TouchableOpacity>
        }
        right={
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setShowNotifications(true)} style={styles.headerBtn}>
            <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/profile-settings')}
            style={styles.headerBtn}
            activeOpacity={0.72}
          >
            <Ionicons name="settings-outline" size={23} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
        }
      />
      <OnboardingTarget targetKey="profile.content" style={{ flex: 1 }}>
      <ScrollView
        // The profile now scrolls to the physical bottom under the floating
        // navigation, but its last section can still clear the pill on scroll.
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + rs(16) }]}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      >

        {/* User card — horizontal layout */}
        <View style={styles.userCard}>
          <TouchableOpacity onPress={pickAndUploadPhoto} activeOpacity={0.8} style={styles.avatarWrapper}>
            {currentUser.avatarUrl ? (
              <Image
                source={{ uri: currentUser.avatarUrl }}
                style={styles.bigAvatarImg}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={[styles.bigAvatar, { backgroundColor: avatarColor }]}>
                <Text style={styles.bigAvatarText}>{initials}</Text>
              </View>
            )}
            {uploadingPhoto ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : (
              <View style={styles.avatarCameraBtn}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.userInfo}>
            <Text style={styles.fullName}>{currentUser.firstName} {currentUser.lastName}</Text>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{currentUser.role === 'worker' ? 'Работник' : 'Работодатель'}</Text>
            </View>
            <Text style={styles.phone}>{currentUser.phone}</Text>
            <StarRating
              rating={currentUser.avgRating ?? 0}
              count={currentUser.ratingCount ?? 0}
              onPress={() => setShowRatings(true)}
            />
          </View>

          {/* Без стрелки: редактирование — через «Личные данные» ниже */}
        </View>

        {currentUser.role === 'worker' ? (
          <ProfileTabs value={profileTab} onChange={setProfileTab} />
        ) : null}

        {currentUser.role === 'worker' && profileTab === 'resume' ? (
          <ResumeTab
            resume={currentUser.resume}
            importing={importingResume}
            onImport={() => { void importResume(); }}
          />
        ) : null}

        {/* Рейтинг сразу под шапкой: человеку важно видеть, что у него
            накопилось, а не искать это в конце длинной анкеты. У компании
            он тоже есть — и по нему работники решают, идти ли к ней. */}
        {(currentUser.role === 'employer' || profileTab === 'reviews') ? <View style={{ marginBottom: rs(12) }}>
          <ScoreCard user={currentUser} own />
        </View> : null}

        {currentUser.role === 'worker' && profileTab === 'personal' ? (
          <PersonalTab
            user={currentUser}
            onEditCore={() => openEdit('personal')}
            onEditField={openPersonalField}
            onEditMetro={() => openEdit('metro')}
          />
        ) : null}

        {currentUser.role === 'worker' && profileTab === 'files' ? (
          <ResumeVaultTab
            items={resumeFiles}
            loading={resumeFilesLoading}
            loadFailed={resumeFilesLoadFailed}
            legacyResume={currentUser.resume}
            busyId={resumeFileBusyId}
            importing={importingResume}
            onAdd={() => { void importResume(); }}
            onOpen={(item) => { void openResumePdf(item); }}
            onSelect={(item) => { void selectResumeFromVault(item); }}
            onDelete={deleteResumeFromVault}
          />
        ) : null}

        {currentUser.role === 'employer' ? (
          <>
            <SectionCard
              iconName="person"
              iconBg={Colors.primary}
              title="Личные данные"
              summary={currentUser.phone}
              open={openSection === 'personal'}
              onToggle={() => toggleSection('personal')}
              onEdit={() => openEdit('personal')}
              rows={[
                { label: 'Телефон', value: currentUser.phone },
                { label: 'Фамилия', value: currentUser.lastName },
                { label: 'Имя', value: currentUser.firstName },
                { label: 'Возраст', value: currentUser.age ? `${currentUser.age}` : 'Не указан' },
              ]}
            />
            <SectionCard
              iconName="business"
              iconBg={Colors.primary}
              title="Компания"
              summary={currentUser.company ?? 'Не указана'}
              open={openSection === 'company'}
              onToggle={() => toggleSection('company')}
              onEdit={() => openEdit('company')}
              rows={[{ label: 'Название', value: currentUser.company ?? '—' }]}
            />
            <SectionCard
              iconName="document-text"
              iconBg={Colors.primary}
              title="О компании"
              summary={currentUser.bio ? currentUser.bio : 'Не заполнено'}
              open={openSection === 'bio'}
              onToggle={() => toggleSection('bio')}
              onEdit={() => openEdit('bio')}
              rows={currentUser.bio ? [{ label: '', value: currentUser.bio }] : []}
              placeholder="Расскажите о компании, условиях, коллективе"
            />
          </>
        ) : null}

        {/* Документы */}
        {currentUser.role === 'employer' ? <>
        <SectionCard
          iconName="document-text"
          iconBg="#6B7280"
          title="Документы"
          summary={consentLine}
          open={openSection === 'docs'}
          onToggle={() => toggleSection('docs')}
        >
          {consentLoadFailed && !consent ? (
            <TouchableOpacity
              style={sS.actionRow}
              onPress={() => setConsentRetry(value => value + 1)}
              activeOpacity={0.7}
            >
              <Ionicons name="cloud-offline-outline" size={17} color="#92400E" />
              <View style={{ flex: 1 }}>
                <Text style={sS.actionLabel}>Не удалось проверить, какие редакции вы принимали</Text>
                <Text style={sS.docVersion}>Проверьте связь · нажмите, чтобы повторить</Text>
              </View>
              <Ionicons name="refresh" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
          {[
            { label: 'Пользовательское соглашение', doc: 'terms' as const },
            { label: 'Политика конфиденциальности', doc: 'privacy' as const },
            { label: 'Политика обработки персональных данных', doc: 'dataPolicy' as const },
            { label: 'Согласие на обработку данных', doc: 'consent' as const },
          ].map((item) => (
            <TouchableOpacity
              key={item.doc}
              style={sS.actionRow}
              onPress={() => router.push({ pathname: '/legal', params: { doc: item.doc } })}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={sS.actionLabel}>{item.label}</Text>
                {/* Редакция у каждого документа своя: человек должен видеть,
                    ту ли версию он принимал, а не верить на слово. */}
                <Text style={sS.docVersion}>
                  Редакция от {formatLegalDate(LEGAL_DOCS[item.doc].version)}
                  {consent?.docs?.[item.doc] === LEGAL_DOCS[item.doc].version ? ' · принята' : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={sS.actionRow}
            onPress={async () => {
              if (currentUser) { await resetOnboarding(currentUser.id); }
              // Без уведомления: обучение и так открывается сразу на главной
              router.push('/(tabs)/feed');
            }}
            activeOpacity={0.7}
          >
            <Text style={[sS.actionLabel, { flex: 1 }]}>Показать обучение снова</Text>
            <Ionicons name="refresh" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </SectionCard>
        </> : null}

        {currentUser.role === 'employer' ? (
          <>
            {/* Поддержка — не в свёрнутой карточке, а отдельной строкой.
                Сначала я положил её внутрь «Аккаунта»: человек открыл профиль и
                не увидел ничего, потому что раскрывать надо было угадать. За
                помощью идут в плохую минуту, и искать её в этот момент незачем. */}
            <View style={sS.card}>
              <TouchableOpacity style={sS.header} onPress={() => router.push('/support')} activeOpacity={0.7}>
                <View style={[sS.iconSquare, { backgroundColor: Colors.primary }]}>
                  <Ionicons name="help-circle" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sS.title}>Помощь и поддержка</Text>
                  <Text style={sS.summary} numberOfLines={1}>Ответы на вопросы · написать нам</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Пригласить друга — отдельной строкой, не внутри «Аккаунта».
                Склад это среда с плотными связями: люди зовут знакомых и без нас.
                Спрятать такую строку под раскрывающуюся карточку значит выключить
                то, что и так происходит само. */}
            <View style={sS.card}>
              <TouchableOpacity style={sS.header} onPress={() => router.push('/invite')} activeOpacity={0.7}>
                <View style={[sS.iconSquare, { backgroundColor: Colors.green }]}>
                  <Ionicons name="gift" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sS.title}>Пригласить друга</Text>
                  <Text style={sS.summary} numberOfLines={1}>Вышел на смену — вам вознаграждение</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Аккаунт — все действия с учётной записью в одном месте */}
            <SectionCard
              iconName="shield-checkmark"
              iconBg="#1C1C1E"
              title="Аккаунт"
              summary="Пароль, выход, удаление"
              open={openSection === 'account'}
              onToggle={() => toggleSection('account')}
            >
              <TouchableOpacity style={sS.actionRow} onPress={() => setShowSettings(true)} activeOpacity={0.7}>
                <Ionicons name="key-outline" size={17} color={Colors.textSecondary} />
                <Text style={[sS.actionLabel, { flex: 1 }]}>Сменить пароль</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity style={sS.actionRow} onPress={() => setShowConfirmLogout(true)} activeOpacity={0.7}>
                <Ionicons name="log-out-outline" size={17} color={Colors.textSecondary} />
                <Text style={[sS.actionLabel, { flex: 1 }]}>Выйти из аккаунта</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                style={sS.actionRow}
                onPress={() => setShowConfirmDelete(true)}
                disabled={deletingAccount}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={17} color={Colors.red} />
                <Text style={[sS.actionLabel, { flex: 1, color: Colors.red }]}>
                  {deletingAccount ? 'Удаление...' : 'Удалить аккаунт'}
                </Text>
              </TouchableOpacity>
            </SectionCard>

          </>
        ) : null}

        <View style={{ height: 8 }} />
      </ScrollView>
      </OnboardingTarget>

      {/* Photo source picker */}
      {showPhotoSource ? (
        <View style={styles.confirmOverlay}>
          <View style={[styles.confirmCard, { gap: 0, padding: 0, overflow: 'hidden' }]}>
            <View style={{ padding: 20, paddingBottom: 16 }}>
              <Text style={[styles.confirmTitle, { fontSize: rf(16) }]}>Обновить фото</Text>
              <Text style={[styles.confirmBody, { marginTop: 4 }]}>Выберите источник фото</Text>
            </View>
            <TouchableOpacity
              style={photoSrcS.row}
              onPress={pickFromCamera}
              activeOpacity={0.8}
            >
              <Text style={photoSrcS.icon}>📸</Text>
              <Text style={photoSrcS.label}>Камера</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[photoSrcS.row, photoSrcS.rowBorder]}
              onPress={pickFromGallery}
              activeOpacity={0.8}
            >
              <Text style={photoSrcS.icon}>🖼</Text>
              <Text style={photoSrcS.label}>Галерея</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[photoSrcS.row, photoSrcS.rowBorder, { paddingVertical: 16 }]}
              onPress={() => setShowPhotoSource(false)}
              activeOpacity={0.8}
            >
              <Text style={[photoSrcS.label, { color: Colors.textMuted, textAlign: 'center', flex: 1 }]}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Ratings modal */}
      {showRatings ? (
        <RatingsModal
          userId={currentUser.id}
          users={users}
          onClose={() => setShowRatings(false)}
        />
      ) : null}

      {/* Edit modal */}
      <Modal statusBarTranslucent navigationBarTranslucent visible={!!editSection || !!personalField} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => { setEditSection(null); setPersonalField(null); }}
          />
          <Animated.View style={[styles.modalSheet, editSwipe.animStyle]}>
            <View {...editSwipe.panHandlers}><SheetHandle /></View>
            <Text style={styles.modalTitle}>
              {personalField ? PERSONAL_FIELD_LABELS[personalField] : 'Изменить'}
            </Text>

            {personalField ? (
              PERSONAL_FIELD_CHOICES[personalField] ? (
                <View style={personalS.choiceList}>
                  {PERSONAL_FIELD_CHOICES[personalField]!.map(option => {
                    const selected = normalizePersonalChoiceValue(personalField, personalEditValue) === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[personalS.choiceRow, selected && personalS.choiceRowSelected]}
                        onPress={() => setPersonalEditValue(option.value)}
                        activeOpacity={0.76}
                      >
                        <View style={[personalS.choiceRadio, selected && personalS.choiceRadioSelected]}>
                          {selected ? <View style={personalS.choiceRadioDot} /> : null}
                        </View>
                        <Text style={[personalS.choiceText, selected && personalS.choiceTextSelected]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <AppInput
                  label={PERSONAL_FIELD_LABELS[personalField]}
                  value={personalEditValue}
                  onChangeText={setPersonalEditValue}
                  placeholder={PERSONAL_FIELD_PLACEHOLDERS[personalField] ?? 'Введите данные'}
                  multiline={PERSONAL_MULTILINE.has(personalField)}
                  numberOfLines={PERSONAL_MULTILINE.has(personalField) ? 5 : 1}
                  keyboardType={personalField === 'contactEmail' ? 'email-address' : 'default'}
                />
              )
            ) : null}

            {editSection === 'personal' && (
              <View style={{ gap: 12 }}>
                <AppInput label="Телефон" value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" />
                <AppInput label="Фамилия" value={editLast} onChangeText={setEditLast} />
                <AppInput label="Имя" value={editFirst} onChangeText={setEditFirst} />
                <AppInput
                  label="Возраст"
                  value={editAge}
                  onChangeText={(t: string) => setEditAge(t.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  placeholder="25"
                />
              </View>
            )}
            {editSection === 'metro' && (
              <View style={{ gap: 12 }}>
                {editMetroStation ? (
                  <View style={styles.metroRow}>
                    <View style={[styles.dot, { backgroundColor: METRO_LINES.find(l => l.id === editMetroLineId)?.color }]} />
                    <Text style={styles.metroVal}>{editMetroStation}</Text>
                    <TouchableOpacity onPress={() => setMetroPicker(true)}>
                      <Text style={{ color: Colors.primary, fontWeight: '600' }}>Изменить</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.metroPickBtn} onPress={() => setMetroPicker(true)}>
                    <Text style={{ color: Colors.textPrimary }}>🚇 Выбрать станцию</Text>
                    <Text style={{ color: Colors.textMuted }}>›</Text>
                  </TouchableOpacity>
                )}
                <MetroPicker
                  visible={metroPicker}
                  onClose={() => setMetroPicker(false)}
                  onSelect={(lid, lname, st) => { setEditMetroLineId(lid); setEditMetroLineName(lname); setEditMetroStation(st); setMetroPicker(false); }}
                  selectedLineId={editMetroLineId}
                  selectedStation={editMetroStation}
                />
              </View>
            )}
            {editSection === 'company' && (
              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: rf(13), fontWeight: '500', color: Colors.textSecondary }}>Название компании</Text>
                {COMPANY_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[pStyles.companyOption, editCompany === opt && pStyles.companyOptionActive]}
                    onPress={() => setEditCompany(opt)}
                    activeOpacity={0.8}
                  >
                    <View style={[pStyles.companyRadio, editCompany === opt && pStyles.companyRadioActive]}>
                      {editCompany === opt ? <View style={pStyles.companyRadioDot} /> : null}
                    </View>
                    <Text style={[pStyles.companyLabel, editCompany === opt && pStyles.companyLabelActive]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
                <AppInput label="О компании" value={editBio} onChangeText={setEditBio} placeholder="Расскажите о компании..." multiline numberOfLines={4} />
              </View>
            )}
            {editSection === 'bio' && (
              <AppInput
                label={currentUser.role === 'worker' ? 'О себе' : 'О компании'}
                value={editBio}
                onChangeText={setEditBio}
                placeholder={currentUser.role === 'worker' ? 'Расскажите о себе — опыт, навыки, предпочтения' : 'Расскажите о компании, условиях, коллективе'}
                multiline
                numberOfLines={5}
              />
            )}

            <View style={{ marginTop: 20, gap: 10 }}>
              <PrimaryButton label="Сохранить" onPress={saveEdit} disabled={savingEdit} />
              <PrimaryButton
                label="Отмена"
                onPress={() => { setEditSection(null); setPersonalField(null); }}
                secondary
              />
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Confirm delete account */}
      {showConfirmDelete ? (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Удалить аккаунт?</Text>
            {/* Обещание сузилось до правды. Профиль, телефон, фотография и
                переписка с ботом исчезают. А сообщения в чатах остаются у
                собеседника — уже без имени, — иначе удаление одного забирало
                бы историю у другого. Обещать полное стирание, оставляя
                следы, было бы тем же враньём, что и раньше. */}
            <Text style={styles.confirmBody}>
              Профиль, телефон и фотография будут удалены безвозвратно.
              В чужих переписках и откликах ваши сообщения останутся, но уже
              без вашего имени. Восстановить аккаунт будет нельзя.
            </Text>
            <TextInput
              style={styles.deleteInput}
              value={deletePassword}
              onChangeText={(t: string) => { setDeletePassword(t); setDeleteError(''); }}
              placeholder="Пароль — чтобы это были точно вы"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
            />
            {deleteError ? <Text style={styles.deleteError}>{deleteError}</Text> : null}
            <View style={styles.confirmBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setShowConfirmDelete(false); setDeletePassword(''); setDeleteError(''); }}
              >
                <Text style={styles.cancelText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.logoutConfirmBtn}
                onPress={handleDeleteAccount}
                disabled={deletingAccount}
              >
                <Text style={styles.logoutConfirmText}>
                  {deletingAccount ? 'Удаляю…' : 'Удалить'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* Confirm logout */}
      {showConfirmLogout ? (
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Выйти из аккаунта?</Text>
            <Text style={styles.confirmBody}>Вы сможете войти снова по номеру телефона</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowConfirmLogout(false)}>
                <Text style={styles.cancelText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.logoutConfirmBtn} onPress={handleLogout}>
                <Text style={styles.logoutConfirmText}>Выйти</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* Notifications modal */}
      <Modal statusBarTranslucent navigationBarTranslucent visible={showNotifications} transparent animationType="slide" onRequestClose={() => setShowNotifications(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowNotifications(false)}>
          <Animated.View style={[styles.modalSheet, notifSwipe.animStyle]} onStartShouldSetResponder={() => true}>
            <View {...notifSwipe.panHandlers}>
              <SheetHandle />
              <Text style={styles.modalTitle}>Уведомления</Text>
            </View>
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: 12 }}>
              <Ionicons name="notifications-outline" size={56} color={Colors.textMuted} />
              <Text style={{ fontSize: rf(17), fontWeight: '700', color: Colors.textPrimary }}>Уведомлений пока нет</Text>
              <Text style={{ fontSize: rf(13), color: Colors.textMuted, textAlign: 'center' }}>
                Здесь будут появляться уведомления и новости от приложения
              </Text>
            </View>
          </Animated.View>
        </TouchableOpacity>
      </Modal>

      {/* Change password modal */}
      <Modal statusBarTranslucent navigationBarTranslucent visible={showSettings} transparent animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowSettings(false)} />
          <Animated.View style={[styles.modalSheet, pwdSwipe.animStyle]}>
            <View {...pwdSwipe.panHandlers}>
              <SheetHandle />
              <Text style={styles.modalTitle}>Изменить пароль</Text>
            </View>
            <View style={{ gap: 12 }}>
              <AppInput
                label="Текущий пароль"
                value={curPassword}
                onChangeText={setCurPassword}
                secureTextEntry
                placeholder="Введите текущий пароль"
              />
              <AppInput
                label="Новый пароль"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="Минимум 6 символов"
              />
              <AppInput
                label="Повторите новый пароль"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder="Повторите новый пароль"
              />
            </View>
            <View style={{ marginTop: 8, gap: 10 }}>
              <PrimaryButton
                label={savingPassword ? 'Сохранение...' : 'Сохранить пароль'}
                disabled={savingPassword}
                onPress={async () => {
                  if (!curPassword || !newPassword || !confirmPassword) {
                    showToast('Заполните все поля', 'error'); return;
                  }
                  if (newPassword.length < 6) {
                    showToast('Пароль должен быть не менее 6 символов', 'error'); return;
                  }
                  if (newPassword !== confirmPassword) {
                    showToast('Пароли не совпадают', 'error'); return;
                  }
                  setSavingPassword(true);
                  try {
                    // Текущий пароль сверяет сервер. Раньше сравнивали здесь,
                    // строкой с currentUser.password, — и для всех, у кого в
                    // базе уже хеш, смена пароля просто не проходила.
                    const res = await dbChangePassword(currentUser.id, curPassword, newPassword);
                    if (!res.ok) {
                      showToast('Неверный текущий пароль', 'error'); return;
                    }
                    setCurPassword(''); setNewPassword(''); setConfirmPassword('');
                    setShowSettings(false);
                    showToast('Пароль изменён', 'success');
                  } catch {
                    showToast('Ошибка при сохранении', 'error');
                  } finally {
                    setSavingPassword(false);
                  }
                }}
              />
              <PrimaryButton label="Отмена" onPress={() => setShowSettings(false)} secondary />
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// Свёрнутая секция — одна строка: иконка, название и короткая сводка.
// Раскрывается по нажатию; одновременно открыта только одна (см. openSection).
function ProfileTabs({ value, onChange }: { value: ProfileTab; onChange: (tab: ProfileTab) => void }) {
  const tabs: { key: ProfileTab; label: string; icon: IoniconName }[] = [
    { key: 'resume', label: 'Резюме', icon: 'document-text-outline' },
    { key: 'personal', label: 'Личные', icon: 'person-outline' },
    { key: 'files', label: 'Файлы', icon: 'folder-outline' },
    { key: 'reviews', label: 'Отзывы', icon: 'chatbox-ellipses-outline' },
  ];
  return (
    <View style={resumeS.tabs}>
      {tabs.map(tab => {
        const active = value === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[resumeS.tab, active && resumeS.tabActive]}
            onPress={() => onChange(tab.key)}
            activeOpacity={0.75}
          >
            <Ionicons name={tab.icon} size={rf(17)} color={active ? Colors.primary : Colors.textMuted} />
            <Text style={[resumeS.tabText, active && resumeS.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ResumeCard({ icon, title, children }: { icon: IoniconName; title: string; children: React.ReactNode }) {
  return (
    <View style={resumeS.card}>
      <View style={resumeS.cardHeader}>
        <View style={resumeS.cardIcon}><Ionicons name={icon} size={rf(17)} color={Colors.primary} /></View>
        <Text style={resumeS.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function ResumeMoreButton({
  total, shown, expanded, onPress,
}: {
  total: number;
  shown: number;
  expanded: boolean;
  onPress: () => void;
}) {
  if (total <= shown) return null;
  return (
    <TouchableOpacity style={resumeS.moreButton} onPress={onPress} activeOpacity={0.75}>
      <Text style={resumeS.moreButtonText}>
        {expanded ? 'Скрыть' : `Показать ещё ${total - shown}`}
      </Text>
      <Ionicons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={rf(15)}
        color={Colors.primary}
      />
    </TouchableOpacity>
  );
}

function ExpandableResumeDescription({ text, collapsedLines = 6 }: { text: string; collapsedLines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.trim().length > 220;
  return (
    <View>
      <Text
        style={resumeS.entryDescription}
        numberOfLines={canExpand && !expanded ? collapsedLines : undefined}
      >
        {text}
      </Text>
      {canExpand ? (
        <TouchableOpacity
          style={resumeS.descriptionToggle}
          onPress={() => setExpanded(value => !value)}
          activeOpacity={0.75}
        >
          <Text style={resumeS.descriptionToggleText}>
            {expanded ? 'Свернуть' : 'Показать полностью'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={rf(14)}
            color={Colors.primary}
          />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function ResumeTab({ resume, importing, onImport }: {
  resume?: ResumeProfile;
  importing: boolean;
  onImport: () => void;
}) {
  const experience = resume?.experience ?? [];
  const education = resume?.education ?? [];
  const projects = resume?.projects ?? [];
  const exams = resume?.exams ?? [];
  const languages = resume?.languages ?? [];
  const skills = resume?.skills ?? [];
  const interests = resume?.interests ?? [];
  const certifications = resume?.certifications ?? [];
  const awards = resume?.awards ?? [];
  const coursework = resume?.coursework ?? [];
  const [expandedLists, setExpandedLists] = useState<Record<string, boolean>>({});

  const isExpanded = (key: string) => !!expandedLists[key];
  const toggleList = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(
      180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity,
    ));
    setExpandedLists(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const visibleItems = <T,>(key: string, items: T[], limit: number): T[] =>
    isExpanded(key) ? items : items.slice(0, limit);

  const empty = <Text style={resumeS.sectionEmpty}>Не найдено в загруженном PDF</Text>;

  return (
    <View style={resumeS.content}>
      <TouchableOpacity style={resumeS.importCard} onPress={onImport} disabled={importing} activeOpacity={0.8}>
        <View style={resumeS.importIcon}>
          {importing
            ? <ActivityIndicator size="small" color="#FFFFFF" />
            : <Ionicons name="cloud-upload-outline" size={rf(21)} color="#FFFFFF" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={resumeS.importTitle}>{resume ? 'Обновить резюме' : 'Загрузить резюме'}</Text>
          <Text style={resumeS.importSub}>
            {importing ? 'Распознаём разделы…' : 'PDF до 10 МБ · данные заполнятся автоматически'}
          </Text>
        </View>
        <Ionicons name="add-circle" size={rf(22)} color={Colors.primary} />
      </TouchableOpacity>

      {!resume ? (
        <View style={resumeS.empty}>
          <Ionicons name="document-text-outline" size={rf(34)} color={Colors.textMuted} />
          <Text style={resumeS.emptyTitle}>Резюме пока не заполнено</Text>
          <Text style={resumeS.emptyText}>
            Загрузите PDF — опыт, образование, языки, навыки и дополнительные разделы появятся автоматически.
          </Text>
        </View>
      ) : (
        <>
          <View style={resumeS.headline}>
            <Text style={resumeS.headlineTitle}>{resume.desiredPosition ?? 'Желаемая должность не указана'}</Text>
            {resume.salary ? <Text style={resumeS.salary}>{resume.salary}</Text> : null}
            <View style={resumeS.metaRow}>
              {resume.employmentType ? <Text style={resumeS.meta}>{resume.employmentType}</Text> : null}
              {resume.workFormat ? <Text style={resumeS.meta}>{resume.workFormat}</Text> : null}
              {resume.city ? <Text style={resumeS.meta}>{resume.city}</Text> : null}
            </View>
            {resume.summary ? <Text style={resumeS.summaryText}>{resume.summary}</Text> : null}
          </View>

          <ResumeCard icon="briefcase-outline" title={`Опыт работы (${experience.length})`}>
            {experience.length === 0 ? empty : (
              <>
                {visibleItems('experience', experience, 3).map((item, index) => (
                  <View key={`${item.company}-${item.position}-${index}`} style={[resumeS.entry, index > 0 && resumeS.entryBorder]}>
                    <Text style={resumeS.entryTitle}>{item.position || 'Должность не указана'}</Text>
                    {item.company ? <Text style={resumeS.entryCompany}>{item.company}</Text> : null}
                    <Text style={resumeS.entryPeriod}>{item.start} — {item.end}{item.duration ? ` · ${item.duration}` : ''}</Text>
                    {item.description ? <ExpandableResumeDescription text={item.description} collapsedLines={6} /> : null}
                  </View>
                ))}
                <ResumeMoreButton total={experience.length} shown={3} expanded={isExpanded('experience')} onPress={() => toggleList('experience')} />
              </>
            )}
          </ResumeCard>

          <ResumeCard icon="school-outline" title={`Образование (${education.length})`}>
            {education.length === 0 ? empty : (
              <>
                {visibleItems('education', education, 3).map((item, index) => (
                  <View key={`${item.institution ?? item.level}-${index}`} style={[resumeS.entry, index > 0 && resumeS.entryBorder]}>
                    <Text style={resumeS.entryTitle}>{item.institution ?? item.level ?? 'Образование'}</Text>
                    {item.level && item.institution ? <Text style={resumeS.entryCompany}>{item.level}</Text> : null}
                    {item.specialty ? <Text style={resumeS.entryCompany}>{item.specialty}</Text> : null}
                    {item.period ? <Text style={resumeS.entryPeriod}>{item.period}</Text> : null}
                  </View>
                ))}
                <ResumeMoreButton total={education.length} shown={3} expanded={isExpanded('education')} onPress={() => toggleList('education')} />
              </>
            )}
          </ResumeCard>

          <ResumeCard icon="hammer-outline" title={`Проекты (${projects.length})`}>
            {projects.length === 0 ? empty : (
              <>
                {visibleItems('projects', projects, 3).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={[resumeS.entry, index > 0 && resumeS.entryBorder]}>
                    <Text style={resumeS.entryTitle}>{item.name}</Text>
                    {item.role ? <Text style={resumeS.entryCompany}>{item.role}</Text> : null}
                    {item.period ? <Text style={resumeS.entryPeriod}>{item.period}</Text> : null}
                    {item.description ? <ExpandableResumeDescription text={item.description} /> : null}
                    {item.url ? <Text style={resumeS.entryLink}>{item.url}</Text> : null}
                  </View>
                ))}
                <ResumeMoreButton total={projects.length} shown={3} expanded={isExpanded('projects')} onPress={() => toggleList('projects')} />
              </>
            )}
          </ResumeCard>

          <ResumeCard icon="document-outline" title={`Экзамены (${exams.length})`}>
            {exams.length === 0 ? empty : (
              <>
                {visibleItems('exams', exams, 4).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={[resumeS.languageRow, index === 0 && resumeS.firstRow]}>
                    <View style={{ flex: 1 }}>
                      <Text style={resumeS.languageName}>{item.name}</Text>
                      {item.date ? <Text style={resumeS.entryPeriod}>{item.date}</Text> : null}
                    </View>
                    {item.score ? <Text style={resumeS.languageLevel}>{item.score}</Text> : null}
                  </View>
                ))}
                <ResumeMoreButton total={exams.length} shown={4} expanded={isExpanded('exams')} onPress={() => toggleList('exams')} />
              </>
            )}
          </ResumeCard>

          <ResumeCard icon="language-outline" title={`Языки (${languages.length})`}>
            {languages.length === 0 ? empty : (
              <>
                {visibleItems('languages', languages, 4).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={[resumeS.languageRow, index === 0 && resumeS.firstRow]}>
                    <Text style={resumeS.languageName}>{item.name}</Text>
                    <Text style={resumeS.languageLevel}>{item.level}</Text>
                  </View>
                ))}
                <ResumeMoreButton total={languages.length} shown={4} expanded={isExpanded('languages')} onPress={() => toggleList('languages')} />
              </>
            )}
          </ResumeCard>

          <ResumeCard icon="sparkles-outline" title={`Навыки (${skills.length})`}>
            {skills.length === 0 ? empty : (
              <View style={resumeS.chips}>
                {visibleItems('skills', skills, 12).map((item, index) => <View key={`${item}-${index}`} style={resumeS.chip}><Text style={resumeS.chipText}>{item}</Text></View>)}
              </View>
            )}
            {skills.length > 0 ? (
              <ResumeMoreButton total={skills.length} shown={12} expanded={isExpanded('skills')} onPress={() => toggleList('skills')} />
            ) : null}
          </ResumeCard>

          {resume.specializations.length > 0 ? (
            <ResumeCard icon="compass-outline" title="Специализации">
              <View style={resumeS.chips}>
                {visibleItems('specializations', resume.specializations, 8).map((item, index) => <View key={`${item}-${index}`} style={resumeS.chip}><Text style={resumeS.chipText}>{item}</Text></View>)}
              </View>
              <ResumeMoreButton total={resume.specializations.length} shown={8} expanded={isExpanded('specializations')} onPress={() => toggleList('specializations')} />
            </ResumeCard>
          ) : null}

          <ResumeCard icon="heart-outline" title={`Интересы (${interests.length})`}>
            {interests.length === 0 ? empty : (
              <View style={resumeS.chips}>
                {visibleItems('interests', interests, 8).map((item, index) => <View key={`${item}-${index}`} style={resumeS.chip}><Text style={resumeS.chipText}>{item}</Text></View>)}
              </View>
            )}
            {interests.length > 0 ? (
              <ResumeMoreButton total={interests.length} shown={8} expanded={isExpanded('interests')} onPress={() => toggleList('interests')} />
            ) : null}
          </ResumeCard>

          <ResumeCard icon="ribbon-outline" title={`Лицензии и сертификаты (${certifications.length})`}>
            {certifications.length === 0 ? empty : (
              <>
                {visibleItems('certifications', certifications, 3).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={[resumeS.entry, index > 0 && resumeS.entryBorder]}>
                    <Text style={resumeS.entryTitle}>{item.name}</Text>
                    {item.issuer ? <Text style={resumeS.entryCompany}>{item.issuer}</Text> : null}
                    {item.date ? <Text style={resumeS.entryPeriod}>{item.date}{item.expiration ? ` — ${item.expiration}` : ''}</Text> : null}
                    {item.credentialId ? <Text style={resumeS.entryDescription}>ID: {item.credentialId}</Text> : null}
                    {item.credentialUrl ? <Text style={resumeS.entryLink}>{item.credentialUrl}</Text> : null}
                  </View>
                ))}
                <ResumeMoreButton total={certifications.length} shown={3} expanded={isExpanded('certifications')} onPress={() => toggleList('certifications')} />
              </>
            )}
          </ResumeCard>

          <ResumeCard icon="trophy-outline" title={`Награды (${awards.length})`}>
            {awards.length === 0 ? empty : (
              <>
                {visibleItems('awards', awards, 3).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={[resumeS.entry, index > 0 && resumeS.entryBorder]}>
                    <Text style={resumeS.entryTitle}>{item.name}</Text>
                    {item.issuer ? <Text style={resumeS.entryCompany}>{item.issuer}</Text> : null}
                    {item.date ? <Text style={resumeS.entryPeriod}>{item.date}</Text> : null}
                    {item.description ? <ExpandableResumeDescription text={item.description} /> : null}
                  </View>
                ))}
                <ResumeMoreButton total={awards.length} shown={3} expanded={isExpanded('awards')} onPress={() => toggleList('awards')} />
              </>
            )}
          </ResumeCard>

          <ResumeCard icon="book-outline" title={`Курсы (${coursework.length})`}>
            {coursework.length === 0 ? empty : (
              <>
                {visibleItems('coursework', coursework, 3).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={[resumeS.entry, index > 0 && resumeS.entryBorder]}>
                    <Text style={resumeS.entryTitle}>{item.name}</Text>
                    {item.institution ? <Text style={resumeS.entryCompany}>{item.institution}</Text> : null}
                    {item.period ? <Text style={resumeS.entryPeriod}>{item.period}</Text> : null}
                    {item.description ? <ExpandableResumeDescription text={item.description} /> : null}
                  </View>
                ))}
                <ResumeMoreButton total={coursework.length} shown={3} expanded={isExpanded('coursework')} onPress={() => toggleList('coursework')} />
              </>
            )}
          </ResumeCard>

          <Text style={resumeS.importedAt}>Импортировано из {resume.sourceFileName}</Text>
        </>
      )}
    </View>
  );
}

function SectionCard({
  iconName, iconBg, title, summary, open, onToggle, onEdit,
  rows, chips, placeholder, children,
}: {
  iconName: IoniconName;
  iconBg?: string;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  rows?: { label: string; value: string; lineColor?: string }[];
  chips?: string[];
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const list = rows ?? [];
  const hasContent = list.length > 0 || (chips?.length ?? 0) > 0;
  return (
    <View style={sS.card}>
      <TouchableOpacity style={sS.header} onPress={onToggle} activeOpacity={0.7}>
        <View style={[sS.iconSquare, { backgroundColor: iconBg ?? Colors.primary }]}>
          <Ionicons name={iconName} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sS.title}>{title}</Text>
          {!open && summary ? (
            <Text style={sS.summary} numberOfLines={1}>{summary}</Text>
          ) : null}
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textMuted}
        />
      </TouchableOpacity>

      {open ? (
        <View style={sS.body}>
          {list.map((r, i) => (
            r.label ? (
              <View key={i} style={sS.row}>
                <Text style={sS.label}>{r.label}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {r.lineColor ? <View style={[sS.dot, { backgroundColor: r.lineColor }]} /> : null}
                  <Text style={sS.value}>{r.value}</Text>
                </View>
              </View>
            ) : (
              <Text key={i} style={sS.bioText}>{r.value}</Text>
            )
          ))}
          {!hasContent && placeholder ? <Text style={sS.placeholder}>{placeholder}</Text> : null}
          {chips && chips.length > 0 ? (
            <View style={sS.chipsRow}>
              {chips.map((c, i) => <View key={i} style={sS.chip}><Text style={sS.chipText}>{c}</Text></View>)}
            </View>
          ) : null}
          {children}
          {onEdit ? (
            <TouchableOpacity style={sS.editBtn} onPress={onEdit} activeOpacity={0.8}>
              <Ionicons name="create-outline" size={16} color={Colors.primary} />
              <Text style={sS.editBtnTxt}>Изменить</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const filesS = StyleSheet.create({
  content: { gap: rs(14) },
  intro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: rs(12),
    padding: rs(16),
    borderRadius: rs(18),
    backgroundColor: Colors.bg,
    ...Shadow.card,
  },
  introIcon: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(14),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introTitle: { fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary },
  introText: {
    fontSize: rf(12.5),
    lineHeight: rf(18),
    color: Colors.textSecondary,
    marginTop: rs(4),
  },
  addCard: {
    minHeight: rs(76),
    borderRadius: rs(17),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#FFD0BA',
    backgroundColor: '#FFF8F4',
    paddingHorizontal: rs(14),
    paddingVertical: rs(13),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(12),
  },
  addIcon: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(13),
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTitle: { fontSize: rf(14.5), fontWeight: '800', color: Colors.textPrimary },
  addSub: { fontSize: rf(11.5), color: Colors.textMuted, marginTop: rs(3) },
  state: {
    padding: rs(22),
    borderRadius: rs(16),
    backgroundColor: Colors.bg,
    alignItems: 'center',
    gap: rs(7),
    ...Shadow.card,
  },
  stateTitle: { fontSize: rf(14.5), fontWeight: '800', color: Colors.textPrimary },
  stateText: {
    fontSize: rf(12.5),
    lineHeight: rf(18),
    color: Colors.textMuted,
    textAlign: 'center',
  },
  activeCard: {
    padding: rs(16),
    borderRadius: rs(18),
    backgroundColor: Colors.bg,
    borderWidth: 1.5,
    borderColor: '#B9E9C3',
    ...Shadow.card,
  },
  activeTop: { flexDirection: 'row', alignItems: 'center', gap: rs(11) },
  pdfIcon: {
    width: rs(50),
    height: rs(62),
    borderRadius: rs(12),
    backgroundColor: '#FFF1EA',
    borderWidth: 1,
    borderColor: '#FFD4C0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfText: { fontSize: rf(11.5), fontWeight: '900', color: Colors.primary, letterSpacing: 0.6 },
  activeLabel: { fontSize: rf(10.5), fontWeight: '800', color: Colors.green, textTransform: 'uppercase' },
  fileName: { fontSize: rf(14.5), lineHeight: rf(18.5), fontWeight: '800', color: Colors.textPrimary, marginTop: rs(2) },
  position: { fontSize: rf(11.5), color: Colors.textMuted, marginTop: rs(4) },
  selectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(4),
    paddingHorizontal: rs(9),
    paddingVertical: rs(6),
    borderRadius: rs(100),
    backgroundColor: Colors.green,
  },
  selectedPillText: { fontSize: rf(10.5), color: '#FFFFFF', fontWeight: '800' },
  previewButton: {
    marginTop: rs(14),
    minHeight: rs(42),
    borderRadius: rs(12),
    backgroundColor: Colors.primaryLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: rs(7),
  },
  previewButtonText: { fontSize: rf(12.5), color: Colors.primary, fontWeight: '800' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: rs(2) },
  listTitle: { fontSize: rf(16), fontWeight: '800', color: Colors.textPrimary },
  listCount: { fontSize: rf(12), color: Colors.textMuted, fontWeight: '700' },
  rowCard: {
    borderRadius: rs(16),
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: '#ECEEF2',
    overflow: 'hidden',
    ...Shadow.card,
  },
  rowCardSelected: { borderColor: '#B9E9C3' },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(11),
    paddingHorizontal: rs(14),
    paddingVertical: rs(13),
  },
  smallPdf: {
    width: rs(42),
    height: rs(50),
    borderRadius: rs(11),
    backgroundColor: '#F4F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallPdfSelected: { backgroundColor: '#F1FFF4' },
  rowName: { fontSize: rf(13.5), lineHeight: rf(17.5), fontWeight: '800', color: Colors.textPrimary },
  rowMeta: { fontSize: rf(11.2), color: Colors.textMuted, marginTop: rs(4) },
  rowActions: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    padding: rs(10),
    flexDirection: 'row',
    gap: rs(8),
  },
  selectButton: {
    flex: 1,
    minHeight: rs(38),
    borderRadius: rs(11),
    backgroundColor: Colors.primaryLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: rs(6),
  },
  selectButtonActive: { backgroundColor: Colors.green },
  selectText: { fontSize: rf(12), color: Colors.primary, fontWeight: '800' },
  selectTextActive: { color: '#FFFFFF' },
  deleteButton: {
    width: rs(42),
    minHeight: rs(38),
    borderRadius: rs(11),
    backgroundColor: '#FFF3F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const personalS = StyleSheet.create({
  content: { gap: rs(20) },
  section: { gap: rs(9) },
  sectionTitle: {
    fontSize: rf(17),
    lineHeight: rf(22),
    fontWeight: '800',
    color: Colors.textPrimary,
    paddingHorizontal: rs(2),
  },
  card: {
    backgroundColor: Colors.bg,
    borderRadius: rs(16),
    overflow: 'hidden',
    ...Shadow.card,
  },
  row: {
    minHeight: rs(70),
    paddingHorizontal: rs(16),
    paddingVertical: rs(13),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(12),
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  rowLabel: {
    fontSize: rf(14),
    lineHeight: rf(18),
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  rowValue: {
    fontSize: rf(13),
    lineHeight: rf(18),
    color: Colors.textSecondary,
    marginTop: rs(5),
  },
  rowValueEmpty: { color: Colors.textMuted },
  addCard: {
    minHeight: rs(116),
    paddingHorizontal: rs(16),
    paddingVertical: rs(17),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D8DCE3',
    borderRadius: rs(16),
    backgroundColor: '#F6F7F8',
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(13),
  },
  addIcon: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTitle: {
    fontSize: rf(14.5),
    lineHeight: rf(19),
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  addSubtitle: {
    fontSize: rf(12.5),
    lineHeight: rf(17),
    color: Colors.textSecondary,
    marginTop: rs(4),
  },
  plusCircle: {
    width: rs(25),
    height: rs(25),
    borderRadius: rs(13),
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  privateHint: {
    fontSize: rf(11.5),
    lineHeight: rf(16),
    color: Colors.textMuted,
    paddingHorizontal: rs(4),
  },
  choiceList: { gap: rs(8) },
  choiceRow: {
    minHeight: rs(52),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: rs(14),
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(11),
    backgroundColor: Colors.bg,
  },
  choiceRowSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  choiceRadio: {
    width: rs(20),
    height: rs(20),
    borderRadius: rs(10),
    borderWidth: 2,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceRadioSelected: { borderColor: Colors.primary },
  choiceRadioDot: {
    width: rs(10),
    height: rs(10),
    borderRadius: rs(5),
    backgroundColor: Colors.primary,
  },
  choiceText: {
    flex: 1,
    fontSize: rf(13.5),
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  choiceTextSelected: { color: Colors.primary, fontWeight: '800' },
});

const resumeS = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: Colors.bg, borderRadius: rs(15), paddingHorizontal: rs(4), ...Shadow.card },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: rs(3), paddingTop: rs(10), paddingBottom: rs(8), borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: rf(10.5), color: Colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: Colors.primary, fontWeight: '800' },
  content: { gap: rs(12) },
  importCard: { flexDirection: 'row', alignItems: 'center', gap: rs(12), padding: rs(14), borderRadius: rs(16), backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: '#FFD7C4' },
  importIcon: { width: rs(42), height: rs(42), borderRadius: rs(13), backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  importTitle: { fontSize: rf(14.5), fontWeight: '800', color: Colors.textPrimary },
  importSub: { fontSize: rf(11.5), lineHeight: rf(16), color: Colors.textMuted, marginTop: rs(2) },
  empty: { alignItems: 'center', paddingHorizontal: rs(24), paddingVertical: rs(32), borderRadius: rs(16), backgroundColor: Colors.bg, ...Shadow.card },
  emptyTitle: { fontSize: rf(15), fontWeight: '800', color: Colors.textPrimary, marginTop: rs(10) },
  emptyText: { fontSize: rf(12.5), lineHeight: rf(18), color: Colors.textMuted, textAlign: 'center', marginTop: rs(5) },
  headline: { padding: rs(16), borderRadius: rs(16), backgroundColor: Colors.bg, ...Shadow.card },
  headlineTitle: { fontSize: rf(20), lineHeight: rf(25), fontWeight: '800', color: Colors.textPrimary },
  summaryText: { fontSize: rf(12.5), lineHeight: rf(18), color: Colors.textSecondary, marginTop: rs(10) },
  salary: { fontSize: rf(15), fontWeight: '800', color: Colors.primary, marginTop: rs(7) },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(7), marginTop: rs(10) },
  meta: { fontSize: rf(11.5), color: Colors.textSecondary, backgroundColor: '#F2F3F5', paddingHorizontal: rs(10), paddingVertical: rs(6), borderRadius: rs(100) },
  card: { padding: rs(16), borderRadius: rs(16), backgroundColor: Colors.bg, ...Shadow.card },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: rs(9), marginBottom: rs(10) },
  cardIcon: { width: rs(32), height: rs(32), borderRadius: rs(10), alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryLight },
  cardTitle: { flex: 1, fontSize: rf(15), fontWeight: '800', color: Colors.textPrimary },
  entry: { paddingTop: rs(3) },
  entryBorder: { borderTopWidth: 1, borderTopColor: Colors.divider, marginTop: rs(13), paddingTop: rs(13) },
  entryTitle: { fontSize: rf(14), fontWeight: '800', color: Colors.textPrimary },
  entryCompany: { fontSize: rf(13), fontWeight: '600', color: Colors.textSecondary, marginTop: rs(3) },
  entryPeriod: { fontSize: rf(11.5), color: Colors.textMuted, marginTop: rs(3) },
  entryDescription: { fontSize: rf(12.5), lineHeight: rf(18), color: Colors.textSecondary, marginTop: rs(8) },
  descriptionToggle: { flexDirection: 'row', alignItems: 'center', gap: rs(4), alignSelf: 'flex-start', marginTop: rs(7), paddingVertical: rs(3) },
  descriptionToggleText: { fontSize: rf(11.5), color: Colors.primary, fontWeight: '700' },
  moreButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(5), marginTop: rs(12), paddingVertical: rs(9), borderRadius: rs(11), backgroundColor: Colors.primaryLight },
  moreButtonText: { fontSize: rf(12.5), color: Colors.primary, fontWeight: '800' },
  entryLink: { fontSize: rf(11.5), lineHeight: rf(16), color: Colors.primary, marginTop: rs(6) },
  sectionEmpty: { fontSize: rf(12.5), color: Colors.textMuted, fontStyle: 'italic', paddingVertical: rs(5) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(7) },
  chip: { paddingHorizontal: rs(10), paddingVertical: rs(6), borderRadius: rs(100), backgroundColor: '#F2F3F5' },
  chipText: { fontSize: rf(11.5), color: Colors.textSecondary, fontWeight: '600' },
  languageRow: { flexDirection: 'row', justifyContent: 'space-between', gap: rs(12), paddingVertical: rs(9), borderTopWidth: 1, borderTopColor: Colors.divider },
  firstRow: { borderTopWidth: 0 },
  languageName: { fontSize: rf(13.5), fontWeight: '700', color: Colors.textPrimary },
  languageLevel: { flex: 1, fontSize: rf(12.5), color: Colors.textMuted, textAlign: 'right' },
  importedAt: { fontSize: rf(10.5), color: Colors.textMuted, textAlign: 'center', paddingHorizontal: rs(12) },
});

const sS = StyleSheet.create({
  card: { backgroundColor: Colors.bg, borderRadius: rs(16), ...Shadow.card, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: rs(10), paddingHorizontal: rs(16), paddingVertical: rs(14) },
  iconSquare: { width: rs(34), height: rs(34), borderRadius: rs(9), alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  summary: { fontSize: rf(12.5), color: Colors.textMuted, marginTop: rs(2) },
  body: { paddingHorizontal: rs(16), paddingBottom: rs(14) },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(6),
    marginTop: rs(12), paddingVertical: rs(11),
    borderRadius: rs(12), backgroundColor: Colors.primaryLight,
  },
  editBtnTxt: { fontSize: rf(14), fontWeight: '700', color: Colors.primary },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    paddingVertical: rs(13), borderTopWidth: 1, borderTopColor: Colors.divider,
  },
  actionLabel: { fontSize: rf(14), color: Colors.textPrimary, fontWeight: '500' },
  docVersion: { fontSize: rf(11.5), color: Colors.textMuted, marginTop: rs(2) },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: rs(10), borderTopWidth: 1, borderTopColor: Colors.divider },
  label: { fontSize: rf(13), color: Colors.textMuted },
  value: { fontSize: rf(14), fontWeight: '500', color: Colors.textPrimary },
  dot: { width: rs(10), height: rs(10), borderRadius: rs(5) },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8), marginTop: rs(4) },
  chip: { backgroundColor: Colors.primaryLight, borderRadius: rs(100), paddingHorizontal: rs(14), paddingVertical: rs(6) },
  chipText: { fontSize: rf(13), fontWeight: '600', color: Colors.primary },
  bioText: { fontSize: rf(14), color: Colors.textPrimary, lineHeight: rf(20), paddingTop: rs(8) },
  placeholder: { fontSize: rf(13), color: Colors.textMuted, fontStyle: 'italic', paddingTop: rs(4) },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.outerBg ?? '#F5F7FA' },
  scroll: { padding: rs(16), gap: rs(12) },
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: rs(12), marginBottom: rs(8) },
  logo: { fontSize: rf(26), fontWeight: '800' },
  logoBlack: { color: '#111111' },
  logoOrange: { color: Colors.primary },
  // Те же отступы, что у стандартной шапки (TabHeader → h.right и NotifBell),
  // чтобы в профиле значки стояли ровно там же, а не сдвигались.
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },
  helpHeaderBtn: {
    minHeight: rs(36),
    paddingHorizontal: rs(12),
    borderRadius: rs(18),
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
    gap: rs(6),
  },
  helpHeaderText: {
    fontSize: rf(13),
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerBtn: { position: 'relative', padding: rs(4) },
  notifBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: Colors.primary, borderRadius: rs(10), minWidth: rs(16), height: rs(16), alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(3) },
  notifBadgeText: { color: '#fff', fontSize: rf(9), fontWeight: '700' },
  // User card
  userCard: { backgroundColor: Colors.bg, borderRadius: rs(16), padding: rs(16), flexDirection: 'row', alignItems: 'center', gap: rs(14), ...Shadow.card },
  avatarWrapper: { position: 'relative' },
  bigAvatarImg: { width: rs(72), height: rs(72), borderRadius: rs(36) },
  bigAvatar: { width: rs(72), height: rs(72), borderRadius: rs(36), alignItems: 'center', justifyContent: 'center' },
  bigAvatarText: { color: '#fff', fontSize: rf(26), fontWeight: '800' },
  avatarOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: rs(36), backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  avatarCameraBtn: { position: 'absolute', bottom: 0, right: 0, width: rs(24), height: rs(24), borderRadius: rs(12), backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.bg },
  userInfo: { flex: 1, gap: rs(3) },
  fullName: { fontSize: rf(17), fontWeight: '800', color: Colors.textPrimary },
  roleBadge: { backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(12), paddingVertical: rs(3), alignSelf: 'flex-start', marginTop: rs(2) },
  roleText: { color: '#fff', fontSize: rf(12), fontWeight: '600' },
  phone: { fontSize: rf(13), color: Colors.textMuted },
  logoutBtnText: { color: Colors.textMuted, fontSize: rf(14), fontWeight: '600' },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.bg, borderTopLeftRadius: rs(24), borderTopRightRadius: rs(24), padding: rs(24), paddingBottom: rs(40), gap: rs(12) },
  handle: { width: rs(36), height: rs(4), backgroundColor: Colors.inputBorder, borderRadius: rs(2), alignSelf: 'center', marginBottom: rs(8) },
  modalTitle: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary },
  metroRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10), padding: rs(14), borderWidth: 1.5, borderColor: Colors.primary, borderRadius: rs(12) },
  dot: { width: rs(10), height: rs(10), borderRadius: rs(5) },
  metroVal: { flex: 1, fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary },
  metroPickBtn: { flexDirection: 'row', justifyContent: 'space-between', padding: rs(14), borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(12) },
  confirmOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: rs(24) },
  confirmCard: { backgroundColor: Colors.bg, borderRadius: Radius.xl, padding: rs(28), width: '100%', gap: rs(12) },
  confirmTitle: { fontSize: rf(18), fontWeight: '700', textAlign: 'center', color: Colors.textPrimary },
  confirmBody: { fontSize: rf(14), color: Colors.textSecondary, textAlign: 'center' },
  deleteInput: {
    width: '100%', height: rs(44), marginTop: rs(14), paddingHorizontal: rs(14),
    borderWidth: 1, borderColor: Colors.inputBorder, borderRadius: rs(10),
    backgroundColor: Colors.bg, color: Colors.textPrimary, fontSize: rf(15),
  },
  deleteError: {
    marginTop: rs(8), fontSize: rf(13), color: Colors.red,
    textAlign: 'center',
  },
  confirmBtns: { flexDirection: 'row', gap: rs(12), marginTop: rs(8) },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(100), paddingVertical: rs(14), alignItems: 'center' },
  cancelText: { fontSize: rf(15), fontWeight: '600', color: Colors.textSecondary },
  logoutConfirmBtn: { flex: 1, backgroundColor: Colors.red, borderRadius: rs(100), paddingVertical: rs(14), alignItems: 'center' },
  logoutConfirmText: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
});

const photoSrcS = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: rs(14),
    paddingHorizontal: rs(20), paddingVertical: rs(18),
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.divider },
  icon: { fontSize: rf(22), width: rs(30), textAlign: 'center' },
  label: { fontSize: rf(16), fontWeight: '600', color: Colors.textPrimary },
});

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top', 'left', 'right']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: rf(40), marginBottom: 12 }}>😕</Text>
        <Text style={{ fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 }}>
          Не удалось загрузить профиль
        </Text>
        <Text style={{ fontSize: rf(13), color: Colors.textMuted, textAlign: 'center', marginBottom: 24 }}>
          {error.message}
        </Text>
        <TouchableOpacity
          onPress={retry}
          style={{ backgroundColor: Colors.primary, borderRadius: 100, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: rf(15) }}>Попробовать снова</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const pStyles = StyleSheet.create({
  companyOption: {
    flexDirection: 'row', alignItems: 'center', gap: rs(14),
    padding: rs(16), borderRadius: rs(12), borderWidth: 1.5, borderColor: Colors.inputBorder,
    backgroundColor: Colors.surface,
  },
  companyOptionActive: { borderColor: Colors.primary, backgroundColor: '#F0EEFF' },
  companyRadio: {
    width: rs(22), height: rs(22), borderRadius: rs(11), borderWidth: 2, borderColor: Colors.inputBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  companyRadioActive: { borderColor: Colors.primary },
  companyRadioDot: { width: rs(10), height: rs(10), borderRadius: rs(5), backgroundColor: Colors.primary },
  companyLabel: { fontSize: rf(16), color: Colors.textPrimary, fontWeight: '500' },
  companyLabelActive: { color: Colors.primary, fontWeight: '700' },
});
