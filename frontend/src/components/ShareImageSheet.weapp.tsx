import { useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import { prepareWechatMomentsPost, saveImageToGallery, shareImage } from "../lib/share-image";

export function ShareImageSheet({ title, url, alt, blob, fileName, shareTitle, onClose }: {
  title: string; url: string; alt: string; blob: Blob; fileName: string; shareTitle: string; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const run = async (action: "save" | "friend" | "moments") => {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      if (action === "save") { await saveImageToGallery(blob, fileName); setNotice("已保存到相册。"); }
      else if (action === "friend") { const result = await shareImage(blob, fileName, shareTitle); setNotice(result === "unsupported" ? "当前微信不支持发送此图片。" : "已打开微信分享。"); }
      else { await prepareWechatMomentsPost(blob, fileName); setNotice("请在朋友圈里手动选择刚保存的图片。"); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "操作失败，请检查微信权限后重试。"); }
    finally { setBusy(false); }
  };
  return <View className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/60" role="dialog" aria-label={title}>
    <View className="rounded-t-[28px] bg-[#FBF6EC] p-4 pb-8 text-[#2B241C]">
      <View className="mb-3 flex items-center"><Text className="flex-1 text-base font-bold">{title}</Text><Button onClick={onClose}>关闭</Button></View>
      <Image src={url} mode="widthFix" aria-label={alt} className="max-h-[55vh] w-full rounded-2xl" />
      {notice && <Text className="my-3 block text-sm">{notice}</Text>}
      <View className="mt-3 grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={() => void run("friend")}>发给微信好友</Button>
        <Button disabled={busy} onClick={() => void run("save")}>保存到相册</Button>
        <Button disabled={busy} onClick={() => void run("moments")}>朋友圈手动发布</Button>
        <Button disabled={busy} onClick={onClose}>完成</Button>
      </View>
    </View>
  </View>;
}
