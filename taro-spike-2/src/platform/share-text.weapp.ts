import Taro from '@tarojs/taro';

export const copyText = (text: string) => Taro.setClipboardData({ data: text });

export const shareText = (_title: string, text: string) => copyText(text);
