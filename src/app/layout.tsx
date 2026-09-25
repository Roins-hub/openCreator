import type { Metadata } from "next";
import "./globals.css";
import { ThemeWatcher } from "@/components/theme-watcher";
import { themeBootScript } from "@/lib/themes";

export const metadata: Metadata = {
  title: "Mote — Local AI",
  description: "A quiet local interface for your models.",
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
