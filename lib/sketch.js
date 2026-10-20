/* Stick-figure storyboard sketches, drawn from a blocking spec.
 *
 * A sketch is described as data, not drawn as free-form markup: a horizon,
 * a few set pieces, the figures (where they stand, how close the camera is,
 * which way they face, what pose), and movement arrows. This module turns
 * that spec into vector geometry. Two things produce specs:
 *
 *   - autoSketchSpec(): a deterministic first pass from the shot type, the
 *     angle and the action text. Free, instant, works offline — every new
 *     panel can carry a readable sketch before anyone spends a token.
 *   - the model (ai.js, task "sketch"): returns the same JSON, chosen with
 *     an understanding of the scene. Small output, so it is quick and cheap
 *     next to drawing a whole frame as SVG.
 *
 * Either way the spec is untrusted input: normalizeSketchSpec() clamps every
 * number and maps every word onto a fixed vocabulary before anything is
 * drawn, and the geometry is built with createElementNS/setAttribute — no
 * markup string is assembled from spec values. The result is serialised and
 * stored like any other layer, so it goes back through svgsafe on load.
 */

import { VALID_SHOT_TYPES } from './vocab.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INK = '#1B1400';
const SET_INK = '#5A5244';

/* ---------------- Vocabulary ---------------- */

export const SKETCH_FRAMINGS = ['full', 'knee', 'waist', 'chest', 'head', 'face'];
export const SKETCH_FACINGS = ['left', 'right', 'front', 'back'];
export const SKETCH_SET_KINDS = [
  'room',
  'wall',
  'door',
  'window',
  'building',
  'table',
  'chair',
  'bed',
  'counter',
  'car',
  'tree',
  'screen',
  'lamp',
  'box',
  'road',
  'hills',
  'moon',
  'line',
];

/* Joint angles in degrees. Profile view: 0 points straight down, +90 points
   the way the figure faces, -90 behind it. [first segment, bend of second].
   Front view: angles open outward from the body; a negative bend folds the
   forearm or shin back across it. */
const POSES = {
  stand: {
    profile: { armA: [6, 4], armB: [-6, 6], legA: [5, -2], legB: [-4, 0] },
    front: { arm: [10, 4], leg: [5, 0] },
  },
  walk: {
    lean: 4,
    profile: { armA: [-28, 18], armB: [26, 22], legA: [24, -6], legB: [-20, -28] },
    front: { arm: [12, 6], leg: [7, 0] },
  },
  run: {
    lean: 16,
    profile: { armA: [-55, 85], armB: [60, 95], legA: [62, -78], legB: [-34, -64] },
    front: { arm: [28, 70], leg: [12, -10] },
  },
  sit: {
    lean: 4,
    seated: true,
    profile: { armA: [22, 48], armB: [14, 52], legA: [86, -88], legB: [80, -84] },
    front: { arm: [14, -30], leg: [12, -4] },
  },
  talk: {
    lean: 3,
    profile: { armA: [48, 62], armB: [8, 10], legA: [6, -2], legB: [-5, 0] },
    front: { arm: [16, 8], leg: [6, 0], armR: [40, 55] },
  },
  point: {
    lean: 3,
    profile: { armA: [96, 2], armB: [4, 6], legA: [10, -3], legB: [-8, 0] },
    front: { arm: [10, 4], leg: [6, 0], armR: [88, 4] },
  },
  reach: {
    lean: 14,
    profile: { armA: [118, 6], armB: [100, 12], legA: [22, -6], legB: [-16, -12] },
    front: { arm: [70, 40], leg: [8, 0] },
  },
  'arms-up': {
    profile: { armA: [168, 4], armB: [158, 6], legA: [6, 0], legB: [-6, 0] },
    front: { arm: [150, 10], leg: [9, 0] },
  },
  'arms-crossed': {
    profile: { armA: [18, 118], armB: [24, 112], legA: [5, 0], legB: [-5, 0] },
    front: { arm: [16, -130], leg: [6, 0] },
  },
  'hands-on-hips': {
    profile: { armA: [-30, 92], armB: [-24, 86], legA: [6, 0], legB: [-6, 0] },
    front: { arm: [48, -100], leg: [9, 0] },
  },
  crouch: {
    lean: 34,
    profile: { armA: [44, 30], armB: [30, 40], legA: [78, -136], legB: [60, -120] },
    front: { arm: [24, 20], leg: [30, -60] },
  },
  kneel: {
    lean: 4,
    profile: { armA: [30, 40], armB: [10, 20], legA: [84, -84], legB: [2, -92] },
    front: { arm: [14, 10], leg: [16, -10] },
  },
  jump: {
    lean: 6,
    lift: 0.12,
    profile: { armA: [150, 14], armB: [140, 20], legA: [34, -76], legB: [-6, -60] },
    front: { arm: [140, 14], leg: [16, -24] },
  },
  fall: {
    rotate: -62,
    profile: { armA: [140, 24], armB: [-70, 30], legA: [34, -28], legB: [8, -10] },
    front: { arm: [110, 20], leg: [20, 0] },
  },
  lie: {
    rotate: -90,
    profile: { armA: [12, 6], armB: [-8, 4], legA: [2, 0], legB: [-2, 0] },
    front: { arm: [12, 4], leg: [4, 0] },
  },
  hold: {
    lean: 3,
    profile: { armA: [52, 74], armB: [44, 82], legA: [6, -2], legB: [-5, 0] },
    front: { arm: [18, -70], leg: [6, 0] },
  },
  wave: {
    profile: { armA: [156, -26], armB: [6, 6], legA: [6, 0], legB: [-5, 0] },
    front: { arm: [10, 4], leg: [6, 0], armR: [128, 30] },
  },
  phone: {
    profile: { armA: [28, 152], armB: [6, 6], legA: [6, -2], legB: [-5, 0] },
    front: { arm: [10, 4], leg: [6, 0], armR: [34, -150] },
  },
  fight: {
    lean: 10,
    profile: { armA: [92, 0], armB: [34, 118], legA: [24, -10], legB: [-22, -6] },
    front: { arm: [40, -110], leg: [16, 0], armR: [84, 0] },
  },
  drive: {
    lean: 2,
    seated: true,
    profile: { armA: [72, 28], armB: [64, 34], legA: [80, -70], legB: [76, -66] },
    front: { arm: [26, -40], leg: [12, -4] },
  },
};

