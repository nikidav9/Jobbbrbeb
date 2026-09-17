import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Dimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  interpolate, Extrapolation, runOnJS, cancelAnimation,
} from 'react-native-reanimated';

const { width: SW } = Dimensions.get('window');

/** Сколько карточка должна уехать вбок, чтобы отпускание засчиталось решением. */
export const SWIPE_THRESHOLD = 80;
/** Быстрый бросок засчитывается и без этого расстояния. Пиксели в миллисекунду. */
export const VELOCITY_THRESHOLD = 0.3;

const MAX_ROTATION = 8;
const SPRING = { damping: 22, stiffness: 250, mass: 1 } as const;

export interface SwipeDeckHandlers {
  /** Отпустили вправо — принять. vx в пикселях на миллисекунду. */
  want: (vx: number) => void;
  /** Отпустили влево — отклонить. */
  skip: (vx: number) => void;
}

/**
 * Свайп карточки колоды.
 *
 * Поведение здесь ровно то же, что было на PanResponder: карточка ходит
 * только влево-вправо, вертикаль не трогает, наклон до восьми градусов на
 * половину экрана, пороги решения прежние. Менялось только одно — где это
 * считается.
 *
 * Раньше это был Animated с useNativeDriver: false, то есть каждый кадр
 * проходил через мост JS. Стоило потоку JS отвлечься на загрузку ленты — и
 * карточка отставала от пальца. Теперь обработчики жеста это ворклеты, а
 * стили анимированные: движение считается на потоке интерфейса и не зависит
 * от того, чем занят JS.
 *
 * Порог входа — восемь пикселей вбок (activeOffsetX). У PanResponder к нему
 * прилагалось условие «вбок должно быть в 1.2 раза больше, чем вниз»: оно
 * существовало затем, чтобы не отнимать жест у прокрутки внутри карточки.
 * Прокрутки внутри карточки больше нет, отнимать не у кого, и правило вместе
 * со своей причиной ушло.
 */
