(() => {
  'use strict';

  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;

  const PushNotifications = cap.Plugins && cap.Plugins.PushNotifications;
  if (!PushNotifications) {
    console.error('[FCM] Capacitor PushNotifications plugin is not available');
    return;
  }

  let currentPerm = 'default';
  let tokenStatus = localStorage.getItem('mb_fcm_token') ? 'pending' : 'missing';
  let lastError = '';
  let listenersPromise = null;
  const tokenWaiters = [];

  function formatError(err) {
    if (!err) return 'Неизвестная ошибка';
    if (typeof err === 'string') return err;
    if (err.message) return String(err.message);
    if (err.error) return String(err.error);
    try { return JSON.stringify(err); } catch { return String(err); }
  }

  function resolveTokenWaiters(token) {
    while (tokenWaiters.length) {
      const waiter = tokenWaiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve(token);
    }
  }

  function rejectTokenWaiters(message) {
    while (tokenWaiters.length) {
      const waiter = tokenWaiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
  }

  // Подставляем Notification и PushManager до загрузки остальных скриптов.
  if (!('PushManager' in window)) {
    window.PushManager = function PushManager() {};
  }

  if (!('Notification' in window)) {
    function NativeNotification() {}
    Object.defineProperty(NativeNotification, 'permission', {
      get: () => currentPerm,
    });
    NativeNotification.requestPermission = async () => {
      try {
        await ensureListeners();
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
        currentPerm = perm.receive === 'granted' ? 'granted' : 'denied';
        if (currentPerm === 'granted') {
          tokenStatus = 'registering';
          lastError = '';
          await PushNotifications.register();
        }
      } catch (error) {
        currentPerm = 'denied';
        tokenStatus = 'error';
        lastError = formatError(error);
      }
      syncApkUi();
      return currentPerm;
    };
    window.Notification = NativeNotification;
  }

  const cfg = window.MESSENGER_B_CONFIG || {};
  const SUPABASE_URL = (cfg.SUPABASE_URL || localStorage.getItem('mb_sb_url') || '').trim();
  const SUPABASE_ANON_KEY = (cfg.SUPABASE_ANON_KEY || localStorage.getItem('mb_sb_key') || '').trim();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
    console.error('[FCM] Supabase client configuration is missing');
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: window.localStorage,
      storageKey: 'messenger-b-session-v1',
    },
  });

  function showToast(text, isError = false) {
    const box = document.getElementById('toast-container');
    if (!box) {
      alert(text);
      return;
    }
    const el = document.createElement('div');
    el.style.cssText = 'padding:10px 14px;border-radius:10px;color:#fff;margin-bottom:8px;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.35);background:' + (isError ? '#991b1b' : '#1e293b') + ';';
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  function syncApkUi() {
    const statusEl = document.getElementById('notif-perm-status');
    if (statusEl) {
      if (currentPerm !== 'granted') {
        statusEl.textContent = currentPerm === 'denied'
            ? 'Android (v6): разрешение на уведомления запрещено в настройках устройства'
            : 'Android (v6): ожидаем разрешение на уведомления';
      } else if (tokenStatus === 'saved') {
        statusEl.textContent = 'Android (v6): FCM-токен получен и сохранён на сервере';
      } else if (tokenStatus === 'waiting-auth') {
        statusEl.textContent = 'Android (v6): FCM-токен получен; войдите в аккаунт для привязки';
      } else if (tokenStatus === 'error') {
        statusEl.textContent = `Android (v6): ошибка FCM — ${lastError || 'нет ответа от Google'}`;
      } else {
        statusEl.textContent = 'Android (v6): запрашиваем FCM-токен у Google…';
      }
    }

    if (currentPerm === 'granted') {
      document.getElementById('notif-prompt-banner')?.classList.add('hidden');
      document.getElementById('mobile-notif-btn')?.classList.add('hidden');
    }
  }

  async function saveFcmToken(token) {
    if (!token) {
      tokenStatus = 'missing';
      syncApkUi();
      return false;
    }

    const previousToken = localStorage.getItem('mb_fcm_token');
    localStorage.setItem('mb_fcm_token', token);
    tokenStatus = 'pending';
    lastError = '';
    syncApkUi();

    const { data: { session } } = await sb.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      tokenStatus = 'waiting-auth';
      syncApkUi();
      return false;
    }

    if (previousToken && previousToken !== token) {
      await sb.from('push_subscriptions')
          .delete()
          .eq('user_id', userId)
          .eq('endpoint', `fcm://${previousToken}`);
    }

    const { error } = await sb.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: `fcm://${token}`,
      p256dh: 'fcm',
      auth: 'fcm',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

    if (error) {
      tokenStatus = 'error';
      lastError = `Supabase: ${error.message}`;
      syncApkUi();
      return false;
    }

    tokenStatus = 'saved';
    lastError = '';
    syncApkUi();
    return true;
  }

  function ensureListeners() {
    if (listenersPromise) return listenersPromise;
    listenersPromise = (async () => {
      await Promise.resolve(PushNotifications.addListener('registration', (token) => {
        const val = typeof token === 'string' ? token : (token && token.value);
        if (!val) {
          tokenStatus = 'error';
          lastError = 'Firebase вернул пустой токен';
          syncApkUi();
          rejectTokenWaiters(lastError);
          return;
        }
        localStorage.setItem('mb_fcm_token', val);
        resolveTokenWaiters(val);
        saveFcmToken(val).catch((error) => {
          tokenStatus = 'error';
          lastError = formatError(error);
          syncApkUi();
        });
      }));

      await Promise.resolve(PushNotifications.addListener('registrationError', (error) => {
        tokenStatus = 'error';
        lastError = `Google FCM: ${formatError(error)}`;
        syncApkUi();
        rejectTokenWaiters(lastError);
      }));

      await Promise.resolve(PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const chatId = action?.notification?.data?.chatId;
        if (chatId) {
          window.location.href = `/?openChat=${encodeURIComponent(chatId)}`;
        }
      }));
    })();
    return listenersPromise;
  }

  async function requestFcmToken(timeoutMs = 10000) {
    await ensureListeners();

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
    currentPerm = perm.receive === 'granted' ? 'granted' : 'denied';
    if (currentPerm !== 'granted') {
      throw new Error('Разрешите уведомления в настройках Android');
    }

    tokenStatus = 'registering';
    lastError = '';
    syncApkUi();

    const waitPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = tokenWaiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) tokenWaiters.splice(idx, 1);
        reject(new Error('Таймаут 10с: Google Play Services не выдал токен (проверь VPN/сеть)'));
      }, timeoutMs);
      tokenWaiters.push({ resolve, reject, timer });
    });

    await PushNotifications.register();
    return await waitPromise;
  }

  async function enableNativePush() {
    try {
      const token = await requestFcmToken(10000);
      const saved = await saveFcmToken(token);

      const { data: { session } } = await sb.auth.getSession();
      if (session?.user?.id) {
        await sb.from('user_settings').upsert({
          user_id: session.user.id,
          desktop_notifications: true,
        }, { onConflict: 'user_id' });
      }

      syncApkUi();
      if (saved) {
        showToast('FCM-токен получен и сохранён');
      } else {
        showToast(`Токен получен, но не сохранён: ${lastError || 'войдите в аккаунт'}`, true);
      }
      return true;
    } catch (error) {
      tokenStatus = 'error';
      lastError = formatError(error);
      syncApkUi();
      showToast(`Ошибка FCM: ${lastError}`, true);
      return false;
    }
  }

  sb.auth.onAuthStateChange((_event, session) => {
    const cached = localStorage.getItem('mb_fcm_token');
    if (session?.user?.id && cached) {
      setTimeout(() => {
        saveFcmToken(cached).catch((error) => {
          tokenStatus = 'error';
          lastError = formatError(error);
          syncApkUi();
        });
      }, 0);
    }
  });

  window.addEventListener('click', async (e) => {
    const target = e.target && e.target.closest ? e.target : null;
    if (!target) return;

    if (target.closest('[data-settings-tab="notifications"]')) {
      setTimeout(syncApkUi, 50);
      return;
    }

    if (target.closest('#btn-enable-notif-banner') || target.closest('#mobile-notif-btn')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      await enableNativePush();
      return;
    }

    if (target.closest('#btn-test-notif')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token) {
          showToast('Сначала войдите в аккаунт', true);
          return;
        }

        let token = localStorage.getItem('mb_fcm_token');
        if (!token) {
          showToast('Запрашиваю FCM-токен у Google…');
          token = await requestFcmToken(10000);
        }

        const saved = await saveFcmToken(token);
        if (!saved) {
          showToast(`Не удалось сохранить токен: ${lastError || 'ошибка БД'}`, true);
          return;
        }

        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-web-push`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ test: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(`Ошибка сервера: ${data.error || res.status}`, true);
          return;
        }
        const channels = data.channels || {};
        const fcm = channels.fcm || { attempts: 0, sent: 0, failed: 0 };
        const web = channels.webPush || { attempts: 0, sent: 0, failed: 0 };
        const fcmLabel = Number(fcm.attempts) > 0
            ? `Android FCM: принято ${fcm.sent || 0}/${fcm.attempts}`
            : 'Android FCM: токен не найден в БД';
        const webLabel = Number(web.attempts) > 0
            ? `Web Push: ${web.sent || 0}/${web.attempts}`
            : '';
        const failure = Array.isArray(data.failures) && data.failures.length
            ? ` Причина: ${data.failures[0].message || 'ошибка отправки'}`
            : '';
        showToast(`${fcmLabel}${webLabel ? ` · ${webLabel}` : ''}.${failure}`, Number(data.failed || 0) > 0);
      } catch (error) {
        tokenStatus = 'error';
        lastError = formatError(error);
        syncApkUi();
        showToast(`Ошибка: ${lastError}`, true);
      }
    }
  }, true);

  window.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input || input.id !== 'notif-desktop') return;
    e.stopImmediatePropagation();

    const enabled = !!input.checked;
    try {
      if (enabled) {
        const ok = await enableNativePush();
        if (!ok) input.checked = false;
      } else {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user?.id) {
          const { error } = await sb.from('user_settings').upsert({
            user_id: session.user.id,
            desktop_notifications: false,
          }, { onConflict: 'user_id' });
          if (error) throw error;
        }
        showToast('Уведомления отключены');
      }
    } catch (error) {
      showToast(`Ошибка сохранения: ${formatError(error)}`, true);
    }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    syncApkUi();
    setTimeout(syncApkUi, 1000);
  });

  (async () => {
    try {
      await ensureListeners();

      if (typeof PushNotifications.createChannel === 'function') {
        try {
          await PushNotifications.createChannel({
            id: 'mb_messages',
            name: 'Сообщения',
            description: 'Уведомления о новых сообщениях Мессенджера Б',
            importance: 5,
            visibility: 1,
            vibration: true,
            sound: 'default',
          });
        } catch (chErr) {
          console.warn('[FCM] Channel error (ignored):', chErr);
        }
      }

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
      currentPerm = perm.receive === 'granted' ? 'granted' : 'denied';

      if (currentPerm === 'granted') {
        tokenStatus = localStorage.getItem('mb_fcm_token') ? 'pending' : 'registering';
        await PushNotifications.register();
      }
      syncApkUi();
    } catch (error) {
      tokenStatus = 'error';
      lastError = formatError(error);
      syncApkUi();
    }
  })();
})();