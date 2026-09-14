from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# ── Chat: a failed fetch must not look like an empty/missing conversation. ──
replace_once(
    'app/chat-room.tsx',
    """  const [dbChat, setDbChat] = useState<Chat | null>(null);
  const chat = foundChat ?? chatRef.current ?? dbChat;

  // Declare state/refs before effects that reference them
  const hasCachedRef = useRef(chatId ? msgCache.has(chatId) : false);
  const cached = chatId ? (msgCache.get(chatId) ?? chat?.messages ?? []) : (chat?.messages ?? []);
  const [messages, setMessages] = useState<Message[]>(cached);
  const [loadingMessages, setLoadingMessages] = useState(!hasCachedRef.current && !!chatId);
  const [input, setInput] = useState('');""",
    """  const [dbChat, setDbChat] = useState<Chat | null>(null);
  const [loadingDbChat, setLoadingDbChat] = useState(!foundChat && !!chatId);
  const [dbChatLoadFailed, setDbChatLoadFailed] = useState(false);
  const [dbChatRetry, setDbChatRetry] = useState(0);
  const chat = foundChat ?? chatRef.current ?? dbChat;

  // Declare state/refs before effects that reference them
  const hasCachedRef = useRef(chatId ? msgCache.has(chatId) : false);
  const cached = chatId ? (msgCache.get(chatId) ?? chat?.messages ?? []) : (chat?.messages ?? []);
  const [messages, setMessages] = useState<Message[]>(cached);
  const [loadingMessages, setLoadingMessages] = useState(!hasCachedRef.current && !!chatId);
  const [messageLoadFailed, setMessageLoadFailed] = useState(false);
  const [messageRetry, setMessageRetry] = useState(0);
  const [input, setInput] = useState('');""",
    'chat load states',
)
replace_once(
    'app/chat-room.tsx',
    """  useEffect(() => {
    if (!chatId || foundChat) return;
    let isMounted = true;
    dbGetChatById(chatId).then(c => {
      if (!isMounted || !c) return;
      if (c.workerId !== currentUser?.id && c.employerId !== currentUser?.id) {
        router.back();
        return;
      }
      setDbChat(c);
      setMessages(c.messages);
      lastCountRef.current = c.messages.length;
    }).catch(() => {});
    return () => { isMounted = false; };
  }, [chatId]);""",
    """  useEffect(() => {
    if (!chatId || foundChat) { setLoadingDbChat(false); return; }
    let isMounted = true;
    setLoadingDbChat(true);
    setDbChatLoadFailed(false);
    dbGetChatById(chatId).then(c => {
      if (!isMounted || !c) return;
      if (c.workerId !== currentUser?.id && c.employerId !== currentUser?.id) {
        router.back();
        return;
      }
      setDbChat(c);
      setMessages(c.messages);
      lastCountRef.current = c.messages.length;
    }).catch(() => {
      if (isMounted) setDbChatLoadFailed(true);
    }).finally(() => {
      if (isMounted) setLoadingDbChat(false);
    });
    return () => { isMounted = false; };
  }, [chatId, dbChatRetry]);""",
    'chat record fetch',
)
replace_once(
    'app/chat-room.tsx',
    """  useEffect(() => {
    if (!chatId || hasCachedRef.current) return;
    let mounted = true;
    dbGetMessages(chatId).then(msgs => {
      if (!mounted) return;
      setMessages(msgs);
      msgCache.set(chatId, msgs);
      lastCountRef.current = msgs.length;
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }).catch(() => {}).finally(() => { if (mounted) setLoadingMessages(false); });
    return () => { mounted = false; };
  }, [chatId]);""",
    """  useEffect(() => {
    if (!chatId || hasCachedRef.current) return;
    let mounted = true;
    setLoadingMessages(true);
    setMessageLoadFailed(false);
    dbGetMessages(chatId).then(msgs => {
      if (!mounted) return;
      setMessages(msgs);
      msgCache.set(chatId, msgs);
      lastCountRef.current = msgs.length;
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }).catch(() => {
      // Keep preview/cache data if we have it. A transport error is not an
      // empty chat and must never replace already visible messages.
      if (mounted) setMessageLoadFailed(true);
    }).finally(() => { if (mounted) setLoadingMessages(false); });
    return () => { mounted = false; };
  }, [chatId, messageRetry]);""",
    'message fetch',
)
replace_once(
    'app/chat-room.tsx',
    """  const showSuggestions =
    suggestions.length > 0 && !iAlreadyWrote && !input.trim() &&
    !isChatBlocked && !isRecording;""",
    """  const showSuggestions =
    suggestions.length > 0 && !iAlreadyWrote && !input.trim() &&
    !messageLoadFailed && !isChatBlocked && !isRecording;""",
    'chat suggestions on failed load',
)
replace_once(
    'app/chat-room.tsx',
    """  if (!currentUser || !chat) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backIconBtn} activeOpacity={0.7}>
            <Text style={styles.backIconTxt}>‹</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.textMuted }}>Чат не найден</Text>
        </View>
      </SafeAreaView>
    );
  }""",
    """  if (!currentUser || !chat) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backIconBtn} activeOpacity={0.7}>
            <Text style={styles.backIconTxt}>‹</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: rs(24), gap: rs(12) }}>
          {!currentUser || loadingDbChat ? (
            <ActivityIndicator size="large" color={Colors.primary} />
          ) : dbChatLoadFailed ? (
            <>
              <Text style={{ color: Colors.textPrimary, fontSize: rf(16), fontWeight: '700', textAlign: 'center' }}>
                Не удалось загрузить чат
              </Text>
              <Text style={{ color: Colors.textMuted, textAlign: 'center' }}>Проверьте связь и попробуйте ещё раз.</Text>
              <TouchableOpacity
                onPress={() => setDbChatRetry(x => x + 1)}
                style={{ backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={{ color: Colors.textMuted }}>Чат не найден</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }""",
    'chat missing/error state',
)
replace_once(
    'app/chat-room.tsx',
    """        {loadingMessages ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.msgList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}""",
    """        {loadingMessages ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {messageLoadFailed ? (
              <View style={{ paddingHorizontal: rs(16), paddingVertical: rs(10), backgroundColor: Colors.surface, gap: rs(6) }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700', textAlign: 'center' }}>
                  {messages.length > 0 ? 'Не удалось обновить сообщения' : 'Не удалось загрузить сообщения'}
                </Text>
                <Text style={{ color: Colors.textMuted, textAlign: 'center', fontSize: rf(12) }}>
                  Уже показанные сообщения сохранены. Проверьте связь и повторите.
                </Text>
                <TouchableOpacity onPress={() => setMessageRetry(x => x + 1)} activeOpacity={0.8}>
                  <Text style={{ color: Colors.primary, fontWeight: '700', textAlign: 'center' }}>Повторить</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={m => m.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.msgList}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            />
          </View>
        )}""",
    'message error rendering',
)

