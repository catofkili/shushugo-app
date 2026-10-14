// 生成一次性审核密码：node scripts/mint-review-passwords.mjs <个数> <use_by 日期 YYYY-MM-DD> <明文输出文件>
// 标准输出是给 sqlite3 的 SQL（只含 SHA-256 摘要）；明文只写进输出文件（0600），请放在仓库外面。
import { createHash, randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";

const [countArg, useBy, outFile] = process.argv.slice(2);
const count = Number(countArg);
if (!Number.isInteger(count) || count < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(useBy ?? "") || !outFile) {
  console.error("用法: mint-review-passwords.mjs <个数> <use_by YYYY-MM-DD> <明文输出文件>");
  process.exit(1);
}
const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // 去掉 i l o 0 1，审核员手输不会看错
const passwords = Array.from({ length: count }, () => Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join(""));
// 和 index.ts 的 sha256 同口径：SHA-256 摘要的 base64url（无填充）
const digest = (value) => createHash("sha256").update(value).digest("base64url");
const useByIso = new Date(`${useBy}T00:00:00+08:00`).toISOString();
writeFileSync(outFile, `${passwords.join("\n")}\n`, { mode: 0o600 });
console.log("BEGIN;");
for (const password of passwords) console.log(`INSERT INTO review_passwords (password_hash, use_by) VALUES ('${digest(password)}', '${useByIso}');`);
console.log("COMMIT;");
