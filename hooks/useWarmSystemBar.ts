import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { JT } from '@/constants/jt';

/**
 * Тёплая зона со временем / сетью / батареей в установленной iOS PWA.
 *
 * Там её цвет берётся не из экрана, а из документа: meta theme-color и фон
 * HTML/BODY. Пока экран в фокусе — красим их в тёплую подложку макета, при
 * уходе возвращаем прежнее. Без этого сверху висит белая полоса над кремовым
 * экраном. На телефоне и в обычной вкладке браузера хук ничего не делает.
 */
export function useWarmSystemBar(enabled = true, color: string = JT.background) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled || Platform.OS !== 'web' || typeof document === 'undefined') return;
      const meta = document.querySelector('meta[name="theme-color"]');
      const previousTheme = meta?.getAttribute('content') ?? null;
      const previousHtmlBg = document.documentElement.style.backgroundColor;
      const previousBodyBg = document.body.style.backgroundColor;

      if (meta) meta.setAttribute('content', color);
      document.documentElement.style.backgroundColor = color;
      document.body.style.backgroundColor = color;

      return () => {
        if (meta) meta.setAttribute('content', previousTheme || '#F5F7FA');
        document.documentElement.style.backgroundColor = previousHtmlBg;
        document.body.style.backgroundColor = previousBodyBg;
      };
    }, [enabled, color]),
  );
}
