import type { ReactNode } from "react";
import { Crown } from "lucide-react";

export const ProReadingGate = ({ title, onUpgrade }: { title: string; onUpgrade: () => void }) => (
  <div className="pro-reading-preview-gate">
    <div className="pro-reading-preview-copy">
      <span><Crown size={14} aria-hidden="true" />收集日 Pro</span>
      <h2>解锁完整{title}</h2>
      <button type="button" onClick={onUpgrade}>查看会员方案</button>
    </div>
  </div>
);

export const ProReadingPreview = ({ title, onUpgrade, children }: { title: string; onUpgrade: () => void; children: ReactNode }) => (
  <section className="pro-reading-preview" aria-label={`${title}会员预览`}>
    <div className="pro-reading-preview-content" inert>{children}</div>
    <ProReadingGate title={title} onUpgrade={onUpgrade} />
  </section>
);
