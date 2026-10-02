/**
 * Вымышленные компании для роликов (просьба владельца 02.10.2026: настоящие
 * логотипы не брать). Названия и знаки придуманы, нарисованы кодом; совпадение
 * с реальными брендами не задумано — заметили похожий, переименуй здесь.
 */
import React from 'react';

export type BrandKey = 'nimbus' | 'hexa' | 'lampa' | 'veter';
export type Brand = { name: string; site: string; mark: (s: number) => React.ReactNode; bg: string };

const g = (id: string, a: string, b: string) => (
  <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient></defs>
);

export const BRANDS: Record<BrandKey, Brand> = {
  // Финтех: монета, выглядывающая из-за облака, — «деньги в облаке».
  nimbus: {
    name: 'Нимбус Пэй', site: 'Нимбус Пэй · карьера', bg: 'url(#nimbus)',
    mark: s => (
      <svg width={s} height={s} viewBox="0 0 48 48">{g('nimbus', '#8B5CF6', '#4F46E5')}
        <rect width="48" height="48" rx="14" fill="url(#nimbus)" />
        <circle cx="31" cy="17" r="8" fill="#FDE68A" stroke="#F59E0B" strokeWidth="2" />
        <path d="M13 35a7 7 0 0 1 1.5-13.8A9.5 9.5 0 0 1 32 22a6.5 6.5 0 0 1 2 13z" fill="#fff" />
      </svg>),
  },
  // Маркетплейс: пакет в шестиугольнике.
  hexa: {
    name: 'Гексамаркет', site: 'Гексамаркет · вакансии', bg: 'url(#hexa)',
    mark: s => (
      <svg width={s} height={s} viewBox="0 0 48 48">{g('hexa', '#14B8A6', '#0369A1')}
        <path d="M24 2 43 13v22L24 46 5 35V13z" fill="url(#hexa)" />
        <path d="M16 19h16l-1.5 15h-13z" fill="#fff" />
        <path d="M20 19v-2a4 4 0 0 1 8 0v2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      </svg>),
  },
  // Онлайн-образование: лампочка-идея.
  lampa: {
    name: 'Лампа Скул', site: 'Лампа Скул · команда', bg: '#FACC15',
    mark: s => (
      <svg width={s} height={s} viewBox="0 0 48 48">
        <rect width="48" height="48" rx="24" fill="#FACC15" />
        <path d="M24 10a10 10 0 0 0-6 18v4h12v-4a10 10 0 0 0-6-18z" fill="#141414" />
        <path d="M19 36h10M21 40h6" stroke="#141414" strokeWidth="3" strokeLinecap="round" />
        <path d="M24 16v8l3 3" stroke="#FACC15" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </svg>),
  },
  // Логистика: две стрелки маршрута.
  veter: {
    name: 'Ветерлог', site: 'Ветерлог · работа у нас', bg: 'url(#veter)',
    mark: s => (
      <svg width={s} height={s} viewBox="0 0 48 48">{g('veter', '#FB923C', '#E11D48')}
        <rect width="48" height="48" rx="14" fill="url(#veter)" />
        <path d="M11 17h16l-5-5M37 31H21l5 5" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>),
  },
};

/** Знак компании в круге — как CompanyMark в ленте приложения. */
export const BrandMark: React.FC<{ b: BrandKey; size: number; round?: boolean; ring?: boolean }> = ({ b, size, round, ring }) => (
  <div style={{ width: size, height: size, flex: 'none', borderRadius: round ? size / 2 : size * 0.27, overflow: 'hidden',
    boxShadow: ring ? '0 0 0 2px #141414' : undefined, background: '#fff' }}>
    {BRANDS[b].mark(size)}
  </div>
);
