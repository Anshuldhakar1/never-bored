import Link from 'next/link';
import {
  ScrollText,
  PenTool,
  Image as ImageIcon,
  Users,
  Video,
  FileText,
  Clapperboard,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Logo from '@/components/brand/Logo';
import HeroBoard from '@/components/landing/HeroBoard';
import HomeActions from '@/components/landing/HomeActions';

const FEATURES = [
  {
    icon: ScrollText,
    title: 'Board a whole screenplay',
    body: 'Drop in a PDF or Final Draft .fdx. It is read in your browser — headings, action, characters, dialogue — and you choose the scenes. Quick board is instant; AI coverage breaks each scene into shots.',
  },
  {
    icon: Sparkles,
    title: 'Every panel starts as a sketch',
    body: 'Stick figures blocked from the shot type, angle and action: who stands where, which way they face, a pose that matches the verb. Free and instant, no model involved.',
  },
  {
    icon: PenTool,
    title: 'Real vector, all the way',
    body: 'Brush, line, shapes, eraser and select. Sketches, AI line art and your own marks are editable SVG on layers you control — draw over, erase, export as true geometry.',
  },
  {
    icon: ImageIcon,
    title: 'Render a finished frame',
    body: 'Once a panel has vector art, paint it as pencil, ink and wash, cinematic colour or comic — on its own layer. Hide it to get back to the vector.',
  },
  {
    icon: Video,
    title: 'Camera moves & animatics',
    body: 'Drag START and END frames over a panel, pick an easing, press Space. The timeline is proportional to real durations — trim a panel by dragging its edge.',
  },
  {
    icon: Users,
    title: 'Review with your team',
    body: 'One edit link for the team — one editor at a time, everyone else follows live. One review link for clients: notes on panels, approve or ask for changes.',
  },
];

const STEPS = [
  { n: '01', title: 'Paste a scene or drop a script', body: 'Or import photos of an existing board, or start blank.' },
  { n: '02', title: 'Refine panel by panel', body: 'Change the shot, sketch with AI, draw over it, plan the camera.' },
  { n: '03', title: 'Share it, then ship it', body: 'Get notes and approvals live, then export a PDF, SVG or project file.' },
];

export default function Home() {
  return (
    <div className="landing">
      <header className="landingNav">
        <Logo size={30} />
        <nav aria-label="Main">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <Link href="/studio" className="btn btn-outline small">
            Open the studio
          </Link>
        </nav>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">
            <Clapperboard size={14} aria-hidden="true" /> Storyboarding workspace · beta
          </p>
          <h1>
            No more <span className="hl">boarding</span> around.
          </h1>
          <p className="heroLede">
            Paste a scene or drop in a whole screenplay. Never Bored boards it as panels on a timeline — stick-figure
            sketches first, AI line art and rendered frames when you want them, review with your team, and export to PDF
            or SVG.
          </p>
          <HomeActions />
          <p className="heroFine">Runs in your browser. Works without an API key — only the AI buttons need one.</p>
          <HeroBoard />
        </section>

        <section id="features" className="featureSection">
          <h2>Everything a board needs, nothing it doesn’t</h2>
          <div className="featureGrid">
            {FEATURES.map((f) => (
              <article key={f.title} className="featureCard">
                <f.icon size={22} aria-hidden="true" className="featureIcon" />
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="stepsSection">
          <h2>From page to panels in three steps</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="stepNum">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="privacy" className="privacySection">
          <ShieldCheck size={28} aria-hidden="true" />
          <div>
            <h2>Confidential material stays yours</h2>
            <p>
              Screenplays are parsed in your browser. Generated artwork is sanitised before it ever touches the page. Run
              it locally against your own model and nothing leaves the machine. Your API key, if you add one, never goes
              into a board, an export or a share link.
            </p>
          </div>
          <Link href="/studio" className="btn btn-amber">
            <FileText size={16} aria-hidden="true" /> Open the studio
          </Link>
        </section>
      </main>

      <footer className="landingFoot">
        <Logo size={22} />
        <span>Placeholder logo · MIT licensed</span>
      </footer>
    </div>
  );
}
