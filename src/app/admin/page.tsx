"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";
import { generateClient } from "aws-amplify/data";
import { getCurrentUser, fetchAuthSession, signOut } from "aws-amplify/auth";
import type { Schema } from "@/amplify/data/resource";
import { useRouter } from "next/navigation";

// Simple, Working Modal Component (rendered via portal to avoid stacking context issues)
function Modal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div 
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{
        backdropFilter: 'blur(8px)',
        backgroundColor: 'rgba(0, 0, 0, 0.5)'
      }}
      onClick={(e) => {
        // Only close if clicking the backdrop itself
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {title}
          </h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}


type Subject = { subjectId: string; subjectName: string; slug?: string; description?: string; links?: string[] };
type Question = {
  questionId: string;
  question: string;
  options: string[];
  answerIndex: number;
  tags?: string[];
  subjectId: string;
};

export default function AdminPage() {
  ensureAmplifyConfigured();
  const client = useMemo(() => generateClient<Schema>(), []);
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [showNewSubjectModal, setShowNewSubjectModal] = useState(false);
  const [showNewQuestionModal, setShowNewQuestionModal] = useState(false);
  const [showInlineQuestionForm, setShowInlineQuestionForm] = useState(false);

  // Data
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);

  // Forms
  const [subjectForm, setSubjectForm] = useState<{ subjectId?: string; subjectName: string; slug: string; description?: string; links?: string }>({ subjectName: "", slug: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle"|"checking"|"taken"|"available">("idle");
  const [slugMessage, setSlugMessage] = useState<string>("");

  function slugify(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60);
  }

  async function isSlugTaken(slug: string): Promise<boolean> {
    const { data } = await client.models.QuizSubject.list({ filter: { slug: { eq: slug } } });
    return data.some((s: any) => s.slug === slug && s.subjectId !== subjectForm.subjectId);
  }

  async function findAvailableSlug(base: string): Promise<string> {
    const clean = slugify(base);
    if (!(await isSlugTaken(clean))) return clean;
    for (let i = 2; i < 50; i++) {
      const candidate = `${clean}-${i}`;
      if (!(await isSlugTaken(candidate))) return candidate;
    }
    return `${clean}-${Date.now().toString().slice(-4)}`;
  }
  const [questionForm, setQuestionForm] = useState<{
    questionId?: string;
    question: string;
    options: [string, string, string, string];
    answerIndex: number;
    subjectId: string;
    tags: string;
  }>({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: "", tags: "" });

  // Helper function to get unique questions for a subject
  const getUniqueQuestionsForSubject = useCallback((subjectId: string) => {
    const filtered = questions.filter(q => q.subjectId === subjectId);
    
    // Remove duplicates based on questionId
    const uniqueQuestions = filtered.reduce((acc, current) => {
      const existingIndex = acc.findIndex(item => item.questionId === current.questionId);
      if (existingIndex === -1) {
        acc.push(current);
      }
      return acc;
    }, [] as Question[]);
    
    return uniqueQuestions;
  }, [questions]);

  // Filter questions by selected subject and ensure uniqueness
  const filteredQuestions = useMemo(() => {
    if (!selectedSubject) return [];
    return getUniqueQuestionsForSubject(selectedSubject.subjectId);
  }, [selectedSubject, getUniqueQuestionsForSubject]);

  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        
        // Force refresh the session to get latest group membership
        const session = await fetchAuthSession({ forceRefresh: true });
        const groups: string[] = session?.tokens?.idToken?.payload?.["cognito:groups"] as string[] || [];
        
        // Debug logging
        console.log("Current user:", user);
        console.log("Session:", session);
        console.log("ID Token payload:", session?.tokens?.idToken?.payload);
        console.log("User groups:", groups);
        console.log("Is admin?", groups.includes("Admin"));
        
        const isUserAdmin = groups.includes("Admin");
        setIsAdmin(isUserAdmin);
        
        if (!isUserAdmin) {
          console.log("User is not in Admin group. Groups found:", groups);
          console.log("Available groups in token:", Object.keys(session?.tokens?.idToken?.payload || {}));
          // Don't redirect immediately, let user see the debug info
          setTimeout(() => {
            router.push("/auth/sign-in");
          }, 10000); // Increased to 10 seconds
        }
      } catch (error) {
        console.error("Authentication error:", error);
        setIsAdmin(false);
        // Don't redirect immediately, let user see the debug info
        setTimeout(() => {
          router.push("/auth/sign-in");
        }, 10000);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    // Load subjects
    client.models.QuizSubject.list({}).then(({ data }) => {
      if (cancelled) return;
      setSubjects(data.map(s => ({
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        slug: (s as any).slug,
        links: (s as any).links || [],
        description: s.description || undefined
      })));
    });
    
    // Load questions
    client.models.QuizQuestion.list({}).then(({ data }) => {
      if (cancelled) return;
      const questionsData = data.map(q => ({
        questionId: q.questionId,
        question: q.question,
        options: q.options,
        answerIndex: q.options.indexOf(q.correctAnswer),
        subjectId: q.subjectId,
        tags: []
      }));
      
      // Remove duplicates based on questionId
      const uniqueQuestions = questionsData.reduce((acc, current) => {
        const existingIndex = acc.findIndex(item => item.questionId === current.questionId);
        if (existingIndex === -1) {
          acc.push(current);
        }
        return acc;
      }, [] as Question[]);
      
      setQuestions(uniqueQuestions);
    }).catch((error) => { console.error("Failed to load questions:", error); });

    return () => { cancelled = true; };
  }, [isAdmin, client]);

  const handleForceRefresh = async () => {
    try {
      setIsAdmin(null); // Set to loading state
      const session = await fetchAuthSession({ forceRefresh: true });
      const groups: string[] = session?.tokens?.idToken?.payload?.["cognito:groups"] as string[] || [];
      
      console.log("Force refresh - User groups:", groups);
      console.log("Force refresh - Is admin?", groups.includes("Admin"));
      
      setIsAdmin(groups.includes("Admin"));
    } catch (error) {
      console.error("Force refresh error:", error);
      setIsAdmin(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Sign out error:", error);
    } finally {
      router.push("/auth/sign-in");
    }
  };

  if (isAdmin === false) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-purple-400 via-purple-500 to-purple-600 p-6 flex items-center justify-center">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 shadow-2xl p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">Access Denied</h1>
              <p className="text-purple-100">You need admin privileges to access this area</p>
            </div>
            
            <div className="bg-amber-500/20 border border-amber-400/30 text-amber-100 px-6 py-4 rounded-2xl mb-6">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="space-y-2">
                  <p><strong>Your account needs to be added to the "Admin" group in AWS Cognito.</strong></p>
                  <p>Check the browser console for debug information.</p>
                  <p>Redirecting to sign-in in 10 seconds...</p>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <button 
                onClick={handleForceRefresh}
                className="flex-1 bg-blue-500/20 hover:bg-blue-500/30 text-blue-100 border border-blue-400/30 px-6 py-3 rounded-xl font-medium transition-all duration-200 hover:scale-105"
              >
                Force Refresh Session
              </button>
              <button 
                onClick={async () => { try { await signOut(); } catch (error) { console.error("Sign out error:", error); } finally { router.push("/auth/sign-in"); } }}
                className="flex-1 bg-gray-500/20 hover:bg-gray-500/30 text-gray-100 border border-gray-400/30 px-6 py-3 rounded-xl font-medium transition-all duration-200 hover:scale-105"
              >
                Sign Out & Back In
              </button>
            </div>
            
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
              <h3 className="text-white font-medium mb-3">If you should have admin access:</h3>
              <ol className="list-decimal list-inside space-y-2 text-purple-100 text-sm">
                <li>Click "Force Refresh Session" to refresh your JWT token</li>
                <li>Check the browser console for your current user groups</li>
                <li>Ensure your user is added to the "Admin" group in AWS Cognito</li>
                <li>Try signing out and signing back in</li>
              </ol>
            </div>
          </div>
        </div>
      </main>
    );
  }
  if (isAdmin === null) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-purple-400 via-purple-500 to-purple-600 p-6 flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 shadow-2xl p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Checking Access</h2>
            <p className="text-purple-100">Verifying your admin privileges...</p>
          </div>
        </div>
      </main>
    );
  }

  async function saveSubject() {
    if (subjectForm.subjectId) {
      // Update existing subject
      const { data } = await client.models.QuizSubject.update({
        id: subjectForm.subjectId,
        subjectName: subjectForm.subjectName,
        slug: subjectForm.slug,
        description: subjectForm.description,
        links: subjectForm.links ? subjectForm.links.split(",").map(l => l.trim()).filter(Boolean) : undefined
      });
      if (data && !Array.isArray(data)) {
        setSubjects((s) => s.map((x) => (x.subjectId === (data as any).subjectId ? {
          subjectId: (data as any).subjectId,
          subjectName: (data as any).subjectName,
          slug: (data as any).slug,
          links: (data as any).links || [],
          description: (data as any).description || undefined
        } : x)));
        // Update selected subject if it's the one being edited
        if (selectedSubject?.subjectId === (data as any).subjectId) {
          setSelectedSubject({
            subjectId: (data as any).subjectId,
            subjectName: (data as any).subjectName,
            slug: (data as any).slug,
            links: (data as any).links || [],
            description: (data as any).description || undefined
          });
        }
      }
    } else {
      // Create new subject
      const desiredSlug = subjectForm.slug || slugify(subjectForm.subjectName);
      const finalSlug = await findAvailableSlug(desiredSlug);
      const { data } = await client.models.QuizSubject.create({
        subjectId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        subjectName: subjectForm.subjectName,
        slug: finalSlug,
        description: subjectForm.description,
        links: subjectForm.links ? subjectForm.links.split(",").map(l => l.trim()).filter(Boolean) : undefined
      });
      if (data && !Array.isArray(data)) {
        setSubjects((s) => [{
          subjectId: (data as any).subjectId,
          subjectName: (data as any).subjectName,
          slug: (data as any).slug,
          links: (data as any).links || [],
          description: (data as any).description || undefined
        }, ...s]);
      }
    }
    setSubjectForm({ subjectName: "", slug: "" });
    setShowNewSubjectModal(false);
  }

  async function deleteSubject(id: string) {
    if (!confirm("Delete subject?")) return;
    // Find the subject by subjectId to get the actual id
    const subject = subjects.find(s => s.subjectId === id);
    if (subject) {
      const { data: allSubjects } = await client.models.QuizSubject.list({});
      const subjectToDelete = allSubjects.find(s => s.subjectId === id);
      if (subjectToDelete) {
        await client.models.QuizSubject.delete({ id: subjectToDelete.id });
        setSubjects((s) => s.filter((x) => x.subjectId !== id));
      }
    }
  }

  async function saveQuestion() {
    const correctAnswer = questionForm.options[questionForm.answerIndex];
    
    if (questionForm.questionId) {
      // Update existing question
      const { data: allQuestions } = await client.models.QuizQuestion.list({});
      const questionToUpdate = allQuestions.find(q => q.questionId === questionForm.questionId);
      if (questionToUpdate) {
        const { data } = await client.models.QuizQuestion.update({
          id: questionToUpdate.id,
          question: questionForm.question,
          options: questionForm.options,
          correctAnswer,
          subjectId: questionForm.subjectId
        });
        if (data && !Array.isArray(data)) {
          setQuestions((q) => q.map((x) => (x.questionId === (data as any).questionId ? {
            questionId: (data as any).questionId,
            question: (data as any).question,
            options: (data as any).options,
            answerIndex: (data as any).options.indexOf((data as any).correctAnswer),
            subjectId: (data as any).subjectId,
            tags: []
          } : x)));
        }
      }
    } else {
      // Create new question
      const { data } = await client.models.QuizQuestion.create({
        questionId: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        question: questionForm.question,
        options: questionForm.options,
        correctAnswer,
        subjectId: questionForm.subjectId,
        explanation: `The correct answer is: ${correctAnswer}`,
        difficulty: "MEDIUM"
      });
      if (data && !Array.isArray(data)) {
        const newQuestion = {
          questionId: (data as any).questionId,
          question: (data as any).question,
          options: (data as any).options,
          answerIndex: (data as any).options.indexOf((data as any).correctAnswer),
          subjectId: (data as any).subjectId,
          tags: []
        };
        
        setQuestions((q) => {
          // Check if question already exists to prevent duplicates
          const existingIndex = q.findIndex(item => item.questionId === (data as any).questionId);
          if (existingIndex === -1) {
            return [newQuestion, ...q];
          }
          return q; // Don't add if already exists
        });
      }
    }
    setQuestionForm({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: "", tags: "" });
    setShowNewQuestionModal(false);
    setShowInlineQuestionForm(false);
  }

  async function deleteQuestion(id: string) {
    if (!confirm("Delete question?")) return;
    // Find the question by questionId to get the actual id
    const { data: allQuestions } = await client.models.QuizQuestion.list({});
    const questionToDelete = allQuestions.find(q => q.questionId === id);
    if (questionToDelete) {
      await client.models.QuizQuestion.delete({ id: questionToDelete.id });
      setQuestions((q) => q.filter((x) => x.questionId !== id));
    }
  }


  // Modal component is declared above to keep identity stable across renders

  return (
    <div 
      style={{ 
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        minHeight: '100vh',
        background: '#7c3aed',
        padding: '2rem'
      }}
    >
      <div 
        style={{ 
          maxWidth: '1200px', 
          margin: '0 auto', 
          padding: '2rem',
          background: 'rgba(255, 255, 255, 0.95)',
          borderRadius: '32px',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.2)',
          backdropFilter: 'blur(20px)'
        }}
        role="main"
        aria-label="Quiz Administration Dashboard"
      >
        {/* Futuristic Header */}
        <header 
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '3rem',
            padding: '1.5rem',
            background: 'rgba(255, 255, 255, 0.8)',
            borderRadius: '20px',
            border: '1px solid rgba(124, 58, 237, 0.2)',
            boxShadow: '0 8px 32px rgba(124, 58, 237, 0.1)'
          }}
          role="banner"
        >
          <div>
            <h1 
              style={{ 
                margin: '0 0 0.5rem 0', 
                fontSize: '2.5rem', 
                fontWeight: '800',
                color: '#7c3aed',
                textShadow: '2px 2px 0px white, -2px -2px 0px white, 2px -2px 0px white, -2px 2px 0px white, 0px 2px 0px white, 2px 0px 0px white, 0px -2px 0px white, -2px 0px 0px white',
                letterSpacing: '-0.02em'
              }}
            >
              ⚡ MCQ Admin
            </h1>
            <p 
              style={{ 
                color: '#1f2937',
                fontSize: '1rem', 
                margin: 0,
                fontWeight: '500',
                letterSpacing: '0.01em',
                textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
              }}
            >
              Advanced Quiz Management System
            </p>
          </div>
          <nav 
            style={{ display: 'flex', gap: '0.75rem' }}
            role="navigation"
            aria-label="Main navigation"
          >
            <button 
              onClick={() => {
                setSubjectForm({ subjectName: "", slug: "" });
                setShowNewSubjectModal(true);
              }}
              style={{ 
                padding: '0.875rem 1.5rem', 
                border: '2px solid #7c3aed', 
                borderRadius: '16px', 
                cursor: 'pointer', 
                background: '#7c3aed',
                color: 'white',
                fontSize: '0.95rem',
                fontWeight: '600',
                boxShadow: '0 8px 25px -8px rgba(124, 58, 237, 0.4)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 12px 35px -8px rgba(124, 58, 237, 0.6)';
                e.currentTarget.style.background = '#8b5cf6';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 8px 25px -8px rgba(124, 58, 237, 0.4)';
                e.currentTarget.style.background = '#7c3aed';
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = '3px solid rgba(124, 58, 237, 0.5)';
                e.currentTarget.style.outlineOffset = '2px';
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = 'none';
              }}
              aria-label="Create new subject"
            >
              + New Subject
            </button>
            <button 
              onClick={() => {
                setQuestionForm({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: selectedSubject?.subjectId || "", tags: "" });
                setShowNewQuestionModal(true);
              }}
              style={{ 
                padding: '0.875rem 1.5rem', 
                border: '2px solid #7c3aed', 
                borderRadius: '16px', 
                cursor: 'pointer', 
                background: 'white', 
                color: '#7c3aed',
                fontSize: '0.95rem',
                fontWeight: '600',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#7c3aed';
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.textShadow = '1px 1px 2px rgba(0,0,0,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.color = '#7c3aed';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.textShadow = '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white';
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = '3px solid rgba(124, 58, 237, 0.5)';
                e.currentTarget.style.outlineOffset = '2px';
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = 'none';
              }}
              aria-label="Create new question"
            >
              + New Question
            </button>
            <button 
              onClick={() => router.push("/")}
              style={{ 
                padding: '0.875rem 1.5rem', 
                border: '2px solid #6b7280', 
                borderRadius: '16px', 
                cursor: 'pointer', 
                background: 'white', 
                color: '#374151',
                fontSize: '0.95rem',
                fontWeight: '500',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#6b7280';
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.textShadow = '1px 1px 2px rgba(0,0,0,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.color = '#374151';
                e.currentTarget.style.textShadow = '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white';
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = '3px solid rgba(107, 114, 128, 0.5)';
                e.currentTarget.style.outlineOffset = '2px';
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = 'none';
              }}
              aria-label="Return to home page"
            >
              ← Home
            </button>
            <button 
              onClick={handleSignOut}
              style={{ 
                padding: '0.875rem 1.5rem', 
                border: '2px solid #ef4444', 
                borderRadius: '16px', 
                cursor: 'pointer', 
                background: '#ef4444', 
                color: 'white',
                fontSize: '0.95rem',
                fontWeight: '600',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.background = '#dc2626';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.background = '#ef4444';
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = '3px solid rgba(239, 68, 68, 0.5)';
                e.currentTarget.style.outlineOffset = '2px';
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = 'none';
              }}
              aria-label="Sign out"
            >
              Sign Out
            </button>
          </nav>
        </header>

        {/* Main Content */}
        {!selectedSubject ? (
          // Subjects Landing Page
          <div>
            <h2 style={{ 
              fontSize: '1.25rem', 
              fontWeight: 'bold', 
              marginBottom: '1rem', 
              color: '#7c3aed',
              textShadow: '2px 2px 0px white, -2px -2px 0px white, 2px -2px 0px white, -2px 2px 0px white, 0px 2px 0px white, 2px 0px 0px white, 0px -2px 0px white, -2px 0px 0px white'
            }}>Subjects ({subjects.length})</h2>
            {subjects.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📚</div>
                <h3 style={{ 
                  fontWeight: '500', 
                  marginBottom: '0.5rem', 
                  color: '#1f2937',
                  textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                }}>No subjects yet</h3>
                <p style={{ 
                  color: '#4b5563', 
                  fontSize: '0.9rem',
                  textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                }}>Create your first subject to get started</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {subjects.map((s) => (
                  <div 
                    key={s.subjectId} 
                    style={{ 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '0.75rem', 
                      padding: '1.5rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: 'white'
                    }}
                    onClick={() => setSelectedSubject(s)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#d1d5db';
                      e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e5e7eb';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ 
                          fontWeight: '600', 
                          fontSize: '1.1rem', 
                          marginBottom: '0.5rem', 
                          color: '#7c3aed',
                          textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                        }}>{s.subjectName}</h3>
                        {s.description && (
                          <p style={{ 
                            color: '#4b5563', 
                            fontSize: '0.9rem', 
                            lineHeight: '1.5', 
                            marginBottom: '0.75rem',
                            textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                          }}>{s.description}</p>
                        )}
                        <div style={{ 
                          color: '#6b7280', 
                          fontSize: '0.8rem',
                          textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                        }}>
                          {getUniqueQuestionsForSubject(s.subjectId).length} questions
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSubjectForm({ subjectId: s.subjectId, subjectName: s.subjectName, slug: s.slug || "", description: s.description, links: (s.links || []).join(", ") });
                            setShowNewSubjectModal(true);
                          }}
                          style={{ 
                            padding: '0.5rem 0.75rem', 
                            border: '1px solid #d1d5db', 
                            borderRadius: '0.5rem', 
                            cursor: 'pointer', 
                            background: 'white', 
                            color: '#374151',
                            fontSize: '0.8rem'
                          }}
                        >
                          Edit
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSubject(s.subjectId);
                          }}
                          style={{ 
                            padding: '0.5rem 0.75rem', 
                            border: '1px solid #fca5a5', 
                            borderRadius: '0.5rem', 
                            cursor: 'pointer', 
                            background: '#fef2f2', 
                            color: '#dc2626',
                            fontSize: '0.8rem'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          // Subject Detail Page
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
              <button 
                onClick={() => setSelectedSubject(null)}
                style={{ 
                  padding: '0.5rem', 
                  border: '1px solid #d1d5db', 
                  borderRadius: '0.5rem', 
                  cursor: 'pointer', 
                  background: 'white', 
                  color: '#6b7280'
                }}
              >
                ← Back
              </button>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.25rem', color: '#111827' }}>{selectedSubject.subjectName}</h2>
                <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>/{selectedSubject.slug}</div>
                {selectedSubject.description && (
                  <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>{selectedSubject.description}</p>
                )}
              </div>
              <button 
                onClick={() => {
                  setSubjectForm({ subjectId: selectedSubject.subjectId, subjectName: selectedSubject.subjectName, slug: selectedSubject.slug || "", description: selectedSubject.description, links: (selectedSubject.links || []).join(", ") });
                  setShowNewSubjectModal(true);
                }}
                style={{ 
                  padding: '0.75rem 1rem', 
                  border: '1px solid #d1d5db', 
                  borderRadius: '0.75rem', 
                  cursor: 'pointer', 
                  background: 'white', 
                  color: '#374151',
                  fontSize: '0.9rem'
                }}
              >
                Edit Subject
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ 
                fontSize: '1.1rem', 
                fontWeight: '600', 
                margin: 0,
                color: '#7c3aed',
                textShadow: '2px 2px 0px white, -2px -2px 0px white, 2px -2px 0px white, -2px 2px 0px white, 0px 2px 0px white, 2px 0px 0px white, 0px -2px 0px white, -2px 0px 0px white'
              }}>
                Questions ({filteredQuestions.length})
              </h3>
            </div>
            
            <div style={{ marginBottom: '1.5rem' }}>
              <button 
                onClick={() => {
                  setQuestionForm({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: selectedSubject.subjectId, tags: "" });
                  setShowInlineQuestionForm(true);
                }}
                style={{ 
                  padding: '0.75rem 1.25rem', 
                  border: '2px solid #7c3aed', 
                  borderRadius: '12px', 
                  cursor: 'pointer', 
                  background: '#7c3aed',
                  color: 'white',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  textShadow: '1px 1px 2px rgba(0,0,0,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 20px rgba(124, 58, 237, 0.4)';
                  e.currentTarget.style.background = '#8b5cf6';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.3)';
                  e.currentTarget.style.background = '#7c3aed';
                }}
                onFocus={(e) => {
                  e.currentTarget.style.outline = '3px solid rgba(124, 58, 237, 0.5)';
                  e.currentTarget.style.outlineOffset = '2px';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = 'none';
                }}
                aria-label={`Add new question to ${selectedSubject.subjectName}`}
              >
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                </svg>
                Add Question
              </button>
            </div>
            
            {/* Inline Question Form */}
            {showInlineQuestionForm && (
              <div 
                style={{ 
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '2px solid #7c3aed',
                  borderRadius: '16px',
                  padding: '1.5rem',
                  marginBottom: '1.5rem',
                  boxShadow: '0 8px 32px rgba(124, 58, 237, 0.2)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ 
                    fontSize: '1rem', 
                    fontWeight: '600', 
                    margin: 0,
                    color: '#7c3aed',
                    textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                  }}>
                    New Question
                  </h4>
                  <button 
                    onClick={() => {
                      setShowInlineQuestionForm(false);
                      setQuestionForm({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: "", tags: "" });
                    }}
                    style={{ 
                      background: 'none',
                      border: 'none',
                      fontSize: '1.5rem',
                      cursor: 'pointer',
                      color: '#6b7280',
                      padding: '0.25rem'
                    }}
                    aria-label="Cancel adding question"
                  >
                    ×
                  </button>
                </div>
                
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <div>
                    <label style={{ 
                      display: 'block', 
                      fontWeight: '500', 
                      marginBottom: '0.5rem', 
                      color: '#1f2937',
                      textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                    }}>
                      Question
                    </label>
                    <textarea 
                      style={{ 
                        width: '100%', 
                        padding: '0.75rem', 
                        border: '2px solid #d1d5db', 
                        borderRadius: '8px',
                        fontSize: '1rem',
                        color: '#111827',
                        resize: 'vertical',
                        minHeight: '80px',
                        fontFamily: 'inherit'
                      }}
                      placeholder="Enter your question" 
                      value={questionForm.question} 
                      onChange={(e) => setQuestionForm((f) => ({ ...f, question: e.target.value }))} 
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = '#7c3aed';
                        e.currentTarget.style.outline = 'none';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = '#d1d5db';
                      }}
                    />
                  </div>
                  
                  <div>
                    <label style={{ 
                      display: 'block', 
                      fontWeight: '500', 
                      marginBottom: '0.5rem', 
                      color: '#1f2937',
                      textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                    }}>
                      Answer Options
                    </label>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {questionForm.options.map((o, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <input 
                            style={{ 
                              width: '100%', 
                              padding: '0.75rem', 
                              paddingRight: questionForm.answerIndex === i ? '3rem' : '0.75rem',
                              border: questionForm.answerIndex === i ? '2px solid #10b981' : '2px solid #d1d5db', 
                              borderRadius: '8px',
                              fontSize: '1rem',
                              background: questionForm.answerIndex === i ? '#ecfdf5' : 'white',
                              color: '#111827'
                            }}
                            placeholder={`Option ${i + 1}`} 
                            value={o} 
                            onChange={(e) => setQuestionForm((f) => { 
                              const next = [...f.options] as [string,string,string,string]; 
                              next[i] = e.target.value; 
                              return { ...f, options: next }; 
                            })} 
                            onFocus={(e) => {
                              if (questionForm.answerIndex !== i) {
                                e.currentTarget.style.borderColor = '#7c3aed';
                              }
                              e.currentTarget.style.outline = 'none';
                            }}
                            onBlur={(e) => {
                              if (questionForm.answerIndex !== i) {
                                e.currentTarget.style.borderColor = '#d1d5db';
                              }
                            }}
                          />
                          {questionForm.answerIndex === i && (
                            <div style={{ 
                              position: 'absolute', 
                              right: '0.75rem', 
                              top: '50%', 
                              transform: 'translateY(-50%)',
                              color: '#10b981',
                              fontWeight: 'bold',
                              fontSize: '1.2rem'
                            }}>
                              ✓
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <label style={{ 
                      display: 'block', 
                      fontWeight: '500', 
                      marginBottom: '0.5rem', 
                      color: '#1f2937',
                      textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                    }}>
                      Correct Answer
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                      {questionForm.options.map((option, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setQuestionForm((f) => ({ ...f, answerIndex: i }))}
                          style={{ 
                            padding: '0.75rem', 
                            border: questionForm.answerIndex === i ? '2px solid #10b981' : '2px solid #d1d5db', 
                            borderRadius: '8px', 
                            cursor: 'pointer', 
                            background: questionForm.answerIndex === i ? '#ecfdf5' : 'white', 
                            color: questionForm.answerIndex === i ? '#065f46' : '#374151',
                            fontSize: '0.9rem',
                            fontWeight: questionForm.answerIndex === i ? '600' : '400',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            if (questionForm.answerIndex !== i) {
                              e.currentTarget.style.borderColor = '#7c3aed';
                              e.currentTarget.style.background = '#f3f4f6';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (questionForm.answerIndex !== i) {
                              e.currentTarget.style.borderColor = '#d1d5db';
                              e.currentTarget.style.background = 'white';
                            }
                          }}
                        >
                          Option {i + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '1rem' }}>
                    <button 
                      onClick={() => {
                        saveQuestion();
                        setShowInlineQuestionForm(false);
                      }}
                      style={{ 
                        flex: 1,
                        padding: '0.75rem 1rem', 
                        border: '2px solid #7c3aed', 
                        borderRadius: '8px', 
                        cursor: 'pointer', 
                        background: '#7c3aed', 
                        color: 'white',
                        fontSize: '1rem',
                        fontWeight: '600',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.3)',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#8b5cf6';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#7c3aed';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      Save Question
                    </button>
                    <button 
                      onClick={() => {
                        setShowInlineQuestionForm(false);
                        setQuestionForm({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: "", tags: "" });
                      }}
                      style={{ 
                        padding: '0.75rem 1rem', 
                        border: '2px solid #6b7280', 
                        borderRadius: '8px', 
                        cursor: 'pointer', 
                        background: 'white', 
                        color: '#374151',
                        fontSize: '1rem',
                        fontWeight: '500',
                        textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#6b7280';
                        e.currentTarget.style.color = 'white';
                        e.currentTarget.style.textShadow = '1px 1px 2px rgba(0,0,0,0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'white';
                        e.currentTarget.style.color = '#374151';
                        e.currentTarget.style.textShadow = '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white';
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {filteredQuestions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0', border: '2px dashed #e5e7eb', borderRadius: '0.75rem' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❓</div>
                <h3 style={{ 
                  fontWeight: '500', 
                  marginBottom: '0.5rem', 
                  color: '#1f2937',
                  textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                }}>No questions yet</h3>
                <p style={{ 
                  color: '#4b5563', 
                  fontSize: '0.9rem',
                  textShadow: '1px 1px 0px white, -1px -1px 0px white, 1px -1px 0px white, -1px 1px 0px white'
                }}>Use the "Add Question" button above to create your first question</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {filteredQuestions.map((q, index) => (
                  <div 
                    key={`${q.questionId}-${index}`} 
                    style={{ 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '0.75rem', 
                      padding: '1.5rem',
                      background: 'white'
                    }}
                  >
                    <h4 style={{ fontWeight: '600', marginBottom: '1rem', fontSize: '1rem', color: '#111827' }}>{q.question}</h4>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
                      {q.options.map((option, i) => (
                        <div 
                          key={i} 
                          style={{ 
                            padding: '0.75rem', 
                            borderRadius: '0.5rem', 
                            fontSize: '0.9rem',
                            border: i === q.answerIndex ? '2px solid #10b981' : '1px solid #e5e7eb',
                            background: i === q.answerIndex ? '#ecfdf5' : '#f9fafb',
                            color: i === q.answerIndex ? '#065f46' : '#374151'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {i === q.answerIndex && <span style={{ color: '#10b981' }}>✓</span>}
                            <span style={{ fontWeight: '500' }}>{String.fromCharCode(65 + i)}.</span>
                            <span>{option}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                        Correct Answer: Option {q.answerIndex + 1}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button 
                          onClick={() => {
                            setQuestionForm({ 
                              questionId: q.questionId, 
                              question: q.question, 
                              options: q.options as [string,string,string,string], 
                              answerIndex: q.answerIndex, 
                              subjectId: q.subjectId, 
                              tags: (q.tags || []).join(", ") 
                            });
                            setShowNewQuestionModal(true);
                          }}
                          style={{ 
                            padding: '0.5rem 0.75rem', 
                            border: '1px solid #d1d5db', 
                            borderRadius: '0.5rem', 
                            cursor: 'pointer', 
                            background: 'white', 
                            color: '#374151',
                            fontSize: '0.8rem'
                          }}
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => deleteQuestion(q.questionId)}
                          style={{ 
                            padding: '0.5rem 0.75rem', 
                            border: '1px solid #fca5a5', 
                            borderRadius: '0.5rem', 
                            cursor: 'pointer', 
                            background: '#fef2f2', 
                            color: '#dc2626',
                            fontSize: '0.8rem'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* New Subject Modal */}
        <Modal 
          isOpen={showNewSubjectModal} 
          onClose={() => {
            setShowNewSubjectModal(false);
            setSubjectForm({ subjectName: "", slug: "" });
            setSlugEdited(false);
            setSlugStatus("idle");
            setSlugMessage("");
          }}
          title={subjectForm.subjectId ? "Edit Subject" : "New Subject"}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Subject Name
              </label>
              <input 
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-colors text-gray-900 placeholder:text-gray-400"
                placeholder="Enter subject name" 
                value={subjectForm.subjectName} 
                onChange={(e) => {
                  const name = e.target.value;
                  setSubjectForm((f) => ({ ...f, subjectName: name, slug: !slugEdited ? (name ? name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-") : "") : f.slug }));
                  if (!slugEdited) {
                    setSlugStatus("idle");
                    setSlugMessage("");
                  }
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Custom URL (slug)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">/</span>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-colors text-gray-900 placeholder:text-gray-400"
                  placeholder="e.g. test"
                  value={subjectForm.slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    const val = e.target.value;
                    const clean = val.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
                    setSubjectForm((f) => ({ ...f, slug: clean }));
                    setSlugStatus("idle");
                    setSlugMessage("");
                  }}
                  onBlur={async () => {
                    setSlugStatus("checking");
                    const base = subjectForm.slug || subjectForm.subjectName.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
                    const { data } = await client.models.QuizSubject.list({ filter: { slug: { eq: base } } });
                    const taken = data.some((s: any) => s.slug === base && s.subjectId !== subjectForm.subjectId);
                    if (taken) {
                      let i = 2; let suggestion = base;
                      while (i < 50) {
                        const candidate = `${base}-${i}`;
                        const { data: again } = await client.models.QuizSubject.list({ filter: { slug: { eq: candidate } } });
                        if (!again.some((s: any) => s.slug === candidate)) { suggestion = candidate; break; }
                        i++;
                      }
                      setSlugStatus("taken");
                      setSlugMessage(`Not available. Suggested: ${suggestion}`);
                      setSubjectForm((f) => ({ ...f, slug: suggestion }));
                    } else {
                      setSlugStatus("available");
                      setSlugMessage("Available");
                    }
                  }}
                />
              </div>
              {slugStatus !== "idle" && (
                <div className={slugStatus === "taken" ? "text-red-600 text-sm mt-1" : slugStatus === "available" ? "text-green-600 text-sm mt-1" : "text-gray-600 text-sm mt-1"}>{slugMessage}</div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description (Optional)
              </label>
              <textarea 
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-colors resize-vertical text-gray-900 placeholder:text-gray-400"
                rows={3}
                placeholder="Enter subject description" 
                value={subjectForm.description || ""} 
                onChange={(e) => setSubjectForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            
            <div className="flex gap-3 pt-4">
              <button 
                onClick={saveSubject}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200"
              >
                {subjectForm.subjectId ? "Update Subject" : "Create Subject"}
              </button>
              <button 
                onClick={() => {
                  setShowNewSubjectModal(false);
                  setSubjectForm({ subjectName: "", slug: "" });
                  setSlugEdited(false);
                  setSlugStatus("idle");
                  setSlugMessage("");
                }}
                className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>

        {/* New Question Modal */}
        <Modal 
          isOpen={showNewQuestionModal} 
          onClose={() => {
            setShowNewQuestionModal(false);
            setQuestionForm({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: "", tags: "" });
          }}
          title={questionForm.questionId ? "Edit Question" : "New Question"}
        >
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', color: '#111827' }}>Subject</label>
              <select 
                style={{ 
                  width: '100%', 
                  padding: '0.75rem', 
                  border: '1px solid #d1d5db', 
                  borderRadius: '0.5rem',
                  fontSize: '1rem',
                  color: '#111827'
                }}
                value={questionForm.subjectId} 
                onChange={(e) => setQuestionForm((f) => ({ ...f, subjectId: e.target.value }))}
              >
                <option value="">-- Select subject --</option>
                {subjects.map((s) => (
                  <option key={s.subjectId} value={s.subjectId}>{s.subjectName}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', color: '#111827' }}>Question</label>
              <textarea 
                style={{ 
                  width: '100%', 
                  padding: '0.75rem', 
                  border: '1px solid #d1d5db', 
                  borderRadius: '0.5rem',
                  fontSize: '1rem',
                  color: '#111827',
                  resize: 'vertical',
                  minHeight: '80px'
                }}
                placeholder="Enter your question" 
                value={questionForm.question} 
                onChange={(e) => setQuestionForm((f) => ({ ...f, question: e.target.value }))} 
              />
            </div>
            
            <div>
              <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', color: '#111827' }}>Answer Options</label>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {questionForm.options.map((o, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <input 
                      style={{ 
                        width: '100%', 
                        padding: '0.75rem', 
                        paddingRight: questionForm.answerIndex === i ? '3rem' : '0.75rem',
                        border: questionForm.answerIndex === i ? '2px solid #10b981' : '1px solid #d1d5db', 
                        borderRadius: '0.5rem',
                        fontSize: '1rem',
                        background: questionForm.answerIndex === i ? '#ecfdf5' : 'white',
                        color: '#111827'
                      }}
                      placeholder={`Option ${i + 1}`} 
                      value={o} 
                      onChange={(e) => setQuestionForm((f) => { 
                        const next = [...f.options] as [string,string,string,string]; 
                        next[i] = e.target.value; 
                        return { ...f, options: next }; 
                      })} 
                    />
                    {questionForm.answerIndex === i && (
                      <div style={{ 
                        position: 'absolute', 
                        right: '0.75rem', 
                        top: '50%', 
                        transform: 'translateY(-50%)',
                        color: '#10b981',
                        fontWeight: 'bold'
                      }}>
                        ✓
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            <div>
              <label style={{ display: 'block', fontWeight: '500', marginBottom: '0.5rem', color: '#111827' }}>Correct Answer</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                {questionForm.options.map((option, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setQuestionForm((f) => ({ ...f, answerIndex: i }))}
                    style={{ 
                      padding: '0.75rem', 
                      border: questionForm.answerIndex === i ? '2px solid #10b981' : '1px solid #d1d5db', 
                      borderRadius: '0.5rem', 
                      cursor: 'pointer', 
                      background: questionForm.answerIndex === i ? '#ecfdf5' : 'white', 
                      color: questionForm.answerIndex === i ? '#065f46' : '#374151',
                      fontSize: '0.9rem',
                      fontWeight: questionForm.answerIndex === i ? '600' : '400'
                    }}
                  >
                    Option {i + 1}
                  </button>
                ))}
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '1rem' }}>
              <button 
                onClick={saveQuestion}
                style={{ 
                  flex: 1,
                  padding: '0.75rem 1rem', 
                  border: '0', 
                  borderRadius: '0.5rem', 
                  cursor: 'pointer', 
                  background: '#111827', 
                  color: 'white',
                  fontSize: '1rem',
                  fontWeight: '500'
                }}
              >
                {questionForm.questionId ? "Update Question" : "Create Question"}
              </button>
              <button 
                onClick={() => {
                  setShowNewQuestionModal(false);
                  setQuestionForm({ question: "", options: ["", "", "", ""], answerIndex: 0, subjectId: "", tags: "" });
                }}
                style={{ 
                  padding: '0.75rem 1rem', 
                  border: '1px solid #d1d5db', 
                  borderRadius: '0.5rem', 
                  cursor: 'pointer', 
                  background: 'white', 
                  color: '#6b7280',
                  fontSize: '1rem'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
