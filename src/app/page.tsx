import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <p className="font-mono text-sm uppercase tracking-widest text-[var(--accent)]">Noema</p>
      <h1 className="mt-3 font-display text-5xl font-semibold leading-tight">LLMと機械学習を段階的に学ぶ教材サイト</h1>
      <p className="text-muted mt-6 max-w-2xl text-lg">
        ipynb教材をHTMLで読みながら、Colab実行とRAG質問応答を組み合わせて学習できるプラットフォームです。
      </p>

      <div className="mt-8 flex gap-3">
        <Link className="glass-button rounded-lg px-5 py-3 text-white" href="/login">
          ログイン
        </Link>
        <Link className="glass-button-ghost rounded-lg px-5 py-3" href="/learn">
          教材を開く
        </Link>
      </div>
    </main>
  );
}
