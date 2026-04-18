/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Bowlby One SC"', '"Instrument Serif"', 'serif'],
        display: ['"Bowlby One SC"', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          DEFAULT: '#0F1B2D',
          900: '#0B1524',
          700: '#1A2332',
          500: '#3A4556',
          400: '#5C6777',
          300: '#8B94A3',
        },
        cream: {
          DEFAULT: '#F8F5F0',
          100: '#FBF9F5',
          200: '#F1ECE3',
          300: '#E6DFD2',
        },
        teal: { DEFAULT: '#00A88A', bright: '#00C9A7', dim: '#E6F7F3' },
        amber: { DEFAULT: '#B8770B', soft: '#F6EBD3' },
        rose: { DEFAULT: '#B03A2E', soft: '#F6DDD9' },
        leaf: { DEFAULT: '#0E7C5A', soft: '#DCEEE6' },
      },
      boxShadow: {
        card: '0 1px 0 rgba(15,27,45,0.04), 0 2px 12px rgba(15,27,45,0.04)',
        pop: '0 8px 32px rgba(15,27,45,0.08)',
      },
    },
  },
  plugins: [],
};
