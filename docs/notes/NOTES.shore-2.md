# shore-2 — 해변 풍경, iteration 1

The move: the flat grey sand sheet became a dressed moonlit lakeshore. Only `src/shore.js` was changed, and its API is unchanged (the math helpers are byte-identical).

## Ground shader
- Warm-dark sand on two noise scales, with bump-mapped wind ripples (crests lit by the moon, troughs darker), pebble speckles and rare shell flecks.
- A damp band about 3.4–5 m wide and an animated wash. Wet sand reflects the sky: a cool fresnel sheen plus a moon glint.
- Foam: a frothy lip on the running wave, a broken line at the waterline and round bubble dots. Blocky square bubbles came out in one pass and were removed.
- The grass bank creeps down in tongues, with a darker soil seam where it meets the sand.
- Shared `LIGHT_GLSL`: moon, sky fill, the player's lantern pool (now lambert-weighted) and fog that matches scene.fog.

## Instanced dressing
All dressing uses one lit ShaderMaterial with a per-instance `aCol`, discards below y = 0 and is seeded with mulberry32 (no Math.random).
- `grass`: about 1500 blade tufts, dense on the bank (d > 9–15) with a few strays on the sand.
- `rock`: 120 small stones on the walkable sand (half of them at the wet band), plus boulder clusters at the beach ends and in the shallows. Rocks near the start are scaled down.
- `driftwood`: 16 forked logs lying along the shoreline tangent.
- `reeds`: 110 reed clumps with cattail heads in the shallows. A gap of ±0.12 rad in front of the start is left clear for launches.
- `tree` and `bush`: low-poly broadleaf trees and bushes at both ends of the walkable arc. They are only placed where `!walkable && z < -42`, so they never sit between the follow camera and the character.

## Build
- `npm run build` fails in this worktree because vite cannot write node_modules/.vite-temp (sandbox). `npx vite build --configLoader runner` builds cleanly.

## Next
- Ladder step 2: the wooden pier at x≈0..8, z≈10.
