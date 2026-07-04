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
        background: "hsl(0, 0%, 100%)",
        foreground: "hsl(222.2, 84%, 4.9%)",
        primary: {
          DEFAULT: "#2563EB",
          foreground: "hsl(210, 40%, 98%)",
        },
        surface: "#F1F5F9",
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
