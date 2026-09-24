/*
 * 柚子商店：账本规则、目录、价格、补签阶梯全部来自网页（src/shared/web.js 的 yuzu / yuzuCatalog）。
 * yuzu_ledger 是跨端同步的，这里买的东西网页也算买了，反过来也一样。
 * 小程序此刻能「用」的只有配色（页面 skin 类 + 导航栏色）；吉祥物皮肤、音效、图标的素材
 * 还没接进小程序 —— 买了会同步到网页 / App 上生效，这里如实标出来，不拦着买。
 */
const { ensureDatabase, getStatus } = require('../../runtime/database-store');
const features = require('../../runtime/extended-features');

const RULES = ['今天学了 ≥ 100 词 +50', '清完今日计划 +50', '连击每满 7 天 +300', '加餐 +50', '每个成就 +200'];
const LOCAL_EFFECT = { theme: true, voice: true };
const formatYuzu = (amount) => Math.abs(amount) >= 1000 ? `${Number((amount / 1000).toFixed(2))}k` : String(amount);

Page({
  data: { ready: false, error: '', shop: { balance: 0, items: [], repairableDays: [], repairPrice: 0 }, rules: RULES, earned: 0, skin: '', repairDay: '' },

  async onShow() {
    try {
      if (!getStatus().ready) await ensureDatabase();
      const earned = await features.settleYuzu();
      this.load(earned);
    } catch (error) {
      console.error('[yuzu] 读取失败', error);
      this.setData({ error: '先到「单词」下载离线词库，柚子账本存在那里。' });
    }
  },

  load(earned = 0) {
    const shop = features.yuzuShop();
    const items = shop.items.map((item) => ({
      ...item,
      priceDisplay: formatYuzu(item.price),
      swatchClass: item.category === 'theme' ? item.id.replace('theme-', '') : item.category,
      localEffect: Boolean(LOCAL_EFFECT[item.category]),
      action: item.soon ? 'soon' : item.equipped ? 'equipped' : item.owned && item.equippable ? 'equip' : item.owned ? 'owned' : 'buy'
    }));
    this.setData({ ready: true, shop: { ...shop, balanceDisplay: formatYuzu(shop.balance), repairPriceDisplay: formatYuzu(shop.repairPrice), items }, earned, earnedDisplay: formatYuzu(earned), skin: features.equippedYuzu('theme'), repairDay: shop.repairableDays[0] || '' });
  },

  async buy(event) {
    const ok = await features.buyYuzuItem(event.currentTarget.dataset.id);
    this.load();
    wx.showToast({ title: ok ? '已收入囊中' : '柚子不够', icon: ok ? 'success' : 'none' });
  },

  async equip(event) {
    await features.equipYuzuItem(event.currentTarget.dataset.id);
    this.load();
    wx.showToast({ title: '已使用' });
  },

  pickRepairDay(event) { this.setData({ repairDay: this.data.shop.repairableDays[Number(event.detail.value)] || '' }); },

  async repair() {
    if (!this.data.repairDay) return;
    const ok = await features.repairYuzuDay(this.data.repairDay);
    this.load();
    wx.showToast({ title: ok ? `已补 ${this.data.repairDay}` : '补不了：柚子不够或超出 7 天', icon: ok ? 'success' : 'none' });
  }
});
