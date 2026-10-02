/**
 * Сайт компании для компьютера (решение владельца 02.10.2026).
 *
 * На jobtoo.ru с компьютера (широкий экран, мышь) главная показывает
 * ознакомительный сайт, а не растянутое приложение. На телефоне, в Telegram
 * и в установленном веб-приложении — всё как раньше. Структура — по образцу
 * sorce.jobs (первый экран на всю высоту, блок «как это работает», цифры,
 * подвал), тексты и оформление свои, стиль JobToo: тёплый фон, чёрная обводка,
 * жёсткая тень, оранжевый акцент, Unbounded в заголовках.
 *
 * Всё лежит в той же веб-сборке (app/+html.tsx), без правок nginx:
 *  - LANDING_DETECT стоит первым в <head> и решает до отрисовки, показывать
 *    ли сайт (класс jt-landing на <html>);
 *  - приложение под сайтом грузится как обычно, только невидимо — «Войти»
 *    снимает класс и показывает его сразу, без перезагрузки;
 *  - сайт видят только с компьютера и только на «/»: ссылки на вакансии,
 *    документы, приглашения открывают приложение как раньше.
 *
 * Цифры на сайте — факты о продукте, а не статистика (её у IT-приложения ещё
 * нет): отклик бесплатен, 20 откликов в день (services/energy.ts), анкету на
 * сайте работодателя заполняет Юпитер. Изменились правила — поправь и здесь.
 */

/** RuStore — нынешний пакет. Выйдет ru.jobtoo — заменить ссылку. */
const RUSTORE_URL = 'https://www.rustore.ru/catalog/app/com.nikidav23.onspaceapp';

// QR-код на https://jobtoo.ru/?from=qr: с телефона откроется приложение.
// Собран один раз (segno), значения не меняются — новые зависимости не нужны.
const QR_PATH =
  'M0 0.5h7m1 0h1m2 0h2m1 0h1m1 0h1m1 0h7m-25 1h1m5 0h1m1 0h2m1 0h2m3 0h1m1 0h1m5 0h1m-25 1h1m1 0h3m1 0h1m1 0h1m1 0h1m2 0h3m2 0h1m1 0h3m1 0h1m-25 1h1m1 0h3m1 0h1m3 0h1m1 0h3m3 0h1m1 0h3m1 0h1m-25 1h1m1 0h3m1 0h1m1 0h2m3 0h1m2 0h1m1 0h1m1 0h3m1 0h1m-25 1h1m5 0h1m3 0h5m1 0h1m1 0h1m5 0h1m-25 1h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7m-16 1h1m2 0h2m1 0h1m-16 1h1m2 0h6m1 0h1m3 0h2m1 0h1m2 0h1m1 0h3m-24 1h2m1 0h2m4 0h1m3 0h2m3 0h5m-22 1h3m1 0h6m1 0h1m1 0h1m5 0h1m2 0h1m-25 1h1m3 0h1m3 0h1m1 0h2m3 0h1m4 0h5m-25 1h1m2 0h1m1 0h2m1 0h2m1 0h2m3 0h1m1 0h2m4 0h1m-25 1h1m1 0h1m5 0h1m1 0h1m1 0h2m1 0h1m4 0h1m2 0h1m-24 1h5m1 0h3m3 0h1m2 0h1m2 0h1m1 0h5m-25 1h1m2 0h3m2 0h1m2 0h2m1 0h2m3 0h1m1 0h2m1 0h1m-25 1h1m2 0h1m1 0h4m2 0h1m1 0h1m2 0h5m1 0h2m-16 1h3m2 0h1m2 0h1m3 0h1m1 0h2m-24 1h7m1 0h4m4 0h1m1 0h1m1 0h1m3 0h1m-25 1h1m5 0h1m1 0h3m1 0h2m1 0h2m3 0h1m-21 1h1m1 0h3m1 0h1m1 0h2m4 0h7m-21 1h1m1 0h3m1 0h1m1 0h1m1 0h2m1 0h3m1 0h2m4 0h2m-25 1h1m1 0h3m1 0h1m4 0h1m4 0h1m3 0h5m-25 1h1m5 0h1m4 0h1m2 0h1m3 0h3m1 0h3m-25 1h7m1 0h1m5 0h1m1 0h3m2 0h1m2 0h1';

