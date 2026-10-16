import type { Metadata } from "next";
import "./globals.css";
import { ThemeWatcher } from "@/components/theme-watcher";
import { themeBootScript } from "@/lib/themes";

export const metadata: Metadata = {
  title: "TZ · AI 视频工作台",
  description: "本地优先的 AI 视频创作工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <ThemeWatcher />
        {children}
      </body>
    </html>
  );
}
