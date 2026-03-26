import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'bus-arrive': {
          '0%':   { transform: 'translateY(-16px)', opacity: '0' },
          '60%':  { transform: 'translateY(3px)',   opacity: '1' },
          '100%': { transform: 'translateY(0)',      opacity: '1' },
        },
      },
      animation: {
        'bus-arrive': 'bus-arrive 0.45s ease-out',
      },
      fontFamily: {
        sans: ['var(--font-ubuntu)', 'Ubuntu', 'sans-serif'],
      },
      colors: {
        cp: {
          blue: '#2c80b3',
          dark: '#083046',
          green: '#01b902',
          'blue-dark': '#236994',
          'blue-light': '#e8f3fa',
          'dark-light': '#0d4060',
        },
      },
    },
  },
  plugins: [],
}

export default config
