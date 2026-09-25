import { useApp } from "../app/AppContext";
import { GrammarFoundationPage } from "./lazy-pages";
import { ToolSubpage } from "./shared";
export function GrammarFoundationRoute() {
  const { state, actions } = useApp();
  return <ToolSubpage title="基础语法"><GrammarFoundationPage onOpenGrammar={actions.openGrammar} focusRuleId={state.selectedFoundationRuleId} /></ToolSubpage>;
}
