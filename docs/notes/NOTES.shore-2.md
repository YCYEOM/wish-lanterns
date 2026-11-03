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

# shore-2 — iteration 2

## The move: the wooden pier
The pier is built inside `buildShore`; the `PIER` constants sit at the top of shore.js.
- Placement: it runs from the sand (d = +3.2) straight toward the lake centre, out to d = -10.5 at the waterline point x≈5, z≈9.
- Planks: about 40 boards, each a slightly different colour, height and angle, with one or two boards missing. They sit on two stringers with cross braces underneath.
- Pilings: paired pilings sink into the water; below y = 0 they are discarded, so they appear to enter the water.
- Lantern post: at the end there is a post with a warm lamp and an additive halo sprite (DataTexture, no canvas). It also feeds a new `pierLamp` light uniform in `LIGHT_GLSL`, so the deck and the shallows nearby get a flickering warm pool.
- Wood grain: `dressingMaterial(..., grain=true)` adds grain to the wood.
- Instances are tagged `pier` and `pier-lamp`.
- Walking: `walkable()` now also rejects the pier footprint plus a 0.25 m margin, so the character walks around the pier rather than through it. The API is unchanged.
- Dressing: grass, rocks, driftwood and reeds skip the pier footprint.
- Harness path: it ends at x≈-3.4, z≈9.7, waterDist 0.67, well clear of the pier at x≈5, so walker-on-beach still passes.

## Ledger fixes
- Foam (defect-blown): the solid white edge stripe and the full-strength lip are gone. Foam is now thin lace strands from two crossing noise fields. It sits only on the running wave's lip and in patches that come and go along the shore, at about half the old brightness. The moon glint on wet sand was also toned down. In the eye:here capture after the harness inputs, the waterline shows lacy foam, not a band.
- Black faceted octagons (defect-primitive): not reproduced. In both eye:here and default after the scripted inputs, nothing dark sits near the camera. They were most likely shore rocks or driftwood caught close to a low camera. No change was made for this.
- Bushes (ledger 4): the grey lumps became spiky leaf shrubs (34 swaying blades, double-sided).

## For the lead (not mine to change)
- The evenly spaced black poles (ledger 3) are main.js's `reeds` InstancedMesh: flat black bars at 900 instances. My green reed clumps with cattails are separate. Giving main.js's reeds colour, or cutting them back, would remove the "fence of poles".
