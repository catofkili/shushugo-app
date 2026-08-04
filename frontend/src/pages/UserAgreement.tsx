import { ArrowLeft, ScrollText } from "lucide-react";
import { USER_AGREEMENT_EFFECTIVE_DATE, USER_AGREEMENT_SECTIONS, USER_AGREEMENT_TITLE } from "../lib/user-agreement-content";

export function UserAgreement({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto max-w-3xl pb-4">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-[#474a4a] p-2">
        <button onClick={onBack} className="focus-ring inline-flex items-center gap-2 rounded-2xl px-2 py-2 text-sm font-bold text-white/78 hover:bg-white/8"><ArrowLeft size={17} />返回</button>
        <p className="min-w-0 truncate px-2 text-sm font-bold text-white/70">用户协议</p>
      </div>
      <section className="rounded-2xl border border-[#91C968]/25 bg-[#91C968]/12 p-4">
        <div className="flex gap-3"><ScrollText className="mt-0.5 shrink-0 text-[#B7E38D]" /><div><h1 className="text-xl font-bold text-white">{USER_AGREEMENT_TITLE}</h1><p className="mt-2 text-xs font-bold text-[#B7E38D]">生效日期：{USER_AGREEMENT_EFFECTIVE_DATE}</p></div></div>
      </section>
      <div className="mt-4 space-y-3">
        {USER_AGREEMENT_SECTIONS.map((section) => (
          <section key={section.title} className="rounded-2xl border border-white/15 bg-[#464949] p-4">
            <h2 className="text-base font-bold text-white">{section.title}</h2>
            {section.body.map((line) => <p key={line} className="mt-2 text-sm leading-7 text-white/68">{line}</p>)}
          </section>
        ))}
      </div>
    </div>
  );
}
