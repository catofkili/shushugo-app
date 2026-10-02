import { createContext } from "react";

/**
 * 周报上有弹层（分享面板、往期）时为 true。只有小程序版的 Canvas 组件读它：
 * 原生 Canvas 在开发者工具里画在弹层上面，而且 display:none 也藏不掉，只能不渲染。网页不读。
 */
export const WeeklyCoveredContext = createContext(false);
