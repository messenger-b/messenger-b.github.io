(() => {
  'use strict';

  const QUICK_REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '👏'];
  const EMOJI_CATS = {
    popular: ['😂', '❤️', '🔥', '👍', '😭', '😍', '🙏', '✨', '😎', '🤝', '🎉', '💀', '👀', '💯', '👌', '😅'],
    faces: ['😀', '😃', '😄', '😁', '😆', '🥹', '😊', '🙂', '😉', '😌', '🥰', '😘', '😋', '😜', '🤪', '🤨', '🧐', '🤓', '🥳', '😏', '😒', '😔', '😢', '😡'],
    gestures: ['👍', '👎', '👏', '🙌', '👐', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👌', '🤌', '👋', '💪'],
    study: ['📚', '📖', '✏️', '🖊️', '📝', '📐', '📏', '🧮', '🔬', '🧪', '🌍', '💻', '🎓', '🏫', '⏰', '✅'],
    symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '⭐', '🌟', '⚡', '🔥', '💥', '❗', '❓', '🏆'],
  };
  const DAYS_RU = [
    { id: 1, short: 'Пн', full: 'Понедельник' },
    { id: 2, short: 'Вт', full: 'Вторник' },
    { id: 3, short: 'Ср', full: 'Среда' },
    { id: 4, short: 'Чт', full: 'Четверг' },
    { id: 5, short: 'Пт', full: 'Пятница' },
    { id: 6, short: 'Сб', full: 'Суббота' },
  ];

  const ico = (name, size = 16, cls = '') => (window.mbIcon ? window.mbIcon(name, size, cls) : '');
  const ROLE_LABELS = { admin: 'Администратор', teacher: 'Классный руководитель', leader: 'Староста', student: 'Ученик' };
  const ROLE_SHORT = { admin: 'Админ', teacher: 'Классрук', leader: 'Староста', student: 'Ученик' };

  const state = {
    user: null,
    settings: null,
    className: '7Б',
    classes: [],
    selectedAcademicClassId: null,
    blockedIds: new Set(),
    users: [],
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
    chats: [],
    activeChatMembers: [],
    activeSection: 'chats',
    activeFolder: 'all',
    activeChatId: null,
    chatOpenToken: 0,
    messageCache: new Map(),
    chatMembersCache: new Map(),
    chatInfoToken: 0,
    pendingChatFlags: new Set(),
    homeworkPending: new Set(),
    messages: [],
    hasMoreMessages: false,
    loadingOlder: false,
    replyTo: null,
    editingMsg: null,
    activityMap: new Map(), // chatId -> Map<userId, {name, action, timer}>
    drafts: loadDrafts(),
    schedule: [],
    selectedDay: (() => { const d = new Date().getDay(); return d >= 1 && d <= 6 ? d : 1; })(),
    homework: [],
    hwFilter: 'active',
    deferredInstallPrompt: null,
    mediaRecorder: null,
    voiceChunks: [],
    voiceStartTime: 0,
    voiceTimerInterval: null,
    voiceStream: null,
    activeAudio: null,
    pomoSeconds: 25 * 60,
    pomoIsBreak: false,
    pomoTimer: null,
    grades: JSON.parse(localStorage.getItem('mb_grades') || '[]'),
    searchMode: false,
    emojiCat: 'popular',
    mentionQuery: null,
    mentionStart: -1,
    mentionIdx: 0,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ==================== HELPERS ====================
  function loadDrafts() { try { return JSON.parse(localStorage.getItem('mb_drafts') || '{}'); } catch { return {}; } }
  function saveDrafts() { try { localStorage.setItem('mb_drafts', JSON.stringify(state.drafts)); } catch {} }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isBigEmojiOnly(text) {
    if (!state.settings?.largeEmojis || !text) return false;
    const trimmed = text.trim();
    if (trimmed.length > 14) return false;
    const stripped = trimmed.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\s]/gu, '');
    return stripped.length === 0 && trimmed.length > 0;
  }

  function formatMessageHtml(text) {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/(^|[\s(])@([a-zA-Z0-9_]{3,32})\b/g, '$1<span class="mention" data-mention="$2">@$2</span>');
    return html;
  }

  function getInitials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || '?').slice(0, 2).toUpperCase();
  }

  function formatTime(ts) { return ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''; }
  function formatChatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString() ? formatTime(ts) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }
  function formatDateDivider(ts) {
    const d = new Date(ts), now = new Date(), y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
  function formatLastSeen(ts, online) {
    if (online) return 'в сети';
    if (!ts) return 'статус скрыт';
    const diffMin = Math.floor((Date.now() - ts) / 60000);
    if (diffMin < 1) return 'был(а) только что';
    if (diffMin < 60) return `был(а) ${diffMin} мин. назад`;
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return `был(а) сегодня в ${formatTime(ts)}`;
    return `был(а) ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} в ${formatTime(ts)}`;
  }
  function formatBytes(bytes) {
    if (!bytes) return '0 Б';
    const u = ['Б', 'КБ', 'МБ', 'ГБ'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
  }
  function formatSeconds(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  // ==================== AUDIO & NOTIFICATIONS ====================
  let sharedAudioCtx = null;
  function unlockAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
      if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
    } catch {}
  }
  ['click', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, unlockAudio, { passive: true }));

  function playNotificationSound() {
    try {
      unlockAudio();
      if (!sharedAudioCtx) return;
      const ctx = sharedAudioCtx;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(680, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(940, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.23);
    } catch {}
  }

  function showInAppPush(chat, message, isMention = false) {
    const el = document.createElement('div');
    el.className = 'toast push-card';
    const title = isMention
      ? `Вас упомянул(а) ${message.sender?.displayName || 'участник'}`
      : (chat?.title || message.sender?.displayName || 'Новое сообщение');
    const bodyText = state.settings?.hideNotifPreview
      ? 'Новое сообщение'
      : ((message.sender?.displayName && chat?.type !== 'dm' ? message.sender.displayName + ': ' : '') + (message.content || 'Вложение'));
    el.innerHTML = renderAvatarHtml(message.sender || chat, 'avatar-sm') +
      `<div style="min-width:0;flex:1"><div class="push-title">${escapeHtml(title)}</div><div class="push-body">${escapeHtml(bodyText)}</div></div>`;
    el.onclick = () => {
      el.remove();
      if (chat?.id) { switchSection('chats'); openChat(chat.id); }
    };
    $('#toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  async function sendSystemNotification(title, body, chatId = null) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = {
      body: state.settings?.hideNotifPreview ? 'Новое сообщение' : body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: chatId ? ('chat-' + chatId) : 'messenger-b',
      renotify: true,
      data: { chatId },
    };
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, opts);
          return;
        }
      }
    } catch {}
    try {
      const n = new Notification(title, opts);
      n.onclick = () => { window.focus(); if (chatId) { switchSection('chats'); openChat(chatId); } n.close(); };
    } catch {}
  }

  function updateNotifPromptUI() {
    const supported = 'Notification' in window;
    const perm = supported ? Notification.permission : 'unsupported';
    const dismissed = localStorage.getItem('mb_notif_dismissed') === '1';
    $('#notif-prompt-banner')?.classList.toggle('hidden', !(supported && perm === 'default' && !dismissed));
    $('#mobile-notif-btn')?.classList.toggle('hidden', !(supported && perm === 'default'));
    const statusEl = $('#notif-perm-status');
    if (statusEl) {
      statusEl.textContent = !supported
        ? 'Этот браузер не поддерживает системные уведомления'
        : perm === 'granted'
          ? 'Разрешены в браузере. Проверяем фоновую Push-подписку…'
          : perm === 'denied'
            ? 'Заблокированы в настройках браузера — разрешите для этого сайта'
            : 'Нажмите переключатель, чтобы разрешить системные уведомления';
      if (supported && perm === 'granted' && 'serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
          if (!statusEl.isConnected) return;
          const configured = Boolean(window.MESSENGER_B_CONFIG?.VAPID_PUBLIC_KEY);
          statusEl.textContent = sub
            ? 'Разрешены. Фоновая Push-подписка активна на этом устройстве'
            : configured
              ? 'Разрешены, но Push-подписка ещё не создана. Нажмите «Включить»'
              : 'Разрешены только системные уведомления открытого приложения; серверный Push ещё не настроен';
        }).catch(() => {});
      }
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const raw = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
  }

  async function ensureWebPushSubscription() {
    const publicKey = window.MESSENGER_B_CONFIG?.VAPID_PUBLIC_KEY || '';
    if (!publicKey) return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const result = await api('/api/push/subscription', { method: 'POST', body: subscription.toJSON() });
    return Boolean(result.ok);
  }

  async function requestAndEnableNotifications() {
    if (!('Notification' in window)) { toast('Браузер не поддерживает системные уведомления', 'error'); return false; }
    const perm = await Notification.requestPermission();
    updateNotifPromptUI();
    if (perm === 'granted') {
      await saveSettingPatch({ desktopNotifications: true });
      let pushReady = false;
      try { pushReady = await ensureWebPushSubscription(); }
      catch (err) { console.warn('[Web Push] Subscription failed:', err); }
      if (pushReady) toast('Системные уведомления и push-подписка включены', 'success');
      else toast('Уведомления включены для открытого приложения. Для push при закрытом браузере настройте VAPID и Edge Function.', 'info');
      sendSystemNotification('Мессенджер Б', 'Уведомления подключены');
      return true;
    }
    toast('Разрешение на уведомления не выдано', 'error');
    return false;
  }

  async function api(url, options = {}) {
    const opts = { credentials: 'same-origin', headers: { ...(options.headers || {}) }, ...options };
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `Ошибка сервера (${res.status})`); err.status = res.status; throw err; }
    return data;
  }

  function renderAvatarHtml(entity, sizeClass = '') {
    const color = entity?.avatarColor || '#2AABEE';
    const url = entity?.avatarUrl;
    const online = entity?.isOnline;
    const sysIcon = entity?.type === 'saved' ? ico('bookmark', 19)
      : entity?.type === 'school_announcements' ? ico('school', 20)
      : entity?.type === 'announcements' ? ico('megaphone', 19)
      : entity?.type === 'class' ? ico('chats', 19)
      : null;
    return `<div class="avatar ${sizeClass}" style="background:${escapeHtml(color)}">
      ${url ? `<img src="${escapeHtml(url)}" alt="" />` : (sysIcon || escapeHtml(getInitials(entity?.displayName || entity?.title || '?')))}
      ${online ? '<span class="online-dot"></span>' : ''}
    </div>`;
  }

  // ==================== PERSONALIZATION APPLY ====================
  function applySettings(settings) {
    if (!settings) return;
    state.settings = settings;
    const html = document.documentElement;
    let eff = settings.theme || 'dark';
    if (eff === 'system') eff = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    html.setAttribute('data-theme', eff);
    html.setAttribute('data-accent', settings.accent || 'blue');
    html.setAttribute('data-wallpaper', settings.wallpaper || 'tg-dots');
    html.setAttribute('data-bubble-style', settings.bubbleStyle || 'classic');
    html.style.setProperty('--msg-font-size', `${settings.fontSize || 15}px`);
    html.style.setProperty('--bubble-radius', `${settings.bubbleRadius || 18}px`);
    document.body.classList.toggle('compact', Boolean(settings.compactMode));
    document.body.classList.toggle('no-anim', settings.animationsEnabled === false);

    const ti = $('#quick-theme-icon');
    if (ti) ti.innerHTML = eff === 'dark' ? ico('sun', 19) : ico('moon', 19);
    const mti = $('#mobile-theme-ico');
    if (mti) mti.innerHTML = eff === 'dark' ? ico('sun', 18) : ico('moon', 18);
    $('#quick-lock-btn')?.classList.toggle('hidden', !settings.hasAppLockPin);
  }

  // ==================== REALTIME & PRESENCE ====================
  function setConnectionBanner(offline, text) {
    const b = $('#connection-banner');
    if (offline) { $('#connection-text').textContent = text || 'Нет подключения...'; b.classList.remove('hidden'); }
    else b.classList.add('hidden');
  }

  function connectRealtime() {
    if (typeof window.__cloudConnectRealtime === 'function') {
      window.__cloudConnectRealtime(handleRealtimeEvent, setConnectionBanner);
    }
  }

  window.addEventListener('offline', () => setConnectionBanner(true, 'Нет интернет-соединения. Черновики сохранены локально.'));
  window.addEventListener('online', () => { setConnectionBanner(true, 'Сеть восстановлена...'); connectRealtime(); });

  function getActivityText(chatId) {
    const map = state.activityMap.get(chatId);
    if (!map || map.size === 0) return null;
    const entries = Array.from(map.values());
    const voices = entries.filter((e) => e.action === 'voice');
    if (voices.length > 0) {
      return `${voices.map((e) => e.name.split(' ')[0]).join(', ')} записывает голосовое`;
    }
    return `${entries.map((e) => e.name.split(' ')[0]).join(', ')} печатает`;
  }

  function handleRealtimeEvent(event, payload) {
    switch (event) {
      case 'message:new': {
        const { chatId, message } = payload;
        const chat = state.chats.find((c) => c.id === chatId);
        if (chat) {
          chat.lastMessage = {
            id: message.id, senderId: message.senderId, senderName: message.sender?.displayName || '',
            content: message.content || (message.msgType === 'voice' ? 'Голосовое сообщение' : message.msgType === 'image' ? 'Фото' : message.msgType === 'poll' ? 'Опрос' : 'Файл'),
            msgType: message.msgType, createdAt: message.createdAt,
          };
          chat.updatedAt = message.createdAt;
          if ((chatId !== state.activeChatId || state.activeSection !== 'chats') && message.senderId !== state.user.id) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
          }
          sortChats(); renderChatList(); updateNavBadges();
        } else {
          loadChats();
        }

        if (chatId === state.activeChatId) {
          // Deduplicate against optimistic pending message
          const exists = state.messages.some((m) => m.id === message.id);
          const pendingIdx = state.messages.findIndex((m) => m.pending && m.senderId === message.senderId && m.content === message.content);
          if (pendingIdx !== -1) {
            state.messages[pendingIdx] = message;
            renderMessages(false);
          } else if (!exists) {
            message._isNew = true;
            state.messages.push(message);
            renderMessages(true);
          }
          if (message.senderId !== state.user.id) markChatRead(chatId, message.id);
        }

        // Clear activity indicator for sender
        const actMap = state.activityMap.get(chatId);
        if (actMap && actMap.has(message.senderId)) {
          clearTimeout(actMap.get(message.senderId).timer);
          actMap.delete(message.senderId);
          scheduleChatListRender();
          if (chatId === state.activeChatId) scheduleActiveHeaderRender();
        }

        // Notifications (In-App Push + System SW Notification on unfocused/hidden window!)
        if (message.senderId !== state.user.id) {
          const isMention = state.user?.username && new RegExp(`@${state.user.username}\\b`, 'i').test(message.content || '');
          const shouldNotify = isMention || !chat || !chat.muted;
          if (shouldNotify) {
            if (state.settings?.soundEnabled !== false) playNotificationSound();
            const isWindowInactive = document.hidden || !document.hasFocus();
            const notViewingChat = state.activeSection !== 'chats' || chatId !== state.activeChatId;
            if (!isWindowInactive && (notViewingChat || isMention)) {
              showInAppPush(chat, message, isMention);
            }
            if (isWindowInactive && 'Notification' in window && Notification.permission === 'granted' && state.settings?.desktopNotifications !== false) {
              const title = isMention
                ? `Вас упомянул(а) ${message.sender?.displayName || 'участник'}`
                : (chat?.title || message.sender?.displayName || 'Мессенджер Б');
              const body = (message.sender?.displayName && chat?.type !== 'dm' ? message.sender.displayName + ': ' : '') + (message.content || 'Новое вложение');
              sendSystemNotification(title, body, chatId);
            }
          }
        }
        break;
      }

      case 'message:updated': {
        if (payload.chatId === state.activeChatId) {
          const idx = state.messages.findIndex((m) => m.id === payload.message.id);
          if (idx !== -1) { state.messages[idx] = payload.message; renderMessages(false); }
        }
        loadChats();
        break;
      }

      case 'message:deleted': {
        if (payload.chatId === state.activeChatId) {
          const m = state.messages.find((x) => x.id === payload.messageId);
          if (m) { m.deleted = true; m.content = ''; m.attachment = null; m.poll = null; renderMessages(false); }
        }
        loadChats();
        break;
      }

      case 'message:reaction': {
        if (payload.chatId === state.activeChatId) {
          const m = state.messages.find((x) => x.id === payload.messageId);
          if (m) { m.reactions = payload.reactions; renderMessages(false); }
        }
        break;
      }

      case 'chat:pinned_message': {
        const c = state.chats.find((x) => x.id === payload.chatId);
        if (c) c.pinnedMessage = payload.pinnedMessage;
        if (payload.chatId === state.activeChatId) renderPinnedBar();
        break;
      }

      case 'activity:update': {
        const { chatId, userId, displayName, action } = payload;
        let map = state.activityMap.get(chatId);
        if (!map) { map = new Map(); state.activityMap.set(chatId, map); }
        const existing = map.get(userId);
        if (existing) clearTimeout(existing.timer);
        const wasVisible = Boolean(existing);
        let changed = false;
        if (action === 'stop') {
          if (wasVisible) { map.delete(userId); changed = true; }
        } else {
          const sameVisibleState = existing && existing.name === displayName && existing.action === action;
          const timer = setTimeout(() => {
            const current = map.get(userId);
            if (!current || current.timer !== timer) return;
            map.delete(userId);
            scheduleChatListRender();
            if (chatId === state.activeChatId) scheduleActiveHeaderRender();
          }, 4200);
          map.set(userId, { name: displayName, action, timer });
          changed = !sameVisibleState;
        }
        if (changed) {
          scheduleChatListRender();
          if (chatId === state.activeChatId) scheduleActiveHeaderRender();
        }
        break;
      }

      case 'presence:sync': {
        const set = new Set(payload.onlineIds || []);
        const now = Date.now();
        let changed = false;
        const syncUser = (u) => {
          if (!u) return;
          const nextOnline = u.canSeeLastSeen !== false && set.has(u.id);
          if (u.isOnline !== nextOnline) {
            u.isOnline = nextOnline;
            if (!nextOnline && u.canSeeLastSeen !== false) u.lastSeen = now;
            changed = true;
          }
        };
        for (const u of state.users) syncUser(u);
        for (const f of state.friends) syncUser(f.user);
        for (const m of state.activeChatMembers) syncUser(m);
        for (const c of state.chats) syncUser(c.otherUser);
        if (changed) {
          scheduleChatListRender();
          if (state.activeChatId) scheduleActiveHeaderRender();
          if (state.activeSection === 'widgets') { renderFriends(); renderClassmates(); }
          if ((state.user?.role === 'admin' || state.user?.role === 'teacher') && state.activeSection === 'admin') renderDedicatedAdminPanel();
        }
        break;
      }

      case 'presence:update': {
        const { userId, online, lastSeen } = payload;
        const seenAt = lastSeen || Date.now();
        let changed = false;
        const apply = (u) => {
          if (!u || u.id !== userId) return;
          const nextOnline = u.canSeeLastSeen !== false && Boolean(online);
          if (u.isOnline !== nextOnline) {
            u.isOnline = nextOnline;
            if (!nextOnline && u.canSeeLastSeen !== false) u.lastSeen = seenAt;
            changed = true;
          } else if (!nextOnline && u.canSeeLastSeen !== false && lastSeen && u.lastSeen !== lastSeen) {
            u.lastSeen = lastSeen;
          }
        };
        state.users.forEach(apply);
        state.friends.forEach((f) => apply(f.user));
        state.activeChatMembers.forEach(apply);
        state.chats.forEach((c) => apply(c.otherUser));
        if (changed) {
          scheduleChatListRender();
          if (state.activeChatId) scheduleActiveHeaderRender();
          if (state.activeSection === 'widgets') { renderFriends(); renderClassmates(); }
        }
        break;
      }

      case 'friends:updated': {
        loadFriends();
        loadUsers();
        break;
      }

      case 'user:updated': { loadUsers(); loadChats(); break; }
      case 'schedule:updated': { loadSchedule(); break; }
      case 'homework:updated': { loadHomework(); break; }
    }
  }

  // ==================== DATA LOADING ====================
  function sortChats() {
    state.chats.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : (b.updatedAt || 0) - (a.updatedAt || 0)));
  }
  async function loadChats() {
    const data = await api('/api/chats');
    state.chats = data.chats || [];
    sortChats(); renderChatList(); updateNavBadges();
  }
  async function loadUsers() {
    const data = await api('/api/users');
    state.users = data.users || [];
    renderClassmates();
    if (state.user?.role === 'admin' || state.user?.role === 'teacher') { renderAdminUsers(); renderDedicatedAdminPanel(); }
  }
  async function loadFriends() {
    const data = await api('/api/friends');
    state.friends = data.friends || [];
    state.incomingRequests = data.incoming || [];
    state.outgoingRequests = data.outgoing || [];
    renderFriends();
    updateNavBadges();
  }
  async function loadSchedule() {
    const qs = state.user?.role === 'admin' && state.selectedAcademicClassId ? `?classId=${state.selectedAcademicClassId}` : '';
    const data = await api(`/api/schedule${qs}`);
    state.schedule = data.items || [];
    renderSchedule();
  }
  async function loadHomework() {
    const qs = state.user?.role === 'admin' && state.selectedAcademicClassId ? `?classId=${state.selectedAcademicClassId}` : '';
    const data = await api(`/api/homework${qs}`);
    state.homework = data.items || [];
    renderHomework(); updateNavBadges();
  }
  async function refreshAllData() {
    await Promise.all([loadChats(), loadUsers(), loadFriends(), loadSchedule(), loadHomework()]);
    if (state.activeChatId) await loadMessages(state.activeChatId);
  }

  function updateNavBadges() {
    let chatUnread = 0, annUnread = 0;
    for (const c of state.chats) {
      if (c.type === 'announcements' || c.type === 'school_announcements') annUnread += c.unreadCount || 0;
      else chatUnread += c.unreadCount || 0;
    }
    const total = chatUnread + annUnread;
    document.title = total > 0 ? `(${total}) Мессенджер Б` : 'Мессенджер Б — Учебный мессенджер';
    const setB = (sel, val) => {
      const el = $(sel);
      if (!el) return;
      el.textContent = val > 99 ? '99+' : String(val);
      el.classList.toggle('hidden', val === 0);
    };
    setB('#badge-chats', chatUnread); setB('#mbadge-chats', chatUnread);
    setB('#badge-announcements', annUnread); setB('#mbadge-ann', annUnread);
    const activeHw = state.homework.filter((h) => !h.completed).length;
    setB('#badge-homework', activeHw); setB('#mbadge-hw', activeHw);
    setB('#badge-friends', state.incomingRequests.length); setB('#mbadge-friends', state.incomingRequests.length);
  }

  // ==================== CHATS & ACTIVE CHAT ====================
  function renderChatList() {
    const q = ($('#chat-search-input').value || '').trim().toLowerCase();
    const list = $('#chat-list');
    const filtered = state.chats.filter((c) => {
      if (state.activeFolder === 'dm' && c.type !== 'dm' && c.type !== 'saved') return false;
      if (state.activeFolder === 'group' && !['group', 'class', 'announcements', 'school_announcements'].includes(c.type)) return false;
      if (state.activeFolder === 'unread' && !(c.unreadCount > 0)) return false;
      if (q && !c.title.toLowerCase().includes(q)) return false;
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="muted small" style="text-align:center;padding:24px">Чаты не найдены</div>';
      return;
    }

    list.innerHTML = filtered.map((c) => {
      const act = getActivityText(c.id);
      const draft = state.drafts[c.id];
      let previewHtml = '<span class="muted">Нет сообщений</span>';
      let previewCls = '';
      if (act) {
        previewHtml = `${escapeHtml(act)}...`;
        previewCls = 'activity';
      } else if (draft && c.id !== state.activeChatId) {
        previewHtml = `<span class="draft-prefix">Черновик:</span> ${escapeHtml(draft)}`;
      } else if (c.lastMessage) {
        previewHtml = escapeHtml(c.lastMessage.content);
      }
      const avatarEntity = c.type === 'dm' && c.otherUser ? c.otherUser : { type: c.type, title: c.title, avatarColor: c.avatarColor, avatarUrl: c.avatarUrl };
      return `<div class="chat-item ${c.id === state.activeChatId ? 'active' : ''}" data-chat-id="${c.id}">
        ${renderAvatarHtml(avatarEntity)}
        <div class="chat-item-body">
          <div class="chat-item-top">
            <span class="chat-item-title">${c.pinned ? ico('pin', 13) : ''}${escapeHtml(c.title)}${c.muted ? ico('bellOff', 13) : ''}</span>
            <span class="chat-item-time">${formatChatTime(c.lastMessage?.createdAt || c.updatedAt)}</span>
          </div>
          <div class="chat-item-bottom">
            <span class="chat-item-preview ${previewCls}">${previewHtml}</span>
            ${c.unreadCount > 0 ? `<span class="unread-pill ${c.muted ? 'muted-pill' : ''}">${c.unreadCount}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // Coalesce bursts of presence/typing updates into one paint instead of
  // rebuilding the entire sidebar several times in the same frame.
  let chatListRenderQueued = false;
  let activeHeaderRenderQueued = false;
  function scheduleChatListRender() {
    if (chatListRenderQueued) return;
    chatListRenderQueued = true;
    requestAnimationFrame(() => {
      chatListRenderQueued = false;
      renderChatList();
    });
  }
  function scheduleActiveHeaderRender() {
    if (activeHeaderRenderQueued) return;
    activeHeaderRenderQueued = true;
    requestAnimationFrame(() => {
      activeHeaderRenderQueued = false;
      if (state.activeChatId) renderActiveChatHeader();
    });
  }

  function saveCurrentDraft() {
    if (!state.activeChatId || state.editingMsg) return;
    const t = $('#message-input').value.trim();
    if (t) state.drafts[state.activeChatId] = t;
    else delete state.drafts[state.activeChatId];
    saveDrafts();
  }

  function renderMessagesLoading() {
    const list = $('#messages-list');
    list.innerHTML = `
      <div class="message-skeleton message-skeleton-in"><i></i><i></i></div>
      <div class="message-skeleton message-skeleton-out"><i></i><i></i></div>
      <div class="message-skeleton message-skeleton-in short"><i></i><i></i></div>`;
    $('#load-older-wrap').classList.add('hidden');
  }

  async function openChat(chatId) {
    if (!Number.isFinite(Number(chatId))) return;
    saveCurrentDraft();
    const token = ++state.chatOpenToken;
    state.activeChatId = Number(chatId);
    state.replyTo = null; state.editingMsg = null; state.searchMode = false;
    $('#in-chat-search-bar').classList.add('hidden');
    $('#emoji-picker').classList.add('hidden');
    closeMentionPopover();
    updateComposerContext();

    const input = $('#message-input');
    input.value = state.drafts[chatId] || '';
    autoResizeTextarea(input); toggleSendVoiceButton();

    $('#chat-empty-state').classList.add('hidden');
    $('#chat-active-container').classList.remove('hidden');
    $('#section-chats').classList.add('mobile-chat-open');
    $('#app-shell').classList.add('in-mobile-chat');

    const cachedMessages = state.messageCache.get(Number(chatId));
    state.messages = cachedMessages ? cachedMessages.messages.slice() : [];
    state.hasMoreMessages = cachedMessages ? cachedMessages.hasMore : false;
    const cachedMembers = state.chatMembersCache.get(Number(chatId));
    state.activeChatMembers = cachedMembers ? cachedMembers.slice() : [];

    renderChatList(); renderActiveChatHeader(); renderPinnedBar(); updateComposerPermissions();
    if (cachedMessages) renderMessages(true);
    else renderMessagesLoading();
    input.focus();

    // Show cached history immediately; refresh messages and participants without blocking navigation.
    const [_, chatInfo] = await Promise.all([
      loadMessages(Number(chatId), { requestToken: token }).catch((err) => {
        if (token === state.chatOpenToken) {
          $('#messages-list').innerHTML = `<div class="empty-state"><h3>Не удалось загрузить чат</h3><p class="muted small">Проверьте соединение и откройте чат ещё раз.</p></div>`;
          toast(err.message || 'Не удалось загрузить сообщения', 'error');
        }
      }),
      api(`/api/chats/${chatId}/members`).catch(() => ({ members: [] })),
    ]);
    if (token !== state.chatOpenToken || state.activeChatId !== Number(chatId)) return;
    state.activeChatMembers = chatInfo.members || [];
    state.chatMembersCache.set(Number(chatId), state.activeChatMembers.slice());
    while (state.chatMembersCache.size > 12) state.chatMembersCache.delete(state.chatMembersCache.keys().next().value);
    renderActiveChatHeader();

    const last = state.messages[state.messages.length - 1];
    if (last && typeof last.id === 'number') markChatRead(Number(chatId), last.id);
  }

  function getActiveChat() { return state.chats.find((c) => c.id === state.activeChatId) || null; }

  function renderActiveChatHeader() {
    const chat = getActiveChat();
    if (!chat) return;
    const avatarEntity = chat.type === 'dm' && chat.otherUser ? chat.otherUser : { type: chat.type, title: chat.title, avatarColor: chat.avatarColor, avatarUrl: chat.avatarUrl };
    $('#active-chat-avatar').outerHTML = renderAvatarHtml(avatarEntity).replace('<div class="avatar', '<div id="active-chat-avatar" class="avatar');
    $('#active-chat-title').textContent = chat.title;

    const badge = $('#active-chat-badge');
    if (chat.type === 'school_announcements') { badge.textContent = 'Общие объявления'; badge.classList.remove('hidden'); }
    else if (chat.type === 'announcements') { badge.textContent = 'Объявления класса'; badge.classList.remove('hidden'); }
    else if (chat.type === 'dm' && chat.otherUser && chat.otherUser.role !== 'student') { badge.textContent = ROLE_SHORT[chat.otherUser.role] || ''; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    const sub = $('#active-chat-subtitle');
    const actText = getActivityText(chat.id);
    sub.classList.remove('typing', 'online');
    if (actText) {
      sub.innerHTML = `${escapeHtml(actText)} <span class="typing-dots"><i></i><i></i><i></i></span>`;
      sub.classList.add('typing');
    } else if (chat.type === 'dm' && chat.otherUser) {
      sub.textContent = formatLastSeen(chat.otherUser.lastSeen, chat.otherUser.isOnline);
      if (chat.otherUser.isOnline) sub.classList.add('online');
    } else if (chat.type === 'saved') {
      sub.textContent = 'Личное облако заметок и файлов';
    } else {
      const onlineMembers = state.activeChatMembers.filter((m) => m.isOnline).length;
      sub.textContent = onlineMembers > 0 ? `${chat.memberCount} участн. • ${onlineMembers} в сети` : `${chat.memberCount} участн.`;
    }
    $('#btn-chat-mute').innerHTML = chat.muted ? ico('bellOff', 19) : ico('bell', 19);
  }

  function renderPinnedBar() {
    const chat = getActiveChat();
    const bar = $('#pinned-bar');
    if (!chat || !chat.pinnedMessage) { bar.classList.add('hidden'); return; }
    $('#pinned-bar-text').textContent = `${chat.pinnedMessage.senderName}: ${chat.pinnedMessage.content}`;
    bar.classList.remove('hidden');
  }

  function updateComposerPermissions() {
    const chat = getActiveChat();
    if (!chat) return;
    const readOnly = chat.canPost === false;
    const bar = $('#composer-readonly-bar');
    if (readOnly) {
      bar.textContent = chat.type === 'school_announcements'
        ? 'Писать в «Общие объявления» может только администратор. Вы можете ставить реакции.'
        : 'Писать в «Объявления класса» могут классный руководитель, староста или администратор.';
    }
    bar.classList.toggle('hidden', !readOnly);
    $('#composer-wrap').classList.toggle('hidden', readOnly);
  }

  async function markChatRead(chatId, messageId) {
    const chat = state.chats.find((c) => c.id === chatId);
    if (chat) { chat.unreadCount = 0; renderChatList(); updateNavBadges(); }
    try { await api(`/api/chats/${chatId}/read`, { method: 'POST', body: { messageId } }); } catch {}
  }

  async function loadMessages(chatId, { before = null, q = '', requestToken = null } = {}) {
    const params = new URLSearchParams({ limit: '40' });
    if (before) params.set('before', String(before));
    if (q) params.set('q', q);
    const data = await api(`/api/chats/${chatId}/messages?${params.toString()}`);
    if (chatId !== state.activeChatId || (requestToken !== null && requestToken !== state.chatOpenToken)) return;
    if (before) {
      const sc = $('#messages-scroll'), prevH = sc.scrollHeight;
      state.messages = [...data.messages, ...state.messages];
      state.hasMoreMessages = data.hasMore;
      renderMessages(false);
      sc.scrollTop = sc.scrollHeight - prevH;
    } else {
      state.messages = data.messages || [];
      state.hasMoreMessages = Boolean(data.hasMore);
      renderMessages(true);
    }
  }

  function renderMessages(scrollToBottom) {
    const list = $('#messages-list'), chat = getActiveChat();
    if (state.activeChatId && state.messageCache instanceof Map) {
      state.messageCache.set(state.activeChatId, { messages: state.messages.slice(), hasMore: Boolean(state.hasMoreMessages) });
      while (state.messageCache.size > 12) state.messageCache.delete(state.messageCache.keys().next().value);
    }
    $('#load-older-wrap').classList.toggle('hidden', !state.hasMoreMessages || state.searchMode);

    if (state.messages.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <div class="empty-icon-circle">${chat?.type === 'announcements' || chat?.type === 'school_announcements' ? ico('megaphone', 30) : ico('chats', 30)}</div>
        <h3>${state.searchMode ? 'Ничего не найдено' : 'Пока нет сообщений'}</h3>
        <p class="muted small">${state.searchMode ? 'Попробуйте другой запрос.' : 'Напишите первое сообщение — история сохранится.'}</p>
      </div>`;
      return;
    }

    let lastDateStr = '';
    const htmlParts = [];
    for (const m of state.messages) {
      const ds = new Date(m.createdAt).toDateString();
      if (ds !== lastDateStr) { lastDateStr = ds; htmlParts.push(`<div class="date-divider">${escapeHtml(formatDateDivider(m.createdAt))}</div>`); }

      const isOut = m.senderId === state.user.id;
      const showSender = !isOut && chat && chat.type !== 'dm' && chat.type !== 'saved' && m.sender;

      let bodyHtml = '';
      if (m.deleted) {
        bodyHtml = '<span>Сообщение удалено</span>';
      } else {
        if (m.forwardedFrom) bodyHtml += `<div class="msg-forwarded">${ico('forward', 13)} Переслано от ${escapeHtml(m.forwardedFrom)}</div>`;
        if (m.replyTo) {
          bodyHtml += `<div class="msg-reply-box" data-jump-msg="${m.replyTo.id}">
            <div class="msg-reply-sender">${escapeHtml(m.replyTo.senderName)}</div>
            <div class="msg-reply-text">${escapeHtml(m.replyTo.content)}</div>
          </div>`;
        }
        if (m.msgType === 'image' && m.attachment) {
          bodyHtml += `<img class="msg-image" src="${escapeHtml(m.attachment.url)}" alt="${escapeHtml(m.attachment.name)}" data-lightbox="${escapeHtml(m.attachment.url)}" />`;
        } else if (m.msgType === 'voice' && m.attachment) {
          bodyHtml += `<div class="voice-player" data-voice-url="${escapeHtml(m.attachment.url)}" data-duration="${m.voiceDuration || 0}">
            <button type="button" class="voice-play-btn">${ico('play', 14)}</button>
            <div class="voice-track-wrap">
              <div class="voice-progress"><div class="voice-progress-fill"></div></div>
              <div class="voice-meta"><span class="voice-time">${formatSeconds(m.voiceDuration)}</span><button type="button" class="voice-speed-btn">1x</button></div>
            </div>
          </div>`;
        } else if (m.msgType === 'file' && m.attachment) {
          bodyHtml += `<a class="msg-file-card" href="${escapeHtml(m.attachment.url)}?download=1" download="${escapeHtml(m.attachment.name)}">
            <span class="msg-file-icon">${ico('file', 22)}</span>
            <div><div class="msg-file-name">${escapeHtml(m.attachment.name)}</div><div class="msg-file-size">${formatBytes(m.attachment.size)}</div></div>
          </a>`;
        } else if (m.msgType === 'poll' && m.poll) {
          const total = Math.max(1, m.poll.totalVoters);
          bodyHtml += `<div class="poll-card">
            <div class="poll-question">${ico('poll', 16)} ${escapeHtml(m.poll.question)}</div>
            ${m.poll.options.map((o) => {
              const pct = m.poll.totalVoters > 0 ? Math.round((o.votes / total) * 100) : 0;
              const voted = m.poll.myVotes.includes(o.index);
              return `<button type="button" class="poll-option ${voted ? 'voted' : ''}" data-poll-id="${m.poll.id}" data-opt-index="${o.index}">
                <div class="poll-fill" style="width:${pct}%"></div>
                <span class="poll-opt-text">${voted ? '✓ ' : ''}${escapeHtml(o.text)}</span>
                <span class="poll-opt-pct">${o.votes} (${pct}%)</span>
              </button>`;
            }).join('')}
            <div class="poll-footer">${m.poll.isAnonymous ? 'Анонимный опрос' : 'Открытый опрос'} • Проголосовали: ${m.poll.totalVoters}</div>
          </div>`;
        }

        if (m.content && m.msgType !== 'poll') {
          const big = isBigEmojiOnly(m.content);
          bodyHtml += `<div class="msg-text ${big ? 'big-emoji-text' : ''}">${formatMessageHtml(m.content)}</div>`;
        }
      }

      const reactionsHtml = (!m.deleted && m.reactions && m.reactions.length > 0)
        ? `<div class="msg-reactions">${m.reactions.map((r) =>
            `<button type="button" class="reaction-chip ${r.reactedByMe ? 'mine' : ''} ${r._pop ? 'pop' : ''}" data-react-msg="${m.id}" data-react-emoji="${escapeHtml(r.emoji)}">${escapeHtml(r.emoji)} ${r.count}</button>`
          ).join('')}</div>` : '';

      const checksHtml = isOut && !m.deleted
        ? `<span class="msg-checks">${m.pending ? ico('clock', 12) : (m.isRead ? ico('checkDouble', 14) : ico('check', 14))}</span>` : '';

      const rowCls = `msg-row ${isOut ? 'out' : 'in'} ${m.pending ? 'pending' : ''} ${m._isNew ? 'new-anim' : ''}`;
      m._isNew = false;

      htmlParts.push(`
        <div class="${rowCls}" data-msg-id="${m.id}">
          ${!isOut && chat?.type !== 'dm' && chat?.type !== 'saved' ? renderAvatarHtml(m.sender, 'avatar-sm') : ''}
          <div class="msg-bubble ${m.deleted ? 'deleted' : ''}">
            ${showSender ? `<div class="msg-sender" style="color:${escapeHtml(m.sender.avatarColor)}">${escapeHtml(m.sender.displayName)} ${escapeHtml(m.sender.statusEmoji || '')}${m.sender.role && m.sender.role !== 'student' ? `<span class="role-badge">${escapeHtml(ROLE_SHORT[m.sender.role] || '')}</span>` : ''}</div>` : ''}
            ${bodyHtml}
            ${reactionsHtml}
            <div class="msg-meta">${m.editedAt && !m.deleted ? '<span>изм.</span>' : ''}<span>${formatTime(m.createdAt)}</span>${checksHtml}</div>
          </div>
          ${!m.deleted && !m.pending ? `<div class="msg-hover-actions">
            <button type="button" class="icon-btn small" data-quick-reply="${m.id}" title="Ответить">${ico('reply', 15)}</button>
            <button type="button" class="icon-btn small" data-open-ctx="${m.id}" title="Ещё">${ico('more', 15)}</button>
          </div>` : ''}
        </div>
      `);
    }

    list.innerHTML = htmlParts.join('');
    if (scrollToBottom) {
      const sc = $('#messages-scroll');
      sc.scrollTop = sc.scrollHeight;
    }
  }

  function jumpToMessage(msgId) {
    const row = document.querySelector(`.msg-row[data-msg-id="${msgId}"]`);
    if (!row) { toast('Сообщение выше в истории — нажмите «Загрузить ранние сообщения»'); return; }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const b = row.querySelector('.msg-bubble');
    if (b) { b.classList.add('highlight'); setTimeout(() => b.classList.remove('highlight'), 1500); }
  }

  // ==================== 0ms OPTIMISTIC SEND & REACTIONS ====================
  function autoResizeTextarea(el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 130)}px`; }
  function toggleSendVoiceButton() {
    const has = $('#message-input').value.trim().length > 0;
    $('#btn-send-msg').classList.toggle('hidden', !has);
    $('#btn-voice-record').classList.toggle('hidden', has || Boolean(state.editingMsg));
  }

  function updateComposerContext() {
    const bar = $('#composer-context-bar');
    if (state.editingMsg) {
      $('#composer-context-title').textContent = 'Редактирование сообщения';
      $('#composer-context-text').textContent = state.editingMsg.content;
      bar.classList.remove('hidden');
    } else if (state.replyTo) {
      const name = state.replyTo.sender?.displayName || (state.replyTo.sender?.username ? '@' + state.replyTo.sender.username : 'Участник');
      $('#composer-context-title').textContent = `Ответ для ${name}`;
      $('#composer-context-text').textContent = state.replyTo.content || 'Вложение';
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  }

  let typingStopTimer = null;
  let lastTypingSent = 0;
  function broadcastActivity(action) {
    if (state.settings?.showTyping === false || !state.activeChatId) return;
    if (typeof window.__cloudSendActivity === 'function') {
      window.__cloudSendActivity(state.activeChatId, action);
    }
  }
  function notifyTyping() {
    if (!state.activeChatId) return;
    const now = Date.now();
    if (now - lastTypingSent > 1800) {
      lastTypingSent = now;
      broadcastActivity('typing');
    }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => broadcastActivity('stop'), 2400);
  }

  async function sendCurrentMessage() {
    const chatId = state.activeChatId;
    if (!chatId) return;
    const input = $('#message-input');
    const content = input.value.trim();
    if (!content) return;

    $('#emoji-picker').classList.add('hidden');
    closeMentionPopover();
    broadcastActivity('stop');

    // Editing existing message (optimistic!)
    if (state.editingMsg) {
      const editTarget = state.editingMsg;
      const oldContent = editTarget.content;
      editTarget.content = content;
      editTarget.editedAt = Date.now();
      state.editingMsg = null;
      updateComposerContext();
      input.value = ''; autoResizeTextarea(input); toggleSendVoiceButton();
      renderMessages(false);
      try {
        await api(`/api/messages/${editTarget.id}`, { method: 'PATCH', body: { content } });
      } catch (err) {
        editTarget.content = oldContent;
        renderMessages(false);
        toast(err.message, 'error');
      }
      return;
    }

    // 0ms OPTIMISTIC UI SEND!
    const replySnapshot = state.replyTo;
    const tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const optimisticMsg = {
      id: tempId,
      chatId,
      senderId: state.user.id,
      sender: {
        id: state.user.id, username: state.user.username, displayName: state.user.displayName,
        role: state.user.role, avatarUrl: state.user.avatarUrl, avatarColor: state.user.avatarColor, statusEmoji: state.user.statusEmoji || '',
      },
      content,
      msgType: 'text',
      replyTo: replySnapshot ? {
        id: replySnapshot.id,
        senderName: replySnapshot.sender?.displayName || (replySnapshot.sender?.username ? '@' + replySnapshot.sender.username : 'Участник'),
        content: replySnapshot.content || 'Вложение',
        msgType: replySnapshot.msgType,
      } : null,
      forwardedFrom: null,
      attachment: null,
      voiceDuration: null,
      poll: null,
      reactions: [],
      editedAt: null,
      deleted: false,
      isRead: false,
      pending: true,
      _isNew: true,
      createdAt: Date.now(),
    };

    state.replyTo = null;
    updateComposerContext();
    delete state.drafts[chatId];
    saveDrafts();
    input.value = '';
    autoResizeTextarea(input);
    toggleSendVoiceButton();

    state.messages.push(optimisticMsg);
    const chat = getActiveChat();
    if (chat) {
      chat.lastMessage = { id: tempId, senderId: state.user.id, senderName: state.user.displayName, content, msgType: 'text', createdAt: optimisticMsg.createdAt };
      chat.updatedAt = optimisticMsg.createdAt;
      sortChats(); renderChatList();
    }
    renderMessages(true);

    try {
      const res = await api(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        body: { content, replyToId: replySnapshot?.id || null },
      });
      const idx = state.messages.findIndex((m) => m.id === tempId);
      if (idx !== -1 && res.message) {
        if (state.messages.some((m) => m.id === res.message.id)) {
          state.messages.splice(idx, 1); // Already replaced by realtime
        } else {
          state.messages[idx] = res.message;
        }
        renderMessages(false);
      }
    } catch (err) {
      state.messages = state.messages.filter((m) => m.id !== tempId);
      if (state.activeChatId === chatId && !input.value.trim()) {
        input.value = content;
        autoResizeTextarea(input);
        toggleSendVoiceButton();
        saveCurrentDraft();
      }
      renderMessages(false);
      toast(err.message, 'error');
    }
  }

  // 0ms OPTIMISTIC REACTION TOGGLE!
  async function toggleReactionOptimistic(msgId, emoji) {
    const msg = state.messages.find((m) => String(m.id) === String(msgId));
    if (!msg || msg.pending) return;
    msg.reactions = msg.reactions || [];
    const previousReactions = msg.reactions.map((r) => ({ ...r }));
    const existing = msg.reactions.find((r) => r.emoji === emoji);
    if (existing) {
      if (existing.reactedByMe) {
        existing.count--;
        existing.reactedByMe = false;
        if (existing.count <= 0) msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji);
      } else {
        existing.count++;
        existing.reactedByMe = true;
        existing._pop = true;
      }
    } else {
      msg.reactions.push({ emoji, count: 1, reactedByMe: true, _pop: true });
    }
    renderMessages(false);
    try {
      await api(`/api/messages/${msgId}/reactions`, { method: 'POST', body: { emoji } });
    } catch (err) {
      msg.reactions = previousReactions;
      renderMessages(false);
      toast(err.message || 'Не удалось сохранить реакцию', 'error');
    }
  }

  // ==================== @MENTIONS AUTOCOMPLETE & EMOJI PICKER ====================
  function renderEmojiGrid() {
    const list = EMOJI_CATS[state.emojiCat] || EMOJI_CATS.popular;
    $('#emoji-grid').innerHTML = list.map((e) => `<button type="button" class="emoji-cell" data-ins-emoji="${e}">${e}</button>`).join('');
  }

  function insertAtCursor(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
    autoResizeTextarea(el);
    toggleSendVoiceButton();
    saveCurrentDraft();
  }

  function closeMentionPopover() {
    state.mentionQuery = null;
    state.mentionStart = -1;
    $('#mention-popover')?.classList.add('hidden');
  }

  function updateMentionPopover() {
    const input = $('#message-input');
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, pos);
    const match = before.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
    if (!match) { closeMentionPopover(); return; }

    const query = match[2].toLowerCase();
    state.mentionQuery = query;
    state.mentionStart = pos - match[2].length - 1;
    const pool = (state.activeChatMembers.length > 0 ? state.activeChatMembers : state.users)
      .filter((u) => u.id !== state.user.id && (u.username.toLowerCase().includes(query) || u.displayName.toLowerCase().includes(query)))
      .slice(0, 6);

    if (pool.length === 0) { closeMentionPopover(); return; }
    state.mentionIdx = 0;
    const pop = $('#mention-popover');
    pop.innerHTML = pool.map((u, idx) => `
      <button type="button" class="mention-item ${idx === 0 ? 'active' : ''}" data-pick-mention="${escapeHtml(u.username)}">
        ${renderAvatarHtml(u, 'avatar-sm')}
        <div style="min-width:0"><div style="font-weight:600">${escapeHtml(u.displayName)}</div><div class="muted small">@${escapeHtml(u.username)}</div></div>
      </button>
    `).join('');
    pop.classList.remove('hidden');
  }

  function pickMention(username) {
    const input = $('#message-input');
    const pos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, state.mentionStart);
    const after = input.value.slice(pos);
    const inserted = `@${username} `;
    input.value = before + inserted + after;
    input.selectionStart = input.selectionEnd = before.length + inserted.length;
    closeMentionPopover();
    input.focus();
    autoResizeTextarea(input);
    toggleSendVoiceButton();
  }

  // ==================== FILES & VOICE ====================
  async function uploadAndSendFile(file, isVoice = false, voiceDuration = null) {
    const chatId = state.activeChatId;
    if (!chatId || !file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api(`/api/chats/${chatId}/upload`, { method: 'POST', body: fd });
      const caption = isVoice ? '' : $('#message-input').value.trim();
      await api(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        body: {
          content: caption, attachmentId: up.attachment.id,
          msgType: isVoice ? 'voice' : undefined,
          voiceDuration: isVoice ? voiceDuration : undefined,
          replyToId: state.replyTo?.id || null,
        },
      });
      if (!isVoice && caption) { $('#message-input').value = ''; delete state.drafts[chatId]; saveDrafts(); toggleSendVoiceButton(); }
      state.replyTo = null; updateComposerContext();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Запись голосовых не поддерживается в этом браузере', 'error'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.voiceStream = stream; state.voiceChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      state.mediaRecorder = rec; state.voiceStartTime = Date.now();
      rec.ondataavailable = (e) => { if (e.data.size > 0) state.voiceChunks.push(e.data); };
      rec.start();
      broadcastActivity('voice');
      $('#composer-row').classList.add('hidden');
      $('#voice-recording-bar').classList.remove('hidden');
      $('#voice-rec-timer').textContent = '0:00';
      state.voiceTimerInterval = setInterval(() => {
        $('#voice-rec-timer').textContent = formatSeconds((Date.now() - state.voiceStartTime) / 1000);
        broadcastActivity('voice');
      }, 1500);
    } catch { toast('Нет доступа к микрофону', 'error'); }
  }

  function stopVoiceRecording(shouldSend) {
    clearInterval(state.voiceTimerInterval);
    broadcastActivity('stop');
    $('#voice-recording-bar').classList.add('hidden');
    $('#composer-row').classList.remove('hidden');
    const rec = state.mediaRecorder;
    const duration = Math.max(1, (Date.now() - state.voiceStartTime) / 1000);
    if (!rec) return;
    rec.onstop = async () => {
      state.voiceStream?.getTracks().forEach((t) => t.stop());
      state.voiceStream = null;
      if (shouldSend && state.voiceChunks.length > 0) {
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(state.voiceChunks, { type: mime });
        const file = new File([blob], `voice_${Date.now()}.${mime.includes('mp4') ? 'm4a' : 'webm'}`, { type: mime });
        await uploadAndSendFile(file, true, duration);
      }
      state.voiceChunks = []; state.mediaRecorder = null;
    };
    try { rec.stop(); } catch {}
  }

  function handleVoicePlayerClick(playerEl, actionBtn) {
    const url = playerEl.dataset.voiceUrl;
    const playBtn = playerEl.querySelector('.voice-play-btn');
    const fill = playerEl.querySelector('.voice-progress-fill');
    const timeEl = playerEl.querySelector('.voice-time');
    const speedBtn = playerEl.querySelector('.voice-speed-btn');

    if (actionBtn === speedBtn) {
      const speeds = [1, 1.5, 2];
      const next = speeds[(speeds.indexOf(parseFloat(speedBtn.textContent) || 1) + 1) % speeds.length];
      speedBtn.textContent = `${next}x`;
      if (state.activeAudio?.playerEl === playerEl) state.activeAudio.audio.playbackRate = next;
      return;
    }
    if (state.activeAudio?.playerEl === playerEl) {
      if (state.activeAudio.audio.paused) { state.activeAudio.audio.play(); playBtn.innerHTML = ico('pause', 14); }
      else { state.activeAudio.audio.pause(); playBtn.innerHTML = ico('play', 14); }
      return;
    }
    if (state.activeAudio) { state.activeAudio.audio.pause(); state.activeAudio.playBtn.innerHTML = ico('play', 14); }
    const audio = new Audio(url);
    audio.playbackRate = parseFloat(speedBtn.textContent) || 1;
    state.activeAudio = { audio, playerEl, playBtn };
    playBtn.innerHTML = ico('pause', 14);
    audio.play().catch(() => toast('Не удалось воспроизвести голосовое', 'error'));
    audio.ontimeupdate = () => {
      const dur = audio.duration || parseFloat(playerEl.dataset.duration) || 1;
      fill.style.width = `${Math.min(100, (audio.currentTime / dur) * 100)}%`;
      timeEl.textContent = formatSeconds(audio.currentTime);
    };
    audio.onended = () => { playBtn.innerHTML = ico('play', 14); fill.style.width = '0%'; timeEl.textContent = formatSeconds(playerEl.dataset.duration); state.activeAudio = null; };
  }

  // ==================== MODALS: MESSAGE DATA, GROUP ADD, NEW CHAT, POLL ====================
  function openModal(title, bodyHtml) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-overlay').classList.remove('hidden');
  }
  function closeModal() { $('#modal-overlay').classList.add('hidden'); }

  async function openMessageInfoModal(msgId) {
    openModal('Данные сообщения', '<div class="muted small">Загрузка...</div>');
    try {
      const data = await api(`/api/messages/${msgId}/info`);
      const readHtml = data.readBy.length === 0
        ? '<p class="muted small">Пока никто не отметил прочтение.</p>'
        : `<div class="list-stack">${data.readBy.map((u) => `
            <div class="list-row">
              <div style="display:flex;align-items:center;gap:9px">${renderAvatarHtml(u, 'avatar-sm')}<div><div style="font-weight:600">${escapeHtml(u.displayName)}</div><div class="muted small">@${escapeHtml(u.username)}</div></div></div>
              <span class="muted small">${ico('checkDouble', 14)}</span>
            </div>`).join('')}</div>`;

      const reactHtml = data.reactions.length === 0
        ? '<p class="muted small">Реакций пока нет.</p>'
        : data.reactions.map((g) => `
            <div style="margin-bottom:10px">
              <div style="font-weight:700;margin-bottom:6px">${escapeHtml(g.emoji)} (${g.users.length})</div>
              <div class="list-stack">${g.users.map((u) => `
                <div class="list-row">
                  <div style="display:flex;align-items:center;gap:9px">${renderAvatarHtml(u, 'avatar-sm')}<div><div style="font-weight:600">${escapeHtml(u.displayName)}</div><div class="muted small">@${escapeHtml(u.username)}</div></div></div>
                </div>`).join('')}</div>
            </div>`).join('');

      $('#modal-body').innerHTML = `
        <h4 class="ico-title" style="margin-bottom:8px">${ico('eye', 16)} Прочитали (${data.readBy.length})</h4>
        ${readHtml}
        <h4 class="ico-title" style="margin:16px 0 8px">${ico('smile', 16)} Реакции</h4>
        ${reactHtml}
      `;
    } catch (err) {
      $('#modal-body').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    }
  }

  function openMessageContextMenu(msgId, x, y) {
    const msg = state.messages.find((m) => String(m.id) === String(msgId));
    if (!msg || msg.deleted || msg.pending) return;
    const menu = $('#msg-context-menu');
    const isMine = msg.senderId === state.user.id;
    const chat = getActiveChat();
    const canDelete = isMine || state.user.role === 'admin' || (state.user.role === 'teacher' && chat && chat.classId === state.user.classId);
    const canPin = chat && chat.canPin !== false;

    menu.innerHTML = `
      <div class="ctx-reactions">${QUICK_REACTIONS.map((e) => `<button type="button" class="ctx-react-btn" data-ctx-react="${e}">${e}</button>`).join('')}</div>
      <button type="button" class="ctx-item" data-ctx-act="reply">${ico('reply', 15)} Ответить</button>
      <button type="button" class="ctx-item" data-ctx-act="info">${ico('eye', 15)} Данные (прочтения/реакции)</button>
      <button type="button" class="ctx-item" data-ctx-act="forward">${ico('forward', 15)} Переслать</button>
      ${msg.content ? `<button type="button" class="ctx-item" data-ctx-act="copy">${ico('copy', 15)} Копировать текст</button>` : ''}
      ${isMine && msg.msgType === 'text' ? `<button type="button" class="ctx-item" data-ctx-act="edit">${ico('edit', 15)} Редактировать</button>` : ''}
      ${canPin ? `<button type="button" class="ctx-item" data-ctx-act="pin">${ico('pin', 15)} Закрепить</button>` : ''}
      ${canDelete ? `<button type="button" class="ctx-item danger" data-ctx-act="delete">${ico('trash', 15)} Удалить</button>` : ''}
    `;
    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 12)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 12)}px`;
    menu.dataset.msgId = String(msgId);
  }
  function closeContextMenu() { $('#msg-context-menu').classList.add('hidden'); }

  function openNewChatModal() {
    const eligible = state.users.filter((u) => u.id !== state.user.id);
    openModal('Новый чат или группа', `
      <div class="auth-tabs" id="new-chat-tabs">
        <button type="button" class="auth-tab active" data-nc-tab="dm">Личный чат</button>
        <button type="button" class="auth-tab" data-nc-tab="group">Новая группа</button>
      </div>
      <div id="nc-dm-panel">
        <p class="muted small" style="margin-bottom:10px">Доступны ваши друзья и одноклассники. Чтобы найти человека из другого класса — используйте поиск по @логину во вкладке «Друзья».</p>
        ${eligible.length === 0 ? '<p class="muted small">Пока нет доступных контактов.</p>' : `<div class="list-stack">${eligible.map((u) => `
          <div class="list-row">
            <div style="display:flex;align-items:center;gap:10px">${renderAvatarHtml(u, 'avatar-sm')}<div><div style="font-weight:600">${escapeHtml(u.displayName)}</div><div class="muted small">@${escapeHtml(u.username)} • ${u.isFriend ? 'Друг' : ('Класс ' + escapeHtml(u.className))}</div></div></div>
            <button type="button" class="btn btn-sm btn-primary" data-start-dm="${u.id}">Написать</button>
          </div>`).join('')}</div>`}
      </div>
      <form id="nc-group-panel" class="hidden">
        <div class="field"><label>Название группы</label><input type="text" id="new-group-title" placeholder="Например: Проект по физике" required /></div>
        <div class="field"><label>Описание (необязательно)</label><input type="text" id="new-group-desc" placeholder="О чём эта группа" /></div>
        <div class="field"><label>Участники (только друзья и одноклассники)</label>
          <div class="list-stack" style="max-height:190px;overflow-y:auto">
            ${eligible.map((u) => `
              <label class="list-row" style="cursor:pointer">
                <span>${escapeHtml(u.displayName)} <span class="muted small">@${escapeHtml(u.username)} • ${u.isFriend ? 'Друг' : ('Класс ' + escapeHtml(u.className))}</span></span>
                <input type="checkbox" name="groupMembers" value="${u.id}" style="width:auto" />
              </label>`).join('') || '<span class="muted small">Нет доступных участников</span>'}
          </div>
        </div>
        <button type="submit" class="btn btn-primary full-width">Создать группу</button>
      </form>
    `);
    $$('#new-chat-tabs button').forEach((btn) => {
      btn.onclick = () => {
        $$('#new-chat-tabs button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        $('#nc-dm-panel').classList.toggle('hidden', btn.dataset.ncTab !== 'dm');
        $('#nc-group-panel').classList.toggle('hidden', btn.dataset.ncTab !== 'group');
      };
    });
    $$('[data-start-dm]').forEach((btn) => { btn.onclick = async () => { await startDmWith(btn.dataset.startDm); closeModal(); }; });
    $('#nc-group-panel').onsubmit = async (e) => {
      e.preventDefault();
      const title = $('#new-group-title').value.trim(), description = $('#new-group-desc').value.trim();
      const memberIds = $$('input[name="groupMembers"]:checked').map((i) => i.value);
      try {
        const res = await api('/api/chats/group', { method: 'POST', body: { title, description, memberIds } });
        closeModal(); await loadChats(); openChat(res.chat.id);
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  async function startDmWith(userId) {
    try {
      const res = await api('/api/chats/dm', { method: 'POST', body: { userId } });
      await loadChats(); switchSection('chats'); openChat(res.chat.id);
    } catch (err) { toast(err.message, 'error'); }
  }

  function openPollModal() {
    openModal('Создать опрос', `
      <form id="poll-form">
        <div class="field"><label>Вопрос опроса</label><input type="text" id="poll-q" placeholder="Например: Куда поедем на экскурсию?" required /></div>
        <div class="field"><label>Варианты (каждый с новой строки, минимум 2)</label><textarea id="poll-opts" rows="4" placeholder="Планетарий&#10;Музей&#10;Квест" required></textarea></div>
        <label class="list-row" style="margin-bottom:8px;cursor:pointer"><span>Несколько вариантов</span><input type="checkbox" id="poll-multi" style="width:auto" /></label>
        <label class="list-row" style="margin-bottom:14px;cursor:pointer"><span>Анонимный опрос</span><input type="checkbox" id="poll-anon" style="width:auto" /></label>
        <button type="submit" class="btn btn-primary full-width">Опубликовать</button>
      </form>
    `);
    $('#poll-form').onsubmit = async (e) => {
      e.preventDefault();
      const question = $('#poll-q').value.trim();
      const options = $('#poll-opts').value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) { toast('Добавьте минимум 2 варианта', 'error'); return; }
      try {
        await api(`/api/chats/${state.activeChatId}/messages`, {
          method: 'POST', body: { poll: { question, options, allowMultiple: $('#poll-multi').checked, isAnonymous: $('#poll-anon').checked } },
        });
        closeModal();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function openForwardModal(msg) {
    const targets = state.chats.filter((c) => c.canPost !== false);
    openModal('Переслать сообщение', `<div class="list-stack">${targets.map((c) => `
      <button type="button" class="list-row" data-fwd-chat="${c.id}"><span>${escapeHtml(c.title)}</span><span class="muted small">${ico('send', 14)}</span></button>
    `).join('')}</div>`);
    $$('[data-fwd-chat]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/api/chats/${btn.dataset.fwdChat}/messages`, {
            method: 'POST', body: { content: msg.content || '[Вложение]', forwardedFrom: msg.sender?.displayName || 'Участник' },
          });
          toast('Сообщение переслано', 'success'); closeModal();
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  // CHAT INFO: paint from the current chat cache first; refresh members in the background.
  function renderChatInfoContent(chat, members, membersLoading, chatId, token) {
    if (!chat || token !== state.chatInfoToken) return;
    const memberIdsSet = new Set((members || []).map((m) => m.id));
    const canManageMembers = chat.type === 'group' && ['owner', 'admin'].includes(chat.memberRole);
    const addable = canManageMembers
      ? state.users.filter((u) => !memberIdsSet.has(u.id) && (u.classId === state.user.classId || u.isFriend))
      : [];
    const isPeerBlocked = chat.type === 'dm' && chat.otherUser && state.blockedIds.has(chat.otherUser.id);
    const memberContent = members?.length
      ? `<div class="list-stack">${members.map((m) => `
          <div class="list-row">
            <div style="display:flex;align-items:center;gap:8px">
              ${renderAvatarHtml(m, 'avatar-sm')}
              <div>
                <div style="font-weight:600">${escapeHtml(m.displayName)} ${escapeHtml(m.statusEmoji || '')}</div>
                <div class="muted small">@${escapeHtml(m.username)} • ${formatLastSeen(m.lastSeen, m.isOnline)}</div>
              </div>
            </div>
            ${m.id !== state.user.id ? `<button type="button" class="btn btn-sm btn-ghost" data-info-dm="${escapeHtml(m.id)}">Написать</button>` : '<span class="tag">Вы</span>'}
          </div>`).join('')}</div>`
      : (membersLoading
          ? '<div class="muted small" id="info-members-loading">Загружаем участников…</div>'
          : '<div class="muted small">Список участников пока недоступен.</div>');

    $('#modal-title').textContent = 'Информация о чате';
    $('#modal-body').innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        ${renderAvatarHtml(chat.type === 'dm' && chat.otherUser ? chat.otherUser : chat, 'avatar-lg')}
        <div><h3>${escapeHtml(chat.title)}</h3><p class="muted small">${escapeHtml(chat.description || (chat.otherUser ? `@${chat.otherUser.username}` : ''))}</p></div>
      </div>
      <div class="inline-actions" style="margin-bottom:14px">
        <button type="button" id="info-pin-chat" class="btn btn-sm btn-ghost">${ico('pin', 14)} ${chat.pinned ? 'Открепить' : 'Закрепить'}</button>
        <button type="button" id="info-mute-chat" class="btn btn-sm btn-ghost">${chat.muted ? ico('bell', 14) + ' Вкл. звук' : ico('bellOff', 14) + ' Без звука'}</button>
        ${chat.type === 'dm' && chat.otherUser ? `<button type="button" id="info-block-peer" class="btn btn-sm btn-danger">${ico('ban', 14)} ${isPeerBlocked ? 'Разблокировать' : 'В ЧС'}</button>` : ''}
        ${chat.type === 'group' ? '<button type="button" id="info-leave-group" class="btn btn-sm btn-danger">Покинуть группу</button>' : ''}
      </div>
      ${canManageMembers ? `
        <div style="margin-bottom:16px;padding:12px;border-radius:13px;background:var(--bg-input)">
          <div style="font-weight:700;font-size:13.5px;margin-bottom:8px" class="ico-title">${ico('userPlus', 15)} Добавить участника в группу</div>
          ${addable.length === 0
            ? '<p class="muted small">Все ваши друзья и одноклассники уже в группе.</p>'
            : `<div class="inline-actions">
                <select id="group-add-member-select" class="select-input" style="flex:1;min-width:160px;padding:7px 10px">
                  ${addable.map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.displayName)} (@${escapeHtml(u.username)})</option>`).join('')}
                </select>
                <button type="button" id="btn-group-add-member" class="btn btn-sm btn-primary">Добавить</button>
              </div>`}
        </div>` : ''}
      <h4 style="margin-bottom:8px">Участники (${members?.length || chat.memberCount || 0})</h4>
      <div id="chat-info-members">${memberContent}</div>
    `;

    $('#info-pin-chat').onclick = () => {
      const current = state.chats.find((x) => x.id === chatId);
      if (!current || state.pendingChatFlags.has(`${chatId}:pinned`)) return;
      closeModal();
      void saveChatFlag(chatId, 'pinned', !current.pinned);
    };
    $('#info-mute-chat').onclick = () => {
      const current = state.chats.find((x) => x.id === chatId);
      if (!current || state.pendingChatFlags.has(`${chatId}:muted`)) return;
      closeModal();
      void saveChatFlag(chatId, 'muted', !current.muted);
    };

    if ($('#btn-group-add-member')) {
      $('#btn-group-add-member').onclick = async () => {
        const select = $('#group-add-member-select');
        const button = $('#btn-group-add-member');
        const uid = select?.value;
        if (!uid || button.disabled) return;
        button.disabled = true;
        button.textContent = 'Добавляем…';
        try {
          await api(`/api/chats/${chatId}/members`, { method: 'POST', body: { userId: uid } });
          toast('Участник добавлен в группу', 'success');
          const latest = await api(`/api/chats/${chatId}/members`);
          if (token !== state.chatInfoToken) return;
          state.activeChatMembers = latest.members || [];
          state.chatMembersCache.set(chatId, state.activeChatMembers.slice());
          const current = state.chats.find((x) => x.id === chatId);
          if (current) current.memberCount = state.activeChatMembers.length;
          renderChatInfoContent(current || chat, state.activeChatMembers, false, chatId, token);
        } catch (err) {
          button.disabled = false;
          button.textContent = 'Добавить';
          toast(err.message || 'Не удалось добавить участника', 'error');
        }
      };
    }

    if ($('#info-block-peer')) {
      $('#info-block-peer').onclick = async () => {
        try {
          if (isPeerBlocked) {
            await api(`/api/privacy/block/${chat.otherUser.id}`, { method: 'DELETE' });
            state.blockedIds.delete(chat.otherUser.id);
            toast('Разблокирован', 'success');
          } else {
            await api(`/api/privacy/block/${chat.otherUser.id}`, { method: 'POST' });
            state.blockedIds.add(chat.otherUser.id);
            toast('Добавлен в ЧС');
          }
          closeModal();
        } catch (err) { toast(err.message || 'Не удалось обновить чёрный список', 'error'); }
      };
    }
    if ($('#info-leave-group')) {
      $('#info-leave-group').onclick = async () => {
        const button = $('#info-leave-group');
        button.disabled = true;
        try {
          await api(`/api/chats/${chatId}/members/${state.user.id}`, { method: 'DELETE' });
          state.activeChatId = null;
          $('#chat-active-container').classList.add('hidden');
          $('#chat-empty-state').classList.remove('hidden');
          closeModal();
          void loadChats();
        } catch (err) {
          button.disabled = false;
          toast(err.message || 'Не удалось покинуть группу', 'error');
        }
      };
    }
    $$('[data-info-dm]').forEach((b) => {
      b.onclick = async () => { const targetId = b.dataset.infoDm; closeModal(); await startDmWith(targetId); };
    });
  }

  function openChatInfoModal() {
    const chatId = Number(state.activeChatId);
    const chat = getActiveChat();
    if (!chatId || !chat) return;
    const token = ++state.chatInfoToken;
    const hasCachedMembers = state.chatMembersCache.has(chatId);
    const cachedMembers = hasCachedMembers
      ? state.chatMembersCache.get(chatId).slice()
      : (state.activeChatMembers || []).slice();

    // Open from the already-rendered chat summary; do not wait for a multi-query
    // full chat rebuild just to show the info sheet.
    openModal('Информация о чате', '');
    renderChatInfoContent(chat, cachedMembers, !hasCachedMembers, chatId, token);

    // Membership and presence are refreshed in the background. The user sees
    // the info panel immediately, and cached members remain visible meanwhile.
    api(`/api/chats/${chatId}/members`).then((data) => {
      if (token !== state.chatInfoToken || state.activeChatId !== chatId || $('#modal-overlay').classList.contains('hidden')) return;
      const members = data.members || [];
      state.activeChatMembers = members;
      state.chatMembersCache.set(chatId, members.slice());
      while (state.chatMembersCache.size > 12) state.chatMembersCache.delete(state.chatMembersCache.keys().next().value);
      renderChatInfoContent(state.chats.find((x) => x.id === chatId) || chat, members, false, chatId, token);
    }).catch((err) => {
      if (!hasCachedMembers && token === state.chatInfoToken && !$('#modal-overlay').classList.contains('hidden')) {
        $('#chat-info-members').innerHTML = '<div class="muted small">Не удалось загрузить участников. Закройте и откройте информацию ещё раз.</div>';
      }
      console.warn('[Chat info] Member refresh failed:', err);
    });
  }

  async function saveChatFlag(chatId, field, value) {
    const chat = state.chats.find((x) => x.id === chatId);
    if (!chat || !['muted', 'pinned'].includes(field)) return;
    const lockKey = `${chatId}:${field}`;
    if (state.pendingChatFlags.has(lockKey)) return;
    const previous = Boolean(chat[field]);
    const next = Boolean(value);
    chat[field] = next;
    state.pendingChatFlags.add(lockKey);
    if (field === 'pinned') sortChats();
    renderChatList();
    if (state.activeChatId === chatId) renderActiveChatHeader();
    try {
      await api(`/api/chats/${chatId}`, { method: 'PATCH', body: { [field]: next } });
    } catch (err) {
      chat[field] = previous;
      if (field === 'pinned') sortChats();
      renderChatList();
      if (state.activeChatId === chatId) renderActiveChatHeader();
      toast(err.message || 'Не удалось сохранить настройку чата', 'error');
    } finally {
      state.pendingChatFlags.delete(lockKey);
    }
  }

  // ==================== FRIENDS (DISCORD-STYLE), SCHEDULE, HOMEWORK, WIDGETS ====================
  function renderFriends() {
    const reqCard = $('#friend-requests-card');
    if (reqCard) {
      reqCard.classList.toggle('hidden', state.incomingRequests.length === 0);
      $('#friend-requests-list').innerHTML = state.incomingRequests.map((r) => `
        <div class="list-row" style="flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px">${renderAvatarHtml(r.user, 'avatar-sm')}<div><div style="font-weight:700">${escapeHtml(r.user.displayName)}</div><div class="muted small">@${escapeHtml(r.user.username)} • Класс ${escapeHtml(r.user.className)}</div></div></div>
          <div class="inline-actions">
            <button type="button" class="btn btn-sm btn-primary" data-accept-friend="${r.friendshipId}">Принять</button>
            <button type="button" class="btn btn-sm btn-danger" data-remove-friend="${r.friendshipId}">Отклонить</button>
          </div>
        </div>`).join('');
    }
    if ($('#friends-count')) $('#friends-count').textContent = `Друзей: ${state.friends.length}`;
    const fl = $('#friends-list');
    if (!fl) return;
    if (state.friends.length === 0) {
      fl.innerHTML = '<div class="muted small">У вас пока нет друзей. Найдите одноклассника или друга из другого класса по точному @логину выше.</div>';
      return;
    }
    fl.innerHTML = state.friends.map((f) => `
      <div class="classmate-card">
        ${renderAvatarHtml(f.user)}
        <div class="classmate-info">
          <div class="classmate-name">${escapeHtml(f.user.displayName)}</div>
          <div class="muted small">@${escapeHtml(f.user.username)} • Класс ${escapeHtml(f.user.className)}</div>
          <div class="muted small" style="${f.user.isOnline ? 'color:var(--success);font-weight:600' : ''}">${formatLastSeen(f.user.lastSeen, f.user.isOnline)}</div>
        </div>
        <div class="inline-actions">
          <button type="button" class="btn btn-sm btn-primary" data-cm-dm="${f.user.id}">${ico('chats', 14)}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-remove-friend="${f.friendshipId}" title="Удалить из друзей">${ico('close', 14)}</button>
        </div>
      </div>`).join('');
  }

  function renderSchedule() {
    $('#schedule-day-tabs').innerHTML = DAYS_RU.map((d) => `<button type="button" class="pill-tab ${d.id === state.selectedDay ? 'active' : ''}" data-day-id="${d.id}">${d.full}</button>`).join('');
    const dayLessons = state.schedule.filter((s) => s.day_of_week === state.selectedDay);
    const now = new Date(), todayDow = now.getDay(), nowMin = now.getHours() * 60 + now.getMinutes();
    let liveStatus = `Расписание класса • ${state.className}`;
    if (todayDow >= 1 && todayDow <= 6) {
      for (const l of state.schedule.filter((s) => s.day_of_week === todayDow)) {
        if (l.start_time && l.end_time) {
          const [sh, sm] = l.start_time.split(':').map(Number), [eh, em] = l.end_time.split(':').map(Number);
          if (nowMin >= sh * 60 + sm && nowMin < eh * 60 + em) { liveStatus = `Сейчас идёт: ${l.subject} (до звонка ${eh * 60 + em - nowMin} мин.)`; break; }
          if (nowMin < sh * 60 + sm) { liveStatus = `Следующий урок: ${l.subject} в ${l.start_time}`; break; }
        }
      }
    }
    $('#schedule-live-status').textContent = liveStatus;
    const canEdit = ['admin', 'teacher', 'leader'].includes(state.user?.role);
    const list = $('#schedule-list');
    if (dayLessons.length === 0) { list.innerHTML = `<div class="settings-card muted">На этот день уроки ещё не добавлены.${canEdit ? ' Нажмите «Добавить урок».' : ''}</div>`; return; }
    list.innerHTML = dayLessons.map((l) => {
      let cur = false;
      if (state.selectedDay === todayDow && l.start_time && l.end_time) {
        const [sh, sm] = l.start_time.split(':').map(Number), [eh, em] = l.end_time.split(':').map(Number);
        cur = nowMin >= sh * 60 + sm && nowMin < eh * 60 + em;
      }
      return `<div class="lesson-card ${cur ? 'current-lesson' : ''}">
        <div class="lesson-top"><span class="lesson-num">Урок №${l.lesson_number}${cur ? ' • СЕЙЧАС' : ''}</span><span class="lesson-time">${escapeHtml(l.start_time || '')}${l.end_time ? ` – ${escapeHtml(l.end_time)}` : ''}</span></div>
        <div class="lesson-subject">${escapeHtml(l.subject)}</div>
        <div class="lesson-meta">${l.room ? `<span>Каб. ${escapeHtml(l.room)}</span>` : ''}${l.teacher ? `<span>${escapeHtml(l.teacher)}</span>` : ''}</div>
        ${l.notes ? `<p class="muted small" style="margin-top:8px">${escapeHtml(l.notes)}</p>` : ''}
        ${canEdit ? `<div class="inline-actions" style="margin-top:10px"><button type="button" class="btn btn-sm btn-ghost" data-edit-lesson="${l.id}">Изменить</button><button type="button" class="btn btn-sm btn-danger" data-del-lesson="${l.id}">Удалить</button></div>` : ''}
      </div>`;
    }).join('');
  }

  function openLessonModal(lesson = null) {
    openModal(lesson ? 'Редактировать урок' : 'Добавить урок', `
      <form id="lesson-form">
        <div class="form-grid-2">
          <div class="field"><label>День недели</label><select id="les-day" class="select-input" style="width:100%">${DAYS_RU.map((d) => `<option value="${d.id}" ${(lesson?.day_of_week || state.selectedDay) === d.id ? 'selected' : ''}>${d.full}</option>`).join('')}</select></div>
          <div class="field"><label>Номер урока</label><input type="number" id="les-num" min="1" max="12" value="${lesson?.lesson_number || 1}" required /></div>
        </div>
        <div class="field"><label>Предмет</label><input type="text" id="les-subject" value="${escapeHtml(lesson?.subject || '')}" placeholder="Алгебра" required /></div>
        <div class="form-grid-2">
          <div class="field"><label>Начало</label><input type="time" id="les-start" value="${escapeHtml(lesson?.start_time || '08:30')}" /></div>
          <div class="field"><label>Конец</label><input type="time" id="les-end" value="${escapeHtml(lesson?.end_time || '09:15')}" /></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label>Кабинет</label><input type="text" id="les-room" value="${escapeHtml(lesson?.room || '')}" placeholder="204" /></div>
          <div class="field"><label>Учитель</label><input type="text" id="les-teacher" value="${escapeHtml(lesson?.teacher || '')}" placeholder="Иванова М.П." /></div>
        </div>
        <div class="field"><label>Заметка</label><input type="text" id="les-notes" value="${escapeHtml(lesson?.notes || '')}" /></div>
        <button type="submit" class="btn btn-primary full-width">Сохранить</button>
      </form>
    `);
    $('#lesson-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = { classId: state.user?.role === 'admin' ? state.selectedAcademicClassId : undefined, dayOfWeek: Number($('#les-day').value), lessonNumber: Number($('#les-num').value), subject: $('#les-subject').value.trim(), startTime: $('#les-start').value, endTime: $('#les-end').value, room: $('#les-room').value.trim(), teacher: $('#les-teacher').value.trim(), notes: $('#les-notes').value.trim() };
      try {
        if (lesson) await api(`/api/schedule/${lesson.id}`, { method: 'PATCH', body });
        else await api('/api/schedule', { method: 'POST', body });
        closeModal(); await loadSchedule();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function renderHomework() {
    const total = state.homework.length, done = state.homework.filter((h) => h.completed).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    $('#homework-progress-summary').textContent = total > 0 ? `Выполнено ${done} из ${total} заданий (${pct}%)` : 'Домашних заданий пока нет';
    $('#homework-progress-bar').style.width = `${pct}%`;
    const filtered = state.homework.filter((h) => (state.hwFilter === 'active' ? !h.completed : state.hwFilter === 'completed' ? h.completed : true));
    const todayIso = new Date().toISOString().slice(0, 10);
    const canEdit = ['admin', 'teacher', 'leader'].includes(state.user?.role);
    const list = $('#homework-list');
    if (filtered.length === 0) { list.innerHTML = '<div class="settings-card muted">В этой категории заданий нет.</div>'; return; }
    list.innerHTML = filtered.map((h) => `
      <div class="hw-card ${h.completed ? 'done' : ''}">
        <button type="button" class="hw-check" data-toggle-hw="${h.id}" ${state.homeworkPending.has(h.id) ? 'disabled aria-busy="true"' : ''} title="${h.completed ? 'Отметить как невыполненное' : 'Отметить выполненным'}">${h.completed ? ico('check', 14) : ''}</button>
        <div class="hw-body">
          <div class="hw-top"><span class="tag">${escapeHtml(h.subject)}</span>${h.priority === 'high' ? '<span class="tag tag-high">Важно</span>' : ''}${!h.completed && h.dueDate < todayIso ? '<span class="tag tag-overdue">Просрочено</span>' : ''}<span class="muted small">Срок: ${escapeHtml(h.dueDate)}</span></div>
          <div style="font-weight:700;font-size:15.5px;margin-bottom:4px">${escapeHtml(h.title)}</div>
          ${h.description ? `<p class="muted small" style="white-space:pre-wrap">${escapeHtml(h.description)}</p>` : ''}
          ${canEdit ? `<div class="inline-actions" style="margin-top:8px"><button type="button" class="btn btn-sm btn-ghost" data-edit-hw="${h.id}">Изменить</button><button type="button" class="btn btn-sm btn-danger" data-del-hw="${h.id}">Удалить</button></div>` : ''}
        </div>
      </div>`).join('');
  }

  function openHomeworkModal(hw = null) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    openModal(hw ? 'Редактировать ДЗ' : 'Новое домашнее задание', `
      <form id="hw-form">
        <div class="form-grid-2">
          <div class="field"><label>Предмет</label><input type="text" id="hw-subject" value="${escapeHtml(hw?.subject || '')}" required /></div>
          <div class="field"><label>Срок сдачи</label><input type="date" id="hw-due" value="${escapeHtml(hw?.dueDate || tomorrow)}" required /></div>
        </div>
        <div class="field"><label>Краткое задание</label><input type="text" id="hw-title" value="${escapeHtml(hw?.title || '')}" required /></div>
        <div class="field"><label>Подробности</label><textarea id="hw-desc" rows="3">${escapeHtml(hw?.description || '')}</textarea></div>
        <div class="field"><label>Приоритет</label><select id="hw-priority" class="select-input" style="width:100%"><option value="normal" ${hw?.priority !== 'high' ? 'selected' : ''}>Обычный</option><option value="high" ${hw?.priority === 'high' ? 'selected' : ''}>Высокий</option></select></div>
        <button type="submit" class="btn btn-primary full-width">Сохранить</button>
      </form>
    `);
    $('#hw-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = { classId: state.user?.role === 'admin' ? state.selectedAcademicClassId : undefined, subject: $('#hw-subject').value.trim(), title: $('#hw-title').value.trim(), description: $('#hw-desc').value.trim(), dueDate: $('#hw-due').value, priority: $('#hw-priority').value };
      try {
        if (hw) await api(`/api/homework/${hw.id}`, { method: 'PATCH', body });
        else await api('/api/homework', { method: 'POST', body });
        closeModal(); await loadHomework();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  function updatePomoUI() {
    $('#pomo-display').textContent = formatSeconds(state.pomoSeconds);
    $('#pomo-mode-badge').textContent = state.pomoIsBreak ? 'Перерыв 5 мин' : 'Учёба 25 мин';
    $('#pomo-start').textContent = state.pomoTimer ? 'Пауза' : 'Старт';
  }
  function renderGrades() {
    localStorage.setItem('mb_grades', JSON.stringify(state.grades));
    $('#grade-list-view').innerHTML = state.grades.map((g, i) => `<span class="grade-chip" data-rm-grade="${i}">${g}</span>`).join('');
    if (state.grades.length === 0) { $('#grade-avg-badge').textContent = '—'; $('#grade-advice').textContent = 'Добавьте оценки для прогноза.'; return; }
    const sum = state.grades.reduce((a, b) => a + b, 0), avg = sum / state.grades.length;
    $('#grade-avg-badge').textContent = avg.toFixed(2);
    if (avg >= 4.5) $('#grade-advice').textContent = 'Отличный результат — твёрдая пятёрка.';
    else {
      const target = avg >= 3.5 ? 4.5 : 3.5;
      const need5 = Math.max(0, Math.ceil((target * state.grades.length - sum) / (5 - target)));
      $('#grade-advice').textContent = `До ${target === 4.5 ? '5 (4.50)' : '4 (3.50)'} нужно пятёрок подряд: ${need5}.`;
    }
  }

  function renderClassmates() {
    const myClassOnly = state.users.filter((u) => state.user?.role === 'admin' || u.classId === state.user?.classId || u.role === 'admin');
    $('#classmates-count').textContent = state.user?.role === 'admin' ? `Всего в школе: ${myClassOnly.length}` : `В классе ${state.className}: ${myClassOnly.length}`;
    $('#classmates-list').innerHTML = myClassOnly.map((u) => `
      <div class="classmate-card">
        ${renderAvatarHtml(u)}
        <div class="classmate-info">
          <div class="classmate-name">${escapeHtml(u.displayName)} ${escapeHtml(u.statusEmoji || '')}</div>
          <div class="muted small">@${escapeHtml(u.username)} • ${escapeHtml(u.className || '')} • ${escapeHtml(ROLE_SHORT[u.role] || 'Ученик')}</div>
          <div class="muted small" style="${u.isOnline ? 'color:var(--success);font-weight:600' : ''}">${formatLastSeen(u.lastSeen, u.isOnline)}</div>
        </div>
        ${u.id !== state.user?.id ? `<div class="inline-actions">
          ${!u.isFriend ? `<button type="button" class="btn btn-sm btn-ghost" data-add-friend="${u.id}" title="В друзья">${ico('userPlus', 14)}</button>` : ''}
          <button type="button" class="btn btn-sm btn-primary" data-cm-dm="${u.id}">Написать</button>
        </div>` : '<span class="tag">Вы</span>'}
      </div>`).join('');
  }

  // ==================== SETTINGS & ADMIN ====================
  function hydrateSettingsUI() {
    const u = state.user, s = state.settings;
    if (!u || !s) return;
    $('#rail-profile-btn').innerHTML = renderAvatarHtml(u, 'avatar-sm');
    $('#settings-avatar-preview').outerHTML = renderAvatarHtml(u, 'avatar-lg').replace('<div class="avatar', '<div id="settings-avatar-preview" class="avatar');
    $('#settings-profile-name').textContent = `${u.displayName} ${u.statusEmoji || ''}`;
    $('#settings-profile-meta').textContent = `@${u.username} • ${u.email} • Класс ${u.className || state.className} • ${ROLE_LABELS[u.role] || 'Ученик'}`;

    $('#prof-display-name').value = u.displayName || '';
    $('#prof-username').value = u.username || '';
    $('#prof-status-emoji').value = u.statusEmoji || '';
    $('#prof-avatar-color').value = u.avatarColor || '#2AABEE';
    $('#prof-bio').value = u.bio || '';

    $$('#pref-theme-group button').forEach((b) => b.classList.toggle('active', b.dataset.themeVal === s.theme));
    $$('#pref-accent-group button').forEach((b) => b.classList.toggle('active', b.dataset.accentVal === s.accent));
    $('#pref-wallpaper').value = s.wallpaper;
    if ($('#pref-bubble-style')) $('#pref-bubble-style').value = s.bubbleStyle || 'classic';
    $('#pref-font-size').value = String(s.fontSize);
    $('#pref-bubble-radius').value = String(s.bubbleRadius);
    if ($('#pref-animations')) $('#pref-animations').checked = s.animationsEnabled !== false;
    if ($('#pref-large-emojis')) $('#pref-large-emojis').checked = s.largeEmojis !== false;
    $('#pref-compact-mode').checked = s.compactMode;
    $('#pref-send-on-enter').checked = s.sendOnEnter;

    $('#priv-last-seen').value = s.showLastSeen;
    $('#priv-allow-dm').value = s.allowDm;
    $('#priv-allow-group').value = s.allowGroupAdd;
    if ($('#priv-allow-friends')) $('#priv-allow-friends').value = s.allowFriendRequests || 'all';
    if ($('#priv-show-typing')) $('#priv-show-typing').checked = s.showTyping !== false;
    $('#priv-read-receipts').checked = s.showReadReceipts;
    if ($('#priv-hide-preview')) $('#priv-hide-preview').checked = Boolean(s.hideNotifPreview);
    $('#btn-remove-pin').classList.toggle('hidden', !s.hasAppLockPin);

    $('#notif-sound').checked = s.soundEnabled;
    $('#notif-desktop').checked = s.desktopNotifications;

    const isAdmin = u.role === 'admin', isManager = u.role === 'admin' || u.role === 'teacher';
    const isAcad = ['admin', 'teacher', 'leader'].includes(u.role);
    $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !isAdmin));
    $$('.manager-only').forEach((el) => el.classList.toggle('hidden', !isManager));
    $$('.academic-editor-only').forEach((el) => el.classList.toggle('hidden', !isAcad));
    if ($('#tab-btn-manage')) $('#tab-btn-manage').innerHTML = `${ico('shield', 15)} ${isAdmin ? 'Администрирование' : 'Мой класс'}`;
    if ($('#rail-admin-label')) $('#rail-admin-label').textContent = isAdmin ? 'Админ' : 'Класс';
    populateClassSelectors();
  }

  function populateClassSelectors() {
    const opts = state.classes.map((c) => `<option value="${c.id}" ${c.id === state.selectedAcademicClassId ? 'selected' : ''}>Класс ${escapeHtml(c.name)}</option>`).join('');
    if ($('#schedule-class-select')) $('#schedule-class-select').innerHTML = opts;
    if ($('#homework-class-select')) $('#homework-class-select').innerHTML = opts;
  }

  function syncSettingsChoiceButtons(settings = state.settings) {
    if (!settings) return;
    $$('#pref-theme-group [data-theme-val]').forEach((b) => b.classList.toggle('active', b.dataset.themeVal === settings.theme));
    $$('#pref-accent-group [data-accent-val]').forEach((b) => b.classList.toggle('active', b.dataset.accentVal === settings.accent));
  }

  let settingsSaveQueue = Promise.resolve();
  let settingsSaveRevision = 0;
  let confirmedSettings = null;
  async function saveSettingPatch(patch) {
    if (!state.settings) return;
    if (!confirmedSettings) confirmedSettings = { ...state.settings };
    const next = { ...state.settings, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'appLockPin')) next.hasAppLockPin = Boolean(patch.appLockPin);
    if (patch.removeAppLockPin) next.hasAppLockPin = false;
    const revision = ++settingsSaveRevision;
    applySettings(next);
    syncSettingsChoiceButtons(next);

    const fullPatch = {
      theme: next.theme, accent: next.accent, wallpaper: next.wallpaper,
      fontSize: next.fontSize, bubbleRadius: next.bubbleRadius, bubbleStyle: next.bubbleStyle,
      compactMode: next.compactMode, animationsEnabled: next.animationsEnabled,
      largeEmojis: next.largeEmojis, sendOnEnter: next.sendOnEnter,
      soundEnabled: next.soundEnabled, desktopNotifications: next.desktopNotifications,
      hideNotifPreview: next.hideNotifPreview, showLastSeen: next.showLastSeen,
      showTyping: next.showTyping, allowDm: next.allowDm, allowGroupAdd: next.allowGroupAdd,
      allowFriendRequests: next.allowFriendRequests, showReadReceipts: next.showReadReceipts,
    };
    if (Object.prototype.hasOwnProperty.call(patch, 'appLockPin')) fullPatch.appLockPin = patch.appLockPin;
    if (patch.removeAppLockPin) fullPatch.removeAppLockPin = true;

    const task = settingsSaveQueue.then(async () => {
      const res = await api('/api/settings', { method: 'PATCH', body: fullPatch });
      confirmedSettings = { ...res.settings };
      if (revision === settingsSaveRevision) { applySettings(res.settings); hydrateSettingsUI(); }
    }).catch((err) => {
      if (revision === settingsSaveRevision) { applySettings(confirmedSettings || state.settings); hydrateSettingsUI(); toast(err.message, 'error'); }
    });
    settingsSaveQueue = task.catch(() => {});
    await task;
  }

  async function loadPrivacyLists() {
    try {
      const [blk, ses] = await Promise.all([api('/api/privacy/blocked'), api('/api/auth/sessions')]);
      state.blockedIds = new Set(blk.blocked.map((b) => b.id));
      $('#blocked-users-list').innerHTML = blk.blocked.length === 0 ? '<span class="muted small">Чёрный список пуст</span>'
        : blk.blocked.map((u) => `<div class="list-row"><span>${escapeHtml(u.displayName)} (@${escapeHtml(u.username)})</span><button type="button" class="btn btn-sm btn-ghost" data-unblock="${u.id}">Разблокировать</button></div>`).join('');
      $('#sessions-list').innerHTML = ses.sessions.map((s) => `<div class="list-row"><div><div style="font-weight:600;font-size:13.5px">${s.isCurrent ? 'Текущее устройство' : 'Другая сессия'}</div><div class="muted small">${escapeHtml(s.deviceInfo.slice(0, 68))}</div></div><span class="tag">Активна</span></div>`).join('');
    } catch {}
  }

  async function loadDedicatedAdminPanel() {
    if (state.user?.role !== 'admin' && state.user?.role !== 'teacher') return;
    try {
      const [st, usersData] = await Promise.all([api('/api/manage/stats'), api('/api/users')]);
      state.users = usersData.users || state.users;
      const onlineNow = typeof st.online === 'number' ? st.online : state.users.filter((u) => u.isOnline).length;
      if ($('#badge-online')) { $('#badge-online').textContent = String(onlineNow); $('#badge-online').classList.remove('hidden'); }
      if ($('#mbadge-online')) { $('#mbadge-online').textContent = String(onlineNow); $('#mbadge-online').classList.remove('hidden'); }
      if ($('#admin-page-title')) $('#admin-page-title').textContent = state.user.role === 'admin' ? 'Админ-панель' : `Управление классом ${state.className}`;
      if ($('#adm-stats-title')) $('#adm-stats-title').textContent = `Статистика • ${st.scopeLabel || 'Вся школа'}`;
      if ($('#adm-stats-grid')) {
        $('#adm-stats-grid').innerHTML =
          `<div class="stat-box"><div class="stat-val" style="color:var(--success)">${onlineNow}</div><div class="stat-lbl">В сети сейчас</div></div>` +
          `<div class="stat-box"><div class="stat-val">${st.users ?? state.users.length}</div><div class="stat-lbl">Пользователей</div></div>` +
          (st.scope === 'school' ? `<div class="stat-box"><div class="stat-val">${st.classes ?? state.classes.length}</div><div class="stat-lbl">Классов</div></div>` : `<div class="stat-box"><div class="stat-val">${st.leaders ?? 0}</div><div class="stat-lbl">Старост</div></div>`) +
          `<div class="stat-box"><div class="stat-val">${st.messages ?? '—'}</div><div class="stat-lbl">Сообщений</div></div>` +
          `<div class="stat-box"><div class="stat-val">${st.homework ?? 0}</div><div class="stat-lbl">ДЗ</div></div>`;
      }
      if ($('#adm-classes-chips')) $('#adm-classes-chips').innerHTML = state.classes.map((c) => `<span class="tag">${escapeHtml(c.name)}</span>`).join('');
      renderDedicatedAdminPanel();
    } catch {}
  }

  function renderDedicatedAdminPanel() {
    const el = $('#adm-users-list');
    if (!el || !state.user) return;
    const isAdmin = state.user.role === 'admin';
    const q = ($('#adm-user-search')?.value || '').trim().toLowerCase();
    const filter = $('#adm-user-filter')?.value || 'all';
    let list = isAdmin ? state.users : state.users.filter((u) => u.classId === state.user.classId);
    const onlineCount = list.filter((u) => u.isOnline).length;
    if ($('#adm-users-heading')) $('#adm-users-heading').textContent = `Все пользователи (${list.length}) • В сети: ${onlineCount}`;
    if ($('#badge-online')) { $('#badge-online').textContent = String(onlineCount); $('#badge-online').classList.remove('hidden'); }
    if ($('#mbadge-online')) { $('#mbadge-online').textContent = String(onlineCount); $('#mbadge-online').classList.remove('hidden'); }

    list = list.filter((u) => {
      if (filter === 'online' && !u.isOnline) return false;
      if (['admin', 'teacher', 'leader', 'student'].includes(filter) && u.role !== filter) return false;
      if (q && !(u.displayName + ' ' + u.username + ' ' + (u.email || '') + ' ' + (u.className || '')).toLowerCase().includes(q)) return false;
      return true;
    });
    if (list.length === 0) { el.innerHTML = '<div class="muted small" style="padding:12px">Пользователи не найдены.</div>'; return; }
    el.innerHTML = list.map((u) => {
      const st = u.isOnline ? '<span style="color:var(--success);font-weight:600">в сети</span>' : escapeHtml(formatLastSeen(u.lastSeen, false));
      const left = `<div style="display:flex;align-items:center;gap:10px;min-width:0">${renderAvatarHtml(u, 'avatar-sm')}<div style="min-width:0"><div style="font-weight:700">${escapeHtml(u.displayName)} <span class="muted small">@${escapeHtml(u.username)}</span></div><div class="muted small">${st} • Класс ${escapeHtml(u.className || '7Б')}${u.email ? ' • ' + escapeHtml(u.email) : ''}</div></div></div>`;
      if (u.id === state.user.id) return `<div class="list-row" style="flex-wrap:wrap">${left}<span class="tag">Вы • ${escapeHtml(ROLE_SHORT[u.role] || '')}</span></div>`;
      if (isAdmin) {
        const clsOpts = state.classes.map((c) => `<option value="${c.id}" ${c.id === u.classId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
        return `<div class="list-row" style="flex-wrap:wrap">${left}<div class="inline-actions">
          <select class="select-input" style="min-width:85px;padding:6px 8px" data-adm-class="${u.id}">${clsOpts}</select>
          <select class="select-input" style="min-width:135px;padding:6px 8px" data-adm-role="${u.id}">
            <option value="student" ${u.role === 'student' ? 'selected' : ''}>Ученик</option>
            <option value="leader" ${u.role === 'leader' ? 'selected' : ''}>Староста</option>
            <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>Классрук</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Админ</option>
          </select>
          <button type="button" class="btn btn-sm btn-ghost" data-adm-dm="${u.id}" title="Написать">${ico('chats', 15)}</button>
        </div></div>`;
      }
      const canT = ['student', 'leader'].includes(u.role) && u.classId === state.user.classId;
      return `<div class="list-row" style="flex-wrap:wrap">${left}<div class="inline-actions">${canT ? `<button type="button" class="btn btn-sm ${u.role === 'leader' ? 'btn-danger' : 'btn-primary'}" data-adm-leader="${u.id}" data-next-role="${u.role === 'leader' ? 'student' : 'leader'}">${u.role === 'leader' ? 'Снять старосту' : 'Назначить старостой'}</button>` : `<span class="tag">${escapeHtml(ROLE_SHORT[u.role] || '')}</span>`}<button type="button" class="btn btn-sm btn-ghost" data-adm-dm="${u.id}">${ico('chats', 15)}</button></div></div>`;
    }).join('');
  }

  function renderAdminUsers() {
    const el = $('#admin-users-list');
    if (!el || !state.user) return;
    const isAdmin = state.user.role === 'admin';
    $('#manage-users-title').textContent = isAdmin ? 'Управление пользователями' : `Ученики класса ${state.className}`;
    const list = isAdmin ? state.users : state.users.filter((u) => u.classId === state.user.classId && ['student', 'leader'].includes(u.role));
    el.innerHTML = list.map((u) => `<div class="list-row"><div><div style="font-weight:600">${escapeHtml(u.displayName)} <span class="muted small">@${escapeHtml(u.username)}</span></div><div class="muted small">Класс ${escapeHtml(u.className || '')} • ${escapeHtml(ROLE_LABELS[u.role] || '')}</div></div>${u.id === state.user.id ? '<span class="tag">Вы</span>' : `<button type="button" class="btn btn-sm btn-ghost" onclick="document.querySelector('[data-section=admin]').click()">Открыть в Админке</button>`}</div>`).join('');
  }

  // ==================== NAVIGATION & BOOT ====================
  function switchSection(section) {
    if (section === 'announcements') {
      switchSection('chats');
      const ann = state.chats.find((c) => c.type === 'announcements') || state.chats.find((c) => c.type === 'school_announcements');
      if (ann) openChat(ann.id);
      $$('.rail-btn, .mnav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === 'announcements'));
      return;
    }
    state.activeSection = section;
    if (section !== 'chats') $('#app-shell')?.classList.remove('in-mobile-chat');
    $$('.section-view').forEach((v) => v.classList.toggle('active', v.id === `section-${section}`));
    $$('.rail-btn, .mnav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
    if (section === 'admin') loadDedicatedAdminPanel();
    else if (section === 'settings') { hydrateSettingsUI(); }
    else if (section === 'schedule') renderSchedule();
    else if (section === 'homework') renderHomework();
    else if (section === 'widgets') { loadFriends(); renderClassmates(); }
  }

  async function enterApp(meData) {
    state.user = meData.user;
    state.classes = meData.classes || state.classes;
    state.className = meData.user.className || meData.defaultClass || '7Б';
    state.selectedAcademicClassId = meData.user.classId || state.classes[0]?.id || null;
    state.blockedIds = new Set(meData.blockedIds || []);
    applySettings(meData.settings);
    confirmedSettings = { ...meData.settings };

    $('#sidebar-class-title').textContent = `Класс ${state.className}`;
    $('#auth-view').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    if (state.settings?.hasAppLockPin && sessionStorage.getItem('mb_pin_unlocked') !== '1') $('#pin-lock-screen').classList.remove('hidden');

    hydrateSettingsUI(); updateNotifPromptUI(); renderEmojiGrid(); connectRealtime();
    await refreshAllData();
    // Retry subscription sync after authentication is ready (the early SW boot can race login).
    if (window.MESSENGER_B_CONFIG?.VAPID_PUBLIC_KEY && 'Notification' in window && Notification.permission === 'granted') {
      ensureWebPushSubscription().catch((err) => console.warn('[Web Push] Post-login subscription sync:', err));
    }
    const requestedChatId = Number(new URLSearchParams(location.search).get('openChat'));
    const requestedChat = requestedChatId ? state.chats.find((c) => c.id === requestedChatId) : null;
    const general = state.chats.find((c) => c.type === 'class' && c.classId === state.user.classId) || state.chats.find((c) => c.type === 'class') || state.chats[0];
    if (requestedChat) {
      openChat(requestedChat.id);
      history.replaceState({}, '', location.pathname);
    } else if (general && window.innerWidth > 820) openChat(general.id);
  }

  async function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(async () => {
        const publicKey = window.MESSENGER_B_CONFIG?.VAPID_PUBLIC_KEY || '';
        if (publicKey && 'Notification' in window && Notification.permission === 'granted') {
          try { await ensureWebPushSubscription(); } catch (err) { console.warn('[Web Push] Subscription sync:', err); }
          updateNotifPromptUI();
        }
      }).catch((err) => console.warn('[Service Worker] Registration failed:', err));
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); state.deferredInstallPrompt = e;
      $('#pwa-install-btn-auth').classList.remove('hidden'); $('#pwa-install-btn-settings').classList.remove('hidden');
    });
    const notesEl = $('#quick-notes-area');
    notesEl.value = localStorage.getItem('mb_quick_notes') || '';
    notesEl.addEventListener('input', () => localStorage.setItem('mb_quick_notes', notesEl.value));
    renderGrades(); updatePomoUI();

    try {
      const cfg = await api('/api/config');
      state.className = cfg.defaultClass || '7Б'; state.classes = cfg.classes || [];
      $('#auth-class-name').textContent = `Основной класс ${state.className} • Учебный мессенджер`;
      const regSel = $('#reg-class-select');
      if (regSel && state.classes.length > 0) {
        regSel.innerHTML = state.classes.map((c) => `<option value="${c.id}" ${c.id === cfg.defaultClassId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
      }
    } catch {}

    try {
      const me = await api('/api/auth/me');
      await enterApp(me);
    } catch {
      $('#app-shell').classList.add('hidden');
      $('#auth-view').classList.remove('hidden');
    }
  }

  // ==================== EVENT LISTENERS ====================
  $$('.auth-tab').forEach((btn) => btn.addEventListener('click', () => {
    $$('.auth-tab').forEach((b) => b.classList.remove('active')); btn.classList.add('active');
    $('#login-form').classList.toggle('hidden', btn.dataset.authTab !== 'login');
    $('#register-form').classList.toggle('hidden', btn.dataset.authTab !== 'register');
  }));
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const errEl = $('#login-error'); errEl.classList.add('hidden');
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/login', { method: 'POST', body: { identifier: fd.get('identifier'), password: fd.get('password') } });
      await enterApp(await api('/api/auth/me'));
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  });
  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const errEl = $('#register-error'); errEl.classList.add('hidden');
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/register', { method: 'POST', body: { displayName: fd.get('displayName'), username: fd.get('username'), email: fd.get('email'), password: fd.get('password') } });
      await enterApp(await api('/api/auth/me'));
      toast('Добро пожаловать в Мессенджер Б!', 'success');
    } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  });

  $('#pin-unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api('/api/settings/verify-pin', { method: 'POST', body: { pin: $('#pin-unlock-input').value.trim() } });
    if (res.valid) { sessionStorage.setItem('mb_pin_unlocked', '1'); $('#pin-lock-screen').classList.add('hidden'); $('#pin-unlock-input').value = ''; }
    else { $('#pin-unlock-error').textContent = 'Неверный PIN-код'; $('#pin-unlock-error').classList.remove('hidden'); }
  });
  $('#quick-lock-btn').addEventListener('click', () => { sessionStorage.removeItem('mb_pin_unlocked'); $('#pin-lock-screen').classList.remove('hidden'); $('#pin-unlock-input').focus(); });

  $$('.rail-btn[data-section], .mnav-btn[data-section]').forEach((b) => b.addEventListener('click', () => switchSection(b.dataset.section)));
  $('#rail-profile-btn').addEventListener('click', () => switchSection('settings'));
  $('#quick-theme-btn').addEventListener('click', () => saveSettingPatch({ theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark' }));
  $('#mobile-theme-btn')?.addEventListener('click', () => $('#quick-theme-btn').click());

  $('#chat-search-input').addEventListener('input', renderChatList);
  $('#chat-folders').addEventListener('click', (e) => {
    const b = e.target.closest('.folder-pill'); if (!b) return;
    state.activeFolder = b.dataset.folder; $$('.folder-pill').forEach((p) => p.classList.toggle('active', p === b)); renderChatList();
  });
  $('#chat-list').addEventListener('click', (e) => { const item = e.target.closest('.chat-item'); if (item) openChat(Number(item.dataset.chatId)); });
  $('#btn-new-chat').addEventListener('click', openNewChatModal);
  $('#mobile-back-btn').addEventListener('click', () => { saveCurrentDraft(); $('#section-chats').classList.remove('mobile-chat-open'); $('#app-shell').classList.remove('in-mobile-chat'); renderChatList(); });

  $('#btn-chat-info').addEventListener('click', openChatInfoModal);
  $('#chat-header-info').addEventListener('click', openChatInfoModal);
  $('#btn-chat-mute').addEventListener('click', () => { const c = getActiveChat(); if (!c || state.pendingChatFlags.has(`${c.id}:muted`)) return; void saveChatFlag(c.id, 'muted', !c.muted); });
  $('#btn-chat-search').addEventListener('click', () => { $('#in-chat-search-bar').classList.toggle('hidden'); $('#in-chat-search-input').focus(); });
  $('#in-chat-search-go').addEventListener('click', () => { const q = $('#in-chat-search-input').value.trim(); state.searchMode = Boolean(q); loadMessages(state.activeChatId, { q }); });
  $('#in-chat-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#in-chat-search-go').click(); });
  $('#in-chat-search-close').addEventListener('click', () => { $('#in-chat-search-bar').classList.add('hidden'); $('#in-chat-search-input').value = ''; if (state.searchMode) { state.searchMode = false; loadMessages(state.activeChatId); } });

  $('#pinned-bar-jump').addEventListener('click', () => { const c = getActiveChat(); if (c?.pinnedMessage) jumpToMessage(c.pinnedMessage.id); });
  $('#pinned-bar-unpin').addEventListener('click', async () => { if (state.activeChatId) await api(`/api/chats/${state.activeChatId}/pin`, { method: 'POST', body: { messageId: null } }).catch((err) => toast(err.message, 'error')); });

  $('#btn-load-older').addEventListener('click', async () => {
    if (state.loadingOlder || !state.hasMoreMessages || state.messages.length === 0) return;
    state.loadingOlder = true;
    try { await loadMessages(state.activeChatId, { before: state.messages[0].id }); } finally { state.loadingOlder = false; }
  });
  $('#messages-scroll').addEventListener('scroll', () => {
    const sc = $('#messages-scroll');
    if (sc.scrollTop < 60 && state.hasMoreMessages && !state.loadingOlder && !state.searchMode) $('#btn-load-older').click();
    $('#btn-scroll-bottom')?.classList.toggle('hidden', (sc.scrollHeight - sc.scrollTop - sc.clientHeight) < 260);
  });
  $('#btn-scroll-bottom')?.addEventListener('click', () => { const sc = $('#messages-scroll'); sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); });

  $('#messages-list').addEventListener('click', async (e) => {
    const mention = e.target.closest('[data-mention]');
    if (mention) {
      const uname = mention.dataset.mention;
      const found = state.users.find((u) => u.username.toLowerCase() === uname.toLowerCase()) || (await api(`/api/users/search?q=${encodeURIComponent(uname)}`)).user;
      if (found && found.id !== state.user.id) {
        openModal(`@${found.username}`, `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">${renderAvatarHtml(found, 'avatar-lg')}<div><h3>${escapeHtml(found.displayName)}</h3><div class="muted small">Класс ${escapeHtml(found.className)} • ${formatLastSeen(found.lastSeen, found.isOnline)}</div></div></div>
          <div class="inline-actions">
            <button type="button" id="mnt-dm" class="btn btn-primary btn-sm">Написать в ЛС</button>
            ${!found.isFriend ? `<button type="button" id="mnt-friend" class="btn btn-ghost btn-sm">Добавить в друзья</button>` : '<span class="tag">В друзьях</span>'}
          </div>
        `);
        $('#mnt-dm').onclick = () => { closeModal(); startDmWith(found.id); };
        if ($('#mnt-friend')) $('#mnt-friend').onclick = async () => { await api('/api/friends/request', { method: 'POST', body: { userId: found.id } }); toast('Заявка в друзья отправлена', 'success'); closeModal(); };
      }
      return;
    }
    const jump = e.target.closest('[data-jump-msg]'); if (jump) { jumpToMessage(Number(jump.dataset.jumpMsg)); return; }
    const lb = e.target.closest('[data-lightbox]'); if (lb) { $('#lightbox-img').src = lb.dataset.lightbox; $('#lightbox').classList.remove('hidden'); return; }
    const vp = e.target.closest('.voice-player'); if (vp && (e.target.closest('.voice-play-btn') || e.target.closest('.voice-speed-btn'))) { handleVoicePlayerClick(vp, e.target.closest('button')); return; }
    const po = e.target.closest('.poll-option'); if (po) { await api(`/api/polls/${po.dataset.pollId}/vote`, { method: 'POST', body: { optionIndex: Number(po.dataset.optIndex) } }).catch((err) => toast(err.message, 'error')); return; }
    const rc = e.target.closest('[data-react-msg]'); if (rc) { toggleReactionOptimistic(rc.dataset.reactMsg, rc.dataset.reactEmoji); return; }
    const qr = e.target.closest('[data-quick-reply]'); if (qr) { const m = state.messages.find((x) => String(x.id) === qr.dataset.quickReply); if (m) { state.replyTo = m; state.editingMsg = null; updateComposerContext(); $('#message-input').focus(); } return; }
    const ctx = e.target.closest('[data-open-ctx]'); if (ctx) { e.stopPropagation(); const r = ctx.getBoundingClientRect(); openMessageContextMenu(ctx.dataset.openCtx, r.left, r.bottom + 4); }
  });
  $('#messages-list').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.msg-row'); if (!row) return;
    e.preventDefault(); openMessageContextMenu(row.dataset.msgId, e.clientX, e.clientY);
  });

  $('#msg-context-menu').addEventListener('click', async (e) => {
    const menu = $('#msg-context-menu'), msgId = menu.dataset.msgId;
    const msg = state.messages.find((m) => String(m.id) === msgId);
    closeContextMenu(); if (!msg) return;
    const rBtn = e.target.closest('[data-ctx-react]');
    if (rBtn) { toggleReactionOptimistic(msgId, rBtn.dataset.ctxReact); return; }
    const act = e.target.closest('[data-ctx-act]')?.dataset.ctxAct;
    if (act === 'reply') { state.replyTo = msg; state.editingMsg = null; updateComposerContext(); $('#message-input').focus(); }
    else if (act === 'info') { openMessageInfoModal(msg.id); }
    else if (act === 'edit') { state.editingMsg = msg; state.replyTo = null; updateComposerContext(); $('#message-input').value = msg.content; autoResizeTextarea($('#message-input')); toggleSendVoiceButton(); $('#message-input').focus(); }
    else if (act === 'copy') { navigator.clipboard?.writeText(msg.content).then(() => toast('Скопировано', 'success')); }
    else if (act === 'forward') { openForwardModal(msg); }
    else if (act === 'pin') { await api(`/api/chats/${state.activeChatId}/pin`, { method: 'POST', body: { messageId: msg.id } }).catch((err) => toast(err.message, 'error')); }
    else if (act === 'delete') { await api(`/api/messages/${msg.id}`, { method: 'DELETE' }).catch((err) => toast(err.message, 'error')); }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#msg-context-menu')) closeContextMenu();
    if (!e.target.closest('#emoji-picker') && !e.target.closest('#btn-emoji-picker')) $('#emoji-picker')?.classList.add('hidden');
    if (!e.target.closest('#mention-popover') && e.target !== $('#message-input')) closeMentionPopover();
  });

  // Composer, Emoji Picker & @Mentions
  const msgInput = $('#message-input');
  msgInput.addEventListener('input', () => { autoResizeTextarea(msgInput); toggleSendVoiceButton(); saveCurrentDraft(); notifyTyping(); updateMentionPopover(); });
  msgInput.addEventListener('keydown', (e) => {
    const pop = $('#mention-popover');
    if (pop && !pop.classList.contains('hidden')) {
      const items = $$('#mention-popover .mention-item');
      if (e.key === 'ArrowDown') { e.preventDefault(); state.mentionIdx = (state.mentionIdx + 1) % items.length; items.forEach((it, i) => it.classList.toggle('active', i === state.mentionIdx)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); state.mentionIdx = (state.mentionIdx - 1 + items.length) % items.length; items.forEach((it, i) => it.classList.toggle('active', i === state.mentionIdx)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); const sel = items[state.mentionIdx]; if (sel) pickMention(sel.dataset.pickMention); return; }
      if (e.key === 'Escape') { closeMentionPopover(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && state.settings?.sendOnEnter !== false) { e.preventDefault(); sendCurrentMessage(); }
  });
  $('#mention-popover').addEventListener('click', (e) => { const it = e.target.closest('[data-pick-mention]'); if (it) pickMention(it.dataset.pickMention); });
  $('#btn-emoji-picker').addEventListener('click', (e) => { e.stopPropagation(); $('#emoji-picker').classList.toggle('hidden'); });
  $('#emoji-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-ecat]'); if (!t) return;
    state.emojiCat = t.dataset.ecat; $$('#emoji-tabs .emoji-tab').forEach((b) => b.classList.toggle('active', b === t)); renderEmojiGrid();
  });
  $('#emoji-grid').addEventListener('click', (e) => { const c = e.target.closest('[data-ins-emoji]'); if (c) insertAtCursor(msgInput, c.dataset.insEmoji); });
  $('#btn-send-msg').addEventListener('click', sendCurrentMessage);
  $('#composer-context-cancel').addEventListener('click', () => { state.replyTo = null; if (state.editingMsg) { state.editingMsg = null; msgInput.value = state.drafts[state.activeChatId] || ''; toggleSendVoiceButton(); } updateComposerContext(); });
  $('#btn-attach-file').addEventListener('click', () => $('#file-upload-input').click());
  $('#file-upload-input').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) uploadAndSendFile(f, false); e.target.value = ''; });
  $('#chat-pane').addEventListener('dragover', (e) => e.preventDefault());
  $('#chat-pane').addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && state.activeChatId) uploadAndSendFile(f, false); });
  $('#btn-voice-record').addEventListener('click', startVoiceRecording);
  $('#btn-voice-cancel').addEventListener('click', () => stopVoiceRecording(false));
  $('#btn-voice-send').addEventListener('click', () => stopVoiceRecording(true));
  $('#btn-create-poll').addEventListener('click', openPollModal);

  // Friends (Discord-style) events
  $('#friend-search-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#friend-search-input').value.trim().replace(/^@/, '');
    const box = $('#friend-search-result');
    box.innerHTML = '<span class="muted small">Поиск...</span>';
    try {
      const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (!res.user) { box.innerHTML = '<span class="muted small">Пользователь с таким точным @логином не найден.</span>'; return; }
      const u = res.user;
      box.innerHTML = `<div class="list-row" style="flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">${renderAvatarHtml(u, 'avatar-sm')}<div><div style="font-weight:700">${escapeHtml(u.displayName)}</div><div class="muted small">@${escapeHtml(u.username)} • Класс ${escapeHtml(u.className)}</div></div></div>
        <div class="inline-actions">
          ${u.isFriend ? '<span class="tag">Уже в друзьях</span>' : `<button type="button" class="btn btn-sm btn-primary" data-add-friend="${u.id}">Добавить в друзья</button>`}
          <button type="button" class="btn btn-sm btn-ghost" data-cm-dm="${u.id}">Написать</button>
        </div>
      </div>`;
    } catch (err) { box.innerHTML = `<span class="form-error">${escapeHtml(err.message)}</span>`; }
  });
  $('#section-widgets').addEventListener('click', async (e) => {
    const addF = e.target.closest('[data-add-friend]');
    if (addF) {
      try {
        const res = await api('/api/friends/request', { method: 'POST', body: { userId: addF.dataset.addFriend } });
        toast(res.status === 'accepted' ? 'Вы теперь друзья!' : 'Заявка в друзья отправлена', 'success');
        await loadFriends(); await loadUsers();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const accF = e.target.closest('[data-accept-friend]');
    if (accF) { await api(`/api/friends/${accF.dataset.acceptFriend}/accept`, { method: 'POST' }); toast('Заявка принята!', 'success'); await loadFriends(); await loadUsers(); return; }
    const remF = e.target.closest('[data-remove-friend]');
    if (remF) { await api(`/api/friends/${remF.dataset.removeFriend}`, { method: 'DELETE' }); toast('Обновлено'); await loadFriends(); await loadUsers(); return; }
    const dmB = e.target.closest('[data-cm-dm]');
    if (dmB) { startDmWith(dmB.dataset.cmDm); }
  });

  // Schedule, Homework, Widgets, Settings, Admin events
  $('#schedule-day-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-day-id]'); if (b) { state.selectedDay = Number(b.dataset.dayId); renderSchedule(); } });
  $('#btn-add-lesson').addEventListener('click', () => openLessonModal(null));
  $('#schedule-list').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit-lesson]'); if (ed) { const l = state.schedule.find((x) => x.id === Number(ed.dataset.editLesson)); if (l) openLessonModal(l); return; }
    const del = e.target.closest('[data-del-lesson]'); if (del) { await api(`/api/schedule/${del.dataset.delLesson}`, { method: 'DELETE' }); await loadSchedule(); }
  });
  $('#homework-filter-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-hw-filter]'); if (b) { state.hwFilter = b.dataset.hwFilter; $$('#homework-filter-tabs .pill-tab').forEach((t) => t.classList.toggle('active', t === b)); renderHomework(); } });
  $('#btn-add-homework').addEventListener('click', () => openHomeworkModal(null));
  $('#homework-list').addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-toggle-hw]');
    if (tog) {
      const id = Number(tog.dataset.toggleHw);
      const item = state.homework.find((x) => x.id === id);
      if (!item || state.homeworkPending.has(id)) return;
      const previous = Boolean(item.completed);
      item.completed = !previous;
      state.homeworkPending.add(id);
      renderHomework();
      updateNavBadges();
      try {
        const saved = await api(`/api/homework/${id}/toggle`, { method: 'POST' });
        if (typeof saved.completed === 'boolean') item.completed = saved.completed;
      } catch (err) {
        item.completed = previous;
        toast(err.message || 'Не удалось сохранить выполнение ДЗ', 'error');
      } finally {
        state.homeworkPending.delete(id);
        renderHomework();
        updateNavBadges();
      }
      return;
    }
    const ed = e.target.closest('[data-edit-hw]'); if (ed) { const h = state.homework.find((x) => x.id === Number(ed.dataset.editHw)); if (h) openHomeworkModal(h); return; }
    const del = e.target.closest('[data-del-hw]'); if (del) { await api(`/api/homework/${del.dataset.delHw}`, { method: 'DELETE' }); await loadHomework(); }
  });

  $('#pomo-start').addEventListener('click', () => {
    if (state.pomoTimer) { clearInterval(state.pomoTimer); state.pomoTimer = null; }
    else { state.pomoTimer = setInterval(() => { state.pomoSeconds--; if (state.pomoSeconds <= 0) { clearInterval(state.pomoTimer); state.pomoTimer = null; playNotificationSound(); toast(state.pomoIsBreak ? 'Перерыв окончен!' : 'Пора на перерыв 5 мин.', 'success'); state.pomoIsBreak = !state.pomoIsBreak; state.pomoSeconds = state.pomoIsBreak ? 300 : 1500; } updatePomoUI(); }, 1000); }
    updatePomoUI();
  });
  $('#pomo-reset').addEventListener('click', () => { clearInterval(state.pomoTimer); state.pomoTimer = null; state.pomoSeconds = state.pomoIsBreak ? 300 : 1500; updatePomoUI(); });
  $('#pomo-switch').addEventListener('click', () => { clearInterval(state.pomoTimer); state.pomoTimer = null; state.pomoIsBreak = !state.pomoIsBreak; state.pomoSeconds = state.pomoIsBreak ? 300 : 1500; updatePomoUI(); });
  $$('.grade-btn').forEach((b) => b.addEventListener('click', () => { state.grades.push(Number(b.dataset.grade)); renderGrades(); }));
  $('#grade-clear').addEventListener('click', () => { state.grades = []; renderGrades(); });
  $('#grade-list-view').addEventListener('click', (e) => { const c = e.target.closest('[data-rm-grade]'); if (c) { state.grades.splice(Number(c.dataset.rmGrade), 1); renderGrades(); } });

  $('#settings-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-settings-tab]'); if (!b) return;
    $$('#settings-tabs .pill-tab').forEach((t) => t.classList.toggle('active', t === b));
    $$('.settings-panel').forEach((p) => p.classList.toggle('active', p.id === `settings-tab-${b.dataset.settingsTab}`));
    if (b.dataset.settingsTab === 'privacy') loadPrivacyLists();
    if (b.dataset.settingsTab === 'admin') loadDedicatedAdminPanel();
  });
  $('#btn-upload-avatar').addEventListener('click', () => $('#avatar-upload-input').click());
  $('#avatar-upload-input').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const fd = new FormData(); fd.append('avatar', f); const res = await api('/api/profile/avatar', { method: 'POST', body: fd }); state.user = res.user; hydrateSettingsUI(); toast('Аватар обновлён', 'success'); }
    catch (err) { toast(err.message, 'error'); } e.target.value = '';
  });
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const res = await api('/api/profile', { method: 'PATCH', body: { displayName: $('#prof-display-name').value.trim(), username: $('#prof-username').value.trim(), statusEmoji: $('#prof-status-emoji').value.trim(), avatarColor: $('#prof-avatar-color').value, bio: $('#prof-bio').value.trim() } }); state.user = res.user; hydrateSettingsUI(); toast('Профиль сохранён', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: $('#pwd-current').value, newPassword: $('#pwd-new').value } }); e.target.reset(); toast('Пароль обновлён', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });

  $('#pref-theme-group').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-val]'); if (b) saveSettingPatch({ theme: b.dataset.themeVal }); });
  $('#pref-accent-group').addEventListener('click', (e) => { const b = e.target.closest('[data-accent-val]'); if (b) saveSettingPatch({ accent: b.dataset.accentVal }); });
  $('#pref-wallpaper').addEventListener('change', (e) => saveSettingPatch({ wallpaper: e.target.value }));
  $('#pref-bubble-style')?.addEventListener('change', (e) => saveSettingPatch({ bubbleStyle: e.target.value }));
  $('#pref-font-size').addEventListener('change', (e) => saveSettingPatch({ fontSize: Number(e.target.value) }));
  $('#pref-bubble-radius').addEventListener('change', (e) => saveSettingPatch({ bubbleRadius: Number(e.target.value) }));
  $('#pref-animations')?.addEventListener('change', (e) => saveSettingPatch({ animationsEnabled: e.target.checked }));
  $('#pref-large-emojis')?.addEventListener('change', (e) => saveSettingPatch({ largeEmojis: e.target.checked }));
  $('#pref-compact-mode').addEventListener('change', (e) => saveSettingPatch({ compactMode: e.target.checked }));
  $('#pref-send-on-enter').addEventListener('change', (e) => saveSettingPatch({ sendOnEnter: e.target.checked }));

  $('#priv-last-seen').addEventListener('change', (e) => saveSettingPatch({ showLastSeen: e.target.value }));
  $('#priv-allow-dm').addEventListener('change', (e) => saveSettingPatch({ allowDm: e.target.value }));
  $('#priv-allow-group').addEventListener('change', (e) => saveSettingPatch({ allowGroupAdd: e.target.value }));
  $('#priv-allow-friends')?.addEventListener('change', (e) => saveSettingPatch({ allowFriendRequests: e.target.value }));
  $('#priv-show-typing')?.addEventListener('change', (e) => saveSettingPatch({ showTyping: e.target.checked }));
  $('#priv-read-receipts').addEventListener('change', (e) => saveSettingPatch({ showReadReceipts: e.target.checked }));
  $('#priv-hide-preview')?.addEventListener('change', (e) => saveSettingPatch({ hideNotifPreview: e.target.checked }));

  $('#btn-set-pin').addEventListener('click', async () => { const pin = $('#priv-pin-input').value.trim(); if (!/^\d{4,6}$/.test(pin)) { toast('Введите 4–6 цифр', 'error'); return; } await saveSettingPatch({ appLockPin: pin }); sessionStorage.setItem('mb_pin_unlocked', '1'); $('#priv-pin-input').value = ''; toast('PIN установлен', 'success'); });
  $('#btn-remove-pin').addEventListener('click', async () => { await saveSettingPatch({ removeAppLockPin: true }); toast('PIN отключён', 'success'); });
  $('#blocked-users-list').addEventListener('click', async (e) => { const b = e.target.closest('[data-unblock]'); if (b) { await api(`/api/privacy/block/${b.dataset.unblock}`, { method: 'DELETE' }); toast('Разблокирован', 'success'); loadPrivacyLists(); } });
  $('#notif-sound').addEventListener('change', (e) => saveSettingPatch({ soundEnabled: e.target.checked }));
  $('#notif-desktop').addEventListener('change', async (e) => {
    if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const ok = await requestAndEnableNotifications();
      if (!ok) e.target.checked = false;
      return;
    }
    saveSettingPatch({ desktopNotifications: e.target.checked });
  });
  $('#btn-test-sound').addEventListener('click', playNotificationSound);
  $('#btn-test-notif')?.addEventListener('click', async () => {
    if (!('Notification' in window)) { toast('Браузер не поддерживает уведомления', 'error'); return; }
    if (Notification.permission !== 'granted') {
      const enabled = await requestAndEnableNotifications();
      if (!enabled) return;
    }
    try {
      const pushReady = await ensureWebPushSubscription();
      if (!pushReady) { toast('Сначала настройте VAPID и включите Push-подписку', 'error'); return; }
      await api('/api/push/test', { method: 'POST', body: {} });
      toast('Тестовый Push отправлен на ваши устройства', 'success');
    } catch (err) { toast(err.message || 'Тестовый Push не отправлен', 'error'); }
  });
  $('#mobile-notif-btn')?.addEventListener('click', requestAndEnableNotifications);
  $('#btn-enable-notif-banner')?.addEventListener('click', requestAndEnableNotifications);
  $('#btn-dismiss-notif-banner')?.addEventListener('click', () => { localStorage.setItem('mb_notif_dismissed', '1'); $('#notif-prompt-banner')?.classList.add('hidden'); });

  $('#schedule-class-select')?.addEventListener('change', (e) => { state.selectedAcademicClassId = Number(e.target.value); if ($('#homework-class-select')) $('#homework-class-select').value = e.target.value; loadSchedule(); loadHomework(); });
  $('#homework-class-select')?.addEventListener('change', (e) => { state.selectedAcademicClassId = Number(e.target.value); if ($('#schedule-class-select')) $('#schedule-class-select').value = e.target.value; loadSchedule(); loadHomework(); });
  $('#btn-refresh-admin')?.addEventListener('click', loadDedicatedAdminPanel);
  $('#adm-user-search')?.addEventListener('input', renderDedicatedAdminPanel);
  $('#adm-user-filter')?.addEventListener('change', renderDedicatedAdminPanel);
  $('#adm-btn-add-class')?.addEventListener('click', async () => {
    const inp = $('#adm-new-class-input'), name = inp.value.trim();
    if (name.length < 2) { toast('Введите название класса', 'error'); return; }
    try { const res = await api('/api/admin/classes', { method: 'POST', body: { name } }); state.classes = res.classes || state.classes; inp.value = ''; populateClassSelectors(); loadDedicatedAdminPanel(); loadChats(); toast(`Класс ${name} добавлен`, 'success'); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#adm-users-list')?.addEventListener('change', async (e) => {
    const cs = e.target.closest('[data-adm-class]'); if (cs) { try { await api(`/api/admin/users/${cs.dataset.admClass}/class`, { method: 'PATCH', body: { classId: Number(cs.value) } }); await loadDedicatedAdminPanel(); toast('Класс обновлён', 'success'); } catch (err) { toast(err.message, 'error'); } return; }
    const rs = e.target.closest('[data-adm-role]'); if (rs) { try { await api(`/api/manage/users/${rs.dataset.admRole}/role`, { method: 'PATCH', body: { role: rs.value } }); await loadDedicatedAdminPanel(); toast('Роль обновлена', 'success'); } catch (err) { toast(err.message, 'error'); } }
  });
  $('#adm-users-list')?.addEventListener('click', async (e) => {
    const dm = e.target.closest('[data-adm-dm]'); if (dm) { startDmWith(dm.dataset.admDm); return; }
    const lb = e.target.closest('[data-adm-leader]'); if (lb) { try { await api(`/api/manage/users/${lb.dataset.admLeader}/role`, { method: 'PATCH', body: { role: lb.dataset.nextRole } }); await loadDedicatedAdminPanel(); toast('Роль обновлена', 'success'); } catch (err) { toast(err.message, 'error'); } }
  });

  $('#btn-logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); sessionStorage.removeItem('mb_pin_unlocked'); location.reload(); });
  const triggerInstall = async () => { if (!state.deferredInstallPrompt) return; state.deferredInstallPrompt.prompt(); await state.deferredInstallPrompt.userChoice; state.deferredInstallPrompt = null; $('#pwa-install-btn-auth').classList.add('hidden'); $('#pwa-install-btn-settings').classList.add('hidden'); };
  $('#pwa-install-btn-auth').addEventListener('click', triggerInstall);
  $('#pwa-install-btn-settings').addEventListener('click', triggerInstall);
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', (e) => { if (e.target === $('#modal-overlay')) closeModal(); });
  $('#lightbox-close').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
  $('#lightbox').addEventListener('click', (e) => { if (e.target === $('#lightbox')) $('#lightbox').classList.add('hidden'); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data?.type === 'OPEN_CHAT' && ev.data.chatId) { switchSection('chats'); openChat(Number(ev.data.chatId)); }
    });
  }

  boot();
})();
