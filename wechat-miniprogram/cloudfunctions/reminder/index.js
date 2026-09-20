// 学习提醒 = 微信「一次性订阅消息」。
//
// 个人主体开不了服务号，教育类目也拿不到长期订阅，能用的只有一次性订阅：用户点一次授权 = 能发一条，
// 授权不过期。所以小程序把 wx.requestSubscribeMessage 挂在用户本来就要点的按钮上（翻面 / 评分），
// 用户勾过「总是保持以上选择」之后每次点都静默 +1 条额度，这里记账；定时器每天 20:00（北京时间）
// 给「今天没学、还有额度」的人发一条，扣 1。用户天天学就天天不发，额度只涨不掉。
//
// 模板是后台申请的，字段名随模板走，所以模板 id 和字段都从环境变量来（cloudbaserc.json）：
//   REMINDER_TEMPLATE_ID  订阅消息模板 id（小程序 config.js 的 reminderTemplateId 要是同一个）；没填 = 不发
//   REMINDER_DATA         模板字段，写成 `thing1=今天的单词还没复习;time2={date}`（分号隔开，{date} 换成当天日期）。
//                         ⚠️ 不能写 JSON：tcb 部署时会把 JSON 形状的环境变量解析成对象，云 API 直接拒收。
//                         字段值有长度限制（thing 20 字、time 要是日期），按模板说明填。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = 'reminders';
const PAGE = 'pages/index/index';

const beijingToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

const ensureCollection = async () => {
  try { await db.createCollection(COLLECTION); } catch { /* 已存在 */ }
};

const templateId = () => {
  const id = String(process.env.REMINDER_TEMPLATE_ID || '').trim();
  return id.length >= 10 ? id : '';
};

const templateData = () => {
  const today = beijingToday();
  const data = {};
  for (const pair of String(process.env.REMINDER_DATA || '').split(';')) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    data[pair.slice(0, at).trim()] = { value: pair.slice(at + 1).trim().replace(/\{date\}/g, today) };
  }
  return data;
};

// 小程序调：攒一条额度 + 记「今天学过了」
const grant = async (openid) => {
  await ensureCollection();
  const today = beijingToday();
  const doc = db.collection(COLLECTION).doc(openid);
  const existing = await doc.get().catch(() => null);
  if (existing && existing.data) {
    await doc.update({ data: { credits: db.command.inc(1), lastActiveOn: today } });
  } else {
    await db.collection(COLLECTION).add({ data: { _id: openid, credits: 1, lastActiveOn: today, lastSentOn: '' } });
  }
  return status(openid);
};

const active = async (openid) => {
  await ensureCollection();
  const today = beijingToday();
  await db.collection(COLLECTION).doc(openid).update({ data: { lastActiveOn: today } }).catch(() => undefined);
  return status(openid);
};

const status = async (openid) => {
  await ensureCollection();
  const result = await db.collection(COLLECTION).doc(openid).get().catch(() => null);
  const data = (result && result.data) || { credits: 0, lastActiveOn: '', lastSentOn: '' };
  return { credits: Number(data.credits || 0), lastActiveOn: data.lastActiveOn || '', lastSentOn: data.lastSentOn || '' };
};

// 定时器：今天没学、有额度、今天没发过 → 发一条、扣一条。用户在微信里关掉了（43101）就把额度清零，
// 别再天天撞；他再点一次按钮会重新授权、重新攒。
const sendDue = async () => {
  const id = templateId();
  if (!id) return { sent: 0, skipped: 'REMINDER_TEMPLATE_ID 没配' };
  await ensureCollection();
  const today = beijingToday();
  const _ = db.command;
  const rows = await db.collection(COLLECTION)
    .where({ credits: _.gt(0), lastActiveOn: _.neq(today), lastSentOn: _.neq(today) })
    .limit(500)
    .get();
  let sent = 0;
  const failures = [];
  for (const row of rows.data) {
    try {
      await cloud.openapi.subscribeMessage.send({ touser: row._id, templateId: id, page: PAGE, data: templateData() });
      await db.collection(COLLECTION).doc(row._id).update({ data: { credits: _.inc(-1), lastSentOn: today } });
      sent += 1;
    } catch (error) {
      const code = Number(error && error.errCode);
      // 43101 用户拒收；43104 模板没被授权过（额度其实是 0）：都清零
      if (code === 43101 || code === 43104) {
        await db.collection(COLLECTION).doc(row._id).update({ data: { credits: 0 } });
      }
      failures.push({ openid: row._id.slice(0, 6), code, message: String(error && error.errMsg || error) });
    }
  }
  return { sent, candidates: rows.data.length, failures };
};

exports.main = async (event) => {
  // 定时触发器进来的 event 带 TriggerName，没有 OPENID
  if (event && event.TriggerName) return sendDue();
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { error: 'no openid' };
  const action = (event && event.action) || 'status';
  if (action === 'grant') return grant(OPENID);
  if (action === 'active') return active(OPENID);
  return status(OPENID);
};
