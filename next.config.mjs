import { checkEnv } from './scripts/check-env.mjs';

// Stop a production deploy that is missing (or has malformed) environment variables, instead
// of shipping a build with values silently baked in wrong. VERCEL_ENV is set by Vercel;
// PAYNODE_STRICT_ENV=1 forces the same check for a local `next build`.
if (process.env.VERCEL_ENV === 'production' || process.env.PAYNODE_STRICT_ENV === '1') {
  const { errors, warnings } = checkEnv(process.env);
  for (const w of warnings) console.warn(`[paynode env] warn: ${w}`);
  if (errors.length) {
    throw new Error(
      `[paynode env] Refusing to build for production:\n  - ${errors.join('\n  - ')}\n` +
        'Fix these in Vercel > Project > Settings > Environment Variables, then redeploy.',
    );
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Clients that request /favicon.ico directly (rather than reading the
      // <link rel="icon"> tag) would otherwise fall through to app/[username]
      // and get an HTML profile page. Send them to the real icon instead.
      { source: '/favicon.ico', destination: '/icon.svg', permanent: false },
    ];
  },
};

export default nextConfig;
