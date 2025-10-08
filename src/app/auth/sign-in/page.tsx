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
            // Redirect regular users to home
            router.push("/");
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
        <div className="font-medium">Redirecting...</div>
        <div className="mt-2 text-sm">Taking you to the appropriate portal...</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-6">
      <div className="font-medium">Signed in as {user?.username}</div>
      <div className="mt-2 text-sm">
        Go to <Link href="/" className="text-blue-600 hover:underline">Home</Link> or <Link href="/admin" className="text-blue-600 hover:underline">Admin</Link>.
      </div>
    </div>
  );
}

export default function SignInPage() {
  ensureAmplifyConfigured();

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md">
        <Authenticator
          signUpAttributes={[]}
          socialProviders={[]}
          components={{
            Footer: () => (
              <div className="text-sm mt-2">
                <Link href="/auth/forgot-password" className="text-blue-600">Forgot password?</Link>
              </div>
            ),
          }}
          loginMechanisms={["email"]}
          hideSignUp
        >
          <AuthenticatedContent />
        </Authenticator>
      </div>
    </main>
  );
}


