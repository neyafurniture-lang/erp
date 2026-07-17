/** @type {import('tailwindcss').Config} */
/**
 * Design tokens alignés sur NEYA Craft Flow (Lovable)
 * Source : https://neya-craft-flow.lovable.app
 * Repo GitHub privé : neyafurniture-lang/neya-craft-flow
 */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        neya: {
          ink: '#0D0B09',
          'ink-light': '#353230',
          orange: '#D86B30',
          'orange-dark': '#B85A28',
          'orange-soft': '#FFEEE3',
          muted: '#666260',
          border: '#E6E4E2',
          'border-strong': '#D0CDCB',
          surface: '#FBFAF9',
          white: '#FFFFFF',
          success: '#349D62',
          warning: '#EBA941',
          error: '#E62C2C',
          cream: '#FBFAF9',
          'cream-dark': '#F3F1EF',
          primary: '#0D0B09',
          accent: '#D86B30',
        },
      },
      fontFamily: {
        heading: ['var(--font-display)', 'Urbanist', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Urbanist', 'system-ui', 'sans-serif'],
        body: ['var(--font-sans)', 'Epilogue', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'Epilogue', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.75rem',
        sm: '0.5rem',
        md: '0.625rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        DEFAULT: '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -1px rgb(0 0 0 / 0.04)',
        md: '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -1px rgb(0 0 0 / 0.04)',
        lg: '0 12px 32px -8px rgb(0 0 0 / 0.12), 0 4px 8px -2px rgb(0 0 0 / 0.06)',
        orange: '0 8px 24px -8px rgb(216 107 48 / 0.35)',
      },
    },
  },
  plugins: [],
};
