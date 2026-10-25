import type { Referral } from "./referral";
export const referralRules = "好友填你的码后 30 天内，TA 学习赚的柚子多得一倍，你得一半；TA 学满 3 天，你们都拿到「柚友」套装。";
export const referralEarningsText = (me: Referral) => `已到账 ${me.inviterEarned} 柚子`;
export const referralShopLink = true;
