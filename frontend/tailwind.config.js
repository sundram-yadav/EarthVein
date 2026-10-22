/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0A1020', panel: '#101A30',
        ev: { blue: '#3F7CF0', orange: '#F28A33', green: '#35B982' },
      },
      fontFamily: { display: ['Outfit', 'system-ui', 'sans-serif'], sans: ['Geist', 'system-ui', 'sans-serif'], mono: ['Geist Mono', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
};
