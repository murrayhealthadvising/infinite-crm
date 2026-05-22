/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Sharp UI — every rounded-* utility resolves to a 2px hair of radius, so
      // the whole app reads crisp. Elements that opt out with an arbitrary value
      // (Call buttons rounded-[8px], stage pills rounded-[9999px]) keep their
      // own radius, since arbitrary values bypass this scale.
      borderRadius: {
        none: '0px', sm: '2px', DEFAULT: '2px', md: '2px',
        lg: '2px', xl: '2px', '2xl': '2px', '3xl': '2px', full: '2px',
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        bg: '#080B0F',
        surface: '#0E1318',
        border: '#1A2130',
        muted: '#2A3547',
        accent: '#00E5C3',
        'accent-dim': '#00E5C320',
        blue: '#3B82F6',
        gold: '#F59E0B',
        red: '#EF4444',
        green: '#10B981',
        purple: '#8B5CF6',
        orange: '#F97316',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease',
        'slide-up': 'slideUp 0.3s ease',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