export const SKETCH_POSES = Object.keys(POSES);

/* Body proportions, in units of a standing figure's height. */
const BODY = {
  headR: 0.066,
  neck: 0.018,
  torso: 0.31,
  upperArm: 0.165,
  forearm: 0.155,
  thigh: 0.25,
  shin: 0.25,
  foot: 0.055,
  shoulderHalf: 0.095,
  hipHalf: 0.045,
};

/* How much of the figure, from the top of the head, each framing shows. */
const FRAMING_VISIBLE = { knee: 0.76, waist: 0.56, chest: 0.37, head: 0.21, face: 0.12 };

/* ---------------- Spec normalisation ---------------- */

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};
const pickWord = (list, value, fallback) => {
  const word = String(value || '')
    .toLowerCase()
    .trim();
  return list.includes(word) ? word : fallback;
};
const cleanName = (value) =>
  String(value || '')
    .replace(/[^\p{L}\p{N} .'’-]/gu, '')
    .trim()
    .slice(0, 24);

/* Accepts anything a model or a hand-edited file might produce and returns a
   spec that is safe and sensible to draw. Unknown fields are dropped. */
export function normalizeSketchSpec(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const horizon =
    src.horizon === null || src.horizon === undefined ? null : clamp(src.horizon, 0, 1, null);
  const spec = {
    horizon,
    tilt: clamp(src.tilt, -25, 25, 0),
    set: [],
    figures: [],
    arrows: [],
  };

  (Array.isArray(src.set) ? src.set : []).slice(0, 14).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const kind = pickWord(SKETCH_SET_KINDS, item.kind || item.type, null);
    if (!kind) return;
    spec.set.push({
      kind,
      x: clamp(item.x, -0.2, 1.2, 0.4),
      y: clamp(item.y, -0.2, 1.2, 0.4),
      w: clamp(item.w, 0.01, 1.4, 0.2),
      h: clamp(item.h, 0.01, 1.4, 0.2),
    });
  });

  (Array.isArray(src.figures) ? src.figures : []).slice(0, 6).forEach((fig) => {
    if (!fig || typeof fig !== 'object') return;
    spec.figures.push({
      name: cleanName(fig.name || fig.label),
      x: clamp(fig.x, -0.1, 1.1, 0.5),
      framing: pickWord(SKETCH_FRAMINGS, fig.framing, 'full'),
      depth: clamp(fig.depth, 0, 1, 0.3),
      facing: pickWord(SKETCH_FACINGS, fig.facing, 'front'),
      pose: pickWord(SKETCH_POSES, fig.pose, 'stand'),
    });
  });

  (Array.isArray(src.arrows) ? src.arrows : []).slice(0, 5).forEach((arrow) => {
    if (!arrow || typeof arrow !== 'object') return;
    const from = Array.isArray(arrow.from) ? arrow.from : [];
    const to = Array.isArray(arrow.to) ? arrow.to : [];
    spec.arrows.push({
      from: [clamp(from[0], 0, 1, 0.4), clamp(from[1], 0, 1, 0.8)],
      to: [clamp(to[0], 0, 1, 0.6), clamp(to[1], 0, 1, 0.8)],
      kind: arrow.kind === 'camera' ? 'camera' : 'move',
    });
  });

  return spec;
}

/* ---------------- Geometry ---------------- */

const rad = (deg) => (deg * Math.PI) / 180;
const dir = (deg) => [Math.sin(rad(deg)), Math.cos(rad(deg))];
const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];

/* A figure's joints in figure units, hip at the origin, facing +x for
   profile views. Returns points plus which drawing style applies. */
