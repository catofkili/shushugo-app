import localSchemaSql from "./local-schema.sql?raw";
import { getDatabase } from "../database";

export const LOCAL_SCHEMA_SQL = localSchemaSql;

export function runSqlScript(script: string): void {
  const db = getDatabase();
  script
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => db.run(statement));
}

export function ensureLocalSchema(): void {
  runSqlScript(LOCAL_SCHEMA_SQL);
}
