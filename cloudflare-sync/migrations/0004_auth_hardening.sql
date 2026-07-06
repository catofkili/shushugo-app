-- 验证码尝试次数上限:6 位数字码必须限制猜测次数,否则可被暴力枚举。
ALTER TABLE auth_email_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
