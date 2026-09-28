import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useApp } from '@/hooks/useApp';
import { EditColors } from '@/constants/profileEditTheme';

/**
 * Экраны редактирования профиля монтируются только после восстановления сессии.
 *
 * Каждый экран один раз берёт начальные значения из currentUser. При открытии по
 * прямой ссылке или обновлении страницы на вебе currentUser сначала — урезанный
 * кэш без резюме, и «Сохранить» затёр бы настоящие данные (навыки, опыт) пустыми.
 */
export default function ProfileEditLayout() {
  const { loading, currentUser } = useApp();
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: EditColors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={EditColors.ink} />
      </View>
    );
  }
  if (!currentUser || currentUser.role !== 'worker') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: EditColors.bg } }} />;
}
