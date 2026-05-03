export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "Pretendard",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      keyframes: {
        "slide-in": {
          "0%": { opacity: "0", transform: "translateX(-16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "slide-in": "slide-in 260ms ease-out",
        "fade-up": "fade-up 220ms ease-out",
      },
      boxShadow: {
        soft: "0 18px 60px rgb(15 23 42 / 0.10)",
      },
    },
  },
  plugins: [],
};
