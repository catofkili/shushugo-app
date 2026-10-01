import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import content from "../../data/talk_content.json";
import { exampleAudioName } from "../speech-audio";
import { talkAudioSentences } from "./sentences";
import { canPlayTalkAudio, playTalkAudio, stopTalkAudio } from "./audio";
import { canPlayTalkAudio as canPlayWeappAudio } from "./audio.weapp";

const speech = vi.hoisted(() => ({ playExample: vi.fn(async () => {}) }));
vi.mock("../speech", () => ({ ...speech, SYSTEM_VOICE_ID: "system" }));
const directory = fileURLToPath(new URL("../../assets/talk-audio/voicevox-8/", import.meta.url));
const sentences = talkAudioSentences(content);

describe("开口练习音频内容闸门", () => {
  it("manifest 与完整句子清单一一对应，哈希、实际文件都吻合，且没有孤儿", () => {
    const manifest = JSON.parse(readFileSync(`${directory}manifest.json`, "utf8")) as Record<string, string>;
    expect(Object.values(manifest).sort()).toEqual([...sentences].sort());
    for (const [name, text] of Object.entries(manifest)) {
      expect(name).toBe(`${exampleAudioName(text)}.aac`);
      expect(statSync(`${directory}${name}`).size).toBeGreaterThan(0);
      // ADTS 同步字，防止 WAV/容器误命名成 AAC。
      const bytes = readFileSync(`${directory}${name}`);
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1] & 0xf6).toBe(0xf0);
    }
    expect(readdirSync(directory).filter((name) => name.endsWith(".aac")).sort()).toEqual(Object.keys(manifest).sort());
  });
});

describe("开口练习播放器", () => {
  const cancel = vi.fn();
  const instances: FakeAudio[] = [];
  class FakeAudio {
    currentTime = 1;
    onerror: (() => void) | null = null;
    pause = vi.fn();
    play = vi.fn(async () => {});
    constructor(public src: string) { instances.push(this); }
  }
  beforeEach(() => {
    vi.clearAllMocks();
    instances.length = 0;
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("window", { speechSynthesis: { speak: vi.fn(), cancel } });
  });
  afterEach(() => {
    stopTalkAudio();
    vi.unstubAllGlobals();
  });

  it("本地有文件就可播，无文件时只在系统语音可用时可播；小程序仍不可播", async () => {
    vi.stubGlobal("window", {});
    expect(await canPlayTalkAudio(sentences[0])).toBe(true);
    expect(await canPlayTalkAudio("未知句子")).toBe(false);
    vi.stubGlobal("window", { speechSynthesis: { speak: vi.fn(), cancel } });
    expect(await canPlayTalkAudio("未知句子")).toBe(true);
    expect(await canPlayWeappAudio()).toBe(false);
  });

  it("播本地文件，再播另一句先停上一句；离页停止并取消系统语音", async () => {
    await playTalkAudio(sentences[0]);
    expect(instances[0].src).toContain(`${exampleAudioName(sentences[0])}.aac`);
    await playTalkAudio(sentences[1]);
    expect(instances[0].pause).toHaveBeenCalledOnce();
    expect(instances[0].currentTime).toBe(0);
    stopTalkAudio();
    expect(instances[1].pause).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalled();
    expect(speech.playExample).not.toHaveBeenCalled();
  });

  it("没有文件时走系统语音退路", async () => {
    await playTalkAudio("未知句子");
    expect(instances).toHaveLength(0);
    expect(speech.playExample).toHaveBeenCalledWith("未知句子", "system");
  });

  it("播放拒绝和 error 事件同时发生也只退回一次", async () => {
    const error = new Error("decoder failed");
    vi.stubGlobal("Audio", class extends FakeAudio {
      constructor(src: string) {
        super(src);
        this.play = vi.fn(async () => { this.onerror?.(); throw error; });
      }
    });
    await playTalkAudio(sentences[0]);
    expect(speech.playExample).toHaveBeenCalledOnce();
    expect(speech.playExample).toHaveBeenCalledWith(sentences[0], "system");
  });

  it("play 已成功后出现解码错误仍退回系统语音", async () => {
    await playTalkAudio(sentences[0]);
    instances[0].onerror?.();
    expect(speech.playExample).toHaveBeenCalledWith(sentences[0], "system");
  });

  it("上一句的延迟失败不能在停止或换句后重新开口", async () => {
    let rejectPlay: (error: Error) => void = () => {};
    vi.stubGlobal("Audio", class extends FakeAudio {
      constructor(src: string) {
        super(src);
        this.play = vi.fn(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
      }
    });
    const playing = playTalkAudio(sentences[0]);
    stopTalkAudio();
    rejectPlay(new Error("late failure"));
    await playing;
    expect(speech.playExample).not.toHaveBeenCalled();
  });
});

// @ts-expect-error 构建脚本是 .mjs，没有类型声明。
import { voicevoxSynthesize } from "../../../scripts/voicevox-synth.mjs";

describe("共用例句合成管线", () => {
  afterEach(() => vi.unstubAllGlobals());
  const item = { text: "花は", furigana: [[0, 1, "はな"]] };
  const query = (texts: string[]) => ({ accent_phrases: [{
    moras: texts.map((text) => ({ text, vowel: "a" })), accent: 2
  }] });

  it("拍数一致直接锁回汉字读音、保留真正助词位，并沿用静音垫", async () => {
    const calls: string[] = [];
    let synthesized: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      calls.push(url);
      if (url.includes("audio_query")) return Response.json(query(["ワ", "ナ", "ワ"]));
      if (url.includes("accent_phrases")) {
        expect(new URL(url).searchParams.get("text")).toBe("ハナ'ワ");
        return Response.json(query(["ハ", "ナ", "ワ"]).accent_phrases);
      }
      synthesized = JSON.parse(options.body as string);
      return new Response(new Uint8Array([1, 2]));
    }));
    const result = await voicevoxSynthesize(item, { useProsody: false, speaker: 8 });
    expect(result).toMatchObject({ locked: true, substituted: false, verified: true });
    expect(calls.filter((url) => url.includes("audio_query"))).toHaveLength(1);
    expect(synthesized).toMatchObject({ prePhonemeLength: 0.02, postPhonemeLength: 0.05,
      outputSamplingRate: 24000, outputStereo: false });
  });

  it("拍数不一致换振假名再喂；还不一致保留 engine/intended 供人判", async () => {
    const inputs: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      inputs.push(new URL(url).searchParams.get("text") ?? "");
      return Response.json(query(["ハ", "ワ"]));
    }));
    await expect(voicevoxSynthesize(item, { useProsody: false })).rejects.toMatchObject({
      engine: "ハワ", intended: "ハナハ"
    });
    expect(inputs).toEqual(["花は", "はなは"]);
  });
});
