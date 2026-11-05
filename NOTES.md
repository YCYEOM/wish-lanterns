# 소원 등불 (Wish Lanterns)

## Pitch (user's words)
"거창한 것 말고 다양한 사람들이 그냥 참여할 수 있는 게임. 단순 참여여도 좋고, 힐링이 필요할 때 들어오거나 단순한 오락거리로."
Picked theme: 소원 등불 띄우기. Original design doc: `docs/lantern-design.md`.

## What the player does
A small hooded traveller carrying a paper lantern walks a moonlit lakeshore (WASD/arrows, W = toward the lake, or tap/click
the ground; tap the water to walk to its edge; the pier is walkable). At the water's edge the button reads
"여기서 등불 띄우기": pick a colour (5), write ≤30 chars (or a preset, or nothing), choose 물 위로 / 하늘로 — the lantern
sets off from the character (from the pier: just past its end). Tap any floating lantern to read its message, send ♡,
or hide it on your own screen. Others on the same "lake" see your lanterns live and get your ♡. No score, no fail state.

## Code map
- `src/main.js` — entry: scene (sky/water shaders, hills, pines, reeds, fireflies), lanterns, UI wiring, tap handling
  (lantern under the cursor = card, else walk), launch flow, multiplayer hooks, Studio contract (`installStudio`).
- `src/shore.js` — round lake (centre 0,-70, r 80) + walkable beach ring: `groundY/walkable/waterDist/nearestShore/
  pierLaunchPoint`, sand/foam/grass shader, dressing (pier, stone lanterns, candle cairns, rocks, driftwood, reeds, trees).
- `src/walker.js` — character model, walk/idle animation, held lantern + PointLight, movement, follow camera (always faces
  the lake, no mouse parallax). API in `docs/MODULE-CONTRACT.md`.
- `src/net.js` — serverless P2P (Trystero/WebRTC, Nostr signalling). `src/audio.js` — WebAudio synth ambience/sfx.
  `src/data.js` — colours, presets, warm messages, word filter. `src/cover-shot.js` — Genex cover/clip demos.
- `vendor/three.module.js` (r170, aliased as `three`). Build: Vite (`npm run build` → `dist/`).

## Key decisions
- Everything procedural (no asset files); determinism via mulberry32 seeded by `reset(seed)`.
- Virtual lanterns (28 warm messages + 16 wordless) keep the lake full even when alone.
- Multiplayer: the user wanted GitHub, not Genex → Trystero P2P works from GitHub Pages (needs https). Rooms `lake-1..30`,
  cap 10 (`?lakecap=N` test override); auto-fill (listen 6 s, move on if full); `?lake=N` invite link (🔗 button).
  Each browser has an owner key; actions `lanterns` {o, l:[{k,t,c,m}]} and `heart` {id}. No TURN, no server storage.
- Persistence: localStorage `wishLanterns.v1` (counts, hearted/hidden ids, last 12 own lanterns); hide is local only.
- Studio: pointer lock disabled (it made taps pick random lanterns); harness-injected keys merged into movement;
  `player()` reports the follow camera as the "eyes" (third person); `begin()` hides the title at once.

## Deploy
Repo https://github.com/YCYEOM/wish-lanterns (public). Push to `main` → `.github/workflows/pages.yml` →
https://ycyeom.github.io/wish-lanterns/

## Verified
- Playtests (shore, walker) passed; launch, read card, ♡, hide exercised in play. Tap accuracy 28/28, empty taps 5/5.
- Pier: walked to its end (stops ~1 m short of the end lamp, stays inside the posts) and launched from it.
- Multiplayer: two local headless clients connected, lanterns + ♡ crossed; lake overflow + invite verified.
  Real cross-network play not tested by me.

## Known issues / next (priority order)
1. ~~Launch moment~~ done: `walker.ceremony(mode)` kneels (water) or lifts overhead (sky); the lantern is held in
   `walker.hands()` (small), lowered onto the water / let go at `release`, then grows to full size. `applyCine` in
   main.js: close 3/4 shot from the left, then a follow shot after your lantern, ~7 s; movement input is blocked during
   the pose, and moving afterwards cuts the shot short. Test hooks `__studio.freeze()/advance(ms)` step it frame-exactly
   (`.studio/cer.mjs [pier]`).
2. ~~Sideways sticking~~ done: `tryMove` slides along any edge by turning the step up to ~77° (keeping ≥45% pace);
   a square-on turn only when it climbs back toward dry land (the pier-root corner). Beside the pier's root the 0.5 m
   water margin eases to ~0 (`walkable`), so there is no pocket there. Pushing straight at the water or the back of the
   beach still just stops. Test: `.studio/slide.mjs` (before: holding D at the water moved 0 m).
   Also: kneel now uses a knee joint (legs are thigh + knee group); on the pier the launch shot comes from the side
   away from the end lamp (`PIER_LAMP`).
