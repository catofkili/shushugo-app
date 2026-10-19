import "sql.js";

declare module "sql.js" {
  interface Database {
    getRowsModified(): number;
  }
}
