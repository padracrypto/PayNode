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
const nextConfig = {};

export default nextConfig;
