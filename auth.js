// Supabase Auth + Database integration for Switch Card Game
// Exposes window.AuthManager — must be loaded before game.js

// ── Supabase config ──────────────────────────────────────────────────────────
// Replace these two values with your project's credentials from:
// Supabase dashboard → Project Settings → API
const SUPABASE_URL = 'https://ypwjvzybxbsubixlslsz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DBHsEayqtgagTjrsm9nk-w_WpcYb3OU';

// Use implicit OAuth flow (token in URL fragment) instead of the default PKCE
// flow (code in URL query, exchanged via a POST that needs a code_verifier
// from localStorage). PKCE is more secure but breaks easily on static sites
// in privacy-strict browsers — Brave Shields can clear the code_verifier
// between the redirect-out and the redirect-back, leaving the user stuck.
// Implicit flow has no such moving part: the access_token arrives directly
// in the hash and supabase-js parses it client-side.
const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        flowType: 'implicit',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
    },
});
window.SB = client; // shared singleton for multiplayer.js

// ── Database helpers ─────────────────────────────────────────────────────────

async function saveStateToSupabase(userId, state) {
    try {
        const { error } = await client.from('tournament_states').upsert({
            user_id: userId,
            player_total_score: state.playerTotalScore,
            computer_total_score: state.computerTotalScore,
            current_round: state.currentRound,
            show_playable_highlight: state.showPlayableHighlight,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (error) console.warn('Supabase save failed:', error.message);
    } catch (err) {
        console.warn('Supabase save error:', err);
    }
}

async function loadStateFromSupabase(userId) {
    try {
        const { data, error } = await client
            .from('tournament_states')
            .select('*')
            .eq('user_id', userId)
            .single();
        if (error || !data) return null;
        return {
            playerTotalScore: data.player_total_score,
            computerTotalScore: data.computer_total_score,
            currentRound: data.current_round,
            showPlayableHighlight: data.show_playable_highlight
        };
    } catch (err) {
        console.warn('Supabase load error:', err);
        return null;
    }
}

// ── Sidebar UI ───────────────────────────────────────────────────────────────

function updateSidebarAuthUI(user) {
    const loggedOutEl = document.getElementById('auth-logged-out');
    const loggedInEl = document.getElementById('auth-logged-in');
    const userEmailEl = document.getElementById('auth-user-email');
    if (!loggedOutEl) return;

    if (user) {
        loggedOutEl.classList.add('hidden');
        loggedInEl.classList.remove('hidden');
        userEmailEl.textContent = user.email;
    } else {
        loggedOutEl.classList.remove('hidden');
        loggedInEl.classList.add('hidden');
    }
}

// ── Auth state listener ──────────────────────────────────────────────────────

client.auth.onAuthStateChange(async (event, session) => {
    const user = session?.user ?? null;
    AuthManager._cachedUser = user; // Ensure cache is sync
    updateSidebarAuthUI(user);

    // After a successful OAuth sign-in, scrub the auth params out of the URL
    // so a page refresh doesn't re-process the same callback (and so
    // detectFailedOAuthCallback doesn't confuse itself on subsequent loads).
    if (event === 'SIGNED_IN') {
        try {
            const url = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, url);
        } catch (_) {}
        // Clear guest mode when they've properly signed in
        sessionStorage.removeItem('switch_guest_mode');
        AuthManager._isGuest = false;
        // Close modal if open and refresh UI
        try { AuthManager.closeModal(); } catch (_) {}
        document.dispatchEvent(new CustomEvent('authStateChanged'));
    }

    // Surface auth events to the page so the user can see what's happening
    // without needing devtools. This is invaluable when OAuth silently fails.
    try {
        const banner = document.getElementById('auth-status-banner');
        if (banner) {
            const t = new Date().toLocaleTimeString();
            const who = user ? user.email || user.id.slice(0, 8) : 'no user';
            banner.textContent = `[${t}] auth: ${event} — ${who}`;
            banner.classList.remove('hidden');
            if (user && event === 'SIGNED_IN') {
                setTimeout(() => banner.classList.add('hidden'), 4000);
            }
        }
    } catch (_) {}

    if (!user) return;

    const remoteState = await loadStateFromSupabase(user.id);
    if (!remoteState) return;

    // Check for conflicts with local state
    const localSaved = localStorage.getItem('switch_tournament_state');
    const localState = localSaved ? JSON.parse(localSaved) : null;

    const isCloudAdvanced = !localState || 
        remoteState.currentRound > localState.currentRound ||
        (remoteState.playerTotalScore !== localState.playerTotalScore);

    if (isCloudAdvanced) {
        if (!localState || confirm("Found a cloud save with your tournament progress. Would you like to resume your session from the cloud?")) {
            if (window.game) {
                window.game.applyState(remoteState);
                window.game.updateUI();
                // Update local storage backup immediately
                localStorage.setItem('switch_tournament_state', JSON.stringify(remoteState));
            } else {
                window._pendingRemoteState = remoteState;
            }
        }
    }
});

// ── Modal helpers ────────────────────────────────────────────────────────────

function showAuthError(message) {
    const el = document.getElementById('auth-error');
    el.textContent = message;
    el.classList.remove('hidden');
}

function clearAuthError() {
    const el = document.getElementById('auth-error');
    el.textContent = '';
    el.classList.add('hidden');
}

function friendlyError(message) {
    if (!message) return 'Something went wrong. Please try again.';
    const m = message.toLowerCase();
    if (m.includes('email not confirmed')) return 'Please confirm your email first — check your inbox for the verification link.';
    if (m.includes('invalid login') || m.includes('invalid email or password') || m.includes('invalid credentials')) return 'Invalid email or password.';
    if (m.includes('already registered') || m.includes('already exists') || m.includes('user already')) return 'An account with this email already exists. Try signing in instead.';
    if (m.includes('password should be')) return 'Password must be at least 6 characters.';
    if (m.includes('valid email') || m.includes('invalid email')) return 'Please enter a valid email address.';
    if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please try again later.';
    if (m.includes('user not found') || m.includes('no user')) return 'No account found with that email.';
    return 'Something went wrong. Please try again.';
}

// ── AuthManager (public API) ─────────────────────────────────────────────────

const AuthManager = {
    _isRegisterMode: false,
    _isGuest: false,

    // isGuest is now defined below continueAsGuest with sessionStorage hydration

    continueAsGuest() {
        this._isGuest = true;
        sessionStorage.setItem('switch_guest_mode', '1');
        this.closeModal();
        // SetupUI may not be ready yet — dispatch a custom event instead
        document.dispatchEvent(new CustomEvent('authStateChanged'));
    },

    // Returns true if the user previously chose guest mode this session
    get isGuest() {
        if (this._isGuest) return true;
        // Re-hydrate from sessionStorage (survives OAuth redirect back)
        if (sessionStorage.getItem('switch_guest_mode') === '1') {
            this._isGuest = true;
            return true;
        }
        return false;
    },

    get currentUser() {
        // Synchronous access via cached session
        return this._cachedUser ?? null;
    },

    openModal() {
        this._isRegisterMode = false;
        this._refreshModalUI();
        clearAuthError();
        document.getElementById('auth-email').value = '';
        document.getElementById('auth-password').value = '';
        document.getElementById('auth-overlay').classList.remove('hidden');
        document.body.classList.add('no-scroll');
        setTimeout(() => document.getElementById('auth-email').focus(), 100);
    },

    closeModal() {
        document.getElementById('auth-overlay').classList.add('hidden');
        document.body.classList.remove('no-scroll');
    },

    toggleMode() {
        this._isRegisterMode = !this._isRegisterMode;
        this._refreshModalUI();
        clearAuthError();
    },

    _refreshModalUI() {
        const isReg = this._isRegisterMode;
        document.getElementById('auth-modal-title').textContent = isReg ? 'Create Account' : 'Sign In';
        document.getElementById('auth-submit-btn').textContent = isReg ? 'Register' : 'Sign In';
        document.getElementById('auth-toggle-text').textContent = isReg ? 'Already have an account?' : "Don't have an account?";
        document.getElementById('auth-toggle-btn').textContent = isReg ? 'Sign In' : 'Register';
    },

    async handleSubmit() {
        clearAuthError();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const submitBtn = document.getElementById('auth-submit-btn');

        if (!email || !password) {
            showAuthError('Please enter your email and password.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Please wait…';

        try {
            if (this._isRegisterMode) {
                const { data, error } = await client.auth.signUp({ email, password });
                if (error) { showAuthError(friendlyError(error.message)); return; }
                // If the project requires email confirmation, signUp succeeds but
                // returns NO session. Do NOT mark the user as signed in — they need
                // to click the link in their inbox first.
                if (!data.session) {
                    showAuthError(
                        `Account created. Check ${email} for a confirmation link, click it, then come back here and sign in.`
                    );
                    return;
                }
                this._cachedUser = data.user;
                // Upload current local state so new account keeps existing progress
                if (window.game && data.user) {
                    await saveStateToSupabase(data.user.id, window.game.getState());
                }
            } else {
                const { data, error } = await client.auth.signInWithPassword({ email, password });
                if (error) { showAuthError(friendlyError(error.message)); return; }
                this._cachedUser = data.user;
                // onAuthStateChange fires next and loads remote state into the game
            }
            this.closeModal();
        } catch (err) {
            showAuthError(friendlyError(err.message));
        } finally {
            submitBtn.disabled = false;
            this._refreshModalUI();
        }
    },

    async signInWithGoogle() {
        // Use a clean URL (no hash, no query) so it matches Supabase's allow-list
        // exactly — leaving #join or ?code=... in the redirectTo causes Supabase
        // to reject the callback when the URL doesn't precisely match an entry.
        const cleanReturnUrl = window.location.origin + window.location.pathname;
        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: cleanReturnUrl }
        });
        if (error) showAuthError(friendlyError(error.message));
    },

    // Wipe any stuck/stale Supabase auth state from localStorage so the next
    // sign-in attempt starts completely fresh. Useful when an earlier OAuth
    // attempt left behind a partial session that's blocking new sign-ins.
    async resetAuthState() {
        try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
        // Supabase persists auth under sb-<projectRef>-auth-token. Clear ALL
        // sb-* keys to be safe.
        try {
            const keys = Object.keys(localStorage);
            for (const k of keys) {
                if (k.startsWith('sb-') || k.startsWith('supabase.')) localStorage.removeItem(k);
            }
        } catch (_) {}
        try {
            const keys = Object.keys(sessionStorage);
            for (const k of keys) {
                if (k.startsWith('sb-') || k.startsWith('supabase.')) sessionStorage.removeItem(k);
            }
        } catch (_) {}
        this._cachedUser = null;
        updateSidebarAuthUI(null);
        showAuthError('Auth state cleared. Try signing in again.');
        document.dispatchEvent(new CustomEvent('authStateChanged'));
    },

    async signOut() {
        // If we're inside a multiplayer room, disconnect and return to setup
        // before clearing auth — otherwise the user is left stranded on the
        // game board with no way back.
        if (window.MP?.active && window.leaveOnlineRoom) {
            try { window.leaveOnlineRoom(); } catch (_) {}
        }
        await client.auth.signOut();
        this._cachedUser = null;
        this._isGuest = false;
        sessionStorage.removeItem('switch_guest_mode');
        updateSidebarAuthUI(null);
        if (window.game) {
            window.game.loadState();
            window.game.updateUI();
        }
        // Signal screens to re-evaluate (landing vs setup)
        document.dispatchEvent(new CustomEvent('authStateChanged'));
    },

    // Called by game.js saveState() — writes to Supabase AND localStorage
    async saveState(state) {
        localStorage.setItem('switch_tournament_state', JSON.stringify(state));
        if (this._cachedUser) {
            await saveStateToSupabase(this._cachedUser.id, state);
        }
    },

    _cachedUser: null,
};

