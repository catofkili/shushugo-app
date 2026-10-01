// 小程序识别方案待定，不请求麦克风，也不引入云端识别。
export const speechInputAvailable = (): boolean => false;
export const listen = (_onText: (text: string) => void, onEnd: () => void, _onError: (error: string) => void): (() => void) => {
  onEnd();
  return () => {};
};
