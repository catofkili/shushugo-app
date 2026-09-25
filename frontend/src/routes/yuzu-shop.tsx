import { useApp } from "../app/AppContext";
import { YuzuShopPage } from "../pages/YuzuShopPage";
import { ToolSubpage } from "./shared";
export function YuzuShopRoute() {
  const { navigate } = useApp();
  return <ToolSubpage title="柚子商店"><YuzuShopPage onOpenPro={() => navigate("pro")} /></ToolSubpage>;
}
