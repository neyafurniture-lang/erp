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
        DEFAULT: '1rem',
        sm: '0.625rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(13 11 9 / 0.04), 0 1px 3px 0 rgb(13 11 9 / 0.06)',
        DEFAULT: '0 1px 2px rgb(13 11 9 / 0.04), 0 8px 24px -12px rgb(13 11 9 / 0.1)',
        md: '0 2px 4px rgb(13 11 9 / 0.04), 0 16px 40px -16px rgb(13 11 9 / 0.14)',
        lg: '0 12px 32px -8px rgb(13 11 9 / 0.12), 0 4px 8px -2px rgb(13 11 9 / 0.06)',
        orange: '0 8px 24px -8px rgb(216 107 48 / 0.35)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.2, 0.64, 1)',
      },
      keyframes: {
        'neya-enter-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'neya-enter': 'neya-enter-up 380ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
