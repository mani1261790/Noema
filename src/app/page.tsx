import Link from "next/link";
import { redirect } from "next/navigation";
import { getCatalog } from "@/lib/notebooks";
import { getSiteUrl, toAbsoluteUrl } from "@/lib/site";

type HomePageProps = {
  searchParams?: {
    notebookId?: string | string[];
  };
};

const sectionStyle = {
  maxWidth: "1080px",
  margin: "0 auto",
  padding: "32px 20px 64px"
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const notebookId = Array.isArray(searchParams?.notebookId) ? searchParams.notebookId[0] : searchParams?.notebookId;
  const target = notebookId ? `/index.html?notebookId=${encodeURIComponent(notebookId)}` : "/index.html";
  if (notebookId) redirect(target);

  const catalog = await getCatalog();
  const siteUrl = getSiteUrl();
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Noema",
    alternateName: ["Noema Learning", "Noema AI Learning"],
    url: siteUrl
  };

  return (
    <main style={{ fontFamily: '"IBM Plex Sans", system-ui, sans-serif', color: "#0f172a", background: "#f8fafc" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
      <section style={{ ...sectionStyle, paddingTop: "64px" }}>
        <p style={{ color: "#2563eb", fontWeight: 700, marginBottom: "12px" }}>Notebook-first AI learning</p>
        <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 4rem)", lineHeight: 1.05, margin: 0 }}>
          Noemaで機械学習とLLMを
          <br />
          実践的に学ぶ
        </h1>
        <p style={{ maxWidth: "760px", fontSize: "1.1rem", lineHeight: 1.7, color: "#334155", marginTop: "20px" }}>
          Noemaは、Python・機械学習・ディープラーニング・LLM・強化学習をノートブック教材で学べる学習プラットフォームです。
          読みながら質問し、Colabでも試せます。
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
          <Link
            href="/learn"
            style={{
              background: "#0f172a",
              color: "#fff",
              padding: "12px 18px",
              borderRadius: "999px",
              textDecoration: "none",
              fontWeight: 700
            }}
          >
            教材一覧を見る
          </Link>
          <Link
            href="/index.html"
            style={{
              border: "1px solid #cbd5e1",
              color: "#0f172a",
              padding: "12px 18px",
              borderRadius: "999px",
              textDecoration: "none",
              fontWeight: 700
            }}
          >
            アプリを開く
          </Link>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1.8rem", marginBottom: "12px" }}>学べる内容</h2>
        <p style={{ color: "#475569", lineHeight: 1.7, maxWidth: "780px" }}>
          初学者向けのPython・機械学習から、上級者向けのディープラーニング、世界モデル、生成モデル、強化学習までカバーしています。
        </p>
        <div style={{ display: "grid", gap: "18px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: "24px" }}>
          {catalog.chapters.slice(0, 6).map((chapter) => (
            <section key={chapter.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "18px", padding: "20px" }}>
              <h3 style={{ marginTop: 0, marginBottom: "8px" }}>{chapter.title}</h3>
              <p style={{ color: "#475569", marginTop: 0 }}>{chapter.notebooks.length}本の教材</p>
              <ul style={{ paddingLeft: "18px", marginBottom: 0 }}>
                {chapter.notebooks.slice(0, 4).map((notebook) => (
                  <li key={notebook.id} style={{ marginBottom: "8px" }}>
                    <Link href={`/learn/${encodeURIComponent(notebook.id)}`} style={{ color: "#1d4ed8", textDecoration: "none" }}>
                      {notebook.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1.8rem", marginBottom: "12px" }}>代表ページ</h2>
        <ul style={{ paddingLeft: "20px", lineHeight: 1.9 }}>
          {catalog.chapters.slice(0, 3).flatMap((chapter) => chapter.notebooks.slice(0, 2)).map((notebook) => (
            <li key={notebook.id}>
              <Link href={`/learn/${encodeURIComponent(notebook.id)}`} style={{ color: "#1d4ed8", textDecoration: "none" }}>
                {notebook.title}
              </Link>
              {" · "}
              <span style={{ color: "#64748b" }}>{toAbsoluteUrl(`/learn/${encodeURIComponent(notebook.id)}`)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
