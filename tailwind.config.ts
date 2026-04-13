import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#0d1117",
          900: "#0f1623",
          800: "#161b27",
          700: "#1a2040",
          600: "#1e2847",
        },
      },
    },
  },
  plugins: [],
};

export default config;
