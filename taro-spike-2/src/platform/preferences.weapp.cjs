require('../../../wechat-miniprogram/scripts/shared/polyfill.js');

function storage() {
  if (typeof localStorage === 'undefined') throw new Error('微信本地偏好存储尚未初始化');
  return localStorage;
}

const Preferences = {
  async get({ key }) { return { value: storage().getItem(String(key)) }; },
  async set({ key, value }) { storage().setItem(String(key), String(value)); },
  async remove({ key }) { storage().removeItem(String(key)); }
};

module.exports = { Preferences };
