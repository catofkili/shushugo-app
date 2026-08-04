export const PROGRESS_UPDATED_EVENT = "shushugo-progress-updated";

export const notifyProgressUpdated = () => {
  window.dispatchEvent(new Event(PROGRESS_UPDATED_EVENT));
};
