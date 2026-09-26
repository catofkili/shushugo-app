import type { Page } from "../types/app";
import mobileTitlesJson from "./navigation-titles.json";

export const mobileTitles: Partial<Record<Page, string | null>> = mobileTitlesJson;
