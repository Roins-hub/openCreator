"use client";

/** 下载链接:经本站鉴权后跳转到对象存储的限时直链,带上下载文件名 */
export const mediaDownloadUrl = (file: { path: string; name: string }) =>
  `/api/media/${file.path}?download=${encodeURIComponent(file.name)}`;

/** 逐个触发下载(间隔一点,浏览器才不会把后面的吞掉);第一次批量下载时浏览器会问是否允许下载多个文件 */
export async function downloadFiles(files: readonly { path: string; name: string }[]) {
  for (const [index, file] of files.entries()) {
    if (index) await new Promise((resolve) => setTimeout(resolve, 450));
    const link = document.createElement("a");
    link.href = mediaDownloadUrl(file);
    link.download = file.name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }
}
