-- Persistent rooms, member roles/permissions, and per-user lifetime stats.
-- Apply via Supabase dashboard: SQL Editor → paste this file → Run. Idempotent where reasonable.
-- Run AFTER 001_multiplayer.sql.

-- ─── 1. Extend rooms ────────────────────────────────────────────────────────
alter table rooms add column if not exists name text;
alter table rooms add column if not exists kind text not null default 'one_off'
    check (kind in ('one_off','persistent'));
alter table rooms add column if not exists join_policy text not null default 'open'
    check (join_policy in ('open','approval','invite_only'));

-- ─── 2. room_members (authorization layer + roles) ──────────────────────────
create table if not exists room_members (
    room_code   text not null references rooms(code) on delete cascade,
    user_id     uuid not null references auth.users(id) on delete cascade,
    role        text not null default 'member' check (role in ('admin','member')),
    state       text not null default 'active'
                check (state in ('invited','requested','active','banned')),
    invited_by  uuid references auth.users(id),
    joined_at   timestamptz not null default now(),
    primary key (room_code, user_id)
);
create index if not exists idx_room_members_user on room_members(user_id);

-- Backfill: every user already seated in 001 becomes an active member of their room.
insert into room_members (room_code, user_id, role, state)
    select rs.room_code, rs.user_id,
           case when r.created_by = rs.user_id then 'admin' else 'member' end,
           'active'
      from room_seats rs
      join rooms r on r.code = rs.room_code
     where rs.user_id is not null
on conflict do nothing;

-- ─── 3. user_lifetime_stats (per-user multiplayer totals) ───────────────────
create table if not exists user_lifetime_stats (
    user_id        uuid primary key references auth.users(id) on delete cascade,
    total_score    bigint not null default 0,
    rounds_played  int not null default 0,
    rounds_won     int not null default 0,
    rooms_played   int not null default 0,
    updated_at     timestamptz not null default now()
);

-- ─── 4. room_player_totals (running scores per persistent room) ─────────────
create table if not exists room_player_totals (
    room_code      text not null references rooms(code) on delete cascade,
    user_id        uuid not null references auth.users(id) on delete cascade,
    display_name   text not null,
    total_score    bigint not null default 0,
    rounds_played  int not null default 0,
    rounds_won     int not null default 0,
    last_played_at timestamptz,
    primary key (room_code, user_id)
);

-- ─── 5. round-result idempotency anchor ─────────────────────────────────────
create table if not exists room_round_results (
    room_code     text not null references rooms(code) on delete cascade,
    round_number  int not null,
    recorded_at   timestamptz not null default now(),
    primary key (room_code, round_number)
);

-- ─── 6. RLS ─────────────────────────────────────────────────────────────────
alter table room_members         enable row level security;
alter table user_lifetime_stats  enable row level security;
alter table room_player_totals   enable row level security;
alter table room_round_results   enable row level security;

-- Helper: am I an active member of the given room?
create or replace function is_active_member(p_room text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from room_members
         where room_code = p_room
           and user_id   = auth.uid()
           and state     = 'active'
    );
$$;

-- Helper: am I an admin of the given room?
create or replace function is_room_admin(p_room text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from room_members
         where room_code = p_room
           and user_id   = auth.uid()
           and role      = 'admin'
           and state     = 'active'
    );
$$;

drop policy if exists room_members_select on room_members;
create policy room_members_select on room_members for select
    to authenticated using (
        user_id = auth.uid()                -- you can always see your own row
        or is_active_member(room_code)      -- or any row in a room you're active in
    );

-- All writes go through SECURITY DEFINER RPCs; no direct inserts/updates/deletes.

drop policy if exists user_lifetime_stats_select on user_lifetime_stats;
create policy user_lifetime_stats_select on user_lifetime_stats for select
    to authenticated using (user_id = auth.uid());

drop policy if exists room_player_totals_select on room_player_totals;
create policy room_player_totals_select on room_player_totals for select
    to authenticated using (is_active_member(room_code));

drop policy if exists room_round_results_select on room_round_results;
create policy room_round_results_select on room_round_results for select
    to authenticated using (is_active_member(room_code));

