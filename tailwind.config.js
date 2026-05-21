/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // Enable dark mode with class strategy
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--portal-font-sans, var(--font-inter))',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        /** Driven by business portal theme via --color-primary-* on :root (fallbacks = default teal). */
        primary: {
          50: 'var(--color-primary-50, #ecfdf5)',
          100: 'var(--color-primary-100, #ccfbf1)',
          200: 'var(--color-primary-200, #99f6e4)',
          300: 'var(--color-primary-300, #5eead4)',
          400: 'var(--color-primary-400, #2dd4bf)',
          500: 'var(--color-primary-500, #0d9488)',
          600: 'var(--color-primary-600, #115e59)',
          700: 'var(--color-primary-700, #0f4f4a)',
          800: 'var(--color-primary-800, #0f3d39)',
          900: 'var(--color-primary-900, #052e2b)',
        },
        /** Driven by org portal theme via --color-accent-* (fallbacks = legacy product accent). */
        accent: {
          50: 'var(--color-accent-50, #E0F2F1)',
          100: 'var(--color-accent-100, #B2DFDB)',
          200: 'var(--color-accent-200, #80CBC4)',
          300: 'var(--color-accent-300, #4DB6AC)',
          400: 'var(--color-accent-400, #26A69A)',
          500: 'var(--color-accent-500, #00897B)',
          600: 'var(--color-accent-600, #00796B)',
          700: 'var(--color-accent-700, #00695C)',
          800: 'var(--color-accent-800, #004D40)',
          900: 'var(--color-accent-900, #003D32)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          dark: '#1E293B',
        },
        background: {
          DEFAULT: 'var(--color-background)',
          dark: '#0F172A',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          'primary-dark': '#F8FAFC',
          'secondary-dark': '#CBD5E1',
          'muted-dark': '#94A3B8',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          dark: '#334155',
        },
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        info: '#3B82F6',
      },
      borderRadius: {
        'card': '12px',
        'button': '8px',
        'input': '8px',
      },
      boxShadow: {
        'small': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'medium': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'large': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--text-xs-lh)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--text-sm-lh)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--text-base-lh)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--text-lg-lh)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--text-xl-lh)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--text-2xl-lh)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--text-3xl-lh)' }],
      },
      spacing: {
        'page-x': 'var(--space-page-x)',
        'page-y': 'var(--space-page-y)',
        'page-y-compact': 'var(--space-page-y-compact)',
        'stack-page': 'var(--space-stack-page)',
        'stack-section': 'var(--space-stack-section)',
        'stack-tight': 'var(--space-stack-tight)',
        'card-sm': 'var(--space-card-sm)',
        'card-md': 'var(--space-card-md)',
        'card-lg': 'var(--space-card-lg)',
        'card-xl': 'var(--space-card-xl)',
        'input-x': 'var(--space-input-x)',
        'input-y': 'var(--space-input-y)',
      },
      gap: {
        'stack-page': 'var(--space-stack-page)',
        'stack-section': 'var(--space-stack-section)',
        'stack-tight': 'var(--space-stack-tight)',
      },
    },
  },
  plugins: [],
}

