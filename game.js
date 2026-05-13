// Switch Card Game - Game Logic (N-seat)

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const VALUES = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'Joker': 50 };

// ── Seeded RNG (mulberry32). Used wherever determinism across clients matters. ────
function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomCardId() { return Math.random().toString(36).substr(2, 9); }
function plainCard(suit, rank) { return { suit, rank, id: randomCardId() }; }
function cardValue(c) { return VALUES[c.rank] ?? 0; }

// ── Deck construction (returns plain card array). ────────────────────────────────
function makeShuffledDeck(numDecks, rng) {
    const cards = [];
    for (let d = 0; d < numDecks; d++) {
        for (const s of SUITS) {
            for (const r of RANKS) cards.push(plainCard(s, r));
        }
        cards.push(plainCard('wild', 'Joker'));
        cards.push(plainCard('wild', 'Joker'));
    }
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

// ── Card (rendering only — wraps a plain {suit,rank,id}). ────────────────────────
class Card {
    constructor(suit, rank, id) {
        this.suit = suit;
        this.rank = rank;
        this.value = VALUES[rank];
        this.id = id ?? randomCardId();
    }

    static from(p) { return new Card(p.suit, p.rank, p.id); }

    get color() {
        return (this.suit === 'hearts' || this.suit === 'diamonds') ? 'red' : 'black';
    }

    getSuitSVG(suit) {
        const svgStart = `<svg class="card-suit-svg" viewBox="0 0 100 100">`;
        const svgEnd = `</svg>`;
        let path = '';
        switch (suit) {
            case 'hearts':
                path = `<path d="M50 88 C50 88 15 62 15 38 A18 18 0 0 1 50 30 A18 18 0 0 1 85 38 C85 62 50 88 50 88 Z" fill="currentColor"/>`;
                break;
            case 'diamonds':
                path = `<path d="M50 12 L82 50 L50 88 L18 50 Z" fill="currentColor"/>`;
                break;
            case 'clubs':
                path = `<path d="M50 50 A15 15 0 1 1 35 35 A15 15 0 1 1 65 35 A15 15 0 1 1 50 50 M50 50 L50 90 M35 90 L65 90" stroke="currentColor" stroke-width="6" fill="currentColor"/>`;
                break;
            case 'spades':
                path = `<path d="M50 15 C50 15 15 45 15 70 A18 18 0 1 0 50 70 A18 18 0 1 0 85 70 C85 45 50 15 50 15 M50 70 L50 90 M35 90 L65 90" stroke="currentColor" stroke-width="2" fill="currentColor"/>`;
                break;
            case 'wild':
                path = `<path d="M50 10 L61 40 L93 40 L67 60 L77 90 L50 72 L23 90 L33 60 L7 40 L39 40 Z" fill="currentColor"/>`;
                break;
        }
        return svgStart + path + svgEnd;
    }

    getFaceSVG(rank) {
        const svgStart = `<svg class="card-face-svg" viewBox="0 0 100 100">`;
        const svgEnd = `</svg>`;
        let paths = '';
        if (rank === 'K') {
            paths = `
                <path d="M30 30 L70 30 L70 70 L30 70 Z" fill="none" />
                <path d="M35 30 L40 10 L50 20 L60 10 L65 30" />
                <circle cx="50" cy="45" r="8" />
                <path d="M42 55 Q50 65 58 55" />
                <path d="M45 42 A1 1 0 0 1 45 44 M55 42 A1 1 0 0 1 55 44" stroke-width="3" />
            `;
        } else if (rank === 'Q') {
            paths = `
                <path d="M30 40 L50 20 L70 40 L60 80 L40 80 Z" fill="none" />
                <path d="M40 30 L45 15 L55 15 L60 30" />
                <circle cx="50" cy="45" r="8" />
                <path d="M40 45 Q35 55 40 65 M60 45 Q65 55 60 65" />
                <path d="M48 55 Q50 58 52 55" />
            `;
        } else if (rank === 'J') {
            paths = `
                <path d="M30 70 L40 40 L60 40 L70 70" />
                <path d="M35 40 Q50 25 65 40" />
                <circle cx="50" cy="48" r="7" />
                <path d="M75 20 L75 80 M70 25 L80 25" />
            `;
        } else if (rank === 'Joker') {
            paths = `
                <path d="M30 40 Q20 20 40 30 M50 35 Q50 10 50 10 M60 30 Q80 20 70 40" />
                <circle cx="50" cy="55" r="10" />
                <path d="M42 60 Q50 70 58 60" />
                <circle cx="30" cy="20" r="2" fill="currentColor" />
                <circle cx="50" cy="5" r="2" fill="currentColor" />
                <circle cx="70" cy="20" r="2" fill="currentColor" />
            `;
        }
        return svgStart + paths + svgEnd;
    }

    render(isDraggable = false, animationClass = '') {
        const div = document.createElement('div');
        div.className = `card face-up ${this.color} ${animationClass}`;
        div.dataset.id = this.id;
        if (isDraggable) div.draggable = true;

        if (this.rank === '2') div.classList.add('glow-2');
        if (this.rank === 'Joker') div.classList.add('glow-joker');

        const isFaceCard = ['J', 'Q', 'K', 'Joker'].includes(this.rank);
        const centerContent = isFaceCard ? this.getFaceSVG(this.rank) : this.getSuitSVG(this.suit);
        const suitIcon = this.getSuitSVG(this.suit);

        div.innerHTML = `
            <div class="card-top">
                <span class="card-rank">${this.rank === 'Joker' ? 'J' : this.rank}</span>
                <span class="card-suit">${suitIcon}</span>
            </div>
            <div class="card-center">${centerContent}</div>
            <div class="card-bottom">
                <span class="card-rank">${this.rank === 'Joker' ? 'J' : this.rank}</span>
                <span class="card-suit">${suitIcon}</span>
            </div>
        `;
        return div;
    }
}

// ── Pure rules helpers ───────────────────────────────────────────────────────────
function isPlayable(card, currentSuit, currentRank, pickupStack) {
    if (pickupStack > 0) return card.rank === '2';
    if (card.rank === 'Joker') return true;
    return card.suit === currentSuit || card.rank === currentRank;
}

function nextSeat(seatIndex, numSeats, direction = 1, skip = false) {
    const step = (skip ? 2 : 1) * direction;
    return ((seatIndex + step) % numSeats + numSeats) % numSeats;
}

// Whose action is the game waiting on right now?
function actingSeat(state) {
    return state.pendingSuitSeat != null ? state.pendingSuitSeat : state.currentSeat;
}

// ── Pure reducer. Returns { state, log[] }. Does not mutate the input. ───────────
// state shape: see Game._freshState
// action: { type:'play', cardId, chosenSuit? } | { type:'draw' } | { type:'pickup' } | { type:'select_suit', suit }
function applyAction(prev, seatIndex, action) {
    const s = JSON.parse(JSON.stringify(prev));
    const log = [];
    const N = s.numSeats;
    const name = s.seats[seatIndex].displayName;

    const reshuffleIfEmpty = () => {
        if (s.deck.length > 0) return true;
        if (s.discard.length <= 1) return false;
        const top = s.discard.pop();
        const seed = (s.rngSeed ^ s.discard.length ^ s.roundNumber) >>> 0;
        const rng = makeRng(seed || 1);
        const pile = s.discard;
        for (let i = pile.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [pile[i], pile[j]] = [pile[j], pile[i]];
        }
        s.deck = pile;
        s.discard = [top];
        log.push("Deck reshuffled.");
        return true;
    };

    if (action.type === 'play') {
        const hand = s.hands[seatIndex];
        const idx = hand.findIndex(c => c.id === action.cardId);
        if (idx === -1) return { state: prev, log: ['Invalid play (card not in hand)'] };
        const card = hand[idx];
        if (!isPlayable(card, s.currentSuit, s.currentRank, s.pickupStack)) {
            return { state: prev, log: ['Invalid play (not playable)'] };
        }

        hand.splice(idx, 1);
        s.discard.push(card);
        s.currentRank = card.rank;
        s.currentSuit = card.suit;
        log.push(`${name} played ${card.rank} of ${card.suit === 'wild' ? 'Wild' : card.suit}`);

        if (hand.length === 0) {
            // Round won — score remaining hands.
            for (let i = 0; i < N; i++) {
                if (i === seatIndex) continue;
                const handScore = s.hands[i].reduce((t, c) => t + cardValue(c), 0);
                s.scores[i] = (s.scores[i] || 0) + handScore;
            }
            s.gameOver = true;
            s.winnerSeat = seatIndex;
            log.push(`${name} won round ${s.roundNumber}!`);
            s.logTail = trimLog([...(s.logTail || []), ...log]);
            return { state: s, log };
        }

        let skip = false;
        if (card.rank === '2') {
            s.pickupStack += 2;
            log.push(`Pickup stack increased to ${s.pickupStack}!`);
        } else if (card.rank === '3') {
            skip = true;
            const skippedSeat = nextSeat(seatIndex, N, s.direction);
            log.push(`${s.seats[skippedSeat].displayName} skipped!`);
        } else if (card.rank === 'Joker') {
            if (action.chosenSuit) {
                s.currentSuit = action.chosenSuit;
                log.push(`Suit changed to ${action.chosenSuit}.`);
            } else {
                s.pendingSuitSeat = seatIndex;
                s.logTail = trimLog([...(s.logTail || []), ...log]);
                return { state: s, log };
            }
        }
        s.currentSeat = nextSeat(seatIndex, N, s.direction, skip);
    } else if (action.type === 'draw') {
        if (!reshuffleIfEmpty()) {
            log.push(`No cards left — turn passes.`);
            s.pickupStack = 0;
            s.currentSeat = nextSeat(seatIndex, N, s.direction);
        } else {
            const card = s.deck.pop();
            s.hands[seatIndex].push(card);
            log.push(`${name} drew a card.`);
            // Switch rule: keep turn if drawn card is playable so they may play it next.
            if (!isPlayable(card, s.currentSuit, s.currentRank, s.pickupStack)) {
                s.currentSeat = nextSeat(seatIndex, N, s.direction);
            }
        }
    } else if (action.type === 'pickup') {
        if (s.pickupStack <= 0) return { state: prev, log: ['No pickup stack'] };
        log.push(`${name} picks up ${s.pickupStack} cards.`);
        const stack = s.pickupStack;
        for (let i = 0; i < stack; i++) {
            if (!reshuffleIfEmpty()) break;
            s.hands[seatIndex].push(s.deck.pop());
        }
        s.pickupStack = 0;
        s.currentSeat = nextSeat(seatIndex, N, s.direction);
    } else if (action.type === 'select_suit') {
        if (s.pendingSuitSeat !== seatIndex) return { state: prev, log: ['Not your suit pick'] };
        s.currentSuit = action.suit;
        s.pendingSuitSeat = null;
        log.push(`${name} changed suit to ${action.suit}.`);
        s.currentSeat = nextSeat(seatIndex, N, s.direction);
    }

    s.logTail = trimLog([...(s.logTail || []), ...log]);
    return { state: s, log };
}

function trimLog(arr) {
    while (arr.length > 30) arr.shift();
    return arr;
}

// ── Pure AI. Deterministic given (state, seatIndex, seed). ───────────────────────
function decideAIMove(state, seatIndex, seed) {
    const rng = makeRng(seed || 1);
    const hand = [...state.hands[seatIndex]].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    // Pending suit pick on this seat (Joker just played, no chosenSuit) — pick best suit.
    if (state.pendingSuitSeat === seatIndex) {
        const counts = {};
        for (const c of hand) {
            if (c.suit !== 'wild') counts[c.suit] = (counts[c.suit] || 0) + 1;
        }
        let best = null, bestN = -1;
        for (const s of SUITS) {
            const n = counts[s] || 0;
            if (n > bestN) { bestN = n; best = s; }
        }
        if (!best) best = SUITS[Math.floor(rng() * SUITS.length)];
        return { type: 'select_suit', suit: best };
    }

    if (state.pickupStack > 0) {
        const twos = hand.filter(c => c.rank === '2');
        if (twos.length) return { type: 'play', cardId: twos[0].id };
        return { type: 'pickup' };
    }

    const playable = hand.filter(c => isPlayable(c, state.currentSuit, state.currentRank, state.pickupStack));
    if (playable.length === 0) return { type: 'draw' };

    const twos = playable.filter(c => c.rank === '2');
    if (twos.length) return { type: 'play', cardId: twos[0].id };

    const jokers = playable.filter(c => c.rank === 'Joker');
    if (jokers.length) {
        const remaining = hand.filter(c => c.id !== jokers[0].id && c.suit !== 'wild');
        const counts = {};
        for (const c of remaining) counts[c.suit] = (counts[c.suit] || 0) + 1;
        let best = null, bestN = -1;
        for (const s of SUITS) {
            const n = counts[s] || 0;
            if (n > bestN) { bestN = n; best = s; }
        }
        if (!best) best = SUITS[Math.floor(rng() * SUITS.length)];
        return { type: 'play', cardId: jokers[0].id, chosenSuit: best };
    }

    playable.sort((a, b) => (cardValue(b) - cardValue(a)) || (a.id < b.id ? -1 : 1));
    return { type: 'play', cardId: playable[0].id };
}

// ── Game class (single-player & remote-render orchestration) ─────────────────────
class Game {
    constructor(opts = {}) {
        const seats = opts.seats || [
            { seatIndex: 0, type: 'human', userId: null, displayName: 'You' },
            { seatIndex: 1, type: 'ai', userId: null, displayName: 'Computer' },
        ];
        this.mySeat = (opts.mySeat != null) ? opts.mySeat : 0;
        this.isOnline = !!opts.isOnline;
        this.dropPolicy = opts.dropPolicy || 'convert';
        // Each deck = 54 cards (52 + 2 Jokers). Dealing 7/seat needs >= 7N cards.
        // 1 deck supports up to 7 seats; 8+ seats need ≥ 2 decks.
        this.numDecks = Math.max(1, Math.ceil(seats.length / 7));

        // Legacy per-device tournament totals (only meaningful for the classic 1 human + 1 AI room).
        this.playerTotalScore = 0;
        this.computerTotalScore = 0;
        this.currentRound = 1;
        this.showPlayableHighlight = true;

        this.state = this._freshState(seats);

        this.draggedCardId = null;
        this.selectedCardIndex = null;
        this.turnSeq = 0;
        this._pendingJokerCardId = null;
        this.isDealing = false;
    }

    _freshState(seats) {
        const hands = {};
        const scores = {};
        for (let i = 0; i < seats.length; i++) { hands[i] = []; scores[i] = 0; }
        return {
            seats,
            numSeats: seats.length,
            hands,
            deck: [],
            discard: [],
            currentSeat: 0,
            currentSuit: null,
            currentRank: null,
            pickupStack: 0,
            pendingSuitSeat: null,
            direction: 1,
            scores,
            roundNumber: 1,
            gameOver: false,
            winnerSeat: null,
            rngSeed: ((Math.random() * 0x7fffffff) | 0),
            logTail: [],
            paused: false,
        };
    }

    saveState() {
        const state = this.getState();
        if (window.AuthManager) {
            AuthManager.saveState(state);
        } else {
            localStorage.setItem('switch_tournament_state', JSON.stringify(state));
        }
    }

    loadState() {
        const saved = localStorage.getItem('switch_tournament_state');
        if (saved) this.applyTournamentState(JSON.parse(saved));
        if (window._pendingRemoteState) {
            this.applyTournamentState(window._pendingRemoteState);
            window._pendingRemoteState = null;
        }
    }

    getState() {
        return {
            playerTotalScore: this.playerTotalScore,
            computerTotalScore: this.computerTotalScore,
            currentRound: this.currentRound,
            showPlayableHighlight: this.showPlayableHighlight,
        };
    }

    applyTournamentState(state) {
        this.playerTotalScore = state.playerTotalScore || 0;
        this.computerTotalScore = state.computerTotalScore || 0;
        this.currentRound = state.currentRound || 1;
        this.showPlayableHighlight = (state.showPlayableHighlight !== undefined) ? state.showPlayableHighlight : true;
        const checkbox = document.getElementById('highlight-toggle');
        if (checkbox) checkbox.checked = this.showPlayableHighlight;
    }

    // Kept for compatibility with auth.js, which calls game.applyState(remoteState).
    applyState(state) { this.applyTournamentState(state); }

    startRound() {
        const s = this.state;
        const rng = makeRng(((s.rngSeed ^ s.roundNumber) >>> 0) || 1);
        s.deck = makeShuffledDeck(this.numDecks, rng);
        for (let i = 0; i < s.numSeats; i++) s.hands[i] = [];
        s.discard = [];
        s.pickupStack = 0;
        s.gameOver = false;
        s.winnerSeat = null;
        s.pendingSuitSeat = null;
        s.currentSeat = 0;

        for (let i = 0; i < 7; i++) {
            for (let seat = 0; seat < s.numSeats; seat++) {
                s.hands[seat].push(s.deck.pop());
            }
        }

        let initial = s.deck.pop();
        let guard = 200;
        while (initial && guard-- > 0 && (initial.rank === '2' || initial.rank === '3' || initial.rank === 'Joker')) {
            s.deck.unshift(initial);
            for (let i = s.deck.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [s.deck[i], s.deck[j]] = [s.deck[j], s.deck[i]];
            }
            initial = s.deck.pop();
        }
        s.discard.push(initial);
        s.currentSuit = initial.suit;
        s.currentRank = initial.rank;

        this.isDealing = true;
        this.updateUI();
        setTimeout(() => { this.isDealing = false; this.updateUI(); }, 1500);

        this.log(`Round ${s.roundNumber} started!`);
        this._maybeScheduleAITurn();
    }

    log(msg) {
        const logBox = document.getElementById('game-log');
        if (!logBox) return;
        const p = document.createElement('p');
        let icon = '📝';
        if (msg.includes('played')) icon = '🃏';
        if (msg.includes('drew')) icon = '🎴';
        if (msg.includes('suit')) icon = '✨';
        if (msg.includes('Round') || msg.includes('round')) icon = '🏁';
        if (msg.includes('skipped')) icon = '🚫';
        if (msg.includes('stack')) icon = '🔥';
        p.innerHTML = `<span class="log-icon">${icon}</span> ${msg}`;
        logBox.appendChild(p);
        logBox.scrollTop = logBox.scrollHeight;
    }

    // Routes a player action — solo applies locally, online sends to multiplayer layer.
    commit(action) {
        if (this.state.gameOver) return;
        if (this.isOnline && window.MP) {
            window.MP.commitMove(action);
            return;
        }
        const acting = actingSeat(this.state);
        const result = applyAction(this.state, acting, action);
        this.state = result.state;
        for (const m of (result.log || [])) this.log(m);
        this.updateUI();
        if (this.state.gameOver) {
            this.endRound(this.state.winnerSeat);
            return;
        }
        this._maybeScheduleAITurn();
    }

    _maybeScheduleAITurn() {
        if (this.state.gameOver || this.isOnline || this.state.paused) return;
        const seat = this.state.seats[actingSeat(this.state)];
        if (!seat || seat.type !== 'ai') return;
        setTimeout(() => this._runAITurn(), 700);
    }

    _runAITurn() {
        if (this.state.gameOver || this.isOnline) return;
        const acting = actingSeat(this.state);
        const seat = this.state.seats[acting];
        if (!seat || seat.type !== 'ai') return;
        const action = decideAIMove(this.state, acting, ((this.state.rngSeed ^ this.turnSeq) >>> 0) || 1);
        this.turnSeq++;
        const r = applyAction(this.state, acting, action);
        this.state = r.state;
        for (const m of (r.log || [])) this.log(m);
        this.updateUI();
        if (this.state.gameOver) { this.endRound(this.state.winnerSeat); return; }
        this._maybeScheduleAITurn();
    }

    // Called by multiplayer.js when a fresh state row arrives over Realtime.
    applyRemoteState(remoteState, turnSeq) {
        this.state = remoteState;
        this.turnSeq = turnSeq;
        this.updateUI();
        if (this.state.gameOver) this.endRound(this.state.winnerSeat);
    }

    handleCardClick(card, index) {
        const s = this.state;
        if (s.currentSeat !== this.mySeat) return;
        if (s.pendingSuitSeat != null) return;
        if (s.gameOver) return;

        if (isPlayable(card, s.currentSuit, s.currentRank, s.pickupStack)) {
            if (card.rank === 'Joker') {
                this._pendingJokerCardId = card.id;
                document.getElementById('suit-selector').classList.remove('hidden');
                this.updateUI();
                return;
            }
            this.commit({ type: 'play', cardId: card.id });
            this.selectedCardIndex = null;
            return;
        }

        if (this.selectedCardIndex === null) {
            this.selectedCardIndex = index;
            this.updateUI();
        } else {
            if (this.selectedCardIndex !== index) {
                const hand = s.hands[this.mySeat];
                const [moved] = hand.splice(this.selectedCardIndex, 1);
                hand.splice(index, 0, moved);
            }
            this.selectedCardIndex = null;
            this.updateUI();
        }
    }

    playerDraw() {
        const s = this.state;
        if (s.currentSeat !== this.mySeat) return;
        if (s.pendingSuitSeat != null) return;
        if (s.gameOver) return;
        if (s.pickupStack > 0) this.commit({ type: 'pickup' });
        else this.commit({ type: 'draw' });
    }

    selectSuit(suit) {
        document.getElementById('suit-selector').classList.add('hidden');
        if (this._pendingJokerCardId) {
            const cardId = this._pendingJokerCardId;
            this._pendingJokerCardId = null;
            this.commit({ type: 'play', cardId, chosenSuit: suit });
            return;
        }
        if (this.state.pendingSuitSeat === this.mySeat) {
            this.commit({ type: 'select_suit', suit });
        }
    }

    endRound(winnerSeat) {
        const s = this.state;
        // Legacy 1H+1AI tournament totals — keeps the existing solo experience identical.
        if (s.numSeats === 2 && s.seats[0].type === 'human' && s.seats[1].type === 'ai') {
            const playerScore = s.hands[0].reduce((t, c) => t + cardValue(c), 0);
            const computerScore = s.hands[1].reduce((t, c) => t + cardValue(c), 0);
            this.playerTotalScore += playerScore;
            this.computerTotalScore += computerScore;
            this.saveState();
        }

        // Online: persist per-seat round scores to user_lifetime_stats + room_player_totals.
        // Idempotent server-side (room_round_results PK on (room_code, round_number)),
        // so it's safe for every client to call.
        if (this.isOnline && window.MP?.active?.code) {
            const handScores = s.hands.map(h => h.reduce((t, c) => t + cardValue(c), 0));
            window.MP.recordRoundResult(window.MP.active.code, s.roundNumber, handScores);
        }

        const roundScoresEl = document.getElementById('round-scores');
        roundScoresEl.innerHTML = s.seats.map((seat, i) => {
            const handScore = s.hands[i].reduce((t, c) => t + cardValue(c), 0);
            return `<p>${seat.displayName}: +${handScore} (total ${s.scores[i] || 0})</p>`;
        }).join('');

        const title = document.getElementById('round-result-title');
        const winnerName = winnerSeat != null ? s.seats[winnerSeat].displayName : '—';
        title.innerText = `${winnerName} won the round!`;

        document.getElementById('round-end-overlay').classList.remove('hidden');
        document.body.classList.add('no-scroll');

        document.getElementById('next-round-btn').onclick = () => {
            document.getElementById('round-end-overlay').classList.add('hidden');
            document.body.classList.remove('no-scroll');
            s.roundNumber++;
            this.currentRound = s.roundNumber;
            // In online mode, round transitions are driven by multiplayer layer.
            if (!this.isOnline) this.startRound();
            else if (window.MP && window.MP.requestNextRound) window.MP.requestNextRound();
        };
    }

    updateUI() {
        const s = this.state;

        // ── Player hand (mine) ────────────────────────────────────────────────
        const playerHandEl = document.getElementById('player-hand');
        if (!playerHandEl) return;
        playerHandEl.innerHTML = '';
        const myHand = s.hands[this.mySeat] || [];
        const myTurn = s.currentSeat === this.mySeat && s.pendingSuitSeat == null && !s.gameOver && !s.paused;

        myHand.forEach((cardData, index) => {
            const card = Card.from(cardData);
            const cardEl = card.render(true);
            if (myTurn) {
                if (isPlayable(cardData, s.currentSuit, s.currentRank, s.pickupStack) && this.showPlayableHighlight) {
                    cardEl.classList.add('playable');
                }
                if (this.selectedCardIndex === index) cardEl.classList.add('selected');
                cardEl.onclick = () => this.handleCardClick(cardData, index);
            }
            cardEl.ondragstart = (e) => this.handleDragStart(e, cardData.id);
            cardEl.ondragover = (e) => this.handleDragOver(e);
            cardEl.ondrop = (e) => this.handleDrop(e, index);
            cardEl.ondragend = (e) => this.handleDragEnd(e);
            if (this.isDealing) {
                cardEl.classList.add('dealing');
                cardEl.style.animationDelay = `${index * 0.1}s`;
            }
            playerHandEl.appendChild(cardEl);
        });

        // ── Opponents (everyone except mySeat, ordered clockwise from mySeat) ─
        const opponentsEl = document.getElementById('opponents');
        if (opponentsEl) {
            opponentsEl.innerHTML = '';
            const opponentSeats = [];
            for (let off = 1; off < s.numSeats; off++) {
                opponentSeats.push((this.mySeat + off) % s.numSeats);
            }
            opponentsEl.dataset.opponents = opponentSeats.length;

            for (const seatIdx of opponentSeats) {
                const seat = s.seats[seatIdx];
                const handCount = (s.hands[seatIdx] || []).length;
                const div = document.createElement('div');
                div.className = 'opponent';
                if (actingSeat(s) === seatIdx) div.classList.add('active');
                if (seat.type === 'ai') div.classList.add('opponent-ai');
                if (seat.isOffline) div.classList.add('opponent-offline');

                const showFan = opponentSeats.length <= 7;
                const fanCount = Math.min(handCount, 7);
                let fanHtml = '';
                if (showFan) {
                    for (let i = 0; i < fanCount; i++) {
                        const rot = (i - fanCount / 2) * 4;
                        fanHtml += `<div class="card card-back" style="--rot:${rot}deg"></div>`;
                    }
                }

                div.innerHTML = `
                    <div class="opponent-name">${seat.type === 'ai' ? '🤖 ' : ''}${escapeHtml(seat.displayName)}${seat.isOffline ? ' <span class="offline-tag">offline</span>' : ''}</div>
                    ${showFan ? `<div class="opponent-hand-row">${fanHtml}</div>` : ''}
                    <div class="opponent-count">${handCount} card${handCount === 1 ? '' : 's'}</div>
                `;
                opponentsEl.appendChild(div);
            }
        }

        // ── Discard top ───────────────────────────────────────────────────────
        const discardPileEl = document.getElementById('discard-pile');
        discardPileEl.innerHTML = '';
        const top = s.discard[s.discard.length - 1];
        if (top) {
            const cardEl = Card.from(top).render();
            if (top.rank === 'Joker') {
                const centerEl = cardEl.querySelector('.card-center');
                centerEl.innerHTML = Card.from(top).getSuitSVG(s.currentSuit);
                cardEl.classList.remove('red', 'black');
                const suitColor = (s.currentSuit === 'hearts' || s.currentSuit === 'diamonds') ? 'red' : 'black';
                cardEl.classList.add(suitColor);
            }
            discardPileEl.appendChild(cardEl);
        }

        // ── Counters ──────────────────────────────────────────────────────────
        document.getElementById('draw-count').innerText = s.deck.length;
        document.getElementById('player-total-score').innerText = this.playerTotalScore;
        document.getElementById('computer-total-score').innerText = this.computerTotalScore;
        document.getElementById('current-round').innerText = s.roundNumber;

        // Suit selector visibility (only my seat may pick).
        const suitSelEl = document.getElementById('suit-selector');
        if (suitSelEl) {
            const showForJokerInProgress = this._pendingJokerCardId != null;
            const showForRemoteJoker = s.pendingSuitSeat === this.mySeat;
            if (showForJokerInProgress || showForRemoteJoker) suitSelEl.classList.remove('hidden');
            else suitSelEl.classList.add('hidden');
        }

        // ── Draw pile interactivity ──────────────────────────────────────────
        const drawPileEl = document.getElementById('draw-pile');
        if (myTurn) {
            drawPileEl.style.cursor = 'pointer';
            drawPileEl.onclick = () => this.playerDraw();
        } else {
            drawPileEl.style.cursor = 'default';
            drawPileEl.onclick = null;
        }

        playerHandEl.style.opacity = myTurn ? '1' : '0.6';

        // ── Pause banner ──────────────────────────────────────────────────────
        const pauseEl = document.getElementById('pause-banner');
        if (pauseEl) {
            if (s.paused) pauseEl.classList.remove('hidden');
            else pauseEl.classList.add('hidden');
        }

        // Tournament-score widget makes sense for the legacy 1H+1AI room only.
        const scoreBoardEl = document.querySelector('.score-board');
        if (scoreBoardEl) {
            const isLegacy = s.numSeats === 2 && s.seats[0]?.type === 'human' && s.seats[1]?.type === 'ai';
            scoreBoardEl.style.display = isLegacy ? '' : 'none';
        }
    }

    getSuitSymbol(suit) {
        const symbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
        return symbols[suit] || '';
    }

    showReshuffleNotification() {
        const notification = document.createElement('div');
        notification.className = 'reshuffle-notification';
        notification.innerHTML = '🔄 Reshuffling Deck...';
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 1600);
    }

    shakeBoard(type = 'accent') {
        const board = document.getElementById('game-board');
        if (!board) return;
        board.classList.remove('shake-accent', 'shake-danger');
        void board.offsetWidth;
        board.classList.add(`shake-${type}`);
        setTimeout(() => board.classList.remove(`shake-${type}`), 500);
    }

    // ── Drag & Drop (reorder own hand) ───────────────────────────────────────
    handleDragStart(e, cardId) {
        this.draggedCardId = cardId;
        e.target.classList.add('dragging');
        e.dataTransfer.setData('text/plain', cardId);
        e.dataTransfer.effectAllowed = 'move';
    }
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.card');
        if (target && !target.classList.contains('dragging')) target.classList.add('drag-over');
    }
    handleDragEnd() {
        document.querySelectorAll('.card').forEach(c => {
            c.classList.remove('dragging');
            c.classList.remove('drag-over');
        });
    }
    handleDrop(e, targetIndex) {
        e.preventDefault();
        const cardId = e.dataTransfer.getData('text/plain');
        const hand = this.state.hands[this.mySeat];
        const sourceIndex = hand.findIndex(c => c.id === cardId);
        if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
            const [moved] = hand.splice(sourceIndex, 1);
            hand.splice(targetIndex, 0, moved);
            this.updateUI();
        }
        this.handleDragEnd();
    }
}

