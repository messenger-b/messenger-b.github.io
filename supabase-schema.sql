-- ============================================================================
-- МЕССЕНДЖЕР Б v9 — Полная идемпотентная схема Supabase (PostgreSQL + RLS + Realtime)
-- Вставьте в Supabase -> SQL Editor -> New Query -> Run
-- ============================================================================

create table if not exists public.classes (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.classes (name) values
  ('7Б'), ('7А'), ('7В'),
  ('5А'), ('5Б'), ('6А'), ('6Б'),
  ('8А'), ('8Б'), ('9А'), ('9Б'),
  ('10А'), ('10Б'), ('11А'), ('11Б')
on conflict (name) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null unique,
  display_name text not null,
  role text not null default 'student' check (role in ('student', 'leader', 'teacher', 'admin')),
  class_id bigint references public.classes(id) on delete set null,
  bio text not null default '',
  status_emoji text not null default '',
  avatar_url text,
  avatar_color text not null default '#2AABEE',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'dark',
  accent text not null default 'blue',
  wallpaper text not null default 'tg-dots',
  font_size int not null default 15,
  bubble_radius int not null default 18,
  bubble_style text not null default 'classic',
  compact_mode boolean not null default false,
  animations_enabled boolean not null default true,
  large_emojis boolean not null default true,
  send_on_enter boolean not null default true,
  sound_enabled boolean not null default true,
  desktop_notifications boolean not null default true,
  hide_notif_preview boolean not null default false,
  show_last_seen text not null default 'all',
  show_typing boolean not null default true,
  allow_dm text not null default 'all',
  allow_group_add text not null default 'class_friends',
  allow_friend_requests text not null default 'all',
  show_read_receipts boolean not null default true,
  app_lock_pin text
);

-- Безопасное добавление новых колонок для существующих баз
alter table public.user_settings add column if not exists bubble_style text not null default 'classic';
alter table public.user_settings add column if not exists animations_enabled boolean not null default true;
alter table public.user_settings add column if not exists large_emojis boolean not null default true;
alter table public.user_settings add column if not exists hide_notif_preview boolean not null default false;
alter table public.user_settings add column if not exists show_typing boolean not null default true;
alter table public.user_settings add column if not exists allow_friend_requests text not null default 'all';
do $$
begin
  alter table public.user_settings drop constraint if exists user_settings_show_last_seen_check;
  alter table public.user_settings drop constraint if exists user_settings_allow_dm_check;
  alter table public.user_settings drop constraint if exists user_settings_allow_group_add_check;
exception when others then null;
end $$;

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Друзья (как в Discord)
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

-- Browser push subscriptions. Private per-user endpoints; only the Edge Function uses service role to send.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

