# 소원 등불 (Wish Lanterns)

## Pitch (user's words)
"거창한 것 말고 다양한 사람들이 그냥 참여할 수 있는 게임. 단순 참여여도 좋고, 힐링이 필요할 때 들어오거나 단순한 오락거리로."
Picked theme: 소원 등불 띄우기. Full design: `docs/lantern-design.md`.

## What the player does
Night lake. Click to start → "🏮 등불 띄우기" → pick a colour (5), write ≤30 chars (or tap a preset, or leave empty),
choose 물 위로 (floating box lantern) or 하늘로 (sky lantern) → it drifts away. Tap any floating lantern to read its
message, send ♡ (sparkle burst + chime), or hide it on your own screen. No score, no fail state.

## Tech / decisions
- Plain ES modules, no build step: `index.html` + `src/*.js`, three.js vendored at `vendor/three.module.js` (r170)
  so the game runs from any static host with no network.
- Everything procedural: sky shader (gradient, milky way, twinkling stars), reflective water shader that mirrors the
  same sky function, hill rings, instanced pines/reeds, firefly points, canvas glow sprites. Audio is WebAudio-synth
  (brown-noise water, pad, crickets, plop/chime) — no asset files.
- Lantern reflections: additive sprites placed below y=0; water/sky draw with depthWrite off so they show through water
  but are occluded by the ground.
- "Others' lanterns" in v1 are 28 hand-written warm messages + 16 wordless lanterns (virtual), so the lake is never
  empty. Real shared/multiplayer lanterns are deferred to v2.
- Word filter: small KO/EN banned list replaced with ♡ (`src/data.js`).
- Persistence: localStorage `wishLanterns.v1` (launched count, hearts sent, hearted ids, hidden ids, last 12 own lanterns,
  which reappear on the lake on return).
- Determinism: all gameplay randomness from mulberry32 seeded by `reset(seed)`; audio uses its own LCG.
- `window.__studio`: seed, start, pause, step(frames), state, debugCamera({pos,target}), hud(show), plus test helpers
  launch(text,color,mode) and openNearest().

## Multiplayer (v2, P2P — works on GitHub Pages)
- User wanted it on their GitHub, not Genex, so the Genex SDK path was dropped. Netcode is serverless WebRTC via
  Trystero (Nostr relays for signalling), `src/net.js`: appId `ycyeom-wish-lanterns-v1`, room `lake`, joined on the title tap.
- Each browser has a stable owner key (localStorage `wishLanterns.owner`). Action `lanterns` {o, l:[{k,t,c,m}] last 6}:
  sent to each peer on join (shown scattered on the lake) and broadcast on launch (shown launching from the shore).
  Action `heart` {id}: owner gets a toast + `received` count. Incoming text re-filtered and capped at 30 chars.
- Lakes (channels): rooms `lake-1..30`, cap 10 (`?lakecap=N` test override). Auto: try lake 1, listen 6 s, move on if
  already at cap. `?lake=N` (🔗 invite button copies it) joins that lake directly. Switching lakes drops the old lake's
  remote lanterns; join toasts only for peers who stay past the settle window. HUD shows `🌙 호수 N · 지금 M명`.
- Lake ellipse extends behind the camera (cz -65, rz 108) and looking down is damped, so the bottom of the screen is
  always water (a flat black bank showed there before).
- Tapping: Studio's default pointer lock is disabled (`input: { pointerLock: false }`) — it made taps pick random lanterns;
  hit test uses each lantern's on-screen size; hovered lantern brightens. Verified 30/30 exact taps, 5/5 empty taps.
- Needs a secure context (https) — GitHub Pages is. No TURN: peers behind strict NATs stay solo. Nothing persists server-side.
- Verified locally: overflow (cap 1: A lake 1, B auto-moved to lake 2, C via invite joined A in lake 1);
  two headless Chrome contexts connected (peers 1), A's launch appeared on B, B's heart reached A
  (`.studio/mp.mjs`). Real cross-network play not yet tested.
- Builds with Vite (`npm run build` -> dist/, `three` aliased to vendor/three.module.js); `.github/workflows/pages.yml` deploys.
- Studio contract `src/studio.js` + demos `genex-cover`/`genex-clip` (`src/cover-shot.js`) kept for the Genex preview.
- Repo: https://github.com/YCYEOM/wish-lanterns (public). Live: https://ycyeom.github.io/wish-lanterns/ (Pages via Actions).

## Walker on the lakeshore (v3)
- The player walks a small hooded, lantern-carrying traveller along a moonlit beach and launches lanterns from the water's edge.
- `src/shore.js`: round lake (centre 0,-70, r 80) with a walkable beach ring — groundY/walkable/waterDist/nearestShore API,
  textured sand/foam/grass shader, dressing (pier, stone lanterns, candle cairns, rocks, driftwood, reeds, trees).
- `src/walker.js`: character model + walk/idle animation + held lantern light; WASD/arrows (W = toward the lake),
  tap/click ground to walk (tap water = walk to its edge); follow camera always faces the lake (no mouse parallax).
- `src/main.js`: tap a lantern = read card, else walk; launch button walks to the shore then opens the panel; lanterns
  set off from the character. Harness-injected keys are merged; player() reports the follow camera as the "eyes".
- Verified: playtests for shore and walker passed on 9062c37; tap accuracy 28/28.
- Known: no kneel/release animation or camera follow on launch; sideways walking can stick at the water's edge or the
  back boundary; the character passes through stone lanterns; can't walk onto the pier.

## Current state
v1 playable end-to-end: title, compose, launch (water/sky), read card, ♡, hide, stats, mute, ambience.
Verified via headless Chrome screenshots (`.studio/shot.mjs`, files served via request interception).

## Known issues / next
- Lilac/sky colours read a bit pale on sky lanterns.
- Mobile layout untested on a real device.
- v2: real-time shared lanterns from other players (Genex multiplayer), time-of-night drift, shooting-star wish.