// HTML escape for displayName (could be user-provided in a multiplayer lobby).
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Bootstrap (called from setup screen, not auto on window.onload) ──────────────
let game;

function startSoloGame() {
    game = new Game();
    game.loadState();
    game.startRound();
    showGameBoard();
}

function startGameWithSeats(seats, mySeat, opts = {}) {
    game = new Game({ seats, mySeat, ...opts });
    if (seats.length === 2 && seats[0].type === 'human' && seats[1].type === 'ai') {
        game.loadState();
    }
    if (!opts.skipDeal) game.startRound();
    showGameBoard();
}

function showGameBoard() {
    const setup = document.getElementById('setup-screen');
    if (setup) setup.classList.add('hidden');
    const board = document.getElementById('game-board');
    if (board) board.classList.remove('hidden');
}

function showSetupScreen() {
    const board = document.getElementById('game-board');
    if (board) board.classList.add('hidden');
    const bar = document.getElementById('online-room-bar');
    if (bar) bar.classList.add('hidden');
    // Delegate to SetupUI which handles landing vs setup routing
    if (window.SetupUI?.show) {
        window.SetupUI.show();
    } else {
        const setup = document.getElementById('setup-screen');
        if (setup) setup.classList.remove('hidden');
    }
}

// Disconnect from the active multiplayer room and return to the setup screen.
// Persistent rooms are left in their current state (you'll see them in My Rooms);
// one-off rooms keep playing for any other humans still connected.
function leaveOnlineRoom() {
    if (window.MP) {
        try { window.MP.disconnect(); } catch (_) {}
    }
    game = null;
    showSetupScreen();
    // Re-render setup tabs so My Rooms reflects fresh state if user goes there.
    if (window.SetupUI?.show) window.SetupUI.show();
}
window.leaveOnlineRoom = leaveOnlineRoom;

