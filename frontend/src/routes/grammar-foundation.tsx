import { lazyPage } from "./lazy-page";
import { useApp } from "../app/AppContext";
import { ToolSubpage } from "./shared";
const GrammarFoundationPage = lazyPage(() => import("../pages/GrammarFoundationPage").then((module) => ({ default: module.GrammarFoundationPage })));
export function GrammarFoundationRoute() {
  const { state, actions } = useApp();
  return <ToolSubpage title="基础语法"><GrammarFoundationPage onOpenGrammar={actions.openGrammar} focusRuleId={state.selectedFoundationRuleId} /></ToolSubpage>;
}

export const preload = GrammarFoundationPage.preload;
