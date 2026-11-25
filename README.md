# SprintPulse Retro

Agile retrospectives that live inside Jira Cloud. Built entirely on **Atlassian Forge**
(Custom UI + Forge KVS + Forge Realtime), with no external hosting and no third-party
network calls, so it is eligible for Atlassian's **Runs on Atlassian** badge.

- **Entry point:** a Jira project page (`jira:projectPage`). Each project has its own retros.
- **Stack:** React 18, TypeScript, Vite, Tailwind CSS 4, Lucide icons and `@dnd-kit`.
  The backend is TypeScript resolvers on the `nodejs22.x` runtime.

---

## Features

| Area | What you get |
|---|---|
| **Jira context** | Retros are named after the sprint automatically (e.g. *Sprint 24 Retrospective*) from the project's scrum boards. Action items become Jira issues in one click, optionally added straight into a sprint. Key, status and assignee sync back live. |
| **Templates** | Start/Stop/Continue, Mad/Sad/Glad, 4Ls, Sailboat and DAKI. Each comes with a background theme. A template builder lets you add, rename, reorder and colour columns, and save the result as a custom template. Facilitators can also edit the columns of a live board. |
| **Views** | A column board, plus a tabbed **Focus view** that shows one column at a time for large teams. |
| **Engagement** | An icebreaker deck (20 curated questions plus your own). A mood check-in when people join, totals only. Facilitator-controlled ambient music with shared play/pause, which each participant can mute for themselves. |
| **Phases** | Icebreaker → **Brainstorm** (private: cards are masked server-side until *Reveal*; anonymous or named) → **Group** (drag a card onto a card to stack them; drag stacks between columns) → **Vote** (configurable limit and per-item cap; totals hidden until *End voting*; sort by votes) → **Actions** → Closed. |
| **Facilitation** | A shared countdown timer (1, 3, 5 or 10 minutes, or custom) with a chime on every client. **Spotlight** puts one card or group on everyone's screen, with a *Next topic* button. Reveal, anonymity and voting settings, plus co-facilitators. |
| **Cards** | Markdown, emoji reactions, threaded comments, `#hashtags` that become topic tags, and an animated reaction-sticker pack. |
| **Action items** | A drawer with an assignee picker (Jira assignable users) and due dates. You can create one from any card. Issues can go to the backlog or a sprint. Status syncs every 60 s while the drawer is open, and on demand. |
| **History & analytics** | A searchable archive with status filters, archive and restore. A project-wide action items list with overdue flags. A **Team health** dashboard: mood trend, action follow-through (live from Jira) and recurring topics. Each chart has a table view. |
| **Export** | Markdown and CSV (download, or copy as a fallback inside the Jira iframe), or **publish as a Confluence page**. Unrevealed cards are never exported, and anonymous cards are never attributed. |

### Privacy guarantees

These are enforced on the server and covered by tests:

- Unrevealed brainstorm cards are masked **before they leave the resolver**. Other users never receive the text, only its length.
- An anonymous card's author is never sent to other users. It isn't in realtime payloads, and realtime events carry no actor ID at all.
- Anonymous cards read *Anonymous* even to their own author, on the board, in the spotlight and in exports, because facilitators screen-share.
- Vote totals are withheld, from snapshots and realtime alike, until the facilitator ends voting.
- The project always comes from Forge's invocation context, never from the request payload. Jira calls run **as the user**, so Jira permissions apply.
- Only the backend can publish to a retro's realtime channel: publishing uses a signed token, and clients receive a subscribe-only token.

---

## Architecture

```
static/retro-ui (Custom UI, iframe in Jira)              src/ (Forge function "resolver")
------------------------------------------               --------------------------------
React components                                         resolvers/*  -- RPC layer (RpcResult envelope)
  └ hooks/useRetroSync  -- snapshot + realtime ───────►    └ services/*  -- domain logic
       │                   + fallback polling                 ├ storage/   -- KVS entities, optimistic locking
       ▼                                                      ├ realtime/  -- signed Forge Realtime publish
  lib/api.ts  -- the only @forge/bridge user                  └ jira/      -- Jira + Confluence REST (asUser)
       │   (or the Local Mock Adapter outside Jira)
       ▼
  src/shared/*  -- types, rules, catalogues, exporters (imported by BOTH sides)
```

