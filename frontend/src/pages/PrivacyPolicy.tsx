import { ArrowLeft, Download, ShieldCheck } from "lucide-react";

interface PrivacyPolicyProps {
  onBack: () => void;
}

const sections = [
  {
    title: "我们收集什么",
    body: [
      "Master 日语目前以本地学习模式运行。你的单词进度、语法进度、收藏、便签、学习设置和通知提醒时间默认保存在本机设备上。",
      "当前版本不需要注册账号，不会要求你提供姓名、邮箱、手机号、通讯录、定位、照片、健康数据或支付信息。"
    ]
  },
  {
    title: "数据如何使用",
    body: [
      "本地学习数据用于统计学习进度、恢复学习状态、显示收藏，并根据你的设置安排本地通知提醒。",
      "通知提醒通过 iOS 本地通知实现。提醒时间和开关保存在设备上，用于每天按你设定的时间提醒学习或复习。"
    ]
  },
  {
    title: "数据是否离开设备",
    body: [
      "当前版本不会主动把你的学习数据上传到服务器，也没有接入广告网络、第三方分析服务或跨应用追踪。",
      "你手动导出学习数据时，会得到一个本地数据库备份文件。只有当你自己保存、分享或上传这个文件时，数据才会离开设备。"
    ]
  },
  {
    title: "云端同步和账号",
    body: [
      "应用界面中出现的云端同步、账号绑定等能力目前尚未接入正式后端服务。未接入前，这些功能不会上传你的数据。",
      "如果未来加入账号、云同步或其他在线服务，隐私政策会在功能上线前更新，并说明新增的数据类型、用途和控制方式。"
    ]
  },
  {
    title: "第三方组件",
    body: [
      "应用使用 Capacitor、sql.js 等技术组件来运行本地数据库和 iOS 容器。当前版本没有接入广告 SDK、第三方统计 SDK 或社交登录 SDK。",
      "如果后续加入新的第三方服务，会在隐私政策中说明其用途和可能处理的数据。"
    ]
  },
  {
    title: "你的控制权",
    body: [
      "你可以在「我的 > 设置」导出、导入或清除本机学习数据。清除后，应用会回到内置词库和初始学习状态。",
      "你可以在「我的 > 通知提醒」关闭学习提醒和复习提醒，也可以在 iOS 系统设置中撤销通知权限。"
    ]
  },
  {
    title: "儿童与敏感信息",
    body: [
      "Master 日语不面向收集儿童个人信息，也不要求用户输入敏感个人信息。",
      "请不要在便签中主动填写身份证件、联系方式、住址、密码等敏感内容。便签虽然默认保存在本机，但导出备份时会一并包含。"
    ]
  },
  {
    title: "政策更新",
    body: [
      "本政策会随着功能变化而更新。更新后，应用内隐私政策页面会展示新的生效日期。",
      "当前生效日期：2026 年 6 月 15 日。"
    ]
  }
];

export function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
  const exportPolicy = () => {
    const text = [
      "Master 日语隐私政策",
      "生效日期：2026 年 6 月 15 日",
      "",
      ...sections.flatMap((section) => [
        section.title,
        ...section.body.map((line) => `- ${line}`),
        ""
      ])
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "master-nihongo-privacy-policy.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button
          onClick={onBack}
          className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8 hover:text-white"
        >
          <ArrowLeft size={17} />
          返回
        </button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">隐私政策</p>
        <button
          onClick={exportPolicy}
          className="focus-ring grid h-9 w-9 place-items-center rounded-2xl border border-white/15 bg-[#81D8CF]/10 text-white/72"
          title="导出隐私政策"
        >
          <Download size={16} />
        </button>
      </div>

      <section className="rounded-2xl border border-[#81D8CF]/25 bg-[#81D8CF]/15 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#81D8CF]/20 text-[#81D8CF]">
            <ShieldCheck size={21} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-white">Master 日语隐私政策</h1>
            <p className="mt-2 text-sm leading-6 text-white/70">
              当前版本以本地学习为核心：学习记录默认保存在设备上，不接入广告追踪，不主动上传学习数据。
            </p>
            <p className="mt-2 text-xs font-bold text-[#81D8CF]">生效日期：2026 年 6 月 15 日</p>
          </div>
        </div>
      </section>

      <div className="mt-4 space-y-3">
        {sections.map((section) => (
          <section key={section.title} className="rounded-2xl border border-white/15 bg-[#464949] p-4">
            <h2 className="text-base font-bold text-white">{section.title}</h2>
            <div className="mt-3 space-y-2">
              {section.body.map((line) => (
                <p key={line} className="text-sm leading-7 text-white/68">{line}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-4 rounded-2xl border border-white/15 bg-[#81D8CF]/10 p-3 text-xs leading-6 text-white/52">
        说明：这是一份面向当前应用功能的隐私说明，不构成法律意见。正式上架前，还需要在 App Store Connect 中按实际功能填写 App Privacy Details。
      </p>
    </div>
  );
}