function poseJoints(poseName, facing) {
  const pose = POSES[poseName] || POSES.stand;
  const lean = pose.lean || 0;
  const torsoDir = [Math.sin(rad(lean)), -Math.cos(rad(lean))];
  const hip = [0, 0];
  const neckBase = add(hip, torsoDir, BODY.torso);
  const head = add(neckBase, torsoDir, BODY.neck + BODY.headR);
  const limbs = [];

  if (facing === 'left' || facing === 'right') {
    const p = pose.profile;
    const arm = ([a, b]) => {
      const elbow = add(neckBase, dir(a), BODY.upperArm);
      return [neckBase, elbow, add(elbow, dir(a + b), BODY.forearm)];
    };
    const leg = ([a, b]) => {
      const knee = add(hip, dir(a), BODY.thigh);
      const ankle = add(knee, dir(a + b), BODY.shin);
      return [hip, knee, ankle, add(ankle, dir(a + b + 90), BODY.foot)];
    };
    // Far limbs first so the near ones draw over them.
    limbs.push(
      { pts: arm(p.armB), far: true },
      { pts: leg(p.legB), far: true },
      { pts: leg(p.legA) },
      { pts: arm(p.armA) },
    );
  } else {
    const f = pose.front;
    const side = (sign, [a, b], origin, l1, l2, isLeg) => {
      const d = (deg) => [Math.sin(rad(deg)) * sign, Math.cos(rad(deg))];
      const mid = add(origin, d(a), l1);
      const end = add(mid, d(a + b), l2);
      return isLeg && pose.seated
        ? [origin, add(origin, d(a), l1 * 0.32), end]
        : [origin, mid, end];
    };
    const shoulderL = [neckBase[0] - BODY.shoulderHalf, neckBase[1] + 0.012];
    const shoulderR = [neckBase[0] + BODY.shoulderHalf, neckBase[1] + 0.012];
    const hipL = [-BODY.hipHalf, 0];
    const hipR = [BODY.hipHalf, 0];
    limbs.push(
      { pts: side(-1, f.leg, hipL, BODY.thigh, BODY.shin, true) },
      { pts: side(1, f.legR || f.leg, hipR, BODY.thigh, BODY.shin, true) },
      { pts: side(-1, f.arm, shoulderL, BODY.upperArm, BODY.forearm) },
      { pts: side(1, f.armR || f.arm, shoulderR, BODY.upperArm, BODY.forearm) },
    );
    limbs.shoulders = [shoulderL, shoulderR];
  }

  let points = { hip, neckBase, head, limbs };
  const rotate = pose.rotate || 0;
  if (rotate) {
    const c = Math.cos(rad(rotate));
    const s = Math.sin(rad(rotate));
    const rot = ([x, y]) => [x * c - y * s, x * s + y * c];
    points = {
      hip: rot(hip),
      neckBase: rot(neckBase),
      head: rot(head),
      limbs: limbs.map((l) => ({ ...l, pts: l.pts.map(rot) })),
    };
    if (limbs.shoulders) points.limbs.shoulders = limbs.shoulders.map(rot);
  }
  if (facing === 'left') {
    const mirror = ([x, y]) => [-x, y];
    const shoulders = points.limbs.shoulders;
    points = {
      hip: mirror(points.hip),
      neckBase: mirror(points.neckBase),
      head: mirror(points.head),
      limbs: points.limbs.map((l) => ({ ...l, pts: l.pts.map(mirror) })),
    };
    if (shoulders) points.limbs.shoulders = shoulders.map(mirror);
  }
  points.lift = pose.lift || 0;
  return points;
}

function jointBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const take = ([x, y], r = 0) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };
  take(points.hip);
  take(points.neckBase);
  take(points.head, BODY.headR);
  points.limbs.forEach((l) => l.pts.forEach((p) => take(p)));
  return { minX, maxX, minY, maxY };
}

/* ---------------- Drawing ---------------- */

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  return node;
}
const r2 = (n) => Math.round(n * 100) / 100;

function polyline(points, attrs) {
  return el('polyline', {
    points: points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' '),
    fill: 'none',
    ...attrs,
  });
}

/* Body outline used for medium and closer shots, where a single stick for a
   torso reads as a cartoon. Points are figure units around the neck base. */
function bustOutline(nb, facing, bottomY) {
  const [x, y] = nb;
  if (facing === 'left' || facing === 'right') {
    const k = facing === 'right' ? 1 : -1;
    return [
      [x - k * 0.075, bottomY],
      [x - k * 0.078, y + 0.06],
      [x - k * 0.055, y + 0.012],
      [x + k * 0.02, y + 0.004],
      [x + k * 0.07, y + 0.035],
      [x + k * 0.092, y + 0.1],
      [x + k * 0.085, bottomY],
    ];
  }
  const sh = 0.15;
  return [
    [x - sh - 0.012, bottomY],
    [x - sh, y + 0.065],
    [x - sh + 0.02, y + 0.02],
    [x - 0.04, y + 0.004],
    [x + 0.04, y + 0.004],
    [x + sh - 0.02, y + 0.02],
    [x + sh, y + 0.065],
    [x + sh + 0.012, bottomY],
  ];
}

