/** 「返回首页」地址。部署到其他域名时可用 NEXT_PUBLIC_HOME_URL 覆盖(构建期注入)。 */
export const HOME_URL = process.env.NEXT_PUBLIC_HOME_URL?.trim() || "https://first.sub2image.cc.cd";
