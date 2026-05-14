# AGENTS.md

> **Read this first.** If you're an AI agent working on Switch Card Game, this is your map. It covers the project, the conventions, and the workflow between Sarah (project owner), the orchestrator agent, and worker agents. Keep this file current when conventions change.

---

## 🎯 Project at a glance

| | |
|---|---|
| **What** | Switch — a multiplayer card game (like Crazy Eights / Mau-Mau) |
| **Stack** | Vanilla HTML + CSS + JS (no framework, no build step) |
| **Backend** | Supabase (Postgres + Auth + Realtime) |
| **Hosting** | GitHub Pages — static deploy from `master` |
| **Repo** | `forgeaura/switch-card-game` |
| **Default branch** | `master` |
| **Live URL** | `https://forgeaura.github.io/switch-card-game/` |

---

## 🧑‍💻 Working with Sarah (the owner)

- Junior dev building the project with AI assistance — **explain the *why*, not just the *what*.** Prefer diagrams, tables, and flowcharts over raw code walls.
- Tokens are not a concern — pick the strongest model when the task benefits from it.
- **Never commit without explicit approval.** Walk her through the change, show the verification, and wait for "looks good" before committing.

---

## 🎬 Orchestrator workflow

Sarah works with **two kinds of agents**:

| Role | Who | What they do |
|---|---|---|
| **Orchestrator** | A long-running conversation (usually Claude Opus 4, any mode) | Manages the project, maintains the backlog, designs tasks, reviews results, teaches concepts |
| **Worker agents** | Fresh conversations spun up per-task | Implement a single issue: code it, branch it, PR it |

### The orchestrator's responsibilities

1. **Project manager** — prioritize the backlog, break features into issues, sequence work
2. **GitHub issue author** — every piece of work starts with a GitHub Issue, written by the orchestrator. No work begins without a tracked issue. The orchestrator also maintains labels, milestones, and the project board so the backlog stays organized and Sarah can see progress at a glance.
3. **Mentor / teacher** — explain concepts, architecture decisions, and trade-offs so Sarah learns as the project grows
4. **Task designer** — write clear, self-contained task prompts (see template below) that Sarah can paste into a new agent conversation
5. **Quality gatekeeper** — after a worker agent finishes, review the PR with Sarah: walk through the diff, verify it works, and only then approve the merge
6. **NOT the primary coder** — the orchestrator delegates implementation. It only codes directly for trivial fixes or when writing a task prompt would take longer than the fix itself.

### Issue-first workflow

Every piece of work follows this lifecycle:

```
Orchestrator writes GitHub Issue (#NNN)
        ↓
Orchestrator designs task prompt (references #NNN)
        ↓
Sarah pastes prompt into new worker agent conversation
        ↓
Worker agent: codes → branches → commits "Closes #NNN" → pushes → opens PR
        ↓
Sarah + Orchestrator review PR together
        ↓
Sarah says "looks good" → squash merge → Issue #NNN auto-closes
```

**No orphan work.** If there's no issue, there's no branch. If there's no branch, there's no PR.

### Task prompt template

When the orchestrator creates a task for a worker agent, the prompt must include **all** of the following:

```
## Task: <title>

### Context
<What this feature/fix is about, why it matters, and any relevant background.>

### Relevant files
<List the files the agent will need to read or modify.>

### Acceptance criteria
<Numbered list of what "done" looks like.>

### Git instructions
1. `git checkout master && git pull && git checkout -b <branch-name>`
2. Make your changes
3. Commit with message: `<type>: <description>  Closes #<issue-number>`
4. `git push -u origin <branch-name>`
5. Open a PR against `master` with `Closes #<issue-number>` in the body

