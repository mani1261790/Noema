import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Noema",
  description: "LLM FAQ + Notebook learning platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
