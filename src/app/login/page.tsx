import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, homeFor } from "@/server/session";
import { isDemo } from "@/lib/env";
import { Wordmark } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const u = await getCurrentUser();
  if (u) redirect(homeFor(u.role));
  return (
    <main className="mx-auto flex min-h-[85dvh] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <Wordmark className="text-2xl text-black" />
        <p className="mt-2 text-muted">Sign in to My Cadence</p>
      </div>
      <div className="card p-5 sm:p-6">
        <LoginForm />
      </div>
      <p className="mt-4 text-center text-sm text-muted">Forgot your password? Contact the clinic and we&apos;ll reset it for you.</p>
      {isDemo() && (
        <p className="mt-6 text-center text-sm">
          <Link className="font-semibold text-pine-800 underline" href="/demo">
            Explore the demo with fictional accounts →
          </Link>
        </p>
      )}
    </main>
  );
}