3. ~~Walks through stone lanterns~~ stale: `blocked()` in shore.js already stops the character at stone lanterns
   (0.55 m) and candle cairns (0.4 m); only the tiny tea-light groups are stepped over on purpose.
4. ~~Camera / huge sky lantern~~ done: drag on the canvas (mouse or one finger, >8 px; a shorter press is still a tap)
   or hold Q/E to swing the view round the character (yaw +-2.4 rad); drag up/down lowers it to look up at the
   sky or lifts it higher. R or double-click puts it back behind the character. WASD now moves relative to where the
   camera looks (`walker.viewDir()`). Remote freshly-launched lanterns appear out over the water, >12 m from you,
   and grow in small (they used to rise on the sand, sometimes in your face); any lantern fades out within ~1.6-4 m
   of the camera. Tests: `.studio/view.mjs`, `.studio/arrive.mjs` (`__studio.fakeArrival(mode)`).
   Follow-ups: turned toward the beach, the boom pulls in (min 4.2 m, and lower with it) short of any shallows
   tree (`shore.CAM_OBSTACLES`); remote arrivals now pick a spot 12-40 m away inside the middle of the current
   frame (fallback: any spot >12 m). Test: `.studio/treecam.mjs`.
5. ~~Lake bands / pale lanterns / smeared grass~~ done: water normals now come from three slanted swells plus two
   noise octaves, all faded with distance (the axis-aligned cos waves lined up into bands). Each colour has a deeper
   `lamp` hex in data.js for the lit paper (pastels clipped to white); the UI swatch `css` is matched to how the lit lantern reads. The grass bank's
   stretched streak noise is now isotropic and blends into the broad patches past ~12-40 m.
   Test: `.studio/look5.mjs <tag>` (`__studio.swatch()` lines up all colours).
6. Phone check (emulated, not a real device yet): `.studio/mobile.mjs` runs iPhone 13 / SE / Pixel 7 portrait and
   iPhone 13 / SE landscape with real touch: tap-walk, one-finger drag turn, launch button, compose, send all pass.
   Fixed: compose overflowed in landscape (now max-height + scroll, compact at <=520 px / <=380 px tall, presets one
   scrolling row), launch button wrapped to 3 lines (nowrap), tip ran off screen (wraps; touch devices get a
   tap/drag tip instead of WASD/Q-E), stats pill ran under the buttons (ellipsis), safe-area insets (viewport-fit=cover).
   Still untested: the on-screen keyboard over the compose panel and real-device frame rate.
7. ~~Ideas~~ done:
   - Time-of-night drift: `uniforms.nightK` (0 evening .. 1 deep night) swells over a 20-min cosine of play time;
     skyColor (sky dome + water reflection) sinks the dusk glow, darkens the zenith, brightens stars / Milky Way.
     `__studio.night(k|null)` pins it for shots.
   - Shooting-star wish: stars are placed in screen space (upper sky of the current view) so they are always seen,
     with a glowing head; more often deeper in the night. For 5 s a `#wishBtn` pill offers "별똥별에 소원 빌기";
     tapping it chimes, drops gold sparks from where the star went out, toasts, and counts `save.wishes`
     (shown in the stats pill). Local only (not networked). Test: `.studio/night.mjs` (`__studio.star()`, `wish()`).

## Seoul weather + season (atmosphere)
- `src/season.js`: `seoulSeason()` from the KST month (3-5 spring, 6-8 summer, 9-11 autumn, 12-2 winter); `SEASONS`
  gives shader weights, firefly share, ground snow and what drifts (petals / leaves).
- `src/weather.js`: `fetchSeoulWeather()` reads Open-Meteo (keyless, CORS) once per visit with a 4 s timeout;
  WMO code -> clear / cloudy / rain / snow / fog. `createAtmosphere()` eases shared uniforms (`cloudK`, `rainK`,
  `fogK`, `snowCover`, `season` vec4, `ffAmt`) and four camera-wrapped Points clouds (rain streaks, snowflakes,
  cherry petals, autumn leaves; ~45% fewer on touch devices, point size clamped so nothing fills the lens).
- Shaders: skyColor (main.js) draws cloud banks that hide stars (also in the water reflection), darkens for rain,
  hazes the horizon for fog; the water gets raindrop rings; shore.js `seasonLeaf()` tints greenery (pink blossom
  crowns, lush summer, red/orange/gold autumn, frosted winter) and `snowCover` blankets beach, bank and up-facing
  dressing. Scene fog thickens and lightens with `fogK`.
