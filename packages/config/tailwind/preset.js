/**
 * Shared Tailwind preset for TurkistanIcons surfaces.
 *
 * apps/web currently runs Tailwind v4 (CSS-first `@theme`), so it does not
 * consume this preset directly today. It is kept as the single source of truth
 * for brand tokens so any Tailwind v3-style config (packages/ui, emails, etc.)
 * can `presets: [require('@turkistan/config/tailwind/preset')]`.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        // Central Asian palette: silk-road teal + atlas accents.
        brand: {
          DEFAULT: '#0e7490',
          50: '#ecfeff',
          100: '#cffafe',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          900: '#164e63',
        },
        atlas: {
          DEFAULT: '#b91c1c',
          gold: '#d4a017',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
};
