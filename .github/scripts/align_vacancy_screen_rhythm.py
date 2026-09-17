from pathlib import Path

PATH = Path("app/(tabs)/feed.tsx")
text = PATH.read_text()


def replace_one(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match, found {count}: {old[:140]!r}")
    text = text.replace(old, new, 1)


# Header: the visual content starts 13pt below the safe area and the card starts
# 13pt below the header content. Bottom padding is intentionally zero so the
# two gaps do not stack.
replace_one(
    """  row: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    paddingHorizontal: rs(14), paddingTop: rs(8), paddingBottom: rs(10),
    backgroundColor: Colors.bgWarm,
  },""",
    """  row: {
    flexDirection: 'row', alignItems: 'center', gap: rs(13),
    paddingHorizontal: rs(13), paddingTop: rs(13), paddingBottom: 0,
    backgroundColor: Colors.bgWarm,
  },""",
)

# Define the lower rhythm once: 13pt card -> actions and 13pt actions -> tab bar.
replace_one(
    """  swWantRef.current = swWant;
  swSkipRef.current = swSkip;

  // Карточка колоды «Работа» — тот же макет, что у смены: рамка во весь экран,""",
    """  swWantRef.current = swWant;
  swSkipRef.current = swSkip;

  // Нижняя композиция держится на одном шаге: 13pt от карточки до ряда
  // действий и ещё 13pt от ряда до верхней границы плавающего таббара.
  // Резерв считаем от реальной высоты таббара, а не магическим числом — так
  // одинаковый ритм сохраняется и на iPhone с разным safe area, и на Android.
  const deckEdgeGap = rs(13);
  const deckActionSize = rs(68);
  const deckBottomReserve = tabBarHeight + deckActionSize + deckEdgeGap * 2;

  // Карточка колоды «Работа» — тот же макет, что у смены: рамка во весь экран,""",
)

replace_one(
    """      <View style={styles.cardArea}>
        {deckCards[2] ? <View style={styles.ghost2} /> : null}
        {deckCards[1] ? <View style={styles.ghost1} /> : null}""",
    """      <View style={[styles.cardArea, { paddingBottom: deckBottomReserve }]}>
        {deckCards[2] ? <View style={[styles.ghost2, { bottom: deckBottomReserve }]} /> : null}
        {deckCards[1] ? <View style={[styles.ghost1, { bottom: deckBottomReserve }]} /> : null}""",
)

# Badge border may extend wider, but its icon should sit on the same 21pt content
# axis as the location/description section icons: 8 wrapper + 13 badge padding.
replace_one(
    "  replyBadgeWrap: { marginHorizontal: rs(21), marginBottom: rs(13) },",
    "  replyBadgeWrap: { marginHorizontal: rs(8), marginBottom: rs(13) },",
)

replace_one(
    '<View style={pS.scrollHintWrap} pointerEvents="none">',
    '<View style={[pS.scrollHintWrap, { bottom: deckBottomReserve + rs(2) }]} pointerEvents="none">',
)

replace_one(
    '<View style={[styles.shiftDeckActions, { bottom: tabBarHeight + rs(18) }]} pointerEvents="box-none">',
    '<View style={[styles.shiftDeckActions, { bottom: tabBarHeight + deckEdgeGap }]} pointerEvents="box-none">',
)

# Bottom offsets are supplied dynamically above; leave zero defaults here so a
# stale magic number cannot silently fight the runtime geometry.
replace_one(
    """  // Ширина по карточке, а не по экрану: карточка отступает на rs(10) плюс
  // рамка, и растворение должно кончаться ровно на её краю.
  scrollHintWrap: {
    position: 'absolute', left: rs(13), right: rs(13), bottom: rs(166), height: rs(64),""",
    """  // Ширина по карточке, а не по экрану: карточка отступает на rs(13) плюс
  // рамка, и растворение должно кончаться ровно на её краю. bottom задаётся
  // рядом с карточкой через deckBottomReserve, чтобы совпадать на всех safe area.
  scrollHintWrap: {
    position: 'absolute', left: rs(13), right: rs(13), bottom: 0, height: rs(64),""",
)

replace_one(
    """  // Нижний резерв под плавающие кнопки + подсказку «Свайпай»: карточка кончается
  // выше, а в зазоре под ней стоят кнопки — как на референсе. Раньше было 96 и
  // кнопки жались к навбару, подсказка уходила под него.
  cardArea: { flex: 1, flexDirection: 'column', paddingHorizontal: rs(13), paddingTop: rs(13), paddingBottom: rs(164) },
  ghost1: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.97 }, { translateY: 6 }], opacity: 0.5, zIndex: 0, ...Shadow.card },
  ghost2: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.94 }, { translateY: 12 }], opacity: 0.3, zIndex: 0, ...Shadow.card },""",
    """  // Нижний резерв задаётся динамически рядом с карточкой: высота таббара
  // + 68pt кнопки + одинаковые поля по 13pt сверху и снизу.
  cardArea: { flex: 1, flexDirection: 'column', paddingHorizontal: rs(13), paddingTop: rs(13), paddingBottom: 0 },
  ghost1: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: 0, backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.97 }, { translateY: 6 }], opacity: 0.5, zIndex: 0, ...Shadow.card },
  ghost2: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: 0, backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.94 }, { translateY: 12 }], opacity: 0.3, zIndex: 0, ...Shadow.card },""",
)

replace_one(
    """  shiftDeckActions: {
    position: 'absolute', left: rs(21), right: rs(21), bottom: rs(28), zIndex: 20, elevation: 20,""",
    """  shiftDeckActions: {
    position: 'absolute', left: rs(21), right: rs(21), bottom: 0, zIndex: 20, elevation: 20,""",
)

PATH.write_text(text)
