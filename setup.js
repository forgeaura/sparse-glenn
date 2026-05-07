// Setup screen controller. Exposes window.SetupUI.

(function () {
    const $ = (id) => document.getElementById(id);

    let createCode = null;        // Code of the currently-being-built room (host side)
    let joinCode = null;          // Code we successfully joined (guest side)
    let mySeatIndex = null;       // My seat in either flow
    let pollHandle = null;        // setInterval id for lobby seat refresh (until subscribed)

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
        const humans = seats.filter(s => s.player_type === 'human').length;
        const ais = seats.filter(s => s.player_type === 'ai').length;
        const cap = humans * (window.MP?.AI_CAP_PER_HUMAN ?? 7);
        el.textContent = `(${ais} AI / ${cap} max)`;
        const addBtn = $('setup-add-ai');
        if (addBtn) addBtn.disabled = ais >= cap;
        const addBtn2 = $('setup-join-add-ai');
        if (addBtn2) addBtn2.disabled = ais >= cap;
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
        } catch (e) {
            showError(e.message);
        }
    }

    async function onCreate() {
        clearError();
        if (!window.AuthManager?.currentUser) {
            showError('Please sign in first.');
            return;
        }
        const policy = document.querySelector('input[name="drop-policy"]:checked')?.value || 'convert';
        try {
            const code = await window.MP.createRoom({
                dropPolicy: policy,
                displayName: window.AuthManager.currentUser.email?.split('@')[0] || 'Player',
            });
            createCode = code;
            mySeatIndex = 0;
            $('setup-room-code').textContent = code;
            await refreshLobbySeats();
            // Periodically refresh until we're subscribed (real-time joins reflect quickly).
            if (pollHandle) clearInterval(pollHandle);
            pollHandle = setInterval(refreshLobbySeats, 3000);
        } catch (e) {
            showError(e.message);
        }
    }

    async function onAddAI() {
        const code = createCode || joinCode;
        if (!code) return;
        try {
            await window.MP.addAISeat(code);
            await refreshLobbySeats();
        } catch (e) {
            showError(e.message);
        }
    }

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
        try {
            const seatIndex = await window.MP.joinRoom({
                code,
                displayName: window.AuthManager.currentUser.email?.split('@')[0] || 'Player',
            });
            joinCode = code;
            mySeatIndex = seatIndex;
            const room = await window.MP.getRoom(code);
            if (room.status === 'playing') {
                // Mid-game join — go straight to the board.
                await window.MP.enterRoom(code, seatIndex);
                return;
            }
            $('setup-join-lobby').classList.remove('hidden');
            await refreshLobbySeats();
            if (pollHandle) clearInterval(pollHandle);
            pollHandle = setInterval(refreshLobbySeats, 3000);
        } catch (e) {
            showError(e.message);
        }
    }

    async function onStart() {
        const code = createCode || joinCode;
        if (!code) return;
        clearError();
        try {
            await window.MP.startRoom(code);
            if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
            await window.MP.enterRoom(code, mySeatIndex);
        } catch (e) {
            showError(e.message);
        }
    }

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

    function init() {
        refreshAuthBanners();
        document.querySelectorAll('.setup-tab').forEach(b => {
            b.onclick = () => {
                const name = b.dataset.tab;
                activateTab(name);
                if (name === 'create' && !createCode && window.AuthManager?.currentUser) {
                    onCreate();
                }
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

        // Re-evaluate auth banners whenever auth state changes (poll every second; tiny cost).
        setInterval(refreshAuthBanners, 1000);
    }

    window.SetupUI = {
        init,
        show: showSetup,
        onSeatsChanged(seats) {
            // Called by multiplayer.js when room_seats changes mid-lobby.
            if (createCode || joinCode) refreshLobbySeats();
        },
        onRoomChanged(row) {
            // If host pressed Start, guests should follow.
            if (row.status === 'playing' && joinCode && mySeatIndex != null) {
                if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
                window.MP.enterRoom(joinCode, mySeatIndex).catch(e => showError(e.message));
            }
        },
    };
})();
