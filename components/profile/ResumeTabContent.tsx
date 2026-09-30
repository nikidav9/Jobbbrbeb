import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, LayoutAnimation } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { HardShadowCard } from './HardShadowCard';
import { SectionCard } from './SectionCard';
import { AddRow } from './AddRow';
import { SkillChip } from './SkillChip';
import { LanguageLevel } from './LanguageLevel';
import {
  UploadIcon, BriefcaseIcon, GlobeIcon, SparkleSkillIcon, GradCapIcon, ExamIcon,
  CertIcon, CourseIcon, StarIcon, HeartIcon, ChevronRightIcon, DocPageIcon, EditIcon,
} from './icons';
import { ProfileColors, ProfileFonts, HAIRLINE, ProfileRadius } from '@/constants/profileTheme';
import type {
  ResumeProfile, ResumeExperience, ResumeEducation, ResumeCertification,
  ResumeAward, ResumeCoursework, ResumeExam,
} from '@/constants/types';

/** Инициал для квадратного «аватара» места работы: буква из названия компании
 *  без организационно-правовой формы («ООО «Яндекс Лавка»» → «Я»). */
function companyInitial(company?: string): string {
  if (!company) return '?';
  const cleaned = company
    .replace(/^(?:ООО|ИП|ЗАО|ОАО|ПАО|АО)\s*/iu, '')
    .replace(/[«»"']/g, '')
    .trim();
  return (cleaned.charAt(0) || '?').toUpperCase();
}

/** Абзац описания на отдельные пункты — источник хранит его одной строкой,
 *  а в эталоне это список из буллетов. */
function splitBullets(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+(?=[А-ЯA-ZЁ])/u)
    .map(p => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

function ExperienceEntry({ item, last, onEdit }: { item: ResumeExperience; last: boolean; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const bullets = item.description ? splitBullets(item.description) : [];
  const shown = expanded ? bullets : bullets.slice(0, 4);
  const canExpand = bullets.length > shown.length || (expanded && bullets.length > 4);

  return (
    <View style={[et.wrap, !last && et.border]}>
      <View style={et.head}>
        <View style={et.avatar}>
          <Text style={et.avatarText}>{companyInitial(item.company)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={et.position}>{item.position || 'Должность не указана'}</Text>
          {item.company ? <Text style={et.company}>{item.company}</Text> : null}
          <Text style={et.period}>{item.start} — {item.end}{item.duration ? ` · ${item.duration}` : ''}</Text>
        </View>
        <TouchableOpacity style={s.editBtn} onPress={onEdit} activeOpacity={0.72} accessibilityRole="button" accessibilityLabel={`Редактировать: ${item.position || item.company || 'место работы'}`}>
          <EditIcon size={15} color={ProfileColors.ink} />
        </TouchableOpacity>
      </View>

      {bullets.length ? (
        <View style={et.bullets}>
          {shown.map((line, i) => (
            <View key={i} style={et.bulletRow}>
              <View style={et.bulletDot} />
              <Text style={et.bulletText}>{line}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {canExpand || (expanded && bullets.length > 4) ? (
        <TouchableOpacity onPress={() => setExpanded(v => !v)} activeOpacity={0.75}>
          <Text style={et.more}>{expanded ? 'Свернуть' : 'Показать полностью'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function EntryItem({
  title, subtitle, meta, description, last, onPress,
}: { title: string; subtitle?: string; meta?: string; description?: string; last: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[en.wrap, !last && en.border]} onPress={onPress} activeOpacity={0.72} accessibilityRole="button" accessibilityLabel={`Редактировать: ${title}`}>
      <Text style={en.title}>{title}</Text>
      {subtitle ? <Text style={en.subtitle}>{subtitle}</Text> : null}
      {meta ? <Text style={en.meta}>{meta}</Text> : null}
      {description ? <Text style={en.description}>{description}</Text> : null}
    </TouchableOpacity>
  );
}

function ExamRow({ item, last, onPress }: { item: ResumeExam; last: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[er.row, !last && er.border]} onPress={onPress} activeOpacity={0.72} accessibilityRole="button" accessibilityLabel={`Редактировать: ${item.name}`}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={er.name}>{item.name}</Text>
        {item.date ? <Text style={er.date}>{item.date}</Text> : null}
      </View>
      {item.score ? <Text style={er.score}>{item.score}</Text> : null}
    </TouchableOpacity>
  );
}

function ChipsBlock({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 12;
  const shown = expanded ? items : items.slice(0, LIMIT);
  const rest = items.length - LIMIT;
  return (
    <View style={s.chips}>
      {shown.map((item, i) => <SkillChip key={`${item}-${i}`} label={item} />)}
      {!expanded && rest > 0 ? (
        <SkillChip label={`+${rest} ещё`} tone="accent" onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
          setExpanded(true);
        }} />
      ) : null}
    </View>
  );
}

// Экраны редактирования — docs/design/profile-edit/README.md, «Какой экран куда ведёт».
const EMPTY_SECTIONS: {
  key: keyof ResumeProfile;
  icon: React.ReactNode;
  title: string;
  accessibilityLabel: string;
  route: Href;
}[] = [
  { key: 'experience', icon: <BriefcaseIcon size={18} color={ProfileColors.ink} />, title: 'Опыт работы', accessibilityLabel: 'Добавить место работы', route: '/profile-edit/work-place' },
  { key: 'languages', icon: <GlobeIcon size={18} color={ProfileColors.ink} />, title: 'Языки', accessibilityLabel: 'Добавить языки', route: '/profile-edit/languages' },
  { key: 'skills', icon: <SparkleSkillIcon size={18} />, title: 'Навыки', accessibilityLabel: 'Добавить навыки', route: '/profile-edit/skills' },
  { key: 'education', icon: <GradCapIcon size={18} color={ProfileColors.ink} />, title: 'Образование', accessibilityLabel: 'Добавить образование', route: '/profile-edit/education' },
  { key: 'exams', icon: <ExamIcon size={18} color={ProfileColors.ink} />, title: 'Экзамены и тесты', accessibilityLabel: 'Добавить экзамен', route: '/profile-edit/exam' },
  { key: 'certifications', icon: <CertIcon size={18} color={ProfileColors.ink} />, title: 'Лицензии и сертификаты', accessibilityLabel: 'Добавить сертификат', route: '/profile-edit/certificate' },
  { key: 'coursework', icon: <CourseIcon size={18} color={ProfileColors.ink} />, title: 'Курсы', accessibilityLabel: 'Добавить курс', route: '/profile-edit/course' },
  { key: 'awards', icon: <StarIcon size={18} color={ProfileColors.ink} />, title: 'Награды', accessibilityLabel: 'Добавить награду', route: '/profile-edit/award' },
  { key: 'interests', icon: <HeartIcon size={18} color={ProfileColors.ink} />, title: 'Интересы', accessibilityLabel: 'Добавить интересы', route: '/profile-edit/interests' },
];

export function ResumeTabContent({
  resume, importing, onImport,
}: {
  resume?: ResumeProfile;
  importing: boolean;
  onImport: () => void;
}) {
  const router = useRouter();
  const open = (pathname: Href, index?: number) => {
    if (index == null) router.push(pathname);
    else router.push({ pathname: pathname as never, params: { index: String(index) } });
  };
  const experience = resume?.experience ?? [];
  const languages = resume?.languages ?? [];
  const skills = resume?.skills ?? [];
  const education = resume?.education ?? [];
  const exams = resume?.exams ?? [];
  const certifications = resume?.certifications ?? [];
  const coursework = resume?.coursework ?? [];
  const awards = resume?.awards ?? [];
  const interests = resume?.interests ?? [];

  const infoTiles: { label: string; value?: string }[] = [
    { label: 'Опыт', value: experienceLabel(experience) },
    { label: 'Занятость', value: resume?.employmentType },
    { label: 'Формат', value: resume?.workFormat },
    { label: 'Город', value: resume?.city },
  ].filter(t => !!t.value);

  const emptySections = EMPTY_SECTIONS.filter(section => {
    const value = resume?.[section.key];
    return Array.isArray(value) ? value.length === 0 : !value;
  });

  return (
    <View style={s.content}>
      <TouchableOpacity style={s.importBtnOuter} onPress={onImport} disabled={importing} activeOpacity={0.85}>
        <View pointerEvents="none" style={s.importShadow} />
        <View style={s.importCard}>
          <View style={s.importIcon}>
            {importing ? <ActivityIndicator size="small" color={ProfileColors.ink} /> : <UploadIcon size={20} color={ProfileColors.ink} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.importTitle}>{resume ? 'Обновить резюме' : 'Загрузить резюме'}</Text>
            <Text style={s.importSub}>{importing ? 'Распознаём файл…' : 'PDF до 10 МБ — поля заполнятся сами'}</Text>
          </View>
          <ChevronRightIcon size={18} color="#FFFFFF" />
        </View>
      </TouchableOpacity>

      {!resume ? (
        <View style={s.emptyResume}>
          <Text style={s.emptyResumeTitle}>Резюме пока не заполнено</Text>
          <Text style={s.emptyResumeText}>
            Загрузите PDF — опыт, образование, языки, навыки и дополнительные разделы появятся автоматически. Или заполните разделы ниже вручную.
          </Text>
        </View>
      ) : null}
        <>
          <View style={s.headlineCard}>
            <View style={s.headlineTop}>
              <Text style={s.eyebrow}>ЖЕЛАЕМАЯ ДОЛЖНОСТЬ</Text>
              <TouchableOpacity style={s.editBtn} onPress={() => open('/profile-edit/desired-position')} activeOpacity={0.72} accessibilityRole="button" accessibilityLabel="Изменить должность">
                <EditIcon size={15} color={ProfileColors.ink} />
              </TouchableOpacity>
            </View>
            <Text style={s.h2}>{resume?.desiredPosition || 'Не указано'}</Text>

            {resume?.salary ? (
              <HardShadowCard offset={3} radius={14} shadowColor={ProfileColors.ink} backgroundColor={ProfileColors.peach}>
                <View style={s.salaryRow}>
                  <View>
                    <Text style={s.salaryLabel}>ЗАРПЛАТА</Text>
                    <Text style={s.salaryValue}>{resume.salary.replace(/\s*(на руки|до вычета налогов)\s*$/i, '')}</Text>
                  </View>
                  <Text style={s.salaryHint}>{resume.salaryNet === false || /до вычета/i.test(resume.salary) ? 'до вычета налогов' : 'на руки'}</Text>
                </View>
              </HardShadowCard>
            ) : null}

            {infoTiles.length ? (
              <View style={s.tilesGrid}>
                {infoTiles.map(tile => (
                  <View key={tile.label} style={s.tile}>
                    <Text style={s.tileLabel}>{tile.label}</Text>
                    <Text style={s.tileValue}>{tile.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {experience.length ? (
            <SectionCard icon={<BriefcaseIcon size={18} color={ProfileColors.ink} />} title="Опыт работы" count={experience.length} gap={10}>
              {experience.map((item, i) => (
                <ExperienceEntry key={`${item.company}-${item.position}-${i}`} item={item} last={i === experience.length - 1} onEdit={() => open('/profile-edit/work-place', i)} />
              ))}
              <TouchableOpacity style={s.addWorkBtn} onPress={() => open('/profile-edit/work-place')} activeOpacity={0.78} accessibilityRole="button">
                <Text style={s.addWorkPlus}>+</Text>
                <Text style={s.addWorkText}>Добавить место работы</Text>
              </TouchableOpacity>
            </SectionCard>
          ) : null}

          {languages.length ? (
            <SectionCard icon={<GlobeIcon size={18} color={ProfileColors.ink} />} title="Языки" count={languages.length} onEdit={() => open('/profile-edit/languages')} editLabel="Редактировать языки" gap={0}>
              {languages.map((item, i) => (
                <LanguageLevel key={`${item.name}-${i}`} name={item.name} level={item.level} last={i === languages.length - 1} />
              ))}
            </SectionCard>
          ) : null}

          {skills.length ? (
            <SectionCard icon={<SparkleSkillIcon size={18} />} title="Навыки" count={skills.length} onEdit={() => open('/profile-edit/skills')} editLabel="Редактировать навыки">
              <ChipsBlock items={skills} />
            </SectionCard>
          ) : null}

          {education.length ? (
            <SectionCard icon={<GradCapIcon size={18} color={ProfileColors.ink} />} title="Образование" count={education.length} onAdd={() => open('/profile-edit/education')} gap={10}>
              {education.map((item: ResumeEducation, i) => (
                <EntryItem
                  key={`${item.institution ?? item.level}-${i}`}
                  title={item.institution ?? item.level ?? 'Образование'}
                  subtitle={[item.level && item.institution ? item.level : null, item.specialty].filter(Boolean).join(' · ') || undefined}
                  meta={item.period}
                  last={i === education.length - 1}
                  onPress={() => open('/profile-edit/education', i)}
                />
              ))}
            </SectionCard>
          ) : null}

          {exams.length ? (
            <SectionCard icon={<ExamIcon size={18} color={ProfileColors.ink} />} title="Экзамены и тесты" count={exams.length} onAdd={() => open('/profile-edit/exam')} gap={0}>
              {exams.map((item, i) => <ExamRow key={`${item.name}-${i}`} item={item} last={i === exams.length - 1} onPress={() => open('/profile-edit/exam', i)} />)}
            </SectionCard>
          ) : null}

          {certifications.length ? (
            <SectionCard icon={<CertIcon size={18} color={ProfileColors.ink} />} title="Лицензии и сертификаты" count={certifications.length} onAdd={() => open('/profile-edit/certificate')} gap={10}>
              {certifications.map((item: ResumeCertification, i) => (
                <EntryItem
                  key={`${item.name}-${i}`}
                  title={item.name}
                  subtitle={item.issuer}
                  meta={[item.date, item.expiration].filter(Boolean).join(' — ') || undefined}
                  last={i === certifications.length - 1}
                  onPress={() => open('/profile-edit/certificate', i)}
                />
              ))}
            </SectionCard>
          ) : null}

          {coursework.length ? (
            <SectionCard icon={<CourseIcon size={18} color={ProfileColors.ink} />} title="Курсы" count={coursework.length} onAdd={() => open('/profile-edit/course')} gap={10}>
              {coursework.map((item: ResumeCoursework, i) => (
                <EntryItem
                  key={`${item.name}-${i}`}
                  title={item.name}
                  subtitle={item.institution}
                  meta={item.period}
                  description={item.description}
                  last={i === coursework.length - 1}
                  onPress={() => open('/profile-edit/course', i)}
                />
              ))}
            </SectionCard>
          ) : null}

          {awards.length ? (
            <SectionCard icon={<StarIcon size={18} color={ProfileColors.ink} />} title="Награды" count={awards.length} onAdd={() => open('/profile-edit/award')} gap={10}>
              {awards.map((item: ResumeAward, i) => (
                <EntryItem
                  key={`${item.name}-${i}`}
                  title={item.name}
                  subtitle={item.issuer}
                  meta={item.date}
                  description={item.description}
                  last={i === awards.length - 1}
                  onPress={() => open('/profile-edit/award', i)}
                />
              ))}
            </SectionCard>
          ) : null}

          {interests.length ? (
            <SectionCard icon={<HeartIcon size={18} color={ProfileColors.ink} />} title="Интересы" count={interests.length} onEdit={() => open('/profile-edit/interests')}>
              <ChipsBlock items={interests} />
            </SectionCard>
          ) : null}

          {emptySections.length ? (
            <View style={s.moreCard}>
              <Text style={s.eyebrow}>ЕЩЁ МОЖНО ДОБАВИТЬ</Text>
              <Text style={s.moreSub}>{resume ? 'Этого не нашлось в загруженном PDF' : 'Нажмите, чтобы заполнить'}</Text>
              {emptySections.map((section, i) => (
                <AddRow
                  key={String(section.key)}
                  icon={section.icon}
                  iconBg={ProfileColors.subtleBg}
                  iconSize={36}
                  title={section.title}
                  onPress={() => open(section.route)}
                  last={i === emptySections.length - 1}
                  accessibilityLabel={section.accessibilityLabel}
                />
              ))}
            </View>
          ) : null}

          {resume?.sourceFileName ? (
            <View style={s.sourceCaption}>
              <DocPageIcon size={14} color={ProfileColors.muted} />
              <Text style={s.sourceText}>
                Заполнено из PDF «{resume.sourceFileName}»
                {resume.importedAt ? ` от ${new Date(resume.importedAt).toLocaleDateString('ru-RU')}` : ''}
              </Text>
            </View>
          ) : null}
        </>
    </View>
  );
}

function experienceLabel(experience: ResumeExperience[]): string | undefined {
  // Общий стаж резюме не хранится отдельным полем — оценка суммой длительностей
  // выглядела бы точнее, чем есть на самом деле (единицы измерения в PDF не
  // унифицированы). Показываем стаж последнего места — он у всех есть и не
  // требует придуманной арифметики.
  return experience[0]?.duration;
}

const s = StyleSheet.create({
  content: { gap: 14 },
  importBtnOuter: { width: '100%' },
  importShadow: {
    position: 'absolute', top: 4, left: 4, right: -4, bottom: -4,
    backgroundColor: ProfileColors.accent, borderRadius: 18,
  },
  importCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ProfileColors.ink,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
  },
  importIcon: {
    width: 42, height: 42, borderRadius: 12, backgroundColor: ProfileColors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  importTitle: { fontFamily: ProfileFonts.textBold, fontSize: 15, color: '#FFFFFF' },
  importSub: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: '#C9C0B4', marginTop: 2 },

  emptyResume: {
    backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 20, gap: 6,
    alignItems: 'center',
  },
  emptyResumeTitle: { fontFamily: ProfileFonts.headingBold, fontSize: 16, color: ProfileColors.ink },
  emptyResumeText: { fontFamily: ProfileFonts.textRegular, fontSize: 13, color: ProfileColors.muted, textAlign: 'center', lineHeight: 19 },

  headlineCard: { backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 18, gap: 12 },
  headlineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontFamily: ProfileFonts.textBold, fontSize: 11, letterSpacing: 0.9, color: ProfileColors.muted },
  editBtn: {
    width: 34, height: 34, borderRadius: ProfileRadius.pill, borderWidth: HAIRLINE, borderColor: ProfileColors.ink,
    backgroundColor: ProfileColors.surface, alignItems: 'center', justifyContent: 'center',
  },
  h2: { fontFamily: ProfileFonts.headingExtra, fontSize: 21, lineHeight: 25, letterSpacing: -0.3, color: ProfileColors.ink },
  salaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  salaryLabel: { fontFamily: ProfileFonts.textBold, fontSize: 10, letterSpacing: 0.8, color: ProfileColors.mutedDark },
  salaryValue: { fontFamily: ProfileFonts.headingExtra, fontSize: 19, color: ProfileColors.ink, marginTop: 2 },
  salaryHint: { fontFamily: ProfileFonts.textSemi, fontSize: 12, color: ProfileColors.ink },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexBasis: '48%', flexGrow: 1, backgroundColor: ProfileColors.bg, borderRadius: 12, padding: 12, gap: 2 },
  tileLabel: { fontFamily: ProfileFonts.textRegular, fontSize: 11, color: ProfileColors.muted },
  tileValue: { fontFamily: ProfileFonts.textBold, fontSize: 14, color: ProfileColors.ink },

  addWorkBtn: {
    height: 44, borderWidth: HAIRLINE, borderColor: ProfileColors.ink, borderRadius: ProfileRadius.pill,
    backgroundColor: ProfileColors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  addWorkPlus: { fontFamily: ProfileFonts.textBold, fontSize: 16, color: ProfileColors.ink, marginTop: -1 },
  addWorkText: { fontFamily: ProfileFonts.textSemi, fontSize: 14, color: ProfileColors.ink },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  moreCard: { backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 18, gap: 4 },
  moreSub: { fontFamily: ProfileFonts.textRegular, fontSize: 13, color: ProfileColors.muted, marginBottom: 6 },

  sourceCaption: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 8, paddingVertical: 2 },
  sourceText: { flex: 1, fontFamily: ProfileFonts.textRegular, fontSize: 11.5, lineHeight: 16, color: ProfileColors.muted },
});

const et = StyleSheet.create({
  wrap: { gap: 10, paddingBottom: 10 },
  border: { borderBottomWidth: 1, borderBottomColor: ProfileColors.line },
  head: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: {
    width: 42, height: 42, borderRadius: 10, backgroundColor: ProfileColors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: ProfileFonts.headingExtra, fontSize: 17, color: '#FFFFFF' },
  position: { fontFamily: ProfileFonts.textBold, fontSize: 15, color: ProfileColors.ink },
  company: { fontFamily: ProfileFonts.textMedium, fontSize: 13, color: ProfileColors.ink, marginTop: 1 },
  period: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted, marginTop: 1 },
  bullets: { gap: 6 },
  bulletRow: { flexDirection: 'row', gap: 10 },
  bulletDot: { width: 6, height: 6, backgroundColor: ProfileColors.accent, marginTop: 7, flexShrink: 0 },
  bulletText: { flex: 1, fontFamily: ProfileFonts.textRegular, fontSize: 13.5, lineHeight: 19, color: '#3D3833' },
  more: {
    fontFamily: ProfileFonts.textBold, fontSize: 13, color: ProfileColors.ink,
    textDecorationLine: 'underline', textDecorationColor: ProfileColors.accent,
    alignSelf: 'flex-start',
  },
});

const en = StyleSheet.create({
  wrap: { gap: 2, paddingBottom: 10 },
  border: { borderBottomWidth: 1, borderBottomColor: ProfileColors.line },
  title: { fontFamily: ProfileFonts.textBold, fontSize: 15, color: ProfileColors.ink },
  subtitle: { fontFamily: ProfileFonts.textMedium, fontSize: 13, color: ProfileColors.ink },
  meta: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted },
  description: { fontFamily: ProfileFonts.textRegular, fontSize: 13, lineHeight: 18, color: '#3D3833', marginTop: 2 },
});

const er = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 10 },
  border: { borderBottomWidth: 1, borderBottomColor: ProfileColors.line },
  name: { fontFamily: ProfileFonts.textSemi, fontSize: 15, color: ProfileColors.ink },
  date: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted, marginTop: 1 },
  score: { fontFamily: ProfileFonts.textBold, fontSize: 13, color: ProfileColors.ink },
});
