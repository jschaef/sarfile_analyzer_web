import { Suspense } from "react";
import { AuthPage } from "@/components/auth-page";
import { HelpNote } from "@/components/help-note";
import { LoginForm } from "./login-form";

export const metadata = { title: "Login · SAR Analyzer" };

export default function LoginPage() {
  return (
    <AuthPage subtitle="Sign in to analyse your sysstat sar files">
      {/* useSearchParams() needs a Suspense boundary with Cache Components */}
      <Suspense>
        <LoginForm />
      </Suspense>
      <HelpNote page="login" />
    </AuthPage>
  );
}
