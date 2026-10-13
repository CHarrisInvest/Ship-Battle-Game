/**
 * EXACT MATHS: the functions JavaScript lets every engine round its own way, done one way.
 *
 * `+ - * /`, `%` and `Math.sqrt` give the same bits in every JavaScript engine, because IEEE 754 fixes
 * them. `Math.sin`, `cos`, `atan2`, `asin`, `exp`, `log`, `pow` and `hypot` are only required to be
 * close, and Safari, Chrome, Firefox and Node are free to differ in the last bit. One differing bit
 * in a heading is a different round twenty seconds later, and a round the server replays has to end
 * where the captain saw it end. So the engine, and the catalogue maths it reads, call these instead,
 * and `npm run purity` keeps them off the built-ins.
 *
 * sin, cos, atan, atan2, asin, exp and log are ports of Sun's fdlibm 5.3, the library most engines'
 * maths descend from, within 1 unit in the last place of the built-ins. Two simplifications, both
 * deterministic: sin and cos reduce their argument with the three-part Cody-Waite slices of pi/2 at
 * every size, wrapping by a whole turn first past 2^19 quarter turns, where fdlibm switches to a
 * table no angle in a round reaches; and pow multiplies out a small whole power and is
 * `exp(y * log(x))` otherwise. hypot is `sqrt(a*a + b*b)`, for two arguments only: the engine measures
 * distances on a flat sea, and nowhere near the size where the plain formula overflows.
 *
 * It imports nothing and touches nothing of the page, so the catalogue can import it.
 */

const view = new DataView(new ArrayBuffer(8));
const hiWord = (x) => { view.setFloat64(0, x); return view.getInt32(0); };
const loWord = (x) => { view.setFloat64(0, x); return view.getUint32(4); };
const fromWords = (h, l) => { view.setInt32(0, h); view.setUint32(4, l); return view.getFloat64(0); };
const withHi = (x, h) => { view.setFloat64(0, x); view.setInt32(0, h); return view.getFloat64(0); };
const clearLo = (x) => { view.setFloat64(0, x); view.setUint32(4, 0); return view.getFloat64(0); };

const HUGE = 1e300;
const TINY = 1e-300;

// ---- sin and cos ----------------------------------------------------------------------------------

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;

function kernelSin(x, y, iy) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

function kernelCos(x, y) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const INVPIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const TWO_PI = 6.28318530717958647692e+00;

// x reduced by a whole number n of quarter turns, as y0 + y1 with |y0 + y1| <= pi/4. Returns n.
let y0 = 0, y1 = 0;
function remPio2(x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { y0 = x; y1 = 0; return 0; }
  if (ix < 0x4002d97c) { // |x| < 3pi/4, one quarter turn either way
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { y0 = z - PIO2_1T; y1 = (z - y0) - PIO2_1T; }
      else { z -= PIO2_2; y0 = z - PIO2_2T; y1 = (z - y0) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { y0 = z + PIO2_1T; y1 = (z - y0) + PIO2_1T; }
    else { z += PIO2_2; y0 = z + PIO2_2T; y1 = (z - y0) + PIO2_2T; }
    return -1;
  }
  // Past 2^19 quarter turns the slices of pi/2 run out of bits; wrap by a whole turn first. `%` is
  // exact in every engine, so this is deterministic, and no angle in a round comes near it.
  const t0 = ix > 0x413921fb ? Math.abs(x) % TWO_PI : Math.abs(x);
  const n = Math.floor(t0 * INVPIO2 + 0.5);
  let r = t0 - n * PIO2_1;
  let w = n * PIO2_1T;
  const j = hiWord(t0) >> 20;
  y0 = r - w;
  let i = j - ((hiWord(y0) >> 20) & 0x7ff);
  if (i > 16) { // cancellation: a second, finer slice of pi/2
    let t = r;
    w = n * PIO2_2; r = t - w; w = n * PIO2_2T - ((t - r) - w); y0 = r - w;
    i = j - ((hiWord(y0) >> 20) & 0x7ff);
    if (i > 49) { // and a third
      t = r;
      w = n * PIO2_3; r = t - w; w = n * PIO2_3T - ((t - r) - w); y0 = r - w;
    }
  }
  y1 = (r - y0) - w;
  if (hx < 0) { y0 = -y0; y1 = -y1; return -n; }
  return n;
}

export function sin(x) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  switch (remPio2(x) & 3) {
    case 0: return kernelSin(y0, y1, 1);
    case 1: return kernelCos(y0, y1);
    case 2: return -kernelSin(y0, y1, 1);
    default: return -kernelCos(y0, y1);
  }
}

export function cos(x) {
  const ix = hiWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  switch (remPio2(x) & 3) {
    case 0: return kernelCos(y0, y1);
    case 1: return -kernelSin(y0, y1, 1);
    case 2: return -kernelCos(y0, y1);
    default: return kernelSin(y0, y1, 1);
  }
}

// ---- atan and atan2 -------------------------------------------------------------------------------

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
  -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
  -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];

export function atan(x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) { // |x| >= 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && loWord(x) !== 0)) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e200000 && HUGE + x > 1) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); }
      else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
    else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return hx < 0 ? -r : r;
}

