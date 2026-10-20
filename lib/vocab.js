/* The shot language the whole app speaks, plus the framing iconography.
 *
 * SHOT_ICONS is still declared exactly once, as a list of primitive draw ops
 * per shot type. It now feeds two renderers instead of three — the old Canvas
 * 2D renderer went away when drawing became vector, so the sketch surface and
 * the stage are the same SVG pipeline. The constraint that made the op list
 * worth having is unchanged: jsPDF's API offers only line / circle / rect /
 * triangle / ellipse plus dash patterns (there is no pdf.arc(), and calling it
 * throws and takes the whole export with it), so every op has to be
 * expressible in those terms or it cannot appear in an exported PDF at all.
 *
 * Add a shot type by adding ops here. Hand-writing a shape into one renderer
 * desyncs it from the other silently.
 */

export const VALID_SHOT_TYPES = [
  'ESTABLISHING',
  'EXTREME WIDE',
  'WIDE',
  'COWBOY',
  'MEDIUM',
  'MEDIUM CLOSE-UP',
  'CLOSE-UP',
  'EXTREME CLOSE-UP',
  'INSERT',
  'RACK FOCUS',
  'OTS',
  'TWO-SHOT',
  'GROUP SHOT',
  'POV',
  'REACTION SHOT',
];

export const VALID_ANGLES = [
  'EYE-LEVEL',
  'LOW',
  'HIGH',
  'DUTCH',
  "BIRD'S-EYE",
  "WORM'S-EYE",
  'PROFILE-LEFT',
  'PROFILE-RIGHT',
  'OVER-THE-BLIND',
];

export const VALID_LENSES = [
  'FISHEYE',
  'WIDE',
  'NORMAL',
  'TELEPHOTO',
  'MACRO',
  'ANAMORPHIC',
  'TILT-SHIFT',
];

export const VALID_MOVEMENTS = [
  'STATIC',
  'TRACKING',
  'PAN',
  'TILT',
  'DOLLY-IN',
  'DOLLY-OUT',
  'CRANE',
  'HANDHELD',
  'STEADICAM',
  'WHIP-PAN',
  'ZOOM',
];

export const TRANSITIONS = ['CUT', 'DISSOLVE', 'FADE IN', 'FADE OUT', 'WIPE', 'SMASH CUT'];

/* Movements that imply the camera actually travels during the panel. The
   inspector offers a camera move on these and hides it on the rest, so a
   STATIC panel can't quietly carry a pan nobody asked for. */
export const MOVING_SHOTS = new Set([
  'TRACKING',
  'PAN',
  'TILT',
  'DOLLY-IN',
  'DOLLY-OUT',
  'CRANE',
  'WHIP-PAN',
  'ZOOM',
  'STEADICAM',
]);

export const ASPECT_RATIOS = [
  { key: '16:9', label: '16:9 — HD / digital', w: 1600, h: 900 },
  { key: '2.39:1', label: '2.39:1 — anamorphic scope', w: 1912, h: 800 },
  { key: '1.85:1', label: '1.85:1 — theatrical flat', w: 1665, h: 900 },
  { key: '4:3', label: '4:3 — academy', w: 1200, h: 900 },
  { key: '1:1', label: '1:1 — square', w: 1000, h: 1000 },
  { key: '9:16', label: '9:16 — vertical', w: 900, h: 1600 },
];

export const COVERAGE_STYLES = [
  {
    key: 'classic',
    name: 'Classic Coverage',
    desc: 'Wide, medium, close-up, OTS, cowboy, two-shot — the reliable dialogue-scene backbone with full lens and movement coverage.',
  },
  {
    key: 'minimal',
    name: 'Minimalist',
    desc: 'Two or three carefully chosen shots. Trusts the actors and the cut. Each frame does double duty.',
  },
  {
    key: 'dynamic',
    name: 'Dynamic',
    desc: 'Heavy inserts, rack focus, tracking, handheld, crane work, and unconventional angles. Camera is an active participant.',
  },
];

