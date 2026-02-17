import { redirect } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import { getCurrentSession } from "@/lib/auth";

export default async function SignupPage() {
  const session = await getCurrentSession();
  if (session?.user?.id) {
    redirect("/learn");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-12">
      <SignupForm />
    </main>
  );
}
