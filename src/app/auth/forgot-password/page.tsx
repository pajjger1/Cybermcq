"use client";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";
import { resetPassword, confirmResetPassword } from "aws-amplify/auth";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  ensureAmplifyConfigured();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [stage, setStage] = useState<"request" | "confirm">("request");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode() {
    setErr(null);
    try {
      await resetPassword({ username: email });
      setStage("confirm");
      setMsg("Verification code sent.");
    } catch (e: any) {
      setErr(e?.message || "Failed to send code");
    }
  }

  async function submitNew() {
    setErr(null);
    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      setMsg("Password reset. You can sign in now.");
    } catch (e: any) {
      setErr(e?.message || "Failed to reset password");
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-xl border p-6 grid gap-3">
        <h1 className="text-xl font-semibold">Forgot Password</h1>
        {msg && <div className="text-green-700 text-sm">{msg}</div>}
        {err && <div className="text-red-700 text-sm">{err}</div>}
        {stage === "request" ? (
          <>
            <input className="border rounded p-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="bg-gray-900 text-white rounded px-3 py-2" onClick={sendCode}>Send code</button>
          </>
        ) : (
          <>
            <input className="border rounded p-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="border rounded p-2" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <input className="border rounded p-2" placeholder="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <button className="bg-gray-900 text-white rounded px-3 py-2" onClick={submitNew}>Reset password</button>
          </>
        )}
        <div className="text-sm">
          Back to <Link href="/auth/sign-in" className="text-blue-600">Sign in</Link>
        </div>
      </div>
    </main>
  );
}


