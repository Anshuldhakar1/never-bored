/* The hero illustration: three storyboard panels as stick figures, drawn as
   static SVG in the same ink-on-paper language the studio uses. */

const INK = '#1B1400';
const PAPER = '#DCD6C4';
const SET = '#5A5244';

function Figure({ x, y, s = 1, arm = 'down', lean = 0 }) {
  const head = 9 * s;
  const body = 34 * s;
  const leg = 30 * s;
  const arms = {
    down: `M${x},${y + head * 2 + 6 * s} l${-12 * s},${20 * s} M${x},${y + head * 2 + 6 * s} l${12 * s},${20 * s}`,
    point: `M${x},${y + head * 2 + 6 * s} l${-12 * s},${20 * s} M${x},${y + head * 2 + 6 * s} l${26 * s},${-6 * s}`,
    up: `M${x},${y + head * 2 + 6 * s} l${-14 * s},${-16 * s} M${x},${y + head * 2 + 6 * s} l${14 * s},${-16 * s}`,
  }[arm];
  return (
    <g stroke={INK} strokeWidth={3 * s} strokeLinecap="round" fill="none" transform={`rotate(${lean} ${x} ${y + body})`}>
      <circle cx={x} cy={y + head} r={head} fill={PAPER} />
      <path d={`M${x},${y + head * 2} v${body}`} />
      <path d={arms} />
      <path d={`M${x},${y + head * 2 + body} l${-10 * s},${leg} M${x},${y + head * 2 + body} l${10 * s},${leg}`} />
    </g>
  );
}

function Panel({ n, shot, children, cam }) {
  return (
    <figure className="heroPanel">
      <svg viewBox="0 0 320 180" role="img" aria-label={`Panel ${n}: ${shot}`}>
        <rect width="320" height="180" fill={PAPER} />
        {children}
        {cam ? (
          <>
            <rect x="8" y="8" width="304" height="164" fill="none" stroke="#4E9B9B" strokeWidth="2.5" />
            <rect x="70" y="34" width="190" height="107" fill="none" stroke="#E8A33D" strokeWidth="2.5" strokeDasharray="10 7" />
          </>
        ) : null}
      </svg>
      <figcaption>
        <strong>{n}</strong> {shot}
      </figcaption>
    </figure>
  );
}

export default function HeroBoard() {
  return (
    <div className="heroBoard" aria-label="A storyboard drawn in Never Bored">
      <Panel n={1} shot="WIDE · ESTABLISHING">
        <path d="M0 132 H320" stroke={SET} strokeWidth="2" />
        <path d="M24 132 V58 H112 V132 M38 74 H98 V102 H38 Z" stroke={SET} strokeWidth="2" fill="none" />
        <path d="M250 132 V70 M228 132 c0,-50 44,-50 44,0" stroke={SET} strokeWidth="2" fill="none" />
        <Figure x={168} y={70} s={0.95} />
        <Figure x={200} y={72} s={0.9} arm="point" />
      </Panel>
      <Panel n={2} shot="OTS · DOLLY-IN" cam>
        <path d="M0 150 H320" stroke={SET} strokeWidth="2" />
        <ellipse cx="44" cy="150" rx="70" ry="88" fill={INK} opacity="0.82" />
        <Figure x={196} y={34} s={1.5} arm="up" />
      </Panel>
      <Panel n={3} shot="CLOSE-UP · LOW">
        <circle cx="160" cy="98" r="58" fill={PAPER} stroke={INK} strokeWidth="4" />
        <path d="M136 90 h10 M174 90 h10" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <path d="M142 124 q18 -10 36 0" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M102 172 q58 -30 116 0" stroke={INK} strokeWidth="4" fill="none" />
      </Panel>
    </div>
  );
}
