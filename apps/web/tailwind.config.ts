import type { Config } from "tailwindcss";
import path from "path";
import { theme } from "../../packages/ui/src/theme";

const config: Config = {
  content: [path.join(__dirname, "src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        primary: theme.colors.primary,
        accent: theme.colors.accent,
        divine: theme.colors.divine,
        ink: theme.colors.ink,
      },
      fontFamily: {
        display: [...theme.fontFamily.display],
        sans: [...theme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};

export default config;
