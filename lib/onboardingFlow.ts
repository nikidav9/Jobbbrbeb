import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export const ONBOARDING_VERSION = 3;
export const onboardingStorageKey = (uid: string) => `jm_onboarding_v${ONBOARDING_VERSION}_${uid}`;

export type OnboardingRole = 'worker' | 'employer';
export type OnboardingChapter = 'start' | 'work' | 'responses' | 'tools';

export type OnboardingStep = {
  id: string;
  chapter: OnboardingChapter;
  path: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  target?: string;
  navigate?: string;
  cta?: string;
};

const workerSteps: OnboardingStep[] = [
  {
    id: 'worker-welcome', chapter: 'start', path: '/feed', icon: 'sparkles',
    title: 'Найдём работу вместе',
    body: 'Обучение проходит прямо в приложении. Нажимайте выделенные элементы — реальные отклики и сообщения отправляться не будут.',
    cta: 'Начать',
  },
  {
    id: 'worker-card', chapter: 'work', path: '/feed', target: 'worker.feed.card', icon: 'reader-outline',
    title: 'Карточка вакансии',
    body: 'Здесь зарплата, график, метро, адрес и описание. Карточку можно прокручивать вниз.',
  },
  {
    id: 'worker-save', chapter: 'work', path: '/feed', target: 'worker.feed.save', icon: 'bookmark-outline',
    title: 'Сохранить на потом',
    body: 'Нажмите закладку. В обучении мы только покажем действие — вакансия не изменится.',
  },
  {
    id: 'worker-filter', chapter: 'work', path: '/feed', target: 'worker.feed.filter', icon: 'options-outline',
    title: 'Настроить выдачу',
    body: 'Фильтры помогут выбрать метро, зарплату, график и работодателя.',
  },
  {
    id: 'worker-reject', chapter: 'work', path: '/feed', target: 'worker.feed.reject', icon: 'close-circle-outline',
    title: 'Пропустить вакансию',
    body: 'Крестик или свайп влево убирают неподходящую карточку из текущей выдачи.',
  },
  {
    id: 'worker-apply', chapter: 'work', path: '/feed', target: 'worker.feed.apply', icon: 'heart-outline',
    title: 'Откликнуться',
    body: 'Сердце или свайп вправо открывают отклик. Сейчас это демо: заявка работодателю не уйдёт.',
  },
  {
    id: 'worker-open-responses', chapter: 'responses', path: '/feed', target: 'tab.matches', icon: 'document-text-outline',
    title: 'Перейдите в отклики',
    body: 'Нажмите «Отклики», чтобы увидеть статусы заявок и ответы работодателей.',
    navigate: '/(tabs)/matches',
  },
  {
    id: 'worker-responses', chapter: 'responses', path: '/matches', target: 'matches.content', icon: 'git-branch-outline',
    title: 'Следите за статусом',
    body: 'Здесь видно, кто рассматривает отклик, кто пригласил и где требуется ваш ответ.',
  },
  {
    id: 'worker-open-saved', chapter: 'responses', path: '/matches', target: 'matches.saved', icon: 'bookmark-outline',
    title: 'Откройте избранное',
    body: 'Все вакансии, отмеченные закладкой, собраны в отдельном списке.',
    navigate: '/saved',
  },
  {
    id: 'worker-saved', chapter: 'responses', path: '/saved', target: 'saved.content', icon: 'albums-outline',
    title: 'Избранные вакансии',
    body: 'Отсюда можно открыть вакансию, откликнуться или удалить её из сохранённых.',
  },
  {
    id: 'worker-saved-back', chapter: 'responses', path: '/saved', target: 'saved.back', icon: 'arrow-back',
    title: 'Вернитесь к откликам',
    body: 'Нажмите стрелку назад — продолжим знакомство с разделом.',
    navigate: '/(tabs)/matches',
  },
  {
    id: 'worker-open-chats', chapter: 'responses', path: '/matches', target: 'matches.chats', icon: 'chatbubbles-outline',
    title: 'Откройте сообщения',
    body: 'Переписка появляется после ответа работодателя. Нажмите конверт.',
    navigate: '/(tabs)/chats',
  },
  {
    id: 'worker-chats', chapter: 'responses', path: '/chats', target: 'chats.content', icon: 'mail-outline',
    title: 'Все диалоги в одном месте',
    body: 'Ищите переписку по компании или вакансии и фильтруйте непрочитанные.',
  },
  {
    id: 'worker-chats-back', chapter: 'responses', path: '/chats', target: 'chats.back', icon: 'arrow-back',
    title: 'Вернитесь назад',
    body: 'Нажмите стрелку — осталось посмотреть профиль и помощь.',
    navigate: '/(tabs)/matches',
  },
  {
    id: 'worker-open-profile', chapter: 'tools', path: '/matches', target: 'tab.profile', icon: 'person-outline',
    title: 'Откройте профиль',
    body: 'Нажмите «Профиль». Заполненный профиль повышает шанс получить ответ.',
    navigate: '/(tabs)/profile',
  },
  {
    id: 'worker-profile', chapter: 'tools', path: '/profile', target: 'profile.content', icon: 'person-circle-outline',
    title: 'Проверьте данные',
    body: 'Здесь меняются контакты, специализация, метро и рассказ о себе.',
  },
  {
    id: 'worker-support', chapter: 'tools', path: '/profile', icon: 'help-circle-outline',
    title: 'Помощь всегда рядом',
    body: 'В поддержке есть ответы на частые вопросы и связь с командой JobToo.',
  },
  {
    id: 'worker-invite', chapter: 'tools', path: '/profile', icon: 'gift-outline',
    title: 'Пригласить знакомого',
    body: 'В разделе приглашений находится ваша персональная ссылка и статистика.',
  },
  {
    id: 'worker-finish', chapter: 'tools', path: '/profile', icon: 'checkmark-circle',
    title: 'Готово',
    body: 'Вы прошли все главы. Обучение можно запустить снова в разделе «Документы».',
    cta: 'Начать искать работу',
    navigate: '/(tabs)/feed',
  },
];

