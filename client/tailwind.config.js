/**
 * @file tailwind.config.js
 * @description Tailwind CSS configuration — content globs and the dashboard's design tokens as CSS variables, with a dark (default) and a light set.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import colors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

/** Convert a `#rrggbb` hex to space-separated RGB channels. */
const channels = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${n >> 16} ${(n >> 8) & 255} ${n & 255}`;
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Hues used by components. Dark = Tailwind's own value for the shade.
const HUES = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

// Light theme: which Tailwind shade a hue's shade resolves to. Pale shades (used for text on
// dark) become deep ones; deep shades (used for dark tinted panels) become pale ones; 500 and
// 600 (solid fills that carry white text) stay.
const LIGHT_HUE_SHADE = {
  50: 950,
  100: 950,
  200: 900,
  300: 800,
  400: 700,
  500: 500,
  600: 600,
  700: 300,
  800: 200,
  900: 100,
  950: 50,
};

// Neutrals. Dark = Tailwind's value. Light = the mirrored shade...
const NEUTRALS = ["gray", "slate"];
const LIGHT_NEUTRAL_SHADE = {
  50: 950,
  100: 900,
  200: 800,
  300: 700,
  400: 600,
  500: 500,
  600: 400,
  700: 300,
  800: 200,
  900: 100,
  950: 50,
};
// ...except these two grays, darkened so secondary and hint text stay readable on white.
const LIGHT_GRAY_OVERRIDE = { 500: "#5f6877", 600: "#7b8494" };

// The dashboard's own tokens: [dark, light].
const TOKENS = {
  "surface-0": ["#06060a", "#ffffff"],
  "surface-1": ["#0c0c14", "#fafbfc"],
  "surface-2": ["#13131e", "#f5f6f9"],
  "surface-3": ["#1a1a28", "#f0f2f6"],
  "surface-4": ["#222233", "#e6e9f0"],
  "surface-5": ["#2a2a3d", "#d9dde6"],
  border: ["#2a2a3d", "#d9dde6"],
  "border-light": ["#363650", "#b9bfcd"],
  accent: ["#6366f1", "#4f46e5"],
  "accent-hover": ["#818cf8", "#4338ca"],
  // Neutrals the D3 charts and their tooltips used to hard-code.
  "chart-text": ["#e2e8f0", "#1e293b"],
  "chart-text-2": ["#cbd5e1", "#334155"],
  "chart-muted": ["#94a3b8", "#475569"],
  "chart-line": ["#2a2a4a", "#d5d9e3"],
  "chart-bg": ["#12121f", "#ffffff"],
  "chart-track": ["#1e1e2e", "#e1e4ec"],
  "chart-empty": ["#161625", "#e6e9f0"],
};

// Build the two CSS-variable sets: --c-<name> -> "r g b" channels.
const darkVars = {};
const lightVars = {};

for (const [name, [dark, light]] of Object.entries(TOKENS)) {
  darkVars[`--c-${name}`] = channels(dark);
  lightVars[`--c-${name}`] = channels(light);
}

for (const hue of HUES) {
  for (const shade of SHADES) {
    darkVars[`--c-${hue}-${shade}`] = channels(colors[hue][shade]);
    lightVars[`--c-${hue}-${shade}`] = channels(colors[hue][LIGHT_HUE_SHADE[shade]]);
  }
}

for (const name of NEUTRALS) {
  for (const shade of SHADES) {
    darkVars[`--c-${name}-${shade}`] = channels(colors[name][shade]);
    const lightHex =
      name === "gray" && LIGHT_GRAY_OVERRIDE[shade]
        ? LIGHT_GRAY_OVERRIDE[shade]
        : colors[name][LIGHT_NEUTRAL_SHADE[shade]];
    lightVars[`--c-${name}-${shade}`] = channels(lightHex);
  }
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "rgb(var(--c-surface-0) / <alpha-value>)",
          1: "rgb(var(--c-surface-1) / <alpha-value>)",
          2: "rgb(var(--c-surface-2) / <alpha-value>)",
          3: "rgb(var(--c-surface-3) / <alpha-value>)",
          4: "rgb(var(--c-surface-4) / <alpha-value>)",
          5: "rgb(var(--c-surface-5) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--c-border) / <alpha-value>)",
          light: "rgb(var(--c-border-light) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          hover: "rgb(var(--c-accent-hover) / <alpha-value>)",
          muted: "rgb(var(--c-accent) / 0.15)",
        },
        ...Object.fromEntries(
          [...HUES, ...NEUTRALS].map((name) => [
            name,
            Object.fromEntries(
              SHADES.map((shade) => [
                String(shade),
                `rgb(var(--c-${name}-${shade}) / <alpha-value>)`,
              ])
            ),
          ])
        ),
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [
    plugin(({ addBase }) =>
      addBase({
        ":root": darkVars,
        "html.light": lightVars,
      })
    ),
  ],
};
