import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        walnut: {
          900: "#1a0f08",
          800: "#2a1810",
          700: "#3b2417",
          600: "#4d3220",
          500: "#6b4a32",
        },
        brass: {
          900: "#5a3f1a",
          700: "#8a6a32",
          500: "#b48a49",
          300: "#d6b274",
          100: "#f0d9a8",
        },
        amber: {
          glow: "#ffb347",
          warm: "#f3a84a",
          deep: "#c47a1e",
        },
        ivory: {
          dial: "#f3e5c4",
          soft: "#e8d6a8",
        },
        ink: "#1a120a",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        numerals: ["var(--font-numerals)", "serif"],
      },
      boxShadow: {
        "brass-ring":
          "inset 0 2px 4px rgba(255,220,170,0.4), inset 0 -2px 4px rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.5)",
        "dial-inset":
          "inset 0 4px 12px rgba(0,0,0,0.6), inset 0 -2px 6px rgba(255,200,120,0.15)",
        "knob":
          "inset 0 2px 3px rgba(255,230,190,0.6), inset 0 -3px 6px rgba(0,0,0,0.55), 0 6px 14px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
export default config;
