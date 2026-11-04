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
4. Camera can't be turned by hand; a sky lantern first appears huge right in front of the camera.
5. Lake surface shows stripe-like bands; lilac/sky lanterns read pale; back grass looks smeared.
6. Not tested on a real phone.
7. Ideas: time-of-night drift, shooting-star wish.