/* Art direction presets for generated panel art. These steer the model's line
   work only — they never change the shot grammar above. */
export const ART_STYLES = [
  {
    key: 'storyboard',
    name: 'Storyboard pencil',
    desc: 'Loose grey construction lines under confident black contour. Gestural, unfinished, like a working board.',
  },
  {
    key: 'clean',
    name: 'Clean line',
    desc: 'Even-weight black contour, no shading, generous white space. Reads instantly at thumbnail size.',
  },
  {
    key: 'noir',
    name: 'High contrast',
    desc: 'Heavy black shapes against paper, hard-edged shadows, minimal mid-tone. Strong silhouette reading.',
  },
  {
    key: 'blueprint',
    name: 'Technical',
    desc: 'Thin uniform lines, visible construction geometry, blocking marks and eyelines called out.',
  },
];

/* Looks for a rendered (raster) frame. The vector sketch always fixes the
   layout; these only describe how the finished image is painted. */
export const RASTER_STYLES = [
  {
    key: 'pencil',
    name: 'Pencil storyboard',
    desc: 'a finished storyboard frame in graphite pencil with soft tonal shading, greyscale, on off-white paper',
  },
  {
    key: 'ink',
    name: 'Ink and wash',
    desc: 'a storyboard frame in bold black ink lines with grey ink-wash shadows',
  },
  {
    key: 'cinematic',
    name: 'Cinematic colour',
    desc: 'a painterly cinematic colour frame with dramatic film lighting, like a concept-art keyframe',
  },
  {
    key: 'comic',
    name: 'Comic panel',
    desc: 'a clean comic-book panel with confident inks and flat colours',
  },
];

export const INK = '#1B1400';
export const PAPER = '#DCD6C4';
const GREY = '#968f80'; // flat stand-in for a partially-transparent ink fill

/* The icon grid every op below is authored against. */
export const ICON_W = 100;
export const ICON_H = 60;

