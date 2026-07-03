export const PROGRESS_UPDATED_EVENT = "master-nihongo-progress-updated";

export const notifyProgressUpdated = () => {
  window.dispatchEvent(new Event(PROGRESS_UPDATED_EVENT));
};