- On entering, one toast says e.g. "✨ 가을밤, 오늘 서울은 맑아요 · 13°"; if the service fails: "🍂 가을밤의 호수예요"
  (clear night of the season). Weather arriving after you entered drifts in over a few seconds.
- Hooks: `__studio.weather(kind|null, instant)`, `__studio.season(name|null, instant)`, `__studio.atmos()`;
  `state().atmos`. Tests: `.studio/wx.mjs`, `wxsky.mjs`, `wxfail.mjs` (blocked API + fps), `wxphone.mjs`,
  `pick-wx.mjs` (taps 28/28 in rain and snow).
- Studio cameras `wx-cloudy|rain|snow|fog` and `season-spring|summer|autumn|winter` force each state for judges;
  `lake/low/sky` put the real Seoul state back.
- Fixed with it: the beach mesh and its dressing used `groundY`, which returns the deck height on the pier, so a flat
  pale slab stood on the water along the pier footprint; they now use `terrainY` (feet still stand on the deck).
- Ship review (art director: ship). Left as known: the far shore under the pines reads pale in fog/rain; a few far
  round canopies stay grey in autumn; cloudy is an even overcast rather than distinct cloud shapes.

## Shared lake: memory, reach, people (after the audit list)
1. Empty lake -> `src/board.js` (lazy-loaded): each launch is also posted as a signed Nostr event (kind 30078,
   d=`wl:<owner>:<id>`, t=`wishlanterns-v1-lake-N`, NIP-40 expiration +24 h) to 5 public relays (damus, nos.lol,
   nostr.mom, primal, offchain.pub). Joining a lake fetches the last day's lanterns (up to 80) and keeps a live
   subscription. Own events are skipped by pubkey (per-browser key `wishLanterns.nsk`). Test: `.studio/persist.mjs`
   (A launches and leaves, B arrives later and sees it), `.studio/boardtest.mjs` (node, two clients + heart).
2. Blocked WebRTC -> the board also carries new lanterns and hearts live (hearts: ephemeral kind 21078 with an id `h`,
   deduped against the direct P2P copy via `heartSeen`). Presence count and characters still need WebRTC.
3. Other players' characters -> net.js `pos` action (on a step >0.25 m, at most 5/s, or every 3 s; `cer` when they
   launch). main.js keeps `others` (max 9) of `createWalker(..., { remote: true, scarf })` (no extra scene lights,
   `dispose()` on leave/lake change), walking to the received spot and kneeling/lifting on `cer`. A lantern from a
   visible peer sets off from in front of their character (board copies wait 2.5 s so the direct one wins).
   Test: `.studio/avatars.mjs`.
4. The connection line at the bottom shows only with `?debug`.
5. `cleanMessage` matches banned words on two skeletons (digits/symbols folded for latin, skipped for Korean, plus
   repeated letters collapsed); removed words that broke warm phrases ('시바' -> 시바견, '죽어' -> 죽어도 좋아).
6. Download: main chunk ~172 KB gzipped (three.js); trystero (24 KB) and board (1.5 KB) load lazily.
7. Review leftovers: shoreFog used sRGB-valued fog colours in a linear shader -> pale band under the far pines and
   grey far canopies; now the scene fog colours in linear. Driftwood/twigs sit lower on the sand.
   Still open: cloudy is an even overcast rather than distinct cloud shapes.

## Ideas built (from the suggestion list)
- Real moon: `moonPhaseNow()` from the date (mean synodic month), drawn in skyColor at `moonDir` (low, right of
  centre) with a terminator (waxing lit right, waning left), faint dark side, halo by lit fraction, hidden by
  clouds, mirrored on the lake. The weather line adds its name on clear/cloudy nights ("· 🌘 그믐달").
  `__studio.moon(phase|null)`. Test: `.studio/moon.mjs`.
- Shared shooting stars: the schedule comes from the wall clock (24 s slots, ~63% carry a star at a slot-set moment,
  side/slope from the slot), so everyone on a lake sees the same star together. A wish is sent (P2P `wish` action +
  board kind 21079); others get a softer spark fall and "✨ 누군가 같은 별똥별에 소원을 빌었어요", and the wisher's
  own line counts who else wished. `__studio.star()` still forces one locally. Test: `.studio/stars2.mjs`.
- Hearts while away: hearts are now stored a week (board kind 1078, tag `w=<lantern owner>`); on joining, hearts
  for our lanterns since `save.lastVisit` are counted once and told after the weather line:
  "🌙 자리를 비운 사이, 내 등불에 ♡ N개가 도착했어요" (toast queue: `toastBusyUntil`). Test: `.studio/away.mjs`.