export const SHOT_ICONS = {
  ESTABLISHING: [
    { op: 'rect', x: 2, y: 40, w: 96, h: 16, alpha: 0.2 },
    { op: 'circle', cx: 15, cy: 16, r: 5, alpha: 0.4 },
    { op: 'rect', x: 40, y: 32, w: 6, h: 8 },
    { op: 'rect', x: 56, y: 28, w: 4, h: 12 },
    { op: 'rect', x: 62, y: 34, w: 4, h: 6 },
  ],
  'EXTREME WIDE': [
    { op: 'line', x1: 2, y1: 44, x2: 98, y2: 44 },
    { op: 'circle', cx: 50, cy: 38, r: 2 },
    { op: 'rect', x: 48, y: 36, w: 4, h: 6 },
  ],
  WIDE: [
    { op: 'line', x1: 2, y1: 46, x2: 98, y2: 46 },
    { op: 'circle', cx: 50, cy: 38, r: 4 },
    { op: 'rect', x: 46, y: 42, w: 8, h: 10 },
  ],
  COWBOY: [
    { op: 'circle', cx: 50, cy: 18, r: 7 },
    { op: 'rect', x: 38, y: 26, w: 24, h: 20 },
    { op: 'rect', x: 38, y: 46, w: 10, h: 10 },
    { op: 'rect', x: 52, y: 46, w: 10, h: 10 },
  ],
  MEDIUM: [
    { op: 'circle', cx: 50, cy: 24, r: 9 },
    { op: 'rect', x: 34, y: 34, w: 32, h: 24 },
  ],
  'MEDIUM CLOSE-UP': [
    { op: 'circle', cx: 50, cy: 24, r: 12 },
    { op: 'rect', x: 34, y: 36, w: 32, h: 22 },
  ],
  'CLOSE-UP': [{ op: 'circle', cx: 50, cy: 32, r: 20 }],
  'EXTREME CLOSE-UP': [
    { op: 'circle', cx: 50, cy: 30, r: 26, alpha: 0.85 },
    { op: 'circle', cx: 50, cy: 28, r: 6, color: PAPER },
    { op: 'circle', cx: 50, cy: 28, r: 3 },
  ],
  INSERT: [{ op: 'rectStroke', x: 35, y: 18, w: 30, h: 24 }],
  'RACK FOCUS': [
    { op: 'circle', cx: 30, cy: 30, r: 12, alpha: 0.3 },
    { op: 'circle', cx: 70, cy: 30, r: 12, alpha: 0.8 },
    { op: 'dashedLine', x1: 42, y1: 30, x2: 58, y2: 30 },
  ],
  OTS: [
    { op: 'triangle', x1: 2, y1: 58, x2: 28, y2: 30, x3: 2, y3: 10, alpha: 0.75 },
    { op: 'circle', cx: 66, cy: 26, r: 9 },
    { op: 'rect', x: 52, y: 36, w: 28, h: 22 },
  ],
  'TWO-SHOT': [
    { op: 'circle', cx: 32, cy: 26, r: 8 },
    { op: 'rect', x: 20, y: 34, w: 24, h: 20 },
    { op: 'circle', cx: 68, cy: 26, r: 8 },
    { op: 'rect', x: 56, y: 34, w: 24, h: 20 },
  ],
  'GROUP SHOT': [
    { op: 'circle', cx: 25, cy: 26, r: 6 },
    { op: 'rect', x: 15, y: 32, w: 20, h: 16 },
    { op: 'circle', cx: 50, cy: 24, r: 7 },
    { op: 'rect', x: 38, y: 32, w: 24, h: 18 },
    { op: 'circle', cx: 75, cy: 26, r: 6 },
    { op: 'rect', x: 65, y: 32, w: 20, h: 16 },
  ],
  POV: [
    {
      op: 'dashedPolygon',
      points: [
        [10, 10],
        [50, 5],
        [90, 10],
        [50, 55],
      ],
    },
    { op: 'circle', cx: 50, cy: 30, r: 8 },
    { op: 'line', x1: 36, y1: 20, x2: 36, y2: 40 },
    { op: 'line', x1: 64, y1: 20, x2: 64, y2: 40 },
  ],
  'REACTION SHOT': [
    { op: 'circle', cx: 50, cy: 28, r: 16 },
    { op: 'circle', cx: 43, cy: 24, r: 2, color: PAPER },
    { op: 'circle', cx: 57, cy: 24, r: 2, color: PAPER },
    { op: 'rect', x: 44, y: 34, w: 12, h: 3, color: PAPER },
  ],
};

/* alpha <= 0.5 reads as a lighter/softer element (out of focus, distant, dim).
   PDF has no alpha compositing, so it is approximated as flat grey; above that
   threshold it is approximated as solid ink. */
function pdfToneFor(op) {
  if (op.color) return op.color;
  if (op.alpha != null && op.alpha <= 0.5) return GREY;
  return INK;
}

/* Renderer 1 of 2 — SVG markup. Trusted output built from our own op list, so
   this is the one place in the app that composes SVG by string concatenation
   rather than going through svgsafe. */
