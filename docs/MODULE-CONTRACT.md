# Module contract

The module contract of this build, written by the studio from the plan. Frozen: these interfaces and conventions. Not frozen: content, layout, scale. Each part grows its own content within the conventions' ranges, toward docs/VISION.md when the build has one. Change it by re-planning, never by editing another part's module.

## Conventions

- three.js, y up, world units ~ metres; the lake centre is (0,-70), radius ~80; the waterline is y=0; the near beach faces +z
- yaw 0 = facing -z; yaw = atan2(-dx,-dz) for a move direction (dx,dz)
- no Math.random in game code: seeded hashes only
- the water plane and sky draw first with depthWrite off; ground below the waterline is discarded

## Modules

### src/shore.js — owned by `shore` (해변 풍경)

- api: `export const LAKE {cx,cz,r}`
- api: `export function shoreRadius(angle)`
- api: `export function waterDist(x,z)`
- api: `export function groundY(x,z)`
- api: `export function walkable(x,z)`
- api: `export function nearestShore(x,z,d)`
- api: `export function lakeE(x,z)`
- api: `export function buildShore(scene, uniforms) -> {mesh, update(dt, playerPos)}`

### src/walker.js — owned by `walker` (캐릭터)

- api: `export function createWalker(scene, shore, glowTexture) -> walker {pos, yaw, reset(x,z), walkTo(x,z,cb), stop(), update(dt,keys,T), updateCamera(camera,dt,look), lakeDir(), state() -> {x,z,yaw,moving,nearWater,waterDist}, NEAR_WATER}`
- state: `state.walker`

## Rules

- Edit only the modules your part owns; reach another module only through the API listed here.
- A camera, demo or probe listed here stays registered: removing one another part relies on is a regression.
