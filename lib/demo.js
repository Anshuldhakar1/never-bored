/* "The Last Roof" — a demo board that exercises the studio end to end.
 *
 * Plain data only; actions.loadDemoBoard() turns it into a project, giving
 * every panel its instant stick-figure sketch. It deliberately covers:
 *   - two sequences, three scenes, slug lines and screenplay text per scene
 *     (so AI sketch / line art get scene context)
 *   - most shot types, angles, lenses and movements
 *   - camera moves: push-in, pull-out, pan and crane, with different easings
 *   - every transition, varied durations (a fast cut to a long hold)
 *   - extra layers: hand-drawn rain, a hidden alternate, a locked note layer
 *   - dialogue, action and production notes
 * Hand-drawn layer markup is authored here for a 1600x900 (16:9) frame and
 * still goes through the sanitiser when the board is built.
 */

const RAIN = Array.from({ length: 34 }, (_, i) => {
  const x = (i * 97) % 1600;
  const y = (i * 263) % 760;
  return `<path d="M${x} ${y} l-18 46" stroke="#2F5D8A" stroke-width="3" stroke-linecap="round" fill="none" opacity="0.7"/>`;
}).join('');

const ENVELOPE =
  '<rect x="610" y="330" width="380" height="240" fill="none" stroke="#1B1400" stroke-width="8" stroke-linejoin="round"/>' +
  '<path d="M610 330 L800 470 L990 330" fill="none" stroke="#1B1400" stroke-width="8" stroke-linejoin="round"/>' +
  '<path d="M655 520 h160 M655 545 h110" stroke="#5A5244" stroke-width="5" stroke-linecap="round"/>';

const TEAR = '<path d="M800 300 l-30 60 l40 50 l-35 60 l30 70 l-25 50" fill="none" stroke="#B23A2B" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>';

const ARROW_NOTE =
  '<path d="M1180 220 C1100 260 1050 320 1010 400" fill="none" stroke="#B23A2B" stroke-width="5" stroke-dasharray="14 10"/>' +
  '<path d="M1010 400 l8 -34 M1010 400 l30 -14" stroke="#B23A2B" stroke-width="5" stroke-linecap="round"/>';

const GREENHOUSE_SCRIPT = `INT. ROOFTOP GREENHOUSE — NIGHT

Rain hammers the glass. MAYA (30s) waters a dying lemon tree by torchlight. The door bangs open — JOEL (40s), soaked, holding an envelope.

JOEL
They sold the building.

Maya doesn't turn around. She keeps watering.

MAYA
I know. I signed it.

Joel crosses to her and grabs the watering can. Water spills across the floor between them.`;

const STAIRWELL_SCRIPT = `INT. STAIRWELL — CONTINUOUS

Maya runs down the spiral stairs, envelope in hand. Joel's footsteps echo above her.

JOEL (O.S.)
Maya! You can't undo it!

She stops on the landing, looks up through the gap in the rail — and tears the envelope in half.`;

const STREET_SCRIPT = `EXT. STREET — DAWN

The rain has stopped. Maya walks out of the building into an empty street, carrying the lemon tree in its pot. Joel watches from the doorway.

JOEL
Where will you put it?

MAYA
Somewhere with a roof that stays.

She keeps walking. The sun clears the rooftops.`;

const cam = (start, end, easing = 'ease-in-out') => ({ enabled: true, start, end, easing });

