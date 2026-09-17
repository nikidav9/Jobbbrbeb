from pathlib import Path


def replace_one(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 match, found {count}: {old[:90]!r}")
    p.write_text(text.replace(old, new, 1))


feed = "app/(tabs)/feed.tsx"

replace_one(
    feed,
    '<CompanyMark company={v.company} size={48} />',
    '<CompanyMark company={v.company} size={55} />',
)

replace_one(
    feed,
    """                        <Ionicons
                          name={permSavedIds.includes(v.id) ? 'bookmark' : 'bookmark-outline'}
                          size={20}""",
    """                        <Ionicons
                          name={permSavedIds.includes(v.id) ? 'bookmark' : 'bookmark-outline'}
                          size={21}""",
)

replace_one(
    feed,
    '<Ionicons name="share-outline" size={20} color={Colors.textSecondary} />',
    '<Ionicons name="share-outline" size={21} color={Colors.textSecondary} />',
)

replace_one(
    feed,
    '                  <ReplyBadge stats={responsivenessMap[v.employerId]} />',
    """                  <View style={styles.replyBadgeWrap}>
                    <ReplyBadge stats={responsivenessMap[v.employerId]} />
                  </View>""",
)

replace_one(
    feed,
    "position: 'absolute', left: rs(11), right: rs(11), bottom: rs(166), height: rs(64),",
    "position: 'absolute', left: rs(13), right: rs(13), bottom: rs(166), height: rs(64),",
)

replace_one(
    feed,
    """    backgroundColor: Colors.bg, borderRadius: rs(100),
    paddingHorizontal: rs(12), paddingVertical: rs(6), ...Shadow.card,""",
    """    backgroundColor: Colors.bg, borderRadius: rs(100),
    paddingHorizontal: rs(13), paddingVertical: rs(8), ...Shadow.card,""",
)

replace_one(
    feed,
    """  deckUtilityBtn: {
    width: rs(44), height: rs(44), borderRadius: rs(22),""",
    """  deckUtilityBtn: {
    width: rs(55), height: rs(55), borderRadius: rs(34),""",
)

replace_one(
    feed,
    '  sectionBlock: { gap: rs(8), marginBottom: rs(14) },',
    '  sectionBlock: { gap: rs(8), marginBottom: rs(13) },',
)
replace_one(
    feed,
    "  blockHead: { flexDirection: 'row', alignItems: 'center', gap: rs(6) },",
    "  blockHead: { flexDirection: 'row', alignItems: 'center', gap: rs(8) },",
)
replace_one(
    feed,
    """  locRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(10),
    backgroundColor: Colors.surface, borderRadius: rs(12), padding: rs(12),
  },""",
    """  locRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: rs(13),
    backgroundColor: Colors.surface, borderRadius: rs(13), padding: rs(13),
  },""",
)
replace_one(
    feed,
    '  metroDot: { width: rs(14), height: rs(14), borderRadius: rs(7), marginTop: rs(2) },',
    '  metroDot: { width: rs(13), height: rs(13), borderRadius: rs(7), marginTop: rs(5) },',
)
replace_one(
    feed,
    '  metroLineName: { fontSize: rf(11), color: Colors.textMuted, marginBottom: rs(2) },',
    '  metroLineName: { fontSize: rf(11), color: Colors.textMuted, marginBottom: rs(5) },',
)
replace_one(
    feed,
    """  mapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8),
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: rs(14), paddingVertical: rs(12),
  },""",
    """  mapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(8),
    borderWidth: 1.5, borderColor: Colors.primary, borderRadius: rs(13), paddingVertical: rs(13),
  },""",
)
replace_one(
    feed,
    '  desc: { fontSize: rf(13.5), color: Colors.textMuted, lineHeight: rf(20) },',
    '  desc: { fontSize: rf(13.5), color: Colors.textMuted, lineHeight: rf(21) },',
)

replace_one(
    feed,
    "  cardArea: { flex: 1, flexDirection: 'column', paddingHorizontal: rs(10), paddingTop: rs(10), paddingBottom: rs(164) },",
    "  cardArea: { flex: 1, flexDirection: 'column', paddingHorizontal: rs(13), paddingTop: rs(13), paddingBottom: rs(164) },",
)
replace_one(
    feed,
    "  ghost1: { position: 'absolute', left: rs(10), right: rs(10), top: rs(10), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.97 }, { translateY: 6 }], opacity: 0.5, zIndex: 0, ...Shadow.card },",
    "  ghost1: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.97 }, { translateY: 6 }], opacity: 0.5, zIndex: 0, ...Shadow.card },",
)
replace_one(
    feed,
    "  ghost2: { position: 'absolute', left: rs(10), right: rs(10), top: rs(10), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.94 }, { translateY: 12 }], opacity: 0.3, zIndex: 0, ...Shadow.card },",
    "  ghost2: { position: 'absolute', left: rs(13), right: rs(13), top: rs(13), bottom: rs(164), backgroundColor: Colors.bg, borderRadius: Radius.card, transform: [{ scale: 0.94 }, { translateY: 12 }], opacity: 0.3, zIndex: 0, ...Shadow.card },",
)
replace_one(
    feed,
    "  postedAgo: { fontSize: rf(12.5), fontWeight: '500', color: Colors.textMuted, marginTop: rs(1) },",
    "  postedAgo: { fontSize: rf(12.5), fontWeight: '500', color: Colors.textMuted, marginTop: rs(5) },",
)
replace_one(
    feed,
    """  cardTop: { padding: rs(18), paddingBottom: rs(14), gap: rs(12) },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: rs(12) },""",
    """  cardTop: { padding: rs(21), paddingBottom: rs(13), gap: rs(13) },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: rs(13) },""",
)
replace_one(
    feed,
    "  jobTitle: { fontSize: rf(26), fontWeight: '700', color: Colors.textPrimary, lineHeight: rf(31), marginTop: rs(2) },",
    "  jobTitle: { fontSize: rf(26), fontWeight: '700', color: Colors.textPrimary, lineHeight: rf(31), marginTop: 0 },",
)
replace_one(
    feed,
    "  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8) },",
    """  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: rs(8) },
  replyBadgeWrap: { marginHorizontal: rs(21), marginBottom: rs(13) },""",
)
replace_one(
    feed,
    '  cardDivider: { height: 1, backgroundColor: Colors.divider, marginHorizontal: rs(14) },',
    '  cardDivider: { height: 1, backgroundColor: Colors.divider, marginHorizontal: rs(21) },',
)
replace_one(
    feed,
    '  cardMiddle: { flexGrow: 1, padding: rs(10), paddingHorizontal: rs(14), gap: rs(4) },',
    '  cardMiddle: { flexGrow: 1, paddingVertical: rs(13), paddingHorizontal: rs(21), gap: rs(13) },',
)
replace_one(
    feed,
    """  shiftDeckActions: {
    position: 'absolute', left: rs(24), right: rs(24), bottom: rs(28), zIndex: 20, elevation: 20,
    alignItems: 'center', gap: rs(10),
  },
  shiftDeckRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(30),
  },""",
    """  shiftDeckActions: {
    position: 'absolute', left: rs(21), right: rs(21), bottom: rs(28), zIndex: 20, elevation: 20,
    alignItems: 'center', gap: rs(13),
  },
  shiftDeckRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: rs(34),
  },""",
)

chip = "components/ui/Chip.tsx"
replace_one(
    chip,
    '<Ionicons name={icon} size={13} color={s.text} style={{ marginRight: 4 }} />',
    '<Ionicons name={icon} size={13} color={s.text} style={{ marginRight: rs(5) }} />',
)
replace_one(
    chip,
    """    paddingHorizontal: rs(12),
    paddingVertical: rs(5),""",
    """    paddingHorizontal: rs(13),
    paddingVertical: rs(8),""",
)

badge = "components/feature/ReplyBadge.tsx"
replace_one(badge, "import { Radius } from '@/constants/theme';\n", "")
replace_one(
    badge,
    """  box: {
    flexDirection: 'row', alignItems: 'center', gap: rs(6),
    borderRadius: Radius.md, borderWidth: 1,
    paddingHorizontal: rs(10), paddingVertical: rs(6),
    alignSelf: 'flex-start', maxWidth: '100%',
  },""",
    """  box: {
    flexDirection: 'row', alignItems: 'center', gap: rs(8),
    borderRadius: rs(13), borderWidth: 1,
    paddingHorizontal: rs(13), paddingVertical: rs(8),
    alignSelf: 'stretch', maxWidth: '100%',
  },""",
)