/**
 * Показывать ли сайт. Только «/», только компьютер (≥1024 px, мышь), не в
 * Telegram (параметры tgWebApp*, iframe Telegram Web, мост TelegramWebviewProxy),
 * не в установленном веб-приложении и не после «Войти» в этой вкладке (?app=1
 * или запомненный выбор). Ошибка — значит приложение: сломанный сайт хуже,
 * чем растянутое приложение.
 */
export const LANDING_DETECT = `(function(){try{
var L=location,q=L.search,h=L.hash,p=L.pathname,ss=window.sessionStorage;
var tg=/tgWebApp/.test(h+q)||window.top!==window.self||!!window.TelegramWebviewProxy;
if(tg||/[?&]app=1/.test(q))ss.setItem('jt_app','1');
var standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
var desk=matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;
if((p==='/'||p==='/index.html')&&desk&&!tg&&!standalone&&ss.getItem('jt_app')!=='1'){
document.documentElement.className+=' jt-landing';window.__JT_LANDING__=true;}
}catch(e){}})();`;

export const LANDING_STYLE = `
@font-face { font-family: 'JTLManrope'; font-weight: 500; font-display: swap;
  src: url('/landing/manrope-500.ttf') format('truetype'); }
#jtl { display: none; }
html.jt-landing #jtl { display: block; }
html.jt-landing #splash { display: none !important; }
html.jt-landing #root { visibility: hidden; }
#jtl {
  --bg: #F5EFE6; --ink: #141414; --accent: #FF6B1A; --soft: #FFE2CC; --surface: #FFFFFF;
  --muted: #5C554D; --line: #E3D9CC; --ok: #2BB673;
  position: fixed; inset: 0; z-index: 10000; overflow-y: auto; overflow-x: hidden;
  background: var(--bg); color: var(--ink); scroll-behavior: smooth;
  font: 500 17px/1.55 'JTLManrope', 'JTSplashManrope', -apple-system, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
#jtl *, #jtl *::before, #jtl *::after { box-sizing: border-box; }
#jtl a { color: inherit; text-decoration: none; }
#jtl h1, #jtl h2, #jtl h3 { margin: 0; font-family: 'JTSplashUnbounded', -apple-system, 'Segoe UI', sans-serif; font-weight: 700; letter-spacing: -0.02em; }
#jtl p { margin: 0; }
#jtl .wrap { width: min(1200px, calc(100% - 64px)); margin: 0 auto; }

/* Кнопки — «наклейки» JobToo: обводка 2px и жёсткая тень, при наведении поднимаются */
#jtl .btn { display: inline-flex; align-items: center; gap: 10px; padding: 14px 26px; border: 2px solid var(--ink);
  border-radius: 999px; background: var(--surface); color: var(--ink); cursor: pointer;
  font: 700 16px/1 'JTSplashManrope', -apple-system, sans-serif; box-shadow: 4px 4px 0 var(--ink);
  transition: transform .18s ease, box-shadow .18s ease; }
#jtl .btn:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--ink); }
#jtl .btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink); }
#jtl .btn-accent { background: var(--accent); }
#jtl .btn-sm { padding: 10px 18px; font-size: 14px; box-shadow: 3px 3px 0 var(--ink); }
#jtl .btn:focus-visible, #jtl a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }

/* Шапка */
#jtl .top { position: sticky; top: 0; z-index: 5; padding: 14px 0; background: rgba(245,239,230,.86);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid transparent;
  transition: border-color .2s ease; }
#jtl .top.scrolled { border-bottom-color: var(--line); }
#jtl .top .wrap { display: flex; align-items: center; gap: 28px; }
#jtl .brand { display: flex; align-items: center; gap: 10px; font: 700 20px/1 'JTSplashUnbounded', sans-serif; }
#jtl .brand img { width: 40px; height: 40px; border: 2px solid var(--ink); border-radius: 12px; background: var(--surface); padding: 4px; }
#jtl .nav { display: flex; gap: 26px; margin-left: auto; }
#jtl .nav a { font-weight: 700; font-family: 'JTSplashManrope', sans-serif; font-size: 15px; position: relative; }
#jtl .nav a::after { content: ''; position: absolute; left: 0; right: 0; bottom: -4px; height: 2px; background: var(--accent);
  transform: scaleX(0); transform-origin: left; transition: transform .2s ease; }
#jtl .nav a:hover::after { transform: scaleX(1); }
#jtl .top .actions { display: flex; gap: 12px; }

/* Первый экран */
#jtl .hero { padding: 26px 0 40px; }
#jtl .hero-frame { position: relative; display: grid; grid-template-columns: 1.15fr .85fr; align-items: center; gap: 24px;
  min-height: calc(100vh - 150px); padding: 56px 64px; border: 2px solid var(--ink); border-radius: 36px;
  background: var(--soft); box-shadow: 8px 8px 0 var(--ink); overflow: hidden; }
#jtl .hero-frame::before { content: ''; position: absolute; width: 620px; height: 620px; right: -160px; top: -180px;
  border-radius: 50%; background: radial-gradient(circle, rgba(255,107,26,.28), rgba(255,107,26,0) 65%);
  animation: jtl-glow 9s ease-in-out infinite alternate; }
#jtl .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border: 2px solid var(--ink);
  border-radius: 999px; background: var(--surface); font: 700 13px/1 'JTSplashManrope', sans-serif; margin-bottom: 26px; }
#jtl .eyebrow i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: jtl-pulse 1.8s ease-in-out infinite; }
#jtl .hero h1 { font-size: clamp(44px, 5.2vw, 80px); line-height: 1.02; text-transform: uppercase; }
#jtl .hero h1 .mark { position: relative; display: inline-block; color: var(--accent); text-shadow: 4px 4px 0 var(--ink); }
#jtl .hero h1 .line { display: block; overflow: hidden; white-space: nowrap; padding: 0 8px 8px 0; }
#jtl .hero h1 .line > span { display: inline-block; animation: jtl-rise .9s cubic-bezier(.2,.8,.2,1) both; }
#jtl .hero h1 .line:nth-child(2) > span { animation-delay: .12s; }
#jtl .hero .lead { max-width: 520px; margin-top: 26px; font-size: 20px; color: var(--muted); animation: jtl-fade .8s ease .35s both; }
#jtl .hero .cta { display: flex; gap: 16px; margin-top: 34px; animation: jtl-fade .8s ease .5s both; }
#jtl .hero .note { margin-top: 18px; font-size: 14px; color: var(--muted); animation: jtl-fade .8s ease .6s both; }
#jtl .qr { display: inline-flex; align-items: center; gap: 12px; margin-top: 28px; padding: 10px 16px 10px 10px;
  border: 2px solid var(--ink); border-radius: 18px; background: var(--surface); box-shadow: 4px 4px 0 var(--ink);
  animation: jtl-fade .8s ease .7s both; }
#jtl .qr svg { width: 76px; height: 76px; display: block; }
#jtl .qr span { max-width: 170px; font: 700 12px/1.35 'JTSplashManrope', sans-serif; }

/* Телефон с листающимися карточками */
#jtl .phone-wrap { position: relative; display: flex; justify-content: center; z-index: 1; animation: jtl-float 6s ease-in-out infinite; }
#jtl .phone { position: relative; width: 300px; height: 610px; padding: 14px; border: 3px solid var(--ink); border-radius: 46px;
  background: var(--ink); box-shadow: 10px 10px 0 rgba(20,20,20,.18); }
#jtl .screen { position: relative; height: 100%; border-radius: 34px; background: var(--bg); overflow: hidden; padding: 46px 16px 16px; }
#jtl .notch { position: absolute; top: 10px; left: 50%; width: 86px; height: 22px; margin-left: -43px; border-radius: 12px; background: var(--ink); }
#jtl .scr-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
#jtl .scr-top b { font: 700 17px/1 'JTSplashUnbounded', sans-serif; }
#jtl .bolt { padding: 5px 10px; border: 2px solid var(--ink); border-radius: 999px; background: var(--surface); font: 700 12px/1 'JTSplashManrope', sans-serif; }
#jtl .deck { position: relative; height: 410px; }
#jtl .card { position: absolute; inset: 0; padding: 18px; border: 2px solid var(--ink); border-radius: 24px; background: var(--surface);
  box-shadow: 4px 4px 0 var(--ink); transition: transform .55s cubic-bezier(.3,.7,.3,1), opacity .55s ease; will-change: transform; }
/* Слои задаём явно: иначе сверху оказывается последняя карточка в разметке, а не первая в стопке */
#jtl .card[data-pos="0"] { z-index: 4; }
#jtl .card[data-pos="1"] { z-index: 3; transform: translate(0, 12px) scale(.95); background: #F1E9DE; }
#jtl .card[data-pos="2"] { z-index: 2; transform: translate(0, 24px) scale(.9); background: #E8DED1; }
#jtl .card[data-pos="3"] { z-index: 1; transform: translate(0, 24px) scale(.9); opacity: 0; }
#jtl .card[data-pos="3"] > * { opacity: 0; }
#jtl .card[data-pos="1"] > *, #jtl .card[data-pos="2"] > * { opacity: 0; }
#jtl .card.out-right { transform: translate(140%, -20px) rotate(18deg) !important; opacity: 0; }
#jtl .card.out-left { transform: translate(-140%, -20px) rotate(-18deg) !important; opacity: 0; }
#jtl .logo-badge { width: 52px; height: 52px; border: 2px solid var(--ink); border-radius: 16px; display: flex; align-items: center;
  justify-content: center; font: 700 22px/1 'JTSplashUnbounded', sans-serif; }
#jtl .card .co { margin-top: 14px; font-size: 13px; color: var(--muted); }
#jtl .card h3 { margin-top: 6px; font-size: 21px; line-height: 1.15; }
#jtl .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
#jtl .chip { padding: 6px 10px; border-radius: 999px; background: #F1E9DE; font: 700 12px/1 'JTSplashManrope', sans-serif; white-space: nowrap; }
#jtl .chip.pay { background: var(--soft); border: 1.5px solid var(--accent); }
#jtl .card .desc { margin-top: 14px; font-size: 13px; line-height: 1.45; color: var(--muted); }
#jtl .stamp { position: absolute; top: 22px; padding: 6px 12px; border: 3px solid; border-radius: 10px;
  font: 700 18px/1 'JTSplashUnbounded', sans-serif; opacity: 0; transition: opacity .2s ease; }
#jtl .stamp.yes { right: 18px; color: var(--ok); transform: rotate(12deg); }
#jtl .stamp.no { left: 18px; color: #E5484D; transform: rotate(-12deg); }
#jtl .card.out-right .stamp.yes, #jtl .card.out-left .stamp.no { opacity: 1; }
#jtl .scr-btns { display: flex; justify-content: center; gap: 22px; margin-top: 22px; }
#jtl .scr-btns span { width: 54px; height: 54px; border: 2px solid var(--ink); border-radius: 50%; background: var(--surface);
  box-shadow: 3px 3px 0 var(--ink); display: flex; align-items: center; justify-content: center; font: 700 22px/1 sans-serif;
  transition: transform .15s ease, background-color .15s ease; }
#jtl .scr-btns span.hit { transform: scale(.88); background: var(--soft); }
#jtl .toast { position: absolute; left: 16px; right: 16px; bottom: 92px; padding: 12px 14px; border: 2px solid var(--ink); border-radius: 16px;
  background: var(--surface); box-shadow: 3px 3px 0 var(--ink); font: 700 13px/1.3 'JTSplashManrope', sans-serif;
  transform: translateY(16px); opacity: 0; transition: transform .35s ease, opacity .35s ease; z-index: 3; }
#jtl .toast.on { transform: none; opacity: 1; }

/* Секции */
#jtl section.block { padding: 110px 0 40px; }
#jtl .kicker { font: 700 14px/1 'JTSplashManrope', sans-serif; color: var(--accent); text-transform: uppercase; letter-spacing: .08em; }
#jtl h2 { margin-top: 14px; font-size: clamp(34px, 3.6vw, 52px); line-height: 1.05; }
#jtl .sub { margin-top: 16px; max-width: 640px; font-size: 19px; color: var(--muted); }
#jtl .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 54px; }
#jtl .step { position: relative; padding: 32px 28px 34px; border: 2px solid var(--ink); border-radius: 28px; background: var(--surface);
  box-shadow: 6px 6px 0 var(--ink); transition: transform .2s ease, box-shadow .2s ease; }
#jtl .step:hover { transform: translate(-3px, -3px) rotate(-.6deg); box-shadow: 9px 9px 0 var(--ink); }
#jtl .step .num { width: 56px; height: 56px; border: 2px solid var(--ink); border-radius: 18px; background: var(--accent);
  display: flex; align-items: center; justify-content: center; font: 700 24px/1 'JTSplashUnbounded', sans-serif; }
#jtl .step h3 { margin-top: 24px; font-size: 24px; }
#jtl .step p { margin-top: 12px; color: var(--muted); }

/* Бегущая лента направлений */
#jtl .marquee { margin-top: 70px; display: grid; gap: 14px; transform: rotate(-1.5deg); }
#jtl .row { display: flex; width: max-content; gap: 14px; animation: jtl-run 38s linear infinite; }
#jtl .row.rev { animation-direction: reverse; animation-duration: 44s; }
#jtl .marquee:hover .row { animation-play-state: paused; }
#jtl .tag { padding: 14px 24px; border: 2px solid var(--ink); border-radius: 999px; background: var(--surface);
  font: 700 18px/1 'JTSplashUnbounded', sans-serif; white-space: nowrap; }
#jtl .tag.hot { background: var(--accent); }
#jtl .tag.soft { background: var(--soft); }

/* Цифры */
#jtl .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 54px; }
#jtl .stat { padding: 34px 28px; border: 2px solid var(--ink); border-radius: 28px; background: var(--surface); box-shadow: 6px 6px 0 var(--ink); }
#jtl .stat b { display: block; font: 700 clamp(46px, 4.6vw, 68px)/1 'JTSplashUnbounded', sans-serif; letter-spacing: -0.03em; }
#jtl .stat b em { font-style: normal; color: var(--accent); }
#jtl .stat > span { display: block; margin-top: 14px; font-size: 17px; color: var(--muted); }

/* Работодателям */
#jtl .emp { display: grid; grid-template-columns: 1.2fr .8fr; gap: 40px; align-items: center; padding: 56px 64px;
  border: 2px solid var(--ink); border-radius: 36px; background: var(--ink); color: var(--bg); box-shadow: 8px 8px 0 var(--accent); }
#jtl .emp .kicker { color: var(--accent); }
#jtl .emp .sub { color: #CFC4B6; }
#jtl .emp ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 14px; }
#jtl .emp li { display: flex; gap: 12px; align-items: flex-start; font-weight: 700; font-family: 'JTSplashManrope', sans-serif; }
#jtl .emp li::before { content: ''; flex: none; width: 12px; height: 12px; margin-top: 7px; border-radius: 4px; background: var(--accent); }
#jtl .emp .btn { margin-top: 28px; }

/* Финальный призыв и подвал */
#jtl .final { padding: 120px 0 70px; text-align: center; }
#jtl .final h2 { font-size: clamp(40px, 5vw, 76px); text-transform: uppercase; }
#jtl .final .cta { display: flex; justify-content: center; gap: 16px; margin-top: 34px; }
#jtl footer { border-top: 1px solid var(--line); padding: 34px 0 44px; }
#jtl footer .wrap { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
#jtl footer .links { display: flex; gap: 22px; margin-left: auto; flex-wrap: wrap; font-size: 15px; }
#jtl footer .links a:hover { color: var(--accent); }
#jtl footer small { font-size: 14px; color: var(--muted); }

/* Появление при прокрутке */
#jtl .rv { opacity: 0; transform: translateY(34px); transition: opacity .7s ease, transform .7s cubic-bezier(.2,.8,.2,1); }
#jtl .rv.in { opacity: 1; transform: none; }

@keyframes jtl-rise { from { transform: translateY(105%); } to { transform: none; } }
@keyframes jtl-fade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes jtl-float { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-14px) rotate(1deg); } }
@keyframes jtl-glow { from { transform: translate(0, 0) scale(1); } to { transform: translate(-60px, 40px) scale(1.15); } }
@keyframes jtl-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(43,182,115,.55); } 50% { box-shadow: 0 0 0 6px rgba(43,182,115,0); } }
@keyframes jtl-run { from { transform: translateX(0); } to { transform: translateX(-50%); } }

@media (max-width: 1180px) {
  #jtl .hero-frame { padding: 48px 40px; }
  #jtl .nav { display: none; }
  #jtl .top .actions { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) {
  #jtl *, #jtl *::before, #jtl *::after { animation: none !important; transition: none !important; }
  #jtl .rv { opacity: 1; transform: none; }
}
`;

