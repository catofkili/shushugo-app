import { jsMotionAllowed } from "../../lib/studyPreferences";

export type YuzuFlightPath = {
  left: number;
  top: number;
  flyX: number;
  flyY: number;
  midX: number;
  midY: number;
};

export const getYuzuFlight = (from: Element, to: Element): YuzuFlightPath | null => {
  if (!jsMotionAllowed()) return null;
  const source = from.getBoundingClientRect();
  const target = to.getBoundingClientRect();
  const sourceX = source.left + source.width / 2;
  const sourceY = source.top + source.height / 2;
  const flyX = target.left + target.width / 2 - sourceX;
  const flyY = target.top + target.height / 2 - sourceY;
  const lift = Math.min(96, Math.max(44, Math.abs(flyX) * 0.18));

  return {
    left: sourceX - 10,
    top: sourceY - 10,
    flyX,
    flyY,
    midX: flyX / 2,
    midY: flyY / 2 - lift
  };
};
