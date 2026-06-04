import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  /*
   * Safelist blob-* : les classes blob sont construites dans des Records/Maps
   * (BlobButton, BlobSection, BlobCard, BlobBrushDivider, BlobMediaFrame, HomeHero).
   * Next.js/PostCSS ne scanne pas toujours correctement les objets de mapping —
   * le safelist garantit la génération de ces classes en dev ET en production.
   */
  safelist: [
    { pattern: /^(bg|text|border|fill|ring)-blob-/ },
    { pattern: /^hover:(bg|text|border|fill)-blob-/ },
    { pattern: /^focus-visible:(ring)-blob-/ },
    { pattern: /^(from|via|to)-blob-/ },
    { pattern: /^group-hover:(border)-blob-/ },
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        display: ['"Adlery Pro"', 'cursive'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        blob: {
          yellow:        'hsl(var(--blob-yellow))',
          'yellow-dark': 'hsl(var(--blob-yellow-dark))',
          black:         'hsl(var(--blob-black))',
          sand:          'hsl(var(--blob-sand))',
          'sand-deep':   'hsl(var(--blob-sand-deep))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'blob-reveal': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'blob-separator': {
          from: { transform: 'scaleX(0)', opacity: '0' },
          to:   { transform: 'scaleX(1)', opacity: '1' },
        },
      },
      animation: {
        'accordion-down':   'accordion-down 0.2s ease-out',
        'accordion-up':     'accordion-up 0.2s ease-out',
        'blob-reveal':      'blob-reveal 600ms ease-out both',
        'blob-reveal-slow': 'blob-reveal 850ms ease-out both',
        'blob-separator':   'blob-separator 500ms ease-out both',
      },
    },
  },
  plugins: [animate],
};

export default config;