# ── Other user's profile and ratings: distinguish transport failure from empty. ──
replace_once(
    'app/user-profile.tsx',
    """  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [loadingRatings, setLoadingRatings] = useState(false);
  const [fetchedUser, setFetchedUser] = useState<import('@/constants/types').User | null>(null);
  const [fetchingUser, setFetchingUser] = useState(false);
  const [stats, setStats] = useState<UserStats | null>(null);""",
    """  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [loadingRatings, setLoadingRatings] = useState(false);
  const [ratingsLoadFailed, setRatingsLoadFailed] = useState(false);
  const [fetchedUser, setFetchedUser] = useState<import('@/constants/types').User | null>(null);
  const [fetchingUser, setFetchingUser] = useState(false);
  const [userLoadFailed, setUserLoadFailed] = useState(false);
  const [userRetry, setUserRetry] = useState(0);
  const [stats, setStats] = useState<UserStats | null>(null);""",
    'user profile load states',
)
replace_once(
    'app/user-profile.tsx',
    """    setFetchingUser(true);
    dbGetUserById(userId)
      .then(u => setFetchedUser(u))
      .catch(() => {})
      .finally(() => setFetchingUser(false));
  }, [userId, contextUser]);""",
    """    setFetchingUser(true);
    setUserLoadFailed(false);
    dbGetUserById(userId)
      .then(u => setFetchedUser(u))
      .catch(() => setUserLoadFailed(true))
      .finally(() => setFetchingUser(false));
  }, [userId, contextUser, userRetry]);""",
    'user profile fetch',
)
replace_once(
    'app/user-profile.tsx',
    """  const fetchRatings = (id: string) => {
    setLoadingRatings(true);
    dbGetRatingsForUser(id)
      .then(setRatings)
      .catch(() => {})
      .finally(() => setLoadingRatings(false));
  };""",
    """  const fetchRatings = (id: string) => {
    setLoadingRatings(true);
    setRatingsLoadFailed(false);
    dbGetRatingsForUser(id)
      .then(setRatings)
      .catch(() => setRatingsLoadFailed(true))
      .finally(() => setLoadingRatings(false));
  };""",
    'other profile ratings fetch',
)
replace_once(
    'app/user-profile.tsx',
    """          {fetchingUser ? (
            <ActivityIndicator size="large" color="#6C63FF" />
          ) : (
            <Text style={styles.errorText}>Пользователь не найден</Text>
          )}""",
    """          {fetchingUser ? (
            <ActivityIndicator size="large" color="#6C63FF" />
          ) : userLoadFailed ? (
            <>
              <Text style={styles.errorText}>Не удалось загрузить профиль</Text>
              <Text style={styles.emptyReviewsSub}>Проверьте связь и попробуйте ещё раз.</Text>
              <TouchableOpacity
                onPress={() => setUserRetry(x => x + 1)}
                style={{ marginTop: rs(8), backgroundColor: Colors.primary, borderRadius: rs(100), paddingHorizontal: rs(22), paddingVertical: rs(11) }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Повторить</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.errorText}>Пользователь не найден</Text>
          )}""",
    'user profile missing/error render',
)
replace_once(
    'app/user-profile.tsx',
    """          loadingRatings ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : ratings.length === 0 ? (""",
    """          loadingRatings ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : ratingsLoadFailed && ratings.length === 0 ? (
            <View style={styles.emptyReviews}>
              <Text style={styles.emptyReviewsTitle}>Не удалось загрузить отзывы</Text>
              <Text style={styles.emptyReviewsSub}>Проверьте связь — уже загруженные отзывы не удаляются.</Text>
              <TouchableOpacity onPress={() => fetchRatings(userId)} activeOpacity={0.8}>
                <Text style={{ color: Colors.primary, fontWeight: '700', marginTop: rs(6) }}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : ratings.length === 0 ? (""",
    'other profile ratings render',
)

