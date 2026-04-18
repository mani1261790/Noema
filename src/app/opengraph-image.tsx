import { ImageResponse } from "next/og";

export const alt = "Noema";
export const size = {
  width: 1200,
  height: 630
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "54px",
          background:
            "radial-gradient(circle at top right, rgba(59,130,246,0.35), transparent 30%), radial-gradient(circle at bottom left, rgba(14,165,233,0.28), transparent 34%), linear-gradient(140deg, #071225 0%, #0f2238 58%, #16324b 100%)",
          color: "#f8fbff"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div
            style={{
              display: "flex",
              padding: "12px 20px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.16)",
              fontSize: 28,
              letterSpacing: 2
            }}
          >
            NOTEBOOK-FIRST AI LEARNING
          </div>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, letterSpacing: 2 }}>Noema</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 920 }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800, lineHeight: 1.02 }}>
            Learn ML and LLMs
          </div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800, lineHeight: 1.02 }}>
            Through Notebooks
          </div>
          <div style={{ display: "flex", fontSize: 32, lineHeight: 1.45, color: "rgba(235,243,255,0.84)" }}>
            Python, machine learning, deep learning, LLMs, and reinforcement learning in one notebook-first platform.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {["Python", "Machine Learning", "Deep Learning", "LLM", "Reinforcement Learning"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "10px 18px",
                borderRadius: "999px",
                background: "rgba(113,170,189,0.15)",
                border: "1px solid rgba(113,170,189,0.38)",
                color: "#dff5ff",
                fontSize: 24
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
