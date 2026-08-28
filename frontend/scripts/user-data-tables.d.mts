export const USER_DATA_TABLES: readonly string[];
export const SYNC_INFRA_TABLES: readonly string[];
export const FACTORY_CONTENT_TABLES: readonly string[];
export const STATE_TABLES: readonly string[];
export const ALLOWED_STATE_KEYS: ReadonlySet<string>;

export function findPopulatedUserTables(
  count: (sql: string) => unknown
): Array<[table: string, count: number]>;

export function unregisteredTables(listTables: () => string[]): string[];