### Verification checklist (do all of these before asking Sarah to review)
1. `git status` — only the intended files are staged
2. Run a local server (`python3 -m http.server 8000`) and test manually
3. <Specific things to test for this task>
4. Screenshot any UI changes
5. Summarize what changed and why in the PR description
```

### Model & mode recommendations for worker agents

| Task type | Model | Mode | Why |
|---|---|---|---|
| Single-file CSS/copy tweak | Claude Sonnet 4 | Agent | Fast, cheap, well-scoped |
| Bug fix with clear scope | Claude Sonnet 4 | Agent | Focused, single-file |
| Feature touching 1–2 files | Claude Sonnet 4 | Agent | Straightforward implementation |
| Cross-file feature (≥3 files) | Claude Opus 4 | Plan | Needs to reason about dependencies |
| Game rule changes (`applyAction`) | Claude Opus 4 | Plan | High-risk, needs careful analysis |
| Database migration changes | Claude Opus 4 | Plan | Schema changes are irreversible |
| Architecture decisions | Claude Opus 4 | Plan | Needs broad context |

### Reviewing a worker agent's output (Sarah + orchestrator together)

1. **Read the PR description** — does it explain what and why?
2. **Check `git diff`** — are only the intended files changed?
3. **Run locally** — `python3 -m http.server 8000`, open in browser, test the specific change
4. **Spot-check for gotchas** — version bump on `?v=N`? `index.html` updated if new file added?
5. **Sarah says "looks good"** → squash merge to `master`

---

## 🔒 Git rules (non-negotiable)

| Rule | Detail |
|---|---|
| **Never commit to `master`** | Always: `git checkout master && git pull && git checkout -b <branch>` |
| **Branch naming** | `feat/<short-slug>`, `fix/<short-slug>`, or `chore/<short-slug>` |
| **Issue linking** | Every commit message and PR body includes `Closes #NNN` or `Fixes #NNN` |
| **Merge strategy** | Squash merge to `master` |
| **Scope** | One issue → one branch → one PR. Don't bundle unrelated work. |

---

## ✅ Verification before commit (every time)

1. **Summary** of what changed and why
2. **`git status`** — confirm only intended files are staged
3. **Manual test** — open `index.html` in a browser (or local server) and verify the change works
4. **Screenshot or description** for any UI change
5. Wait for **"looks good"** from Sarah

> Skipping this is a task failure even if the code is correct.

---

## 🗂 Architecture — the file map

```
switch-card-game/
├── index.html          ← Single-page app shell (all screens + modals)
├── style.css           ← All styles (glassmorphism, animations, responsive)
├── auth.js             ← Supabase auth (email/password, Google OAuth, guest mode)
├── game.js             ← Core game engine (pure reducer, AI, Card renderer, UI)
├── multiplayer.js      ← Online rooms (Supabase Realtime, RPCs, presence)
├── setup.js            ← Setup/lobby screen controller (tabs, room CRUD)
├── assets/
│   ├── background.png  ← Table background
│   └── card-back.png   ← Card back design
├── migrations/
│   ├── 001_multiplayer.sql  ← Core schema: rooms, room_seats, game_states, RPCs
│   └── 002_persistent_rooms.sql ← Persistent rooms, members, lifetime stats
└── .github/workflows/
    └── deploy.yml      ← GitHub Pages deploy on push to master
```

### Module dependency order (load order matters)

```
supabase-js (CDN) → auth.js → game.js → multiplayer.js → setup.js
```

- **`auth.js`** creates the Supabase client (`window.SB`) and `window.AuthManager`
- **`game.js`** defines the `Game` class, `Card` class, pure `applyAction` reducer, and `decideAIMove`
- **`multiplayer.js`** wraps Supabase RPCs and Realtime into `window.MP`
- **`setup.js`** manages the lobby UI via `window.SetupUI`

### Key global exports

| Window property | Source | Purpose |
|---|---|---|
| `window.SB` | `auth.js` | Supabase client singleton |
| `window.AuthManager` | `auth.js` | Auth state & UI control |
| `window.game` | `game.js` | Active Game instance |
| `window.MP` | `multiplayer.js` | Multiplayer API |
| `window.SetupUI` | `setup.js` | Setup screen controller |

---

## 🃏 Game rules reference (Switch)

Understanding the rules is essential for touching `game.js` or `multiplayer.js`:

- **Goal:** Be the first to empty your hand. Other players score points for cards remaining.
- **Play a card** if it matches the **suit** or **rank** of the discard pile top.
- **Special cards:**
  - **2** → next player draws 2 (stackable with another 2)
  - **3** → skip the next player
  - **Joker** → wild, play anytime; player picks a new suit