function drawFigure(group, fig, frame) {
  const { W, H, horizonY } = frame;
  const pose = POSES[fig.pose] || POSES.stand;
  const joints = poseJoints(fig.pose, fig.facing);
  const bounds = jointBounds(joints);
  const close = fig.framing !== 'full' && fig.framing !== 'knee';
  const profile = fig.facing === 'left' || fig.facing === 'right';
  const back = fig.facing === 'back';

  // Scale (px per figure-height) and anchor, from framing and depth.
  let s;
  let originY;
  if (fig.framing === 'full') {
    s = H * (0.64 - 0.5 * fig.depth);
    const ground =
      horizonY === null
        ? H * (0.95 - 0.3 * fig.depth)
        : H * 0.95 - (H * 0.95 - (horizonY + H * 0.04)) * fig.depth;
    originY = ground - bounds.maxY * s - joints.lift * s;
  } else {
    s = (H * 0.86) / FRAMING_VISIBLE[fig.framing];
    // Head top just below the frame edge — cropped into it for the tightest.
    const top = { knee: 0.1, waist: 0.1, chest: 0.09, head: 0.07, face: -0.04 }[fig.framing];
    originY = H * top - (joints.head[1] - BODY.headR) * s;
  }
  const originX = fig.x * W;
  const P = ([x, y]) => [originX + x * s, originY + y * s];

  const sw = Math.min(W / 105, Math.max(W / 480, s * 0.017));
  const stroke = {
    stroke: INK,
    'stroke-width': r2(sw),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  const fg = el('g', {});
  const nb = joints.neckBase;
  const headC = joints.head;
  const torsoDir = [nb[0] - joints.hip[0], nb[1] - joints.hip[1]];
  const tl = Math.hypot(torsoDir[0], torsoDir[1]) || 1;
  const headBottom = [
    headC[0] - (torsoDir[0] / tl) * BODY.headR,
    headC[1] - (torsoDir[1] / tl) * BODY.headR,
  ];

  if (close) {
    // Body outline down past the frame edge, filled solid when seen from behind.
    const bottomY = (H * 1.08 - originY) / s;
    fg.appendChild(
      polyline(bustOutline(nb, fig.facing, bottomY).map(P), {
        ...stroke,
        fill: back ? INK : '#DCD6C4',
        'fill-opacity': back ? 0.82 : 1,
      }),
    );
    // Neck.
    const nw = profile ? 0.022 : 0.03;
    fg.appendChild(
      polyline(
        [P([headBottom[0] - nw, headBottom[1] - 0.01]), P([nb[0] - nw, nb[1] + 0.006])],
        stroke,
      ),
    );
    fg.appendChild(
      polyline(
        [P([headBottom[0] + nw, headBottom[1] - 0.01]), P([nb[0] + nw, nb[1] + 0.006])],
        stroke,
      ),
    );
    // Arms only when the pose actually moves them away from the body.
    joints.limbs.forEach((limb, i) => {
      const isArm = profile ? i === 0 || i === 3 : i >= 2;
      if (!isArm) return;
      const [root, elbow, wrist] = limb.pts;
      const raised = wrist[1] < joints.hip[1] - 0.12 || Math.abs(wrist[0] - root[0]) > 0.1;
      if (!raised) return;
      fg.appendChild(
        polyline([root, elbow, wrist].map(P), { ...stroke, opacity: limb.far ? 0.55 : 1 }),
      );
      const hand = P(wrist);
      fg.appendChild(
        el('circle', { cx: r2(hand[0]), cy: r2(hand[1]), r: r2(sw * 1.3), fill: INK }),
      );
    });
  } else {
    // Limbs, far side lighter so overlapping profiles stay readable.
    joints.limbs.forEach((limb) => {
      fg.appendChild(polyline(limb.pts.map(P), { ...stroke, opacity: limb.far ? 0.55 : 1 }));
    });
    fg.appendChild(polyline([joints.hip, nb, headBottom].map(P), stroke));
    if (!profile && joints.limbs.shoulders) {
      fg.appendChild(polyline(joints.limbs.shoulders.map(P), stroke));
      fg.appendChild(polyline([joints.limbs[0].pts[0], joints.limbs[1].pts[0]].map(P), stroke));
    }
    if (pose.seated) {
      // The seat, so a sitting figure doesn't read as a short standing one.
      const seatY = joints.hip[1] + 0.03;
      const span = profile ? [-0.12, 0.2] : [-0.16, 0.16];
      const flip = fig.facing === 'left' ? -1 : 1;
      fg.appendChild(
        el('line', {
          x1: r2(P([span[0] * flip, seatY])[0]),
          y1: r2(P([0, seatY])[1]),
          x2: r2(P([span[1] * flip, seatY])[0]),
          y2: r2(P([0, seatY])[1]),
          stroke: SET_INK,
          'stroke-width': r2(sw * 0.9),
          'stroke-linecap': 'round',
          opacity: 0.8,
        }),
      );
    }
  }

  // Head.
  const head = P(headC);
  const hr = BODY.headR * s;
  fg.appendChild(
    el('circle', {
      cx: r2(head[0]),
      cy: r2(head[1]),
      r: r2(hr),
      ...stroke,
      fill: back ? INK : '#DCD6C4',
      'fill-opacity': back ? 0.82 : 1,
    }),
  );

  // Facial cues only when the head is big enough to carry them.
  if (!back && hr > H * 0.035) {
    const dot = (x, y) =>
      el('circle', { cx: r2(x), cy: r2(y), r: r2(Math.max(sw * 0.8, hr * 0.065)), fill: INK });
    const fine = { ...stroke, 'stroke-width': r2(Math.max(1, sw * 0.6)) };
    if (fig.facing === 'front') {
      fg.appendChild(dot(head[0] - hr * 0.34, head[1] - hr * 0.08));
      fg.appendChild(dot(head[0] + hr * 0.34, head[1] - hr * 0.08));
      fg.appendChild(
        polyline(
          [
            [head[0], head[1] + hr * 0.02],
            [head[0] - hr * 0.06, head[1] + hr * 0.22],
            [head[0] + hr * 0.04, head[1] + hr * 0.24],
          ],
          fine,
        ),
      );
      fg.appendChild(
        el('line', {
          x1: r2(head[0] - hr * 0.16),
          y1: r2(head[1] + hr * 0.46),
          x2: r2(head[0] + hr * 0.16),
          y2: r2(head[1] + hr * 0.46),
          ...fine,
        }),
      );
    } else {
      const sign = fig.facing === 'right' ? 1 : -1;
      fg.appendChild(dot(head[0] + sign * hr * 0.42, head[1] - hr * 0.12));
      fg.appendChild(
        polyline(
          [
            [head[0] + sign * hr * 0.92, head[1] - hr * 0.05],
            [head[0] + sign * hr * 1.18, head[1] + hr * 0.18],
            [head[0] + sign * hr * 0.9, head[1] + hr * 0.25],
          ],
          fine,
        ),
      );
    }
  } else if (profile) {
    // A tick for the nose so a small profile still reads its direction.
    const sign = fig.facing === 'right' ? 1 : -1;
    fg.appendChild(
      polyline(
        [
          [head[0] + sign * hr * 0.9, head[1]],
          [head[0] + sign * hr * 1.35, head[1] + hr * 0.15],
        ],
        { ...stroke, 'stroke-width': r2(sw * 0.8) },
      ),
    );
  }

  // Character names help a reader follow who is who at a distance.
  if (fig.name && !close) {
    const size = Math.min(H / 26, Math.max(H / 52, s * 0.07));
    const label = el('text', {
      x: r2(head[0]),
      y: r2(head[1] - hr - size * 0.6),
      'font-family': 'Helvetica, Arial, sans-serif',
      'font-size': r2(size),
      'font-weight': 'bold',
      'text-anchor': 'middle',
      fill: INK,
    });
    label.textContent = fig.name;
    fg.appendChild(label);
  }

  group.appendChild(fg);
}

function drawSetPiece(group, item, frame) {
  const { W, H, horizonY } = frame;
  const x = item.x * W;
  const y = item.y * H;
  const w = item.w * W;
  const h = item.h * H;
  const sw = r2(W / 420);
  const line = { stroke: SET_INK, 'stroke-width': sw, 'stroke-linecap': 'round', fill: 'none' };
  const g = el('g', { opacity: 0.8 });
  const add2 = (node) => g.appendChild(node);
  const rect = (rx, ry, rw, rh, extra = {}) =>
    el('rect', { x: r2(rx), y: r2(ry), width: r2(rw), height: r2(rh), ...line, ...extra });
  const seg = (x1, y1, x2, y2, extra = {}) =>
    el('line', { x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), ...line, ...extra });

  switch (item.kind) {
    case 'room': {
      // Back wall plus the lines running to the frame corners: reads as an
      // interior at any size.
      add2(rect(x, y, w, h));
      add2(seg(x, y, 0, 0));
      add2(seg(x + w, y, W, 0));
      add2(seg(x, y + h, 0, H));
      add2(seg(x + w, y + h, W, H));
      break;
    }
    case 'wall':
      add2(seg(x, y, x + w, y));
      add2(seg(x, y + h, x + w, y + h));
      break;
    case 'door':
      add2(rect(x, y, w, h));
      add2(
        el('circle', {
          cx: r2(x + w * 0.82),
          cy: r2(y + h * 0.55),
          r: r2(Math.max(2, w * 0.05)),
          ...line,
        }),
      );
      break;
    case 'window':
      add2(rect(x, y, w, h));
      add2(seg(x + w / 2, y, x + w / 2, y + h));
      add2(seg(x, y + h / 2, x + w, y + h / 2));
      break;
    case 'building': {
      add2(rect(x, y, w, h));
      const cols = Math.max(1, Math.round(w / (W * 0.03)));
      const rows = Math.max(1, Math.round(h / (H * 0.08)));
      for (let c = 0; c < cols; c++) {
        for (let rr = 0; rr < rows; rr++) {
          if ((c + rr) % 2) continue;
          const wx = x + ((c + 0.3) * w) / cols;
          const wy = y + ((rr + 0.3) * h) / rows;
          add2(seg(wx, wy, wx + (0.4 * w) / cols, wy, { opacity: 0.6 }));
        }
      }
      break;
    }
    case 'table':
      add2(seg(x, y, x + w, y, { 'stroke-width': r2(sw * 1.6) }));
      add2(seg(x + w * 0.08, y, x + w * 0.08, y + h));
      add2(seg(x + w * 0.92, y, x + w * 0.92, y + h));
      break;
    case 'chair':
      add2(seg(x, y, x, y + h));
      add2(seg(x, y + h * 0.55, x + w, y + h * 0.55));
      add2(seg(x + w, y + h * 0.55, x + w, y + h));
      break;
    case 'bed':
      add2(rect(x, y + h * 0.35, w, h * 0.65));
      add2(seg(x, y, x, y + h));
      add2(seg(x, y + h * 0.5, x + w, y + h * 0.5, { opacity: 0.6 }));
      break;
    case 'counter':
      add2(rect(x, y, w, h));
      add2(seg(x, y + h * 0.15, x + w, y + h * 0.15));
      break;
    case 'car': {
      const body = [
        [x, y + h * 0.75],
        [x, y + h * 0.45],
        [x + w * 0.2, y + h * 0.42],
        [x + w * 0.32, y + h * 0.1],
        [x + w * 0.68, y + h * 0.1],
        [x + w * 0.82, y + h * 0.42],
        [x + w, y + h * 0.48],
        [x + w, y + h * 0.75],
        [x, y + h * 0.75],
      ];
      add2(polyline(body, line));
      const wr = Math.min(w, h) * 0.17;
      add2(el('circle', { cx: r2(x + w * 0.24), cy: r2(y + h * 0.78), r: r2(wr), ...line }));
      add2(el('circle', { cx: r2(x + w * 0.76), cy: r2(y + h * 0.78), r: r2(wr), ...line }));
      break;
    }
    case 'tree':
      add2(seg(x + w / 2, y + h * 0.45, x + w / 2, y + h));
      add2(
        el('ellipse', {
          cx: r2(x + w / 2),
          cy: r2(y + h * 0.3),
          rx: r2(w / 2),
          ry: r2(h * 0.3),
          ...line,
        }),
      );
      break;
    case 'screen':
      add2(rect(x, y, w, h));
      add2(rect(x + w * 0.06, y + h * 0.08, w * 0.88, h * 0.76, { opacity: 0.6 }));
      break;
    case 'lamp':
      add2(seg(x + w / 2, y + h * 0.3, x + w / 2, y + h));
      add2(
        polyline(
          [
            [x + w * 0.2, y + h * 0.3],
            [x + w * 0.35, y],
            [x + w * 0.65, y],
            [x + w * 0.8, y + h * 0.3],
            [x + w * 0.2, y + h * 0.3],
          ],
          line,
        ),
      );
      break;
    case 'road': {
      // Two edges converging on a vanishing point at the horizon.
      const vy = horizonY === null ? H * 0.45 : horizonY;
      const vx = x + w / 2;
      add2(seg(x, H, vx - w * 0.02, vy));
      add2(seg(x + w, H, vx + w * 0.02, vy));
      add2(seg(vx, H, vx, vy, { 'stroke-dasharray': `${r2(W / 60)},${r2(W / 50)}`, opacity: 0.6 }));
      break;
    }
    case 'hills': {
      const pts = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        pts.push([x + (w * i) / steps, i % 2 ? y : y + h]);
      }
      add2(polyline(pts, line));
      break;
    }
    case 'moon':
      add2(
        el('circle', { cx: r2(x + w / 2), cy: r2(y + h / 2), r: r2(Math.min(w, h) / 2), ...line }),
      );
      break;
    case 'line':
      add2(seg(x, y, x + w, y + h));
      break;
    default:
      add2(rect(x, y, w, h));
  }
  group.appendChild(g);
}

