import { Component, type ErrorInfo, type ReactNode } from "react";
import { Sticker } from "./CapybaraMascot";
import { captureRuntimeError } from "../lib/feedback-runtime-core";
import { submitFeedback, type FeedbackDelivery } from "../lib/feedback";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  reporting: boolean;
  reportResult: FeedbackDelivery | "failed" | null;
}

/**
 * 顶层错误边界：任一子组件渲染抛错时，显示可恢复的提示而非整屏白屏。
 * 之后接入崩溃上报（Sentry 等）时，在 componentDidCatch 里上报即可。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, reporting: false, reportResult: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, reporting: false, reportResult: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] 未捕获的渲染错误:", error, info.componentStack);
    captureRuntimeError(error);
  }

  private reportError = async () => {
    if (!this.state.error || this.state.reporting) return;
    this.setState({ reporting: true });
    try {
      const result = await submitFeedback({ kind: "error", message: this.state.error.message, includeDiagnostics: true });
      this.setState({ reporting: false, reportResult: result });
    } catch {
      this.setState({ reporting: false, reportResult: "failed" });
    }
  };

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-[#555858] px-6 text-center text-[#fff]">
          <div className="max-w-sm">
            <Sticker name="mood-dizzy" size={120} className="mx-auto" />
            <p className="mt-4 text-xl font-bold">应用出了点问题</p>
            <p className="mt-2 text-sm text-white/70">
              界面遇到一个错误。你的学习数据已保存在本地，重新载入即可继续。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => void this.reportError()}
                disabled={this.state.reporting || this.state.reportResult !== null}
                className="focus-ring rounded-2xl bg-[#81D8CF] px-4 py-2.5 text-sm font-bold !text-[#343838] disabled:opacity-60"
              >
                {this.state.reporting ? "正在发送…" : this.state.reportResult === "sent" ? "已收到，谢谢你" : this.state.reportResult === "queued" ? "已保存，联网后发送" : this.state.reportResult === "failed" ? "保存失败" : "把这个错误报告给开发者"}
              </button>
              <button
                onClick={this.handleReload}
                className="focus-ring rounded-2xl border border-white/20 px-4 py-2.5 text-sm font-bold text-white/80"
              >
                重新载入
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
