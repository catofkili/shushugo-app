import { Preferences } from "@capacitor/preferences";

export interface PasscodeState {
  enabled: boolean;
  updatedAt?: string;
}

const PASSCODE_KEY = "mn_local_passcode";

const toHex = (bytes: ArrayBuffer) => (
  Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
);

const randomSalt = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hashPasscode = async (passcode: string, salt: string) => {
  const data = new TextEncoder().encode(`${salt}:${passcode}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
};

const loadRecord = async (): Promise<{ salt: string; hash: string; updatedAt: string } | null> => {
  const { value } = await Preferences.get({ key: PASSCODE_KEY });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { salt?: string; hash?: string; updatedAt?: string };
    if (!parsed.salt || !parsed.hash || !parsed.updatedAt) return null;
    return { salt: parsed.salt, hash: parsed.hash, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
};

export async function getPasscodeState(): Promise<PasscodeState> {
  const record = await loadRecord();
  return { enabled: Boolean(record), updatedAt: record?.updatedAt };
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  const record = await loadRecord();
  if (!record) return true;
  return await hashPasscode(passcode, record.salt) === record.hash;
}

export async function setLocalPasscode(currentPasscode: string, nextPasscode: string): Promise<PasscodeState> {
  const record = await loadRecord();
  if (record && !(await verifyPasscode(currentPasscode))) {
    throw new Error("当前口令不正确。");
  }
  if (nextPasscode.length < 8) {
    throw new Error("新口令至少需要 8 位。");
  }
  const salt = randomSalt();
  const updatedAt = new Date().toISOString();
  await Preferences.set({
    key: PASSCODE_KEY,
    value: JSON.stringify({ salt, hash: await hashPasscode(nextPasscode, salt), updatedAt })
  });
  return { enabled: true, updatedAt };
}

export async function clearLocalPasscode(currentPasscode: string): Promise<PasscodeState> {
  const record = await loadRecord();
  if (record && !(await verifyPasscode(currentPasscode))) {
    throw new Error("当前口令不正确。");
  }
  await Preferences.remove({ key: PASSCODE_KEY });
  return { enabled: false };
}
