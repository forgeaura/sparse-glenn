// Supabase Auth + Database integration for Switch Card Game
// Exposes window.AuthManager — must be loaded before game.js

// ── Supabase config ──────────────────────────────────────────────────────────
// Replace these two values with your project's credentials from:
// Supabase dashboard → Project Settings → API
const SUPABASE_URL = 'https://ypwjvzybxbsubixlslsz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DBHsEayqtgagTjrsm9nk-w_WpcYb3OU';

const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    if (m.includes('invalid login') || m.includes('invalid email or password') || m.includes('email not confirmed')) return 'Invalid email or password.';
    if (m.includes('already registered') || m.includes('already exists')) return 'An account with this email already exists.';
    if (m.includes('password should be')) return 'Password must be at least 6 characters.';
    if (m.includes('valid email') || m.includes('invalid email')) return 'Please enter a valid email address.';
    if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please try again later.';
    if (m.includes('user not found') || m.includes('no user')) return 'No account found with that email.';
    return 'Something went wrong. Please try again.';
}

// ── AuthManager (public API) ─────────────────────────────────────────────────

const AuthManager = {
    _isRegisterMode: false,

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
        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.href }
        });
        if (error) showAuthError(friendlyError(error.message));
    },

    async signOut() {
        await client.auth.signOut();
        this._cachedUser = null;
        updateSidebarAuthUI(null);
        if (window.game) {
            window.game.loadState();
            window.game.updateUI();
        }
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

window.AuthManager = AuthManager;
