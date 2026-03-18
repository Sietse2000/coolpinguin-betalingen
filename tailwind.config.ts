import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
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
