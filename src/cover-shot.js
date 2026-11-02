// Genex cover + clip staging. Game code, does nothing unless a demo runs it.
// Uses only the game's own world: its lanterns posed on its lake, its own sky and light.

export function makeCoverDemos(api) {
  function stage() {
    api.reset(1);
    api.enterLakeQuiet();          // title gone, HUD hidden, no audio/network
    api.hud(false);
    // cast: a warm cluster of floating lanterns near the shore and two sky lanterns rising
    api.pose([
      { color: 'amber', mode: 'water', x: -3.2, z: 12.5 },
      { color: 'amber', mode: 'water', x: 2.6, z: 9.5 },
      { color: 'rose', mode: 'water', x: 7.5, z: 4 },
      { color: 'amber', mode: 'water', x: -9, z: 3 },
      { color: 'mint', mode: 'water', x: 0.5, z: -2 },
      { color: 'amber', mode: 'sky', x: -6, y: 9, z: 0 },
      { color: 'rose', mode: 'sky', x: 5, y: 14, z: -10 },
    ]);
    api.step(90);
  }
  return {
    'genex-cover'() {
      stage();
      api.camera({ pos: [0, 2.3, 23], target: [0, 5.8, -60] });
      api.step(1);
      window.__studio.pause?.();
    },
    'genex-clip'() {
      stage();
      api.camera({ pos: [0, 2.3, 23], target: [0, 5.8, -60] });
      api.launchQuiet('오늘도 수고했어', 'amber', 'sky');
      api.start();
    },
  };
}
