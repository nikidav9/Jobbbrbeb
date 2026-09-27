import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { EditableRow } from './EditableRow';
import { AddRow } from './AddRow';
import { SkillChip } from './SkillChip';
import { EditIcon, MailIcon, PhoneIcon, LockIcon, LinkIcon, PinIcon, CarIcon, ShieldIcon } from './icons';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';
import type { PersonalDetails, User } from '@/constants/types';

type PersonalFieldKey = keyof PersonalDetails;

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
      <TouchableOpacity onPress={onEdit} style={s.editBtn} activeOpacity={0.72} accessibilityLabel={`Изменить: ${title}`}>
        <EditIcon size={15} color={ProfileColors.ink} />
      </TouchableOpacity>
    </View>
  );
}

export function PersonalTabContent({
  user, onEditCore, onEditField, onEditMetro,
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
  const relocationFromResume = resume?.businessTrips?.match(/(?:не\s+)?готов[а]?\s+к\s+переезд\w*/i)?.[0];
  const relocation = p.relocation || relocationFromResume;

  return (
    <View style={s.content}>
      <View style={s.section}>
        <Eyebrow>ОСНОВНОЕ</Eyebrow>
        <Card>
          <EditableRow label="Имя" value={user.firstName} onEdit={onEditCore} />
          <EditableRow label="Отчество" value={p.middleName} onEdit={() => onEditField('middleName')} />
          <EditableRow label="Фамилия" value={user.lastName} onEdit={onEditCore} />
          <EditableRow
            label="Как к вам обращаться" value={p.preferredName} ctaLabel="Указать"
            onEdit={() => onEditField('preferredName')}
          />
          <EditableRow label="Возраст" value={user.age ? ageLabel(user.age) : undefined} onEdit={onEditCore} last />
        </Card>
      </View>

      <View style={s.section}>
        <Eyebrow>КОНТАКТЫ</Eyebrow>
        <Card>
          <EditableRow icon={<MailIcon size={17} color={ProfileColors.ink} />} label="Email для связи" value={contactEmail} onEdit={() => onEditField('contactEmail')} />
          <EditableRow icon={<PhoneIcon size={17} color={ProfileColors.ink} />} label="Телефон" value={user.phone || undefined} onEdit={onEditCore} />
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
          <EditableRow label="Гражданство" value={citizenship} onEdit={() => onEditField('citizenship')} />
          <EditableRow label="Статус разрешения на работу" value={workAuthorization} onEdit={() => onEditField('workAuthorization')} last />
        </Card>
      </View>

      <View style={s.section}>
        <Eyebrow>МЕСТОПОЛОЖЕНИЕ</Eyebrow>
        <Card>
          <EditableRow label="Город" value={location} onEdit={() => onEditField('location')} />
          <EditableRow label="Метро" value={user.metroStation} onEdit={onEditMetro} last />
        </Card>
      </View>

      <View style={s.section}>
        <Eyebrow>УСЛОВИЯ РАБОТЫ</Eyebrow>
        {(resume?.employmentType || resume?.workFormat) ? (
          <View style={s.conditionsCard}>
            <View style={s.conditionsHead}>
              <Text style={s.conditionsLabel}>Занятость и формат</Text>
              <TouchableOpacity onPress={() => onEditField('workAvailability')} style={s.editBtn} activeOpacity={0.72} accessibilityLabel="Изменить условия">
                <EditIcon size={15} color={ProfileColors.ink} />
              </TouchableOpacity>
            </View>
            <View style={s.chips}>
              {resume?.employmentType ? <SkillChip label={resume.employmentType} tone="accent" /> : null}
              {resume?.workFormat ? <SkillChip label={resume.workFormat} tone="accent" /> : null}
            </View>
          </View>
        ) : (
          <AddRow
            icon={<PinIcon size={18} color={ProfileColors.ink} />}
            iconBg={ProfileColors.peach}
            iconSize={40}
            title="Добавить условия работы"
            subtitle="Занятость и формат, в котором вам удобно работать"
            onPress={() => onEditField('workAvailability')}
            last
          />
        )}
      </View>

      <View style={s.section}>
        <Eyebrow>ЕЩЁ О СЕБЕ</Eyebrow>
        <Card>
          <AboutRow
            icon={<LinkIcon size={18} color={ProfileColors.ink} />}
            title="Ссылки" subtitle="Портфолио, профиль или другой профессиональный ресурс"
            value={p.links} onEdit={() => onEditField('links')}
          />
          <AboutRow
            icon={<PinIcon size={18} color={ProfileColors.ink} />}
            title="Готовность к переезду" subtitle="Готовы ли вы переехать ради работы"
            value={relocation} onEdit={() => onEditField('relocation')}
          />
          <AboutRow
            icon={<CarIcon size={18} color={ProfileColors.ink} />}
            title="Водительские права" subtitle="Категории и наличие личного автомобиля"
            value={p.driversLicense} onEdit={() => onEditField('driversLicense')}
          />
          <AboutRow
            icon={<ShieldIcon size={18} color={ProfileColors.ink} />}
            title="Ограничения по трудоустройству" subtitle="Обязательства или договорённости, которые могут повлиять на новую работу"
            value={p.employmentRestrictions} onEdit={() => onEditField('employmentRestrictions')}
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
