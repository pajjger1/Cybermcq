"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

type Subject = { subjectId: string; subjectName: string; slug: string; description?: string };

export default function SubjectPage() {
  ensureAmplifyConfigured();
  const client = generateClient<Schema>();
  const params = useParams<{ slug: string }>();
  const slug = params.slug as string;
  const [subject, setSubject] = useState<Subject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await client.models.QuizSubject.list({ filter: { slug: { eq: slug } } });
        if (!cancelled) {
          const s = data[0];
          setSubject(s ? { subjectId: s.subjectId, subjectName: s.subjectName, slug: s.slug, description: s.description || undefined } : null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [client.models.QuizSubject, slug]);

  if (loading) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="text-white">Loading...</div>
      </main>
    );
  }

  if (!subject) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 text-white">
          <h1 className="text-2xl font-bold mb-2">Subject not found</h1>
          <Link href="/" className="underline">Go back</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-xl bg-white text-gray-900 rounded-3xl shadow-xl/20 shadow-black/30 p-8">
        <h1 className="text-3xl font-extrabold text-purple-700 tracking-tight">{subject.subjectName}</h1>
        {subject.description && <p className="text-gray-600 mt-2">{subject.description}</p>}
        <div className="mt-6">
          <Link href={`/?subjectId=${encodeURIComponent(subject.subjectId)}`} className="inline-flex items-center px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl">
            Start Quiz
          </Link>
        </div>
      </div>
    </main>
  );
}


