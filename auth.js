// Firebase Auth + Firestore integration for Switch Card Game
// Exposes window.AuthManager — must be loaded before game.js

// ── Firebase config ─────────────────────────────────────────────────────────
// Replace these placeholder values with your project's firebaseConfig object
// from the Firebase console (Project Settings → Your apps → SDK setup).
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ── Firestore helpers ────────────────────────────────────────────────────────

async function saveStateToFirestore(uid, state) {
    try {
        await db.collection('users').doc(uid).set({ tournamentState: state }, { merge: true });
    } catch (err) {
        console.warn('Firestore save failed, mirrored to localStorage:', err);
    }
}

async function loadStateFromFirestore(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists && doc.data().tournamentState) {
            return doc.data().tournamentState;
        }
    } catch (err) {
        console.warn('Firestore load failed:', err);
    }
    return null;
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
// Fires on page load with cached credentials, and again after sign-in/out.

auth.onAuthStateChanged(async (user) => {
    updateSidebarAuthUI(user);

    if (!user) return;

    const remoteState = await loadStateFromFirestore(user.uid);
    if (!remoteState) return;

    if (window.game) {
        window.game.applyState(remoteState);
        window.game.updateUI();
    } else {
        // Auth resolved before window.onload — game picks this up in loadState()
        window._pendingRemoteState = remoteState;
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

// ── AuthManager (public API) ─────────────────────────────────────────────────

const AuthManager = {
    _isRegisterMode: false,

    get currentUser() {
        return auth.currentUser;
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
                await auth.createUserWithEmailAndPassword(email, password);
                // Upload current local state so the new account starts with existing progress
                if (window.game) {
                    await saveStateToFirestore(auth.currentUser.uid, window.game.getState());
                }
            } else {
                await auth.signInWithEmailAndPassword(email, password);
                // onAuthStateChanged fires next and will load remote state into the game
            }
            this.closeModal();
        } catch (err) {
            const messages = {
                'auth/user-not-found': 'No account found with that email.',
                'auth/wrong-password': 'Incorrect password.',
                'auth/invalid-login-credentials': 'Invalid email or password.',
                'auth/email-already-in-use': 'An account with this email already exists.',
                'auth/weak-password': 'Password must be at least 6 characters.',
                'auth/invalid-email': 'Please enter a valid email address.',
                'auth/too-many-requests': 'Too many attempts. Please try again later.',
            };
            showAuthError(messages[err.code] || 'Something went wrong. Please try again.');
        } finally {
            submitBtn.disabled = false;
            this._refreshModalUI();
        }
    },

    async signOut() {
        await auth.signOut();
        updateSidebarAuthUI(null);
        // Reload state from localStorage after sign-out
        if (window.game) {
            window.game.loadState();
            window.game.updateUI();
        }
    },

    // Called by game.js saveState() — writes to Firestore AND localStorage
    async saveState(state) {
        localStorage.setItem('switch_tournament_state', JSON.stringify(state));
        if (auth.currentUser) {
            await saveStateToFirestore(auth.currentUser.uid, state);
        }
    },
};

window.AuthManager = AuthManager;
