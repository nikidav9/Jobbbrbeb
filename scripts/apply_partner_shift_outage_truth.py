#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'app/(tabs)/feed.tsx',
    """  const [refreshing, setRefreshing] = useState(false);\n  const [partnerShifts, setPartnerShifts] = useState<PartnerShiftCard[]>([]);\n\n  const loadPartnerShifts = useCallback(async () => {\n    try {\n      const rows = await dbGetExternalVacancies();\n      setPartnerShifts(rows.map(partnerShiftToCard).filter((v): v is PartnerShiftCard => !!v));\n    } catch {\n      // Свои смены остаются доступны при временной ошибке партнёрского фида.\n    }\n  }, []);\n\n  useEffect(() => { loadPartnerShifts(); }, [loadPartnerShifts]);\n""",
    """  const [refreshing, setRefreshing] = useState(false);\n  const [partnerShifts, setPartnerShifts] = useState<PartnerShiftCard[]>([]);\n  const [partnerShiftsLoadFailed, setPartnerShiftsLoadFailed] = useState(false);\n\n  const loadPartnerShifts = useCallback(async (): Promise<boolean> => {\n    try {\n      const rows = await dbGetExternalVacancies();\n      setPartnerShifts(rows.map(partnerShiftToCard).filter((v): v is PartnerShiftCard => !!v));\n      setPartnerShiftsLoadFailed(false);\n      return true;\n    } catch {\n      // Не очищаем уже загруженные партнёрские смены: временный сбой фида не\n      // должен выглядеть как будто у партнёров внезапно закончились вакансии.\n      setPartnerShiftsLoadFailed(true);\n      return false;\n    }\n  }, []);\n\n  useEffect(() => { void loadPartnerShifts(); }, [loadPartnerShifts]);\n""",
)

replace_once(
    'app/(tabs)/feed.tsx',
    """  const onRefresh = async () => {\n    if (refreshing) return;\n    setRefreshing(true);\n    try {\n      await Promise.all([refreshAll(), loadPartnerShifts()]);\n    } catch {\n      showToast('Не удалось обновить ленту. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);\n    }\n  };\n""",
    """  const onRefresh = async () => {\n    if (refreshing) return;\n    setRefreshing(true);\n    try {\n      const [, partnerOk] = await Promise.all([refreshAll(), loadPartnerShifts()]);\n      if (!partnerOk) {\n        showToast('Свои смены обновлены, но партнёрские не удалось обновить.', 'error');\n      }\n    } catch {\n      showToast('Не удалось обновить ленту. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);\n    }\n  };\n""",
)

replace_once(
    'app/(tabs)/feed.tsx',
    """      )}\n      {/* Разовая / Регулярная */}\n      <ShiftSubTabs value={subMode} onChange={setSubMode} />\n""",
    """      )}\n      {partnerShiftsLoadFailed ? (\n        <TouchableOpacity\n          style={pS.offlineBar}\n          onPress={() => void loadPartnerShifts()}\n          activeOpacity={0.8}\n        >\n          <Ionicons name=\"cloud-offline-outline\" size={14} color=\"#92400E\" />\n          <Text style={pS.offlineTxt}>\n            Партнёрские смены не обновились — свои и ранее загруженные остаются доступны. Нажмите, чтобы повторить.\n          </Text>\n        </TouchableOpacity>\n      ) : null}\n      {/* Разовая / Регулярная */}\n      <ShiftSubTabs value={subMode} onChange={setSubMode} />\n""",
)

replace_once(
    'tests/network_action_truth_test.py',
    """    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,\n""",
    """    'сбой партнёрского фида отмечается отдельно': 'setPartnerShiftsLoadFailed(true);' in feed and 'setPartnerShiftsLoadFailed(false);' in feed,\n    'сбой партнёрского фида не очищает уже загруженные смены': 'setPartnerShifts([])' not in feed,\n    'refresh различает частичный сбой партнёрского фида': 'const [, partnerOk] = await Promise.all([refreshAll(), loadPartnerShifts()]);' in feed and \"if (!partnerOk)\" in feed,\n    'частичный сбой партнёрского фида виден и имеет retry': 'Партнёрские смены не обновились' in feed and 'onPress={() => void loadPartnerShifts()}' in feed,\n    'план фиксирует нагрузочный прогон': '~~Нагрузочный прогон крупного фида и очереди callback перед пилотом~~' in plan,\n""",
)

print('partner shift outage truth patch applied')