function drawArrow(group, arrow, frame) {
  const { W, H } = frame;
  const [x1, y1] = [arrow.from[0] * W, arrow.from[1] * H];
  const [x2, y2] = [arrow.to[0] * W, arrow.to[1] * H];
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < W * 0.01) return;
  const camera = arrow.kind === 'camera';
  const sw = camera ? W / 260 : W / 300;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const head = W / 55;
  const g = el('g', { opacity: camera ? 0.75 : 0.9 });
  g.appendChild(
    el('line', {
      x1: r2(x1),
      y1: r2(y1),
      x2: r2(x2 - ux * head * 0.6),
      y2: r2(y2 - uy * head * 0.6),
      stroke: INK,
      'stroke-width': r2(sw),
      'stroke-linecap': 'round',
      ...(camera ? { 'stroke-dasharray': `${r2(sw * 3)},${r2(sw * 2.2)}` } : {}),
    }),
  );
  g.appendChild(
    el('polygon', {
      points: [
        [x2, y2],
        [x2 - ux * head - uy * head * 0.5, y2 - uy * head + ux * head * 0.5],
        [x2 - ux * head + uy * head * 0.5, y2 - uy * head - ux * head * 0.5],
      ]
        .map(([px, py]) => `${r2(px)},${r2(py)}`)
        .join(' '),
      fill: INK,
    }),
  );
  group.appendChild(g);
}

