// Setup screen controller. Exposes window.SetupUI.

(function () {
    const $ = (id) => document.getElementById(id);

    let createCode = null;        // Code of the currently-being-built room (host side)
    let joinCode = null;          // Code we successfully joined (guest side)
    let mySeatIndex = null;       // My seat in either flow
    let pollHandle = null;        // setInterval id for lobby seat refresh (until subscribed)
    let pendingApprovalCode = null; // Code we've requested but not yet been approved for
    let pendingPollHandle = null;   // setInterval for retrying join after approval
    let createInFlight = false;     // Guard against re-entrant onCreate calls
    let createAttempted = false;    // True once we've tried (success or fail); stops retry-loops
    let activeTabName = 'solo';     // Tracks the currently-active tab so async errors can suppress themselves

    // ── On-screen diagnostics: capture errors so mobile users can see them ──
    function logDiag(label, detail) {
        const el = $('setup-error');
        if (!el) return;
        const line = `[${label}] ${detail}`.slice(0, 800);
        el.textContent = line;
        el.classList.remove('hidden');
        try { console.error(line); } catch (_) {}
    }
    window.addEventListener('error', (ev) => {
        logDiag('JS error', `${ev.message} (${ev.filename}:${ev.lineno})`);
    });
    window.addEventListener('unhandledrejection', (ev) => {
        const r = ev.reason;
        const msg = r?.message || (typeof r === 'string' ? r : JSON.stringify(r));
        logDiag('Unhandled', msg);
    });

    function showSetup() {
        const user = window.AuthManager?.currentUser;
        const isGuest = window.AuthManager?.isGuest;

        if (!user && !isGuest) {
            $('landing-screen')?.classList.remove('hidden');
            $('setup-screen')?.classList.add('hidden');
        } else {
            $('landing-screen')?.classList.add('hidden');
            $('setup-screen')?.classList.remove('hidden');
        }
        $('game-board')?.classList.add('hidden');
    }

    function showError(msg) {
        const el = $('setup-error');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('hidden', !msg);
    }

    function clearError() { showError(''); }

    function activateTab(name) {
        activeTabName = name;
        document.querySelectorAll('.setup-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === name);
        });
        document.querySelectorAll('.setup-pane').forEach(p => {
            p.classList.toggle('hidden', p.dataset.pane !== name);
        });
        clearError();
    }

    function refreshAuthBanners() {
        const user = window.AuthManager?.currentUser;
        const isGuest = window.AuthManager?.isGuest;
        const signedIn = !!user;

        // ── User bar (top of setup card) ────────────────────────────────────
        const userInfo = $('setup-user-info');
        const signoutBtn = $('setup-signout-btn');
        const signinBtn = $('setup-signin-btn');

        if (signedIn) {
            if (userInfo) userInfo.textContent = user.email;
            signoutBtn?.classList.remove('hidden');
            signinBtn?.classList.add('hidden');
        } else {
            if (userInfo) userInfo.textContent = isGuest ? 'Playing as Guest' : '';
            signoutBtn?.classList.add('hidden');
            // Show "Sign In" button only when in guest mode (not on landing screen)
            signinBtn?.classList.toggle('hidden', !isGuest);
        }

        // ── Multiplayer tab auth gates ────────────────────────────────────────
        // Show gate + hide form when guest; hide gate + show form when signed in.
        const tabs = [
            { gate: 'setup-auth-required-mine',  form: 'setup-mine-content'  },
            { gate: 'setup-auth-required',        form: 'setup-create-form'   },
            { gate: 'setup-auth-required-join',   form: 'setup-join-form'     },
        ];
        for (const { gate, form } of tabs) {
            $(gate)?.classList.toggle('hidden', signedIn);
            $(form)?.classList.toggle('hidden', !signedIn);
        }
    }

    function renderSeatList(containerId, seats, opts = {}) {
        const el = $(containerId);
        if (!el) return;
        const onRemove = opts.onRemove;
        const myUserId = window.AuthManager?.currentUser?.id;
        el.innerHTML = '';
        for (const seat of seats) {
            const isMe = seat.user_id && seat.user_id === myUserId;
            const row = document.createElement('div');
            row.className = 'seat-row';
            const labelType = seat.player_type === 'ai' ? '🤖 AI' : (isMe ? '🧑 You' : '🧑 Human');
            row.innerHTML = `
                <span class="seat-label">${labelType}</span>
                <span class="seat-name">${escapeHtml(seat.display_name)}</span>
                ${onRemove && (seat.player_type === 'ai' || isMe) ? `<button class="seat-remove" data-seat="${seat.seat_index}" title="Remove">×</button>` : ''}
            `;
            el.appendChild(row);
        }
        if (onRemove) {
            el.querySelectorAll('.seat-remove').forEach(btn => {
                btn.onclick = () => onRemove(parseInt(btn.dataset.seat, 10));
            });
        }
    }

    function updateCapCounter(seats) {
        const el = $('seat-cap-counter');
        if (!el) return;
        const myId = window.AuthManager?.currentUser?.id;
        const cap = window.MP?.AI_CAP_PER_HUMAN ?? 7;
        const myAIs = seats.filter(s => s.player_type === 'ai' && s.added_by === myId).length;
        const totalAIs = seats.filter(s => s.player_type === 'ai').length;
        el.textContent = `(your AI: ${myAIs}/${cap}; room total: ${totalAIs})`;
        const atCap = myAIs >= cap;
        const addBtn = $('setup-add-ai');
        if (addBtn) addBtn.disabled = atCap;
        const addBtn2 = $('setup-join-add-ai');
        if (addBtn2) addBtn2.disabled = atCap;
    }

    async function refreshLobbySeats() {
        const code = createCode || joinCode;
        if (!code) return;
        try {
            const seats = await window.MP.listSeats(code);
            const myId = window.AuthManager?.currentUser?.id;
            const me = seats.find(s => s.user_id === myId);
            if (me) {
                mySeatIndex = me.seat_index;
                const startBtn = createCode ? $('setup-start-game') : $('setup-join-start');
                if (startBtn) startBtn.disabled = false;
            }

            const target = createCode ? 'seat-list' : 'setup-join-seat-list';
            renderSeatList(target, seats, {
                onRemove: async (seatIndex) => {
                    try {
                        await window.MP.removeSeat(code, seatIndex);
                        await refreshLobbySeats();
                    } catch (e) { showError(e.message); }
                },
            });
            updateCapCounter(seats);
            if (createCode) await refreshAdminPane();
        } catch (e) {
            showError(e.message);
        }
    }

    // ── Admin pane: pending requests + member roles ──────────────────────────
    async function refreshAdminPane() {
        if (!createCode) return;
        const myId = window.AuthManager?.currentUser?.id;
        try {
            const members = await window.MP.listMembers(createCode);
            const me = members.find(m => m.user_id === myId);
            const isAdmin = me?.role === 'admin';
            const pane = $('setup-admin-pane');
            if (!pane) return;
            pane.classList.toggle('hidden', !isAdmin);
            if (!isAdmin) return;

            const pending = members.filter(m => m.state === 'requested');
            const active  = members.filter(m => m.state === 'active');
            renderPending(pending);
            renderMembers(active, myId);
        } catch (e) {
            // RPC may fail with empty room_members until migration 002 is run; stay quiet.
            console.warn('admin pane refresh failed:', e.message);
        }
    }

    function renderPending(pending) {
        const el = $('setup-pending-list');
        if (!el) return;
        if (!pending.length) { el.innerHTML = ''; return; }
        el.innerHTML = `<p class="pending-title">Pending join requests:</p>` +
            pending.map(m => `
                <div class="pending-row" data-uid="${m.user_id}">
                    <span class="pending-name">${escapeHtml(m.display_name || m.user_id.slice(0, 8))}</span>
                    <button class="btn btn-small" data-act="approve">Approve</button>
                    <button class="btn btn-small btn-outline" data-act="deny">Deny</button>
                </div>
            `).join('');
        el.querySelectorAll('.pending-row').forEach(row => {
            const uid = row.dataset.uid;
            row.querySelector('[data-act="approve"]').onclick = async () => {
                try { await window.MP.approveJoin(createCode, uid); await refreshAdminPane(); }
                catch (e) { showError(e.message); }
            };
            row.querySelector('[data-act="deny"]').onclick = async () => {
                try { await window.MP.denyJoin(createCode, uid); await refreshAdminPane(); }
                catch (e) { showError(e.message); }
            };
        });
    }

    function renderMembers(members, myId) {
        const el = $('setup-member-list');
        if (!el) return;
        el.innerHTML = `<p class="pending-title">Members:</p>` +
            members.map(m => {
                const isMe = m.user_id === myId;
                const adminBadge = m.role === 'admin' ? ' <span class="admin-badge">★ admin</span>' : '';
                return `
                    <div class="member-row" data-uid="${m.user_id}">
                        <span class="member-name">${escapeHtml(m.display_name || 'Player')}${adminBadge}${isMe ? ' (you)' : ''}</span>
                        ${isMe ? '' : `
                            ${m.role === 'admin'
                                ? '<button class="btn btn-small btn-outline" data-act="demote">Demote</button>'
                                : '<button class="btn btn-small btn-outline" data-act="promote">Make admin</button>'}
                            <button class="btn btn-small btn-outline" data-act="kick">Kick</button>
                        `}
                    </div>
                `;
            }).join('');
        el.querySelectorAll('.member-row').forEach(row => {
            const uid = row.dataset.uid;
            row.querySelector('[data-act="promote"]')?.addEventListener('click', async () => {
                try { await window.MP.setMemberRole(createCode, uid, 'admin'); await refreshAdminPane(); }
                catch (e) { showError(e.message); }
            });
            row.querySelector('[data-act="demote"]')?.addEventListener('click', async () => {
                try { await window.MP.setMemberRole(createCode, uid, 'member'); await refreshAdminPane(); }
                catch (e) { showError(e.message); }
            });
            row.querySelector('[data-act="kick"]')?.addEventListener('click', async () => {
                if (!confirm('Remove this member from the room?')) return;
                try { await window.MP.kickMember(createCode, uid, false); await refreshAdminPane(); await refreshLobbySeats(); }
                catch (e) { showError(e.message); }
            });
        });
    }

    // ── Create flow ──────────────────────────────────────────────────────────
    async function onCreate() {
        if (createInFlight) return;     // prevent re-entrant calls from the auto-create poller
        createInFlight = true;
        createAttempted = true;
        clearError();
        if (!window.AuthManager?.currentUser) {
            showError('Please sign in to create a multiplayer room.');
            createInFlight = false;
            return;
        }
        const dropPolicy = document.querySelector('input[name="drop-policy"]:checked')?.value || 'convert';
        const kind       = document.querySelector('input[name="room-kind"]:checked')?.value || 'one_off';
        const joinPolicy = document.querySelector('input[name="join-policy"]:checked')?.value || 'open';
        const name       = ($('setup-room-name')?.value || '').trim() || null;
        $('setup-room-code').textContent = '…';
        try {
            // 15s overall timeout so a hung request becomes a visible error.
            const code = await Promise.race([
                window.MP.createRoom({
                    dropPolicy, kind, joinPolicy, name,
                    displayName: window.AuthManager.currentUser.email?.split('@')[0] || 'Player',
                }),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('timeout: Supabase RPC took >30s — schema cache stale or function missing?')),
                    30000)),
            ]);
            createCode = code;
            mySeatIndex = 0;
            $('setup-room-code').textContent = code;
            const startBtn = $('setup-start-game');
            if (startBtn) startBtn.disabled = false;
            await refreshLobbySeats();
            if (pollHandle) clearInterval(pollHandle);
            pollHandle = setInterval(refreshLobbySeats, 3000);
        } catch (e) {
            $('setup-room-code').textContent = '—';
            // If the user has navigated away from the create tab, the error no
            // longer matches the screen they're on — suppress it instead of
            // hijacking another tab's error banner.
            if (activeTabName !== 'create') {
                console.warn('createRoom failed but user switched tabs:', e?.message);
                createInFlight = false;
                return;
            }
            const detail = e?.message || JSON.stringify(e);
            if (/auth required|JWT|not authenticated/i.test(detail)) {
                showError(
                    `Sign-in didn't complete properly (server says ${detail}). ` +
                    `This often happens with Google sign-in in incognito because of third-party cookies. ` +
                    `Click "Sign Out" then sign in again with email/password.`
                );
            } else {
                showError(`Could not create room: ${detail}. (Did you run migrations 001+002 and reload the PostgREST schema?)`);
            }
        } finally {
            createInFlight = false;
        }
    }

    async function onAddAI() {
        clearError();
        const code = createCode || joinCode;
        if (!code) {
            showError('No room yet — wait for the room code to appear, then try again.');
            return;
        }
        const buttons = ['setup-add-ai', 'setup-join-add-ai']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        buttons.forEach(b => { b.disabled = true; b.dataset.origText = b.textContent; b.textContent = 'Adding…'; });
        try {
            await Promise.race([
                window.MP.addAISeat(code),
                new Promise((_, reject) => setTimeout(() => reject(new Error('add_ai_seat timed out after 30s')), 30000)),
            ]);
            await refreshLobbySeats();
        } catch (e) {
            const msg = e?.message || String(e);
            if (/outside lobby|cannot modify seats/i.test(msg)) {
                showError(`Can't add AI to room ${code} — it's already in progress. Leave the room and create a new one (or pick Persistent next time so people can still join after the game starts).`);
            } else {
                showError(`Could not add AI: ${msg}`);
            }
        } finally {
            buttons.forEach(b => { b.disabled = false; if (b.dataset.origText) b.textContent = b.dataset.origText; });
        }
    }

    // ── Join flow (with approval support) ────────────────────────────────────
    async function onJoin() {
        clearError();
        if (!window.AuthManager?.currentUser) {
            showError('Please sign in first.');
            return;
        }
        const code = ($('setup-join-code').value || '').trim().toUpperCase();
        if (!/^[A-Z2-9]{6}$/.test(code)) {
            showError('Room code must be 6 characters (A-Z, 2-9).');
            return;
        }
        await attemptJoin(code);
    }

    async function attemptJoin(code) {
        try {
            const seatIndex = await Promise.race([
                window.MP.joinRoom({
                    code,
                    displayName: window.AuthManager.currentUser.email?.split('@')[0] || 'Player',
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('join_room timed out after 30s')), 30000)),
            ]);
            $('setup-join-pending')?.classList.add('hidden');
            if (pendingPollHandle) { clearInterval(pendingPollHandle); pendingPollHandle = null; }
            pendingApprovalCode = null;

            joinCode = code;
            mySeatIndex = seatIndex;
            const room = await window.MP.getRoom(code);
            if (room.status === 'playing') {
                await Promise.race([
                    window.MP.enterRoom(code, seatIndex),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('enterRoom timed out after 30s')), 30000)),
                ]);
                return;
            }
            $('setup-join-lobby').classList.remove('hidden');
            await refreshLobbySeats();
            if (pollHandle) clearInterval(pollHandle);
            pollHandle = setInterval(refreshLobbySeats, 3000);
        } catch (e) {
            if (e.code === 'pending_approval') {
                pendingApprovalCode = code;
                $('setup-join-pending')?.classList.remove('hidden');
                $('setup-join-lobby')?.classList.add('hidden');
                if (pendingPollHandle) clearInterval(pendingPollHandle);
                pendingPollHandle = setInterval(() => attemptJoin(code), 4000);
                return;
            }
            if (e.code === 'invite_required') {
                showError('This room is invite-only — ask an admin to invite you.');
                return;
            }
            if (e.code === 'banned') {
                showError('You are banned from this room.');
                return;
            }
            showError(e.message);
        }
    }

    async function onStart() {
        clearError();
        const code = createCode || joinCode;
        if (!code) {
            showError('No room yet — sign in and open the Create tab to generate a code.');
            return;
        }
        if (mySeatIndex == null) {
            showError(`Couldn't find your seat in room ${code}. Try Leave then Open from My Rooms.`);
            return;
        }

        // Pause the lobby poller while the transition is in flight to reduce network noise.
        if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }

        const buttons = ['setup-start-game', 'setup-join-start']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        buttons.forEach(b => { b.disabled = true; b.dataset.origText = b.textContent; b.textContent = 'Starting…'; });
        try {
            await Promise.race([
                window.MP.startRoom(code),
                new Promise((_, reject) => setTimeout(() => reject(new Error('start_room timed out after 30s')), 30000)),
            ]);
            await Promise.race([
                window.MP.enterRoom(code, mySeatIndex),
                new Promise((_, reject) => setTimeout(() => reject(new Error('enterRoom timed out after 30s — could not load room/seats/game_state')), 30000)),
            ]);
        } catch (e) {
            showError(`Could not start room ${code}: ${e?.message || e}`);
            // If starting failed, resume lobby polling so the UI stays alive.
            if (!pollHandle && (createCode || joinCode)) {
                pollHandle = setInterval(refreshLobbySeats, 3000);
            }
        } finally {
            buttons.forEach(b => { b.disabled = false; if (b.dataset.origText) b.textContent = b.dataset.origText; });
        }
    }

    // ── My Rooms tab ─────────────────────────────────────────────────────────
    async function refreshMyRooms() {
        if (!window.AuthManager?.currentUser) return;
        // Always render an empty list/stats first so the panel never shows up
        // completely blank — even if both RPCs fail.
        renderLifetimeStats(null);
        renderMyRooms([]);
        let errs = [];
        let rooms = [];
        let stats = null;
        try {
            rooms = await window.MP.listMyRooms();
        } catch (e) {
            errs.push(`list_my_rooms: ${e.message}`);
        }
        try {
            stats = await window.MP.getMyLifetimeStats();
        } catch (e) {
            errs.push(`user_lifetime_stats: ${e.message}`);
        }
        renderLifetimeStats(stats);
        renderMyRooms(rooms);
        if (errs.length) {
            showError(`Could not load My Rooms (${errs.join('; ')}). Check that migration 002 fully applied and run "notify pgrst, 'reload schema';" in Supabase SQL Editor.`);
        }
    }

    function renderLifetimeStats(stats) {
        const el = $('setup-lifetime-stats');
        if (!el) return;
        if (!stats) { el.textContent = 'No multiplayer rounds yet.'; return; }
        el.innerHTML = `
            <strong>Lifetime:</strong>
            ${stats.total_score} points across ${stats.rounds_played} rounds · ${stats.rounds_won} round wins
        `;
    }

    function renderMyRooms(rooms) {
        const el = $('setup-my-rooms');
        const empty = $('setup-my-rooms-empty');
        if (!el) return;
        empty?.classList.toggle('hidden', rooms.length > 0);
        el.innerHTML = rooms.map(r => {
            const label = r.name || '(unnamed)';
            const kindBadge = r.kind === 'persistent' ? '<span class="kind-badge persistent">persistent</span>' : '<span class="kind-badge oneoff">one-off</span>';
            const adminBadge = r.role === 'admin' ? '<span class="admin-badge">★ admin</span>' : '';
            const statusLabel = r.status === 'paused' ? '⏸ paused' :
                                r.status === 'playing' ? '▶ in progress' :
                                r.status === 'lobby' ? 'lobby' : r.status;
            return `
                <div class="my-room-row" data-code="${r.code}" data-kind="${r.kind}" data-status="${r.status}">
                    <div class="my-room-line1">
                        <strong>${escapeHtml(label)}</strong>
                        ${kindBadge} ${adminBadge}
                        <span class="my-room-status">${statusLabel}</span>
                    </div>
                    <div class="my-room-line2">
                        <span class="my-room-code">code ${r.code}</span>
                        <span class="my-room-score">${r.my_total_score} pts · ${r.my_rounds} rounds · ${r.my_wins} wins</span>
                    </div>
                    <div class="my-room-actions">
                        <button class="btn btn-small" data-act="resume">${r.status === 'paused' ? 'Resume' : 'Open'}</button>
                        <button class="btn btn-small btn-outline" data-act="leave">Leave</button>
                    </div>
                </div>
            `;
        }).join('');
        el.querySelectorAll('.my-room-row').forEach(row => {
            const code = row.dataset.code;
            const status = row.dataset.status;
            const kind = row.dataset.kind;
            row.querySelector('[data-act="resume"]').onclick = () => onResumeRoom(code, status, kind);
            row.querySelector('[data-act="leave"]').onclick = async () => {
                if (!confirm('Leave this room? You will lose your seat. Scores are preserved unless you rejoin.')) return;
                try { await window.MP.leaveRoom(code); await refreshMyRooms(); }
                catch (e) { showError(e.message); }
            };
        });
    }

    async function onResumeRoom(code, status, kind) {
        clearError();
        const btn = document.querySelector(`.my-room-row[data-code="${code}"] [data-act="resume"]`);
        if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = 'Opening…'; }
        try {
            if (status === 'paused' && kind === 'persistent') {
                await window.MP.resumeRoom(code);
            }
            // Treat "open" the same as joining the lobby — go through join_room (idempotent for members).
            joinCode = code;
            createCode = null;
            mySeatIndex = null; // Clear old seat until confirmed

            // Disable join-start button until attemptJoin confirms seat
            const joinStartBtn = $('setup-join-start');
            if (joinStartBtn) joinStartBtn.disabled = true;

            await attemptJoin(code);

            // Only show the lobby once we have successfully joined/resumed
            $('setup-join-lobby').classList.remove('hidden');
            activateTab('join');
            $('setup-join-code').value = code;
        } catch (e) {
            showError(`Could not open ${code}: ${e?.message || e}`);
        } finally {
            if (btn) { btn.disabled = false; if (btn.dataset.origText) btn.textContent = btn.dataset.origText; }
        }
    }

    // ── Misc helpers ─────────────────────────────────────────────────────────
    function copyRoomCode() {
        const code = $('setup-room-code')?.textContent || '';
        if (!code || code === '—') return;
        navigator.clipboard?.writeText(code).then(() => {
            const btn = $('setup-copy-code');
            if (!btn) return;
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = orig, 1200);
        });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function isCreateTabActive() {
        const pane = document.querySelector('.setup-pane[data-pane="create"]');
        return pane && !pane.classList.contains('hidden');
    }

    function maybeAutoCreate() {
        if (!isCreateTabActive()) return;
        if (createCode) return;
        if (createAttempted) return;       // don't loop after a failure; wait for explicit user action
        if (!window.AuthManager?.currentUser) return;
        onCreate();
    }

    function init() {
        // Determine which screen to show first
        showSetup();
        refreshAuthBanners();

        // React to sign-in / sign-out / continueAsGuest events
        document.addEventListener('authStateChanged', () => {
            showSetup();
            refreshAuthBanners();
        });

        const startBtn = $('setup-start-game');
        if (startBtn) startBtn.disabled = true;
        const joinStartBtn = $('setup-join-start');
        if (joinStartBtn) joinStartBtn.disabled = true;

        document.querySelectorAll('.setup-tab').forEach(b => {
            b.onclick = () => {
                const name = b.dataset.tab;
                activateTab(name);
                if (name === 'create') {
                    // Explicit user click should always retry, even after a previous failure.
                    createAttempted = false;
                    maybeAutoCreate();
                }
                if (name === 'mine')   refreshMyRooms();
            };
        });
        $('setup-solo-start').onclick = () => {
            if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
            window.startSoloGame();
        };
        $('setup-add-ai').onclick = onAddAI;
        $('setup-join-add-ai').onclick = onAddAI;
        $('setup-copy-code').onclick = copyRoomCode;
        $('setup-join-btn').onclick = onJoin;
        $('setup-join-start').onclick = onStart;
        $('setup-start-game').onclick = onStart;

        // In-game room bar buttons (Copy / Leave).
        const onlineCopy = $('online-copy-code');
        if (onlineCopy) onlineCopy.onclick = () => {
            const code = $('online-room-code')?.textContent || '';
            if (!code || code === '—') return;
            navigator.clipboard?.writeText(code).then(() => {
                onlineCopy.textContent = 'Copied!';
                setTimeout(() => onlineCopy.textContent = 'Copy', 1200);
            });
        };
        const onlineLeave = $('online-leave-room');
        if (onlineLeave) onlineLeave.onclick = () => {
            if (!confirm('Leave this room? Your seat will be released. You can rejoin anytime with the same code.')) return;
            createCode = null;
            joinCode = null;
            mySeatIndex = null;
            createAttempted = false;
            if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
            if (pendingPollHandle) { clearInterval(pendingPollHandle); pendingPollHandle = null; }
            window.leaveOnlineRoom?.();
        };

        setInterval(() => {
            // Only refresh the user-bar text + auto-create logic.
            // Do NOT call showSetup() here — it would fight the user's navigation.
            refreshAuthBanners();
            maybeAutoCreate();
        }, 1000);
    }

    window.SetupUI = {
        init,
        show: showSetup,
        onSeatsChanged() {
            if (createCode || joinCode) refreshLobbySeats();
        },
        onRoomChanged(row) {
            if (row.status === 'playing' && joinCode && mySeatIndex != null) {
                if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
                window.MP.enterRoom(joinCode, mySeatIndex).catch(e => showError(e.message));
            }
        },
    };
})();
