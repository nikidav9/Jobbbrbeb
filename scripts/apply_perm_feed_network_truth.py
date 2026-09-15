#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
feed_path = root / 'app/(tabs)/feed.tsx'
test_path = root / 'tests/network_action_truth_test.py'
feed = feed_path.read_text(encoding='utf-8')
test = test_path.read_text(encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {count}')
    return text.replace(old, new, 1)

start = feed.index('function WorkerPermMode')
end = feed.index('\nfunction EmployerHome()', start)
block = feed[start:end]

block = replace_once(
    block,
    "  const [externalVacancies, setExternalVacancies] = useState<ExternalVacancy[]>([]);\n  const [externalSourceOptions, setExternalSourceOptions] = useState<VacancySourceOption[]>([]);",
    "  const [externalVacancies, setExternalVacancies] = useState<ExternalVacancy[]>([]);\n  const [externalVacanciesLoadFailed, setExternalVacanciesLoadFailed] = useState(false);\n  const [externalSourceOptions, setExternalSourceOptions] = useState<VacancySourceOption[]>([]);",
    'permanent partner error state',
)

block = replace_once(
    block,
    "    if (sourceIds && sourceIds.length === 0) {\n      setExternalVacancies([]);\n      return;\n    }\n    const pageSize = 1000;",
    "    if (sourceIds && sourceIds.length === 0) {\n      setExternalVacancies([]);\n      setExternalVacanciesLoadFailed(false);\n      return;\n    }\n    setExternalVacanciesLoadFailed(false);\n    const pageSize = 1000;",
    'reset permanent partner error',
)

block = replace_once(
    block,
    "    } catch {\n      // Уже загруженные страницы остаются видимыми. Свои вакансии продолжают\n      // работать, даже если очередная страница партнёрского фида недоступна.\n    }",
    "    } catch {\n      // Уже загруженные страницы остаются видимыми. Свои вакансии продолжают\n      // работать, даже если очередная страница партнёрского фида недоступна.\n      setExternalVacanciesLoadFailed(true);\n    }",
    'mark permanent partner load failure',
)

block = replace_once(
    block,
    "  const onRefresh = async () => {\n    setRefreshing(true);\n    await Promise.all([\n      refreshPermVacancies(), refreshPermApplications(), refreshPermVacancyViews(),\n      loadExternalVacancies(),\n    ]);\n    setRefreshing(false);\n  };",
    "  const onRefresh = async () => {\n    if (refreshing) return;\n    setRefreshing(true);\n    try {\n      await Promise.all([\n        refreshPermVacancies(), refreshPermApplications(), refreshPermVacancyViews(),\n        loadExternalVacancies(externalSelection),\n      ]);\n    } catch {\n      showToast('Не удалось обновить вакансии. Проверьте связь.', 'error');\n    } finally {\n      setRefreshing(false);\n    }\n  };",
    'permanent feed refresh finally',
)

block = replace_once(
    block,
    "  return (\n    <View style={{ flex: 1 }}>\n",
    "  return (\n    <View style={{ flex: 1 }}>\n      {externalVacanciesLoadFailed ? (\n        <TouchableOpacity\n          style={pS.offlineBar}\n          onPress={() => void loadExternalVacancies(externalSelection)}\n          activeOpacity={0.8}\n        >\n          <Ionicons name=\"cloud-offline-outline\" size={14} color=\"#92400E\" />\n          <Text style={pS.offlineTxt}>\n            Партнёрские вакансии не обновились — свои и ранее загруженные остаются доступны. Нажмите, чтобы повторить.\n          </Text>\n        </TouchableOpacity>\n      ) : null}\n",
    'permanent partner retry banner',
)

feed = feed[:start] + block + feed[end:]
feed_path.write_text(feed, encoding='utf-8')

anchor = "    'частичный сбой партнёрского фида виден и имеет retry': 'Партнёрские смены не обновились' in feed and 'onPress={() => void loadPartnerShifts()}' in feed,\n"
addition = anchor + (
    "    'постоянная партнёрская выдача отмечает сетевой сбой': 'setExternalVacanciesLoadFailed(true);' in feed and 'setExternalVacanciesLoadFailed(false);' in feed,\n"
    "    'постоянная партнёрская выдача сохраняет кеш и показывает retry': 'Партнёрские вакансии не обновились' in feed and 'onPress={() => void loadExternalVacancies(externalSelection)}' in feed,\n"
    "    'refresh постоянной ленты завершается в finally': \"showToast('Не удалось обновить вакансии. Проверьте связь.', 'error');\\n    } finally {\\n      setRefreshing(false);\" in feed,\n"
    "    'refresh постоянной ленты уважает выбранные источники': 'loadExternalVacancies(externalSelection)' in feed,\n"
)
test = replace_once(test, anchor, addition, 'network truth test anchor')
test_path.write_text(test, encoding='utf-8')

print('permanent-feed network truth patch applied')
