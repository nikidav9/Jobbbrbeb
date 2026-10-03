import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

import { LANDING_DETECT, LANDING_MARKUP, LANDING_SCRIPT, LANDING_STYLE } from '@/constants/landing';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        {/* Сайт компании для компьютера (constants/landing.ts): решаем до
            отрисовки, чтобы ни приложение, ни загрузочный экран не мелькнули. */}
        <script dangerouslySetInnerHTML={{ __html: LANDING_DETECT }} />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* Масштаб зафиксирован (решение владельца 25.09): ни сам браузер
            (приближение при фокусе поля на iOS, «ужать под ширину» на Android),
            ни человек пальцами экран не приближает. iOS Safari с 10-й версии
            user-scalable=no игнорирует — поэтому ниже ещё CSS touch-action и
            перехват жестов в скрипте. Карта метро живёт в своём iframe со своим
            viewport, её приближение это не трогает. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, shrink-to-fit=no, viewport-fit=cover" />

        <title>JobToo</title>
        <meta name="description" content="Работа в IT — свайпом. Листайте IT и офисные вакансии, а анкету на сайте работодателя заполнит Юпитер. Ответ — в чате приложения." />

        {/* PWA manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Theme color */}
        <meta name="theme-color" content="#F5EFE6" />

        {/* iOS Add to Home Screen */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="JobToo" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico?v=3" sizes="any" />
        {/* 120×120 — размер, который берёт Яндекс в выдачу (02.10.2026: там висел старый значок с полями). */}
        <link rel="icon" type="image/png" sizes="120x120" href="/favicon-120.png?v=3" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: LANDING_STYLE }} />

        {/* Веб/Telegram Mini App: браузер рисует свою рамку фокуса вокруг полей
            ввода — в нативном приложении её нет, и выглядит она инородно.
            Убираем только подсветку фокуса; собственные рамки полей, заданные
            стилями, не трогаем. */}
        <style>{`
          /* Только прокрутка: pinch-zoom и двойной тап для приближения
             запрещены на всём дереве. text-size-adjust — чтобы iOS сам не
             раздувал шрифт при повороте экрана. */
          html, body {
            touch-action: pan-x pan-y;
            -webkit-text-size-adjust: 100%;
            text-size-adjust: 100%;
          }
          input, textarea, select, [contenteditable] {
            outline: none !important;
            -webkit-tap-highlight-color: transparent;
          }
          input:focus, textarea:focus, select:focus, [contenteditable]:focus,
          input:focus-visible, textarea:focus-visible {
            outline: none !important;
            box-shadow: none !important;
          }
          /* iOS Safari подсвечивает поле своим фоном при автозаполнении */
          input:-webkit-autofill, textarea:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 1000px transparent inset;
            transition: background-color 9999s ease-out 0s;
          }
        `}</style>

        {/* Загрузочный экран — макет «JT-splash» (28.09.2026), 1:1 с нативным
            components/SplashLoader.tsx: оранжевая точка раскрывается в белую
            плашку, впрыгивает логотип, появляется тень-наклейка и подпись,
            полоса загрузки идёт по реальным этапам приложения. На выходе
            плашка улетает на место логотипа в шапке ленты. Шрифты — свои
            копии из макета: шрифты приложения приходят позже, с бандлом. */}
        <link rel="preload" href="/splash/logo.png" as="image" />
        <style>{`
          @font-face { font-family: 'JTSplashUnbounded'; font-weight: 700; font-display: swap;
            src: url('/splash/unbounded-cyrillic-700-normal.woff2') format('woff2');
            unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
          @font-face { font-family: 'JTSplashUnbounded'; font-weight: 700; font-display: swap;
            src: url('/splash/unbounded-latin-700-normal.woff2') format('woff2');
            unicode-range: U+0000-00FF, U+2000-206F, U+2212; }
          @font-face { font-family: 'JTSplashManrope'; font-weight: 700; font-display: swap;
            src: url('/splash/manrope-cyrillic-700-normal.woff2') format('woff2');
            unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
          @font-face { font-family: 'JTSplashManrope'; font-weight: 700; font-display: swap;
            src: url('/splash/manrope-latin-700-normal.woff2') format('woff2');
            unicode-range: U+0000-00FF, U+2000-206F, U+2212; }
          #splash {
            position: fixed; inset: 0; z-index: 9999;
            background: #F5EFE6; color: #141414;
            transition: background-color 0.6s ease 0.35s;
          }
          /* Центр плашки — на 45 % высоты, как (195, 380) на экране 844 */
          #splash-slot { position: absolute; left: 50%; top: 45%; width: 140px; height: 140px; margin: -70px 0 0 -70px; }
          #splash-plate {
            width: 140px; height: 140px; box-sizing: border-box;
            border: 2px solid #141414; border-radius: 36px; background: #FFFFFF;
            box-shadow: 6px 6px 0 #141414;
            display: flex; align-items: center; justify-content: center;
            animation: jt-plate 1100ms cubic-bezier(.2,.8,.2,1) both, jt-sticker 700ms ease-out 1700ms both;
          }
          /* Логотип впрыгивает, только когда картинка загружена: на медленной
             сети она приходила позже анимации, и плашка стояла пустой, а потом
             логотип появлялся рывком. Задержку ставит скрипт ниже. */
          #splash-logo { width: 96px; height: auto; display: block; opacity: 0; }
          #splash-logo.in { animation: jt-logo 700ms cubic-bezier(.3,1.4,.5,1) both; }
          #splash-below { position: absolute; left: 0; right: 0; top: calc(45% + 106px);
            display: flex; flex-direction: column; align-items: center; padding: 0 16px; }
          #splash-tag { margin: 0; font: 700 18px/1.2 'JTSplashUnbounded', -apple-system, 'Segoe UI', Roboto, sans-serif;
            letter-spacing: -0.01em; text-align: center; animation: jt-tag 700ms ease-out 1700ms both; }
          #splash-bar { margin-top: 26px; width: 180px; height: 14px; box-sizing: border-box;
            border: 2px solid #141414; border-radius: 7px; background: #FFFFFF; overflow: hidden;
            animation: jt-fade 500ms ease-out 2400ms both; }
          #splash-fill { display: block; height: 100%; width: 0; background: #FF6B1A;
            box-sizing: border-box; transition: width 120ms linear; }
          #splash-fill.on { border-right: 2px solid #141414; }
          #splash-cap { margin: 10px 0 0; font: 700 13px/1.3 'JTSplashManrope', -apple-system, 'Segoe UI', Roboto, sans-serif;
            color: #6B645C; text-align: center; animation: jt-fade 500ms ease-out 2400ms both; }
          #splash-retry { display: none; margin-top: 12px; padding: 10px 22px; border: 2px solid #141414;
            border-radius: 22px; background: #FF6B1A; color: #141414; box-shadow: 3px 3px 0 #141414;
            font: 700 14px 'JTSplashManrope', -apple-system, 'Segoe UI', Roboto, sans-serif; cursor: pointer; }
          #splash.slow #splash-retry { display: block; }
          @keyframes jt-plate {
            0%   { transform: scale(0); border-radius: 70px; background: #FF6B1A; }
            50%  { transform: scale(.13); border-radius: 70px; background: #FF6B1A; }
            100% { transform: scale(1); border-radius: 36px; background: #FFFFFF; }
          }
          @keyframes jt-sticker { from { box-shadow: 0 0 0 #141414; } to { box-shadow: 6px 6px 0 #141414; } }
          @keyframes jt-logo { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
          @keyframes jt-tag { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
          @keyframes jt-fade { from { opacity: 0; } to { opacity: 1; } }
          /* Переход в ленту: подпись и полоса гаснут, плашка уменьшается и
             улетает в левый верх — на место логотипа шапки (44, 78). */
          #splash.leave { background-color: rgba(245,239,230,0); pointer-events: none; }
          #splash.leave #splash-below { opacity: 0; transition: opacity 300ms ease; }
          #splash.leave #splash-plate {
            animation: none;
            transform: translate(calc(44px - 50vw), calc(78px - 45vh)) scale(.33);
            opacity: 0; box-shadow: 0 0 0 #141414;
            transition: transform 800ms cubic-bezier(.2,.8,.2,1), opacity 800ms ease, box-shadow 400ms ease;
          }
          @media (prefers-reduced-motion: reduce) {
            #splash-plate, #splash-logo.in, #splash-tag, #splash-bar, #splash-cap { animation: none; }
            #splash-logo.in { opacity: 1; }
            #splash.leave #splash-plate { transform: none; transition: opacity 200ms ease; }
            #splash { transition: background-color 200ms ease; }
          }
        `}</style>
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: LANDING_MARKUP }} />
        <div id="splash">
          <div id="splash-slot">
            <div id="splash-plate"><img id="splash-logo" src="/splash/logo.png" alt="JobToo" /></div>
          </div>
          <div id="splash-below">
            <p id="splash-tag">Работа в IT — свайпом</p>
            <div id="splash-bar" role="progressbar" aria-label="Загрузка" aria-valuemin={0} aria-valuemax={100}>
              <span id="splash-fill" />
            </div>
            <p id="splash-cap">Подбираем вакансии…</p>
            <button id="splash-retry" type="button">Повторить</button>
          </div>
        </div>
        {children}
        <script>{`
          // Запрет масштаба для тех, кто игнорирует viewport и touch-action:
          // жесты iOS Safari (gesture*), второй палец в touchmove и щипок на
          // тачпаде (wheel с ctrlKey). Слушатели не пассивные — иначе
          // preventDefault не сработает.
          (function() {
            var stop = function(e) { e.preventDefault(); };
            ['gesturestart', 'gesturechange', 'gestureend'].forEach(function(t) {
              document.addEventListener(t, stop, { passive: false });
            });
            document.addEventListener('touchmove', function(e) {
              if (e.touches && e.touches.length > 1) e.preventDefault();
            }, { passive: false });
            window.addEventListener('wheel', function(e) {
              if (e.ctrlKey) e.preventDefault();
            }, { passive: false });
          })();
          (function() {
            var splash = document.getElementById('splash');
            var fill = document.getElementById('splash-fill');
            var bar = document.getElementById('splash-bar');
            var cap = document.getElementById('splash-cap');
            var retry = document.getElementById('splash-retry');
            var done = false, finishRequested = false, pct = 1;
            // Заставка всегда ~5 с (решение владельца 28.09.2026): раскадровка
            // растянута вдвое, в 4,4 с плашка улетает в шапку, к ~5,2 с экран
            // убран. Полоса идёт с 2,4 с и доходит до 100 % ровно к 4,4 с, даже
            // если данные пришли раньше; медленнее данных она не бывает.
            var MIN_MS = 4400, BAR_FROM = 2400;
            var shownAt = (window.performance && performance.now) ? performance.now() : 0;
            function now() { return (window.performance && performance.now) ? performance.now() : shownAt + MIN_MS; }
            // Логотип впрыгивает на 1,1 с (раскадровка растянута до ~5 с); пришёл позже — сразу.
            // Не загрузился — показываем как есть (подпись alt), а не пустую плашку.
            var logo = document.getElementById('splash-logo');
            function logoIn() {
              if (!logo || logo.classList.contains('in')) return;
              logo.style.animationDelay = Math.max(0, 1100 - (now() - shownAt)) + 'ms';
              logo.classList.add('in');
            }
            if (logo) {
              // complete — и после успеха, и после ошибки: ждать тут нечего.
              if (logo.complete) logoIn();
              else {
                logo.addEventListener('load', logoIn);
                logo.addEventListener('error', logoIn);
              }
            }
            // Пока bundle скачивается, плавно идём до 30 %. Дальше каждая
            // граница открывается только реальным этапом приложения:
            // HTML/download=1..30, bundle=35, boot=45, session=55,
            // cache=70, API=80, ready=100.
            var target = Math.max(30, window.__jobtooSplashPendingProgress || 1);

            // Показываем меньшее из реального прогресса и времени: полоса не
            // прыгает к 100 %, а плавно доходит к MIN_MS.
            function shown() {
              var cap = Math.max(0, Math.min(100, (now() - shownAt - BAR_FROM) / (MIN_MS - BAR_FROM) * 100));
              return Math.round(Math.min(pct, cap));
            }
            function paint() {
              var v = shown();
              if (fill) {
                fill.style.width = v + '%';
                if (v > 0 && v < 100) fill.classList.add('on'); else fill.classList.remove('on');
              }
              if (bar) bar.setAttribute('aria-valuenow', String(v));
            }
            var tick = setInterval(function() {
              if (finishRequested) pct = 100;
              else if (pct < target) pct += 1;
              paint();
              if (finishRequested && shown() >= 100) { clearInterval(tick); setTimeout(hide, 150); }
            }, 25);
            paint();

            window.__setSplashProgress = function(value) {
              var next = Math.max(1, Math.min(100, Number(value) || 1));
              // 100 % по контракту означает, что критические данные готовы.
              // Не ждём второго независимого сигнала __hideSplash: в старом
              // iOS-ярлыке переход маршрута иногда его не вызывал, поэтому
              // счётчик доходил до 100 и оставался там навсегда.
              if (next >= 100) finish();
              else target = Math.max(target, Math.round(next));
            };

            function hide() {
              clearInterval(tick);
              // Полоса браузера была в цвет загрузочного экрана. Экран, который
              // красит её сам (useWarmSystemBar ставит фон html inline), уже
              // решил за нас; иначе возвращаем светлый цвет интерфейса.
              var tc = document.querySelector('meta[name="theme-color"]');
              if (tc && tc.getAttribute('content') === '#F5EFE6' && !document.documentElement.style.backgroundColor) {
                tc.setAttribute('content', '#F5F7FA');
              }
              if (splash) {
                splash.classList.add('leave');
                setTimeout(function() { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 1000);
              }
            }

            function finish() {
              if (done) return;
              done = true;
              target = 100;
              finishRequested = true;
            }

            // The app hides the splash itself once data is loaded
            // (EntryTransition / index.tsx call window.__hideSplash).
            window.__hideSplash = finish;
            if (window.__jobtooHideSplashRequested || window.__jobtooSplashPendingProgress >= 100) finish();

            // Service worker нужен не только для push: в установленной PWA он
            // не даёт старому index.html пережить следующую выкладку.
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
                .then(function(reg) { return reg.update(); })
                .catch(function() {});
            }

            // Не перезагружаем страницу автоматически: именно эта страховка
            // раньше создавала второй загрузочный экран на медленной сети.
            // Дольше 10 с (макет: 8 с сверх обычной загрузки) — честно говорим и даём повтор.
            if (retry) retry.onclick = function() { location.reload(); };
            setTimeout(function() {
              if (done || !splash) return;
              if (cap) cap.textContent = 'Долго грузится… Проверьте интернет';
              splash.classList.add('slow');
            }, 10000);
          })();
        `}</script>
        <script dangerouslySetInnerHTML={{ __html: LANDING_SCRIPT }} />
      </body>
    </html>
  );
}
