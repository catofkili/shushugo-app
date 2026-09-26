import Taro from '@tarojs/taro';

export const confirmDialog = async (message: string) => {
  const result = await Taro.showModal({ title: '请确认', content: message, confirmText: '确定', cancelText: '取消' });
  return result.confirm;
};

export const promptDialog = async (message: string, defaultValue = '') => {
  // miniprogram-api-typings declares editable/placeholderText on wx.showModal; Taro's wrapper omits them.
  const result = await wx.showModal({ title: '请输入', content: message, editable: true, placeholderText: defaultValue });
  return result.confirm ? result.content : null;
};
