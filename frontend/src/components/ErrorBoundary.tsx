import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 顶层错误边界：任一子组件渲染抛错时，显示可恢复的提示而非整屏白屏。
 * 之后接入崩溃上报（Sentry 等）时，在 componentDidCatch 里上报即可。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 暂时仅本地输出；接入崩溃上报后在此 report(error, info)。
    console.error("[ErrorBoundary] 未捕获的渲染错误:", error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-[#555858] px-6 text-center text-[#fff]">
          <div className="max-w-sm">
            <p className="jp-serif text-4xl font-semibold">語</p>
            <p className="mt-4 text-xl font-bold">应用出了点问题</p>
            <p className="mt-2 text-sm text-white/70">
              界面遇到一个错误。你的学习数据已保存在本地，重新载入即可继续。
            </p>
            <button
              onClick={this.handleReload}
              className="focus-ring mt-5 rounded-2xl bg-[#81D8CF] px-5 py-2.5 text-sm font-bold !text-[#343838]"
            >
              重新载入
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
