import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LavkaLogo } from '@/components/ui/LavkaLogo';
import { companyInitials, isLavkaCompany, normalizeCompany } from '@/services/company';
import { nameColorFromString } from '@/services/storage';
import { rf } from '@/constants/scale';
import { companyLogo } from '@/constants/companyLogos';
import { useRemoteCompanyLogo } from '@/services/companyLogoMap';

/**
 * Знак компании: логотип, если мы его знаем, иначе кружок с инициалами.
 *
 * Жил внутри ленты, а нужен ещё и на экранах вакансии. Копировать не стали:
 * две копии знака компании разойдутся цветом или размером, и одна и та же
 * компания будет выглядеть в ленте и в подробностях по-разному.
 */
export function CompanyMark({ company, size = 44 }: { company?: string | null; size?: number }) {
  const name = normalizeCompany(company);
  // Логотип из базы (256×256, свежий) главнее встроенного (128×128).
  const remote = useRemoteCompanyLogo(name);
  if (isLavkaCompany(name)) return <LavkaLogo size={size} />;
  const logo = remote ? { uri: remote } : companyLogo(name);
  if (logo) {
    return (
      <View
        accessibilityLabel={`Логотип компании ${name}`}
        style={[styles.logoBox, { width: size, height: size, borderRadius: size * 0.24 }]}
      >
        <Image source={logo} style={{ width: size, height: size }} contentFit="contain" transition={120} cachePolicy="memory-disk" />
      </View>
    );
  }
  return (
    <View
      accessibilityLabel={`Логотип компании ${name}`}
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: nameColorFromString(name) },
      ]}
    >
      <Text style={[styles.text, { fontSize: rf(size * 0.34) }]}>{companyInitials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  // Белая подложка с тонкой рамкой: логотипы на прозрачном фоне и тёмные
  // квадратные иконки выглядят одинаково аккуратно, как у Sorce.
  logoBox: {
    overflow: 'hidden', flexShrink: 0, backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB',
  },
  text: { color: '#fff', fontWeight: '800' },
});