const employerSteps: OnboardingStep[] = [
  {
    id: 'employer-welcome', chapter: 'start', path: '/feed', icon: 'sparkles',
    title: 'Найдём сотрудников вместе',
    body: 'Обучение проходит прямо в приложении. Все публикации и решения здесь безопасные: данные на сервер не записываются.',
    cta: 'Начать',
  },
  {
    id: 'employer-vacancies', chapter: 'work', path: '/feed', target: 'employer.feed.content', icon: 'briefcase-outline',
    title: 'Ваши вакансии',
    body: 'На главной видны активные и закрытые вакансии, просмотры и количество откликов.',
  },
  {
    id: 'employer-create', chapter: 'work', path: '/feed', target: 'employer.feed.create', icon: 'add-circle-outline',
    title: 'Создайте вакансию',
    body: 'Нажмите плюс. Откроется настоящая форма, но в обучении публикация будет имитацией.',
    navigate: '/create-perm-vacancy?onboarding=1',
  },
  {
    id: 'employer-form', chapter: 'work', path: '/create-perm-vacancy', target: 'employer.create.form', icon: 'create-outline',
    title: 'Заполните основные условия',
    body: 'Выберите специальность, метро, адрес, зарплату и график. Описание можно добавить позже.',
  },
  {
    id: 'employer-publish', chapter: 'work', path: '/create-perm-vacancy', target: 'employer.create.publish', icon: 'rocket-outline',
    title: 'Опубликовать',
    body: 'Нажмите кнопку. В деморежиме вакансия не создастся — мы вернёмся к списку.',
    navigate: '/(tabs)/feed',
  },
  {
    id: 'employer-open-responses', chapter: 'responses', path: '/feed', target: 'tab.matches', icon: 'people-outline',
    title: 'Перейдите в отклики',
    body: 'Нажмите «Отклики», чтобы посмотреть кандидатов и их статусы.',
    navigate: '/(tabs)/matches',
  },
  {
    id: 'employer-responses', chapter: 'responses', path: '/matches', target: 'matches.content', icon: 'people-circle-outline',
    title: 'Кандидаты и решения',
    body: 'Здесь можно открыть профиль, одобрить или отклонить кандидата и увидеть, кто ждёт ответа.',
  },
  {
    id: 'employer-open-chats', chapter: 'responses', path: '/matches', icon: 'chatbubbles-outline',
    title: 'Откройте сообщения',
    body: 'После одобрения общение продолжается в чате. В обучении реальные сообщения не отправляются.',
    cta: 'Посмотреть сообщения',
    navigate: '/(tabs)/chats',
  },
  {
    id: 'employer-chats', chapter: 'responses', path: '/chats', target: 'chats.content', icon: 'mail-outline',
    title: 'Диалоги с кандидатами',
    body: 'Поиск и фильтр непрочитанных помогают быстро отвечать по каждой вакансии.',
  },
  {
    id: 'employer-chats-back', chapter: 'responses', path: '/chats', target: 'chats.back', icon: 'arrow-back',
    title: 'Вернитесь к откликам',
    body: 'Нажмите стрелку назад — осталось посмотреть настройки компании.',
    navigate: '/(tabs)/matches',
  },
  {
    id: 'employer-open-profile', chapter: 'tools', path: '/matches', target: 'tab.profile', icon: 'person-outline',
    title: 'Откройте профиль',
    body: 'Нажмите «Профиль», чтобы проверить данные компании и контакты.',
    navigate: '/(tabs)/profile',
  },
  {
    id: 'employer-profile', chapter: 'tools', path: '/profile', target: 'profile.content', icon: 'business-outline',
    title: 'Профиль компании',
    body: 'Здесь меняются личные данные, название компании, описание и документы.',
  },
  {
    id: 'employer-support', chapter: 'tools', path: '/profile', icon: 'help-circle-outline',
    title: 'Помощь и поддержка',
    body: 'Откройте этот раздел, если возник вопрос по публикации, отклику или аккаунту.',
  },
  {
    id: 'employer-finish', chapter: 'tools', path: '/profile', icon: 'checkmark-circle',
    title: 'Готово',
    body: 'Вы прошли все главы. Обучение можно повторить из раздела «Документы».',
    cta: 'Перейти к вакансиям',
    navigate: '/(tabs)/feed',
  },
];

export function onboardingSteps(role: OnboardingRole): OnboardingStep[] {
  return role === 'worker' ? workerSteps : employerSteps;
}

export function normalizeOnboardingPath(pathname: string): string {
  const clean = (pathname.split('?')[0] || '/').replace(/\/$/, '') || '/';
  return clean.startsWith('/(tabs)') ? clean.replace('/(tabs)', '') || '/feed' : clean;
}

export const chapterLabel: Record<OnboardingChapter, string> = {
  start: 'Знакомство',
  work: 'Основная работа',
  responses: 'Отклики и общение',
  tools: 'Профиль и помощь',
};