- **Draw** if you can't play — if the drawn card is playable, you keep your turn.
- **Scoring:** card face values (A=1, 2–10 face value, J=11, Q=12, K=13, Joker=50).
- **Determinism:** uses seeded RNG (`mulberry32`) so all clients produce identical shuffles.

---

## 🔧 Supabase integration details

### Auth flow
- **Implicit OAuth** (not PKCE) — chosen for static-site compatibility with privacy-strict browsers
- `autoRefreshToken: false` — prevents token-refresh loops that break on GitHub Pages
- Guest mode stores flag in `sessionStorage`

### Database tables (via migrations)

| Table | Purpose |
|---|---|
| `rooms` | Room metadata (code, status, drop policy, kind) |
| `room_seats` | Who sits where (human/AI, display name, presence) |
| `game_states` | Full game state as JSONB (deck, hands, scores, etc.) |
| `tournament_states` | Solo per-user cloud save |
| `room_members` | Persistent room membership + roles (migration 002) |
| `room_player_totals` | Per-room lifetime scores (migration 002) |
| `user_lifetime_stats` | Cross-room aggregated stats (migration 002) |
| `room_round_results` | Round-level scoring history (migration 002) |

### Key RPCs (all `SECURITY DEFINER`)

`create_room`, `join_room`, `add_ai_seat`, `start_room`, `commit_turn`, `record_round_result`, `list_my_rooms`, `list_room_members`, `approve_join`, `deny_join`, `set_member_role`, `kick_member`, `leave_room`, `pause_room`, `resume_room`

### Realtime

One channel per room (`room:{code}`) subscribes to:
- `game_states` UPDATE — state sync
- `room_seats` * — lobby refresh
- `rooms` UPDATE — status changes
- Presence — online/offline detection + drop policy enforcement

---

## ⚠️ Gotchas & known patterns

1. **No build step.** There's no `npm`, no bundler. Files are loaded via `<script>` tags with cache-busting `?v=N` params. When adding a file, update `index.html`.
2. **Version params.** Bump `?v=N` on script/style tags when deploying changes to avoid cached stale files.
3. **`escapeHtml` is defined twice** — once in `game.js` (global) and once inside `setup.js` (IIFE-scoped). The global one wins for shared use.
4. **Pure reducer pattern.** `applyAction()` in `game.js` is a pure function — no side effects. Both solo and multiplayer modes use it. Changes to game rules go here.
5. **Optimistic concurrency.** `commit_turn` uses `p_expected_seq` — if another client committed first, you get `NULL` back and the Realtime broadcast will sync you.
6. **AI is client-side.** Any connected client can run AI turns (race-claimed via `commit_turn`). No server-side AI.
7. **Drop policies.** When a human disconnects: `convert` (→ AI), `pause` (freeze game), or `end_round` (force score).

---

## 📋 Plan vs Agent mode (Antigravity)

See the **Model & mode recommendations** table in the Orchestrator Workflow section above for detailed guidance. Quick rule of thumb:

| Use Plan mode for | Use Agent mode for |
|---|---|
| Cross-file changes (≥3 files) | Single-file edits |
| New features or game rule changes | CSS tweaks / copy changes |
| Database migration changes | Bug fixes with clear scope |
| Architecture decisions | Renaming / reformatting |
| Anything touching `applyAction` | Adding log messages |

---

## 🚀 Running locally

```bash
# Any static server works. Examples:
python3 -m http.server 8000
# or
npx -y serve .

# Then open http://localhost:8000
# For OAuth to work locally, add http://localhost:8000 to
# Supabase → Auth → URL Configuration → Redirect URLs
```

---

## 🔑 Critical decisions (don't change without asking Sarah)

- **No build tooling.** This is a deliberately simple vanilla JS project. No React, no bundler, no npm. This is intentional.
- **Supabase is the only backend.** All server logic lives in Postgres RPCs.
- **Implicit OAuth flow.** Chosen over PKCE for static-site compatibility. Don't switch without discussion.
- **`$0 hosting`** via GitHub Pages. No server costs.
- **AI budget:** each human can add up to 7 AI seats per room.
