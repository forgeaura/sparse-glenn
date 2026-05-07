-- Switch multiplayer schema.
-- Apply via Supabase dashboard: SQL Editor → paste this whole file → Run.
-- Idempotent where reasonable; safe to re-run.

-- ─── rooms ──────────────────────────────────────────────────────────────────
create table if not exists rooms (
    code         text primary key,                                    -- e.g. "BLU7XQ"
    created_by   uuid references auth.users(id),
    drop_policy  text not null default 'convert'
                 check (drop_policy in ('convert','pause','end_round')),
    status       text not null default 'lobby'
                 check (status in ('lobby','playing','paused','ended')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- ─── room_seats ─────────────────────────────────────────────────────────────
create table if not exists room_seats (
    room_code    text not null references rooms(code) on delete cascade,
    seat_index   int  not null,
    player_type  text not null check (player_type in ('human','ai')),
    user_id      uuid references auth.users(id),
    display_name text not null,
    is_present   boolean not null default true,
    added_by     uuid references auth.users(id), -- which human seated this AI (null for humans)
    primary key (room_code, seat_index)
);
-- For existing rooms that pre-date the column:
alter table room_seats add column if not exists added_by uuid references auth.users(id);

create unique index if not exists room_seats_user_unique
    on room_seats (room_code, user_id) where user_id is not null;

-- ─── game_states ────────────────────────────────────────────────────────────
create table if not exists game_states (
    room_code         text primary key references rooms(code) on delete cascade,
    turn_seq          bigint not null default 0,
    current_seat      int not null default 0,
    direction         int not null default 1,
    deck              jsonb not null default '[]'::jsonb,
    discard           jsonb not null default '[]'::jsonb,
    hands             jsonb not null default '{}'::jsonb,   -- { "0":[...], "1":[...] }
    current_suit      text,
    current_rank      text,
    pickup_stack      int not null default 0,
    pending_suit_seat int,
    round_number      int not null default 1,
    scores            jsonb not null default '{}'::jsonb,   -- { "0":12, "1":7 }
    rng_seed          bigint not null default 0,
    log_tail          jsonb not null default '[]'::jsonb,   -- recent log lines
    game_over         boolean not null default false,
    paused            boolean not null default false,
    updated_at        timestamptz not null default now(),
    updated_by        uuid
);

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table rooms       enable row level security;
alter table room_seats  enable row level security;
alter table game_states enable row level security;

-- Helper: is the calling user seated in a given room?
create or replace function is_room_member(p_room text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from room_seats
        where room_code = p_room
          and user_id = auth.uid()
    );
$$;

-- rooms: readable by any authenticated user who knows the code (codes are the secret).
drop policy if exists rooms_select on rooms;
create policy rooms_select on rooms for select
    to authenticated using (true);

drop policy if exists rooms_insert on rooms;
create policy rooms_insert on rooms for insert
    to authenticated with check (auth.uid() = created_by);

-- Anyone seated in the room can update its lifecycle (start, pause).
drop policy if exists rooms_update on rooms;
create policy rooms_update on rooms for update
    to authenticated using (is_room_member(code))
    with check (is_room_member(code));

-- room_seats: readable by anyone who can see the room (so lobby UIs work pre-join).
drop policy if exists room_seats_select on room_seats;
create policy room_seats_select on room_seats for select
    to authenticated using (true);

-- Insert: humans seat themselves; AI seats are inserted by an already-seated human.
drop policy if exists room_seats_insert on room_seats;
create policy room_seats_insert on room_seats for insert
    to authenticated with check (
        (player_type = 'human' and user_id = auth.uid())
        or (player_type = 'ai'  and is_room_member(room_code))
    );

-- Delete: a human can remove their own seat; any seated human can remove an AI seat.
drop policy if exists room_seats_delete on room_seats;
create policy room_seats_delete on room_seats for delete
    to authenticated using (
        (player_type = 'human' and user_id = auth.uid())
        or (player_type = 'ai'  and is_room_member(room_code))
    );

drop policy if exists room_seats_update on room_seats;
create policy room_seats_update on room_seats for update
    to authenticated using (is_room_member(room_code))
    with check (is_room_member(room_code));

-- game_states: readable by seated members only. No direct INSERT/UPDATE — go via RPCs.
drop policy if exists game_states_select on game_states;
create policy game_states_select on game_states for select
    to authenticated using (is_room_member(room_code));

-- ─── RPC: commit_turn ───────────────────────────────────────────────────────
-- Optimistic concurrency. Returns the new turn_seq on success, or NULL on conflict.
create or replace function commit_turn(
    p_room          text,
    p_expected_seq  bigint,
    p_new_state     jsonb,
    p_new_seat      int
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_new_seq bigint;
begin
    if not is_room_member(p_room) then
        raise exception 'not a member of room %', p_room
            using errcode = '42501';
    end if;

    update game_states set
        turn_seq          = turn_seq + 1,
        current_seat      = p_new_seat,
        deck              = coalesce(p_new_state->'deck', deck),
        discard           = coalesce(p_new_state->'discard', discard),
        hands             = coalesce(p_new_state->'hands', hands),
        current_suit      = p_new_state->>'currentSuit',
        current_rank      = p_new_state->>'currentRank',
        pickup_stack      = coalesce((p_new_state->>'pickupStack')::int, 0),
        pending_suit_seat = (p_new_state->>'pendingSuitSeat')::int,
        round_number      = coalesce((p_new_state->>'roundNumber')::int, round_number),
        scores            = coalesce(p_new_state->'scores', scores),
        rng_seed          = coalesce((p_new_state->>'rngSeed')::bigint, rng_seed),
        log_tail          = coalesce(p_new_state->'logTail', log_tail),
        game_over         = coalesce((p_new_state->>'gameOver')::boolean, false),
        paused            = coalesce((p_new_state->>'paused')::boolean, false),
        updated_at        = now(),
        updated_by        = auth.uid()
    where room_code = p_room
      and turn_seq  = p_expected_seq
    returning turn_seq into v_new_seq;

    return v_new_seq; -- NULL when 0 rows updated (race lost or stale state)
end;
$$;

-- ─── RPC: create_room ───────────────────────────────────────────────────────
-- Creates room + initial human seat (the caller) atomically. Returns the new code.
create or replace function create_room(
    p_code         text,
    p_drop_policy  text,
    p_display_name text
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into rooms (code, created_by, drop_policy)
        values (p_code, auth.uid(), p_drop_policy);

    insert into room_seats (room_code, seat_index, player_type, user_id, display_name)
        values (p_code, 0, 'human', auth.uid(), p_display_name);

    insert into game_states (room_code) values (p_code);
    return p_code;
end;
$$;

-- ─── RPC: join_room ─────────────────────────────────────────────────────────
-- Claims the next vacant seat as a human. Returns the seat_index, or NULL if room is locked.
create or replace function join_room(
    p_code         text,
    p_display_name text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status     text;
    v_seat_index int;
begin
    select status into v_status from rooms where code = p_code for update;
    if v_status is null then
        raise exception 'room % not found', p_code using errcode = 'P0002';
    end if;
    if v_status <> 'lobby' then
        raise exception 'room % is not accepting joins', p_code using errcode = '55000';
    end if;

    -- Already seated? Return existing seat (idempotent rejoin).
    select seat_index into v_seat_index
        from room_seats where room_code = p_code and user_id = auth.uid();
    if v_seat_index is not null then
        return v_seat_index;
    end if;

    select coalesce(max(seat_index) + 1, 0) into v_seat_index
        from room_seats where room_code = p_code;

    insert into room_seats (room_code, seat_index, player_type, user_id, display_name)
        values (p_code, v_seat_index, 'human', auth.uid(), p_display_name);

    return v_seat_index;
end;
$$;

-- ─── RPC: add_ai_seat ───────────────────────────────────────────────────────
-- Per-human budget: each human can add up to 7 AI seats (tracked via added_by).
-- Returns new seat_index, or NULL if THIS human has already used their budget.
create or replace function add_ai_seat(
    p_code         text,
    p_display_name text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status     text;
    v_my_ais     int;
    v_seat_index int;
begin
    if not is_room_member(p_code) then
        raise exception 'not a member of room %', p_code using errcode = '42501';
    end if;

    select status into v_status from rooms where code = p_code for update;
    if v_status <> 'lobby' then
        raise exception 'cannot modify seats outside lobby' using errcode = '55000';
    end if;

    select count(*) into v_my_ais
      from room_seats
     where room_code = p_code
       and player_type = 'ai'
       and added_by = auth.uid();

    if v_my_ais >= 7 then
        return null; -- this human's budget is exhausted
    end if;

    select coalesce(max(seat_index) + 1, 0) into v_seat_index
        from room_seats where room_code = p_code;

    insert into room_seats (room_code, seat_index, player_type, user_id, display_name, added_by)
        values (p_code, v_seat_index, 'ai', null, p_display_name, auth.uid());

    return v_seat_index;
end;
$$;

-- ─── RPC: start_room ────────────────────────────────────────────────────────
-- Transitions the room from 'lobby' to 'playing'. Caller must be seated.
-- Auto-prunes orphaned AI seats — i.e. AIs whose sponsoring human (added_by)
-- has left the lobby. (Sponsor present => AI stays; sponsor gone => AI goes.)
create or replace function start_room(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not is_room_member(p_code) then
        raise exception 'not a member of room %', p_code using errcode = '42501';
    end if;

    delete from room_seats ai
     where ai.room_code = p_code
       and ai.player_type = 'ai'
       and ai.added_by is not null
       and not exists (
           select 1 from room_seats h
            where h.room_code = p_code
              and h.player_type = 'human'
              and h.user_id = ai.added_by
       );

    update rooms set status = 'playing', updated_at = now() where code = p_code;
end;
$$;

-- ─── Realtime: enable broadcast on game_states + room_seats ─────────────────
-- Run these once in the Supabase dashboard if not already present:
--   alter publication supabase_realtime add table game_states;
--   alter publication supabase_realtime add table room_seats;
--   alter publication supabase_realtime add table rooms;
-- (Postgres won't add to a publication idempotently, so we skip from this script.)
