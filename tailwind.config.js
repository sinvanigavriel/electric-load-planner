/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Matches real-world cable/socket colors used on site (brown / orange / black / red)
        cable: {
          brown: "#6d4c41",
          orange: "#e65100",
          black: "#18181b",
          red: "#d32f2f",
        },
      },
      fontFamily: {
        display: ["Rubik", "system-ui", "sans-serif"],
        body: ["Heebo", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
