/** 박스 블러 1회 (가로 또는 세로). 가장자리는 clamp. */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const lineStride = horizontal ? w : 1;
  const d = 2 * r + 1;
  const cl = (v: number) => (v < 0 ? 0 : v >= len ? len - 1 : v);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[base + cl(k) * stride];
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = acc / d;
      acc += src[base + cl(i + r + 1) * stride] - src[base + cl(i - r) * stride];
    }
  }
}

/** 박스 블러를 여러 번 겹쳐 가우시안에 가깝게 만든다. 새 배열을 반환. */
export function blurChannel(ch: Float32Array, w: number, h: number, rx: number, ry: number, passes = 3): Float32Array {
  rx = Math.max(0, Math.round(rx));
  ry = Math.max(0, Math.round(ry));
  if (rx === 0 && ry === 0) return new Float32Array(ch);
  let a: Float32Array = new Float32Array(ch);
  let b: Float32Array = new Float32Array(ch.length);
  for (let p = 0; p < passes; p++) {
    if (rx > 0) {
      boxPass(a, b, w, h, rx, true);
      [a, b] = [b, a];
    }
    if (ry > 0) {
      boxPass(a, b, w, h, ry, false);
      [a, b] = [b, a];
    }
  }
  return a;
}

/** 사용자가 보는 "반경(px)"을 박스 반경으로 변환 */
export const radiusToBox = (R: number) => Math.max(1, Math.round(R / 2));
