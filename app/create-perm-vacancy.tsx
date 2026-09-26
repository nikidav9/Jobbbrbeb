import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Radius } from '@/constants/theme';
import { MetroPicker } from '@/components/feature/MetroPicker';
import { AddressSuggestField } from '@/components/feature/AddressSuggestField';
import { useApp } from '@/hooks/useApp';
import { uid, nowISO } from '@/services/storage';
import { dbUpsertPermVacancy, dbGetPermVacanciesByEmployer } from '@/services/db';
import { notifyWorkersNewVacancy } from '@/services/notifications';
import { PermVacancy, WorkType } from '@/constants/types';
import { METRO_LINES } from '@/constants/metro';
import { WorkTypeSelector, WORK_TYPE_META } from '@/components/feature/WorkTypeSelector';
import { AutoRejectNotice } from '@/components/AutoRejectNotice';
import { OnboardingTarget } from '@/components/OnboardingTarget';

import { rs, rf } from '@/constants/scale';
import { BackButton, BACK_BUTTON_SIZE } from '@/components/ui/BackButton';

export default function CreatePermVacancy() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { currentUser, permVacancies, refreshPermVacancies, showToast, optimisticAddPermVacancy, optimisticUpdatePermVacancy } = useApp();

  const existing = editId ? permVacancies.find(v => v.id === editId) : undefined;
  const isEdit = !!existing;

  const [workType, setWorkType] = useState<WorkType>(existing?.workType ?? 'stocker');
  const title = WORK_TYPE_META[workType].label;
  const [address, setAddress] = useState(existing?.address ?? '');
  const [lat, setLat] = useState<number | null>(existing?.lat ?? null);
  const [lng, setLng] = useState<number | null>(existing?.lng ?? null);
  const [metroLineId, setMetroLineId] = useState(existing?.metroLineId ?? '');
  const [metroLineName, setMetroLineName] = useState('');
  const [metroStation, setMetroStation] = useState(existing?.metroStation ?? '');
  const [salary, setSalary] = useState(existing ? String(existing.salary) : '');
  const [schedule, setSchedule] = useState(existing?.schedule ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [metroPicker, setMetroPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing?.metroLineId) {
      const ln = METRO_LINES.find(l => l.id === existing.metroLineId);
      setMetroLineName(ln?.name ?? '');
    }
  }, []);

  const line = METRO_LINES.find(l => l.id === metroLineId);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!address.trim()) e.address = 'Введите адрес';
    if (!metroStation) e.metro = 'Выберите станцию метро';
    const sal = parseInt(salary, 10);
    if (isNaN(sal) || sal <= 0) e.salary = 'Введите зарплату';
    if (!schedule.trim()) e.schedule = 'Укажите график работы';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate() || !currentUser || saving) return;
    setSaving(true);
    try {
      const vac: PermVacancy = {
        id: existing?.id ?? uid(),
        employerId: existing?.employerId ?? currentUser.id,
        company: existing?.company ?? (currentUser.company ?? `${currentUser.firstName} ${currentUser.lastName}`),
        title,
        workType,
        metroLineId,
        metroStation,
        address: address.trim(),
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        salary: parseInt(salary, 10),
        schedule: schedule.trim(),
        description: description.trim() || undefined,
        status: existing?.status ?? 'open',
        createdAt: existing?.createdAt ?? nowISO(),
      };
      await dbUpsertPermVacancy(vac);
      if (isEdit) optimisticUpdatePermVacancy(vac); else optimisticAddPermVacancy(vac);
      if (!isEdit && metroStation) {
        void notifyWorkersNewVacancy({
          metroStation, title: title.trim(), company: vac.company, type: 'permanent',
          workType: vac.workType,
          salary: vac.salary, schedule: vac.schedule, vacancyId: vac.id,
        }).then(ok => {
          if (!ok) showToast('Вакансия опубликована, но рассылку не удалось отправить. Вакансия остаётся доступна в ленте.', 'error');
        });
      }
      showToast(isEdit ? 'Вакансия обновлена' : 'Вакансия опубликована', 'success');
      router.back();
      refreshPermVacancies().catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Ошибка: ${msg}`, 'error');
      console.error('[CreatePermVacancy] submit error', e);
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <BackButton />
        <Text style={styles.headerTitle}>{isEdit ? 'Редактировать' : 'Постоянная вакансия'}</Text>
        <View style={{ width: BACK_BUTTON_SIZE }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <OnboardingTarget targetKey="employer.create.form" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <AutoRejectNotice />

          {/* Badge */}
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>💼 Постоянная работа</Text>
          </View>

          {/* Work type */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Специальность *</Text>
            <WorkTypeSelector selected={[workType]} onToggle={t => setWorkType(t)} />
          </View>

          {/* Metro */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Метро *</Text>
            {metroStation ? (
              <View style={styles.metroSelected}>
                <View style={[styles.dot, { backgroundColor: line?.color ?? Colors.blue }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.metroLineTxt}>{metroLineName}</Text>
                  <Text style={styles.metroStTxt}>{metroStation}</Text>
                </View>
                <TouchableOpacity onPress={() => setMetroPicker(true)}>
                  <Text style={styles.changeLink}>Изменить</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={[styles.pickerField, errors.metro ? styles.inputError : null]} onPress={() => setMetroPicker(true)}>
                <Text style={styles.pickerFieldTxt}>🚇 Выбрать станцию</Text>
                <Text style={{ color: Colors.textMuted, fontSize: rf(20) }}>›</Text>
              </TouchableOpacity>
            )}
            {errors.metro ? <Text style={styles.errMsg}>{errors.metro}</Text> : null}
            <MetroPicker
              visible={metroPicker}
              onClose={() => setMetroPicker(false)}
              onSelect={(lid, lname, st) => { setMetroLineId(lid); setMetroLineName(lname); setMetroStation(st); setMetroPicker(false); }}
              selectedLineId={metroLineId}
              selectedStation={metroStation}
            />
          </View>

          {/* Address */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Адрес *</Text>
            <AddressSuggestField
              value={address}
              error={!!errors.address}
              placeholder="ул. Складская, д. 5, Москва"
              onChange={(addr, la, ln) => { setAddress(addr); setLat(la); setLng(ln); }}
            />
            {errors.address ? <Text style={styles.errMsg}>{errors.address}</Text> : null}
          </View>

          {/* Salary */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Зарплата (в месяц, ₽) *</Text>
            <TextInput
              style={[styles.input, errors.salary ? styles.inputError : null]}
              value={salary}
              onChangeText={setSalary}
              placeholder="80000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
            />
            {errors.salary ? <Text style={styles.errMsg}>{errors.salary}</Text> : null}
          </View>

          {/* Schedule */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>График работы *</Text>
            <TextInput
              style={[styles.input, errors.schedule ? styles.inputError : null]}
              value={schedule}
              onChangeText={setSchedule}
              placeholder="5/2, 08:00–17:00"
              placeholderTextColor={Colors.textMuted}
            />
            {errors.schedule ? <Text style={styles.errMsg}>{errors.schedule}</Text> : null}
          </View>

          {/* Description */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>Описание (необязательно)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Требования, условия, обязанности..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          <View style={{ marginBottom: 40, marginTop: 8 }}>
            <OnboardingTarget targetKey="employer.create.publish">
              <TouchableOpacity
                style={[styles.submitBtn, saving && { opacity: 0.6 }]}
                onPress={submit}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitBtnTxt}>{isEdit ? 'Сохранить' : 'Опубликовать'}</Text>
                )}
              </TouchableOpacity>
            </OnboardingTarget>
          </View>
        </ScrollView>
        </OnboardingTarget>
      </KeyboardAvoidingView>
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
  headerTitle: { fontSize: rf(16), fontWeight: '700', color: Colors.textPrimary },
  body: { padding: rs(20), gap: rs(18), paddingBottom: rs(20) },
  modeBadge: { backgroundColor: '#EDE9FE', borderRadius: rs(100), paddingHorizontal: rs(14), paddingVertical: rs(7), alignSelf: 'flex-start' },
  modeBadgeText: { fontSize: rf(13), fontWeight: '700', color: '#7C3AED' },
  fieldGroup: { gap: rs(8) },
  sectionLabel: { fontSize: rf(13), color: Colors.textMuted, fontWeight: '600' },
  errMsg: { color: Colors.red, fontSize: rf(12) },
  input: {
    borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(12),
    paddingHorizontal: rs(14), paddingVertical: rs(13),
    fontSize: rf(15), color: Colors.textPrimary, backgroundColor: Colors.bg,
  },
  textarea: { minHeight: rs(100), paddingTop: rs(13) },
  inputError: { borderColor: Colors.red },
  pickerField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: Colors.inputBorder, borderRadius: rs(12), padding: rs(16),
  },
  pickerFieldTxt: { fontSize: rf(15), color: Colors.textPrimary },
  metroSelected: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: rs(12), padding: rs(14),
    backgroundColor: Colors.primaryLight,
  },
  dot: { width: rs(12), height: rs(12), borderRadius: rs(6) },
  metroLineTxt: { fontSize: rf(11), color: Colors.textMuted },
  metroStTxt: { fontSize: rf(15), fontWeight: '600', color: Colors.textPrimary, marginTop: rs(2) },
  changeLink: { color: Colors.primary, fontSize: rf(13), fontWeight: '600' },
  submitBtn: {
    backgroundColor: '#7C3AED', borderRadius: rs(100),
    paddingVertical: rs(16), alignItems: 'center',
  },
  submitBtnTxt: { color: '#fff', fontSize: rf(16), fontWeight: '700' },
});
