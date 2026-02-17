import { redirect } from "next/navigation";
import { getCatalog } from "@/lib/notebooks";

export default async function LearnRootPage() {
  const catalog = await getCatalog();
  const firstNotebook = catalog.chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((chapter) => chapter.notebooks.slice().sort((a, b) => a.order - b.order))[0];

  if (!firstNotebook) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="font-display text-2xl font-semibold">教材がありません</h1>
        <p className="text-muted mt-2">管理画面から教材を追加してください。</p>
      </main>
    );
  }

  redirect(`/learn/${firstNotebook.id}`);
}
