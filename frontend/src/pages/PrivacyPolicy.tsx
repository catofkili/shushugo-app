import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_TITLE
} from "../lib/privacy-policy-content";

interface PrivacyPolicyProps {
  onBack: () => void;
}

const sections = PRIVACY_POLICY_SECTIONS;

export function PrivacyPolicy({ onBack }: PrivacyPolicyProps) {
  const exportPolicy = () => {
    const text = [
      PRIVACY_POLICY_TITLE,
      `生效日期：${PRIVACY_POLICY_EFFECTIVE_DATE}`,
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
            <h1 className="text-xl font-bold text-white">{PRIVACY_POLICY_TITLE}</h1>
            <p className="mt-2 text-sm leading-6 text-white/70">
              以本地学习为核心：学习记录默认保存在设备上，不接入广告追踪；云同步为可选功能，仅在你注册后上传你主动备份的数据。
            </p>
            <p className="mt-2 text-xs font-bold text-[#81D8CF]">生效日期：{PRIVACY_POLICY_EFFECTIVE_DATE}</p>
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
        本政策描述当前版本的实际功能。如对数据处理有任何疑问，欢迎通过上方联系方式与我们联系。
      </p>
    </div>
  );
}
