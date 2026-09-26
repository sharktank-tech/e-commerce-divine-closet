// Theme tokens (seção 7 do Instrucoes_Dev_Ecommerce.md)
// // TODO-CLIENTE: substituir cores/fonte quando o manual de marca/logotipo for entregue.
// Trocar apenas estes tokens — componentes e tailwind.config.ts consomem daqui.

export const theme = {
  colors: {
    primary: {
      DEFAULT: "#9E2BBA",
      50: "#faf3fd",
      100: "#f3e3fa",
      200: "#e7c9f6",
      300: "#d5a3ee",
      400: "#c078e2",
      500: "#b051d3",
      600: "#a536c6",
      700: "#9E2BBA",
      800: "#7c1f93",
      900: "#5c166e",
      950: "#3a0e46",
    },
    accent: {
      DEFAULT: "#B08D57",
      50: "#faf6ef",
      100: "#f3ead9",
      200: "#e7d5b3",
      300: "#d9be8d",
      400: "#c9a674",
      500: "#B08D57",
      600: "#96754a",
      700: "#7a5e3c",
      800: "#5e4830",
      900: "#4a3926",
    },
    divine: {
      50: "#faf7f2",
      100: "#f3ede3",
      200: "#e7dcc9",
      300: "#d7c4a5",
      400: "#c4a57c",
      500: "#B08D57",
      600: "#96754a",
      700: "#7a5e3c",
      800: "#5e4830",
      900: "#4a3926",
      950: "#2a2018",
    },
    ink: {
      DEFAULT: "#14181f",
      soft: "#3a4150",
      mute: "#6b7385",
    },
  },
  fontFamily: {
    display: ["var(--font-display)", "Georgia", "serif"],
    sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
  },
} as const;

export type Theme = typeof theme;
