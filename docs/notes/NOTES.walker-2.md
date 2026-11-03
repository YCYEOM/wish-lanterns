# walker-2 — 캐릭터, iteration 1

Only src/walker.js changed. The API is unchanged; the root group is still tagged 'player'.

## The move
- A hooded low-poly traveller in a cream cloak (Sky-like). The cloak is a 16×7 cone whose vertices are reshaped every frame: it flares and trails behind with speed, ripples while walking, sways with the stride and leans into turns. It has a gold hem band, a rounded shoulder mantle and a gold clasp.
- Head: a skin face with eyes and blush, set inside a hood that is open in front. The hood has a dark lining and a pointed tip that droops backward.
- Coral scarf: a ring at the neck and two 5-segment tails. They hang down at rest, lift and trail behind when walking, and flutter.
- Right hand holds a short staff held out to the side. A ribbed paper lantern (lathe, unlit, warm) hangs from its tip on a damped pendulum. The PointLight and glow sprite are kept, so the lit side of the cloak glows warm and the sand pools light.
- Walk cycle: leg and arm swing, a double-frequency bob, forward lean and hip twist. Idle: breathing, and the head glancing along the lake and up at the sky lanterns. Standing at the water's edge, the character slowly lifts its lantern toward the lake.
- Eased velocity (accelerates quicker than it stops) and eased turning. Tap-to-walk slows over the last 1.2 m.
- Camera: 6.9 m back and 3.8 m up, looking 10 m ahead. The character stands in the lower-middle of the frame (feet at about y = 450/600, clear of the button). There is a slight sideways lean on turns.

## Blockers
- "Camera inside the head": not reproduced in this build. eye:here, eye:down and default all show the character from behind, because main.js reports followPos as the player eyes. One weak spot is in main.js, not here: if followPos is still zero, player() falls back to walker.pos, which puts the eye inside the head.
- "View does not move": during the drive the camera follows the character (z 16 → 9.7, x → -3). state.moving is true while keys are held.
