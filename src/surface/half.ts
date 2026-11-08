/**
 * Fast float32 -> float16 conversion for bulk texture data (no per-value
 * function-call overhead, round-to-nearest, clamped to the finite range).
 */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toHalfArray(src: ArrayLike<number>, out = new Uint16Array(src.length)): Uint16Array {
  for (let i = 0; i < src.length; i++) {
    let v = src[i];
    if (v > 65000) v = 65000;
    else if (v < -65000) v = -65000;
    f32[0] = v;
    const x = u32[0];
    const sign = (x >>> 16) & 0x8000;
    const e = ((x >>> 23) & 0xff) - 112;
    let m = x & 0x7fffff;
    if (e <= 0) {
      // subnormal / zero
      if (e < -10) {
        out[i] = sign;
        continue;
      }
      m = (m | 0x800000) >> (1 - e);
      out[i] = sign | ((m + 0x1000) >> 13);
      continue;
    }
    const h = sign | (e << 10) | (m >> 13);
    out[i] = h + ((m >> 12) & 1); // round half up
  }
  return out;
}