create table if not exists public.chats (
  id bigint generated always as identity primary key,
  slug text unique,
  class_id bigint references public.classes(id) on delete cascade,
  type text not null check (type in ('class', 'announcements', 'school_announcements', 'dm', 'group', 'saved')),
  title text not null default '',
  description text not null default '',
  avatar_color text not null default '#2AABEE',
  created_by uuid references public.profiles(id) on delete set null,
  pinned_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id bigint not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  muted boolean not null default false,
  pinned_chat boolean not null default false,
  last_read_message_id bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.chats(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  content text not null default '',
  msg_type text not null default 'text' check (msg_type in ('text', 'voice', 'file', 'image', 'poll', 'system')),
  reply_to_id bigint references public.messages(id) on delete set null,
  forwarded_from_name text,
  attachment_url text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  voice_duration double precision,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_chat_id on public.messages(chat_id, id desc);

create table if not exists public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.polls (
  id bigint generated always as identity primary key,
  message_id bigint not null unique references public.messages(id) on delete cascade,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  allow_multiple boolean not null default false,
  is_anonymous boolean not null default false,
  closed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_votes (
  poll_id bigint not null references public.polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_index int not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id, option_index)
);

create table if not exists public.schedule_items (
  id bigint generated always as identity primary key,
  class_id bigint not null references public.classes(id) on delete cascade,
  day_of_week int not null check (day_of_week between 1 and 6),
  lesson_number int not null check (lesson_number between 1 and 12),
  subject text not null,
  start_time text not null default '',
  end_time text not null default '',
  room text not null default '',
  teacher text not null default '',
  notes text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.homework_items (
  id bigint generated always as identity primary key,
  class_id bigint not null references public.classes(id) on delete cascade,
  subject text not null,
  title text not null,
  description text not null default '',
  due_date text not null,
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.homework_progress (
  homework_id bigint not null references public.homework_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed boolean not null default true,
  completed_at timestamptz not null default now(),
  primary key (homework_id, user_id)
);

-- Системные каналы
insert into public.chats (slug, class_id, type, title, description, avatar_color)
values ('school_announcements', null, 'school_announcements', 'Общие объявления', 'Общешкольные новости от администратора', '#EF4444')
on conflict (slug) do nothing;

create or replace function public.ensure_class_chats(p_class_id bigint)
returns void language plpgsql security definer as $$
declare
  v_name text;
  v_gen_id bigint;
  v_ann_id bigint;
begin
  select name into v_name from public.classes where id = p_class_id;
  if v_name is null then return; end if;

  insert into public.chats (slug, class_id, type, title, description, avatar_color)
  values ('class_' || p_class_id || '_general', p_class_id, 'class', 'Общий чат • ' || v_name, 'Общий чат класса ' || v_name, '#2AABEE')
  on conflict (slug) do nothing;

  insert into public.chats (slug, class_id, type, title, description, avatar_color)
  values ('class_' || p_class_id || '_announcements', p_class_id, 'announcements', 'Объявления • ' || v_name, 'Объявления класса ' || v_name || ' от классного руководителя и старосты', '#F59E0B')
  on conflict (slug) do nothing;

  select id into v_gen_id from public.chats where slug = 'class_' || p_class_id || '_general';
  select id into v_ann_id from public.chats where slug = 'class_' || p_class_id || '_announcements';

  insert into public.chat_members (chat_id, user_id, role, pinned_chat)
  select v_gen_id, id, 'admin', false from public.profiles where role = 'admin'
  on conflict do nothing;

  insert into public.chat_members (chat_id, user_id, role, pinned_chat)
  select v_ann_id, id, 'admin', false from public.profiles where role = 'admin'
  on conflict do nothing;
end;
$$;

do $$
declare v_7b bigint;
begin
  select id into v_7b from public.classes where name = '7Б' limit 1;
  if v_7b is not null then perform public.ensure_class_chats(v_7b); end if;
end $$;

create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = p_a and addressee_id = p_b) or (requester_id = p_b and addressee_id = p_a))
  );
$$;

create or replace function public.sync_user_chats(p_user_id uuid)
returns void language plpgsql security definer as $$
declare
  v_user record;
  v_school_id bigint;
  v_saved_id bigint;
  v_gen_id bigint;
  v_ann_id bigint;
begin
  select * into v_user from public.profiles where id = p_user_id;
  if not found then return; end if;

  select id into v_school_id from public.chats where slug = 'school_announcements';
  if v_school_id is not null then
    insert into public.chat_members (chat_id, user_id, role, pinned_chat)
    values (v_school_id, p_user_id, case when v_user.role = 'admin' then 'admin' else 'member' end, true)
    on conflict (chat_id, user_id) do update set role = excluded.role;
  end if;

  select c.id into v_saved_id
  from public.chats c join public.chat_members cm on cm.chat_id = c.id
  where c.type = 'saved' and cm.user_id = p_user_id limit 1;
  if v_saved_id is null then
    insert into public.chats (type, title, description, avatar_color, created_by)
    values ('saved', 'Избранное', 'Личные заметки, конспекты и сохранённые файлы', '#8B5CF6', p_user_id)
    returning id into v_saved_id;
    insert into public.chat_members (chat_id, user_id, role, pinned_chat)
    values (v_saved_id, p_user_id, 'owner', false) on conflict do nothing;
  end if;

  if v_user.role <> 'admin' then
    delete from public.chat_members
    where user_id = p_user_id and chat_id in (
      select id from public.chats where type in ('class', 'announcements') and (class_id is null or class_id <> coalesce(v_user.class_id, -1))
    );
  end if;

  if v_user.class_id is not null then
    perform public.ensure_class_chats(v_user.class_id);
    select id into v_gen_id from public.chats where slug = 'class_' || v_user.class_id || '_general';
    select id into v_ann_id from public.chats where slug = 'class_' || v_user.class_id || '_announcements';

    insert into public.chat_members (chat_id, user_id, role, pinned_chat)
    values (v_gen_id, p_user_id, case when v_user.role in ('admin', 'teacher') then 'admin' else 'member' end, true)
    on conflict (chat_id, user_id) do update set role = excluded.role;

    insert into public.chat_members (chat_id, user_id, role, pinned_chat)
    values (v_ann_id, p_user_id, case when v_user.role in ('admin', 'teacher') then 'admin' else 'member' end, true)
    on conflict (chat_id, user_id) do update set role = excluded.role;
  end if;

  if v_user.role = 'admin' then
    insert into public.chat_members (chat_id, user_id, role, pinned_chat)
    select id, p_user_id, 'admin', false from public.chats where type in ('class', 'announcements')
    on conflict do nothing;
  end if;

  insert into public.user_settings (user_id) values (p_user_id) on conflict do nothing;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_count int;
  v_role text;
  v_class_id bigint;
  v_username text;
  v_display text;
begin
  -- Serialize first-account bootstrap. Every later public registration is a student;
  -- role changes are performed only by the protected admin RPC.
  perform pg_advisory_xact_lock(74829103);
  select count(*) into v_count from public.profiles;
  v_role := case when v_count = 0 then 'admin' else 'student' end;

  -- Class membership controls access to class chats; public signup metadata is untrusted.
  select id into v_class_id from public.classes where name = '7Б' limit 1;

  v_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)), '[^a-z0-9_]', '', 'g'));
  if length(v_username) < 3 then v_username := 'user_' || substr(new.id::text, 1, 6); end if;
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := v_username || '_' || substr(new.id::text, 1, 4);
  end if;

  v_display := coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), v_username);

  insert into public.profiles (id, email, username, display_name, role, class_id)
  values (new.id, new.email, v_username, v_display, v_role, v_class_id);

  perform public.sync_user_chats(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.ensure_my_profile()
returns void language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_u record;
  v_count int;
  v_role text;
  v_class_id bigint;
  v_username text;
  v_display text;
begin
  if v_uid is null then return; end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    perform public.sync_user_chats(v_uid);
    return;
  end if;
  select * into v_u from auth.users where id = v_uid;
  if not found then return; end if;

  perform pg_advisory_xact_lock(74829103);
  select count(*) into v_count from public.profiles;
  v_role := case when v_count = 0 then 'admin' else 'student' end;
  select id into v_class_id from public.classes where name = '7Б' limit 1;
  v_username := lower(regexp_replace(coalesce(v_u.raw_user_meta_data->>'username', split_part(v_u.email, '@', 1)), '[^a-z0-9_]', '', 'g'));
  if length(v_username) < 3 then v_username := 'user_' || substr(v_uid::text, 1, 6); end if;
  v_display := coalesce(nullif(trim(v_u.raw_user_meta_data->>'display_name'), ''), v_username);

  insert into public.profiles (id, email, username, display_name, role, class_id)
  values (v_uid, v_u.email, v_username, v_display, v_role, v_class_id)
  on conflict (id) do nothing;
  perform public.sync_user_chats(v_uid);
end;
$$;

drop function if exists public.resolve_login_email(text);

create or replace function public.can_view_last_seen(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_target_id = auth.uid() then true
    when exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p_target_id)
         or (b.blocker_id = p_target_id and b.blocked_id = auth.uid())
    ) then false
    when coalesce(s.show_last_seen, 'all') = 'all' then true
    when s.show_last_seen = 'nobody' then false
    when s.show_last_seen = 'friends' then public.are_friends(auth.uid(), p_target_id)
    when s.show_last_seen = 'class_friends' then public.are_friends(auth.uid(), p_target_id) or exists (
      select 1 from public.profiles me join public.profiles target on target.id = p_target_id
      where me.id = auth.uid() and me.class_id is not null and me.class_id = target.class_id
    )
    else false
  end
  from public.profiles p
  left join public.user_settings s on s.user_id = p.id
  where p.id = p_target_id;
