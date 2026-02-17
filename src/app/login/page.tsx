import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentSession, getEnabledOAuthProviders } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session?.user?.id) {
    redirect("/learn");
  }

  const providers = getEnabledOAuthProviders();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-12">
      <LoginForm providers={providers} />
    </main>
  );
}