- Today's topic: `topicToday()` (data.js, 30 topics by Seoul date) shown in the compose panel; tapping it starts
  the line with it.
- Lantern diary (📖): `save.log` (up to 200; old saves backfilled from `save.mine`) with date, lake, direction and
  hearts per lantern (`save.heartsBy`), plus totals. Test: `.studio/diary.mjs`.
- Music (🎵): audio.js `setMusic()` — slow Am-F-C-G pad and a music-box melody on the A-minor pentatonic, quiet,
  on by default, remembered in `save.music`.
- Phones: on screens <= 520 px wide the stats pill moves under the four round buttons; on very short screens the
  compose panel drops its sub-labels so 띄우기 stays on screen.

## Music settings panel
- 🎵 now opens a small panel under the round buttons (the lake stays in view): an on/off switch, four moods
  (calm Am-F-C-G, warm C-G-Am-F, dreamy maj7 chords, starry D major — each with its own pentatonic-ish scale),
  and sliders: volume, tempo (6.8 s .. 2.8 s a bar), music-box notes per bar (0..~7), key (-5..+7 semitones),
  echo (feedback delay through a lowpass), and the water/cricket level (its own `nature` bus), plus "기본값으로".
- Levels change at once; tempo/notes/key/mood from the next bar. Settings persist in `save.musicCfg`
  (defaults `MUSIC_DEFAULTS` in audio.js). Turning music on while muted also unmutes.
- Test: `.studio/musicp.mjs` (desktop, phone portrait, phone landscape: open, mood, drag sliders, off, reload keeps them).

## Own server (free Cloudflare plan) — live at https://wish-lanterns.ycyeom.workers.dev
- `server/`: one Cloudflare Worker serves `dist/` (static assets, free and unmetered) and `/ws`.
  Each lake is a Durable Object (SQLite, WebSocket hibernation, free plan): relays walker positions,
  lanterns, hearts and star wishes; keeps lanterns 24 h and hearts 7 days (away hearts on the next visit);
  a newcomer gets only the newest 30 lanterns + the day's 20 most-hearted (lanterns.hearts, bumped once per
  unique heart), read through indexes on at / hearts so a join reads ~50 rows (free plan counts rows read);
  cleans text with `cleanMessage` from src/data.js; rate limits (lantern 1 / 4 s, hearts 30 / min, wish 1 / 3 s);
  lake cap 10 for auto-join (a full lake answers `{t:'full'}` and the client tries the next).
  `POST /admin/delete?lake=N&o=&k=` with `Authorization: Bearer $ADMIN_TOKEN` (wrangler secret) removes a lantern.
- Positions to the server: at most every 0.4 s while walking, every 15 s standing (the server keeps the last spot).
- Client: `src/servernet.js` (`ServerNet`, same face as `Net`), chosen when `src/config.js` has a server URL
  (or `?server=`). If it cannot connect within 5 s, `onFallback` switches to P2P + relays (net.js + board.js), so
  the free quota running out never breaks the game. Protocol: lantern text is `tx` (`t` is the message type).
- Deploy: `cd server && npx wrangler login && npm run deploy`, then put the workers.dev URL in
  `DEFAULT_SERVER` (config.js) and push, so the GitHub Pages copy uses the server too.
- Tests: `.studio/server.mjs` (needs `cd server && npm run dev`): 2 walkers, kneel, lantern, leave, heart while
  away, latecomer finds the lantern, away-heart toast, 11th socket sent on. `.studio/fallback.mjs`: dead server → P2P.

## Loved lanterns glow
- `loveOf(hearts)` 0..1 (log scale: 1 ♡ .27, 3 .54, 5 .7, 12+ 1), counting your own heart (`L.liked`); `L.love`
  eases toward it so a new heart visibly brightens the lantern. Glow bigger/stronger, paper lighter, reflection
  brighter; from 2 ♡ a breathing golden halo (own broad HALO texture, raised so the water does not cut it);
  from ~7 ♡ four golden motes drift up. Card adds "✨ 많은 마음이 닿은 등불" at 5+. Virtual lanterns now start
  with mostly few hearts so the loved ones stand out. Proof: `.studio/love.mjs` (0 / 2 / 5 / 12 in a row).

## Auto deploy
- `.github/workflows/pages.yml` → GitHub Pages; `.github/workflows/cloudflare.yml` → `wrangler deploy` of server/
  (game + lake server) on every push to main, once the repo secret CLOUDFLARE_API_TOKEN exists (skipped otherwise).
