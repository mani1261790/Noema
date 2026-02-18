import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { getCurrentSession, isAdminUser } from "@/lib/auth";
import { getCatalog } from "@/lib/notebooks";
import { prisma } from "@/lib/prisma";

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const admin = await isAdminUser(session.user.id);
  if (!admin) {
    redirect("/learn");
  }

  const [latestQuestions, catalog] = await Promise.all([
    prisma.question.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { email: true, name: true } },
        answer: true
      }
    }),
    getCatalog()
  ]);

  const notebookCount = catalog.chapters.reduce((sum, chapter) => sum + chapter.notebooks.length, 0);
  const questionCount = latestQuestions.length;
  const answerCount = latestQuestions.filter((row) => Boolean(row.answer)).length;

  return (
    <>
      <div className="pointer-events-none fixed left-4 top-4 z-50">
        <div className="glass-chip rounded-full px-3 py-1 text-xs">
          教材数 {notebookCount} / 質問 {questionCount} / 回答 {answerCount}
        </div>
      </div>

      <AdminConsole
        initialChapters={catalog.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          order: chapter.order,
          notebooks: chapter.notebooks.map((notebook) => ({
            id: notebook.id,
            title: notebook.title,
            order: notebook.order,
            tags: notebook.tags,
            colabUrl: notebook.colabUrl,
            videoUrl: notebook.videoUrl,
            htmlPath: notebook.htmlPath
          }))
        }))}
        initialQuestions={latestQuestions.map((row) => ({
          id: row.id,
          user: row.user,
          notebookId: row.notebookId,
          sectionId: row.sectionId,
          questionText: row.questionText,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          answerText: row.answer?.answerText ?? null
        }))}
      />
    </>
  );
}