$$;

-- Точный поиск по @username (не в открытом списке, но можно найти по нику)
create or replace function public.search_user_by_username(p_username text)
returns table (
  id uuid, username text, display_name text, role text,
  class_id bigint, class_name text, bio text, status_emoji text,
  avatar_url text, avatar_color text, last_seen timestamptz
) language sql security definer stable as $$
  select p.id, p.username, p.display_name, p.role, p.class_id, coalesce(c.name, '7Б') as class_name,
         p.bio, p.status_emoji, p.avatar_url, p.avatar_color,
         case when public.can_view_last_seen(p.id) then p.last_seen else null end
  from public.profiles p
  left join public.classes c on c.id = p.class_id
  where lower(p.username) = lower(trim(leading '@' from trim(p_username)))
    and p.id <> auth.uid()
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  limit 1;
$$;

-- Личные сообщения с учётом приватности (друзья / класс / незнакомцы)
create or replace function public.create_or_get_dm(p_target_id uuid)
returns bigint language plpgsql security definer as $$
declare
  v_me record;
  v_target record;
  v_set record;
  v_chat_id bigint;
  v_same_class boolean;
  v_friends boolean;
begin
  select * into v_me from public.profiles where id = auth.uid();
  select * into v_target from public.profiles where id = p_target_id;
  if v_me.id is null or v_target.id is null or p_target_id = v_me.id then raise exception 'Некорректный собеседник'; end if;

  if exists (select 1 from public.blocked_users where (blocker_id = v_me.id and blocked_id = p_target_id) or (blocker_id = p_target_id and blocked_id = v_me.id)) then
    raise exception 'Отправка ограничена чёрным списком';
  end if;

  select c.id into v_chat_id
  from public.chats c
  join public.chat_members m1 on m1.chat_id = c.id and m1.user_id = v_me.id
  join public.chat_members m2 on m2.chat_id = c.id and m2.user_id = p_target_id
  where c.type = 'dm' limit 1;
  if v_chat_id is not null then return v_chat_id; end if;

  select * into v_set from public.user_settings where user_id = p_target_id;
  v_same_class := (v_me.class_id is not null and v_me.class_id = v_target.class_id);
  v_friends := public.are_friends(v_me.id, p_target_id);

  if v_me.role not in ('admin', 'teacher') then
    if v_set.allow_dm = 'nobody' then raise exception 'Пользователь закрыл новые личные сообщения';
    elsif v_set.allow_dm = 'friends' and not v_friends then raise exception 'Пользователь принимает сообщения только от друзей';
    elsif v_set.allow_dm = 'class_friends' and not (v_friends or v_same_class) then raise exception 'Пользователь принимает сообщения только от друзей и одноклассников';
    end if;
  end if;

  insert into public.chats (type, title, created_by) values ('dm', '', v_me.id) returning id into v_chat_id;
  insert into public.chat_members (chat_id, user_id, role) values (v_chat_id, v_me.id, 'member'), (v_chat_id, p_target_id, 'member');
  return v_chat_id;
