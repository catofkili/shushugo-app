/*
 * 成就：判据、目录、解锁记录全部来自网页同一份源码（src/shared/web.js 的 achievements）。
 * 此前这里手抄过一份 47 条目录，stats 里一半字段写死 0（夜猫子、早起、手速…永远解不开），
 * 表名还叫 achievement_unlocked —— 网页不认识，两端各解各的。别再手抄回来。
 */
const features = require('./extended-features');

module.exports = {
  achievementBoard: features.achievementBoard,
  achievementSummary: features.achievementSummary,
  evaluateAchievements: features.evaluateAchievements
};
