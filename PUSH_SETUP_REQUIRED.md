# Push уведомления — v11

В клиентском коде задан публичный VAPID-ключ, есть регистрация/синхронизация PushSubscription, Service Worker, серверная Edge Function `../supabase/functions/send-web-push/index.ts` и тестовая кнопка в настройках.

Для доставки при закрытом браузере обязательно разверните Edge Function и задайте серверные secrets по подробной инструкции `../Messenger_B_v11_PUSH_SETUP.md`. Приватный VAPID-ключ и Supabase service role key нельзя публиковать или помещать в `config.js`.
