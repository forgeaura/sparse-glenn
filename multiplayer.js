// Multiplayer layer for Switch.
// Talks to Supabase: rooms, room_seats, game_states + commit_turn RPC + Realtime.
// Public API: window.MP — used by game.js to commit actions and by setup-screen UI.

(function () {
    const ROOM_CODE_RE = /^[A-Z2-9]{6}$/;
    const AI_CAP_PER_HUMAN = 7;
    const DROP_GRACE_MS = 30000;
    const AI_JITTER_MIN_MS = 200;
    const AI_JITTER_RANGE_MS = 600;
    const AI_CHAIN_MAX = 8;
    const AI_CHAIN_DELAY_MS = 250;

    const sb = () => window.SB;

    function genRoomCode() {
        const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let out = '';
        for (let i = 0; i < 6; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
        return out;
    }

    // ── Module state for the active room ──────────────────────────────────────
    let active = null;
    // active = { code, mySeat, mySeatIndex, status, dropPolicy,
    //            channel, presence, currentTurnSeq, aiTimer, dropTimers:Map<seatIndex,timeoutId>,
    //            seatsCache:[], gameStateCache:row }

    function clearActive() {
        if (!active) return;
        try { active.channel?.unsubscribe(); } catch (_) {}
        if (active.aiTimer) clearTimeout(active.aiTimer);
        for (const t of active.dropTimers?.values?.() || []) clearTimeout(t);
        active = null;
    }

    // ── Lobby: create / join / add AI / start ─────────────────────────────────
    async function createRoom({ dropPolicy, displayName }) {
        const user = window.AuthManager?.currentUser;
        if (!user) throw new Error('Sign in to play multiplayer.');
        // Try a few codes in case of (rare) collision.
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = genRoomCode();
            const { data, error } = await sb().rpc('create_room', {
                p_code: code,
                p_drop_policy: dropPolicy || 'convert',
                p_display_name: displayName || (user.email?.split('@')[0]) || 'Player',
            });
            if (!error) return code;
            if (!String(error.message || '').toLowerCase().includes('duplicate')) {
                throw new Error(error.message || 'Failed to create room.');
            }
        }
        throw new Error('Could not generate a unique room code.');
    }

    async function joinRoom({ code, displayName }) {
        const user = window.AuthManager?.currentUser;
        if (!user) throw new Error('Sign in to join a multiplayer room.');
        if (!ROOM_CODE_RE.test(code)) throw new Error('Invalid room code.');
        const { data, error } = await sb().rpc('join_room', {
            p_code: code,
            p_display_name: displayName || (user.email?.split('@')[0]) || 'Player',
        });
        if (error) throw new Error(error.message || 'Failed to join.');
        return data; // seat_index
    }

    async function listSeats(code) {
        const { data, error } = await sb()
            .from('room_seats')
            .select('*')
            .eq('room_code', code)
            .order('seat_index');
        if (error) throw new Error(error.message);
        return data || [];
    }

    async function getRoom(code) {
        const { data, error } = await sb()
            .from('rooms')
            .select('*')
            .eq('code', code)
            .single();
        if (error) throw new Error(error.message);
        return data;
    }

    async function getGameState(code) {
        const { data, error } = await sb()
            .from('game_states')
            .select('*')
            .eq('room_code', code)
            .single();
        if (error) throw new Error(error.message);
        return data;
    }

    async function addAISeat(code) {
        const seats = await listSeats(code);
        const myId = window.AuthManager?.currentUser?.id;
        const myAIs = seats.filter(s => s.player_type === 'ai' && s.added_by === myId).length;
        if (myAIs >= AI_CAP_PER_HUMAN) {
            throw new Error(`You've already added ${AI_CAP_PER_HUMAN} AI seats (your max).`);
        }
        const display = `Bot ${seats.filter(s => s.player_type === 'ai').length + 1}`;
        const { data, error } = await sb().rpc('add_ai_seat', { p_code: code, p_display_name: display });
        if (error) throw new Error(error.message);
        if (data == null) throw new Error(`You've already added ${AI_CAP_PER_HUMAN} AI seats (your max).`);
        return data;
    }

    async function removeSeat(code, seatIndex) {
        const { error } = await sb()
            .from('room_seats')
            .delete()
            .eq('room_code', code)
            .eq('seat_index', seatIndex);
        if (error) throw new Error(error.message);
    }

    async function startRoom(code) {
        // Server prunes excess AI if humans left, then sets status='playing'.
        const { error } = await sb().rpc('start_room', { p_code: code });
        if (error) throw new Error(error.message);

        // Build the initial dealt state and write it via commit_turn (turn_seq = 0 → 1).
        const seatsRow = await listSeats(code);
        const room = await getRoom(code);
        const numSeats = seatsRow.length;
        const numDecks = Math.max(1, Math.ceil(numSeats / 7));
        const rngSeed = ((Math.random() * 0x7fffffff) | 0) || 1;
        const rng = makeRng(rngSeed);
        const deck = makeShuffledDeck(numDecks, rng);
        const hands = {};
        for (let i = 0; i < numSeats; i++) hands[i] = [];
        for (let r = 0; r < 7; r++) {
            for (let i = 0; i < numSeats; i++) hands[i].push(deck.pop());
        }
        let initial = deck.pop();
        let guard = 200;
        while (initial && guard-- > 0 && (initial.rank === '2' || initial.rank === '3' || initial.rank === 'Joker')) {
            deck.unshift(initial);
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            initial = deck.pop();
        }
        const newState = {
            deck,
            discard: [initial],
            hands,
            currentSuit: initial.suit,
            currentRank: initial.rank,
            pickupStack: 0,
            pendingSuitSeat: null,
            roundNumber: 1,
            scores: Object.fromEntries(seatsRow.map((s, i) => [i, 0])),
            rngSeed,
            logTail: [`Round 1 started!`],
            gameOver: false,
            paused: false,
        };
        const { data, error: rpcErr } = await sb().rpc('commit_turn', {
            p_room: code,
            p_expected_seq: 0,
            p_new_state: newState,
            p_new_seat: 0,
        });
        if (rpcErr) throw new Error(rpcErr.message);
        // Race lost (someone else already started) is fine — they'll just receive the broadcast.
        return data;
    }

    // ── Joining a live room (subscribe + render) ──────────────────────────────
    async function enterRoom(code, mySeatIndex) {
        clearActive();
        const room = await getRoom(code);
        const seatsRow = await listSeats(code);
        const stateRow = await getGameState(code);

        active = {
            code,
            mySeatIndex,
            status: room.status,
            dropPolicy: room.drop_policy,
            currentTurnSeq: stateRow.turn_seq,
            aiTimer: null,
            dropTimers: new Map(),
            seatsCache: seatsRow,
            gameStateCache: stateRow,
            channel: null,
            presence: null,
        };

        // Build the local Game with online flag.
        const seats = seatsRow.map(s => ({
            seatIndex: s.seat_index,
            type: s.player_type,
            userId: s.user_id,
            displayName: s.display_name,
        }));
        window.startGameWithSeats(seats, mySeatIndex, {
            isOnline: true,
            dropPolicy: room.drop_policy,
            skipDeal: true,
        });

        // Apply the current state into the local Game.
        applyDbStateToGame(stateRow, seatsRow);

        // Subscribe to game_states + room_seats + presence on a single channel.
        const ch = sb().channel(`room:${code}`, {
            config: { presence: { key: window.AuthManager.currentUser.id } },
        });

        ch.on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'game_states', filter: `room_code=eq.${code}`,
        }, (payload) => onGameStateChange(payload.new));

        ch.on('postgres_changes', {
            event: '*', schema: 'public', table: 'room_seats', filter: `room_code=eq.${code}`,
        }, () => refreshSeats());

        ch.on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}`,
        }, (payload) => onRoomChange(payload.new));

        ch.on('presence', { event: 'sync' }, () => onPresenceSync(ch.presenceState()));
        ch.on('presence', { event: 'leave' }, ({ key }) => onPresenceLeave(key));

        await ch.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await ch.track({ user_id: window.AuthManager.currentUser.id, at: Date.now() });
            }
        });
        active.channel = ch;

        // Kick off AI race in case it's already an AI's turn.
        scheduleAITurnIfNeeded();
    }

    function applyDbStateToGame(row, seatsRow) {
        if (!window.game) return;
        const seats = (seatsRow || active.seatsCache).map(s => ({
            seatIndex: s.seat_index,
            type: s.player_type,
            userId: s.user_id,
            displayName: s.display_name,
            isOffline: !s.is_present,
        }));
        const numSeats = seats.length;
        const state = {
            seats,
            numSeats,
            hands: row.hands || {},
            deck: row.deck || [],
            discard: row.discard || [],
            currentSeat: row.current_seat,
            currentSuit: row.current_suit,
            currentRank: row.current_rank,
            pickupStack: row.pickup_stack || 0,
            pendingSuitSeat: row.pending_suit_seat,
            direction: row.direction || 1,
            scores: row.scores || {},
            roundNumber: row.round_number || 1,
            gameOver: !!row.game_over,
            winnerSeat: null,
            rngSeed: Number(row.rng_seed) || 1,
            logTail: row.log_tail || [],
            paused: !!row.paused,
        };
        // Backfill winnerSeat from the latest "won" log line if present.
        const wonLine = (state.logTail || []).slice().reverse().find(l => /won round/i.test(l));
        if (state.gameOver && wonLine) {
            const m = state.logTail[state.logTail.length - 1] || wonLine;
            // Best-effort: find a seat whose displayName appears in the line.
            for (const seat of state.seats) {
                if (m.includes(seat.displayName)) { state.winnerSeat = seat.seatIndex; break; }
            }
        }
        window.game.applyRemoteState(state, row.turn_seq);
    }

    function onGameStateChange(row) {
        if (!active) return;
        active.gameStateCache = row;
        active.currentTurnSeq = row.turn_seq;
        applyDbStateToGame(row, active.seatsCache);
        scheduleAITurnIfNeeded();
    }

    async function refreshSeats() {
        if (!active) return;
        active.seatsCache = await listSeats(active.code);
        // Re-apply state with refreshed seat metadata (e.g. type flipped to AI on convert).
        applyDbStateToGame(active.gameStateCache, active.seatsCache);
        // If a seat that just flipped to AI is the acting seat, kick off AI claim.
        scheduleAITurnIfNeeded();
        // Update lobby UI if visible.
        window.SetupUI?.onSeatsChanged?.(active.seatsCache);
    }

    function onRoomChange(row) {
        if (!active) return;
        active.status = row.status;
        active.dropPolicy = row.drop_policy;
        window.SetupUI?.onRoomChanged?.(row);
    }

    // ── Commit a player action via RPC ────────────────────────────────────────
    async function commitMove(action) {
        if (!active || !window.game) return;
        const acting = (active.gameStateCache.pending_suit_seat != null)
            ? active.gameStateCache.pending_suit_seat
            : active.gameStateCache.current_seat;
        // Only commit if it's a seat we may legitimately act for (mine, or any AI).
        const seatRow = active.seatsCache.find(s => s.seat_index === acting);
        if (!seatRow) return;
        const isMine = seatRow.player_type === 'human' && seatRow.user_id === window.AuthManager.currentUser?.id;
        const isAI = seatRow.player_type === 'ai';
        if (!isMine && !isAI) return;

        // Build the *next* state by running the pure reducer locally, then send.
        const localState = stateFromCache();
        const result = applyAction(localState, acting, action);
        if (result.state === localState) {
            // applyAction rejected the action — bail.
            console.warn('Local reducer rejected action', action, result.log);
            return;
        }
        const nextSeat = result.state.currentSeat;
        const payload = stateToDbPayload(result.state);

        const { data, error } = await sb().rpc('commit_turn', {
            p_room: active.code,
            p_expected_seq: active.currentTurnSeq,
            p_new_state: payload,
            p_new_seat: nextSeat,
        });
        if (error) {
            console.warn('commit_turn error:', error.message);
            return;
        }
        if (data == null) {
            // Race lost — broadcast will sync us soon.
            return;
        }
        // Optimistically apply locally; broadcast will re-confirm.
        active.currentTurnSeq = data;
        active.gameStateCache = { ...active.gameStateCache, ...payloadToRow(payload, data, nextSeat) };
        applyDbStateToGame(active.gameStateCache, active.seatsCache);
        // Chain consecutive AI commits (perf optimization for many-AI rooms).
        maybeChainAI();
    }

    function stateFromCache() {
        const row = active.gameStateCache;
        return {
            seats: active.seatsCache.map(s => ({
                seatIndex: s.seat_index, type: s.player_type, userId: s.user_id, displayName: s.display_name,
            })),
            numSeats: active.seatsCache.length,
            hands: row.hands || {},
            deck: row.deck || [],
            discard: row.discard || [],
            currentSeat: row.current_seat,
            currentSuit: row.current_suit,
            currentRank: row.current_rank,
            pickupStack: row.pickup_stack || 0,
            pendingSuitSeat: row.pending_suit_seat,
            direction: row.direction || 1,
            scores: row.scores || {},
            roundNumber: row.round_number || 1,
            gameOver: !!row.game_over,
            rngSeed: Number(row.rng_seed) || 1,
            logTail: row.log_tail || [],
            paused: !!row.paused,
        };
    }

    function stateToDbPayload(state) {
        return {
            deck: state.deck,
            discard: state.discard,
            hands: state.hands,
            currentSuit: state.currentSuit,
            currentRank: state.currentRank,
            pickupStack: state.pickupStack,
            pendingSuitSeat: state.pendingSuitSeat,
            roundNumber: state.roundNumber,
            scores: state.scores,
            rngSeed: state.rngSeed,
            logTail: state.logTail,
            gameOver: state.gameOver,
            paused: state.paused,
        };
    }

    function payloadToRow(payload, turnSeq, currentSeat) {
        return {
            turn_seq: turnSeq,
            current_seat: currentSeat,
            deck: payload.deck,
            discard: payload.discard,
            hands: payload.hands,
            current_suit: payload.currentSuit,
            current_rank: payload.currentRank,
            pickup_stack: payload.pickupStack,
            pending_suit_seat: payload.pendingSuitSeat,
            round_number: payload.roundNumber,
            scores: payload.scores,
            rng_seed: payload.rngSeed,
            log_tail: payload.logTail,
            game_over: payload.gameOver,
            paused: payload.paused,
        };
    }

    // ── AI race-claim with jitter and chained commits ─────────────────────────
    function actingSeatIndex(row) {
        return row.pending_suit_seat != null ? row.pending_suit_seat : row.current_seat;
    }

    function scheduleAITurnIfNeeded() {
        if (!active || !active.gameStateCache) return;
        if (active.aiTimer) { clearTimeout(active.aiTimer); active.aiTimer = null; }
        const row = active.gameStateCache;
        if (row.game_over || row.paused) return;
        const seatIdx = actingSeatIndex(row);
        const seat = active.seatsCache.find(s => s.seat_index === seatIdx);
        if (!seat || seat.player_type !== 'ai') return;
        const jitter = AI_JITTER_MIN_MS + Math.random() * AI_JITTER_RANGE_MS;
        active.aiTimer = setTimeout(() => tryAIClaim(), jitter);
    }

    async function tryAIClaim() {
        if (!active) return;
        const row = active.gameStateCache;
        if (row.game_over || row.paused) return;
        const seatIdx = actingSeatIndex(row);
        const seat = active.seatsCache.find(s => s.seat_index === seatIdx);
        if (!seat || seat.player_type !== 'ai') return;
        const localState = stateFromCache();
        const seed = (localState.rngSeed ^ Number(active.currentTurnSeq)) >>> 0;
        const action = decideAIMove(localState, seatIdx, seed || 1);
        await commitMove(action);
    }

    async function maybeChainAI() {
        // If we just successfully committed, and the next acting seat is also AI,
        // chain the next move on this same client without waiting for our broadcast.
        let depth = 0;
        while (depth < AI_CHAIN_MAX) {
            if (!active || !active.gameStateCache) return;
            const row = active.gameStateCache;
            if (row.game_over || row.paused) return;
            const seatIdx = actingSeatIndex(row);
            const seat = active.seatsCache.find(s => s.seat_index === seatIdx);
            if (!seat || seat.player_type !== 'ai') return;
            await new Promise(r => setTimeout(r, AI_CHAIN_DELAY_MS));
            const localState = stateFromCache();
            const seed = (localState.rngSeed ^ Number(active.currentTurnSeq)) >>> 0;
            const action = decideAIMove(localState, seatIdx, seed || 1);
            const result = applyAction(localState, seatIdx, action);
            if (result.state === localState) return;
            const nextSeat = result.state.currentSeat;
            const payload = stateToDbPayload(result.state);
            const { data, error } = await sb().rpc('commit_turn', {
                p_room: active.code,
                p_expected_seq: active.currentTurnSeq,
                p_new_state: payload,
                p_new_seat: nextSeat,
            });
            if (error || data == null) return; // race lost or error — broadcast will catch us up
            active.currentTurnSeq = data;
            active.gameStateCache = { ...active.gameStateCache, ...payloadToRow(payload, data, nextSeat) };
            applyDbStateToGame(active.gameStateCache, active.seatsCache);
            depth++;
        }
    }

    // ── Presence + drop policy ────────────────────────────────────────────────
    function onPresenceSync(state) {
        if (!active) return;
        const onlineUserIds = new Set(Object.keys(state || {}));
        // Clear drop timers for any human who came back online.
        for (const seat of active.seatsCache) {
            if (seat.player_type !== 'human' || !seat.user_id) continue;
            const isOnline = onlineUserIds.has(seat.user_id);
            const t = active.dropTimers.get(seat.seat_index);
            if (isOnline && t) {
                clearTimeout(t);
                active.dropTimers.delete(seat.seat_index);
                // Mark them present.
                sb().from('room_seats').update({ is_present: true })
                    .eq('room_code', active.code).eq('seat_index', seat.seat_index)
                    .then(() => {});
                // If room was paused waiting for them, unpause.
                if (active.gameStateCache?.paused && active.dropPolicy === 'pause') {
                    setRoomPaused(false);
                }
            }
        }
    }

    function onPresenceLeave(key) {
        if (!active) return;
        const seat = active.seatsCache.find(s => s.user_id === key && s.player_type === 'human');
        if (!seat) return;
        // Schedule drop policy after grace period.
        if (active.dropTimers.has(seat.seat_index)) return;
        const tid = setTimeout(() => applyDropPolicy(seat.seat_index), DROP_GRACE_MS);
        active.dropTimers.set(seat.seat_index, tid);
        // Mark them absent immediately for UX.
        sb().from('room_seats').update({ is_present: false })
            .eq('room_code', active.code).eq('seat_index', seat.seat_index)
            .then(() => {});
    }

    async function applyDropPolicy(seatIndex) {
        if (!active) return;
        active.dropTimers.delete(seatIndex);
        const policy = active.dropPolicy;
        if (policy === 'convert') {
            // Flip seat to AI. Any client may do this; UPDATE is idempotent.
            const { error } = await sb()
                .from('room_seats')
                .update({ player_type: 'ai' })
                .eq('room_code', active.code).eq('seat_index', seatIndex);
            if (error) console.warn('convert-to-ai failed:', error.message);
        } else if (policy === 'pause') {
            await setRoomPaused(true);
        } else if (policy === 'end_round') {
            // Only meaningful mid-round. Force-end by recording an early endRound:
            // tally all hands, advance round, deal.
            // Implementation: race-claim a special turn that sets gameOver=true.
            await forceEndRound();
        }
    }

    async function setRoomPaused(paused) {
        if (!active || !active.gameStateCache) return;
        const newPayload = stateToDbPayload({ ...stateFromCache(), paused });
        await sb().rpc('commit_turn', {
            p_room: active.code,
            p_expected_seq: active.currentTurnSeq,
            p_new_state: newPayload,
            p_new_seat: active.gameStateCache.current_seat,
        });
    }

    async function forceEndRound() {
        const local = stateFromCache();
        if (local.gameOver) return;
        // Score everyone's hand against everyone (no winner) — simplest behavior.
        for (let i = 0; i < local.numSeats; i++) {
            const hand = local.hands[i] || [];
            const score = hand.reduce((t, c) => t + (window.VALUES?.[c.rank] ?? c.value ?? 0), 0);
            local.scores[i] = (local.scores[i] || 0) + score;
        }
        local.gameOver = true;
        local.logTail = [...(local.logTail || []), 'Round ended early.'];
        const payload = stateToDbPayload(local);
        await sb().rpc('commit_turn', {
            p_room: active.code,
            p_expected_seq: active.currentTurnSeq,
            p_new_state: payload,
            p_new_seat: local.currentSeat,
        });
    }

    async function requestNextRound() {
        if (!active) return;
        const seatsRow = active.seatsCache;
        const numSeats = seatsRow.length;
        const numDecks = Math.max(1, Math.ceil(numSeats / 7));
        const rngSeed = ((Math.random() * 0x7fffffff) | 0) || 1;
        const rng = makeRng(rngSeed);
        const deck = makeShuffledDeck(numDecks, rng);
        const hands = {};
        for (let i = 0; i < numSeats; i++) hands[i] = [];
        for (let r = 0; r < 7; r++) for (let i = 0; i < numSeats; i++) hands[i].push(deck.pop());
        let initial = deck.pop();
        let guard = 200;
        while (initial && guard-- > 0 && (initial.rank === '2' || initial.rank === '3' || initial.rank === 'Joker')) {
            deck.unshift(initial);
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            initial = deck.pop();
        }
        const prev = stateFromCache();
        const newState = {
            ...prev,
            deck,
            discard: [initial],
            hands,
            currentSuit: initial.suit,
            currentRank: initial.rank,
            pickupStack: 0,
            pendingSuitSeat: null,
            roundNumber: (prev.roundNumber || 1) + 1,
            rngSeed,
            logTail: [`Round ${(prev.roundNumber || 1) + 1} started!`],
            gameOver: false,
            paused: false,
        };
        const payload = stateToDbPayload(newState);
        await sb().rpc('commit_turn', {
            p_room: active.code,
            p_expected_seq: active.currentTurnSeq,
            p_new_state: payload,
            p_new_seat: 0,
        });
    }

    // ── Public API ────────────────────────────────────────────────────────────
    window.MP = {
        createRoom,
        joinRoom,
        listSeats,
        getRoom,
        addAISeat,
        removeSeat,
        startRoom,
        enterRoom,
        commitMove,
        requestNextRound,
        leaveRoom: clearActive,
        get active() { return active; },
        AI_CAP_PER_HUMAN,
    };
})();
