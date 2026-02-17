import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { UserMenu } from "@/components/user-menu";
import { getCurrentSession, isAdminUser } from "@/lib/auth";
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

  const [questionCount, answerCount, notebookCount, latestQuestions] = await Promise.all([
    prisma.question.count(),
    prisma.answer.count(),
    prisma.notebook.count(),
    prisma.question.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        user: { select: { email: true, name: true } },
        answer: true
      }
    })
  ]);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-8">
      <header className="glass-panel rounded-2xl p-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">管理ダッシュボード</h1>
        <UserMenu name={session.user.name} role={session.user.role} />
      </header>

      <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat label="教材数" value={String(notebookCount)} />
        <Stat label="質問件数" value={String(questionCount)} />
        <Stat label="回答件数" value={String(answerCount)} />
      </section>

      <AdminConsole
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
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="glass-panel rounded-xl p-4">
      <p className="text-muted text-sm">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold">{value}</p>
    </article>
  );
}
