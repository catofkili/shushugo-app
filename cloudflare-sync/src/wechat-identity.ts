export const wechatSubjects = (openid: string, unionid?: string) => [
  `openid:${openid}`,
  ...(unionid ? [`unionid:${unionid}`] : [])
];

export const matchedWechatUser = (rows: Array<{ user_id: string }>): string | null => {
  const users = [...new Set(rows.map((row) => row.user_id))];
  if (users.length > 1) throw new Error("WECHAT_IDENTITY_CONFLICT");
  return users[0] ?? null;
};
