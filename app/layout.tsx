import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "词环 WordLoop｜在语境里真正记住单词",
  description: "极简、语境驱动的 AI 单词学习工具。通过主动回忆、间隔复习和个性化 AI 教练，让单词进入长期记忆。",
  openGraph: {
    title: "词环 WordLoop",
    description: "让每一次回忆，形成一条更牢固的记忆轨道。",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "词环 WordLoop",
    description: "在语境里真正记住单词。",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