### Storage

Forge KVS **custom entities** are declared in `manifest.yml`. Every record has the shape
`{ <index attrs>, version, updatedAt, doc }`.

| Entity | Key | Index |
|---|---|---|
| `sp-board` | `retro:{projectId}:{retroId}` | `by-project` (projectId, createdAt) |
| `sp-card` | `card:{retroId}:{cardId}` | `by-retro` |
| `sp-group` | `group:{retroId}:{groupId}` | `by-retro` |
| `sp-ballot` | `ballot:{retroId}:{accountId}` | `by-retro` |
| `sp-mood` | `mood:{retroId}:{accountId}` | `by-retro` |
| `sp-action` | `actions:{projectId}:{actionId}` | `by-project`, `by-retro` |
| `sp-template` | `template:{projectId}:{templateId}` | `by-project` |

Two Forge KVS rules shaped this schema; both were learned on the first real deploy:

- `integer` attributes are **32-bit**, so epoch-millisecond timestamps (`createdAt`, `updatedAt`) are
  declared `float`, which is exact for whole numbers up to 2^53. The test suite's fake KVS enforces the
  manifest's types, so a mismatch fails locally.
- Deployed entities and attributes **can never be deleted**. The `retro-*` entities at the bottom of
  `manifest.yml` are empty legacy definitions from that first deploy. Leave them in place; the app
  uses `sp-*`. Adding attributes is fine; removing or retyping one needs a new entity.

**Concurrency:**
- Writes are conditional KVS transactions (`version == expected`), retried with jittered back-off.
- Multi-record changes such as grouping commit atomically.
- Cards, ballots and moods are one record each, so simultaneous card creation and voting never contend.
- Each voter writes only their own ballot, which makes the vote limit atomic per person.
- The per-project retro list is a KVS index rather than a hand-maintained `retro:index:{projectId}` document, which would become a write hot-spot.

### Realtime

