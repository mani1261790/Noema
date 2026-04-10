import { redirect } from "next/navigation";

export default function LearnNotebookPage({ params }: { params: { notebookId: string } }) {
  redirect(`/index.html?notebookId=${encodeURIComponent(params.notebookId)}`);
}
