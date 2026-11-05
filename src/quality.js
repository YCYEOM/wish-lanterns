// Graphics tier, decided once before anything is built. LITE when the browser draws WebGL in software
// (graphics acceleration off, a blocked driver: SwiftShader, Microsoft Basic Render, llvmpipe), where the full
// scene runs at ~3 fps: plainer shaders (no Milky Way, ripples, pebbles, foam), a coarser ground, a fifth of the
// grass, fewer falling particles, lower resolution and 30 fps. ?lite forces it on, ?full forces it off.
function softwareGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { soft: true, name: 'no webgl' };
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return { soft: /swiftshader|llvmpipe|software|basic render/i.test(name), name };
  } catch { return { soft: false, name: '' }; }
}
const q = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
const probe = softwareGpu();
export const GPU_NAME = probe.name;
export const SOFTWARE_GPU = probe.soft;
export const LITE = q.has('full') ? false : q.has('lite') || SOFTWARE_GPU;
