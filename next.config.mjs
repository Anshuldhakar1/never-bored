import os from 'node:os';

/* Next 16 blocks dev-only resources (HMR, client chunks) for any host other
   than localhost. Opening the studio at this machine's network address — the
   "Network:" URL `next dev` prints — would otherwise leave it stuck on
   "Opening the studio…", since the studio is client-only. Only this machine's
   own interface addresses are allowed, and only in development. */
const ownAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((iface) => iface && !iface.internal)
  .map((iface) => iface.address);

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ownAddresses,
  // The studio drives a few imperative singletons (the SVG stage, playback,
  // the shared-board session). Strict mode's double-mount in development would
  // start each of them twice, so it stays off.
  reactStrictMode: false,
  poweredByHeader: false,
  serverExternalPackages: ['@anthropic-ai/sdk', '@google/genai', '@netlify/blobs', '@upstash/redis'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
