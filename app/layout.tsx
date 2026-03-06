import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EnglishPro Critique AI",
  description: "AI 驱动的英语口语视频评测系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
