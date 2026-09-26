/**
 * Permanent vacancy detail screen
 * Shows full info, employer contact (phone only after match), apply/save actions
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Modal, Platform, Linking, Animated, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import * as Crypto from 'expo-crypto';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useApp } from '@/hooks/useApp';
import { normalizeCompany } from '@/services/storage';
import { LavkaLogo } from '@/components/ui/LavkaLogo';
import { CompanyMark } from '@/components/ui/CompanyMark';
import { VacancyContacts } from '@/components/feature/VacancyContacts';
import { agoRu } from '@/services/time';
import { SheetHandle, useSwipeToDismiss } from '@/components/ui/Sheet';
import {
  dbApplyPermVacancy,
  dbAddPermSaved,
  dbRemovePermSaved,
  dbGetPermVacancies,
  dbRecordGuestEvent,
  dbStartGuestRegistration,
} from '@/services/db';
import { ensureResumeForApply } from '@/services/resumeGate';
import { METRO_LINES } from '@/constants/metro';

import { rs, rf } from '@/constants/scale';
import { ApplySheet } from '@/components/feature/ApplySheet';
import { permVacancyInfoLines } from '@/services/vacancyCard';
import { getChatSuggestions } from '@/constants/chatSuggestions';
import { BackButton } from '@/components/ui/BackButton';

export default function PermVacancyDetailScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { vacancyId, campaignId } = useLocalSearchParams<{ vacancyId: string; campaignId?: string }>();
  const {
    currentUser, loading, users, permVacancies, permApplications,
    permSavedIds, optimisticAddPermSaved, optimisticRemovePermSaved,
    refreshPermApplications,
    showToast } = useApp();

  const [applying, setApplying] = useState(false);
  // Серверная запись важнее последующего refresh: если отклик уже принят,
  // не даём отправить его повторно только потому, что сеть оборвалась на чтении.
  const [applySubmitted, setApplySubmitted] = useState(false);

  const [applyOpen, setApplyOpen] = useState(false);
  const [authModalDismissed, setAuthModalDismissed] = useState(Platform.OS === 'web');
  const [guestVacancy, setGuestVacancy] = useState<any>(null);
  const [guestVacancyChecked, setGuestVacancyChecked] = useState(false);
  const [guestVacancyLoadFailed, setGuestVacancyLoadFailed] = useState(false);
  const [guestVacancyRetry, setGuestVacancyRetry] = useState(0);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Двойной тап по «Откликнуться» не должен открыть два диалога о резюме.
  const checkingResume = useRef(false);
  const isGuest = !currentUser && !loading;
  const showAuthModal = isGuest && !authModalDismissed;

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      router.replace('/');
    }
  };

  const startWorkerRegistration = () => {
    void dbStartGuestRegistration({
      vacancyId,
      vacancyKind: 'permanent',
      campaignId: campaignId ?? null,
    });
    router.push({
      pathname: '/register-worker',
      params: { returnTo: `perm-vacancy-detail?vacancyId=${vacancyId}` },
    });
  };

  const vacancy = permVacancies.find(v => v.id === vacancyId) ?? guestVacancy;

  useEffect(() => {
    if (!vacancyId || vacancy || currentUser || loading) return;
    let alive = true;
    setGuestVacancyChecked(false);
    setGuestVacancyLoadFailed(false);
    dbGetPermVacancies().then(list => {
      if (!alive) return;
      const found = list.find((v: any) => v.id === vacancyId);
      if (found) setGuestVacancy(found);
    }).catch(() => {
      if (alive) setGuestVacancyLoadFailed(true);
    }).finally(() => {
      if (alive) setGuestVacancyChecked(true);
    });
    return () => { alive = false; };
  }, [vacancyId, vacancy, currentUser, loading, guestVacancyRetry]);
  const employer = vacancy ? users.find(u => u.id === vacancy.employerId) : null;

  const employerDisplayName = normalizeCompany(employer?.company || vacancy?.company);


  const myApp = useMemo(() => {
    if (!currentUser || !vacancy) return null;
    return permApplications.find(a => a.vacancyId === vacancy.id && a.workerId === currentUser.id) ?? null;
  }, [permApplications, currentUser, vacancy]);

  const isApplied = !!myApp || applySubmitted;
  // hired значит «кандидата закрыли» — для работника это тот же одобренный
  // отклик, просто работодатель уже завершил подбор.
  const isApproved = myApp?.status === 'approved' || myApp?.status === 'hired';
  const isSaved = vacancy ? permSavedIds.includes(vacancy.id) : false;

  const summaryFacts = useMemo(() => {
    if (!vacancy) return [];
    const list: { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [];
    if (vacancy.salary > 0) {
      list.push({ label: `${vacancy.salary.toLocaleString('ru-RU')} ₽/мес · на руки`, icon: 'wallet-outline' });
    }
    if (vacancy.schedule) list.push({ label: vacancy.schedule, icon: 'calendar-outline' });
    if (vacancy.metroStation) list.push({ label: `м. ${vacancy.metroStation}`, icon: 'subway-outline' });
    return list;
  }, [vacancy]);

  const metroLine = vacancy?.metroStation
    ? METRO_LINES.find(l => l.stations.includes(vacancy.metroStation!)) ?? null
    : null;

  const authSwipe = useSwipeToDismiss(() => setAuthModalDismissed(true), showAuthModal);

  const authModalJSX = (
    <Modal statusBarTranslucent navigationBarTranslucent
      visible={showAuthModal}
      transparent
      animationType="slide"
      onRequestClose={() => setAuthModalDismissed(true)}
    >
      <View style={styles.authOverlay}>
        {/* Затемнение тоже закрывает: без крестика нужен запасной путь наружу */}
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setAuthModalDismissed(true)} />
        <Animated.View style={[styles.authSheet, authSwipe.animStyle]}>
          <View {...authSwipe.panHandlers} style={{ alignSelf: 'stretch' }}><SheetHandle /></View>
          <Ionicons name="hand-left-outline" size={36} color={Colors.primary} style={{ marginBottom: 10, marginTop: 4 }} />
          <Text style={styles.authTitle}>Войдите, чтобы откликнуться</Text>
          <Text style={styles.authSub}>Зарегистрируйтесь или войдите — это бесплатно</Text>
          <TouchableOpacity style={styles.authBtnPrimary} onPress={() => router.push({ pathname: '/login', params: { returnTo: `perm-vacancy-detail?vacancyId=${vacancyId}` } })} activeOpacity={0.85}>
            <Text style={styles.authBtnPrimaryTxt}>Войти</Text>
          </TouchableOpacity>
          <View style={styles.authDivider}>
            <View style={styles.authDividerLine} />
            <Text style={styles.authDividerTxt}>или</Text>
            <View style={styles.authDividerLine} />
          </View>
          <TouchableOpacity style={styles.authBtnSecondary} onPress={startWorkerRegistration} activeOpacity={0.85}>
            <Text style={styles.authBtnSecondaryTxt}>Ищу работу — Зарегистрироваться</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.authBtnSecondary, { marginTop: 8 }]} onPress={() => router.push('/register-employer')} activeOpacity={0.85}>
            <Text style={styles.authBtnSecondaryTxt}>Ищу сотрудников — Зарегистрироваться</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );

  const guestLookupPending = !currentUser && !loading && !!vacancyId && !vacancy && !guestVacancyChecked;

  if (loading || guestLookupPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <BackButton onPress={goBack} />
        </View>
        <View style={styles.emptyCenter}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
        {authModalJSX}
      </SafeAreaView>
    );
  }

  if (!vacancy) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <BackButton onPress={goBack} />
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.emptyCenter}>
          {guestVacancyLoadFailed ? (
            <>
              <Ionicons name="cloud-offline-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Не удалось загрузить вакансию</Text>
              <Text style={{ color: Colors.textMuted, textAlign: 'center', marginTop: rs(6) }}>
                Проверьте связь и попробуйте ещё раз.
              </Text>
              <TouchableOpacity
                onPress={() => setGuestVacancyRetry(x => x + 1)}
                activeOpacity={0.8}
                style={{ marginTop: rs(14), backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Ionicons name="search-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Вакансия не найдена</Text>
            </>
          )}
        </View>
        {authModalJSX}
      </SafeAreaView>
    );
  }

  const shareVacancy = async () => {
    if (!vacancy) return;
    const shareCampaignId = Crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const url = `https://t.me/JobToo_bot/app?startapp=share_perm_${vacancy.id}_${shareCampaignId}`;
    const message = [
      `${vacancy.title} — ${vacancy.company}`,
      vacancy.metroStation ? `м. ${vacancy.metroStation}` : '',
      `${vacancy.salary.toLocaleString('ru-RU')} ₽/мес`,
      url,
    ].filter(Boolean).join('\n');
    try {
      const result = await Share.share(
        Platform.OS === 'ios' ? { message: message.replace(`\n${url}`, ''), url } : { message },
      );
      if (result.action !== Share.dismissedAction) {
        void dbRecordGuestEvent('campaign_shared', {
          vacancyId: vacancy.id,
          vacancyKind: 'permanent',
          campaignId: shareCampaignId,
          channel: 'user_share',
        });
      }
    } catch {
      // Отмена системного окна «Поделиться» не должна мешать просмотру.
    }
  };

  // Сначала спрашиваем пару слов о себе — отклик уходит первым сообщением от
  // имени человека и открывает переписку. Молчаливый отклик работодатель
  // видел строкой в списке и решал вслепую.
  const applyTo = async () => {
    if (!currentUser || isApplied || applying || checkingResume.current) return;
    // Гость из ленты: резюме у него нет и быть не может — сразу на регистрацию.
    if (currentUser.isGuest) { startWorkerRegistration(); return; }
    // Решение владельца 25.09: без резюме отклика нет — проверяем до того,
    // как откроется окно, а не после того, как человек напишет сообщение.
    checkingResume.current = true;
    try {
      if (!await ensureResumeForApply()) return;
    } catch (e: any) {
      console.warn('[applyTo]', e);
      showToast(e?.message || 'Не удалось проверить резюме. Проверьте связь и попробуйте ещё раз.', 'error');
      return;
    } finally {
      checkingResume.current = false;
    }
    setApplyOpen(true);
  };

  const sendApply = async (message: string) => {
    if (!currentUser) return;
    if (campaignId) {
      void dbRecordGuestEvent('campaign_apply', {
        vacancyId,
        vacancyKind: 'permanent',
        campaignId,
      });
    }
    setApplying(true);
    try {
      await dbApplyPermVacancy(vacancy.id, currentUser.id, vacancy.employerId, message);
      setApplySubmitted(true);
      setApplyOpen(false);
      try {
        await refreshPermApplications();
      } catch {
        // Отклик уже записан на сервере. Сбой последующего чтения не должен
        // превращать успешную запись в «Не удалось отправить отклик».
      }
      // Директора уведомляет сервер при создании отклика — и сообщением, и
      // карточкой с кнопками в телеграме. Раньше это делал телефон соискателя
      // уже после записи: старая версия или обрыв связи — и директор не
      // узнавал ничего, а ошибка глоталась молча.
      showToast('Отклик отправлен! 📨', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Не удалось отправить отклик', 'error');
    } finally {
      setApplying(false);
    }
  };

  const toggleSave = async () => {
    if (!currentUser || savingFavorite) return;
    setSavingFavorite(true);
    try {
      if (isSaved) {
        await dbRemovePermSaved(currentUser.id, vacancy.id);
        optimisticRemovePermSaved(vacancy.id);
        showToast('Удалено из избранного', 'success');
      } else {
        await dbAddPermSaved(currentUser.id, vacancy.id);
        optimisticAddPermSaved(vacancy.id);
        showToast('Сохранено ❤️', 'success');
      }
    } catch {
      showToast(isSaved ? 'Не удалось удалить из избранного' : 'Не удалось сохранить вакансию', 'error');
    } finally {
      setSavingFavorite(false);
    }
  };

  const STATUS_MAP: Record<string, { label: string; icon: string; color: string; bg: string }> = {
    pending:  { label: 'На рассмотрении', icon: 'time-outline',             color: '#92400E', bg: '#FFF7ED' },
    approved: { label: 'Вы приглашены!',  icon: 'checkmark-circle-outline', color: Colors.green, bg: '#D1FAE5' },
    rejected: { label: 'Отказ',           icon: 'close-circle-outline',     color: Colors.red,   bg: '#FEE2E2' },
  };

  const appStatus = myApp ? STATUS_MAP[myApp.status] : (applySubmitted ? STATUS_MAP.pending : null);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <BackButton onPress={goBack} />
        <View style={{ flex: 1 }} />
        <View style={[styles.headerActions, currentUser?.role !== 'worker' && styles.headerActionsSingle]}>
          <TouchableOpacity
            accessibilityLabel="Поделиться вакансией"
            onPress={() => { void shareVacancy(); }}
            style={styles.headerActionBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="share-outline" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
          {currentUser?.role === 'worker' ? (
            <>
              <View style={styles.headerActionDivider} />
              <TouchableOpacity
                onPress={toggleSave}
                style={[styles.headerActionBtn, savingFavorite && { opacity: 0.5 }]}
                disabled={savingFavorite}
                accessibilityLabel={isSaved ? 'Удалить из избранного' : 'Добавить в избранное'}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={24} color={isSaved ? Colors.primary : Colors.textPrimary} />
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
      >
        {/* Application status badge */}
        {appStatus ? (
          <View style={[styles.statusBadge, { backgroundColor: appStatus.bg, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            <Ionicons name={appStatus.icon as any} size={14} color={appStatus.color} />
            <Text style={[styles.statusTxt, { color: appStatus.color }]}>{appStatus.label}</Text>
          </View>
        ) : null}

        <View style={styles.hero}>
          <View style={styles.companyLogo}>
            <CompanyMark company={employerDisplayName} size={52} />
          </View>

          <Text style={styles.vacancyTitle}>{vacancy.title}</Text>

          <View style={styles.companyRow}>
            <Ionicons name="business-outline" size={16} color={Colors.textMuted} />
            <Text style={styles.companyName} numberOfLines={2}>
              {employerDisplayName}
              <Text style={styles.postedAgo}>{` · ${agoRu(vacancy.createdAt)}`}</Text>
            </Text>
          </View>

          {summaryFacts.length ? (
            <View style={styles.factsGrid}>
              {summaryFacts.map(fact => (
                <View style={styles.fact} key={`${fact.icon}-${fact.label}`}>
                  <Ionicons name={fact.icon} size={17} color={Colors.textPrimary} />
                  <Text style={styles.factText}>{fact.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Location */}
        {(vacancy.metroStation || vacancy.address) ? (
            <View style={[styles.section, styles.detailCard]}>
              <Text style={styles.sectionTitle}>Расположение</Text>
            {vacancy.metroStation ? (
              <View style={styles.infoRow}>
                {metroLine ? (
                  <View style={[styles.metroDot, { backgroundColor: metroLine.color }]} />
                ) : (
                  <Ionicons name="subway-outline" size={16} color={Colors.textMuted} style={{ marginTop: 1 }} />
                )}
                <View style={{ flex: 1 }}>
                  {metroLine ? (
                    <Text style={styles.metroLineName}>{metroLine.name}</Text>
                  ) : null}
                  <Text style={styles.locationValue}>{vacancy.metroStation}</Text>
                </View>
              </View>
            ) : null}
            {vacancy.address ? (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={16} color={Colors.textMuted} style={{ marginTop: 1 }} />
                <Text style={[styles.locationValue, { flex: 1 }]}>{vacancy.address}</Text>
              </View>
            ) : null}

            {/* Маршрут до точки. Откуда ехать, Яндекс подставит сам по
                геопозиции — своего разрешения на неё нам просить не нужно.
                Есть приложение Карт — откроется оно, нет — браузер. */}
            {vacancy.lat != null && vacancy.lng != null ? (
              <TouchableOpacity
                style={styles.mapBtn}
                activeOpacity={0.85}
                onPress={() => {
                  const url = `https://yandex.ru/maps/?rtext=~${vacancy.lat},${vacancy.lng}&rtt=mt`;
                  Linking.openURL(url).catch(() => {});
                }}
              >
                <Ionicons name="navigate-outline" size={16} color={Colors.primary} />
                <Text style={styles.mapBtnTxt}>Смотреть на карте</Text>
              </TouchableOpacity>
            ) : null}
            </View>
        ) : null}

        {/* Description */}
        {vacancy.description ? (
            <View style={[styles.section, styles.detailCard]}>
              <Text style={styles.sectionTitle}>Описание вакансии</Text>
              <Text style={styles.descText} numberOfLines={descriptionExpanded ? undefined : 7}>
                {vacancy.description}
              </Text>
              {vacancy.description.length > 260 ? (
                <TouchableOpacity
                  style={styles.readMoreBtn}
                  onPress={() => setDescriptionExpanded(value => !value)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.readMoreText}>{descriptionExpanded ? 'Свернуть' : 'Читать дальше'}</Text>
                  <Ionicons name={descriptionExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textPrimary} />
                </TouchableOpacity>
              ) : null}
            </View>
        ) : null}

        {/* Контакты. У своей вакансии внешней ссылки нет, а телефон
            работодателя — его персональные данные, показывать их работнику
            без отдельного согласия нельзя. Поэтому контакт здесь — чат, и
            открывается он после того, как отклик одобрят. */}
        <View style={styles.detailCard}>
          <VacancyContacts
            contact={{
              kind: 'chat',
              company: employerDisplayName,
              actionLabel: isApproved ? 'Написать в чате' : 'Чат откроется после одобрения отклика',
              onOpen: () => {
                if (isApproved) router.push('/chats');
                else if (!isApplied) void applyTo();
              },
            }}
            locked={isGuest}
            onLogin={() => router.push({ pathname: '/login', params: { returnTo: `perm-vacancy-detail?vacancyId=${vacancyId}` } })}
          />
        </View>

        {/* Employer info */}
        <View style={[styles.section, styles.detailCard]}>
          <Text style={styles.sectionTitle}>Работодатель</Text>
          <View style={styles.employerCard}>
            {/* Фото директора, если он его добавил: логотип компании одинаков у
                всех, а человек за вакансией у каждой свой. */}
            {employer?.avatarUrl ? (
              <Image source={{ uri: employer.avatarUrl }} style={styles.employerAvatar} contentFit="cover" transition={150} />
            ) : (
              <LavkaLogo size={48} />
            )}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.employerName}>{employerDisplayName}</Text>
              {employer?.metroStation ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="subway-outline" size={12} color={Colors.textMuted} />
                  <Text style={styles.employerMeta}>{employer.metroStation}</Text>
                </View>
              ) : null}
              {(employer?.avgRating ?? 0) > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="star" size={12} color="#F59E0B" />
                  <Text style={styles.employerMeta}>
                    {(employer?.avgRating ?? 0).toFixed(1)} ({employer?.ratingCount} отз.)
                  </Text>
                </View>
              ) : null}
            </View>
            {employer ? (
              <TouchableOpacity
                style={styles.profileBtn}
                onPress={() => router.push({ pathname: '/user-profile', params: { userId: employer.id } })}
                activeOpacity={0.8}
              >
                <Text style={styles.profileBtnTxt}>Профиль →</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Phone — only if approved */}
          {isApproved && employer ? (
            <View style={styles.phoneReveal}>
              <View style={styles.phoneRevealLeft}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Ionicons name="call-outline" size={14} color={Colors.green} />
                  <Text style={styles.phoneRevealLabel}>Телефон работодателя</Text>
                </View>
                {/* С 25.09.2026 телефон необязателен: у нового работодателя его может не быть. */}
                <Text style={employer.phone ? styles.phoneRevealNumber : styles.phoneLockedSub}>
                  {employer.phone || 'Не указан — напишите работодателю в чате'}
                </Text>
              </View>
              <View style={styles.phoneUnlocked}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="checkmark-circle" size={14} color="#fff" />
                  <Text style={styles.phoneUnlockedTxt}>Открыт</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.phoneLocked}>
              <Ionicons name="lock-closed-outline" size={22} color={Colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.phoneLockedTitle}>Телефон скрыт</Text>
                <Text style={styles.phoneLockedSub}>
                  {isApplied
                    ? 'Откроется после одобрения вашего отклика'
                    : 'Откликнитесь на вакансию, чтобы получить контакт'}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={{ height: currentUser?.role === 'worker' ? 170 : 110 }} />
      </ScrollView>

      {/* Bottom action bar — worker only */}
      {currentUser?.role === 'worker' ? (
        <View style={styles.bottomBar}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              accessibilityLabel={isSaved ? 'Удалить из избранного' : 'Добавить в избранное'}
              style={[styles.saveBtn, isSaved && styles.saveBtnActive]}
              onPress={toggleSave}
              activeOpacity={0.8}
            >
              <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={22} color={isSaved ? Colors.primary : Colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.applyBtn,
                isApplied && styles.applyBtnDone,
                applying && { opacity: 0.6 },
              ]}
              onPress={applyTo}
              disabled={isApplied || applying}
              activeOpacity={0.8}
            >
              {applying ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : isApplied ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="checkmark" size={16} color={Colors.green} />
                  <Text style={[styles.applyBtnTxt, { color: Colors.green }]}>Отклик отправлен</Text>
                </View>
              ) : (
                <Text style={styles.applyBtnTxt}>Откликнуться</Text>
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.detailNav}>
            <TouchableOpacity style={styles.detailNavItem} onPress={() => router.replace('/(tabs)/feed')}>
              <Ionicons name="briefcase" size={20} color={Colors.primary} />
              <Text style={[styles.detailNavText, styles.detailNavTextActive]}>Вакансии</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.detailNavItem} onPress={() => router.replace('/(tabs)/matches')}>
              <Ionicons name="document-text-outline" size={20} color={Colors.textMuted} />
              <Text style={styles.detailNavText}>Отклики</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.detailNavItem} onPress={() => router.replace('/(tabs)/profile')}>
              <Ionicons name="person-outline" size={20} color={Colors.textMuted} />
              <Text style={styles.detailNavText}>Профиль</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {authModalJSX}

      <ApplySheet
        visible={applyOpen}
        onClose={() => setApplyOpen(false)}
        onSend={sendApply}
        title="Отклик на вакансию"
        info={permVacancyInfoLines(vacancy)}
        chips={getChatSuggestions('worker', null)}
      />

      {isGuest && Platform.OS === 'web' && (
        <View style={styles.guestBar}>
          <TouchableOpacity
            style={styles.guestBtnPrimary}
            activeOpacity={0.85}
            onPress={() => router.push({ pathname: '/login', params: { returnTo: `perm-vacancy-detail?vacancyId=${vacancyId}` } })}
          >
            <Text style={styles.guestBtnPrimaryTxt}>Войти</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.guestBtnSecondary}
            activeOpacity={0.85}
            onPress={startWorkerRegistration}
          >
            <Text style={styles.guestBtnSecondaryTxt}>Зарегистрироваться</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.outerBg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: rs(18), paddingTop: rs(8), paddingBottom: rs(14),
  },
  headerActions: {
    height: rs(48), minWidth: rs(98), borderRadius: rs(24),
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', ...Shadow.card,
  },
  headerActionsSingle: { minWidth: rs(48), width: rs(48) },
  headerActionBtn: { width: rs(48), height: rs(48), alignItems: 'center', justifyContent: 'center' },
  headerActionDivider: { width: 1, height: rs(22), backgroundColor: Colors.divider },

  body: { paddingHorizontal: rs(20), paddingTop: rs(30), gap: rs(18) },

  statusBadge: { borderRadius: rs(10), paddingHorizontal: rs(14), paddingVertical: rs(8), alignSelf: 'flex-start' },
  statusTxt: { fontSize: rf(13), fontWeight: '700' },

  hero: { gap: rs(14) },
  companyLogo: { alignSelf: 'flex-start', marginBottom: rs(12) },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },
  companyName: { flex: 1, fontSize: rf(14.5), fontWeight: '600', color: Colors.textSecondary },
  postedAgo: { fontWeight: '500', color: Colors.textMuted },
  vacancyTitle: {
    fontSize: rf(27), lineHeight: rf(33), fontWeight: '800',
    color: Colors.textPrimary, letterSpacing: -0.5,
  },
  factsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: rs(12), columnGap: rs(18) },
  fact: { flexDirection: 'row', alignItems: 'center', gap: rs(7), minWidth: '42%' },
  factText: { flexShrink: 1, fontSize: rf(13), lineHeight: rf(18), fontWeight: '600', color: Colors.textSecondary },
  detailCard: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: rs(16), ...Shadow.card },
  section: { gap: rs(12) },
  sectionTitle: { fontSize: rf(16), lineHeight: rf(22), fontWeight: '800', color: Colors.textPrimary },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: rs(10), paddingVertical: rs(2) },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(7),
    borderWidth: 1, borderColor: Colors.primary,
    borderRadius: rs(12), paddingHorizontal: rs(16), paddingVertical: rs(11),
  },
  mapBtnTxt: { fontSize: rf(13), fontWeight: '700', color: Colors.primary },
  locationValue: { fontSize: rf(14), color: Colors.textPrimary, fontWeight: '500', lineHeight: rf(20) },
  metroDot: { width: rs(14), height: rs(14), borderRadius: rs(7), marginTop: rs(3) },
  metroLineName: { fontSize: rf(11), color: Colors.textMuted, marginBottom: rs(2) },

  descText: {
    fontSize: rf(15), color: Colors.textSecondary, lineHeight: rf(23),
  },
  readMoreBtn: {
    minHeight: rs(44), borderRadius: rs(100), borderWidth: 1, borderColor: Colors.inputBorder,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(6),
  },
  readMoreText: { fontSize: rf(14), fontWeight: '600', color: Colors.textPrimary },

  employerCard: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    borderWidth: 1, borderColor: Colors.divider, borderRadius: rs(16), padding: rs(14),
  },
  employerAvatar: { width: rs(48), height: rs(48), borderRadius: rs(24) },
  employerAvatarTxt: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
  employerName: { fontSize: rf(15), fontWeight: '700', color: Colors.textPrimary },
  employerMeta: { fontSize: rf(12), color: Colors.textMuted },
  profileBtn: {
    backgroundColor: Colors.primaryLight, borderRadius: rs(10),
    paddingHorizontal: rs(10), paddingVertical: rs(7),
  },
  profileBtnTxt: { fontSize: rf(12), color: Colors.primary, fontWeight: '600' },

  phoneReveal: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#D1FAE5', borderRadius: rs(14), padding: rs(14),
    borderWidth: 1.5, borderColor: Colors.green,
    gap: rs(12),
  },
  phoneRevealLeft: { flex: 1 },
  phoneRevealLabel: { fontSize: rf(12), color: Colors.green, fontWeight: '600' },
  phoneRevealNumber: { fontSize: rf(18), fontWeight: '800', color: '#065F46', marginTop: rs(2) },
  phoneUnlocked: { backgroundColor: Colors.green, borderRadius: rs(8), paddingHorizontal: rs(10), paddingVertical: rs(5) },
  phoneUnlockedTxt: { fontSize: rf(12), color: '#fff', fontWeight: '700' },

  phoneLocked: {
    flexDirection: 'row', alignItems: 'center', gap: rs(12),
    backgroundColor: Colors.surface, borderRadius: rs(14), padding: rs(14),
    borderWidth: 1.5, borderColor: Colors.divider,
    opacity: 0.85,
  },
  phoneLockedIcon: { fontSize: rf(22) },
  phoneLockedTitle: { fontSize: rf(14), fontWeight: '700', color: Colors.textPrimary },
  phoneLockedSub: { fontSize: rf(12), color: Colors.textMuted, marginTop: rs(2), lineHeight: rf(17) },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: rs(12) },
  emptyTitle: { fontSize: rf(18), fontWeight: '700', color: Colors.textPrimary },

  bottomBar: {
    gap: rs(11), paddingHorizontal: rs(16), paddingTop: rs(12), paddingBottom: rs(8),
    backgroundColor: Colors.outerBg,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 8,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: rs(10) },
  saveBtn: {
    width: rs(52), height: rs(52), borderWidth: 1, borderColor: Colors.inputBorder,
    borderRadius: rs(26), alignItems: 'center', justifyContent: 'center',
  },
  saveBtnActive: { borderColor: Colors.primaryBorder, backgroundColor: Colors.primaryLight },
  applyBtn: {
    flex: 1, minHeight: rs(52), backgroundColor: Colors.primary,
    borderRadius: rs(26), alignItems: 'center', justifyContent: 'center',
  },
  applyBtnDone: { backgroundColor: '#D1FAE5' },
  applyBtnTxt: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
  detailNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: rs(6), paddingVertical: rs(5),
    backgroundColor: Colors.card, borderRadius: rs(100), ...Shadow.card,
  },
  detailNavItem: { flex: 1, alignItems: 'center', gap: rs(2), paddingVertical: rs(3) },
  detailNavText: { fontSize: rf(10), fontWeight: '600', color: Colors.textMuted },
  detailNavTextActive: { color: Colors.primary },

  guestBar: {
    flexDirection: 'row', gap: rs(10),
    paddingHorizontal: rs(16), paddingVertical: rs(12),
    borderTopWidth: 1, borderTopColor: Colors.divider,
    backgroundColor: Colors.outerBg,
  },
  guestBtnPrimary: {
    flex: 1, backgroundColor: Colors.primary,
    borderRadius: rs(10), paddingVertical: rs(13), alignItems: 'center',
  },
  guestBtnPrimaryTxt: { color: '#fff', fontSize: rf(15), fontWeight: '600' },
  guestBtnSecondary: {
    flex: 1, backgroundColor: Colors.primaryLight,
    borderRadius: rs(10), paddingVertical: rs(13), alignItems: 'center',
  },
  guestBtnSecondaryTxt: { color: Colors.primary, fontSize: rf(15), fontWeight: '600' },

  authOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  authSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: rs(24), borderTopRightRadius: rs(24),
    paddingHorizontal: rs(24), paddingTop: rs(4), paddingBottom: rs(40),
    alignItems: 'center', gap: 0,
  },
  authCloseTxt: { fontSize: rf(14), color: Colors.textMuted },
  authEmoji: { fontSize: rf(36), marginBottom: rs(10), marginTop: rs(4) },
  authTitle: { fontSize: rf(20), fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  authSub: {
    fontSize: rf(14), color: Colors.textMuted, textAlign: 'center',
    marginTop: rs(6), marginBottom: rs(20), lineHeight: rf(20),
  },
  authBtnPrimary: {
    width: '100%', backgroundColor: Colors.primary,
    borderRadius: rs(100), paddingVertical: rs(15), alignItems: 'center',
  },
  authBtnPrimaryTxt: { color: '#fff', fontSize: rf(15), fontWeight: '700' },
  authDivider: {
    flexDirection: 'row', alignItems: 'center',
    gap: rs(10), marginVertical: rs(14), width: '100%',
  },
  authDividerLine: { flex: 1, height: 1, backgroundColor: Colors.divider },
  authDividerTxt: { fontSize: rf(13), color: Colors.textMuted },
  authBtnSecondary: {
    width: '100%', borderWidth: 1.5, borderColor: Colors.inputBorder,
    borderRadius: rs(100), paddingVertical: rs(14), alignItems: 'center',
    backgroundColor: Colors.bg,
  },
  authBtnSecondaryTxt: { fontSize: rf(14), fontWeight: '600', color: Colors.textPrimary },
});
