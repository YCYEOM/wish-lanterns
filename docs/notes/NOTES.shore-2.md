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

# shore-2 — iteration 3

## The move: the shore glows
- `SHORE_LIGHTS`: 6 stone lanterns (tōrō) and 5 candle cairns along the near beach, at d 2–9, x from -50 to +46.
  - In the default view: a stone lantern at x=-6 (left of the start) and a cairn at x=5.5 (right).
  - Each has a warm core mesh and an additive halo (now linearly filtered) that flickers in `update()`.
  - Each feeds a `lamps[12]` vec4 uniform in `LIGHT_GLSL`, giving a warm pool on the sand, the rocks and the dressing. The light fades out within about 1 m of its own core, so the stone body isn't blown out.
  - The character walks around them via `blocked()` in `walkable()`. Rocks, driftwood and grass stay about 1.3 m away from each.
  - Tags: `stone-lantern`, `candle-cairn`, `shore-glow`.
- Glints in the grass: 420 twinkling additive points (`grass-glints`), mixed cool and warm. Most sit on the bank; 90 cluster around the lights.

## Ledger fixes
- Lanterns overlapping the pier (demo:genex-cover): the pier moved from x≈5 to a root at x≈15 (`PIER.a = π/2 - 0.19`). From the cover camera at (0, 2.3, 23), the posed lanterns at (2.6, 9.5) and (7.5, 4) sit at 11° and 21.5°. The pier now spans 25° and beyond. The demo itself can't be run from my tools: capture and computer report demo:genex-cover as unregistered. I checked with the "low" camera, which frames almost the same view: the pier is at the right edge with no posed lantern on it.
- Nothing framing the beach sides: added 7 leafy trees standing in the shallows at the ends of the beach (x -11.5, -16.5, -27, 22, 30, -44, 52; `WATER_TREES`).
  - Each has a leaning trunk and a crown of about 540 small leaf cards in 6 clusters, so the silhouette is broken rather than a blob.
  - They stand lake-side of anywhere the character can go, so the follow camera (always land-side) never looks through them.
  - The tree at x=-11.5 frames the left of default, eye:here and low; the pier frames the right.
- Wet band:
  - The damp sand is much darker, with a crisp edge.
  - New ragged dark wrack line (weed and twigs) at the high-water mark.
  - The dry sand is about 20% darker, so the night and the warm pools read.
- Reeds: 70 reed beds, each a centre with 4–9 clumps; 44 of the beds are on the near arc. This replaces the 110 scattered single clumps.

# shore-2 — iteration 4

## The move: clustered small stuff along the whole arc
- 640 cluster centres, 520 of them on the near arc.
- Bands: 46% at the waterline (d 0.15–3.2), 40% at the foot of the bank (d 6–13), 14% in the open middle.
- Each cluster is one kind:
  - pebble groups: 6–15 icosa-0 pebbles in grey, brown, basalt and quartz;
  - shells: ribbed fan geometry, only at d < 4.5;
  - forked twigs;
  - sedge/grass clumps: straw-coloured near the water, green on the bank;
  - small driftwood bits.
- Instance tags: `pebbles`, `shells`, `twigs`, `grass`, `driftwood`. Clusters skip the pier and the lights.

## Ledger fixes
- Shore glow sparse: `SHORE_LIGHTS` grew from 11 to 19 and `lamps[]` from 12 to 20.
  - Added a stone lantern at x=7.5 and a cairn at x=2.6 (d 8.9, in the cover's lower right).
  - Added tea-light groups (k=2): 3–5 wax candles, each with a flame and a small halo. They're at (-2.6, d 8.6), (3.2, d 1.7), (-9.5, d 6.4), (-12.5, d 1.8) and (16.5, d 7.5), plus a stone lantern at x=-18.5, d 9.5.
  - Tea-lights don't block walking.
  - Lamp strengths were lowered (1.05, 0.65, 0.55) so the frame stays night (mean luma about 77).
- Grass not visible in the cover or default views: grass clumps now sit at d 6–13, inside the cover camera's ground footprint (which only reaches d≈8.4). The shader bank edge also moved closer (gEdge 7.2–13.7), with grass tongues from d≈3. Glints still cluster around the lights.
- Hard waterline and chalky foam:
  - The wash zone is now a thin dark water film that mirrors the sky and fades into the lake.
  - The edge foam is a soft glow instead of lace scribbles.
  - Lace strands are thicker and softer; foam is a little dimmer.
- Checked in the "low" camera (≈ the cover framing) and in the harness path. The walker ends at waterDist 0.67.
- Not done: ledger 5 (pier out of the default view). It conflicts with the lanterns the cover demo poses at x 2.6–7.5, so the pier stays at x≈15 where it frames the right edge.
