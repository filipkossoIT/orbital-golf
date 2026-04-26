import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: ['"SF Mono"', 'ui-monospace', '"Cascadia Code"', 'Menlo', 'monospace'],
      },
      colors: {
        space: {
          ink: '#05060d',
          panel: '#0a0c1e',
          rim: 'rgba(120, 150, 255, 0.18)',
          textMuted: '#7d8bc1',
          gold: '#ffe07a',
          burn: '#ff7a4a',
          pool: '#6ce0ff',
        },
      },
      keyframes: {
        fadein: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        flashIn: {
          '0%': { opacity: '0', transform: 'translate(-50%, -50%) scale(0.8)' },
          '100%': { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
      },
      animation: {
        fadein: 'fadein 0.35s ease',
        flashIn: 'flashIn 0.3s cubic-bezier(0.2, 1.6, 0.4, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
