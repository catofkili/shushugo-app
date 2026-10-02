import { SPELLING_MARKER } from "../lib/spelling";
import "./spelling.css";

export function SpellingPage() {
  return (
    <div className="sp-root" data-exp={SPELLING_MARKER}>
      <h1 className="sp-title">拼写（实验）</h1>
      <p>单词拼写功能正在开发中。</p>
    </div>
  );
}
