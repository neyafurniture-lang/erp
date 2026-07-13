/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        neya: {
          ink: '#0A0A0A',
          'ink-light': '#3D3D3D',
          orange: '#D86B30',
          'orange-dark': '#B85A28',
          muted: '#737373',
          border: '#E5E5E5',
          surface: '#FAFAFA',
          white: '#FFFFFF',
          success: '#16A34A',
          warning: '#CA8A04',
          error: '#DC2626',
          cream: '#FAFAFA',
          'cream-dark': '#F5F5F5',
          primary: '#0A0A0A',
          accent: '#D86B30',
        },
      },
      fontFamily: {
        heading: ['var(--font-geist)', 'Inter', 'system-ui', 'sans-serif'],
        body: ['var(--font-geist)', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',
        lg: '6px',
        xl: '8px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        DEFAULT: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
    },
  },
  plugins: [],
};
