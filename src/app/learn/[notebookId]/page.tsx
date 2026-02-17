import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LearningSidebar } from "@/components/learning-sidebar";
import { QuestionPanel } from "@/components/question-panel";
import { UserMenu } from "@/components/user-menu";
import { VideoPlayer } from "@/components/video-player";
import { getCurrentSession } from "@/lib/auth";
import { getCatalog, getNotebookById, getNotebookHtml } from "@/lib/notebooks";
import { prisma } from "@/lib/prisma";

export default async function LearnNotebookPage({ params }: { params: { notebookId: string } }) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [catalog, notebook, chunks] = await Promise.all([
    getCatalog(),
    getNotebookById(params.notebookId),
    prisma.notebookChunk.findMany({
      where: { notebookId: params.notebookId },
      orderBy: { position: "asc" },
      select: { sectionId: true }
    })
  ]);
  if (!notebook) {
    notFound();
  }

  const html = await getNotebookHtml(notebook.htmlPath);

  await prisma.accessLog
    .create({
      data: {
        userId: session.user.id,
        notebookId: notebook.id,
        action: "VIEW_NOTEBOOK"
      }
    })
    .catch(() => undefined);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1280px] flex-col gap-4 px-4 py-4 md:px-6">
      <header className="glass-panel rounded-2xl p-4 flex flex-col justify-between gap-2 md:flex-row md:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--accent)]">Noema Learning</p>
          <h1 className="font-display text-2xl font-semibold">{notebook.title}</h1>
        </div>
        <UserMenu name={session.user.name} role={session.user.role} />
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <LearningSidebar chapters={catalog.chapters} activeNotebookId={notebook.id} />

        <section className="space-y-4">
          {notebook.videoUrl ? <VideoPlayer src={notebook.videoUrl} title={notebook.title} /> : null}

          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Link
                className="glass-button rounded-md px-3 py-2 text-sm font-medium text-white"
                href={notebook.colabUrl}
                rel="noreferrer"
                target="_blank"
              >
                Colabで実行する
              </Link>
              {notebook.tags.map((tag) => (
                <span key={tag} className="glass-chip rounded-full px-2 py-1 text-xs">
                  {tag}
                </span>
              ))}
            </div>

            <div className="prose-noema max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
          </div>

          <QuestionPanel
            notebookId={notebook.id}
            sectionIds={Array.from(new Set(chunks.map((chunk) => chunk.sectionId))).filter(Boolean)}
          />
        </section>
      </div>
    </main>
  );
}
