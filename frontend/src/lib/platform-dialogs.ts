export const confirmDialog = async (message: string) => window.confirm(message);

export const promptDialog = async (message: string, defaultValue = '') => window.prompt(message, defaultValue);