export const DEMO_PROJECT = {
  title: 'The Last Roof — demo board',
  aspect: '16:9',
  fps: 24,
  artStyle: 'storyboard',
  scene: GREENHOUSE_SCRIPT,
  sequences: [
    {
      name: 'Act One — The Sale',
      scenes: [
        {
          name: 'Greenhouse',
          slug: 'INT. ROOFTOP GREENHOUSE — NIGHT',
          scriptText: GREENHOUSE_SCRIPT,
          panels: [
            {
              shotType: 'ESTABLISHING',
              angle: "BIRD'S-EYE",
              lens: 'WIDE',
              movement: 'CRANE',
              transition: 'DISSOLVE',
              action: 'Rain lashes a glass greenhouse on a city rooftop; one torch glows inside where MAYA works.',
              notes: 'Crane down from above the skyline. Rain plate needed.',
              seconds: 5,
              camera: cam({ x: 0, y: 0, zoom: 1 }, { x: 0.22, y: 0.2, zoom: 0.55 }, 'ease-out'),
              extraLayers: [{ name: 'Rain (hand-drawn)', kind: 'art', svg: RAIN }],
            },
            {
              shotType: 'MEDIUM',
              angle: 'EYE-LEVEL',
              lens: 'NORMAL',
              movement: 'STATIC',
              transition: 'CUT',
              action: 'MAYA waters a dying lemon tree, her back to the door.',
              seconds: 3,
            },
            {
              shotType: 'WIDE',
              angle: 'LOW',
              lens: 'WIDE',
              movement: 'HANDHELD',
              transition: 'SMASH CUT',
              action: 'The door bangs open. JOEL stands in the frame, soaked, holding an envelope.',
              dialogue: 'They sold the building.',
              seconds: 2.5,
            },
            {
              shotType: 'OTS',
              angle: 'EYE-LEVEL',
              lens: 'TELEPHOTO',
              movement: 'STATIC',
              transition: 'CUT',
              action: "Over JOEL's shoulder: MAYA keeps watering, not turning round.",
              dialogue: 'I know. I signed it.',
              seconds: 3,
            },
            {
              shotType: 'CLOSE-UP',
              angle: 'EYE-LEVEL',
              lens: 'TELEPHOTO',
              movement: 'DOLLY-IN',
              transition: 'CUT',
              action: "JOEL's face as it lands. Rain runs down the glass behind him.",
              notes: 'Slow push. Hold on the silence.',
              seconds: 4,
              camera: cam({ x: 0, y: 0, zoom: 1 }, { x: 0.15, y: 0.12, zoom: 0.7 }),
            },
            {
              shotType: 'INSERT',
              angle: "BIRD'S-EYE",
              lens: 'MACRO',
              movement: 'STATIC',
              transition: 'CUT',
              action: 'The envelope hits the wet floor. Water spreads across the paper.',
              seconds: 1.5,
              extraLayers: [
                { name: 'Envelope', kind: 'art', svg: ENVELOPE },
                { name: 'Alt: torn envelope', kind: 'art', svg: TEAR, visible: false },
              ],
            },
            {
              shotType: 'TWO-SHOT',
              angle: 'DUTCH',
              lens: 'WIDE',
              movement: 'STATIC',
              transition: 'CUT',
              action: 'JOEL grabs the watering can from MAYA. Water spills between them.',
              seconds: 2,
            },
          ],
        },
        {
          name: 'Stairwell',
          slug: 'INT. STAIRWELL — CONTINUOUS',
          scriptText: STAIRWELL_SCRIPT,
          panels: [
            {
              shotType: 'EXTREME WIDE',
              angle: "WORM'S-EYE",
              lens: 'FISHEYE',
              movement: 'TILT',
              transition: 'CUT',
              action: 'Looking up the spiral stairwell: MAYA, tiny, running down.',
              seconds: 3,
              camera: cam({ x: 0, y: 0.3, zoom: 0.7 }, { x: 0, y: 0, zoom: 0.7 }, 'linear'),
            },
            {
              shotType: 'POV',
              angle: 'HIGH',
              lens: 'NORMAL',
              movement: 'STATIC',
              transition: 'CUT',
              action: "JOEL's POV down the rail gap: MAYA stops on the landing.",
              dialogue: "Maya! You can't undo it!",
              seconds: 2.5,
            },
            {
              shotType: 'EXTREME CLOSE-UP',
              angle: 'EYE-LEVEL',
              lens: 'MACRO',
              movement: 'STATIC',
              transition: 'FADE OUT',
              action: 'MAYA tears the envelope in half.',
              notes: 'Sound: paper tear, louder than real.',
              seconds: 1.5,
              extraLayers: [
                { name: 'Tear line', kind: 'art', svg: TEAR },
                { name: 'Director note (locked)', kind: 'art', svg: ARROW_NOTE, locked: true },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'Act Two — Morning',
      scenes: [
        {
          name: 'Street at dawn',
          slug: 'EXT. STREET — DAWN',
          scriptText: STREET_SCRIPT,
          panels: [
            {
              shotType: 'WIDE',
              angle: 'EYE-LEVEL',
              lens: 'ANAMORPHIC',
              movement: 'PAN',
              transition: 'FADE IN',
              action: 'An empty street after rain. MAYA steps out carrying the lemon tree in its pot.',
              seconds: 4,
              camera: cam({ x: 0, y: 0.1, zoom: 0.8 }, { x: 0.2, y: 0.1, zoom: 0.8 }),
            },
            {
              shotType: 'COWBOY',
              angle: 'EYE-LEVEL',
              lens: 'NORMAL',
              movement: 'STATIC',
              transition: 'CUT',
              action: 'JOEL in the doorway, watching her go.',
              dialogue: 'Where will you put it?',
              seconds: 2.5,
            },
            {
              shotType: 'MEDIUM CLOSE-UP',
              angle: 'PROFILE-LEFT',
              lens: 'TELEPHOTO',
              movement: 'TRACKING',
              transition: 'CUT',
              action: 'MAYA walks, the tree in her arms, a small smile.',
              dialogue: 'Somewhere with a roof that stays.',
              seconds: 3,
              camera: cam({ x: 0.1, y: 0.1, zoom: 0.75 }, { x: 0.15, y: 0.1, zoom: 0.75 }, 'linear'),
            },
            {
              shotType: 'REACTION SHOT',
              angle: 'EYE-LEVEL',
              lens: 'NORMAL',
              movement: 'STATIC',
              transition: 'CUT',
              action: 'JOEL almost laughs, then looks up at the roof.',
              seconds: 2,
            },
            {
              shotType: 'GROUP SHOT',
              angle: 'HIGH',
              lens: 'WIDE',
              movement: 'DOLLY-OUT',
              transition: 'WIPE',
              action: 'Early commuters part around MAYA and her tree as the sun clears the rooftops.',
              seconds: 4,
              camera: cam({ x: 0.2, y: 0.18, zoom: 0.6 }, { x: 0, y: 0, zoom: 1 }, 'ease-in'),
            },
            {
              shotType: 'EXTREME WIDE',
              angle: 'HIGH',
              lens: 'WIDE',
              movement: 'STEADICAM',
              transition: 'FADE OUT',
              action: 'The street, the city, one small green tree moving through it.',
              notes: 'Final hold — titles over.',
              seconds: 6,
            },
          ],
        },
      ],
    },
  ],
};
