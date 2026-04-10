import { redirect } from "next/navigation";

type HomePageProps = {
  searchParams?: {
    notebookId?: string | string[];
  };
};

export default function HomePage({ searchParams }: HomePageProps) {
  const notebookId = Array.isArray(searchParams?.notebookId) ? searchParams.notebookId[0] : searchParams?.notebookId;
  const target = notebookId ? `/index.html?notebookId=${encodeURIComponent(notebookId)}` : "/index.html";
  redirect(target);
}
