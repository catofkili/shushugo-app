export interface VisibilityEvent {
  at: number;
  visible: boolean;
}

export interface HangEvent {
  durationMs: number;
}

/** Pure classifier: any background transition resets the interval; foreground gets a 10s grace period. */
export const detectHang = (
  previousAt: number,
  currentAt: number,
  visibilityEvents: readonly VisibilityEvent[] = []
): HangEvent | null => {
  const durationMs = currentAt - previousAt;
  if (durationMs < 4_000) return null;
  if (visibilityEvents.some((event) => event.at > previousAt && event.at <= currentAt && !event.visible)) return null;
  const foregroundAt = visibilityEvents.reduce<number | null>((latest, event) => (
    event.visible && event.at <= currentAt ? Math.max(latest ?? event.at, event.at) : latest
  ), null);
  if (foregroundAt !== null && currentAt - foregroundAt < 10_000) return null;
  // A foreground transition inside this interval means the elapsed time included suspension.
  if (visibilityEvents.some((event) => event.at > previousAt && event.at <= currentAt && event.visible)) return null;
  return { durationMs };
};

export const startHangWatchdog = (options: {
  isVisible: () => boolean;
  subscribeVisibility: (listener: (event: VisibilityEvent) => void) => () => void;
  onHang: (event: HangEvent) => void;
  onVisibility?: (event: VisibilityEvent) => void;
  onHeartbeat?: (at: number) => void;
  now?: () => number;
}) => {
  const now = options.now ?? Date.now;
  let previousAt = now();
  let visibilityEvents: VisibilityEvent[] = [];
  const stopVisibility = options.subscribeVisibility((event) => {
    visibilityEvents.push(event);
    visibilityEvents = visibilityEvents.slice(-12);
    options.onVisibility?.(event);
  });
  const timer = setInterval(() => {
    const currentAt = now();
    if (options.isVisible()) {
      const event = detectHang(previousAt, currentAt, visibilityEvents);
      if (event) options.onHang(event);
    }
    previousAt = currentAt;
    options.onHeartbeat?.(currentAt);
    visibilityEvents = visibilityEvents.filter((event) => event.at > currentAt - 15_000);
  }, 1_000);
  return () => {
    clearInterval(timer);
    stopVisibility();
  };
};
