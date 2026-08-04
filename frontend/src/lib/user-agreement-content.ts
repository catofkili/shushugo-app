export const USER_AGREEMENT_TITLE = "Master 日语用户协议";
export const USER_AGREEMENT_EFFECTIVE_DATE = "2026 年 8 月 3 日";
export const USER_AGREEMENT_VERSION = "2026-08-03";

export interface UserAgreementSection {
  title: string;
  body: string[];
}

export const USER_AGREEMENT_SECTIONS: UserAgreementSection[] = [
  {
    title: "账号与使用",
    body: [
      "你可以不登录账号使用本机学习功能。注册或登录账号后，可使用跨设备同步、账号资料和云端权益等功能。",
      "请妥善保管登录凭据，不要转让、出租账号或利用账号从事违法、侵权、干扰服务运行的活动。"
    ]
  },
  {
    title: "学习数据与同步",
    body: [
      "未登录时，学习记录默认保存在当前设备。登录后，应用会按同步设置把学习记录和账号资料上传至云端，以便在你的设备间恢复和合并。",
      "网络中断不会阻止本机学习。恢复联网后，待同步的数据会继续尝试上传；发生无法自动判断的冲突时，应用会要求你选择保留哪一份数据。"
    ]
  },
  {
    title: "付费功能",
    body: [
      "Master Pro 的购买、续订、退款和付款由 Apple App Store 处理。具体周期、价格和续订规则以购买页面及 Apple 显示的信息为准。",
      "账号被删除后，本机仍可通过 App Store 的恢复购买功能重新核验符合条件的权益。"
    ]
  },
  {
    title: "账号终止",
    body: [
      "你可以在应用内退出或删除账号。删除账号会永久清除服务器上的账号资料、云端学习备份和关联会话，本机学习数据按删除页面的说明处理。",
      "如果账号被用于危害服务、他人或违反适用法律，我们可能限制相关账号继续访问在线服务。"
    ]
  },
  {
    title: "服务变更与联系",
    body: [
      "我们可能为安全、兼容性或功能改进更新服务及本协议。发生重要变化时，会在应用内展示新版本并在必要时重新征得同意。",
      "如对账号或本协议有疑问，请通过 App Store 的应用支持入口联系开发者。"
    ]
  }
];