end;
$$;

-- Добавление участника в существующую группу (только друзья или одноклассники + приватность)
create or replace function public.add_group_member(p_chat_id bigint, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me record;
  v_target record;
  v_chat record;
  v_set record;
  v_same_class boolean;
  v_friends boolean;
begin
  select * into v_me from public.profiles where id = auth.uid();
  select * into v_target from public.profiles where id = p_user_id;
  select * into v_chat from public.chats where id = p_chat_id;

  if v_me.id is null then raise exception 'Требуется авторизация'; end if;
  if v_chat.id is null or v_chat.type <> 'group' then raise exception 'Добавлять можно только в групповые чаты'; end if;
  if v_target.id is null or p_user_id = v_me.id then raise exception 'Пользователь не найден'; end if;

  -- Server-side authorization. Hiding the button in the UI is not a security boundary.
  if not exists (
    select 1 from public.chat_members cm
    where cm.chat_id = p_chat_id and cm.user_id = v_me.id and cm.role in ('owner', 'admin')
  ) then
    raise exception 'Добавлять участников может только создатель или администратор группы';
  end if;

  if exists (select 1 from public.blocked_users where (blocker_id = v_me.id and blocked_id = p_user_id) or (blocker_id = p_user_id and blocked_id = v_me.id)) then
    raise exception 'Пользователь недоступен из-за чёрного списка';
  end if;

  v_same_class := (v_me.class_id is not null and v_me.class_id = v_target.class_id);
  v_friends := public.are_friends(v_me.id, p_user_id);
  if not (v_same_class or v_friends) then
    raise exception 'Незнакомцев нельзя добавлять в группы — сначала добавьте в друзья';
  end if;

  select * into v_set from public.user_settings where user_id = p_user_id;
  if coalesce(v_set.allow_group_add, 'class_friends') = 'nobody' then
    raise exception 'Пользователь запретил добавлять себя в группы';
  elsif v_set.allow_group_add = 'admins' and v_me.role not in ('admin', 'teacher') then
    raise exception 'Пользователь разрешил добавлять себя только админам и классному руководителю';
  elsif v_set.allow_group_add = 'friends' and not v_friends then
    raise exception 'Пользователь разрешил добавлять себя в группы только друзьям';
  end if;

  insert into public.chat_members (chat_id, user_id, role)
  values (p_chat_id, p_user_id, 'member')
  on conflict (chat_id, user_id) do nothing;
end;
$$;

create or replace function public.create_group_chat(p_title text, p_description text, p_member_ids uuid[])
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_chat_id bigint;
  v_uid uuid;
begin
  if v_me is null or length(trim(coalesce(p_title, ''))) < 2 then raise exception 'Укажите название группы'; end if;
  insert into public.chats (type, title, description, created_by)
  values ('group', trim(p_title), coalesce(trim(p_description), ''), v_me) returning id into v_chat_id;

  insert into public.chat_members (chat_id, user_id, role)
  values (v_chat_id, v_me, 'owner');

  foreach v_uid in array coalesce(p_member_ids, array[]::uuid[]) loop
    if v_uid is not null and v_uid <> v_me then
      -- Any invalid invite aborts the whole transaction instead of silently creating a half-empty group.
      perform public.add_group_member(v_chat_id, v_uid);
    end if;
  end loop;
  return v_chat_id;
end;
$$;

create or replace function public.admin_change_user_class(p_target_id uuid, p_class_id bigint)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Менять класс может только администратор';
  end if;
  update public.profiles set class_id = p_class_id where id = p_target_id;
  perform public.sync_user_chats(p_target_id);
end;
$$;

create or replace function public.manage_change_user_role(p_target_id uuid, p_role text)
returns void language plpgsql security definer as $$
declare v_me record; v_target record;
begin
  select * into v_me from public.profiles where id = auth.uid();
  select * into v_target from public.profiles where id = p_target_id;
  if v_me.role = 'admin' then
    if p_role not in ('student', 'leader', 'teacher', 'admin') then raise exception 'Некорректная роль'; end if;
  elsif v_me.role = 'teacher' then
    if v_target.class_id <> v_me.class_id or p_role not in ('student', 'leader') or v_target.role not in ('student', 'leader') then
      raise exception 'Классный руководитель может назначать только старосту в своём классе';
    end if;
  else raise exception 'Недостаточно прав';
  end if;
  update public.profiles set role = p_role where id = p_target_id;
  perform public.sync_user_chats(p_target_id);
end;
$$;

create or replace function public.admin_add_class(p_name text)
returns bigint language plpgsql security definer as $$
declare v_id bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Добавлять классы может только администратор';
  end if;
  insert into public.classes (name) values (trim(p_name)) returning id into v_id;
  perform public.ensure_class_chats(v_id);
  return v_id;
end;
$$;

-- Privacy helpers. SECURITY DEFINER is intentionally limited to returning only the fields needed by the caller.
create or replace function public.can_view_last_seen(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_target_id = auth.uid() then true
    when coalesce(s.show_last_seen, 'all') = 'all' then true
    when s.show_last_seen = 'nobody' then false
    when s.show_last_seen = 'friends' then public.are_friends(auth.uid(), p_target_id)
    when s.show_last_seen = 'class_friends' then public.are_friends(auth.uid(), p_target_id) or exists (
      select 1 from public.profiles me join public.profiles target on target.id = p_target_id
      where me.id = auth.uid() and me.class_id is not null and me.class_id = target.class_id
    )
    else false
  end
  from public.profiles p
  left join public.user_settings s on s.user_id = p.id
  where p.id = p_target_id;
$$;

create or replace function public.can_view_profile(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_target_id = auth.uid() or exists (
    select 1
    from public.profiles me
    join public.profiles target on target.id = p_target_id
    where me.id = auth.uid()
      and not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = me.id and b.blocked_id = target.id)
           or (b.blocker_id = target.id and b.blocked_id = me.id)
      )
      and (
      me.role = 'admin'
      or target.role = 'admin'
      or (me.class_id is not null and me.class_id = target.class_id)
      or public.are_friends(me.id, target.id)
      or exists (
        select 1 from public.chat_members a
        join public.chat_members b on b.chat_id = a.chat_id
        where a.user_id = me.id and b.user_id = target.id
      )
    )
  );
$$;

drop function if exists public.get_profile_presence_visibility(uuid[]);
create or replace function public.get_profile_presence_visibility(p_user_ids uuid[])
returns table(user_id uuid, can_see_last_seen boolean, last_seen timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id,
    public.can_view_last_seen(p.id) as can_see_last_seen,
    case when public.can_view_last_seen(p.id) then p.last_seen else null end as last_seen
  from public.profiles p
  where p.id = any(coalesce(p_user_ids, array[]::uuid[]));
$$;

create or replace function public.get_my_email()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select email from public.profiles where id = auth.uid();
$$;

create or replace function public.can_receive_friend_request(p_target_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles target
    left join public.user_settings s on s.user_id = target.id
    left join public.profiles requester on requester.id = auth.uid()
    where target.id = p_target_id and target.id <> auth.uid()
      and coalesce(s.allow_friend_requests, 'all') <> 'nobody'
      and (coalesce(s.allow_friend_requests, 'all') <> 'classmates'
           or (requester.class_id is not null and requester.class_id = target.class_id))
      and not exists (select 1 from public.blocked_users b where (b.blocker_id = target.id and b.blocked_id = auth.uid()) or (b.blocker_id = auth.uid() and b.blocked_id = target.id))
  );
$$;

create or replace function public.get_message_readers(p_message_id bigint)
returns table(
  id uuid, username text, display_name text, role text, class_id bigint,
  bio text, status_emoji text, avatar_url text, avatar_color text, last_seen timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_msg record;
begin
  select * into v_msg from public.messages where id = p_message_id;
  if v_msg.id is null or not public.is_chat_member(v_msg.chat_id) then raise exception 'Нет доступа к сообщению'; end if;
  return query
  select p.id,p.username,p.display_name,p.role,p.class_id,p.bio,p.status_emoji,p.avatar_url,p.avatar_color,
         case when public.can_view_last_seen(p.id) then p.last_seen else null end
  from public.chat_members cm
  join public.profiles p on p.id = cm.user_id
  left join public.user_settings s on s.user_id = cm.user_id
  where cm.chat_id = v_msg.chat_id
    and cm.user_id <> v_msg.sender_id
    and cm.last_read_message_id >= p_message_id
    and coalesce(s.show_read_receipts, true);
end;
$$;

create or replace function public.get_message_read_status(p_message_ids bigint[])
returns table(message_id bigint, is_read boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id,
    exists (
      select 1 from public.chat_members cm
      left join public.user_settings s on s.user_id = cm.user_id
      where cm.chat_id = m.chat_id and cm.user_id <> auth.uid()
        and cm.last_read_message_id >= m.id
        and coalesce(s.show_read_receipts, true)
    ) as is_read
  from public.messages m
  where m.id = any(coalesce(p_message_ids, array[]::bigint[]))
    and m.sender_id = auth.uid()
    and public.is_chat_member(m.chat_id);
$$;

-- RLS helpers
create or replace function public.is_chat_member(p_chat_id bigint)
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.chat_members where chat_id = p_chat_id and user_id = auth.uid());
$$;

create or replace function public.can_post_in_chat(p_chat_id bigint)
returns boolean language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  v_u record;
  v_c record;
  v_peer_id uuid;
  v_peer record;
  v_set record;
  v_same_class boolean;
  v_friends boolean;
begin
  select * into v_u from public.profiles where id = auth.uid();
  select * into v_c from public.chats where id = p_chat_id;
  if v_u.id is null or v_c.id is null or not public.is_chat_member(p_chat_id) then return false; end if;
  if v_c.type = 'school_announcements' then return v_u.role = 'admin'; end if;
  if v_c.type = 'announcements' then
    return v_u.role = 'admin' or (v_u.role in ('teacher', 'leader') and v_u.class_id = v_c.class_id);
  end if;
  if v_c.type = 'dm' then
    select user_id into v_peer_id from public.chat_members
    where chat_id = p_chat_id and user_id <> v_u.id limit 1;
    if v_peer_id is null then return false; end if;
    if exists (select 1 from public.blocked_users where (blocker_id = v_u.id and blocked_id = v_peer_id) or (blocker_id = v_peer_id and blocked_id = v_u.id)) then return false; end if;
    select * into v_peer from public.profiles where id = v_peer_id;
    select * into v_set from public.user_settings where user_id = v_peer_id;
    v_same_class := v_u.class_id is not null and v_u.class_id = v_peer.class_id;
    v_friends := public.are_friends(v_u.id, v_peer_id);
    if coalesce(v_set.allow_dm, 'all') = 'nobody' then return v_u.role in ('admin', 'teacher'); end if;
    if v_set.allow_dm = 'friends' then return v_friends or v_u.role in ('admin', 'teacher'); end if;
    if v_set.allow_dm = 'class_friends' then return v_friends or v_same_class or v_u.role in ('admin', 'teacher'); end if;
  end if;
  return true;
end;
$$;

create or replace function public.can_edit_class_academics(p_class_id bigint)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (role = 'admin' or (role in ('teacher', 'leader') and class_id = p_class_id))
  );
$$;

-- RLS Policies
alter table public.classes enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.blocked_users enable row level security;
alter table public.friendships enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.schedule_items enable row level security;
alter table public.homework_items enable row level security;
alter table public.homework_progress enable row level security;

drop policy if exists "classes_read_all" on public.classes;
create policy "classes_read_all" on public.classes for select to anon, authenticated using (true);
drop policy if exists "profiles_read_auth" on public.profiles;
create policy "profiles_read_auth" on public.profiles for select to authenticated using (public.can_view_profile(id));
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid());
drop policy if exists "settings_own" on public.user_settings;
create policy "settings_own" on public.user_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "blocked_own" on public.blocked_users;
create policy "blocked_own" on public.blocked_users for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
drop policy if exists "friendships_own" on public.friendships;
drop policy if exists "friendships_select_participant" on public.friendships;
drop policy if exists "friendships_insert_requester" on public.friendships;
drop policy if exists "friendships_accept_recipient" on public.friendships;
drop policy if exists "friendships_delete_participant" on public.friendships;
create policy "friendships_select_participant" on public.friendships for select to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "friendships_insert_requester" on public.friendships for insert to authenticated with check (
  requester_id = auth.uid() and addressee_id <> auth.uid() and status = 'pending'
  and public.can_receive_friend_request(addressee_id)
);
create policy "friendships_accept_recipient" on public.friendships for update to authenticated
  using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');
create policy "friendships_delete_participant" on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
drop policy if exists "chats_member_select" on public.chats;
create policy "chats_member_select" on public.chats for select to authenticated using (public.is_chat_member(id));
drop policy if exists "chats_member_update" on public.chats;
create policy "chats_member_update" on public.chats for update to authenticated using (public.is_chat_member(id));
drop policy if exists "members_select" on public.chat_members;
create policy "members_select" on public.chat_members for select to authenticated using (public.is_chat_member(chat_id));
drop policy if exists "members_update_own" on public.chat_members;
create policy "members_update_own" on public.chat_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "members_delete_own" on public.chat_members;
create policy "members_delete_own" on public.chat_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages for select to authenticated using (public.is_chat_member(chat_id));
drop policy if exists "messages_insert_allowed" on public.messages;
create policy "messages_insert_allowed" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.can_post_in_chat(chat_id));
drop policy if exists "messages_update_allowed" on public.messages;
create policy "messages_update_allowed" on public.messages for update to authenticated using (
  sender_id = auth.uid()
  or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  or exists (select 1 from public.profiles p join public.chats c on c.id = chat_id where p.id = auth.uid() and p.role = 'teacher' and p.class_id = c.class_id)
);
drop policy if exists "reactions_select" on public.message_reactions;
create policy "reactions_select" on public.message_reactions for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id))
);
drop policy if exists "reactions_own" on public.message_reactions;
drop policy if exists "reactions_insert_member" on public.message_reactions;
drop policy if exists "reactions_delete_member" on public.message_reactions;
create policy "reactions_insert_member" on public.message_reactions for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id))
);
create policy "reactions_delete_member" on public.message_reactions for delete to authenticated using (
  user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id))
);
drop policy if exists "polls_select" on public.polls;
create policy "polls_select" on public.polls for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_chat_member(m.chat_id))
);
drop policy if exists "polls_insert" on public.polls;
create policy "polls_insert" on public.polls for insert to authenticated with check (
  exists (select 1 from public.messages m where m.id = message_id and public.can_post_in_chat(m.chat_id))
);
drop policy if exists "poll_votes_select" on public.poll_votes;
create policy "poll_votes_select" on public.poll_votes for select to authenticated using (
  exists (select 1 from public.polls p join public.messages m on m.id = p.message_id where p.id = poll_id and public.is_chat_member(m.chat_id))
);
drop policy if exists "poll_votes_own" on public.poll_votes;
drop policy if exists "poll_votes_insert_member" on public.poll_votes;
drop policy if exists "poll_votes_delete_member" on public.poll_votes;
create policy "poll_votes_insert_member" on public.poll_votes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.polls p join public.messages m on m.id = p.message_id where p.id = poll_id and public.is_chat_member(m.chat_id))
);
create policy "poll_votes_delete_member" on public.poll_votes for delete to authenticated using (
  user_id = auth.uid() and exists (select 1 from public.polls p join public.messages m on m.id = p.message_id where p.id = poll_id and public.is_chat_member(m.chat_id))
);
drop policy if exists "schedule_read" on public.schedule_items;
create policy "schedule_read" on public.schedule_items for select to authenticated using (true);
drop policy if exists "schedule_write" on public.schedule_items;
create policy "schedule_write" on public.schedule_items for all to authenticated using (public.can_edit_class_academics(class_id)) with check (public.can_edit_class_academics(class_id));
drop policy if exists "hw_read" on public.homework_items;
create policy "hw_read" on public.homework_items for select to authenticated using (true);
drop policy if exists "hw_write" on public.homework_items;
create policy "hw_write" on public.homework_items for all to authenticated using (public.can_edit_class_academics(class_id)) with check (public.can_edit_class_academics(class_id));
drop policy if exists "hw_prog_own" on public.homework_progress;
create policy "hw_prog_own" on public.homework_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storage & Realtime
do $$
begin
  insert into storage.buckets (id, name, public) values ('messenger-files', 'messenger-files', true) on conflict (id) do nothing;
  drop policy if exists "files_read_all" on storage.objects;
  create policy "files_read_all" on storage.objects for select using (bucket_id = 'messenger-files');
  drop policy if exists "files_upload_auth" on storage.objects;
  create policy "files_upload_auth" on storage.objects for insert to authenticated with check (bucket_id = 'messenger-files');
exception when others then null;
end $$;

do $$
declare t text;
begin
  begin execute 'alter publication supabase_realtime drop table public.profiles'; exception when others then null; end;
  foreach t in array array['messages','message_reactions','chats','chat_members','poll_votes','schedule_items','homework_items','friendships'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;

grant usage on schema public to anon, authenticated;
grant select on public.classes to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;

-- Never expose profile email addresses through PostgREST. Only the owner can fetch their own email via get_my_email().
revoke select on public.profiles from anon, authenticated;
grant select (id, username, display_name, role, class_id, bio, status_emoji, avatar_url, avatar_color, created_at)
  on public.profiles to authenticated;
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, username, bio, status_emoji, avatar_color, avatar_url, last_seen)
  on public.profiles to authenticated;

-- Prevent users from promoting themselves or changing chat/message ownership via direct table writes.
revoke update on public.chat_members from authenticated;
grant update (muted, pinned_chat, last_read_message_id) on public.chat_members to authenticated;
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;
revoke update on public.chats from authenticated;
grant update (pinned_message_id) on public.chats to authenticated;
revoke update on public.messages from authenticated;
grant update (content, edited_at, deleted_at) on public.messages to authenticated;

revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
