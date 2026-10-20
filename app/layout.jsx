import { Bebas_Neue, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const display = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
const sans = IBM_Plex_Sans({ weight: ['400', '500', '600', '700'], subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'Never Bored — No more boarding around',
  description:
    'A storyboarding workspace: board a whole screenplay, stick-figure sketches and AI line art as editable vector, rendered images, team review, camera moves, and PDF or SVG export.',
};

export const viewport = {
  themeColor: '#14171c',
  colorScheme: 'dark',
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: browser extensions (Grammarly, password
    // managers, etc.) add attributes to <html>/<body> before React hydrates.
    // It only covers these two elements' own attributes — mismatches anywhere
    // deeper in the page are still reported.
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