const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16;
const PI_O_2 = 1.5707963267948965580e+00, PI_O_4 = 7.8539816339744827900e-01;

export function atan2(y, x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff, lx = loWord(x);
  const hy = hiWord(y), iy = hy & 0x7fffffff, ly = loWord(y);
  if (x !== x || y !== y) return x + y;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y); // x is 1
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2 * sign(x) + sign(y)
  if ((iy | ly) === 0) {
    if (m < 2) return y;
    return m === 2 ? PI + TINY : -PI - TINY;
  }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return [PI_O_4 + TINY, -PI_O_4 - TINY, 3 * PI_O_4 + TINY, -3 * PI_O_4 - TINY][m];
    return [0, -0, PI + TINY, -PI - TINY][m];
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) z = PI_O_2 + 0.5 * PI_LO;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

// ---- asin -----------------------------------------------------------------------------------------

const PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17, PIO4_HI = 7.85398163397448278999e-01;
const PS0 = 1.66666666666666657415e-01, PS1 = -3.25565818622400915405e-01, PS2 = 2.01212532134862925881e-01;
const PS3 = -4.00555345006794114027e-02, PS4 = 7.91534994289814532176e-04, PS5 = 3.47933107596021167570e-05;
const QS1 = -2.40339491173441421878e+00, QS2 = 2.02094576023350569471e+00, QS3 = -6.88283971605453293030e-01;
const QS4 = 7.70381505559019352791e-02;

export function asin(x) {
  const hx = hiWord(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) { // |x| >= 1
    if (((ix - 0x3ff00000) | loWord(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) { // |x| < 0.5
    if (ix < 0x3e400000 && HUGE + x > 1) return x;
    const t = x * x;
    const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    return x + x * (p / q);
  }
  const t = (1 - Math.abs(x)) * 0.5;
  const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  let r;
  if (ix >= 0x3fef3333) { // |x| > 0.975
    r = PIO2_HI - (2 * (s + s * (p / q)) - PIO2_LO);
  } else {
    const w = clearLo(s);
    const c = (t - w * w) / (s + w);
    const pp = 2 * s * (p / q) - (PIO2_LO - 2 * c);
    const qq = PIO4_HI - 2 * w;
    r = PIO4_HI - (pp - qq);
  }
  return hx > 0 ? r : -r;
}

// ---- exp and log ----------------------------------------------------------------------------------

const O_THRESHOLD = 7.09782712893383973096e+02, U_THRESHOLD = -7.45133219101941108420e+02;
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const TWOM1000 = 9.33263618503218878990e-302;

export function exp(x) {
  let hx = hiWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) { // |x| >= 709.78
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | loWord(x)) !== 0) return x + x;
      return xsb === 0 ? x : 0;
    }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  let hi = 0, lo = 0, k = 0;
  if (hx > 0x3fd62e42) { // |x| > 0.5 ln2
    if (hx < 0x3ff0a2b2) { // and < 1.5 ln2
      hi = xsb ? x + LN2_HI : x - LN2_HI;
      lo = xsb ? -LN2_LO : LN2_LO;
      k = xsb ? -1 : 1;
    } else {
      k = (INVLN2 * x + (xsb ? -0.5 : 0.5)) | 0;
      hi = x - k * LN2_HI;
      lo = k * LN2_LO;
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) { // |x| < 2^-28
    if (HUGE + x > 1) return 1 + x;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - ((lo - (x * c) / (2 - c)) - hi);
  if (k >= -1021) return withHi(y, hiWord(y) + (k << 20));
  return withHi(y, hiWord(y) + ((k + 1000) << 20)) * TWOM1000;
}

const TWO54 = 1.80143985094819840000e+16;
const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

export function log(x) {
  let hx = hiWord(x);
  const lx = loWord(x);
  let k = 0;
  if (hx < 0x00100000) { // x < 2^-1022
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= TWO54; hx = hiWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000)); // x or x/2 brought into [sqrt(2)/2, sqrt(2))
  k += i >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) { // -2^-20 <= f < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    return dk * LN2_HI - ((R - dk * LN2_LO) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}

// ---- pow and hypot --------------------------------------------------------------------------------

/**
 * x to the y. A small whole power is multiplied out, which is both closer and the common case in the
 * catalogue (a sail's fade by berth, a port's taper by tier); everything else is exp(y log x), whose
 * error grows with |y ln x| and is a few units in the last place over the range the catalogue uses.
 * A negative x is defined only for a whole y, as `Math.pow` has it.
 */
export function pow(x, y) {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === 1) return x;
  if (y === Infinity || y === -Infinity) {
    const a = Math.abs(x);
    if (a === 1) return NaN;
    return (a > 1) === (y > 0) ? Infinity : 0;
  }
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let n = Math.abs(y), b = x, r = 1;
    while (n > 0) { if (n & 1) r *= b; b *= b; n >>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const r = exp(y * log(-x));
    return y % 2 === 0 ? r : -r;
  }
  return exp(y * log(x));
}

/** The length of (a, b). Two arguments only: the engine measures distances on a flat sea. */
export const hypot = (a, b) => Math.sqrt(a * a + b * b);
