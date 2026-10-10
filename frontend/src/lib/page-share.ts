export type PageShare = { title: string; path: string };

export const usePageShare = (_share: PageShare | null) => undefined;
export const pageShareButtonProps = (_share: PageShare, onClick: () => void) => ({ onClick });
