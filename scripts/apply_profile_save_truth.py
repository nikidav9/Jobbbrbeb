from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# Server acknowledgement is the source of truth. Do not mutate the visible
# profile/session before the write that can fail.
replace_once(
    'contexts/AppContext.tsx',
    """  const updateUser = async (u: User) => {
    _setCurrentUser(u);
    await saveSessionUser(u);
    await dbUpsertUser(u);
    await refreshUsers();
  };""",
    """  const updateUser = async (u: User) => {
    // Профиль считаем изменённым только после подтверждения сервера. Раньше
    // UI и локальная сессия менялись первыми: при сетевой ошибке человек видел
    // новые данные, хотя после перезапуска сервер возвращал старые.
    await dbUpsertUser(u);
    _setCurrentUser(u);
    setUsers(prev => {
      const index = prev.findIndex(x => x.id === u.id);
      if (index < 0) return [...prev, u];
      const next = [...prev];
      next[index] = u;
      return next;
    });
    // Кэш сессии не является подтверждением операции: если локальное хранилище
    // недоступно, серверная запись всё равно уже состоялась.
    saveSessionUser(u).catch(e => console.warn('[AppContext] session cache update failed', e));
  };""",
    'updateUser server-first contract',
)

# Keep the editor open until the server accepts the change, so a failed write
# can be retried without retyping the form.
replace_once(
    'app/(tabs)/profile.tsx',
    """      // Close modal immediately — sync to server in background
      setEditSection(null);
      setSavingEdit(false);
      showToast('Сохранено', 'success');
      updateUser(updated).catch(() => showToast('Ошибка синхронизации', 'error'));
    } catch {
      showToast('Ошибка при сохранении', 'error');
      setSavingEdit(false);
    }
  };""",
    """      await updateUser(updated);
      setEditSection(null);
      showToast('Сохранено', 'success');
    } catch {
      // Форму не закрываем: введённые значения остаются на месте для повтора.
      showToast('Не удалось сохранить. Проверьте связь и попробуйте ещё раз', 'error');
    } finally {
      setSavingEdit(false);
    }
  };""",
    'profile editor waits for server',
)

# updateUser is now server-first, so a failed avatar profile write never changed
# the local user and must not issue a second write that can overwrite newer data.
replace_once(
    'app/(tabs)/profile.tsx',
    """    const prevAvatarUrl = currentUser.avatarUrl;
    try {""",
    """    try {""",
    'remove avatar rollback snapshot',
)
replace_once(
    'app/(tabs)/profile.tsx',
    """    } catch (e) {
      console.error('[Avatar] processAndUpload error', e);
      updateUser({ ...currentUser, avatarUrl: prevAvatarUrl }).catch(() => {});
      showToast('Не удалось обновить фото. Проверьте доступ к памяти.', 'error');
""",
    """    } catch (e) {
      console.error('[Avatar] processAndUpload error', e);
      showToast('Не удалось обновить фото. Проверьте связь или доступ к памяти.', 'error');
""",
    'remove avatar rollback write',
)

# Permanent regression guards live with the other network truthfulness checks.
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = r'''// ── Профиль: успех показывается только после серверной записи ─────────────────
$profileCtx = (string)file_get_contents(__DIR__ . '/../contexts/AppContext.tsx');
$profileScreen = (string)file_get_contents(__DIR__ . '/../app/(tabs)/profile.tsx');
$upsertPos = strpos($profileCtx, 'await dbUpsertUser(u);');
$localPos = strpos($profileCtx, '_setCurrentUser(u);', $upsertPos === false ? 0 : $upsertPos);
check('профиль: сервер подтверждает изменение до локального UI',
    $upsertPos !== false && $localPos !== false && $upsertPos < $localPos);
check('профиль: форма ждёт сервер перед успехом',
    (bool)preg_match("~await updateUser\\(updated\\);[\\s\\S]{0,180}showToast\\('Сохранено', 'success'\\)~", $profileScreen));
check('профиль: фоновый ложный успех удалён',
    !str_contains($profileScreen, "updateUser(updated).catch(() => showToast('Ошибка синхронизации'"));
check('профиль: ошибка оставляет форму для повтора',
    str_contains($profileScreen, 'Не удалось сохранить. Проверьте связь и попробуйте ещё раз'));
check('фото профиля: ошибка записи не запускает опасный откат',
    !str_contains($profileScreen, 'prevAvatarUrl') &&
    !preg_match('~processAndUpload error[\\s\\S]{0,160}updateUser\\(~', $profileScreen));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────'''
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
