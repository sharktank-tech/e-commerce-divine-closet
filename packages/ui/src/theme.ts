// Theme tokens (seção 7 do Instrucoes_Dev_Ecommerce.md)
// // TODO-CLIENTE: substituir cores/fonte quando o manual de marca/logotipo for entregue.
// Trocar apenas estes tokens — componentes e tailwind.config.ts consomem daqui.

export const theme = {
  colors: {
    primary: {
      DEFAULT: "#1F3864",
      50: "#eef2fa",
      100: "#d5dff0",
      200: "#aabfe0",
      300: "#7f9fd0",
      400: "#547fc0",
      500: "#3a5fa0",
      600: "#2a4a80",
      700: "#1F3864",
      800: "#172a4c",
      900: "#0f1c34",
      950: "#08101d",
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
