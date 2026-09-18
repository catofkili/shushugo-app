export const OPEN_GRAMMAR_FOUNDATION_EVENT = "shushugo:open-grammar-foundation";

/** GrammarTermHint 被五种语法界面共用，而页面状态由 App 持有；统一事件可避免五层重复透传导航回调。 */
export const openGrammarFoundation = (ruleId: string) => {
  window.dispatchEvent(new CustomEvent(OPEN_GRAMMAR_FOUNDATION_EVENT, { detail: { ruleId } }));
};
