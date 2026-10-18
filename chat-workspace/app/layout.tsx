import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { MOTE_MODE, moteThemeScript } from "@/lib/mote";
import "./globals.css";

export const metadata: Metadata = MOTE_MODE
  ? { title: "TZ · 聊天", description: "与视频、图片工作台共用账号的 AI 聊天" }
  : { title: "SUB2 Chat - 聊天工作台", description: "使用自有 API Key 的本地优先 AI 聊天工作台" };

const themeScript = `
  try {
    const saved = localStorage.getItem('sub2chat:theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (_) {}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTE_MODE ? moteThemeScript : themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
