/**
 * CommonJS, not .mjs.
 *
 * Next 14's postcss loader imports this config via the ESM loader, which on Windows
 * rejects a bare `c:\...` path with ERR_UNSUPPORTED_ESM_URL_SCHEME and fails the whole
 * build while processing node_modules CSS (e.g. RainbowKit's stylesheet). package.json
 * has no "type": "module", so a plain .js file is CJS and loads via require() instead.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
