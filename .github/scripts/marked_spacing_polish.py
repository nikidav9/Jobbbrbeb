from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 match, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


feed = "app/(tabs)/feed.tsx"

# Header: 13pt from the safe-area edge to the controls, and 13pt from
# the controls to the vacancy card. The card itself supplies the second gap.
replace_one(
    feed,
    """  row: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    paddingHorizontal: rs(14), paddingTop: rs(8), paddingBottom: rs(10),
    backgroundColor: Colors.bgWarm,
  },""",
    """  row: {
    flexDirection: 'row', alignItems: 'center', gap: rs(10),
    paddingHorizontal: rs(13), paddingTop: rs(13), paddingBottom: 0,
    backgroundColor: Colors.bgWarm,
  },""",
)

# Derive the lower reserve from the real tab-bar height. This keeps the
# visible gaps symmetrical on phones with different safe-area insets:
# card -> 13 -> 68pt action -> 13 -> tab bar.
replace_one(
    feed,
    """    const metroLine = v.metroStation
      ? METRO_LINES.find(l => l.stations.includes(v.metroStation!)) ?? null
      : null;
    return (
      <View style={styles.cardArea}>
        {deckCards[2] ? <View style={styles.ghost2} /> : null}
        {deckCards[1] ? <View style={styles.ghost1} /> : null}""",
    """    const metroLine = v.metroStation
      ? METRO_LINES.find(l => l.stations.includes(v.metroStation!)) ?? null
      : null;
    const deckGap = rs(13);
    const deckBottomReserve = tabBarHeight + rs(68) + deckGap * 2;
    const deckActionBottom = tabBarHeight + deckGap;
    return (
      <View style={[styles.cardArea, { paddingBottom: deckBottomReserve }]}>
        {deckCards[2] ? <View style={[styles.ghost2, { bottom: deckBottomReserve }]} /> : null}
        {deckCards[1] ? <View style={[styles.ghost1, { bottom: deckBottomReserve }]} /> : null}""",
)

replace_one(
    feed,
    '<View style={pS.scrollHintWrap} pointerEvents="none">',
    '<View style={[pS.scrollHintWrap, { bottom: deckBottomReserve }]} pointerEvents="none">',
)

replace_one(
    feed,
    '<View style={[styles.shiftDeckActions, { bottom: tabBarHeight + rs(18) }]} pointerEvents="box-none">',
    '<View style={[styles.shiftDeckActions, { bottom: deckActionBottom }]} pointerEvents="box-none">',
)

# Align the reply icon with the section-heading icons. The badge has 13pt
# inner padding, so an 8pt outer margin puts the icon on the same 21pt axis.
replace_one(
    feed,
    '  replyBadgeWrap: { marginHorizontal: rs(21), marginBottom: rs(13) },',
    '  replyBadgeWrap: { marginHorizontal: rs(8), marginBottom: rs(13) },',
)

layout = "app/(tabs)/_layout.tsx"

# Complete the same 13pt rhythm below the floating tab bar.
replace_one(
    layout,
    '        height: safeBottom + 12, backgroundColor: \'#fff\',',
    '        height: safeBottom + 13, backgroundColor: \'#fff\',',
)
replace_one(
    layout,
    '<View style={[fS.pillShadow, { bottom: safeBottom + 12 }]}>',
    '<View style={[fS.pillShadow, { bottom: safeBottom + 13 }]}>',
)
replace_one(
    layout,
    """  const tabBarHeight = Platform.select({
    ios: insets.bottom + 64 + 12,
    android: bottomSafe(insets.bottom) + 64 + 12,
    default: 76,
  });""",
    """  const tabBarHeight = Platform.select({
    ios: insets.bottom + 64 + 13,
    android: bottomSafe(insets.bottom) + 64 + 13,
    default: 77,
  });""",
)
