import { NotebookWorkspace } from "@/components/notebook-workspace";
import { getCurrentSession } from "@/lib/auth";
import { getCatalog, getNotebookById, getNotebookHtml } from "@/lib/notebooks";
import { prisma } from "@/lib/prisma";

type HomePageProps = {
  searchParams?: {
    notebookId?: string | string[];
  };
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const [catalog, session] = await Promise.all([getCatalog(), getCurrentSession()]);

  const firstNotebook = catalog.chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((chapter) => chapter.notebooks.slice().sort((a, b) => a.order - b.order))[0];

  const requestedNotebookId = Array.isArray(searchParams?.notebookId)
    ? searchParams?.notebookId[0]
    : searchParams?.notebookId;
  const selectedNotebook = requestedNotebookId ? await getNotebookById(requestedNotebookId) : null;
  const activeNotebook = selectedNotebook ?? firstNotebook;

  if (!activeNotebook) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-12">
        <h1 className="font-display text-3xl font-semibold">教材がまだありません</h1>
        <p className="text-muted mt-3">管理者が教材を追加すると、ここに学習ワークスペースが表示されます。</p>
      </main>
    );
  }

  const [html, chunks] = await Promise.all([
    getNotebookHtml(activeNotebook.htmlPath),
    prisma.notebookChunk
      .findMany({
        where: { notebookId: activeNotebook.id },
        orderBy: { position: "asc" },
        select: { sectionId: true }
      })
      .catch(() => [])
  ]);
  const sectionIds = Array.from(new Set(chunks.map((chunk) => chunk.sectionId))).filter(Boolean);

  return (
    <NotebookWorkspace
      chapters={catalog.chapters}
      initialHtml={html}
      initialNotebook={activeNotebook}
      initialSectionIds={sectionIds}
      user={
        session?.user
          ? {
              id: session.user.id,
              name: session.user.name,
              role: session.user.role
            }
          : null
      }
    />
  );
}
