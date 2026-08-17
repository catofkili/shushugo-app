/**
 * Cross-module events used by grammar pages and sync. Keeping these names in
 * one dependency-light module prevents a literal in merge.ts drifting from
 * the event listened to by the UI.
 */
export const GRAMMAR_HIGHLIGHTS_UPDATED_EVENT = "grammar-highlights-updated";
export const GRAMMAR_POSITIONS_UPDATED_EVENT = "grammar-positions-updated";
