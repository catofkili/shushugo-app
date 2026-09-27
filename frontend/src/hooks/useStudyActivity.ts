import { useEffect, useRef } from 'react';

export type StudyActivityHandlers = {
  onInteraction: () => void;
  onVisibilityChange: (visible: boolean) => void;
  onLeave: () => void;
};

/** The native tab bar sits outside the page; web navigation is covered by the modal. */
export function useStudyBreakTabBar(_open: boolean): void {}

/** Active study events; the Mini Program supplies its page lifecycle and native touches. */
export function useStudyActivity(handlers: StudyActivityHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => { latest.current = handlers; });
  useEffect(() => {
    const interact = () => latest.current.onInteraction();
    const visibility = () => latest.current.onVisibilityChange(document.visibilityState !== 'hidden');
    const events = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart', 'touchmove'] as const;
    for (const event of events) document.addEventListener(event, interact, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      for (const event of events) document.removeEventListener(event, interact, { capture: true });
      document.removeEventListener('visibilitychange', visibility);
      latest.current.onLeave();
    };
  }, []);
}
