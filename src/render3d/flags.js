/**
 * THE FLAGS, BLOWN. Her masthead pennant and her ensign, as cloth that flies from the wind and from
 * her own way through the water, at sea and on the menu alike.
 *
 * galleon.js says where each flag is bent on (`shipFaces(spec).flags`, in menu units) and keeps
 * painting the old fixed flag for the 2D fallback; shipmodel.js leaves that fixed flag out of the 3D
 * model and hangs one of these on the same staff instead, so there is one flag of each in both views
 * and only the 3D one moves.
 *
 * THE WIND IS A LOOK, NOT A RULE. Nothing in the engine knows of it: it is a fixed direction this
 * file holds for the renderers, the way the palms bend, and no round reads it. If wind ever comes to
 * matter to the sailing it belongs in the engine, and the flags read it off the world from then on.
 *
 * WHICH WAY A FLAG FLIES. Stopped, she flies her flags down the wind (`WIND`), drooping a little and
 * lifting on a slow wave. As she gathers way the flag swings round toward her stern and the wind she
 * makes takes over: by a cruising speed it streams nearly dead astern, taut and fluttering fast. That
 * is the apparent wind's behaviour without its one ugly case: a ship running dead downwind at the
 * wind's own speed would fly a limp flag, and one running faster would fly it over her bow, which
 * reads as a mistake in a game where speed has nothing to do with the wind. So the angle off her
 * stern is the wind's, scaled down by how much way she has (`aim`), and the flag follows that aim
 * with a little lag, so a turn swings it round rather than snapping it.
 *
 * The cloth is a strip along the fly, pinned straight at the hoist, with a wave running down it
 * that grows toward the fly end. Front and back are laid down as separate triangles with opposite
 * normals, as every double-sided face in the model is, so the shared front-sided flag material still
 * serves. Nothing here allocates once a flag is built: each frame rewrites its own two buffers.
 */

import * as THREE from "three";

/**
 * The wind every flag flies from, as the direction it blows TOWARD.
 *
 *   sea    radians in the engine's frame (x across, y down the screen): a little below due right, so
 *          a ship lying stopped flies her flags across the screen where they read best
 *   menu   radians in the menu's frame, before the plate turns her: toward the viewer's right and a
 *          touch toward the viewer, so the flag on a turning plate holds still on screen while she
 *          turns under it
 *   rest   how hard it blows, as the share of a full breeze: a stopped ship's flags lift and wave
 *          rather than hang
 */
export const WIND = { sea: 0.35, menu: -0.5, rest: 0.4 };

const SPEED_K = 28; // the speed, in the engine's units, at which her way has taken 63% of the flag
const DROOP = 0.85; // radians the fly sags below level in no wind at all
const SWING = 2.6; // how fast a flag swings round to a new aim, per second
const EASE = 3; // how fast it stiffens or slackens

const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

/**
 * Where a flag wants to fly and how hard, from the wind's direction relative to her (`rel`, radians
 * from her bow toward her starboard side) and her speed. Written into `out.angle` (the same frame:
 * PI is dead astern) and `out.g` (0 slack to 1 taut).
 */
export function aim(rel, speed, out) {
  const way = 1 - Math.exp(-Math.max(0, speed) / SPEED_K);
  out.angle = Math.PI + wrap(rel - Math.PI) * (1 - way);
  out.g = WIND.rest + (1 - WIND.rest) * way;
  return out;
}

/**
 * One flag's cloth, in the model frame (X bow, Y up, Z starboard), scaled by `k` from the menu units
 * its mount is given in. `mount` is galleon.js's: `{ x, z, len, hoist, fly, wave }`, the top of the
 * hoist at (x, 0, z), the fly's length, the cloth's depth at the hoist and at the fly end, and the
 * wave's reach. Returns `{ geometry, write(angle, g, t) }`.
 */
