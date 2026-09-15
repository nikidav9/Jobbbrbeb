from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# Broadcast helper reports delivery outcome instead of swallowing the final failure.
replace_once(
    'services/notifications.ts',
    """}): Promise<void> {
  try {
    const { metroStation, title, company, type, date, daysCount, timeStart, timeEnd, salary, schedule, vacancyId, workType, estimated } = params;""",
    """}): Promise<boolean> {
  try {
    const { metroStation, title, company, type, date, daysCount, timeStart, timeEnd, salary, schedule, vacancyId, workType, estimated } = params;""",
    'broadcast return type',
)

replace_once(
    'services/notifications.ts',
    """          });
          if (res.ok) break;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Сетевой сбой/таймаут — попробуем ещё раз (если есть vacancyId).
      }
      if (canRetry && attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  } catch {
    // Never crash the app due to a notification failure
  }
}""",
    """          });
          if (res.ok) return true;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Сетевой сбой/таймаут — попробуем ещё раз (если есть vacancyId).
      }
      if (canRetry && attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    return false;
  } catch {
    // Не роняем публикацию вакансии из-за вторичной рассылки, но возвращаем
    // честный результат, чтобы форма могла предупредить работодателя.
    return false;
  }
}""",
    'broadcast result',
)

warning = "Вакансия опубликована, но рассылку не удалось отправить. Вакансия остаётся доступна в ленте."

# Permanent vacancy: keep publication success independent, surface secondary delivery failure.
replace_once(
    'app/create-perm-vacancy.tsx',
    """        notifyWorkersNewVacancy({
          metroStation, title: title.trim(), company: vac.company, type: 'permanent',
          workType: vac.workType,
          salary: vac.salary, schedule: vac.schedule, vacancyId: vac.id,
        }).catch(() => {});""",
    f"""        void notifyWorkersNewVacancy({{
          metroStation, title: title.trim(), company: vac.company, type: 'permanent',
          workType: vac.workType,
          salary: vac.salary, schedule: vac.schedule, vacancyId: vac.id,
        }}).then(ok => {{
          if (!ok) showToast('{warning}', 'error');
        }});""",
    'permanent vacancy broadcast warning',
)

# Shift vacancy has the same call shape twice (multi-day and single-day), with different payloads.
replace_once(
    'app/create-vacancy.tsx',
    """          notifyWorkersNewVacancy({
            metroStation, title: meta.label, company: base.company, type: 'shift',
            workType: base.workType,
            date: vacs[0]?.date, daysCount: vacs.length, vacancyId: vacs[0]?.id,
            timeStart: base.timeStart, timeEnd: base.timeEnd, salary: base.salary,
            estimated: isStorcker,
          }).catch(() => {});""",
    f"""          void notifyWorkersNewVacancy({{
            metroStation, title: meta.label, company: base.company, type: 'shift',
            workType: base.workType,
            date: vacs[0]?.date, daysCount: vacs.length, vacancyId: vacs[0]?.id,
            timeStart: base.timeStart, timeEnd: base.timeEnd, salary: base.salary,
            estimated: isStorcker,
          }}).then(ok => {{
            if (!ok) showToast('{warning}', 'error');
          }});""",
    'multi-day vacancy broadcast warning',
)

replace_once(
    'app/create-vacancy.tsx',
    """          notifyWorkersNewVacancy({
            metroStation, title: meta.label, company: base.company, type: 'shift',
            workType: base.workType,
            date: vac.date, vacancyId: vac.id, timeStart: base.timeStart, timeEnd: base.timeEnd, salary: base.salary,
            estimated: isStorcker,
          }).catch(() => {});""",
    f"""          void notifyWorkersNewVacancy({{
            metroStation, title: meta.label, company: base.company, type: 'shift',
            workType: base.workType,
            date: vac.date, vacancyId: vac.id, timeStart: base.timeStart, timeEnd: base.timeEnd, salary: base.salary,
            estimated: isStorcker,
          }}).then(ok => {{
            if (!ok) showToast('{warning}', 'error');
          }});""",
    'single-day vacancy broadcast warning',
)

# Regression guards.
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Рассылка вакансии: вторичный сбой не выдаётся за доставку ────────────────
$notifSvc = (string)file_get_contents(__DIR__ . '/../services/notifications.ts');
$createShift = (string)file_get_contents(__DIR__ . '/../app/create-vacancy.tsx');
$createPerm = (string)file_get_contents(__DIR__ . '/../app/create-perm-vacancy.tsx');
check('рассылка вакансии: helper возвращает результат',
    str_contains($notifSvc, 'export async function notifyWorkersNewVacancy') &&
    str_contains($notifSvc, '): Promise<boolean>') &&
    str_contains($notifSvc, 'if (res.ok) return true;'));
check('рассылка вакансии: исчерпанные повторы дают false',
    str_contains($notifSvc, 'return false;'));
check('смена: неудачная рассылка видна, но публикация не откатывается',
    str_contains($createShift, "if (!ok) showToast('Вакансия опубликована, но рассылку не удалось отправить."));
check('постоянная: неудачная рассылка видна, но публикация не откатывается',
    str_contains($createPerm, "if (!ok) showToast('Вакансия опубликована, но рассылку не удалось отправить."));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
