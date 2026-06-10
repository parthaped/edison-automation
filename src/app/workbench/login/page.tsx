import { Suspense } from "react";
import WorkbenchLoginForm from "./login-form";

export const metadata = {
  title: "Sign in · Edison Papers Workbench",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm">Loading…</div>}>
      <WorkbenchLoginForm />
    </Suspense>
  );
}
