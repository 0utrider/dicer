/**
 * The GPU's renderer string from a WebGL context, or ''. Firefox reports the real one through
 * RENDERER and warns that WEBGL_debug_renderer_info is deprecated, so it is asked first there;
 * other browsers mask RENDERER and need the extension.
 * @param {WebGLRenderingContext|null|undefined} gl
 * @param {string} [ua] the user agent
 */
export function gpuName(gl, ua = globalThis.navigator?.userAgent ?? '') {
  if (!gl) return '';
  if (/Firefox\//.test(ua)) return String(gl.getParameter(gl.RENDERER) || '');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String((info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
}
