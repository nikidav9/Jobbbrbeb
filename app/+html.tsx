import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        <title>JobToo</title>
        <meta name="description" content="Работа в Москве — свайпайте и откликайтесь" />

        {/* PWA manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Theme color */}
        <meta name="theme-color" content="#FF6B1A" />

        {/* iOS Add to Home Screen */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="JobToo" />
        <link rel="apple-touch-icon" href="/jt-logo.jpg" />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" />

        <ScrollViewStyleReset />

        {/* Веб/Telegram Mini App: браузер рисует свою рамку фокуса вокруг полей
            ввода — в нативном приложении её нет, и выглядит она инородно.
            Убираем только подсветку фокуса; собственные рамки полей, заданные
            стилями, не трогаем. */}
        <style>{`
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

        {/* Static splash — same visual as the native loader (components/SplashLoader.tsx):
            корзина рисуется белой линией на фирменном оранжевом, в неё плавно
            опускаются продукты, снизу — название и счётчик. Пути и тайминги
            совпадают с нативной версией один в один, поэтому веб/Telegram
            Mini App и приложение читаются как один экран. */}
        <style>{`
          #splash {
            position: fixed; inset: 0;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            background: #FF6B1A; z-index: 9999;
            transition: opacity 0.35s ease;
          }
          #splash.hidden { opacity: 0; pointer-events: none; }
          #splash-art { width: min(62vw, 30vh); }
          #splash-art svg { width: 100%; height: auto; display: block; }
          .sp {
            fill: none; stroke: #fff;
            stroke-linecap: round; stroke-linejoin: round;
            stroke-dasharray: var(--l); stroke-dashoffset: var(--l);
            animation: sp-draw var(--d) linear var(--dl) forwards;
          }
          @keyframes sp-draw { to { stroke-dashoffset: 0; } }
          /* товары опускаются в корзину */
          .pr { opacity: 0; animation: sp-fall 260ms cubic-bezier(.22,.61,.36,1) var(--dl) forwards; }
          .pr path { fill: none; stroke: #fff; stroke-linecap: round; stroke-linejoin: round; }
          @keyframes sp-fall {
            from { opacity: 0; transform: translateY(-46px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          #splash-bottom {
            display: flex; flex-direction: column; align-items: center;
            margin-top: 24px;
          }
          @keyframes sp-fade { to { opacity: 1; } }
          #splash-name {
            font-size: 32px; font-weight: 800; letter-spacing: -0.8px;
            color: #fff; opacity: 0;
            animation: sp-fade 0.45s ease 760ms forwards;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          /* Счётчик виден с первого кадра — отсчёт начинается с единицы */
          #splash-pct {
            margin-top: 10px; font-size: 17px; font-weight: 700;
            font-style: italic; letter-spacing: 1.5px;
            color: rgba(255,255,255,0.85);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          @media (prefers-reduced-motion: reduce) {
            .sp { animation: none; stroke-dashoffset: 0; }
            .pr { animation: none; opacity: 1; transform: none; }
            #splash-name { animation: none; opacity: 1; }
          }
        `}</style>
      </head>
      <body>
        <div id="splash">
          <div
            id="splash-art"
            dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">
<g transform="translate(32 60)"><g class="pr" style="--dl:500ms"><path d="M 6 48 L 4 24 Q 3 17 8 14 L 8 4 L 22 4 L 22 14 Q 27 17 26 24 L 24 48 Q 15 52 6 48 Z" transform="rotate(-16 14 28)" stroke-width="3"/><path d="M 8 10 L 22 10" transform="rotate(-16 14 28)" stroke-width="2.4"/></g></g>
<g transform="translate(80 26)"><g class="pr" style="--dl:650ms"><path d="M 20 14 A 18 18 0 1 1 19.99 14" stroke-width="3"/><path d="M 20 15 L 23 2" stroke-width="2.6"/><path d="M 23 6 Q 35 0 37 10 Q 27 14 23 6 Z" stroke-width="2.6"/></g></g>
<g transform="translate(132 72)"><g class="pr" style="--dl:800ms"><path d="M 4 22 Q 2 4 22 2 Q 42 4 40 22 Q 38 32 22 32 Q 6 32 4 22 Z" transform="rotate(14 22 14)" stroke-width="3"/><path d="M 13 11 L 19 17" transform="rotate(14 22 14)" stroke-width="2.4"/><path d="M 24 9 L 30 15" transform="rotate(14 22 14)" stroke-width="2.4"/></g></g>
<path class="sp" d="M 68 148 Q 70 100 100 98 Q 130 100 132 148" stroke-width="3.4" style="--l:136;--d:90ms;--dl:0ms"/>
<path class="sp" d="M 28 150 Q 100 137 172 150" stroke-width="3.4" style="--l:150;--d:90ms;--dl:77ms"/>
<path class="sp" d="M 28 150 Q 100 163 172 150" stroke-width="3.4" style="--l:150;--d:77ms;--dl:154ms"/>
<path class="sp" d="M 34 153 L 55 231 Q 57 240 67 240 L 133 240 Q 143 240 145 231 L 166 153" stroke-width="3.4" style="--l:264;--d:205ms;--dl:218ms"/>
<path class="sp" d="M 60 160 L 70 236" stroke-width="2.4" style="--l:78;--d:58ms;--dl:403ms"/>
<path class="sp" d="M 86 158 L 90 239" stroke-width="2.4" style="--l:82;--d:58ms;--dl:429ms"/>
<path class="sp" d="M 114 158 L 110 239" stroke-width="2.4" style="--l:82;--d:58ms;--dl:454ms"/>
<path class="sp" d="M 140 160 L 130 236" stroke-width="2.4" style="--l:78;--d:58ms;--dl:480ms"/>
<path class="sp" d="M 44 196 Q 100 205 156 196" stroke-width="2.4" style="--l:116;--d:115ms;--dl:525ms"/>
<path class="sp" d="M 22 116 L 12 106" stroke-width="2.6" style="--l:15;--d:60ms;--dl:1060ms"/>
<path class="sp" d="M 178 114 L 188 104" stroke-width="2.6" style="--l:15;--d:60ms;--dl:1090ms"/>
<path class="sp" d="M 100 18 L 100 8" stroke-width="2.6" style="--l:11;--d:60ms;--dl:1120ms"/>
<path class="sp" d="M 58 40 L 51 32" stroke-width="2.6" style="--l:11;--d:60ms;--dl:1150ms"/>
<path class="sp" d="M 146 38 L 154 30" stroke-width="2.6" style="--l:11;--d:80ms;--dl:1180ms"/>
</svg>` }}
          />
          <div id="splash-bottom">
            <div id="splash-name">JobToo</div>
            <div id="splash-pct">1%</div>
          </div>
        </div>
        {children}
        <script>{`
          (function() {
            var splash = document.getElementById('splash');
            var pctEl = document.getElementById('splash-pct');
            var done = false, finishRequested = false, pct = 1;
            // Пока bundle скачивается, плавно идём до 30 %. Дальше каждая
            // граница открывается только реальным этапом приложения.
            var target = Math.max(30, window.__jobtooSplashPendingProgress || 1);

            // Не перескакиваем десятками: показываем каждое целое значение.
            // HTML/download=1..30, bundle=35, boot=45, session=55,
            // cache=70, API=80, ready=100.
            var tick = setInterval(function() {
              if (pct < target) pct += 1;
              if (pctEl) pctEl.textContent = pct + '%';
              if (finishRequested && pct >= 100) {
                clearInterval(tick);
                // 100 % означает готовность: только короткий кадр для чтения.
                setTimeout(hide, 100);
              }
            }, 25);

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
              // Полоса браузера была в цвет загрузочного экрана; дальше
              // интерфейс светлый, поэтому возвращаем светлый цвет —
              // иначе сверху висит оранжевая плашка на белом экране
              var tc = document.querySelector('meta[name="theme-color"]');
              if (tc && tc.getAttribute('content') === '#FF6B1A') {
                tc.setAttribute('content', '#F5F7FA');
              }
              if (splash) {
                splash.classList.add('hidden');
                setTimeout(function() { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 400);
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
            // Если bundle действительно не стартовал, оставляем заставку и
            // предлагаем осознанный повтор вместо белого экрана.
            setTimeout(function() {
              if (done) return;
              // React уже работает и может просто ждать сеть: не перезагружаем
              // его и не показываем пользователю второй загрузочный экран.
              if (window.__jobtooBundleMounted) return;
              if (pctEl) {
                pctEl.textContent = 'Нажмите, чтобы повторить';
                pctEl.style.cursor = 'pointer';
                pctEl.onclick = function() { location.reload(); };
              }
            }, 12000);
          })();
        `}</script>
      </body>
    </html>
  );
}