export function shotIconMarkup(type) {
  return (SHOT_ICONS[type] || [])
    .map((op) => {
      const color = op.color || INK;
      const opacity = op.alpha != null && op.alpha < 1 ? ` opacity="${op.alpha}"` : '';
      switch (op.op) {
        case 'line':
          return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${INK}" stroke-width="1"/>`;
        case 'dashedLine':
          return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${INK}" stroke-width="1.2" stroke-dasharray="4,3"/>`;
        case 'circle':
          return `<circle cx="${op.cx}" cy="${op.cy}" r="${op.r}" fill="${color}"${opacity}/>`;
        case 'rect':
          return `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="${color}"${opacity}/>`;
        case 'rectStroke':
          return `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="none" stroke="${INK}" stroke-width="3"/>`;
        case 'triangle':
          return `<path d="M${op.x1},${op.y1} L${op.x2},${op.y2} L${op.x3},${op.y3} Z" fill="${INK}" opacity="${op.alpha}"/>`;
        case 'dashedPolygon': {
          const d =
            op.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
          return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="4,3"/>`;
        }
        default:
          return '';
      }
    })
    .join('');
}

/* A standalone icon for chips and list rows. */
export function shotIconSvg(type, extraClass = '') {
  return `<svg class="shotIcon ${extraClass}" viewBox="0 0 ${ICON_W} ${ICON_H}" aria-hidden="true"><rect x="2" y="2" width="96" height="56" fill="none" stroke="${INK}" stroke-width="2"/>${shotIconMarkup(type)}</svg>`;
}

/* The same icon scaled to fill a panel of arbitrary size, used as the
   placeholder artwork on a panel nobody has drawn or generated yet. */
export function shotIconLayerMarkup(type, panelW, panelH) {
  const scale = Math.min(panelW / ICON_W, panelH / ICON_H);
  const dx = (panelW - ICON_W * scale) / 2;
  const dy = (panelH - ICON_H * scale) / 2;
  return `<g transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(4)})" opacity="0.5">${shotIconMarkup(type)}</g>`;
}

/* Renderer 2 of 2 — jsPDF's own vector calls. jsPDF cannot read the page's SVG
   elements, so the export redraws from the op list directly. */
export function drawShotIconPdf(pdf, type, fx, fy, fw, fh) {
  const sx = fw / ICON_W;
  const sy = fh / ICON_H;
  const X = (v) => fx + v * sx;
  const Y = (v) => fy + v * sy;
  const rMin = Math.min(sx, sy);
  const setInkStroke = () => {
    pdf.setDrawColor(27, 20, 0);
    pdf.setLineWidth(0.7);
  };
  const setFillHex = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    pdf.setFillColor((n >> 16) & 255, (n >> 8) & 255, n & 255);
  };
  setInkStroke();
  (SHOT_ICONS[type] || []).forEach((op) => {
    switch (op.op) {
      case 'line':
        setInkStroke();
        pdf.line(X(op.x1), Y(op.y1), X(op.x2), Y(op.y2));
        break;
      case 'dashedLine':
        setInkStroke();
        pdf.setLineDashPattern([2, 1.5], 0);
        pdf.line(X(op.x1), Y(op.y1), X(op.x2), Y(op.y2));
        pdf.setLineDashPattern([], 0);
        break;
      case 'circle':
        setFillHex(pdfToneFor(op));
        pdf.circle(X(op.cx), Y(op.cy), op.r * rMin, 'F');
        break;
      case 'rect':
        setFillHex(pdfToneFor(op));
        pdf.rect(X(op.x), Y(op.y), op.w * sx, op.h * sy, 'F');
        break;
      case 'rectStroke':
        setInkStroke();
        pdf.setLineWidth(1.3);
        pdf.rect(X(op.x), Y(op.y), op.w * sx, op.h * sy, 'S');
        break;
      case 'triangle':
        // Pre-blends the 0.75 opacity into flat grey; jsPDF fills have no alpha.
        pdf.setFillColor(150, 144, 128);
        pdf.triangle(X(op.x1), Y(op.y1), X(op.x2), Y(op.y2), X(op.x3), Y(op.y3), 'F');
        break;
      case 'dashedPolygon':
        setInkStroke();
        pdf.setLineDashPattern([2, 1.5], 0);
        for (let i = 0; i < op.points.length; i++) {
          const [x1, y1] = op.points[i];
          const [x2, y2] = op.points[(i + 1) % op.points.length];
          pdf.line(X(x1), Y(y1), X(x2), Y(y2));
        }
        pdf.setLineDashPattern([], 0);
        break;
    }
  });
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
