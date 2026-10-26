/** 页面里显示媒体文件的地址(/api/media 会跳转到云存储直链) */
export const mediaUrl = (path: string) => `/api/media/${path}`;

/** 缩略图地址:图片缩到 width 宽、视频取首帧;列表、卡片里用,放大查看和下载用原图 */
export const thumbUrl = (path: string, width = 480) => `/api/media/${path}?thumb=${width}`;
