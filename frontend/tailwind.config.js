/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        // 主从双栏触发：桌面/平板（≥1024px）或任意横屏且足够宽（≥700px）。
        // 用于语法页"左卡片瀑布 / 右选中详情"的并排布局。
        twopane: { raw: "(min-width: 1024px), (orientation: landscape) and (min-width: 700px)" },
      },
    },
  },
  plugins: [],
}