const DIRECTIONS = [
  'Frontend', 'Backend', 'QA', 'DevOps', 'Data Science', 'Мобильная разработка',
  'Дизайн', 'Продакт', 'Аналитика', 'Тимлид', 'Системный аналитик', 'ML-инженер',
];
const DIRECTIONS_B = [
  'Python', 'Java', 'Go', 'React', 'iOS', 'Android', 'SQL', 'Kotlin',
  '1С', 'C#', 'Node.js', 'Тестирование', 'Поддержка', 'Безопасность',
];

function tags(list: string[], offset: number): string {
  // Лента бесконечная: два одинаковых прохода, анимация сдвигает ровно на половину.
  const once = list
    .map((t, i) => {
      const cls = (i + offset) % 5 === 0 ? 'tag hot' : (i + offset) % 3 === 0 ? 'tag soft' : 'tag';
      return `<span class="${cls}">${t}</span>`;
    })
    .join('');
  return once + once.replace(/<span /g, '<span aria-hidden="true" ');
}

export const LANDING_MARKUP = `
<div id="jtl" role="document">
  <header class="top" id="jtl-top">
    <div class="wrap">
      <a class="brand" href="/" aria-label="JobToo — на главную"><img src="/splash/logo.png" alt="" />JobToo</a>
      <nav class="nav" aria-label="Разделы">
        <a href="#how">Как это работает</a>
        <a href="#numbers">Почему JobToo</a>
        <a href="#employers">Работодателям</a>
      </nav>
      <div class="actions">
        <button class="btn btn-sm" type="button" data-jtl-open>Войти</button>
        <a class="btn btn-sm btn-accent" href="${RUSTORE_URL}" target="_blank" rel="noopener">Скачать</a>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="wrap">
        <div class="hero-frame">
          <div>
            <span class="eyebrow"><i></i>Только IT-вакансии</span>
            <h1><span class="line"><span>Работа в IT —</span></span><span class="line"><span class="mark">свайпом</span></span></h1>
            <p class="lead">Листаете вакансии как ленту. Свайп вправо — и Юпитер сам заполняет анкету на сайте работодателя. Ответ приходит в чат приложения.</p>
            <div class="cta">
              <a class="btn btn-accent" href="${RUSTORE_URL}" target="_blank" rel="noopener">Скачать в RuStore →</a>
              <button class="btn" type="button" data-jtl-open>Открыть в браузере</button>
            </div>
            <p class="note">iPhone — пока через браузер: откройте jobtoo.ru в Safari.</p>
            <a class="qr" href="/?app=1" title="jobtoo.ru">
            <svg viewBox="0 0 25 25" shape-rendering="crispEdges" role="img" aria-label="QR-код jobtoo.ru"><path stroke="#141414" d="${QR_PATH}"/></svg>
            <span>Наведите камеру телефона — JobToo откроется сразу</span>
          </a>
          </div>

          <div class="phone-wrap" aria-hidden="true">
            <div class="phone"><div class="screen">
              <div class="notch"></div>
              <div class="scr-top"><b>Вакансии</b><span class="bolt"><svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align:-1px"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="#FF6B1A" stroke="#141414" stroke-width="2" stroke-linejoin="round"/></svg> 20</span></div>
              <div class="deck" id="jtl-deck">
                <div class="card" data-pos="0">
                  <div class="logo-badge" style="background:#FFE2CC">F</div>
                  <p class="co">Финтех · 40 минут назад</p>
                  <h3>Frontend-разработчик (React)</h3>
                  <div class="chips"><span class="chip pay">от 250 000 ₽</span><span class="chip">Удалённо</span><span class="chip">Middle</span></div>
                  <p class="desc">TypeScript, React, дизайн-система. Команда из 8 человек, релизы каждую неделю.</p>
                  <span class="stamp yes">ОТКЛИК</span><span class="stamp no">МИМО</span>
                </div>
                <div class="card" data-pos="1">
                  <div class="logo-badge" style="background:#D8F0E2">D</div>
                  <p class="co">Маркетплейс · 2 часа назад</p>
                  <h3>Data Scientist</h3>
                  <div class="chips"><span class="chip pay">от 300 000 ₽</span><span class="chip">Гибрид</span><span class="chip">Senior</span></div>
                  <p class="desc">Рекомендации и поиск. Python, SQL, A/B-тесты на миллионах пользователей.</p>
                  <span class="stamp yes">ОТКЛИК</span><span class="stamp no">МИМО</span>
                </div>
                <div class="card" data-pos="2">
                  <div class="logo-badge" style="background:#E1E6FF">Q</div>
                  <p class="co">EdTech · сегодня</p>
                  <h3>QA-инженер (автотесты)</h3>
                  <div class="chips"><span class="chip pay">от 180 000 ₽</span><span class="chip">Москва</span><span class="chip">Junior+</span></div>
                  <p class="desc">Playwright, CI, тест-дизайн. Наставник на первые три месяца.</p>
                  <span class="stamp yes">ОТКЛИК</span><span class="stamp no">МИМО</span>
                </div>
                <div class="card" data-pos="3">
                  <div class="logo-badge" style="background:#FFF1B8">G</div>
                  <p class="co">Логистика · вчера</p>
                  <h3>Backend-разработчик на Go</h3>
                  <div class="chips"><span class="chip pay">от 280 000 ₽</span><span class="chip">Удалённо</span><span class="chip">Middle+</span></div>
                  <p class="desc">Высоконагруженные сервисы, Kafka, PostgreSQL. Без легаси.</p>
                  <span class="stamp yes">ОТКЛИК</span><span class="stamp no">МИМО</span>
                </div>
              </div>
              <div class="scr-btns"><span id="jtl-no"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6 6 18" stroke="#141414" stroke-width="3" stroke-linecap="round"/></svg></span><span id="jtl-yes"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="#FF6B1A" stroke="#141414" stroke-width="2" stroke-linejoin="round"/></svg></span></div>
              <div class="toast" id="jtl-toast">Юпитер заполнил анкету — отклик отправлен</div>
            </div></div>
          </div>

        </div>
      </div>
    </section>

    <section class="block" id="how">
      <div class="wrap">
        <p class="kicker rv">Как это работает</p>
        <h2 class="rv">Три шага от вакансии до ответа</h2>
        <p class="sub rv">Никаких одинаковых анкет на десяти сайтах. Вы выбираете — остальное делает приложение.</p>
        <div class="steps">
          <article class="step rv"><div class="num">1</div><h3>Листаете</h3><p>Карточки IT-вакансий: зарплата, формат, стек. Нравится — свайп вправо, нет — влево.</p></article>
          <article class="step rv"><div class="num">2</div><h3>Откликаемся за вас</h3><p>Юпитер заполняет анкету на сайте работодателя из вашего профиля. Чего нет в профиле — спросит у вас, а не придумает.</p></article>
          <article class="step rv"><div class="num">3</div><h3>Общаетесь</h3><p>Ответ работодателя приходит в чат приложения. Все отклики и их статусы — в одном разделе.</p></article>
        </div>
      </div>
      <div class="marquee" aria-label="Направления">
        <div class="row">${tags(DIRECTIONS, 0)}</div>
        <div class="row rev">${tags(DIRECTIONS_B, 2)}</div>
      </div>
    </section>

    <section class="block" id="numbers">
      <div class="wrap">
        <p class="kicker rv">Почему JobToo</p>
        <h2 class="rv">Честные цифры с первого дня</h2>
        <div class="stats">
          <div class="stat rv"><b><span data-count-from="990" data-count-to="0">0</span><em> ₽</em></b><span>для соискателя — отклики бесплатны</span></div>
          <div class="stat rv"><b><span data-count-from="0" data-count-to="20">20</span></b><span>откликов в день — осмысленно, а не по шаблону</span></div>
          <div class="stat rv"><b>1<em>&nbsp;=&nbsp;</em>1</b><span>один свайп — один отклик на сайте работодателя</span></div>
        </div>
      </div>
    </section>

    <section class="block" id="employers">
      <div class="wrap">
        <div class="emp rv">
          <div>
            <p class="kicker">Работодателям</p>
            <h2>Кандидаты, которые сами выбрали вашу вакансию</h2>
            <p class="sub">Опубликуйте IT-вакансию в JobToo: её увидят в ленте те, кому она подходит, а отвечать им можно прямо в чате.</p>
            <a class="btn btn-accent" href="/register-employer">Разместить вакансию →</a>
          </div>
          <ul>
            <li>Вакансия в общей ленте IT-вакансий</li>
            <li>Отклик — осознанный выбор: у кандидата 20 откликов в день</li>
            <li>Переписка с кандидатом в чате, без лишних писем</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="final">
      <div class="wrap">
        <h2 class="rv">Следующая работа —<br />в одном свайпе</h2>
        <div class="cta rv">
          <a class="btn btn-accent" href="${RUSTORE_URL}" target="_blank" rel="noopener">Скачать в RuStore →</a>
          <button class="btn" type="button" data-jtl-open>Открыть в браузере</button>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <div class="wrap">
      <a class="brand" href="/"><img src="/splash/logo.png" alt="" />JobToo</a>
      <small>Работа в IT — свайпом</small>
      <nav class="links" aria-label="Документы и контакты">
        <a href="/legal?doc=terms">Соглашение</a>
        <a href="/legal?doc=privacy">Политика конфиденциальности</a>
        <a href="/legal">Документы</a>
        <a href="https://t.me/JobToo_bot" target="_blank" rel="noopener">Telegram</a>
        <a href="mailto:support@jobtoo.ru">support@jobtoo.ru</a>
      </nav>
    </div>
  </footer>
</div>
`;