| Channel | Publisher | Carries |
|---|---|---|
| `sprintpulse:retro:{retroId}` | backend only (signed) | public projections: `board.updated`, `card.upserted/deleted`, `group.*`, `votes.updated`, `mood.updated`, `action.*` |
| `sprintpulse:project:{projectId}` | backend | "retro list changed" |
| `sprintpulse:presence:{retroId}` | clients | heartbeat (who's online) |

- Clients merge events without downgrading what they're entitled to see: their own card text and their own votes survive public echoes.
- Phase and reveal changes trigger a fresh snapshot, because visibility changed server-side.
- If realtime is unavailable, the UI falls back to polling every 4 s and shows a "Polling" badge.
- The timer stores only `endsAt`. Every client renders the countdown locally, corrected for server clock offset, so there's no per-second network traffic.

---

## Prerequisites

- **Node.js 22+** (the Forge runtime is `nodejs22.x`)
- **Forge CLI:** `npm install -g @forge/cli@latest`
- An Atlassian Cloud site with **Jira**, where you have permission to install apps. Confluence is optional, for the export.
- An Atlassian API token for `forge login` (https://id.atlassian.com/manage-profile/security/api-tokens)

## Local development (no Jira needed)

```bash
npm install          # also installs static/retro-ui via postinstall
npm run dev:ui       # http://localhost:5173
```

Outside Jira, the UI switches to the **Local Mock Adapter**. It runs the **real resolvers**
from `src/` in your browser: Vite aliases `@forge/kvs`, `@forge/realtime`, `@forge/api`,
`@forge/resolver` and `node:crypto` to shims in `static/retro-ui/src/mock/`. Masking,
vote limits, optimistic locking and realtime payloads behave exactly as deployed.

The yellow dev bar lets you:
- switch identity (`?mock&user=alex` also works);
- open a second participant in a new tab (tabs sync over `BroadcastChannel`);
- turn on simulated teammates;
- **Seed demo history** (four closed retros for analytics);
- **Progress Jira issues** (moves mock issues To Do → In Progress → Done, to test sync);
- reset all data.

Mock mode turns on when the page isn't framed inside Jira, when the URL has `?mock`, or when
`window.__FORGE_MOCK__ = true`. The mock code is a separate lazy chunk and never loads inside Jira.

## Quality gate

```bash
npm run check
```

This runs, in order:

1. `typecheck`: strict TypeScript for the backend and UI.
2. `lint`: ESLint with type-aware rules (`no-floating-promises` and more); `--max-warnings 0`.
3. `test`: Vitest, 35 tests. They cover the domain rules, concurrency against a KVS fake that
   enforces version conditions, privacy of realtime payloads, exports and client-side state merging.
4. `build`: the production Custom UI bundle in `static/retro-ui/dist`.
5. `validate:manifest`: the Forge CLI's own manifest validator, offline.
6. `lint:forge`: the Forge CLI's own client-side linters, offline. This includes the
   permission-scope check against **every Jira and Confluence endpoint the code calls** (see below).

**About `lint:forge`.** The Forge permission linter only recognises literal
`requestJira(route\`…\`)` calls, and our REST calls go through small wrappers.
`scripts/forge-lint-offline.cjs` therefore extracts every `route\`…\`` path and HTTP method from
`src/jira/*.ts` into a temporary probe, so each endpoint is checked against `manifest.yml`.
`npm run lint:forge:selftest` removes two scopes and confirms the linter then fails.

Once you're logged in, also run the official server-side lint:

```bash
forge lint
```

## CI/CD (GitHub Actions)

Repo: https://github.com/ravee-acharya/sprintpulse-retro (private). Workflow:
`.github/workflows/deploy.yml`, the same shape as `ravee-acharya/worklog-report`.

| Trigger | What runs |
|---|---|
| Push to `main` | **verify** → **deploy-development**: deploys and installs/upgrades on `dashtech.atlassian.net` (`--confirm-scopes`, development only) |
| Actions → *Deploy SprintPulse Retro* → Run workflow → `development` | Same as a push |
| Actions → Run workflow → `production` | **verify** → **deploy-production**: waits for the `production` environment's required reviewer, deploys, then upgrades each site in `FORGE_PROD_SITES` (no auto-granted scopes). Tick *approve_major_version* only for an intended major version. |

**What `verify` runs:** `npm run ci`, which is:
1. the UI build;
2. manifest validation;
3. `forge lint`;
4. typecheck;
5. tests;
6. ESLint;
7. the offline scope lint;
8. semgrep (`.semgrep.yml`, the OWASP rules shared with worklog-report).

Run `npm run ci` locally to reproduce it. It needs semgrep, plus `FORGE_EMAIL` and `FORGE_API_TOKEN` for `forge lint`.

**Repo setup:**
- Secrets: `FORGE_EMAIL` and `FORGE_API_TOKEN`, an Atlassian API token for the account that owns the app.
- Environments: `development` (no rules) and `production` (required reviewer).
- The Forge CLI is pinned with `FORGE_CLI_VERSION`. Bump it deliberately, after reading the release notes.
- Once the app is installed from the production environment, add that site to `FORGE_PROD_SITES`.

## Deploy & install

Run all of these from the app root (`sprintpulse-retro/`).

```bash
# 1. Authenticate the CLI (email + API token)
forge login

# 2. Register the app with your Atlassian developer account.
#    This replaces the placeholder app.id in manifest.yml with a real one.
forge register "SprintPulse Retro"

# 3. Build the Custom UI and verify everything
npm run check
forge lint

# 4. Deploy to the development environment
forge deploy -e development

# 5. Install on your Jira site
forge install -e development --site <your-site>.atlassian.net --product jira

# 6. (Optional) Also install on Confluence on the same site, for "Publish to Confluence".
#    Without this, the Export dialog shows "Confluence is not available".
forge install -e development --site <your-site>.atlassian.net --product confluence
```

Open any Jira project. **SprintPulse Retro** appears in the project sidebar.

| Task | Command |
|---|---|
| Ship code changes | `npm run build && forge deploy -e development` |
| After changing scopes or storage entities in `manifest.yml` | `forge deploy -e development`, then `forge install -e development --site <site> --product jira --upgrade` (admins must approve new scopes) |
| Live-reload against a real site | `npm run dev:ui` in one terminal, `forge tunnel` in another (the manifest maps the UI resource to port 5173) |
| Production | `forge deploy -e production`, then `forge install -e production --site <site> --product jira` |
| Logs | `forge logs -e development` |

`npm run deploy` is a shortcut for `npm run check && forge deploy -e development --non-interactive`.

### Permissions requested

| Scope | Why |
|---|---|
| `read:jira-work` | Read issue status/assignee for action sync and analytics |
| `write:jira-work` | Create Jira issues from action items |
| `read:jira-user` | Assignee picker, display names |
| `storage:app` | Forge KVS (retros, cards, votes, actions) |
| `read:board-scope:jira-software`, `read:sprint:jira-software`, `read:project:jira` | Find the project's boards and sprints |
| `write:sprint:jira-software` | Optionally add a new action issue to a sprint |
| `write:confluence-content`, `read:confluence-space.summary` | Optional Confluence export |

No `permissions.external` entries: the app makes **no** calls outside Atlassian.

### Runs on Atlassian notes

These choices keep the app badge-eligible:
- **GIFs:** an animated sticker pack bundled with the app, not Giphy or Tenor.
- **Music:** ambient tracks synthesised in the browser with Web Audio, not YouTube or hosted audio.
- **Avatars:** Jira's own avatar CDN, which Forge allows by default; initials are the fallback.

To add Giphy or YouTube later, you would need `permissions.external` entries, and that forfeits the badge.

---

## Project layout

```
manifest.yml                 modules, scopes, KVS entities
src/
  index.ts                   Forge handler
  resolvers/                 RPC definitions + payload validation
  services/                  retros, cards, votes, actions, analytics
  storage/                   EntityStore (optimistic locking), entity/key definitions
  realtime/publisher.ts      signed Forge Realtime publishing
  jira/                      Jira + Confluence REST clients (asUser)
  lib/                       trusted context, validation, errors
  shared/                    types, rules, catalogues, exporters (shared with UI)
static/retro-ui/
  src/components/            board, facilitator toolbar, drawers, dashboards
  src/hooks/                 useRetroSync, useUsers, usePresence
  src/lib/                   bridge adapter, markdown, audio, state merging
  src/mock/                  Local Mock Adapter (shims, fake Jira, bots, seeding)
scripts/                     offline manifest validator + offline Forge lint
test/                        Vitest suites + in-memory KVS fake
```

## Troubleshooting

- **"Polling" badge instead of "Live":** Forge Realtime subscription failed. The app keeps
  working by polling; check `forge logs` for `realtime` warnings.
- **"Confluence is not available":** Confluence isn't on the site, or the app isn't installed
  on Confluence (step 6 above).
- **Issue creation fails with a field error:** the project's create screen requires extra fields.
  The app retries without due date and labels; add any other required fields to the screen's
  defaults, or make them optional.
- **Download button does nothing inside Jira:** the iframe sandbox can block downloads. Use
  **Copy**, or select the text in the preview box.

## Status

- **Deployed:** development environment, installed on `dashtech.atlassian.net` (Jira), app id
  `55f2b1e9-72d8-4386-a29c-b021e0456589`, developer space *TheTechFreaks*.
- **Live smoke test passed (2026-11-25, project POC):** app loads in the project page, sprint lookup,
  retro creation, Forge Realtime "Live", mood check-in, cards, Actions drawer, Jira issue creation
  (POC-452) with status sync. The first load after a deploy can take ~15 s (cold start).

- Local verification: everything in the quality gate, plus manual multi-user testing with the mock adapter.
- Not yet exercised live: Confluence publishing (needs the optional Confluence install), and
  multi-user realtime between two real accounts.