export function useSwipeDeck(handlers: SwipeDeckHandlers) {
  const x = useSharedValue(0);
  // Карточка уже уезжает: жест её не трогает, второго решения не будет.
  const busy = useSharedValue(false);
  // Жест дошёл до перетаскивания — это был свайп, а не нажатие.
  const activated = useSharedValue(false);

  // Когда закончился последний свайп.
  //
  // Нужно вот зачем. На вебе браузер после перетаскивания всё равно присылает
  // click, и обычное нажатие на карточке срабатывает следом за свайпом:
  // карточка улетает и одновременно открываются подробности. На телефоне
  // такого нет — там жест забирает касание у системы нажатий, — но веб у нас
  // тоже рабочий, и вести себя он должен так же.
  const lastSwipeAt = useRef(0);
  const markSwipe = useCallback(() => { lastSwipeAt.current = Date.now(); }, []);
  /** Было ли только что перетаскивание: нажатие после него нужно пропустить. */
  const wasSwipe = useCallback(() => Date.now() - lastSwipeAt.current < 400, []);

  // Обработчики пересоздаются на каждой отрисовке (замыкают состояние), а жест
  // собирается один раз. Через ссылку жест всегда зовёт свежие.
  const h = useRef(handlers);
  useEffect(() => { h.current = handlers; });

  const callWant = useCallback((vx: number) => h.current.want(vx), []);
  const callSkip = useCallback((vx: number) => h.current.skip(vx), []);

  /** Мгновенно вернуть карточку в исходное — при смене колоды. */
  const reset = useCallback(() => {
    cancelAnimation(x);
    x.value = 0;
    busy.value = false;
  }, [x, busy]);

  /** Пружиной вернуть на место: решение не принято. */
  const snapBack = useCallback(() => {
    busy.value = false;
    x.value = withSpring(0, SPRING);
  }, [x, busy]);

  /**
   * Улёт за край экрана. after() зовётся, когда карточка долетела, — колода
   * меняется уже после анимации, иначе следующая карточка появлялась бы под
   * ещё летящей.
   */
  const flyOut = useCallback((dir: 'left' | 'right', vx: number, after: () => void) => {
    if (busy.value) return;
    busy.value = true;
    // Чем сильнее бросок, тем быстрее улёт: карточка продолжает движение руки,
    // а не проигрывает одну и ту же анимацию на любой скорости.
    const duration = Math.max(180, Math.min(300, 250 / (Math.abs(vx) + 0.5)));
    x.value = withTiming((dir === 'right' ? 1 : -1) * SW * 1.5, { duration }, finished => {
      'worklet';
      if (!finished) return;
      x.value = 0;
      busy.value = false;
      runOnJS(after)();
    });
  }, [x, busy]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-8, 8])
      // Палец ушёл вниз на двадцать пикселей, не набрав восьми вбок — это не
      // свайп, а потягивание для обновления: жест проигрывает, и его забирает
      // список с RefreshControl.
      //
      // Свайпам это не мешает и не строже прежнего. У PanResponder условие
      // было «вбок в 1.2 раза больше, чем вниз»: в момент, когда dx доходил до
      // восьми, dy должен был быть меньше семи. Здесь допуск двадцать, то есть
      // наклонные свайпы, которые раньше не проходили, теперь проходят.
      .failOffsetY([-20, 20])
      .onStart(() => {
        'worklet';
        activated.value = true;
      })
      // Отмечаем только состоявшееся перетаскивание. onFinalize приходит и на
      // обычном касании, поэтому без флага он глушил бы каждое нажатие.
      .onFinalize(() => {
        'worklet';
        if (!activated.value) return;
        activated.value = false;
        runOnJS(markSwipe)();
      })
      .onUpdate(e => {
        'worklet';
        if (busy.value) return;
        x.value = e.translationX;
      })
      .onEnd(e => {
        'worklet';
        if (busy.value) return;
        // Скорость приходит в пикселях в секунду, пороги здесь в пикселях на
        // миллисекунду. Без деления любое касание считалось бы броском.
        const vx = e.velocityX / 1000;
        const dx = e.translationX;
        if (dx > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD) {
          runOnJS(callWant)(Math.abs(vx));
        } else if (dx < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD) {
          runOnJS(callSkip)(Math.abs(vx));
        } else {
          x.value = withSpring(0, SPRING);
        }
      });

    // Только для веба, на телефоне игнорируется. gesture-handler по умолчанию
    // ставит области жеста touch-action: none, и браузер перестаёт прокручивать
    // её пальцем ВООБЩЕ — даже после того, как failOffsetY отменил жест. Колесо
    // при этом работает, поэтому на снимках экрана этого не видно: там
    // прокрутка идёт мимо жестов. 'pan-y' отдаёт вертикаль браузеру, оставляя
    // нам горизонталь.
    //
    // Пишем в config напрямую: в 2.24 свойство поддерживается (оно в
    // baseGestureHandlerProps), а вот метода-настройщика для него в цепочке
    // нет, в отличие от остальных.
    pan.config.touchAction = 'pan-y';
    return pan;
  }, [x, busy, activated, markSwipe, callWant, callSkip]);

  const cardStyle = useAnimatedStyle(() => {
    'worklet';
    const rot = interpolate(x.value, [-SW / 2, 0, SW / 2], [-MAX_ROTATION, 0, MAX_ROTATION], Extrapolation.CLAMP);
    return { transform: [{ translateX: x.value }, { rotate: `${rot}deg` }] };
  });

  const wantStyle = useAnimatedStyle(() => {
    'worklet';
    return { opacity: interpolate(x.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP) };
  });

  const skipStyle = useAnimatedStyle(() => {
    'worklet';
    return { opacity: interpolate(-x.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP) };
  });

  // Объект собирается один раз: иначе он менялся бы на каждой отрисовке и
  // тянул бы за собой перезапуск всего, что на него смотрит.
  return useMemo(() => ({ gesture, cardStyle, wantStyle, skipStyle, flyOut, snapBack, reset, wasSwipe }),
    [gesture, cardStyle, wantStyle, skipStyle, flyOut, snapBack, reset, wasSwipe]);
}
