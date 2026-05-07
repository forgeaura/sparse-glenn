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
        $('setup-screen')?.classList.remove('hidden');
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
        document.querySelectorAll('.setup-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === name);
        });
        document.querySelectorAll('.setup-pane').forEach(p => {
            p.classList.toggle('hidden', p.dataset.pane !== name);
        });
        clearError();
    }

    function refreshAuthBanners() {
        const signedIn = !!window.AuthManager?.currentUser;
        $('setup-auth-required')?.classList.toggle('hidden', signedIn);
        $('setup-create-form')?.classList.toggle('hidden', !signedIn);
        $('setup-auth-required-join')?.classList.toggle('hidden', signedIn);
        $('setup-join-form')?.classList.toggle('hidden', !signedIn);
        $('setup-auth-required-mine')?.classList.toggle('hidden', signedIn);
        $('setup-mine-content')?.classList.toggle('hidden', !signedIn);
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
                    () => reject(new Error('timeout: Supabase RPC took >15s — schema cache stale or function missing?')),
                    15000)),
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
            const detail = e?.message || JSON.stringify(e);
            showError(`Could not create room: ${detail}. (Run migrations 001+002 in Supabase, then SQL: notify pgrst, 'reload schema';)`);
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
        try {
            await window.MP.addAISeat(code);
            await refreshLobbySeats();
        } catch (e) {
            showError(e.message);
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
            const seatIndex = await window.MP.joinRoom({
                code,
                displayName: window.AuthManager.currentUser.email?.split('@')[0] || 'Player',
            });
            $('setup-join-pending')?.classList.add('hidden');
            if (pendingPollHandle) { clearInterval(pendingPollHandle); pendingPollHandle = null; }
            pendingApprovalCode = null;

            joinCode = code;
            mySeatIndex = seatIndex;
            const room = await window.MP.getRoom(code);
            if (room.status === 'playing') {
                await window.MP.enterRoom(code, seatIndex);
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
        try {
            await window.MP.startRoom(code);
            if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
            await window.MP.enterRoom(code, mySeatIndex);
        } catch (e) {
            showError(e.message);
        }
    }

    // ── My Rooms tab ─────────────────────────────────────────────────────────
    async function refreshMyRooms() {
        if (!window.AuthManager?.currentUser) return;
        try {
            const [rooms, stats] = await Promise.all([
                window.MP.listMyRooms(),
                window.MP.getMyLifetimeStats(),
            ]);
            renderLifetimeStats(stats);
            renderMyRooms(rooms);
        } catch (e) {
            console.warn('My Rooms refresh failed:', e.message);
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
        try {
            if (status === 'paused' && kind === 'persistent') {
                await window.MP.resumeRoom(code);
            }
            // Treat "open" the same as joining the lobby — go through join_room (idempotent for members).
            joinCode = code;
            createCode = null; // resume from join side; admin pane will surface from membership data
            $('setup-join-lobby').classList.remove('hidden');
            activateTab('join');
            $('setup-join-code').value = code;
            await attemptJoin(code);
        } catch (e) {
            showError(e.message);
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
        if (!window.AuthManager?.currentUser) return;
        onCreate();
    }

    function init() {
        refreshAuthBanners();
        const startBtn = $('setup-start-game');
        if (startBtn) startBtn.disabled = true;

        document.querySelectorAll('.setup-tab').forEach(b => {
            b.onclick = () => {
                const name = b.dataset.tab;
                activateTab(name);
                if (name === 'create') maybeAutoCreate();
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

        setInterval(() => {
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
