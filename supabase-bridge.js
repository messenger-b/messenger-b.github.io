(() => {
  'use strict';

  const cfg = window.MESSENGER_B_CONFIG || {};
  const savedUrl = localStorage.getItem('mb_sb_url') || '';
  const savedKey = localStorage.getItem('mb_sb_key') || '';
  const SUPABASE_URL = (cfg.SUPABASE_URL || savedUrl).trim();
  const SUPABASE_ANON_KEY = (cfg.SUPABASE_ANON_KEY || savedKey).trim();
  window.__CLOUD_MODE__ = true;

  function showCloudSetupScreen() {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.innerHTML = `
        <div class="auth-view" style="display:flex">
          <div class="auth-card" style="max-width:480px">
            <div class="auth-header">
              <div class="auth-logo">Б</div>
              <h1>Подключение Supabase</h1>
              <p class="muted">Бесплатная облачная база 24/7 для «Мессенджер Б»</p>
            </div>
            <div class="info-banner">
              Вставьте <strong>Project URL</strong> и <strong>anon public key</strong> из вашего проекта Supabase (Project Settings → API) или впишите их в файл <code>config.js</code>.
            </div>
            <form id="sb-setup-form">
              <div class="field"><label>Supabase Project URL</label><input type="text" id="sb-url" placeholder="https://xxxxxxxx.supabase.co" required /></div>
              <div class="field"><label>Supabase anon public key</label><input type="text" id="sb-key" placeholder="eyJhbGciOi..." required /></div>
              <button type="submit" class="btn btn-primary full-width">Сохранить и открыть мессенджер</button>
            </form>
          </div>
        </div>
      `;
      document.getElementById('sb-setup-form').onsubmit = (e) => {
        e.preventDefault();
        localStorage.setItem('mb_sb_url', document.getElementById('sb-url').value.trim());
        localStorage.setItem('mb_sb_key', document.getElementById('sb-key').value.trim());
        location.reload();
      };
    });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
    showCloudSetupScreen();
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: 'messenger-b-session-v1',
    },
  });

  const nativeFetch = window.fetch.bind(window);
  let wsEmit = () => {};
  let realtimeChannel = null;

  let cachedProfile = null;
  let cachedProfileAt = 0;
  let cachedClasses = null;
  let cachedClassesAt = 0;
  let cachedFriendIds = new Set();
  let onlinePresenceIds = new Set();
  let presenceReady = false;
  const PROFILE_COLUMNS = 'id, username, display_name, role, class_id, bio, status_emoji, avatar_url, avatar_color, created_at';
  let lastProfileError = '';

  function invalidateProfileCache() { cachedProfile = null; cachedProfileAt = 0; }
  function invalidateClassesCache() { cachedClasses = null; cachedClassesAt = 0; }

  function jsonRes(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function toMs(iso) {
    return iso ? new Date(iso).getTime() : Date.now();
  }

  async function getClassesList(force = false) {
    if (!force && cachedClasses && (Date.now() - cachedClassesAt) < 60_000) return cachedClasses;
    const { data, error } = await sb.from('classes').select('id, name').order('name');
    if (error) console.error('[Supabase classes]', error);
    const raw = (data && data.length > 0) ? data : [
      { id: 1, name: '7Б' }, { id: 2, name: '7А' }, { id: 3, name: '7В' },
      { id: 4, name: '5А' }, { id: 5, name: '5Б' }, { id: 6, name: '6А' }, { id: 7, name: '6Б' },
      { id: 8, name: '8А' }, { id: 9, name: '8Б' }, { id: 10, name: '9А' }, { id: 11, name: '9Б' },
      { id: 12, name: '10А' }, { id: 13, name: '10Б' }, { id: 14, name: '11А' }, { id: 15, name: '11Б' },
    ];
    const def = raw.find((c) => c.name === '7Б') || raw[0];
    const ordered = def ? [def, ...raw.filter((c) => c.id !== def.id)] : raw;
    cachedClasses = ordered;
    cachedClassesAt = Date.now();
    return ordered;
  }

  async function getClassesMap() {
    const list = await getClassesList();
    return new Map(list.map((c) => [c.id, c.name]));
  }

  async function getCurrentProfile(force = false) {
    if (!force && cachedProfile && (Date.now() - cachedProfileAt) < 25_000) return cachedProfile;
    lastProfileError = '';
    const { data: { session } } = await sb.auth.getSession();
    let user = session?.user || null;
    if (!user) {
      const uRes = await sb.auth.getUser();
      user = uRes.data?.user || null;
    }
    if (!user) {
      invalidateProfileCache();
      return null;
    }

    let { data: prof, error } = await sb.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
    if (error && /jwt|expired|token/i.test(error.message || '')) {
      await sb.auth.refreshSession();
      const refreshed = await sb.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
      prof = refreshed.data;
      error = refreshed.error;
    }
    if (error) lastProfileError = error.message;

    if (!prof) {
      const rpcRes = await sb.rpc('ensure_my_profile');
      if (rpcRes.error) lastProfileError = rpcRes.error.message;
      const retry = await sb.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
      if (retry.error) lastProfileError = retry.error.message;
      prof = retry.data;
    }
    if (!prof) return null;

    // The profiles table no longer grants email column access. This RPC returns only the caller's own email.
    const [{ data: ownEmail }, cmap] = await Promise.all([sb.rpc('get_my_email'), getClassesMap()]);
    const full = { ...prof, email: ownEmail || '', className: cmap.get(prof.class_id) || '7Б' };
    cachedProfile = full;
    cachedProfileAt = Date.now();
    return full;
  }

  function formatProfile(p, cmap = null, canSeeLastSeen = false) {
    if (!p) return null;
    const lastSeenVisible = Boolean(canSeeLastSeen || p.id === cachedProfile?.id);
    const stamp = lastSeenVisible ? toMs(p.last_seen) : null;
    const isOnlineNow = lastSeenVisible && (presenceReady
      ? onlinePresenceIds.has(p.id)
      : (stamp && (Date.now() - stamp) < 45_000));
    const className = p.className || p.class_name || (cmap && cmap.get(p.class_id)) || p.classes?.name || '7Б';
    return {
      id: p.id,
      email: p.id === cachedProfile?.id ? (p.email || '') : '',
      username: p.username,
      displayName: p.display_name,
      role: p.role,
      classId: p.class_id,
      className,
      bio: p.bio || '',
      statusEmoji: p.status_emoji || '',
      avatarUrl: p.avatar_url || null,
      avatarColor: p.avatar_color || '#2AABEE',
      isOnline: Boolean(isOnlineNow),
      canSeeLastSeen: lastSeenVisible,
      isFriend: cachedFriendIds.has(p.id),
      lastSeen: stamp,
    };
  }

  async function formatProfiles(rows, cmap = null) {
    const profiles = (rows || []).filter(Boolean);
    if (!profiles.length) return [];
    const ids = [...new Set(profiles.map((p) => p.id).filter(Boolean))];
    let visible = new Map();
    if (ids.length) {
      const { data, error } = await sb.rpc('get_profile_presence_visibility', { p_user_ids: ids });
      if (!error) visible = new Map((data || []).map((x) => [x.user_id, {
        allowed: Boolean(x.can_see_last_seen),
        lastSeen: x.can_see_last_seen && x.last_seen ? toMs(x.last_seen) : null,
      }]));
    }
    return profiles.map((p) => {
      const presence = visible.get(p.id);
      return formatProfile({ ...p, last_seen: presence?.allowed ? presence.lastSeen : null }, cmap, presence?.allowed === true);
    });
  }

  function formatSettings(s) {
    return {
      theme: s?.theme || 'dark',
      accent: s?.accent || 'blue',
      wallpaper: s?.wallpaper || 'tg-dots',
      fontSize: s?.font_size || 15,
      bubbleRadius: s?.bubble_radius || 18,
      bubbleStyle: s?.bubble_style || 'classic',
      compactMode: Boolean(s?.compact_mode),
      animationsEnabled: s?.animations_enabled !== false,
      largeEmojis: s?.large_emojis !== false,
      sendOnEnter: s?.send_on_enter !== false,
      soundEnabled: s?.sound_enabled !== false,
      desktopNotifications: s?.desktop_notifications !== false,
      hideNotifPreview: Boolean(s?.hide_notif_preview),
      showLastSeen: s?.show_last_seen || 'all',
      showTyping: s?.show_typing !== false,
      allowDm: s?.allow_dm || 'all',
      allowGroupAdd: s?.allow_group_add || 'class_friends',
      allowFriendRequests: s?.allow_friend_requests || 'all',
      showReadReceipts: s?.show_read_receipts !== false,
      hasAppLockPin: Boolean(s?.app_lock_pin),
    };
  }

  function canPostInChat(me, chat) {
    if (!me || !chat) return false;
    if (chat.type === 'school_announcements') return me.role === 'admin';
    if (chat.type === 'announcements') {
      return me.role === 'admin' || ((me.role === 'teacher' || me.role === 'leader') && me.class_id === chat.class_id);
    }
    return true;
  }

  async function refreshFriendIds(myId) {
    try {
      const { data } = await sb.from('friendships').select('requester_id, addressee_id, status').or(`requester_id.eq.${myId},addressee_id.eq.${myId}`);
      const set = new Set();
      for (const f of (data || [])) {
        if (f.status === 'accepted') {
          set.add(f.requester_id === myId ? f.addressee_id : f.requester_id);
        }
      }
      cachedFriendIds = set;
      return data || [];
    } catch {
      return [];
    }
  }

  // FIXED: Loads profiles for BOTH message senders AND replied-to message senders (never shows "Пользователь"!)
  async function enrichMessages(rows, myId) {
    if (!rows || rows.length === 0) return [];
    const msgIds = rows.map((r) => r.id);
    const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter(Boolean))];
    const hasPolls = rows.some((r) => r.msg_type === 'poll');

    const [reactRes, pollsRes, repliesRes, readRes] = await Promise.all([
      sb.from('message_reactions').select('message_id, user_id, emoji').in('message_id', msgIds),
      hasPolls ? sb.from('polls').select('*, poll_votes(user_id, option_index)').in('message_id', msgIds) : { data: [] },
      replyIds.length ? sb.from('messages').select('id, content, msg_type, deleted_at, sender_id').in('id', replyIds) : { data: [] },
      sb.rpc('get_message_read_status', { p_message_ids: msgIds }),
    ]);

    const replies = repliesRes.data || [];
    const allSenderIds = [...new Set([
      ...rows.map((r) => r.sender_id).filter(Boolean),
      ...replies.map((r) => r.sender_id).filter(Boolean),
    ])];

    const sendersRes = allSenderIds.length
      ? await sb.from('profiles').select('id, username, display_name, role, avatar_url, avatar_color, status_emoji').in('id', allSenderIds)
      : { data: [] };

    const senderMap = new Map((sendersRes.data || []).map((u) => [u.id, u]));
    const replyMap = new Map(replies.map((r) => [r.id, r]));
    const pollMap = new Map((pollsRes.data || []).map((p) => [p.message_id, p]));
    const readMap = new Map((readRes.data || []).map((x) => [Number(x.message_id), Boolean(x.is_read)]));

    const reactByMsg = new Map();
    for (const rr of (reactRes.data || [])) {
      if (!reactByMsg.has(rr.message_id)) reactByMsg.set(rr.message_id, new Map());
      const m = reactByMsg.get(rr.message_id);
      if (!m.has(rr.emoji)) m.set(rr.emoji, { emoji: rr.emoji, count: 0, reactedByMe: false });
      const entry = m.get(rr.emoji);
      entry.count++;
      if (rr.user_id === myId) entry.reactedByMe = true;
    }

    return rows.map((r) => {
      const s = senderMap.get(r.sender_id);
      const rep = r.reply_to_id ? replyMap.get(r.reply_to_id) : null;
      const repSender = rep ? senderMap.get(rep.sender_id) : null;
      const p = pollMap.get(r.id);

      let poll = null;
      if (p && !r.deleted_at) {
        const opts = Array.isArray(p.options) ? p.options : [];
        const counts = opts.map(() => 0);
        const myVotes = [];
        const unique = new Set();
        for (const v of (p.poll_votes || [])) {
          if (v.option_index >= 0 && v.option_index < opts.length) {
            counts[v.option_index]++;
            unique.add(v.user_id);
            if (v.user_id === myId) myVotes.push(v.option_index);
          }
        }
        poll = {
          id: p.id,
          question: p.question,
          options: opts.map((text, idx) => ({ index: idx, text, votes: counts[idx], voters: [] })),
          totalVoters: unique.size,
          myVotes,
          allowMultiple: Boolean(p.allow_multiple),
          isAnonymous: Boolean(p.is_anonymous),
          closed: Boolean(p.closed),
        };
      }

      return {
        id: r.id,
        chatId: r.chat_id,
        senderId: r.sender_id,
        sender: s ? {
          id: s.id, username: s.username, displayName: s.display_name, role: s.role,
          avatarUrl: s.avatar_url, avatarColor: s.avatar_color, statusEmoji: s.status_emoji || '',
        } : null,
        content: r.deleted_at ? '' : r.content,
        msgType: r.msg_type,
        replyTo: rep ? {
          id: rep.id,
          senderName: repSender ? (repSender.display_name || ('@' + repSender.username)) : 'Участник',
          content: rep.deleted_at ? 'Сообщение удалено' : (rep.content || (rep.msg_type === 'voice' ? 'Голосовое сообщение' : rep.msg_type === 'image' ? 'Фото' : 'Вложение')),
          msgType: rep.msg_type,
        } : null,
        forwardedFrom: r.forwarded_from_name || null,
        attachment: r.attachment_url && !r.deleted_at ? {
          id: r.id, name: r.attachment_name || 'Файл', mimeType: r.attachment_mime || 'application/octet-stream',
          size: r.attachment_size || 0, url: r.attachment_url,
        } : null,
        voiceDuration: r.voice_duration,
        poll,
        reactions: reactByMsg.has(r.id) ? Array.from(reactByMsg.get(r.id).values()) : [],
        editedAt: r.edited_at ? toMs(r.edited_at) : null,
        deleted: Boolean(r.deleted_at),
        isRead: r.sender_id === myId && Boolean(readMap.get(Number(r.id))),
        createdAt: toMs(r.created_at),
      };
    });
  }

  async function buildChatSummaries(me) {
    const [membershipsRes, cmap] = await Promise.all([
      sb.from('chat_members').select('chat_id, role, muted, pinned_chat, last_read_message_id, chats(*)').eq('user_id', me.id),
      getClassesMap(),
    ]);
    const memberships = membershipsRes.data || [];
    if (memberships.length === 0) return [];

    const chatIds = memberships.map((m) => m.chat_id);
    const [allMembersRes, recentMsgsRes] = await Promise.all([
      sb.from('chat_members').select('chat_id, user_id, last_read_message_id, profiles(id, username, display_name, role, class_id, bio, status_emoji, avatar_url, avatar_color, created_at)').in('chat_id', chatIds),
      sb.from('messages').select('id, chat_id, sender_id, content, msg_type, deleted_at, created_at').in('chat_id', chatIds).order('id', { ascending: false }).limit(200),
    ]);

    const membersByChat = new Map();
    for (const row of (allMembersRes.data || [])) {
      if (!membersByChat.has(row.chat_id)) membersByChat.set(row.chat_id, []);
      membersByChat.get(row.chat_id).push(row);
    }

    const lastMsgByChat = new Map();
    for (const msg of (recentMsgsRes.data || [])) {
      if (!lastMsgByChat.has(msg.chat_id)) lastMsgByChat.set(msg.chat_id, msg);
    }
    const peerRows = (allMembersRes.data || []).filter((x) => x.user_id !== me.id && x.profiles).map((x) => x.profiles);
    const formattedPeers = await formatProfiles(peerRows, cmap);
    const peerMap = new Map(formattedPeers.map((p) => [p.id, p]));

    return memberships.map((m) => {
      const c = m.chats;
      if (!c) return null;
      const members = membersByChat.get(c.id) || [];
      let title = c.title;
      let avatarColor = c.avatar_color;
      let avatarUrl = null;
      let otherUser = null;

      if (c.type === 'dm') {
        const peer = members.find((x) => x.user_id !== me.id)?.profiles;
        if (peer) {
          otherUser = peerMap.get(peer.id) || formatProfile(peer, cmap);
          title = otherUser.displayName;
          avatarColor = otherUser.avatarColor;
          avatarUrl = otherUser.avatarUrl;
        }
      }

      const lm = lastMsgByChat.get(c.id);
      const unreadCount = lm && lm.id > (m.last_read_message_id || 0) && lm.sender_id !== me.id ? 1 : 0;

      return {
        id: c.id,
        slug: c.slug,
        classId: c.class_id,
        type: c.type,
        title,
        description: c.description,
        avatarColor,
        avatarUrl,
        otherUser,
        memberRole: m.role,
        memberCount: members.length,
        canPost: canPostInChat(me, c),
        canPin: canPostInChat(me, c),
        muted: Boolean(m.muted),
        pinned: Boolean(m.pinned_chat),
        pinnedMessage: c.pinned_message_id ? { id: c.pinned_message_id, senderName: 'Закреплено', content: 'Нажмите, чтобы перейти к сообщению' } : null,
        unreadCount,
        lastReadMessageId: m.last_read_message_id || 0,
        lastMessage: lm ? {
          id: lm.id,
          senderId: lm.sender_id,
          senderName: '',
          content: lm.deleted_at ? 'Сообщение удалено' : (lm.content || (lm.msg_type === 'voice' ? 'Голосовое сообщение' : lm.msg_type === 'image' ? 'Фото' : lm.msg_type === 'poll' ? 'Опрос' : 'Файл')),
          msgType: lm.msg_type,
          createdAt: toMs(lm.created_at),
        } : null,
        updatedAt: lm ? toMs(lm.created_at) : toMs(c.updated_at),
      };
    }).filter(Boolean);
  }

  // Broadcast typing / voice recording state in real time
  window.__cloudSendActivity = (chatId, action) => {
    if (!realtimeChannel || !cachedProfile || !chatId) return;
    realtimeChannel.send({
      type: 'broadcast',
      event: 'activity',
      payload: {
        chatId,
        userId: cachedProfile.id,
        displayName: cachedProfile.display_name,
        action, // 'typing' | 'voice' | 'stop'
      },
    }).catch(() => {});
  };

  // Live Realtime + Presence (instant online/offline + live typing/voice!)
  window.__cloudConnectRealtime = async (onEvent, onBanner) => {
    wsEmit = onEvent;
    if (realtimeChannel) {
      try { sb.removeChannel(realtimeChannel); } catch {}
    }
    const me = await getCurrentProfile();
    const myId = me?.id || 'anon';

    realtimeChannel = sb.channel('messenger-b-live-v9', {
      config: { presence: { key: myId }, broadcast: { self: false } },
    })
      .on('presence', { event: 'sync' }, () => {
        const stateObj = realtimeChannel.presenceState();
        presenceReady = true;
        onlinePresenceIds = new Set(Object.keys(stateObj || {}));
        wsEmit('presence:sync', { onlineIds: Array.from(onlinePresenceIds) });
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key) {
          onlinePresenceIds.delete(key);
          wsEmit('presence:update', { userId: key, online: false, lastSeen: Date.now() });
        }
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        if (key) {
          onlinePresenceIds.add(key);
          wsEmit('presence:update', { userId: key, online: true, lastSeen: Date.now() });
        }
      })
      .on('broadcast', { event: 'activity' }, ({ payload }) => {
        if (!payload || !payload.chatId || payload.userId === myId) return;
        wsEmit('activity:update', payload);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const cur = await getCurrentProfile();
        if (!cur) return;
        const [enriched] = await enrichMessages([payload.new], cur.id);
        if (enriched) wsEmit('message:new', { chatId: enriched.chatId, message: enriched });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, async (payload) => {
        const cur = await getCurrentProfile();
        if (!cur) return;
        if (payload.new.deleted_at) {
          wsEmit('message:deleted', { chatId: payload.new.chat_id, messageId: payload.new.id });
        } else {
          const [enriched] = await enrichMessages([payload.new], cur.id);
          if (enriched) wsEmit('message:updated', { chatId: enriched.chatId, message: enriched });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, async (payload) => {
        const msgId = payload.new?.message_id || payload.old?.message_id;
        if (!msgId) return;
        const cur = await getCurrentProfile();
        if (!cur) return;
        const { data: msg } = await sb.from('messages').select('*').eq('id', msgId).maybeSingle();
        if (!msg) return;
        const [enriched] = await enrichMessages([msg], cur.id);
        if (enriched) wsEmit('message:reaction', { chatId: msg.chat_id, messageId: msgId, reactions: enriched.reactions });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, () => wsEmit('user:updated', {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, () => wsEmit('user:updated', {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => wsEmit('friends:updated', {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_items' }, () => wsEmit('schedule:updated', {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_items' }, () => wsEmit('homework:updated', {}))
            .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          onBanner(false);
          if (me?.id) {
            await realtimeChannel.track({ userId: me.id, onlineAt: Date.now() }).catch(() => {});
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          presenceReady = false;
          onlinePresenceIds.clear();
          wsEmit('presence:sync', { onlineIds: [] });
          onBanner(true, 'Переподключение к облаку...');
        }
      });

    // Cleanly untrack & save exact last_seen when user leaves/closes tab!
    const markOfflineNow = () => {
      if (realtimeChannel) {
        try { realtimeChannel.untrack(); } catch {}
      }
      if (me?.id) {
        sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', me.id).then(() => {});
      }
    };
    window.removeEventListener('pagehide', window.__mbPageHide);
    window.__mbPageHide = markOfflineNow;
    window.addEventListener('pagehide', markOfflineNow);

    // Re-track when returning to tab
    document.removeEventListener('visibilitychange', window.__mbVisChange);
    window.__mbVisChange = () => {
      if (document.visibilityState === 'visible' && realtimeChannel && me?.id) {
        realtimeChannel.track({ userId: me.id, onlineAt: Date.now() }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', window.__mbVisChange);

    if (window.__mbPresenceHeartbeat) clearInterval(window.__mbPresenceHeartbeat);
    window.__mbPresenceHeartbeat = setInterval(() => {
      if (me?.id && document.visibilityState !== 'prerender') {
        sb.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', me.id).then(() => {});
      }
    }, 25_000);
  };

  // ==================== FETCH INTERCEPTOR ====================
  window.fetch = async (input, init = {}) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    if (!urlStr.startsWith('/api/')) return nativeFetch(input, init);

    const urlObj = new URL(urlStr, location.origin);
    const pathname = urlObj.pathname;
    const query = Object.fromEntries(urlObj.searchParams.entries());
    const method = (init.method || 'GET').toUpperCase();
    let body = {};
    if (init.body && typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch {}
    }

    try {
      if (method === 'GET' && pathname === '/api/config') {
        const ordered = await getClassesList();
        const def = ordered[0];
        return jsonRes({ defaultClass: def?.name || '7Б', defaultClassId: def?.id || 1, classes: ordered, isFirstUserSetup: false, maxUploadMb: 25 });
      }

      if (method === 'POST' && pathname === '/api/auth/register') {
        const { data, error } = await sb.auth.signUp({
          email: String(body.email || '').trim().toLowerCase(),
          password: String(body.password || ''),
          options: {
            data: {
              username: String(body.username || '').trim().toLowerCase().replace(/^@/, ''),
              display_name: String(body.displayName || '').trim(),
              requested_role: 'student',
            },
          },
        });
        if (error) {
          const msg = /already registered/i.test(error.message)
            ? 'Эта почта уже зарегистрирована — перейдите на вкладку «Вход»'
            : error.message;
          return jsonRes({ error: msg }, 400);
        }
        if (!data.session) {
          return jsonRes({ error: 'Отключите "Confirm email" в Supabase → Authentication → Providers → Email' }, 400);
        }
        invalidateProfileCache();
        const me = await getCurrentProfile(true);
        return jsonRes({ user: formatProfile(me), settings: formatSettings(null) }, 201);
      }

      if (method === 'POST' && pathname === '/api/auth/login') {
        const email = String(body.identifier || '').trim().toLowerCase();
        if (!email.includes('@')) return jsonRes({ error: 'Для входа используйте email. @username предназначен для поиска пользователей.' }, 401);
        const { error } = await sb.auth.signInWithPassword({ email, password: String(body.password || '') });
        if (error) {
          const msg = /email not confirmed/i.test(error.message)
            ? 'Подтвердите email или отключите Confirm email в настройках Supabase Authentication'
            : 'Неверная почта/логин или пароль';
          return jsonRes({ error: msg }, 401);
        }
        invalidateProfileCache();
        const me = await getCurrentProfile(true);
        if (!me) return jsonRes({ error: 'Ошибка профиля: ' + (lastProfileError || 'выполните SQL-скрипт в Supabase') }, 500);
        const { data: s } = await sb.from('user_settings').select('*').eq('user_id', me.id).maybeSingle();
        return jsonRes({ user: formatProfile(me), settings: formatSettings(s) });
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        if (realtimeChannel) { try { realtimeChannel.untrack(); } catch {} }
        invalidateProfileCache();
        await sb.auth.signOut();
        return jsonRes({ ok: true });
      }

      const me = await getCurrentProfile();
      if (!me) return jsonRes({ error: 'Требуется авторизация' }, 401);

      if (method === 'GET' && pathname === '/api/auth/me') {
        const [{ data: s }, { data: blk }, ordered] = await Promise.all([
          sb.from('user_settings').select('*').eq('user_id', me.id).maybeSingle(),
          sb.from('blocked_users').select('blocked_id').eq('blocker_id', me.id),
          getClassesList(),
          refreshFriendIds(me.id),
        ]);
        return jsonRes({
          user: formatProfile(me),
          settings: formatSettings(s),
          blockedIds: (blk || []).map((b) => b.blocked_id),
          classes: ordered,
          defaultClass: '7Б',
        });
      }

      if (method === 'POST' && pathname === '/api/auth/change-password') {
        const { error } = await sb.auth.updateUser({ password: String(body.newPassword || '') });
        if (error) return jsonRes({ error: error.message }, 400);
        return jsonRes({ ok: true });
      }

      if (method === 'GET' && pathname === '/api/auth/sessions') {
        return jsonRes({ sessions: [{ id: 'current', deviceInfo: navigator.userAgent.slice(0, 65), lastActiveAt: Date.now(), isCurrent: true }] });
      }

      if (method === 'PATCH' && pathname === '/api/profile') {
        const { error } = await sb.from('profiles').update({
          display_name: body.displayName,
          username: String(body.username || '').toLowerCase().replace(/^@/, ''),
          bio: body.bio || '',
          status_emoji: body.statusEmoji || '',
          avatar_color: body.avatarColor || '#2AABEE',
        }).eq('id', me.id);
        if (error) return jsonRes({ error: error.message }, 400);
        invalidateProfileCache();
        return jsonRes({ user: formatProfile(await getCurrentProfile(true)) });
      }

      if (method === 'POST' && pathname === '/api/profile/avatar') {
        const file = init.body.get('avatar');
        const ext = (file.name.split('.').pop() || 'png').slice(0, 8);
        const pathKey = `avatars/${me.id}_${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('messenger-files').upload(pathKey, file, { upsert: true });
        if (error) return jsonRes({ error: error.message }, 400);
        const { data: pub } = sb.storage.from('messenger-files').getPublicUrl(pathKey);
        await sb.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', me.id);
        invalidateProfileCache();
        return jsonRes({ avatarUrl: pub.publicUrl, user: formatProfile(await getCurrentProfile(true)) });
      }

      if (method === 'PATCH' && pathname === '/api/settings') {
        const patch = {};
        if (body.theme) patch.theme = body.theme;
        if (body.accent) patch.accent = body.accent;
        if (body.wallpaper) patch.wallpaper = body.wallpaper;
        if (body.fontSize) patch.font_size = Number(body.fontSize);
        if (body.bubbleRadius) patch.bubble_radius = Number(body.bubbleRadius);
        if (body.bubbleStyle) patch.bubble_style = body.bubbleStyle;
        if (typeof body.compactMode === 'boolean') patch.compact_mode = body.compactMode;
        if (typeof body.animationsEnabled === 'boolean') patch.animations_enabled = body.animationsEnabled;
        if (typeof body.largeEmojis === 'boolean') patch.large_emojis = body.largeEmojis;
        if (typeof body.sendOnEnter === 'boolean') patch.send_on_enter = body.sendOnEnter;
        if (typeof body.soundEnabled === 'boolean') patch.sound_enabled = body.soundEnabled;
        if (typeof body.desktopNotifications === 'boolean') patch.desktop_notifications = body.desktopNotifications;
        if (typeof body.hideNotifPreview === 'boolean') patch.hide_notif_preview = body.hideNotifPreview;
        if (body.showLastSeen) patch.show_last_seen = body.showLastSeen;
        if (typeof body.showTyping === 'boolean') patch.show_typing = body.showTyping;
        if (body.allowDm) patch.allow_dm = body.allowDm;
        if (body.allowGroupAdd) patch.allow_group_add = body.allowGroupAdd;
        if (body.allowFriendRequests) patch.allow_friend_requests = body.allowFriendRequests;
        if (typeof body.showReadReceipts === 'boolean') patch.show_read_receipts = body.showReadReceipts;
        if (body.removeAppLockPin) patch.app_lock_pin = null;
        else if (body.appLockPin) patch.app_lock_pin = String(body.appLockPin);

        const { data } = await sb.from('user_settings').upsert({ user_id: me.id, ...patch }).select('*').maybeSingle();
        return jsonRes({ settings: formatSettings(data) });
      }

      if (method === 'POST' && pathname === '/api/settings/verify-pin') {
        const { data } = await sb.from('user_settings').select('app_lock_pin').eq('user_id', me.id).maybeSingle();
        return jsonRes({ valid: !data?.app_lock_pin || data.app_lock_pin === String(body.pin || '') });
      }

      // Web Push subscription storage. The VAPID private key lives only in Supabase Edge Function secrets.
      if (method === 'POST' && pathname === '/api/push/subscription') {
        const endpoint = String(body.endpoint || '').trim();
        const p256dh = String(body.keys?.p256dh || '').trim();
        const authKey = String(body.keys?.auth || '').trim();
        let endpointUrl;
        try { endpointUrl = new URL(endpoint); } catch { return jsonRes({ error: 'Некорректный push endpoint' }, 400); }
        if (endpointUrl.protocol !== 'https:' || !p256dh || !authKey) return jsonRes({ error: 'Некорректная push-подписка' }, 400);
        const { error } = await sb.from('push_subscriptions').upsert({ user_id: me.id, endpoint, p256dh, auth: authKey, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
        if (error) return jsonRes({ error: error.message }, 400);
        return jsonRes({ ok: true }, 201);
      }
      if (method === 'DELETE' && pathname === '/api/push/subscription') {
        const endpoint = String(body.endpoint || '').trim();
        if (endpoint) await sb.from('push_subscriptions').delete().eq('user_id', me.id).eq('endpoint', endpoint);
        return jsonRes({ ok: true });
      }
      if (method === 'POST' && pathname === '/api/push/test') {
        const { data, error } = await sb.functions.invoke('send-web-push', { body: { test: true } });
        if (error) return jsonRes({ error: error.message || 'Не удалось вызвать Push Function' }, 502);
        return jsonRes(data || { ok: true });
      }

      if (method === 'GET' && pathname === '/api/privacy/blocked') {
        const [{ data: blk }, cmap] = await Promise.all([
          sb.from('blocked_users').select('blocked_id').eq('blocker_id', me.id),
          getClassesMap(),
        ]);
        const ids = (blk || []).map((b) => b.blocked_id);
        if (ids.length === 0) return jsonRes({ blocked: [] });
        const { data: profs } = await sb.from('profiles').select(PROFILE_COLUMNS).in('id', ids);
        return jsonRes({ blocked: await formatProfiles(profs || [], cmap) });
      }

      let m;
      if (method === 'POST' && (m = pathname.match(/^\/api\/privacy\/block\/([^/]+)$/))) {
        await sb.from('blocked_users').upsert({ blocker_id: me.id, blocked_id: m[1] });
        return jsonRes({ ok: true });
      }
      if (method === 'DELETE' && (m = pathname.match(/^\/api\/privacy\/block\/([^/]+)$/))) {
        await sb.from('blocked_users').delete().eq('blocker_id', me.id).eq('blocked_id', m[1]);
        return jsonRes({ ok: true });
      }

      // ==================== FRIENDS & PRIVATE @USERNAME SEARCH ====================
      if (method === 'GET' && pathname === '/api/friends') {
        const [rows, cmap] = await Promise.all([refreshFriendIds(me.id), getClassesMap()]);
        const otherIds = [...new Set(rows.map((r) => (r.requester_id === me.id ? r.addressee_id : r.requester_id)))];
        const { data: profs } = otherIds.length ? await sb.from('profiles').select(PROFILE_COLUMNS).in('id', otherIds) : { data: [] };
        const formatted = await formatProfiles(profs || [], cmap);
        const pMap = new Map(formatted.map((p) => [p.id, p]));

        const friends = [];
        const incoming = [];
        const outgoing = [];
        for (const r of rows) {
          const otherId = r.requester_id === me.id ? r.addressee_id : r.requester_id;
          const u = pMap.get(otherId);
          if (!u) continue;
          if (r.status === 'accepted') friends.push({ friendshipId: r.id, user: u });
          else if (r.addressee_id === me.id) incoming.push({ friendshipId: r.id, user: u });
          else outgoing.push({ friendshipId: r.id, user: u });
        }
        return jsonRes({ friends, incoming, outgoing });
      }

      if (method === 'GET' && pathname === '/api/users/search') {
        const q = String(query.q || '').trim().replace(/^@/, '');
        if (q.length < 2) return jsonRes({ user: null });
        const { data, error } = await sb.rpc('search_user_by_username', { p_username: q });
        if (error || !data || data.length === 0) return jsonRes({ user: null });
        return jsonRes({ user: (await formatProfiles(data, await getClassesMap()))[0] || null });
      }

      if (method === 'POST' && pathname === '/api/friends/request') {
        const targetId = body.userId;
        if (!targetId || targetId === me.id) return jsonRes({ error: 'Некорректный пользователь' }, 400);
        // Check if reverse pending request exists -> auto-accept!
        const { data: rev } = await sb.from('friendships').select('*').eq('requester_id', targetId).eq('addressee_id', me.id).maybeSingle();
        if (rev) {
          await sb.from('friendships').update({ status: 'accepted' }).eq('id', rev.id);
          await refreshFriendIds(me.id);
          return jsonRes({ status: 'accepted' });
        }
        const { error } = await sb.from('friendships').insert({ requester_id: me.id, addressee_id: targetId, status: 'pending' });
        if (error) return jsonRes({ error: error.message }, 400);
        return jsonRes({ status: 'pending' }, 201);
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/friends\/(\d+)\/accept$/))) {
        await sb.from('friendships').update({ status: 'accepted' }).eq('id', Number(m[1])).eq('addressee_id', me.id);
        await refreshFriendIds(me.id);
        return jsonRes({ ok: true });
      }

      if (method === 'DELETE' && (m = pathname.match(/^\/api\/friends\/(\d+)$/))) {
        await sb.from('friendships').delete().eq('id', Number(m[1]));
        await refreshFriendIds(me.id);
        return jsonRes({ ok: true });
      }

      // Users (strictly scoped: admin sees all; others see ONLY classmates + friends + admins — NO strangers!)
      if (method === 'GET' && pathname === '/api/users') {
        const [cmap] = await Promise.all([getClassesMap(), refreshFriendIds(me.id)]);
        let q = sb.from('profiles').select(PROFILE_COLUMNS).order('display_name');
        if (me.role !== 'admin') {
          const friendArr = Array.from(cachedFriendIds);
          const filters = [`class_id.eq.${me.class_id}`, 'role.eq.admin'];
          if (friendArr.length > 0) filters.push(`id.in.(${friendArr.join(',')})`);
          q = q.or(filters.join(','));
        }
        const { data } = await q;
        return jsonRes({ users: await formatProfiles(data || [], cmap) });
      }

      if (method === 'POST' && pathname === '/api/admin/classes') {
        const { error } = await sb.rpc('admin_add_class', { p_name: body.name });
        if (error) return jsonRes({ error: error.message }, 403);
        invalidateClassesCache();
        return jsonRes({ classes: await getClassesList(true) }, 201);
      }

      if (method === 'PATCH' && (m = pathname.match(/^\/api\/admin\/users\/([^/]+)\/class$/))) {
        const { error } = await sb.rpc('admin_change_user_class', { p_target_id: m[1], p_class_id: Number(body.classId) });
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true });
      }

      if (method === 'PATCH' && (m = pathname.match(/^\/api\/manage\/users\/([^/]+)\/role$/))) {
        const { error } = await sb.rpc('manage_change_user_role', { p_target_id: m[1], p_role: body.role });
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true });
      }

      if (method === 'GET' && pathname === '/api/manage/stats') {
        if (me.role === 'admin') {
          const [u, c, t, msgs, hw] = await Promise.all([
            sb.from('profiles').select('id', { count: 'exact', head: true }),
            sb.from('classes').select('*', { count: 'exact', head: true }),
            sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'teacher'),
            sb.from('messages').select('*', { count: 'exact', head: true }).is('deleted_at', null),
            sb.from('homework_items').select('*', { count: 'exact', head: true }),
          ]);
          return jsonRes({ scope: 'school', scopeLabel: 'Вся школа', online: Math.max(onlinePresenceIds.size, 1), users: u.count || 0, classes: c.count || 0, teachers: t.count || 0, messages: msgs.count || 0, homework: hw.count || 0 });
        }
        if (me.role === 'teacher') {
          const [u, l, hw] = await Promise.all([
            sb.from('profiles').select('id').eq('class_id', me.class_id),
            sb.from('profiles').select('id', { count: 'exact', head: true }).eq('class_id', me.class_id).eq('role', 'leader'),
            sb.from('homework_items').select('*', { count: 'exact', head: true }).eq('class_id', me.class_id),
          ]);
          const classIds = (u.data || []).map((x) => x.id);
          const classOnline = classIds.filter((id) => onlinePresenceIds.has(id)).length;
          return jsonRes({ scope: 'class', scopeLabel: `Класс ${me.className}`, online: Math.max(classOnline, 1), users: classIds.length, leaders: l.count || 0, messages: '—', homework: hw.count || 0 });
        }
        return jsonRes({ error: 'Нет доступа' }, 403);
      }

      // ==================== CHATS & ADD GROUP MEMBERS ====================
      if (method === 'GET' && pathname === '/api/chats') {
        return jsonRes({ chats: await buildChatSummaries(me) });
      }

      if (method === 'POST' && pathname === '/api/chats/dm') {
        const { data: chatId, error } = await sb.rpc('create_or_get_dm', { p_target_id: body.userId });
        if (error) return jsonRes({ error: error.message }, 403);
        const chats = await buildChatSummaries(me);
        return jsonRes({ chat: chats.find((c) => c.id === chatId), created: true }, 201);
      }

      if (method === 'POST' && pathname === '/api/chats/group') {
        const { data: chatId, error } = await sb.rpc('create_group_chat', { p_title: body.title, p_description: body.description || '', p_member_ids: body.memberIds || [] });
        if (error) return jsonRes({ error: error.message }, 400);
        const chats = await buildChatSummaries(me);
        return jsonRes({ chat: chats.find((c) => c.id === chatId) }, 201);
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/chats\/(\d+)\/members$/))) {
        const { error } = await sb.rpc('add_group_member', { p_chat_id: Number(m[1]), p_user_id: body.userId });
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true }, 201);
      }

      if (method === 'GET' && (m = pathname.match(/^\/api\/chats\/(\d+)\/members$/))) {
        const chatId = Number(m[1]);
        const [myMembership, memsRes, cmap] = await Promise.all([
          sb.from('chat_members').select('chat_id').eq('chat_id', chatId).eq('user_id', me.id).maybeSingle(),
          sb.from('chat_members').select('role, profiles(id, username, display_name, role, class_id, bio, status_emoji, avatar_url, avatar_color, created_at)').eq('chat_id', chatId),
          getClassesMap(),
        ]);
        if (!myMembership.data) return jsonRes({ error: 'Нет доступа к чату' }, 403);
        const rows = memsRes.data || [];
        const formatted = await formatProfiles(rows.map((x) => x.profiles).filter(Boolean), cmap);
        const byId = new Map(formatted.map((p) => [p.id, p]));
        return jsonRes({ members: rows.map((x) => ({ ...(byId.get(x.profiles?.id) || formatProfile(x.profiles, cmap)), memberRole: x.role })) });
      }

      if (method === 'GET' && (m = pathname.match(/^\/api\/chats\/(\d+)$/))) {
        const chatId = Number(m[1]);
        const [chats, memsRes, cmap] = await Promise.all([
          buildChatSummaries(me),
          sb.from('chat_members').select('role, profiles(id, username, display_name, role, class_id, bio, status_emoji, avatar_url, avatar_color, created_at)').eq('chat_id', chatId),
          getClassesMap(),
        ]);
        const chat = chats.find((c) => c.id === chatId);
        if (!chat) return jsonRes({ error: 'Нет доступа' }, 403);
        const formattedMembers = await formatProfiles((memsRes.data || []).map((x) => x.profiles), cmap);
        const memberProfiles = new Map(formattedMembers.map((p) => [p.id, p]));
        return jsonRes({ chat, members: (memsRes.data || []).map((x) => ({ ...(memberProfiles.get(x.profiles?.id) || formatProfile(x.profiles, cmap)), memberRole: x.role })) });
      }

      if (method === 'PATCH' && (m = pathname.match(/^\/api\/chats\/(\d+)$/))) {
        const chatId = Number(m[1]);
        const patch = {};
        if (typeof body.muted === 'boolean') patch.muted = body.muted;
        if (typeof body.pinned === 'boolean') patch.pinned_chat = body.pinned;
        if (!Object.keys(patch).length) return jsonRes({ ok: true });
        const { error } = await sb.from('chat_members').update(patch).eq('chat_id', chatId).eq('user_id', me.id);
        if (error) return jsonRes({ error: error.message || 'Не удалось сохранить настройку чата' }, 400);
        return jsonRes({ ok: true });
      }

      if (method === 'DELETE' && (m = pathname.match(/^\/api\/chats\/(\d+)\/members\/([^/]+)$/))) {
        await sb.from('chat_members').delete().eq('chat_id', Number(m[1])).eq('user_id', m[2]);
        return jsonRes({ ok: true });
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/chats\/(\d+)\/read$/))) {
        if (body.messageId) {
          sb.from('chat_members').update({ last_read_message_id: Number(body.messageId) }).eq('chat_id', Number(m[1])).eq('user_id', me.id).then(() => {});
        }
        return jsonRes({ ok: true });
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/chats\/(\d+)\/pin$/))) {
        const msgId = body.messageId ? Number(body.messageId) : null;
        await sb.from('chats').update({ pinned_message_id: msgId }).eq('id', Number(m[1]));
        const pm = msgId ? { id: msgId, senderName: 'Закреплено', content: 'Нажмите, чтобы перейти к сообщению' } : null;
        wsEmit('chat:pinned_message', { chatId: Number(m[1]), pinnedMessage: pm });
        return jsonRes({ pinnedMessage: pm });
      }

      // ==================== MESSAGES & MESSAGE INFO ("ДАННЫЕ") ====================
      if (method === 'GET' && (m = pathname.match(/^\/api\/messages\/(\d+)\/info$/))) {
        const msgId = Number(m[1]);
        const { data: msg } = await sb.from('messages').select('id, chat_id, sender_id, created_at').eq('id', msgId).maybeSingle();
        if (!msg) return jsonRes({ error: 'Сообщение не найдено' }, 404);

        const [readRes, reactRes, cmap] = await Promise.all([
          sb.rpc('get_message_readers', { p_message_id: msgId }),
          sb.from('message_reactions').select('emoji, user_id, profiles(id, username, display_name, role, class_id, bio, status_emoji, avatar_url, avatar_color, created_at)').eq('message_id', msgId),
          getClassesMap(),
        ]);
        if (readRes.error) return jsonRes({ error: readRes.error.message }, 403);
        const readBy = await formatProfiles(readRes.data || [], cmap);
        const reactionRows = reactRes.data || [];
        const reactionProfiles = await formatProfiles(reactionRows.map((r) => r.profiles).filter(Boolean), cmap);
        const profileMap = new Map(reactionProfiles.map((p) => [p.id, p]));
        const reactGroups = new Map();
        for (const r of reactionRows) {
          const profile = profileMap.get(r.user_id);
          if (!profile) continue;
          if (!reactGroups.has(r.emoji)) reactGroups.set(r.emoji, []);
          reactGroups.get(r.emoji).push(profile);
        }
        const reactions = Array.from(reactGroups.entries()).map(([emoji, users]) => ({ emoji, users }));
        return jsonRes({ readBy, reactions, createdAt: toMs(msg.created_at) });
      }

      if (method === 'GET' && (m = pathname.match(/^\/api\/chats\/(\d+)\/messages$/))) {
        const chatId = Number(m[1]);
        const limit = Number(query.limit) || 40;
        let q = sb.from('messages').select('*').eq('chat_id', chatId).order('id', { ascending: false }).limit(limit + 1);
        if (query.before) q = q.lt('id', Number(query.before));
        if (query.q) q = q.is('deleted_at', null).ilike('content', `%${query.q}%`);
        const { data, error } = await q;
        if (error) return jsonRes({ error: error.message }, 403);
        const rows = data || [];
        const hasMore = !query.q && rows.length > limit;
        const sliced = (hasMore ? rows.slice(0, limit) : rows).reverse();
        return jsonRes({ messages: await enrichMessages(sliced, me.id), hasMore });
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/chats\/(\d+)\/upload$/))) {
        const file = init.body.get('file');
        const ext = (file.name.split('.').pop() || 'bin').slice(0, 10);
        const pathKey = `chat_${m[1]}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await sb.storage.from('messenger-files').upload(pathKey, file);
        if (error) return jsonRes({ error: error.message }, 400);
        const { data: pub } = sb.storage.from('messenger-files').getPublicUrl(pathKey);
        const att = { id: pub.publicUrl, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, url: pub.publicUrl };
        window.__lastUploadedAtt = att;
        return jsonRes({ attachment: att }, 201);
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/chats\/(\d+)\/messages$/))) {
        const chatId = Number(m[1]);
        const att = body.attachmentId && window.__lastUploadedAtt?.id === body.attachmentId ? window.__lastUploadedAtt : null;
        let msgType = 'text';
        if (body.poll) msgType = 'poll';
        else if (att) {
          if (body.msgType === 'voice' || att.mimeType.startsWith('audio/')) msgType = 'voice';
          else if (att.mimeType.startsWith('image/')) msgType = 'image';
          else msgType = 'file';
        }
        const { data: inserted, error } = await sb.from('messages').insert({
          chat_id: chatId,
          sender_id: me.id,
          content: msgType === 'poll' ? body.poll.question : (body.content || ''),
          msg_type: msgType,
          reply_to_id: body.replyToId || null,
          forwarded_from_name: body.forwardedFrom || null,
          attachment_url: att?.url || null,
          attachment_name: att?.name || null,
          attachment_mime: att?.mimeType || null,
          attachment_size: att?.size || null,
          voice_duration: body.voiceDuration || null,
        }).select('*').maybeSingle();
        if (error || !inserted) return jsonRes({ error: 'Нет прав отправлять сообщения в этот чат' }, 403);

        if (sb.functions?.invoke) {
          sb.functions.invoke('send-web-push', { body: { messageId: inserted.id } })
            .then(({ data: pushData, error: pushError }) => {
              if (pushError) console.warn('[Push] Edge Function call failed:', pushError.message);
              else console.info('[Push] send-web-push result:', pushData);
            })
            .catch((pushError) => console.warn('[Push] Edge Function call failed:', pushError?.message || pushError));
        }

        if (msgType === 'poll') {
          await sb.from('polls').insert({
            message_id: inserted.id,
            question: body.poll.question,
            options: body.poll.options,
            allow_multiple: Boolean(body.poll.allowMultiple),
            is_anonymous: Boolean(body.poll.isAnonymous),
          });
          const [enriched] = await enrichMessages([inserted], me.id);
          return jsonRes({ message: enriched }, 201);
        }

        if (body.replyToId) {
          const [full] = await enrichMessages([inserted], me.id);
          return jsonRes({ message: full }, 201);
        }

        const fastMsg = {
          id: inserted.id,
          chatId: inserted.chat_id,
          senderId: me.id,
          sender: {
            id: me.id, username: me.username, displayName: me.display_name, role: me.role,
            avatarUrl: me.avatar_url, avatarColor: me.avatar_color, statusEmoji: me.status_emoji || '',
          },
          content: inserted.content,
          msgType: inserted.msg_type,
          replyTo: null,
          forwardedFrom: inserted.forwarded_from_name || null,
          attachment: inserted.attachment_url ? {
            id: inserted.id, name: inserted.attachment_name || 'Файл', mimeType: inserted.attachment_mime || 'application/octet-stream',
            size: inserted.attachment_size || 0, url: inserted.attachment_url,
          } : null,
          voiceDuration: inserted.voice_duration,
          poll: null,
          reactions: [],
          editedAt: null,
          deleted: false,
          isRead: true,
          createdAt: toMs(inserted.created_at),
        };
        return jsonRes({ message: fastMsg }, 201);
      }

      if (method === 'PATCH' && (m = pathname.match(/^\/api\/messages\/(\d+)$/))) {
        const { data, error } = await sb.from('messages').update({ content: body.content, edited_at: new Date().toISOString() }).eq('id', Number(m[1])).select('*').maybeSingle();
        if (error || !data) return jsonRes({ error: error?.message || 'Ошибка' }, 403);
        const [enriched] = await enrichMessages([data], me.id);
        return jsonRes({ message: enriched });
      }

      if (method === 'DELETE' && (m = pathname.match(/^\/api\/messages\/(\d+)$/))) {
        const { error } = await sb.from('messages').update({ deleted_at: new Date().toISOString(), content: '' }).eq('id', Number(m[1]));
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true });
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/messages\/(\d+)\/reactions$/))) {
        const msgId = Number(m[1]);
        const { data: ex } = await sb.from('message_reactions').select('*').eq('message_id', msgId).eq('user_id', me.id).eq('emoji', body.emoji);
        if (ex && ex.length > 0) await sb.from('message_reactions').delete().eq('message_id', msgId).eq('user_id', me.id).eq('emoji', body.emoji);
        else await sb.from('message_reactions').insert({ message_id: msgId, user_id: me.id, emoji: body.emoji });
        return jsonRes({ ok: true });
      }

      if (method === 'POST' && (m = pathname.match(/^\/api\/polls\/(\d+)\/vote$/))) {
        const pollId = Number(m[1]);
        const idx = Number(body.optionIndex);
        const { data: pollRow } = await sb.from('polls').select('allow_multiple').eq('id', pollId).maybeSingle();
        const { data: ex } = await sb.from('poll_votes').select('*').eq('poll_id', pollId).eq('user_id', me.id).eq('option_index', idx);
        if (ex && ex.length > 0) {
          await sb.from('poll_votes').delete().eq('poll_id', pollId).eq('user_id', me.id).eq('option_index', idx);
        } else {
          if (pollRow && !pollRow.allow_multiple) {
            await sb.from('poll_votes').delete().eq('poll_id', pollId).eq('user_id', me.id);
          }
          await sb.from('poll_votes').insert({ poll_id: pollId, user_id: me.id, option_index: idx });
        }
        return jsonRes({ ok: true });
      }

      // Schedule & Homework
      if (method === 'GET' && pathname === '/api/schedule') {
        const cid = (me.role === 'admin' && Number(query.classId)) ? Number(query.classId) : me.class_id;
        const { data } = await sb.from('schedule_items').select('*').eq('class_id', cid).order('day_of_week').order('lesson_number');
        return jsonRes({ items: data || [], classId: cid });
      }
      if (method === 'POST' && pathname === '/api/schedule') {
        const cid = (me.role === 'admin' && Number(body.classId)) ? Number(body.classId) : me.class_id;
        const { data, error } = await sb.from('schedule_items').insert({
          class_id: cid, day_of_week: body.dayOfWeek, lesson_number: body.lessonNumber,
          subject: body.subject, start_time: body.startTime || '', end_time: body.endTime || '',
          room: body.room || '', teacher: body.teacher || '', notes: body.notes || '', updated_by: me.id,
        }).select('*').maybeSingle();
        if (error) return jsonRes({ error: 'Нет прав редактировать расписание' }, 403);
        return jsonRes({ item: data }, 201);
      }
      if (method === 'PATCH' && (m = pathname.match(/^\/api\/schedule\/(\d+)$/))) {
        const { error } = await sb.from('schedule_items').update({
          day_of_week: body.dayOfWeek, lesson_number: body.lessonNumber, subject: body.subject,
          start_time: body.startTime, end_time: body.endTime, room: body.room, teacher: body.teacher, notes: body.notes,
        }).eq('id', Number(m[1]));
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true });
      }
      if (method === 'DELETE' && (m = pathname.match(/^\/api\/schedule\/(\d+)$/))) {
        const { error } = await sb.from('schedule_items').delete().eq('id', Number(m[1]));
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true });
      }

      if (method === 'GET' && pathname === '/api/homework') {
        const cid = (me.role === 'admin' && Number(query.classId)) ? Number(query.classId) : me.class_id;
        const [{ data: items }, { data: prog }] = await Promise.all([
          sb.from('homework_items').select('*').eq('class_id', cid).order('due_date'),
          sb.from('homework_progress').select('homework_id, completed').eq('user_id', me.id),
        ]);
        const doneSet = new Set((prog || []).filter((p) => p.completed).map((p) => p.homework_id));
        return jsonRes({
          classId: cid,
          items: (items || []).map((h) => ({
            id: h.id, classId: h.class_id, subject: h.subject, title: h.title,
            description: h.description, dueDate: h.due_date, priority: h.priority,
            completed: doneSet.has(h.id), createdAt: toMs(h.created_at),
          })),
        });
      }
      if (method === 'POST' && pathname === '/api/homework') {
        const cid = (me.role === 'admin' && Number(body.classId)) ? Number(body.classId) : me.class_id;
        const { data, error } = await sb.from('homework_items').insert({
          class_id: cid, subject: body.subject, title: body.title, description: body.description || '',
          due_date: body.dueDate, priority: body.priority || 'normal', created_by: me.id,
        }).select('*').maybeSingle();
        if (error) return jsonRes({ error: 'Нет прав добавлять ДЗ' }, 403);
        return jsonRes({ item: data }, 201);
      }
      if (method === 'PATCH' && (m = pathname.match(/^\/api\/homework\/(\d+)$/))) {
        const { error } = await sb.from('homework_items').update({
          subject: body.subject, title: body.title, description: body.description, due_date: body.dueDate, priority: body.priority,
        }).eq('id', Number(m[1]));
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true });
      }
      if (method === 'DELETE' && (m = pathname.match(/^\/api\/homework\/(\d+)$/))) {
        const { error } = await sb.from('homework_items').delete().eq('id', Number(m[1]));
        if (error) return jsonRes({ error: error.message }, 403);
        return jsonRes({ ok: true });
      }
      if (method === 'POST' && (m = pathname.match(/^\/api\/homework\/(\d+)\/toggle$/))) {
        const id = Number(m[1]);
        const { data: ex, error: readError } = await sb.from('homework_progress').select('completed').eq('homework_id', id).eq('user_id', me.id).maybeSingle();
        if (readError) return jsonRes({ error: readError.message }, 400);
        const next = !Boolean(ex?.completed);
        const { error: writeError } = await sb.from('homework_progress').upsert({ homework_id: id, user_id: me.id, completed: next });
        if (writeError) return jsonRes({ error: writeError.message || 'Не удалось сохранить выполнение ДЗ' }, 400);
        return jsonRes({ completed: next });
      }

      return jsonRes({ error: 'Неизвестный маршрут' }, 404);
    } catch (err) {
      return jsonRes({ error: err.message || 'Ошибка облака' }, 500);
    }
  };
})();
