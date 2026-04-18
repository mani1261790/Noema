import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog, getNotebookById, getNotebookHtml } from "@/lib/notebooks";
import { buildNotebookDescription } from "@/lib/seo";
import { toAbsoluteUrl } from "@/lib/site";

type LearnNotebookPageProps = {
  params: {
    notebookId: string;
  };
};

export const dynamic = "force-dynamic";

async function getNotebookPageData(notebookId: string) {
  const [catalog, notebook] = await Promise.all([getCatalog(), getNotebookById(notebookId)]);
  if (!notebook) return null;

  const chapter = catalog.chapters.find((item) => item.notebooks.some((candidate) => candidate.id === notebook.id)) || null;
  const articleHtml = await getNotebookHtml(notebook.htmlPath);
  return { chapter, notebook, articleHtml };
}

export async function generateMetadata({ params }: LearnNotebookPageProps): Promise<Metadata> {
  const data = await getNotebookPageData(params.notebookId);
  if (!data) {
    return {
      title: "教材が見つかりません"
    };
  }

  const description = buildNotebookDescription({
    title: data.notebook.title,
    chapterTitle: data.chapter?.title,
    tags: data.notebook.tags,
    articleHtml: data.articleHtml
  });
  const canonicalPath = `/learn/${encodeURIComponent(data.notebook.id)}`;

  return {
    title: data.notebook.title,
    description,
    keywords: data.notebook.tags,
    alternates: {
      canonical: canonicalPath
    },
    openGraph: {
      type: "article",
      title: data.notebook.title,
      description,
      url: toAbsoluteUrl(canonicalPath),
      images: [
        {
          url: `${canonicalPath}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: data.notebook.title
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title: data.notebook.title,
      description,
      images: [`${canonicalPath}/opengraph-image`]
    }
  };
}

export default async function LearnNotebookPage({ params }: LearnNotebookPageProps) {
  const data = await getNotebookPageData(params.notebookId);
  if (!data) notFound();

  const { chapter, notebook, articleHtml } = data;
  const canonicalUrl = toAbsoluteUrl(`/learn/${encodeURIComponent(notebook.id)}`);
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Noema", item: toAbsoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "教材一覧", item: toAbsoluteUrl("/learn") },
      { "@type": "ListItem", position: 3, name: notebook.title, item: canonicalUrl }
    ]
  };
  const learningResourceJsonLd = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: notebook.title,
    url: canonicalUrl,
    educationalLevel: chapter?.audience === "advanced" ? "advanced" : "beginner",
    learningResourceType: "Notebook lesson",
    about: notebook.tags,
    isAccessibleForFree: true,
    provider: {
      "@type": "Organization",
      name: "Noema",
      url: toAbsoluteUrl("/")
    }
  };

  return (
    <main style={{ fontFamily: '"IBM Plex Sans", system-ui, sans-serif', background: "#f8fafc", color: "#0f172a" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(learningResourceJsonLd) }} />
      <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "36px 20px 80px" }}>
        <nav aria-label="breadcrumb" style={{ marginBottom: "18px", color: "#64748b" }}>
          <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>Noema</Link>
          {" / "}
          <Link href="/learn" style={{ color: "#64748b", textDecoration: "none" }}>教材一覧</Link>
          {" / "}
          <span>{notebook.title}</span>
        </nav>

        <header style={{ marginBottom: "24px" }}>
          <p style={{ color: "#2563eb", fontWeight: 700, marginBottom: "10px" }}>{chapter?.title || "教材"}</p>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)", lineHeight: 1.1, margin: 0 }}>{notebook.title}</h1>
          <p style={{ color: "#475569", lineHeight: 1.7, marginTop: "18px", maxWidth: "800px" }}>
            Noemaのノートブック教材ページです。検索結果から直接本文を読み、必要なら対話型アプリやColabに移動できます。
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "18px" }}>
            {notebook.tags.map((tag) => (
              <span key={tag} style={{ background: "#dbeafe", color: "#1d4ed8", padding: "6px 10px", borderRadius: "999px", fontSize: "0.92rem" }}>
                {tag}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "20px" }}>
            <Link
              href={`/index.html?notebookId=${encodeURIComponent(notebook.id)}`}
              style={{ background: "#0f172a", color: "#fff", padding: "12px 18px", borderRadius: "999px", textDecoration: "none", fontWeight: 700 }}
            >
              対話型アプリで開く
            </Link>
            <a
              href={notebook.colabUrl}
              style={{ border: "1px solid #cbd5e1", color: "#0f172a", padding: "12px 18px", borderRadius: "999px", textDecoration: "none", fontWeight: 700 }}
            >
              Colabで開く
            </a>
          </div>
        </header>

        <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "24px", padding: "28px" }}>
          <div dangerouslySetInnerHTML={{ __html: articleHtml }} />
        </section>
      </div>
    </main>
  );
}