export function flagCloth(mount, k, phase = 0) {
  const N = mount.fly < mount.hoist * 0.5 ? 10 : 7; // a pennant runs longer for its depth
  const cols = N + 1, perSide = cols * 2;
  const pos = new Float32Array(perSide * 2 * 3);
  const nor = new Float32Array(perSide * 2 * 3);
  const idx = [];
  // vertex 2i is the top of column i, 2i + 1 its foot; the back is the same again, perSide on
  for (let i = 0; i < N; i++) {
    const a = 2 * i, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, c, d, b); // front: along the fly, then down
    idx.push(perSide + a, perSide + b, perSide + c, perSide + c, perSide + b, perSide + d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(idx);
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("normal", new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  // wherever the wind takes it, it stays inside its own length of the hoist
  const hx = mount.x * k, hy = mount.z * k;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(hx, hy, 0), (mount.len + mount.hoist) * k * 1.1);

  const len = mount.len * k, d0 = mount.hoist * k, d1 = mount.fly * k, wave = mount.wave * k;

  function write(angle, g, t) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const droop = DROOP * (1 - g), cd = Math.cos(droop), sd = Math.sin(droop);
    // the fly's direction in the model frame, and the level line across it the wave moves along
    const fx = ca * cd, fy = -sd, fz = sa * cd;
    const wx = -sa, wz = ca;
    const cycles = 0.9 + 0.7 * g, rate = TAU * (0.45 + 1.6 * g), amp = wave * (1.2 - 0.55 * g);
    for (let i = 0; i < cols; i++) {
      const u = i / N;
      const ph = TAU * cycles * u - rate * t + phase;
      const swing = amp * u * Math.sin(ph), lift = 0.22 * amp * u * Math.cos(ph);
      const depth = d0 + (d1 - d0) * u, top = (d0 - depth) / 2;
      const x = hx + fx * len * u + wx * swing;
      const y = hy + fy * len * u + lift;
      const z = fz * len * u + wz * swing;
      const o = 6 * i;
      pos[o] = x; pos[o + 1] = y - top; pos[o + 2] = z;
      pos[o + 3] = x; pos[o + 4] = y - top - depth; pos[o + 5] = z;
    }
    // normals: along the fly (from the neighbours) across the hoist's straight down
    for (let i = 0; i < cols; i++) {
      const p = 6 * Math.max(0, i - 1), q = 6 * Math.min(N, i + 1), o = 6 * i;
      const ux = pos[q] - pos[p], uy = pos[q + 1] - pos[p + 1], uz = pos[q + 2] - pos[p + 2];
      const vx = pos[o + 3] - pos[o], vy = pos[o + 4] - pos[o + 1], vz = pos[o + 5] - pos[o + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let j = 0; j < 2; j++) {
        const f = o + 3 * j, b = perSide * 3 + f;
        nor[f] = nx; nor[f + 1] = ny; nor[f + 2] = nz;
        nor[b] = -nx; nor[b + 1] = -ny; nor[b + 2] = -nz;
        pos[b] = pos[f]; pos[b + 1] = pos[f + 1]; pos[b + 2] = pos[f + 2];
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
  }

  return { geometry, write };
}

/**
 * A ship's flags as one thing to blow: every cloth, the aim they share and the clock they wave on.
 *
 *   blow(rel, speed, dt)   follow the aim over `dt` seconds, the way the sea and the plate run them;
 *                          the first call stands on the aim, so a ship never swings in from nowhere
 *   pose(rel, speed, t)    stand exactly on the aim at time `t`, for a still picture that has to come
 *                          out the same every time (the icons, the lab's sheet)
 */
export function flagSet(cloths) {
  const want = { angle: 0, g: 0 };
  let angle = 0, g = 0, t = 0, blown = false;
  const write = () => { for (const c of cloths) c.write(angle, g, t); };
  return {
    blow(rel, speed, dt) {
      if (!cloths.length) return;
      aim(rel, speed, want);
      if (!blown || !(dt >= 0)) { angle = want.angle; g = want.g; blown = true; }
      else {
        angle += wrap(want.angle - angle) * (1 - Math.exp(-dt * SWING));
        g += (want.g - g) * (1 - Math.exp(-dt * EASE));
        t += dt;
      }
      write();
    },
    pose(rel, speed, at = 0) {
      if (!cloths.length) return;
      aim(rel, speed, want);
      angle = want.angle; g = want.g; t = at;
      write();
    },
  };
}
