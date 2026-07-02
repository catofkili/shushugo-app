/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        // 主从双栏触发：桌面/平板（≥1024px）或"横屏矮视口且足够宽"（≥700px 且 ≤600px 高）。
        // 用于语法页"左卡片瀑布 / 右选中详情"的并排布局。
        // 关键：横屏分支必须与 styles.css 的「横屏侧轨」媒体查询
        //   (orientation:landscape) and (max-height:600px) and (max-width:1023px)
        // 对齐——即只在导航外壳已切到「侧边栏或侧轨」时才允许双栏，
        // 否则会出现"双栏内容 + 手机底栏外壳"的错位夹缝
        // （横屏、宽 700–1023px、但高 >600px 时）。
        twopane: { raw: "(min-width: 1024px), (orientation: landscape) and (min-width: 700px) and (max-height: 600px)" },
      },
    },
  },
  plugins: [],
}