// Keep _cachedUser in sync with auth state
client.auth.getSession().then(({ data: { session } }) => {
    AuthManager._cachedUser = session?.user ?? null;
});

// Detect when we landed back from an OAuth provider (URL contains code= or
// access_token=) but no session was established within a reasonable window.
// That's the classic "Brave blocked the callback cookie" failure. Show a
// visible error pointing the user at the recovery options.
(function detectFailedOAuthCallback() {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    const looksLikeOAuthReturn =
        /[?&](code|access_token|error|error_description)=/.test(search) ||
        /[?&#](access_token|error)=/.test(hash);
    if (!looksLikeOAuthReturn) return;

    const banner = document.getElementById('auth-status-banner');
    if (banner) {
        banner.textContent = 'Processing OAuth callback…';
        banner.classList.remove('hidden');
    }

    // Wait up to 6s for SIGNED_IN. If it never fires, the callback failed.
    let resolved = false;
    const sub = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') resolved = true;
    });
    setTimeout(() => {
        try { sub?.data?.subscription?.unsubscribe?.(); } catch (_) {}
        if (resolved) return;
        if (!banner) return;
        // Pull the error param if present so the user sees the real reason.
        const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
        const errParam = params.get('error_description') || params.get('error') || '';
        banner.textContent = errParam
            ? `OAuth callback failed: ${errParam}. Tap "Stuck? Reset auth state" in the sign-in modal and try again, or use email/password.`
            : `OAuth completed but no session was created — likely browser blocked the auth cookie (Brave Shields, third-party cookie blocking, etc.). Tap "Stuck? Reset auth state" and try email/password instead.`;
        banner.classList.remove('hidden');
    }, 6000);
})();

window.AuthManager = AuthManager;
