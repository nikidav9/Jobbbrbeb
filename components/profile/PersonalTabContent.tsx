import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { EditableRow } from './EditableRow';
import { AddRow } from './AddRow';
import { SkillChip } from './SkillChip';
import { EditIcon, MailIcon, PhoneIcon, LockIcon, LinkIcon, PinIcon, CarIcon, ShieldIcon } from './icons';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';
import type { User } from '@/constants/types';
import { ADDRESS_FORMS, LINK_TYPES } from '@/lib/profileEdit';
import { applyAnswersFor, applyAnswersFilled } from '@/lib/applyAnswers';

/** Поле «Основного», на котором экран basic откроется с фокусом. */
type BasicFocus = 'firstName' | 'middleName' | 'lastName' | 'title' | 'age';

/** «24 года» / «21 год» / «25 лет» — простое согласование числительного. */
function ageLabel(age: number): string {
  const d = age % 10, s = age % 100;
  if (d === 1 && s !== 11) return `${age} год`;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return `${age} года`;
  return `${age} лет`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text style={s.eyebrow}>{children}</Text>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

/** Строка «Ещё о себе»: пусто — приглашение добавить (AddRow), заполнено —
 *  значение и карандаш того же 40-пиксельного семейства иконок. */
function AboutRow({
  icon, title, subtitle, value, onEdit, last,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value?: string;
  onEdit: () => void;
  last?: boolean;
}) {
  if (!value) {
    return <AddRow icon={icon} iconBg={ProfileColors.peach} iconSize={40} title={title} subtitle={subtitle} onPress={onEdit} last={last} />;
  }
  return (
    <View style={[s.aboutRow, !last && s.aboutRowBorder]}>
      <View style={s.aboutIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.aboutTitle}>{title}</Text>
        <Text style={s.aboutValue}>{value}</Text>
      </View>
      <TouchableOpacity onPress={onEdit} style={s.editBtn} activeOpacity={0.72} accessibilityRole="button" accessibilityLabel={`Изменить: ${title}`}>
        <EditIcon size={15} color={ProfileColors.ink} />
      </TouchableOpacity>
    </View>
  );
}

/**
 * Кнопки вкладки ведут на экраны редактирования — таблица «Вкладка «Личные»»
 * в docs/design/profile-edit/README.md. Email и телефон — нижние шторки,
 * их держит экран профиля (onEditEmail/onEditPhone).
 */
export function PersonalTabContent({
  user, onEditEmail, onEditPhone,
}: {
  user: User;
  onEditEmail: () => void;
  onEditPhone: () => void;
}) {
  const router = useRouter();
  const go = (pathname: Href) => router.push(pathname);
  const basic = (focus: BasicFocus) => router.push({ pathname: '/profile-edit/basic' as never, params: { focus } });
  const editLink = (index?: number) => (index == null
    ? router.push('/profile-edit/links' as Href)
    : router.push({ pathname: '/profile-edit/links' as never, params: { index: String(index) } }));
  const p = user.personalDetails ?? {};
  const resume = user.resume;

  const contactEmail = p.contactEmail || resume?.email;
  const citizenship = p.citizenship || resume?.citizenship;
  const workAuthorization = p.workAuthorization || resume?.workPermit;
  const location = p.location || resume?.city;
  const relocationFromResume = resume?.businessTrips?.match(/(?:не\s+)?готов[а]?\s+к\s+переезд\w*/i)?.[0];
  const relocationBase = p.relocation || relocationFromResume;
  const relocation = relocationBase && p.relocationCities?.length
    ? `${relocationBase}: ${p.relocationCities.join(', ')}` : relocationBase;
  const metro = p.metroStations?.length
    ? p.metroStations.map(m => m.station).join(', ')
    : user.metroStation;
  // Занятость/формат/график — резюме, единственный источник (экран
  // «Условия работы» пишет в него); легаси employmentType/workFormat —
  // запасной путь для тех, у кого структурные поля ещё не заполнены.
  const employment = resume?.employmentTypes?.length
    ? resume.employmentTypes : (resume?.employmentType ? [resume.employmentType] : []);
  const formats = resume?.workFormats?.length
    ? resume.workFormats : (resume?.workFormat ? [resume.workFormat] : []);
  const conditions = [...employment, ...formats, ...(resume?.schedule ?? [])];
  const driving = p.drivingCategories?.length
    ? `Категории ${p.drivingCategories.join(', ')}${p.hasOwnCar ? ' · есть автомобиль' : ''}`
    : p.driversLicense;
  const restrictions = p.hasEmploymentRestrictions === false ? 'Нет' : p.employmentRestrictions;
  const applyFilled = applyAnswersFilled(applyAnswersFor(user));
  const linkLabel = (type: string) => LINK_TYPES.find(t => t.value === type)?.label ?? 'Ссылка';

  return (
    <View style={s.content}>
      <View style={s.section}>
        <Eyebrow>ОСНОВНОЕ</Eyebrow>
        <Card>
          <EditableRow label="Имя" value={user.firstName} onEdit={() => basic('firstName')} />
          <EditableRow label="Отчество" value={p.middleName} onEdit={() => basic('middleName')} />
          <EditableRow label="Фамилия" value={user.lastName} onEdit={() => basic('lastName')} />
          <EditableRow
            label="Как к вам обращаться" value={p.preferredName || (p.title && p.title !== 'Свой вариант' && ADDRESS_FORMS.includes(p.title) ? p.title : undefined)} ctaLabel="Указать"
            onEdit={() => basic('title')}
          />
          <EditableRow label="Возраст" value={user.age ? ageLabel(user.age) : undefined} onEdit={() => basic('age')} last />
        </Card>
      </View>

      <View style={s.section}>
        <Eyebrow>КОНТАКТЫ</Eyebrow>
        <Card>
          <EditableRow icon={<MailIcon size={17} color={ProfileColors.ink} />} label="Email для связи" value={contactEmail} onEdit={onEditEmail} />
          <EditableRow icon={<PhoneIcon size={17} color={ProfileColors.ink} />} label="Телефон" value={user.phone || undefined} onEdit={onEditPhone} />
          <EditableRow icon={<LockIcon size={17} color={ProfileColors.ink} />} label="Почта для входа" value={user.email} last />
        </Card>
      </View>

      {/* Гражданство/статус и метро — в эталоне не нарисованы (там только
          четыре секции), но остаются из старого профиля: владелец просил
          сохранить всю функциональность, а этих данных этот дизайн просто
          не касается. Тот же визуальный язык — эйброу + белая карточка. */}
      <View style={s.section}>
        <Eyebrow>РАЗРЕШЕНИЕ НА РАБОТУ</Eyebrow>
        <Card>
          <EditableRow label="Гражданство" value={citizenship} onEdit={() => go('/profile-edit/work-permit')} />
          <EditableRow label="Статус разрешения на работу" value={workAuthorization} onEdit={() => go('/profile-edit/work-permit')} last />
        </Card>
      </View>

      <View style={s.section}>
        <Eyebrow>МЕСТОПОЛОЖЕНИЕ</Eyebrow>
        <Card>
          <EditableRow label="Город" value={location} onEdit={() => go('/profile-edit/city-metro')} />
          <EditableRow label="Метро" value={metro} onEdit={() => go('/profile-edit/city-metro')} last />
        </Card>
      </View>

      <View style={s.section}>
        <Eyebrow>УСЛОВИЯ РАБОТЫ</Eyebrow>
        {conditions.length ? (
          <View style={s.conditionsCard}>
            <View style={s.conditionsHead}>
              <Text style={s.conditionsLabel}>Занятость и формат</Text>
              <TouchableOpacity onPress={() => go('/profile-edit/work-conditions')} style={s.editBtn} activeOpacity={0.72} accessibilityRole="button" accessibilityLabel="Изменить условия">
                <EditIcon size={15} color={ProfileColors.ink} />
              </TouchableOpacity>
            </View>
            <View style={s.chips}>
              {conditions.map(c => <SkillChip key={c} label={c} tone="accent" />)}
            </View>
          </View>
        ) : (
          <AddRow
            icon={<PinIcon size={18} color={ProfileColors.ink} />}
            iconBg={ProfileColors.peach}
            iconSize={40}
            title="Добавить условия работы"
            subtitle="Занятость и формат, в котором вам удобно работать"
            onPress={() => go('/profile-edit/work-conditions')}
            last
          />
        )}
      </View>

      <View style={s.section}>
        <Eyebrow>ЕЩЁ О СЕБЕ</Eyebrow>
        <Card>
          {p.linksList?.length ? (
            <>
              {p.linksList.map((link, i) => (
                <AboutRow
                  key={`${link.url}-${i}`}
                  icon={<LinkIcon size={18} color={ProfileColors.ink} />}
                  title={link.label || linkLabel(link.type)} subtitle=""
                  value={link.url} onEdit={() => editLink(i)}
                />
              ))}
              <AddRow
                icon={<LinkIcon size={18} color={ProfileColors.ink} />} iconBg={ProfileColors.peach} iconSize={40}
                title="Добавить ссылку" subtitle="GitHub, LinkedIn, портфолио" onPress={() => editLink()}
              />
            </>
          ) : (
            <AboutRow
              icon={<LinkIcon size={18} color={ProfileColors.ink} />}
              title="Ссылки" subtitle="Портфолио, профиль или другой профессиональный ресурс"
              value={p.links} onEdit={() => editLink(p.links ? 0 : undefined)}
            />
          )}
          <AboutRow
            icon={<PinIcon size={18} color={ProfileColors.ink} />}
            title="Готовность к переезду" subtitle="Готовы ли вы переехать ради работы"
            value={relocation} onEdit={() => go('/profile-edit/relocation')}
          />
          <AboutRow
            icon={<CarIcon size={18} color={ProfileColors.ink} />}
            title="Водительские права" subtitle="Категории и наличие личного автомобиля"
            value={driving} onEdit={() => go('/profile-edit/driving-license')}
          />
          <AboutRow
            icon={<EditIcon size={18} color={ProfileColors.ink} />}
            title="Ответы для откликов" subtitle="Зарплата, дата выхода, Telegram — Юпитер подставит в анкеты сам"
            value={applyFilled ? `Заполнено ${applyFilled} из 6` : undefined} onEdit={() => go('/profile-edit/apply-answers')}
          />
          <AboutRow
            icon={<ShieldIcon size={18} color={ProfileColors.ink} />}
            title="Ограничения по трудоустройству" subtitle="Обязательства или договорённости, которые могут повлиять на новую работу"
            value={restrictions} onEdit={() => go('/profile-edit/restrictions')}
            last
          />
        </Card>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  content: { gap: 12 },
  section: { gap: 8 },
  eyebrow: { fontFamily: ProfileFonts.textBold, fontSize: 11, letterSpacing: 0.9, color: ProfileColors.muted, paddingHorizontal: 4 },
  card: { backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, paddingHorizontal: 18, paddingVertical: 4 },
  conditionsCard: { backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 16, gap: 12 },
  conditionsHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  conditionsLabel: { flex: 1, fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  editBtn: {
    width: 34, height: 34, borderRadius: ProfileRadius.pill, borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    backgroundColor: ProfileColors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  aboutRowBorder: { borderBottomWidth: 1, borderBottomColor: ProfileColors.line },
  aboutIcon: {
    width: 40, height: 40, borderRadius: ProfileRadius.iconLg, backgroundColor: ProfileColors.peach,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  aboutTitle: { fontFamily: ProfileFonts.textBold, fontSize: 14, color: ProfileColors.ink },
  aboutValue: { fontFamily: ProfileFonts.textRegular, fontSize: 12, lineHeight: 17, color: ProfileColors.muted, marginTop: 2 },
});