-- ─── 7. Replace create_room with extended signature ─────────────────────────
drop function if exists create_room(text, text, text);
create or replace function create_room(
    p_code         text,
    p_drop_policy  text,
    p_display_name text,
    p_name         text default null,
    p_kind         text default 'one_off',
    p_join_policy  text default 'open'
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'auth required' using errcode = '42501';
    end if;

    insert into rooms (code, created_by, drop_policy, name, kind, join_policy)
        values (p_code, auth.uid(),
                coalesce(p_drop_policy, 'convert'),
                p_name,
                coalesce(p_kind, 'one_off'),
                coalesce(p_join_policy, 'open'));

    insert into room_members (room_code, user_id, role, state)
        values (p_code, auth.uid(), 'admin', 'active');

    insert into room_seats (room_code, seat_index, player_type, user_id, display_name)
        values (p_code, 0, 'human', auth.uid(), p_display_name);

    insert into room_player_totals (room_code, user_id, display_name)
        values (p_code, auth.uid(), p_display_name)
        on conflict do nothing;

    insert into game_states (room_code) values (p_code) on conflict do nothing;

    return p_code;
end;
$$;

-- ─── 8. Replace join_room with policy-aware version ─────────────────────────
-- Returns seat_index on success.
-- Raises exception 'pending_approval' (errcode P0001) when the join is queued
-- for an admin to approve. Raises 'invite_required' for invite-only rooms.
drop function if exists join_room(text, text);
create or replace function join_room(
    p_code         text,
    p_display_name text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_room        rooms%rowtype;
    v_member      room_members%rowtype;
    v_seat_index  int;
begin
    if auth.uid() is null then
        raise exception 'auth required' using errcode = '42501';
    end if;

    select * into v_room from rooms where code = p_code for update;
    if v_room.code is null then
        raise exception 'room % not found', p_code using errcode = 'P0002';
    end if;

    select * into v_member
      from room_members
     where room_code = p_code and user_id = auth.uid()
     for update;

    if v_member.user_id is not null and v_member.state = 'banned' then
        raise exception 'banned' using errcode = 'P0001';
    end if;

    if v_room.join_policy = 'invite_only'
       and (v_member.user_id is null or v_member.state in ('requested')) then
        raise exception 'invite_required' using errcode = 'P0001';
    end if;

    if v_room.join_policy = 'approval'
       and (v_member.user_id is null or v_member.state = 'requested') then
        insert into room_members (room_code, user_id, role, state)
            values (p_code, auth.uid(), 'member', 'requested')
        on conflict (room_code, user_id) do update
            set state = case when room_members.state = 'banned' then 'banned' else 'requested' end;
        raise exception 'pending_approval' using errcode = 'P0001';
    end if;

    -- Either policy='open', or this user is already approved (active/invited).
    insert into room_members (room_code, user_id, role, state)
        values (p_code, auth.uid(), 'member', 'active')
    on conflict (room_code, user_id) do update
        set state = case when room_members.state = 'banned' then 'banned' else 'active' end;

    -- Already seated? Idempotent rejoin.
    select seat_index into v_seat_index
      from room_seats
     where room_code = p_code and user_id = auth.uid();
    if v_seat_index is not null then
        return v_seat_index;
    end if;

    -- Persistent rooms can be paused; treat that like lobby for joining purposes.
    if v_room.status not in ('lobby','playing','paused') then
        raise exception 'room % is not accepting joins', p_code using errcode = '55000';
    end if;
    if v_room.kind = 'one_off' and v_room.status <> 'lobby' then
        raise exception 'room % is not accepting joins', p_code using errcode = '55000';
    end if;

    select coalesce(max(seat_index) + 1, 0) into v_seat_index
      from room_seats where room_code = p_code;

    insert into room_seats (room_code, seat_index, player_type, user_id, display_name)
        values (p_code, v_seat_index, 'human', auth.uid(), p_display_name);

    insert into room_player_totals (room_code, user_id, display_name)
        values (p_code, auth.uid(), p_display_name)
    on conflict (room_code, user_id) do update
        set display_name = excluded.display_name;

    return v_seat_index;
end;
$$;

-- ─── 9. Admin RPCs ──────────────────────────────────────────────────────────
create or replace function approve_join(p_code text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_room_admin(p_code) then
        raise exception 'admin required' using errcode = '42501';
    end if;
    update room_members
       set state = 'active'
     where room_code = p_code and user_id = p_user_id and state in ('requested','invited');
end;
$$;

create or replace function deny_join(p_code text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_room_admin(p_code) then
        raise exception 'admin required' using errcode = '42501';
    end if;
    delete from room_members
     where room_code = p_code and user_id = p_user_id and state = 'requested';
end;
$$;

create or replace function set_member_role(p_code text, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_room_admin(p_code) then
        raise exception 'admin required' using errcode = '42501';
    end if;
    if p_role not in ('admin','member') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;
    update room_members
       set role = p_role
     where room_code = p_code and user_id = p_user_id and state = 'active';
end;
$$;

create or replace function kick_member(p_code text, p_user_id uuid, p_ban boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_room_admin(p_code) then
        raise exception 'admin required' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
        raise exception 'cannot kick yourself' using errcode = '55000';
    end if;
    delete from room_seats where room_code = p_code and user_id = p_user_id;
    if p_ban then
        update room_members set state = 'banned'
         where room_code = p_code and user_id = p_user_id;
    else
        delete from room_members where room_code = p_code and user_id = p_user_id;
    end if;
end;
$$;

create or replace function leave_room(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from room_seats where room_code = p_code and user_id = auth.uid();
    delete from room_members where room_code = p_code and user_id = auth.uid();
end;
$$;

-- ─── 10. Pause / resume for persistent rooms ────────────────────────────────
create or replace function pause_room(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_kind text;
begin
    if not is_active_member(p_code) then
        raise exception 'not a member' using errcode = '42501';
    end if;
    select kind into v_kind from rooms where code = p_code;
    if v_kind <> 'persistent' then
        raise exception 'only persistent rooms can be paused' using errcode = '55000';
    end if;
    update rooms set status = 'paused', updated_at = now() where code = p_code;
end;
$$;

create or replace function resume_room(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_active_member(p_code) then
        raise exception 'not a member' using errcode = '42501';
    end if;
    update rooms set status = 'lobby', updated_at = now()
     where code = p_code and status = 'paused';
end;
$$;

-- ─── 11. record_round_result: idempotent score crediting ────────────────────
-- p_seat_scores: jsonb array indexed by seat_index, e.g. [12, 7, 0, 5]
-- Lowest score(s) win the round. Updates user_lifetime_stats AND room_player_totals.
create or replace function record_round_result(
    p_code         text,
    p_round_number int,
    p_seat_scores  jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_min_score int;
    rec record;
begin
    if not is_active_member(p_code) then
        raise exception 'not a member' using errcode = '42501';
    end if;

    -- Idempotency: first writer wins, subsequent calls are no-ops.
    begin
        insert into room_round_results (room_code, round_number)
            values (p_code, p_round_number);
    exception when unique_violation then
        return false;
    end;

    -- Find minimum (winner) score.
    select min((value)::int) into v_min_score
      from jsonb_array_elements_text(p_seat_scores);

    -- Walk each seat, attribute the round score to that seat's user (if any).
    for rec in
        select rs.user_id,
               coalesce((p_seat_scores->>rs.seat_index)::int, 0) as score
          from room_seats rs
         where rs.room_code = p_code
           and rs.player_type = 'human'
           and rs.user_id is not null
    loop
        insert into user_lifetime_stats (user_id, total_score, rounds_played, rounds_won, rooms_played)
            values (rec.user_id, rec.score, 1,
                    case when rec.score = v_min_score then 1 else 0 end, 0)
        on conflict (user_id) do update set
            total_score   = user_lifetime_stats.total_score + excluded.total_score,
            rounds_played = user_lifetime_stats.rounds_played + 1,
            rounds_won    = user_lifetime_stats.rounds_won
                            + case when rec.score = v_min_score then 1 else 0 end,
            updated_at    = now();

        update room_player_totals
           set total_score    = total_score + rec.score,
               rounds_played  = rounds_played + 1,
               rounds_won     = rounds_won
                                + case when rec.score = v_min_score then 1 else 0 end,
               last_played_at = now()
         where room_code = p_code and user_id = rec.user_id;
    end loop;

    return true;
end;
$$;

-- ─── 12. list_my_rooms ──────────────────────────────────────────────────────
-- Returns one row per room I'm an active member of, with my running totals
-- and the room's name/kind/status. Most recently played first.
create or replace function list_my_rooms()
returns table (
    code           text,
    name           text,
    kind           text,
    status         text,
    join_policy    text,
    role           text,
    my_total_score bigint,
    my_rounds      int,
    my_wins        int,
    last_played_at timestamptz,
    member_count   int
)
language sql
stable
security definer
set search_path = public
as $$
    select r.code,
           r.name,
           r.kind,
           r.status,
           r.join_policy,
           m.role,
           coalesce(t.total_score, 0)    as my_total_score,
           coalesce(t.rounds_played, 0)  as my_rounds,
           coalesce(t.rounds_won, 0)     as my_wins,
           t.last_played_at,
           (select count(*)::int from room_members m2
             where m2.room_code = r.code and m2.state = 'active') as member_count
      from room_members m
      join rooms r on r.code = m.room_code
 left join room_player_totals t
        on t.room_code = r.code and t.user_id = auth.uid()
     where m.user_id = auth.uid()
       and m.state   = 'active'
  order by coalesce(t.last_played_at, r.updated_at) desc;
$$;

-- ─── 13. list_room_summary: read members + pending requests for the lobby ───
create or replace function list_room_members(p_code text)
returns table (
    user_id      uuid,
    role         text,
    state        text,
    display_name text,
    is_seated    boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select m.user_id,
           m.role,
           m.state,
           coalesce(rs.display_name, t.display_name, '') as display_name,
           rs.user_id is not null                          as is_seated
      from room_members m
 left join room_seats rs on rs.room_code = m.room_code and rs.user_id = m.user_id
 left join room_player_totals t on t.room_code = m.room_code and t.user_id = m.user_id
     where m.room_code = p_code
       and (is_active_member(p_code) or m.user_id = auth.uid());
$$;

-- ─── 14. Realtime publication note ──────────────────────────────────────────
-- Run these once in the Supabase dashboard if not already present:
--   alter publication supabase_realtime add table room_members;
--   alter publication supabase_realtime add table room_player_totals;
-- (Existing 001 already adds rooms / room_seats / game_states.)
