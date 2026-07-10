import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  // This project has no dark mode. Use the 'class' strategy so that the
  // shadcn `dark:*` utilities only apply under an explicit `.dark` ancestor
  // (which we never add) instead of reacting to the OS color-scheme setting.
  // Without this, the Tailwind v3 default ('media') makes dialogs/popups
  // render dark when the user's OS is in dark mode.
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Claude design system (getdesign.md/claude) — warm cream canvas, grounded cards.
        // Brand override: cobalt #2563EB replaces Claude's coral #cc785c for CTA/accent.
        background: "#faf9f5", // Canvas — cream floor, deliberately not pure white
        foreground: "#141413", // Ink — warm near-black (not cool)
        primary: {
          DEFAULT: "#2563EB", // Cobalt blue — brand CTA/accent (override of Claude coral)
          foreground: "#ffffff",
        },
        surface: "#f5f0e8", // Surface-soft — sidebar, shell, section bands
        card: "#efe9de", // Surface-card — grounded panels, one step darker than canvas
      },
      borderRadius: {
        lg: "0.5rem",
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      }
    },
  },
  plugins: [animate],
}
