// Switch Card Game - Game Logic

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const VALUES = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'Joker': 20 };

class Card {
    constructor(suit, rank) {
        this.suit = suit; // hearts, diamonds, clubs, spades, or 'wild'
        this.rank = rank; // A, 2, 3, ..., K, or 'Joker'
        this.value = VALUES[rank];
        this.id = Math.random().toString(36).substr(2, 9);
    }

    get color() {
        return (this.suit === 'hearts' || this.suit === 'diamonds') ? 'red' : 'black';
    }

    get symbol() {
        const symbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠', 'wild': '★' };
        return symbols[this.suit] || '';
    }

    getSuitSVG(suit) {
        const svgStart = `<svg class="card-suit-svg" viewBox="0 0 100 100">`;
        const svgEnd = `</svg>`;
        let path = '';
        
        switch(suit) {
            case 'hearts':
                path = `<path d="M50 85 C50 85 10 60 10 35 A20 20 0 0 1 50 35 A20 20 0 0 1 90 35 C90 60 50 85 50 85" fill="currentColor"/>`;
                break;
            case 'diamonds':
                path = `<path d="M50 10 L85 50 L50 90 L15 50 Z" fill="currentColor"/>`;
                break;
            case 'clubs':
                path = `<path d="M50 45 A15 15 0 1 1 35 30 A15 15 0 1 1 65 30 A15 15 0 1 1 50 45 M50 45 L50 85 M40 85 L60 85" stroke="currentColor" stroke-width="8" fill="currentColor"/>`;
                break;
            case 'spades':
                path = `<path d="M50 15 C50 15 90 40 90 65 A20 20 0 1 1 50 65 A20 20 0 1 1 10 65 C10 40 50 15 50 15 M50 65 L50 85 M40 85 L60 85" stroke="currentColor" stroke-width="2" fill="currentColor"/>`;
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
            // King: Crown + Beard + Shoulders
            paths = `
                <path d="M30 30 L70 30 L70 70 L30 70 Z" fill="none" /> <!-- Shoulder/Body -->
                <path d="M35 30 L40 10 L50 20 L60 10 L65 30" /> <!-- Crown -->
                <circle cx="50" cy="45" r="8" /> <!-- Face -->
                <path d="M42 55 Q50 65 58 55" /> <!-- Beard -->
                <path d="M45 42 A1 1 0 0 1 45 44 M55 42 A1 1 0 0 1 55 44" stroke-width="3" /> <!-- Eyes -->
            `;
        } else if (rank === 'Q') {
            // Queen: Tiara + Hair + Cape
            paths = `
                <path d="M30 40 L50 20 L70 40 L60 80 L40 80 Z" fill="none" /> <!-- Body -->
                <path d="M40 30 L45 15 L55 15 L60 30" /> <!-- Tiara -->
                <circle cx="50" cy="45" r="8" /> <!-- Face -->
                <path d="M40 45 Q35 55 40 65 M60 45 Q65 55 60 65" /> <!-- Hair -->
                <path d="M48 55 Q50 58 52 55" /> <!-- Smile -->
            `;
        } else if (rank === 'J') {
            // Jack: Cap + Simple Face + Spear/Scepter
            paths = `
                <path d="M30 70 L40 40 L60 40 L70 70" /> <!-- Body -->
                <path d="M35 40 Q50 25 65 40" /> <!-- Cap -->
                <circle cx="50" cy="48" r="7" /> <!-- Face -->
                <path d="M75 20 L75 80 M70 25 L80 25" /> <!-- Scepter -->
            `;
        } else if (rank === 'Joker') {
            // Joker: Jester Hat (3 points) + Face
            paths = `
                <path d="M30 40 Q20 20 40 30 M50 35 Q50 10 50 10 M60 30 Q80 20 70 40" /> <!-- Hat -->
                <circle cx="50" cy="55" r="10" /> <!-- Face -->
                <path d="M42 60 Q50 70 58 60" /> <!-- Smile -->
                <circle cx="30" cy="20" r="2" fill="currentColor" /> <!-- Bells -->
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
        if (isDraggable) {
            div.draggable = true;
        }

        // Special glows
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

class Deck {
    constructor() {
        this.cards = [];
        this.init();
    }

    init() {
        this.cards = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.cards.push(new Card(suit, rank));
            }
        }
        // Add 2 Jokers
        this.cards.push(new Card('wild', 'Joker'));
        this.cards.push(new Card('wild', 'Joker'));
        this.shuffle();
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    draw() {
        if (this.cards.length === 0) return null;
        return this.cards.pop();
    }
}

class Game {
    constructor() {
        this.deck = new Deck();
        this.playerHand = [];
        this.computerHand = [];
        this.discardPile = [];
        this.currentSuit = null;
        this.currentRank = null;
        this.turn = 'player'; // 'player' or 'computer'
        this.pickupStack = 0;
        this.gameOver = false;
        this.currentRound = 1;
        this.playerTotalScore = 0;
        this.computerTotalScore = 0;
        this.isPendingSuitSelection = false;
        this.showPlayableHighlight = true;
        
        this.draggedCardId = null;
        this.selectedCardIndex = null;
    }

    saveState() {
        const state = {
            playerTotalScore: this.playerTotalScore,
            computerTotalScore: this.computerTotalScore,
            currentRound: this.currentRound,
            showPlayableHighlight: this.showPlayableHighlight
        };
        localStorage.setItem('switch_tournament_state', JSON.stringify(state));
    }

    loadState() {
        const saved = localStorage.getItem('switch_tournament_state');
        if (saved) {
            const state = JSON.parse(saved);
            this.playerTotalScore = state.playerTotalScore || 0;
            this.computerTotalScore = state.computerTotalScore || 0;
            this.currentRound = state.currentRound || 1;
            this.showPlayableHighlight = (state.showPlayableHighlight !== undefined) ? state.showPlayableHighlight : true;
            
            // Sync checkbox
            const checkbox = document.getElementById('highlight-toggle');
            if (checkbox) checkbox.checked = this.showPlayableHighlight;
        }
    }

    startRound() {
        this.deck = new Deck();
        this.playerHand = [];
        this.computerHand = [];
        this.discardPile = [];
        this.pickupStack = 0;
        this.gameOver = false;
        this.isPendingSuitSelection = false;

        // Deal 7 cards each with staggered animation
        for (let i = 0; i < 7; i++) {
            this.playerHand.push(this.deck.draw());
            this.computerHand.push(this.deck.draw());
        }

        // Trigger dealing animation after a short delay
        this.isDealing = true;
        this.updateUI();
        setTimeout(() => {
            this.isDealing = false;
            this.updateUI();
        }, 1500);


        // Initial discard card (cannot be a special card for simplicity of start)
        let initialCard = this.deck.draw();
        while (initialCard.rank === '2' || initialCard.rank === '3' || initialCard.rank === 'Joker') {
            this.deck.cards.unshift(initialCard);
            this.deck.shuffle();
            initialCard = this.deck.draw();
        }

        this.discardPile.push(initialCard);
        this.currentSuit = initialCard.suit;
        this.currentRank = initialCard.rank;
        this.turn = 'player';

        this.updateUI();
        this.log("Round " + this.currentRound + " started!");
    }

    log(msg) {
        const logBox = document.getElementById('game-log');
        const p = document.createElement('p');
        
        // Add icons based on keywords
        let icon = '📝';
        if (msg.includes('played')) icon = '🃏';
        if (msg.includes('drew')) icon = '🎴';
        if (msg.includes('suit')) icon = '✨';
        if (msg.includes('Round')) icon = '🏁';
        if (msg.includes('skipped')) icon = '🚫';
        if (msg.includes('stack')) icon = '🔥';
        
        p.innerHTML = `<span class="log-icon">${icon}</span> ${msg}`;
        logBox.appendChild(p);
        logBox.scrollTop = logBox.scrollHeight;
    }


    updateUI() {
        // Render Player Hand
        const playerHandEl = document.getElementById('player-hand');
        playerHandEl.innerHTML = '';
        this.playerHand.forEach((card, index) => {
            const cardEl = card.render(true); // Enable dragging
            if (this.turn === 'player' && !this.isPendingSuitSelection) {
                if (this.isPlayable(card) && this.showPlayableHighlight) {
                    cardEl.classList.add('playable');
                }
                if (this.selectedCardIndex === index) {
                    cardEl.classList.add('selected');
                }
                cardEl.onclick = () => this.handleCardClick(card, index);
            }
            
            // Drag and Drop implementation
            cardEl.ondragstart = (e) => this.handleDragStart(e, card.id);
            cardEl.ondragover = (e) => this.handleDragOver(e);
            cardEl.onleave = (e) => cardEl.classList.remove('drag-over');
            cardEl.ondrop = (e) => this.handleDrop(e, index);
            cardEl.ondragend = (e) => this.handleDragEnd(e);

            if (this.isDealing) {
                cardEl.classList.add('dealing');
                cardEl.style.animationDelay = `${index * 0.1}s`;
            }

            playerHandEl.appendChild(cardEl);
        });


        // Render Computer Hand (Face Down)
        const computerHandEl = document.getElementById('computer-hand');
        computerHandEl.innerHTML = '';
        this.computerHand.forEach((_, index) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card card-back';
            if (this.isDealing) {
                cardEl.classList.add('dealing');
                cardEl.style.animationDelay = `${index * 0.1}s`;
            }
            cardEl.style.setProperty('--rot', `${(index - (this.computerHand.length/2)) * 2}deg`);
            computerHandEl.appendChild(cardEl);
        });


        // Render Discard Pile (Top card)
        const discardPileEl = document.getElementById('discard-pile');
        discardPileEl.innerHTML = '';
        const topCard = this.discardPile[this.discardPile.length - 1];
        if (topCard) {
            const cardEl = topCard.render();
            // If suit was changed by joker, show the selected suit
            if (topCard.rank === 'Joker') {
                const centerEl = cardEl.querySelector('.card-center');
                centerEl.innerHTML = this.getSuitSVG(this.currentSuit);
                // Fix: Ensure color matches the selected suit
                cardEl.classList.remove('red', 'black');
                const suitColor = (this.currentSuit === 'hearts' || this.currentSuit === 'diamonds') ? 'red' : 'black';
                cardEl.classList.add(suitColor);
            }
            discardPileEl.appendChild(cardEl);
        }


        // Update counts
        document.getElementById('draw-count').innerText = this.deck.cards.length;
        document.getElementById('player-total-score').innerText = this.playerTotalScore;
        document.getElementById('computer-total-score').innerText = this.computerTotalScore;
        document.getElementById('current-round').innerText = this.currentRound;

        // Draw pile click
        const drawPileEl = document.getElementById('draw-pile');
        if (this.turn === 'player' && !this.isPendingSuitSelection) {
            drawPileEl.style.cursor = 'pointer';
            drawPileEl.onclick = () => this.playerDraw();
        } else {
            drawPileEl.style.cursor = 'default';
            drawPileEl.onclick = null;
        }

        // Highlight active turn
        document.getElementById('player-hand').style.opacity = this.turn === 'player' ? '1' : '0.6';
        document.getElementById('computer-hand').style.opacity = this.turn === 'computer' ? '1' : '0.6';
    }

    getSuitSymbol(suit) {
        const symbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠' };
        return symbols[suit] || '';
    }

    isPlayable(card) {
        if (this.pickupStack > 0) {
            return card.rank === '2';
        }
        if (card.rank === 'Joker') return true;
        return card.suit === this.currentSuit || card.rank === this.currentRank;
    }

    playCard(card, playerType) {
        if (this.gameOver) return;

        const hand = playerType === 'player' ? this.playerHand : this.computerHand;
        const index = hand.findIndex(c => c.id === card.id);
        if (index === -1) return;

        // Move card to discard
        hand.splice(index, 1);
        this.discardPile.push(card);
        this.currentRank = card.rank;
        this.currentSuit = card.suit;

        // Visual Feedback: Add playing class to hand card before it disappears
        this.updateUI(); 
        
        this.log(`${playerType === 'player' ? 'You' : 'Computer'} played ${card.rank} of ${card.suit === 'wild' ? 'Wild' : card.suit}`);


        // Check for Win
        if (hand.length === 0) {
            this.endRound(playerType);
            return;
        }

        // Handle Special Cards
        let skipTurn = false;
        if (card.rank === '2') {
            this.pickupStack += 2;
            this.log(`Pickup stack increased to ${this.pickupStack}!`);
            this.shakeBoard('danger');
        } else if (card.rank === '3') {
            skipTurn = true;
            this.log(`${playerType === 'player' ? 'Computer' : 'You'} skipped!`);
        } else if (card.rank === 'Joker') {
            this.shakeBoard('accent');
            if (playerType === 'player') {

                this.isPendingSuitSelection = true;
                document.getElementById('suit-selector').classList.remove('hidden');
                this.updateUI();
                return; // Wait for suit selection
            } else {
                this.aiSelectSuit();
            }
        }


        // Next Turn
        if (!skipTurn) {
            this.turn = (playerType === 'player') ? 'computer' : 'player';
        }

        if (this.turn === 'computer') {
            setTimeout(() => this.computerTurn(), 1000);
        }

        this.updateUI();
    }

    playerDraw() {
        if (this.turn !== 'player' || this.isPendingSuitSelection) return;

        if (this.pickupStack > 0) {
            this.log(`Picking up ${this.pickupStack} cards...`);
            for (let i = 0; i < this.pickupStack; i++) {
                const card = this.deck.draw();
                if (card) this.playerHand.push(card);
                else {
                    this.reshuffle();
                    const c = this.deck.draw();
                    if (c) this.playerHand.push(c);
                }
            }
            this.pickupStack = 0;
            this.turn = 'computer';
            setTimeout(() => this.computerTurn(), 1000);
        } else {
            const card = this.deck.draw();
            if (card) {
                this.playerHand.push(card);
                this.log(`You drew a card.`);
                
                // Animate draw
                this.updateUI();
                const newCardEl = document.querySelector(`.player-hand .card[data-id="${card.id}"]`);
                if (newCardEl) newCardEl.classList.add('drawing');

                // If the player still can't play, they skip.

                // But in Switch, you can usually play the card you just drew if it's playable.
                // We'll allow one play after draw if playable, else pass.
                if (!this.isPlayable(card)) {
                   this.turn = 'computer';
                   setTimeout(() => this.computerTurn(), 1000);
                }
            } else {
                if (this.reshuffle()) {
                    this.playerDraw();
                } else {
                    this.log("No more cards in deck!");
                    this.turn = 'computer';
                    setTimeout(() => this.computerTurn(), 1000);
                }
            }
        }
        this.updateUI();
    }

    reshuffle() {
        if (this.discardPile.length <= 1) return false;
        this.log("Reshuffling discard pile...");
        const topCard = this.discardPile.pop();
        this.deck.cards = [...this.discardPile];
        this.deck.shuffle();
        this.discardPile = [topCard];
        return true;
    }

    selectSuit(suit) {
        this.currentSuit = suit;
        this.isPendingSuitSelection = false;
        document.getElementById('suit-selector').classList.add('hidden');
        this.log(`Suit changed to ${suit}.`);
        this.turn = 'computer';
        setTimeout(() => this.computerTurn(), 1000);
        this.updateUI();
    }

    aiSelectSuit() {
        // Pick most frequent suit in computer hand
        const counts = {};
        this.computerHand.forEach(c => {
            if (c.suit !== 'wild') {
                counts[c.suit] = (counts[c.suit] || 0) + 1;
            }
        });
        let maxSuit = SUITS[Math.floor(Math.random() * SUITS.length)];
        let maxCount = -1;
        for (const s in counts) {
            if (counts[s] > maxCount) {
                maxCount = counts[s];
                maxSuit = s;
            }
        }
        this.currentSuit = maxSuit;
        this.log(`Computer changed suit to ${maxSuit}.`);
    }

    computerTurn() {
        if (this.gameOver) return;

        // If must pick up
        if (this.pickupStack > 0) {
            const playable2s = this.computerHand.filter(c => c.rank === '2');
            if (playable2s.length > 0) {
                this.playCard(playable2s[0], 'computer');
                return;
            } else {
                this.log(`Computer picks up ${this.pickupStack} cards.`);
                for (let i = 0; i < this.pickupStack; i++) {
                    const card = this.deck.draw();
                    if (card) this.computerHand.push(card);
                    else {
                        this.reshuffle();
                        const c = this.deck.draw();
                        if (c) this.computerHand.push(c);
                    }
                }
                this.pickupStack = 0;
                this.turn = 'player';
                this.updateUI();
                return;
            }
        }

        // Strategic AI:
        // 1. Playable cards
        const playableCards = this.computerHand.filter(c => this.isPlayable(c));
        
        if (playableCards.length === 0) {
            // Draw
            const card = this.deck.draw();
            if (card) {
                this.computerHand.push(card);
                this.log(`Computer drew a card.`);
                if (this.isPlayable(card)) {
                    // AI plays drawn card if possible
                    setTimeout(() => this.playCard(card, 'computer'), 500);
                } else {
                    this.turn = 'player';
                    this.updateUI();
                }
            } else {
                if (this.reshuffle()) {
                    this.computerTurn();
                } else {
                    this.log("No more cards in deck!");
                    this.turn = 'player';
                    this.updateUI();
                }
            }
            return;
        }

        // Heuristic: play high value cards first, priority to Jokers and 2s if stacking, or face cards.
        playableCards.sort((a, b) => b.value - a.value);
        
        // Priority to 2s if stacking is NOT active (start stacking)
        const twos = playableCards.filter(c => c.rank === '2');
        if (twos.length > 0) {
             this.playCard(twos[0], 'computer');
             return;
        }

        // Priority to Jokers if high value
        const jokers = playableCards.filter(c => c.rank === 'Joker');
        if (jokers.length > 0) {
            this.playCard(jokers[0], 'computer');
            return;
        }

        // Otherwise play highest value card
        this.playCard(playableCards[0], 'computer');
    }

    // Drag and Drop Handlers
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
        if (target && !target.classList.contains('dragging')) {
            target.classList.add('drag-over');
        }
    }

    handleDragEnd(e) {
        document.querySelectorAll('.card').forEach(c => {
            c.classList.remove('dragging');
            c.classList.remove('drag-over');
        });
    }

    handleDrop(e, targetIndex) {
        e.preventDefault();
        const cardId = e.dataTransfer.getData('text/plain');
        const sourceIndex = this.playerHand.findIndex(c => c.id === cardId);
        
        if (sourceIndex !== -1 && sourceIndex !== targetIndex) {
            // Reorder array
            const [movedCard] = this.playerHand.splice(sourceIndex, 1);
            this.playerHand.splice(targetIndex, 0, movedCard);
            this.updateUI();
        }
        
        this.handleDragEnd(null);
    }

    // Touch-friendly reordering (tap to select, tap to swap)
    handleCardClick(card, index) {
        if (this.turn !== 'player' || this.isPendingSuitSelection) return;

        // If it's playable, play it (existing logic)
        if (this.isPlayable(card)) {
            this.playCard(card, 'player');
            this.selectedCardIndex = null;
            return;
        }

        // Otherwise, treat as selection for reordering
        if (this.selectedCardIndex === null) {
            this.selectedCardIndex = index;
            this.updateUI();
        } else {
            if (this.selectedCardIndex !== index) {
                // Swap
                const [movedCard] = this.playerHand.splice(this.selectedCardIndex, 1);
                this.playerHand.splice(index, 0, movedCard);
            }
            this.selectedCardIndex = null;
            this.updateUI();
        }
    }

    calculateHandScore(hand) {
        return hand.reduce((total, card) => total + card.value, 0);
    }

    endRound(winner) {
        this.gameOver = true;
        const playerScore = this.calculateHandScore(this.playerHand);
        const computerScore = this.calculateHandScore(this.computerHand);

        this.playerTotalScore += playerScore;
        this.computerTotalScore += computerScore;

        const roundScoresEl = document.getElementById('round-scores');
        roundScoresEl.innerHTML = `
            <p>Your hand: ${playerScore} points</p>
            <p>Computer hand: ${computerScore} points</p>
        `;

        const title = document.getElementById('round-result-title');
        title.innerText = (playerScore < computerScore) ? "You Won the Round!" : "Computer Won the Round!";
        
        document.getElementById('round-end-overlay').classList.remove('hidden');

        this.saveState();

        document.getElementById('next-round-btn').onclick = () => {
             document.getElementById('round-end-overlay').classList.add('hidden');
             this.currentRound++;
             this.startRound();
        };
    }

    endGame() {
        document.getElementById('game-end-overlay').classList.remove('hidden');
        const winner = this.playerTotalScore < this.computerTotalScore ? "You" : "Computer";
        document.getElementById('game-winner').innerText = `${winner} Won the Game!`;
        document.getElementById('final-scores').innerHTML = `
            <p>Final Scores:</p>
            <p>You: ${this.playerTotalScore}</p>
            <p>Computer: ${this.computerTotalScore}</p>
        `;
    }

    shakeBoard(type = 'accent') {
        const board = document.getElementById('game-board');
        board.classList.remove('shake-accent', 'shake-danger');
        void board.offsetWidth; // Force reflow
        board.classList.add(`shake-${type}`);
        setTimeout(() => board.classList.remove(`shake-${type}`), 500);
    }
}

let game;


function startGame() {
    game = new Game();
    game.loadState();
    game.startRound();
}

function resetTournament() {
    if (confirm("Are you sure you want to reset the tournament? All scores will be lost.")) {
        localStorage.removeItem('switch_tournament_state');
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

// Initialize on load
window.onload = () => {
    startGame();
};

function selectSuit(suit) {
    if (game) game.selectSuit(suit);
}

function showHowToPlay() {
    document.getElementById('how-to-play-overlay').classList.remove('hidden');
}

function hideHowToPlay() {
    document.getElementById('how-to-play-overlay').classList.add('hidden');
}

