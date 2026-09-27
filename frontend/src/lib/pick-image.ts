export function pickImageDataUrl(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    const cleanup = () => {
      input.removeEventListener("cancel", onCancel);
      input.onchange = null;
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return onCancel();

      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("无法读取图片"));
      };
      reader.onerror = () => {
        cleanup();
        reject(reader.error ?? new Error("无法读取图片"));
      };
      reader.onabort = onCancel;
      reader.readAsDataURL(file);
    };
    input.addEventListener("cancel", onCancel);
    input.click();
  });
}