/** Поведение сайта: «Войти», шапка, появление при прокрутке, счётчики, карточки. */
export const LANDING_SCRIPT = `(function(){
if(!window.__JT_LANDING__)return;
var root=document.getElementById('jtl');if(!root)return;
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

// «Войти» / «Открыть в браузере»: приложение уже загружено под сайтом — показываем его.
root.addEventListener('click',function(e){
  var t=e.target.closest&&e.target.closest('[data-jtl-open]');if(!t)return;
  e.preventDefault();
  try{sessionStorage.setItem('jt_app','1');}catch(_){}
  window.__JT_LANDING__=false;stop=true;
  document.documentElement.className=document.documentElement.className.replace(/\\s*jt-landing/g,'');
});

var top=document.getElementById('jtl-top');
root.addEventListener('scroll',function(){top.classList.toggle('scrolled',root.scrollTop>8);},{passive:true});

function count(el){
  var a=+el.getAttribute('data-count-from'),b=+el.getAttribute('data-count-to'),t0=null,d=1400;
  if(reduce){el.textContent=b;return;}
  function f(ts){if(t0===null)t0=ts;var k=Math.min(1,(ts-t0)/d),e=1-Math.pow(1-k,3);
    el.textContent=Math.round(a+(b-a)*e).toLocaleString('ru-RU');if(k<1)requestAnimationFrame(f);}
  requestAnimationFrame(f);
}
var io=new IntersectionObserver(function(es){es.forEach(function(en){
  if(!en.isIntersecting)return;var el=en.target;io.unobserve(el);
  var sibs=el.parentElement?Array.prototype.indexOf.call(el.parentElement.querySelectorAll(':scope > .rv'),el):0;
  setTimeout(function(){el.classList.add('in');
    el.querySelectorAll('[data-count-to]').forEach(count);},Math.max(0,sibs)*110);
});},{root:root,threshold:.18});
root.querySelectorAll('.rv').forEach(function(el){io.observe(el);});

// Колода: верхняя карточка уходит вправо (отклик) или влево (мимо), уходит в конец стопки.
var deck=document.getElementById('jtl-deck'),yes=document.getElementById('jtl-yes'),no=document.getElementById('jtl-no'),
    toast=document.getElementById('jtl-toast'),plan=['r','l','r','r'],step=0,stop=false;
function cards(){return Array.prototype.slice.call(deck.children).sort(function(x,y){return x.dataset.pos-y.dataset.pos;});}
function swipe(){
  if(stop||reduce)return;
  if(!root.offsetParent&&getComputedStyle(root).display==='none')return;
  var cs=cards(),topc=cs[0],dir=plan[step++%plan.length],btn=dir==='r'?yes:no;
  btn.classList.add('hit');setTimeout(function(){btn.classList.remove('hit');},180);
  topc.classList.add(dir==='r'?'out-right':'out-left');
  if(dir==='r'){toast.classList.add('on');setTimeout(function(){toast.classList.remove('on');},1500);}
  setTimeout(function(){
    cs.forEach(function(c,i){c.dataset.pos=i===0?cs.length-1:i-1;});
    topc.style.transition='none';topc.classList.remove('out-right','out-left');
    void topc.offsetWidth;topc.style.transition='';
  },560);
}
setInterval(swipe,2600);
})();`;
