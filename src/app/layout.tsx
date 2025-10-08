import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "MCQ Quiz" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-indigo-400 via-purple-500 to-fuchsia-600 text-white antialiased">{children}</body>
    </html>
  );
}


