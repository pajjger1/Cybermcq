"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";
import { Authenticator } from "@aws-amplify/ui-react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import "@aws-amplify/ui-react/styles.css";
import Link from "next/link";

// Separate component for authenticated content to properly handle hooks
function AuthenticatedContent() {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const checkUserAndRedirect = async () => {
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        
        if (currentUser && !isRedirecting) {
          setIsRedirecting(true);
          const session = await fetchAuthSession();
          const groups: string[] = session?.tokens?.idToken?.payload?.["cognito:groups"] as string[] || [];
          
          if (groups.includes("Admin")) {
            // Redirect admin users to admin portal
            router.push("/admin");
          } else {
            // Redirect regular users to dashboard
            router.push("/dashboard");
          }
        }
      } catch (error) {
        console.error("Error checking user:", error);
        setIsRedirecting(false);
      }
    };

    checkUserAndRedirect();
  }, [router, isRedirecting]);

  if (isRedirecting) {
    return (
      <div className="rounded-xl border p-6 text-center">
        <div className="font-medium">Welcome! Setting up your dashboard...</div>
        <div className="mt-2 text-sm">Taking you to your personalized quiz dashboard...</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-6">
      <div className="font-medium">Account created successfully!</div>
      <div className="mt-2 text-sm">
        Go to <Link href="/dashboard" className="text-blue-600 hover:underline">Dashboard</Link> to start tracking your progress.
      </div>
    </div>
  );
}

export default function SignUpPage() {
  ensureAmplifyConfigured();

  return (
    <main className="relative min-h-screen grid place-items-center p-6">
      <Link
        href="/"
        className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-md bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-700 shadow hover:bg-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-600"
        aria-label="Go back to home"
      >
        <span aria-hidden>
          ←
        </span>
        <span>Home</span>
      </Link>
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Create Account</h1>
          <p className="text-purple-100">Join to track your quiz progress and improve your skills</p>
        </div>
        <Authenticator
          initialState="signUp"
          signUpAttributes={["email"]}
          socialProviders={[]}
          components={{
            Footer: () => (
              <div className="text-sm mt-2 text-center">
                Already have an account? <Link href="/auth/sign-in" className="text-blue-600">Sign In</Link>
              </div>
            ),
          }}
          loginMechanisms={["email"]}
        >
          <AuthenticatedContent />
        </Authenticator>
      </div>
    </main>
  );
}

