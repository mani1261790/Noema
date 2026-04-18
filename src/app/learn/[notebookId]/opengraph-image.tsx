import { ImageResponse } from "next/og";
import { getCatalog, getNotebookById } from "@/lib/notebooks";

export const runtime = "nodejs";
export const alt = "Noema lesson card";
export const size = {
  width: 1200,
  height: 630
};
export const contentType = "image/png";

type Props = {
  params: {
    notebookId: string;
  };
};

function toAsciiLabel(value: string | undefined, fallback: string): string {
  const normalized = String(value || "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

export default async function Image({ params }: Props) {
  const [catalog, notebook] = await Promise.all([getCatalog(), getNotebookById(params.notebookId)]);
  const chapter = catalog.chapters.find((item) => item.notebooks.some((candidate) => candidate.id === notebook?.id));
  const title = toAsciiLabel(notebook?.title, notebook?.id || "Noema lesson");
  const tags = notebook?.tags?.slice(0, 4) || [];
  const chapterTitle = toAsciiLabel(chapter?.title, chapter?.id || "Notebook lesson");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px",
          background:
            "radial-gradient(circle at 85% 15%, rgba(255,255,255,0.15), transparent 24%), radial-gradient(circle at 15% 80%, rgba(56,189,248,0.22), transparent 28%), linear-gradient(145deg, #071225 0%, #10253f 52%, #21415e 100%)",
          color: "#f8fbff"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              padding: "12px 18px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "#dcecff",
              fontSize: 28
            }}
          >
            {chapterTitle}
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: 1.5 }}>Noema</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.08,
              maxWidth: 980
            }}
          >
            {title}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "rgba(235,243,255,0.84)", maxWidth: 920, lineHeight: 1.45 }}>
            Read the lesson, open it in Colab, and continue in Noema&apos;s interactive learning interface.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {tags.length > 0
            ? tags.map((tag) => (
                <div
                  key={tag}
                  style={{
                    display: "flex",
                    padding: "10px 18px",
                    borderRadius: "999px",
                    background: "rgba(113,170,189,0.16)",
                    border: "1px solid rgba(113,170,189,0.4)",
                    color: "#dff5ff",
                    fontSize: 24
                  }}
                >
                  {tag}
                </div>
              ))
            : (
              <div
                style={{
                  display: "flex",
                  padding: "10px 18px",
                  borderRadius: "999px",
                  background: "rgba(113,170,189,0.16)",
                  border: "1px solid rgba(113,170,189,0.4)",
                  color: "#dff5ff",
                  fontSize: 24
                }}
              >
                notebook lesson
              </div>
            )}
        </div>
      </div>
    ),
    size
  );
}
