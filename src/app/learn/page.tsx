import type { Metadata } from "next";
import Link from "next/link";
import { getCatalog } from "@/lib/notebooks";

export const metadata: Metadata = {
  title: "教材一覧",
  description: "Noemaで公開しているPython・機械学習・LLM・強化学習の教材一覧ページ。",
  openGraph: {
    title: "教材一覧",
    description: "Noemaで公開しているPython・機械学習・LLM・強化学習の教材一覧ページ。",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Noema curriculum"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "教材一覧",
    description: "Noemaで公開しているPython・機械学習・LLM・強化学習の教材一覧ページ。",
    images: ["/opengraph-image"]
  }
};

export default async function LearnRootPage() {
  const catalog = await getCatalog();

  return (
    <main style={{ fontFamily: '"IBM Plex Sans", system-ui, sans-serif', maxWidth: "1080px", margin: "0 auto", padding: "40px 20px 80px" }}>
      <header style={{ marginBottom: "32px" }}>
        <p style={{ color: "#2563eb", fontWeight: 700, marginBottom: "10px" }}>Curriculum</p>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", lineHeight: 1.1, margin: 0 }}>Noemaの教材一覧</h1>
        <p style={{ maxWidth: "760px", color: "#475569", lineHeight: 1.7, marginTop: "18px" }}>
          すべての教材は検索可能な固有URLを持ち、教材詳細ページから本文、タグ、Colabリンク、対話型アプリへの導線を確認できます。
        </p>
      </header>

      <div style={{ display: "grid", gap: "20px" }}>
        {catalog.chapters.map((chapter) => (
          <section key={chapter.id} style={{ border: "1px solid #e2e8f0", borderRadius: "20px", padding: "24px", background: "#fff" }}>
            <h2 style={{ marginTop: 0, marginBottom: "8px" }}>{chapter.title}</h2>
            <p style={{ color: "#64748b", marginTop: 0, marginBottom: "18px" }}>
              {chapter.audience === "advanced" ? "上級者向け" : "初学者向け"} · {chapter.notebooks.length}本
            </p>
            <ul style={{ paddingLeft: "20px", margin: 0, lineHeight: 1.9 }}>
              {chapter.notebooks.map((notebook) => (
                <li key={notebook.id}>
                  <Link href={`/learn/${encodeURIComponent(notebook.id)}`} style={{ color: "#1d4ed8", textDecoration: "none" }}>
                    {notebook.title}
                  </Link>
                  <span style={{ color: "#64748b" }}> - {notebook.tags.join(", ")}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