function resetTournament() {
    if (confirm("Are you sure you want to reset the tournament? All scores will be lost.")) {
        const blank = { playerTotalScore: 0, computerTotalScore: 0, currentRound: 1, showPlayableHighlight: true };
        localStorage.removeItem('switch_tournament_state');
        if (window.AuthManager && AuthManager.currentUser) {
            AuthManager.saveState(blank);
        }
        location.reload();
    }
}

function toggleHighlight(enabled) {
    if (game) {
        game.showPlayableHighlight = enabled;
        game.saveState();
        game.updateUI();
    }
}

function selectSuit(suit) {
    if (game) game.selectSuit(suit);
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('hamburger-btn');
    const isOpen = menu.classList.toggle('open');
    btn.textContent = isOpen ? '✕' : '☰';
}

function closeMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('hamburger-btn');
    if (menu && menu.classList.contains('open')) {
        menu.classList.remove('open');
        btn.textContent = '☰';
    }
}

function showHowToPlay() {
    closeMobileMenu();
    document.getElementById('how-to-play-overlay').classList.remove('hidden');
    document.body.classList.add('no-scroll');
}

function hideHowToPlay() {
    document.getElementById('how-to-play-overlay').classList.add('hidden');
    document.body.classList.remove('no-scroll');
}

window.onload = () => {
    if (window.SetupUI && window.SetupUI.init) {
        window.SetupUI.init();
    } else {
        // Fallback: start solo immediately (parity with old behavior).
        startSoloGame();
    }
};
