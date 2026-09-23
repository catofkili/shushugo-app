import assert from "node:assert/strict";
import { matchedWechatUser, wechatSubjects } from "../src/wechat-identity.ts";

assert.deepEqual(wechatSubjects("open", "union"), ["openid:open", "unionid:union"]);
assert.equal(matchedWechatUser([{ user_id: "one" }, { user_id: "one" }]), "one", "both aliases may point to the same account");
assert.equal(matchedWechatUser([]), null);
assert.throws(() => matchedWechatUser([{ user_id: "one" }, { user_id: "two" }]), /WECHAT_IDENTITY_CONFLICT/, "split aliases must never be silently merged");
console.log("OK WeChat alias identity rules");