/* Draws a normalised spec into a fresh <g>. Figures are painted far to near
   so a figure closer to camera overlaps one behind it. */
export function buildSketchNode(spec, panelW, panelH) {
  const W = panelW;
  const H = panelH;
  const horizonY = spec.horizon === null ? null : spec.horizon * H;
  const frame = { W, H, horizonY };
  const root = el('g', {});
  if (spec.tilt)
    root.setAttribute('transform', `rotate(${r2(spec.tilt)} ${r2(W / 2)} ${r2(H / 2)})`);

  if (horizonY !== null) {
    root.appendChild(
      el('line', {
        x1: r2(-W * 0.2),
        y1: r2(horizonY),
        x2: r2(W * 1.2),
        y2: r2(horizonY),
        stroke: SET_INK,
        'stroke-width': r2(W / 520),
        opacity: 0.55,
      }),
    );
  }
  spec.set.forEach((item) => drawSetPiece(root, item, frame));

  const order = (f) => (f.framing === 'full' ? f.depth : -1 + FRAMING_VISIBLE[f.framing]);
  [...spec.figures]
    .sort((a, b) => order(b) - order(a))
    .forEach((fig) => drawFigure(root, fig, frame));
  spec.arrows.forEach((arrow) => drawArrow(root, arrow, frame));
  return root;
}

/* The spec as SVG markup for a layer. Serialised from DOM nodes this module
   built; stored layers are re-sanitised on load like all artwork. */
export function renderSketchMarkup(rawSpec, panelW, panelH) {
  const node = buildSketchNode(normalizeSketchSpec(rawSpec), panelW, panelH);
  const holder = document.createElementNS(SVG_NS, 'svg');
  holder.appendChild(node);
  return holder.innerHTML;
}

/* ---------------- Automatic first pass ---------------- */

const NAME_STOPWORDS = new Set([
  'INT',
  'EXT',
  'EST',
  'CUT',
  'TO',
  'OTS',
  'POV',
  'CU',
  'ECU',
  'MCU',
  'MS',
  'WS',
  'VO',
  'OS',
  'OC',
  'CONT',
  'CONTD',
  'DAY',
  'NIGHT',
  'MORNING',
  'EVENING',
  'LATER',
  'CONTINUOUS',
  'FADE',
  'IN',
  'OUT',
  'THE',
  'A',
  'AN',
  'AND',
  'OF',
  'TV',
  'OK',
  'I',
  'BACK',
  'ON',
  'INSERT',
  'ANGLE',
  'SFX',
  'VFX',
]);

