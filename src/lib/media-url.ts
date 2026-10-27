/** 页面里显示媒体文件的地址(/api/media 会跳转到云存储直链) */
export const mediaUrl = (path: string) => `/api/media/${path}`;

/** 放大查看用的大图(原尺寸 WebP,比 PNG 原图小得多;存储不支持处理时就是原图);下载仍用原文件 */
export const viewUrl = (path: string) => `/api/media/${path}?view=1`;

/** 缩略图地址:图片缩到 width 宽、视频取首帧(服务端只有 480 / 1080 两档);列表、卡片里用 */
export const thumbUrl = (path: string, width = 480) => `/api/media/${path}?thumb=${width}`;
