import { Suspense } from "react";
import { AuthPage } from "@/components/auth-page";
import { HelpNote } from "@/components/help-note";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Signup · SAR Analyzer" };

export default function SignupPage() {
  return (
    <AuthPage subtitle="Create an account">
      <Suspense>
        <SignupForm />
      </Suspense>
      <HelpNote page="signup" />
    </AuthPage>
  );
}