/* Character names as screenplays write them in action: capitalised words. */
export function extractCast(text, limit = 4) {
  const found = [];
  const re = /\b([A-Z][A-Z'’.-]{1,}(?:\s[A-Z][A-Z'’.-]{1,})?)\b/g;
  let m;
  while ((m = re.exec(String(text || ''))) && found.length < limit) {
    const name = m[1].replace(/[.'’-]+$/, '');
    const words = name.split(/\s+/);
    if (words.some((w) => NAME_STOPWORDS.has(w.replace(/[^A-Z]/g, '')))) continue;
    if (name.length < 2 || found.includes(name)) continue;
    found.push(name);
  }
  return found;
}

const VERB_POSES = [
  [/\b(run|runs|running|sprint|sprints|chase|chases|flee|flees|races?)\b/i, 'run'],
  [/\b(jump|jumps|leap|leaps|vaults?|dives?)\b/i, 'jump'],
  [/\b(falls?|falling|collapses?|stumbles?|trips?)\b/i, 'fall'],
  [/\b(lies|lying|asleep|sleeps?|in bed)\b/i, 'lie'],
  [/\b(kneels?|kneeling)\b/i, 'kneel'],
  [/\b(crouch|crouches|hides?|ducks?|squats?)\b/i, 'crouch'],
  [/\b(drives?|driving|at the wheel)\b/i, 'drive'],
  [/\b(sits?|seated|sitting)\b/i, 'sit'],
  [/\b(points?|pointing)\b/i, 'point'],
  [/\b(reach|reaches|grabs?|takes?|lunges?)\b/i, 'reach'],
  [/\b(punch|punches|hits?|fights?|swings?|strikes?)\b/i, 'fight'],
  [/\b(waves?|waving)\b/i, 'wave'],
  [/\b(phone|calls?|dials?)\b/i, 'phone'],
  [/\b(arms crossed|crosses (his|her|their) arms)\b/i, 'arms-crossed'],
  [/\b(holds?|carries|carrying|pours?|drinks?|lifts?|opens?)\b/i, 'hold'],
  [/\b(walks?|walking|enters?|crosses|approach(es)?|exits?|leaves?|steps?)\b/i, 'walk'],
  [/\b(cheers?|celebrates?|hands up|arms up)\b/i, 'arms-up'],
];

function poseFromText(text, hasDialogue) {
  for (const [re, pose] of VERB_POSES) if (re.test(text)) return pose;
  return hasDialogue ? 'talk' : 'stand';
}

const ANGLE_HORIZON = {
  'EYE-LEVEL': 0.46,
  LOW: 0.8,
  HIGH: 0.24,
  DUTCH: 0.46,
  "BIRD'S-EYE": 0.06,
  "WORM'S-EYE": 0.93,
  'PROFILE-LEFT': 0.46,
  'PROFILE-RIGHT': 0.46,
  'OVER-THE-BLIND': 0.46,
};

function cameraArrows(movement) {
  switch (movement) {
    case 'PAN':
    case 'TRACKING':
    case 'STEADICAM':
      return [{ from: [0.3, 0.96], to: [0.7, 0.96], kind: 'camera' }];
    case 'WHIP-PAN':
      return [{ from: [0.15, 0.96], to: [0.85, 0.96], kind: 'camera' }];
    case 'TILT':
      return [{ from: [0.97, 0.7], to: [0.97, 0.3], kind: 'camera' }];
    case 'CRANE':
      return [{ from: [0.08, 0.9], to: [0.22, 0.55], kind: 'camera' }];
    case 'DOLLY-IN':
    case 'ZOOM':
      return [
        { from: [0.03, 0.05], to: [0.12, 0.17], kind: 'camera' },
        { from: [0.97, 0.05], to: [0.88, 0.17], kind: 'camera' },
        { from: [0.03, 0.95], to: [0.12, 0.83], kind: 'camera' },
        { from: [0.97, 0.95], to: [0.88, 0.83], kind: 'camera' },
      ];
    case 'DOLLY-OUT':
      return [
        { from: [0.12, 0.17], to: [0.03, 0.05], kind: 'camera' },
        { from: [0.88, 0.17], to: [0.97, 0.05], kind: 'camera' },
        { from: [0.12, 0.83], to: [0.03, 0.95], kind: 'camera' },
        { from: [0.88, 0.83], to: [0.97, 0.95], kind: 'camera' },
      ];
    default:
      return [];
  }
}

/* A readable first sketch from the panel's own fields — no model involved.
   `context.slug` (the scene heading) decides interior or exterior. */
export function autoSketchSpec(panel, context = {}) {
  const shot = VALID_SHOT_TYPES.includes(panel.shotType) ? panel.shotType : 'MEDIUM';
  const text = `${panel.action || ''}`;
  const cast = (Array.isArray(panel.cast) && panel.cast.length ? panel.cast : extractCast(text))
    .map(cleanName)
    .filter(Boolean);
  const pose = poseFromText(text, Boolean(panel.dialogue));
  const interior = /^\s*(INT|I\/E)\b/i.test(context.slug || '');
  const horizon = ANGLE_HORIZON[panel.angle] ?? 0.46;
  const moving = pose === 'run' || pose === 'walk';
  const spec = { horizon, tilt: panel.angle === 'DUTCH' ? 9 : 0, set: [], figures: [], arrows: [] };
  const name = (i) => cast[i] || '';

  const single = (framing, extra = {}) => ({
    name: name(0),
    x: 0.5,
    framing,
    depth: 0.3,
    facing: moving ? 'right' : 'front',
    pose,
    ...extra,
  });

  switch (shot) {
    case 'ESTABLISHING':
    case 'EXTREME WIDE':
      if (interior) {
        spec.set.push({ kind: 'room', x: 0.3, y: 0.22, w: 0.4, h: 0.42 });
      } else {
        spec.set.push(
          { kind: 'building', x: 0.06, y: horizon - 0.32, w: 0.16, h: 0.32 },
          { kind: 'building', x: 0.24, y: horizon - 0.22, w: 0.12, h: 0.22 },
          { kind: 'building', x: 0.7, y: horizon - 0.38, w: 0.18, h: 0.38 },
        );
      }
      if (cast.length || shot === 'EXTREME WIDE') {
        spec.figures.push(single('full', { x: 0.52, depth: 0.85 }));
      }
      break;
    case 'WIDE':
      if (interior) spec.set.push({ kind: 'room', x: 0.22, y: 0.16, w: 0.56, h: 0.5 });
      cast.slice(0, 3).forEach((_, i, all) => {
        spec.figures.push({
          name: name(i),
          x: all.length === 1 ? 0.5 : 0.32 + (0.36 * i) / Math.max(1, all.length - 1),
          framing: 'full',
          depth: 0.4,
          facing: all.length > 1 ? (i === 0 ? 'right' : 'left') : moving ? 'right' : 'front',
          pose: i === 0 ? pose : 'stand',
        });
      });
      if (!spec.figures.length) spec.figures.push(single('full', { depth: 0.4 }));
      break;
    case 'COWBOY':
      spec.figures.push(single('knee'));
      break;
    case 'MEDIUM':
      if (cast.length >= 2) {
        spec.figures.push(
          { name: name(0), x: 0.32, framing: 'waist', depth: 0, facing: 'right', pose },
          { name: name(1), x: 0.68, framing: 'waist', depth: 0, facing: 'left', pose: 'stand' },
        );
      } else {
        spec.figures.push(single('waist'));
      }
      break;
    case 'MEDIUM CLOSE-UP':
      spec.figures.push(single('chest', { facing: 'front' }));
      break;
    case 'CLOSE-UP':
    case 'REACTION SHOT':
      spec.figures.push(single('head', { facing: 'front', pose: 'stand' }));
      spec.horizon = null;
      break;
    case 'EXTREME CLOSE-UP':
      spec.figures.push(single('face', { facing: 'front', pose: 'stand', x: 0.5 }));
      spec.horizon = null;
      break;
    case 'INSERT':
      spec.set.push({ kind: 'table', x: 0.12, y: 0.62, w: 0.76, h: 0.4 });
      spec.set.push({ kind: 'box', x: 0.4, y: 0.42, w: 0.2, h: 0.2 });
      spec.horizon = null;
      break;
    case 'RACK FOCUS':
      spec.figures.push(
        { name: name(0), x: 0.28, framing: 'chest', depth: 0, facing: 'right', pose: 'stand' },
        { name: name(1), x: 0.72, framing: 'full', depth: 0.6, facing: 'left', pose },
      );
      break;
    case 'OTS':
      spec.figures.push(
        { name: name(1), x: 0.64, framing: 'waist', depth: 0, facing: 'front', pose },
        { name: name(0), x: 0.16, framing: 'chest', depth: 0, facing: 'back', pose: 'stand' },
      );
      break;
    case 'TWO-SHOT':
      spec.figures.push(
        { name: name(0), x: 0.33, framing: 'knee', depth: 0, facing: 'right', pose },
        { name: name(1), x: 0.67, framing: 'knee', depth: 0, facing: 'left', pose: 'stand' },
      );
      break;
    case 'GROUP SHOT': {
      const n = Math.max(3, Math.min(4, cast.length || 3));
      for (let i = 0; i < n; i++) {
        spec.figures.push({
          name: name(i),
          x: 0.2 + (0.6 * i) / (n - 1),
          framing: 'full',
          depth: i % 2 ? 0.45 : 0.3,
          facing: 'front',
          pose: i === 0 ? pose : 'stand',
        });
      }
      break;
    }
    case 'POV':
      // What the character sees: the subject at a distance, no observer.
      spec.figures.push(single('full', { name: name(1) || name(0), depth: 0.55, facing: 'front' }));
      if (interior) spec.set.push({ kind: 'room', x: 0.25, y: 0.18, w: 0.5, h: 0.46 });
      break;
    default:
      spec.figures.push(single('waist'));
  }

  if (moving && spec.figures[0] && spec.figures[0].framing === 'full') {
    const f = spec.figures[0];
    const groundY = horizon + (0.95 - horizon) * (1 - f.depth) * 0.9;
    spec.arrows.push({ from: [f.x + 0.06, groundY], to: [f.x + 0.2, groundY], kind: 'move' });
  }
  spec.arrows.push(...cameraArrows(panel.movement));
  return spec;
}

/* Model guidance: the exact vocabulary normalizeSketchSpec() accepts. */
export const SKETCH_SPEC_GUIDE = `Return ONLY a JSON object, no prose, no markdown fence:
{"horizon":0.45,"tilt":0,"set":[{"kind":"room","x":0.25,"y":0.2,"w":0.5,"h":0.45}],"figures":[{"name":"MAYA","x":0.4,"framing":"waist","depth":0,"facing":"right","pose":"talk"}],"arrows":[{"from":[0.3,0.9],"to":[0.6,0.9],"kind":"move"}]}

Coordinates are fractions of the frame: x 0 = left edge, 1 = right edge; y 0 = top, 1 = bottom.
- horizon: y of the horizon/eye line, or null when no ground or horizon is visible (close-ups, top-down). LOW angle puts it low (0.75-0.9), HIGH angle high (0.15-0.3), EYE-LEVEL around 0.45.
- tilt: degrees, only for DUTCH angles (about 8-15), else 0.
- set: up to 10 simple set pieces drawn as outlines behind the figures. kind is one of: ${SKETCH_SET_KINDS.join(', ')}. x,y is the top-left corner, w,h the size. "room" is an interior back wall with perspective lines to the corners. "road" draws converging edges to the horizon. Keep it sparse — 1 to 5 pieces that establish the space.
- figures: up to 5 stick figures. x is the figure's horizontal centre.
  framing is how much of the body the camera sees: full (whole body, size set by depth), knee, waist, chest, head, face. An EXTREME CLOSE-UP is "face", a CLOSE-UP "head", a MEDIUM CLOSE-UP "chest", a MEDIUM "waist", a COWBOY "knee", WIDE and wider "full".
  depth 0 = near camera (large), 1 = far away (tiny, standing on the horizon); only used for framing "full".
  facing: left, right, front (towards camera), back (away from camera — an over-the-shoulder foreground figure is framing "chest", facing "back", near the frame edge).
  pose: one of ${SKETCH_POSES.join(', ')}.
  name: the character's name in caps, or "" if unnamed.
- arrows: up to 4. kind "move" for a character's movement, "camera" for the camera move (pan/track along the bottom edge, tilt along the side, push-in as four short arrows from the corners pointing inward).
Compose like a storyboard artist: obey the shot type's framing, put the subject on a third unless the shot is symmetrical, and face characters toward whoever they are looking at.`;
