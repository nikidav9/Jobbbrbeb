from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


feed = 'app/(tabs)/feed.tsx'
old = """      dbUpsertLike(card.id, user.id, card.employerId, { workerLiked: false, workerSkipped: true })
        .then(() => refreshLikes(user))
        .catch(() => { pendingLikeIds.current.delete(card.id); });
    });
  }, [currentCard, currentUser, swiping, selectedDate, animateCard, refreshLikes, promptRegister]);
"""
new = """      dbUpsertLike(card.id, user.id, card.employerId, { workerLiked: false, workerSkipped: true })
        .then(() => refreshLikes(user))
        .catch(() => {
          // Свайп уже анимирован, но сервер не принял решение. Возвращаем
          // карточку на вершину и убираем её из локальной истории: иначе UI
          // утверждал бы, что вакансия пропущена, а после обновления она
          // появилась бы снова без объяснения.
          pendingLikeIds.current.delete(card.id);
          setHistory(h => ({
            ...h,
            [date]: (h[date] ?? []).filter(v => v.id !== card.id),
          }));
          setCards(prev => [card, ...prev.filter(v => v.id !== card.id)]);
          showToast('Не удалось пропустить вакансию. Проверьте связь и попробуйте ещё раз.', 'error');
        });
    });
  }, [currentCard, currentUser, swiping, selectedDate, animateCard, refreshLikes, promptRegister, showToast]);
"""
replace_once(feed, old, new, 'truthful shift skip')

# Guard the semantic order in the permanent offline regression suite.
test_path = Path('tests/offline_states_test.php')
test = test_path.read_text(encoding='utf-8')
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────\n"
if test.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected one, got {test.count(anchor)}')
insert = r'''// ── Свайп «пропустить»: сетевой сбой не превращается в локальный успех ───────
$feedSkip = (string)file_get_contents(__DIR__ . '/../app/(tabs)/feed.tsx');
$skipStart = strpos($feedSkip, 'const doSkip = useCallback');
$skipEnd = strpos($feedSkip, 'const doWant = useCallback', $skipStart === false ? 0 : $skipStart);
$skipBody = ($skipStart !== false && $skipEnd !== false)
    ? substr($feedSkip, $skipStart, $skipEnd - $skipStart)
    : '';
check('пропуск смены: ошибка серверной записи возвращает карточку',
    $skipBody !== '' &&
    str_contains($skipBody, 'setCards(prev => [card, ...prev.filter(v => v.id !== card.id)])'));
check('пропуск смены: ошибка убирает ложную запись из истории',
    str_contains($skipBody, '[date]: (h[date] ?? []).filter(v => v.id !== card.id)'));
check('пропуск смены: ошибка видна пользователю',
    str_contains($skipBody, 'Не удалось пропустить вакансию. Проверьте связь и попробуйте ещё раз.'));

'''
test_path.write_text(test.replace(anchor, insert + anchor, 1), encoding='utf-8')

print('truthful shift skip patch applied')
