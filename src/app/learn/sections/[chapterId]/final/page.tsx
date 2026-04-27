import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/notebooks";

type FinalPageProps = {
  params: {
    chapterId: string;
  };
};

export async function generateMetadata({ params }: FinalPageProps): Promise<Metadata> {
  const catalog = await getCatalog();
  const chapter = catalog.chapters.find((item) => item.id === params.chapterId);
  if (!chapter) return { title: "最終問題が見つかりません" };
  return {
    title: `${chapter.title} 最終問題`,
    description: `${chapter.title} セクションの理解を確認するNoemaの最終問題ページです。`
  };
}

export default async function ChapterFinalPage({ params }: FinalPageProps) {
  const catalog = await getCatalog();
  const chapter = catalog.chapters.find((item) => item.id === params.chapterId);
  if (!chapter) notFound();

  return (
    <main style={{ fontFamily: '"IBM Plex Sans", system-ui, sans-serif', maxWidth: "880px", margin: "0 auto", padding: "48px 20px 80px" }}>
      <nav aria-label="breadcrumb" style={{ marginBottom: "20px", color: "#64748b" }}>
        <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>Noema</Link>
        {" / "}
        <Link href="/learn" style={{ color: "#64748b", textDecoration: "none" }}>教材一覧</Link>
        {" / "}
        <span>{chapter.title} 最終問題</span>
      </nav>
      <p style={{ color: "#2563eb", fontWeight: 700, marginBottom: "10px" }}>{chapter.title}</p>
      <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", lineHeight: 1.1, margin: 0 }}>{chapter.title} 最終問題</h1>
      <p style={{ color: "#475569", lineHeight: 1.8, marginTop: "18px" }}>
        このセクションで扱った内容を横断的に振り返る問題です。採点と進捗反映は対話型アプリで行います。
      </p>
      <Link
        href={`/index.html?finalChapterId=${encodeURIComponent(chapter.id)}`}
        style={{ display: "inline-flex", marginTop: "24px", background: "#0f172a", color: "#fff", padding: "12px 18px", borderRadius: "999px", textDecoration: "none", fontWeight: 700 }}
      >
        対話型アプリで最終問題を開く
      </Link>
    </main>
  );
}
