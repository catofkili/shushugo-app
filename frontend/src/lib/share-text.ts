export const copyText = (text: string) => navigator.clipboard.writeText(text);

export const shareText = async (title: string, text: string) => {
  if (navigator.share) await navigator.share({ title, text });
  else await copyText(text);
};
