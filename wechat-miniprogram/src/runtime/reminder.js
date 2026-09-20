// 学习提醒 = 微信「一次性订阅消息」：点一次授权 = 能发一条，授权不过期。
// 个人主体开不了服务号，教育类目拿不到长期订阅，能用的只有这个。
//
// 用法：把 bank() 挂在用户本来就要点的按钮上（翻面 / 评分）。第一次会弹授权框，用户勾了
// 「总是保持以上选择」之后每次都静默通过，每次 +1 条额度，攒在云函数 reminder 的账上；
// 云函数定时器每天 20:00 给「今天没学、还有额度」的人发一条。学完了不用再弹任何东西。
//
// ⚠️ wx.requestSubscribeMessage 必须在点击事件的同步栈里调（await 之后调会被微信拒掉），
// 所以 bank() 前半段不能有 await。
const config = require('../config');
const { enabled } = require('./cloud');

const EVERY = 20;
let taps = 0;

function call(action) {
  return wx.cloud.callFunction({ name: 'reminder', data: { action } }).then((res) => res.result);
}

/** 每次翻面 / 评分调一次：第一次 + 之后每 20 次真的去要授权，其余只计数。 */
function bank() {
  const id = config.reminderTemplateId;
  if (!enabled() || !id) return;
  taps += 1;
  if (taps !== 1 && taps % EVERY !== 0) return;
  wx.requestSubscribeMessage({
    tmplIds: [id],
    success: (res) => { call(res[id] === 'accept' ? 'grant' : 'active').catch(() => undefined); },
    // 用户点了取消 / 微信里整体关了：至少记一笔「今天学过」，今晚别去催
    fail: () => { call('active').catch(() => undefined); }
  });
}

/** 设置页看的：攒了几条、上次发是哪天。 */
async function status() {
  if (!enabled() || !config.reminderTemplateId) return { configured: false, credits: 0, lastSentOn: '' };
  const result = await call('status');
  return { configured: true, credits: Number(result.credits || 0), lastSentOn: result.lastSentOn || '' };
}

module.exports = { bank, status };