# ── Own profile ratings modal: same rule. ──
replace_once(
    'app/(tabs)/profile.tsx',
    """  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [loading, setLoading] = useState(true);
  const reviewsSwipe = useSwipeToDismiss(onClose);

  const fetchRatings = () => {
    dbGetRatingsForUser(userId)
      .then(setRatings)
      .catch(() => {})
      .finally(() => setLoading(false));
  };""",
    """  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingsLoadFailed, setRatingsLoadFailed] = useState(false);
  const reviewsSwipe = useSwipeToDismiss(onClose);

  const fetchRatings = () => {
    setLoading(true);
    setRatingsLoadFailed(false);
    dbGetRatingsForUser(userId)
      .then(setRatings)
      .catch(() => setRatingsLoadFailed(true))
      .finally(() => setLoading(false));
  };""",
    'own profile ratings load',
)
replace_once(
    'app/(tabs)/profile.tsx',
    """          {loading ? (
            <View style={{ padding: 48, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : ratings.length === 0 ? (""",
    """          {loading ? (
            <View style={{ padding: 48, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : ratingsLoadFailed && ratings.length === 0 ? (
            <View style={rmS.empty}>
              <Text style={rmS.emptyTitle}>Не удалось загрузить отзывы</Text>
              <Text style={rmS.emptySub}>Проверьте связь и попробуйте ещё раз.</Text>
              <TouchableOpacity onPress={fetchRatings} activeOpacity={0.8}>
                <Text style={{ color: Colors.primary, fontWeight: '700', marginTop: rs(4) }}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : ratings.length === 0 ? (""",
    'own profile ratings render',
)

# ── CI guard: these states must not regress into silent empty screens. ──
test = Path('tests/offline_states_test.php')
t = test.read_text()
anchor = "// ── Прежние тексты никуда не делись ──────────────────────────────────────────"
addition = """// ── Чат, чужой профиль и отзывы: ошибка загрузки не равна пустоте ────────────
$chatRoom = (string)file_get_contents(__DIR__ . '/../app/chat-room.tsx');
check('чат: ошибка записи чата хранится отдельно', str_contains($chatRoom, 'dbChatLoadFailed'));
check('чат: ошибка сообщений хранится отдельно', str_contains($chatRoom, 'messageLoadFailed'));
check('чат: при ошибке сообщений есть диагноз', str_contains($chatRoom, 'Не удалось загрузить сообщения'));
check('чат: при ошибке сообщений есть повтор',
    (bool)preg_match('~setMessageRetry[\\s\\S]{0,220}Повторить~', $chatRoom));
check('чат: сбой загрузки не включает подсказки как для нового чата',
    str_contains($chatRoom, '!messageLoadFailed && !isChatBlocked'));

$userProfile = (string)file_get_contents(__DIR__ . '/../app/user-profile.tsx');
check('чужой профиль: ошибка загрузки не равна «не найден»',
    str_contains($userProfile, 'userLoadFailed') && str_contains($userProfile, 'Не удалось загрузить профиль'));
check('чужой профиль: отзывы имеют отдельную ошибку',
    str_contains($userProfile, 'ratingsLoadFailed') && str_contains($userProfile, 'Не удалось загрузить отзывы'));

$ownProfile = (string)file_get_contents(__DIR__ . '/../app/(tabs)/profile.tsx');
check('свои отзывы: сетевой сбой не выглядит отсутствием отзывов',
    str_contains($ownProfile, 'ratingsLoadFailed') && str_contains($ownProfile, 'Не удалось загрузить отзывы'));

// ── Прежние тексты никуда не делись ──────────────────────────────────────────"""
if t.count(anchor) != 1:
    raise SystemExit(f'offline test anchor: expected 1, got {t.count(anchor)}')
test.write_text(t.replace(anchor, addition, 1))
