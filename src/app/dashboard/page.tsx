"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { getCurrentUser, fetchAuthSession, signOut } from "aws-amplify/auth";
import { useRouter } from "next/navigation";

type Subject = {
  subjectId: string;
  subjectName: string;
  description?: string;
};

type UserStats = {
  subjectId: string;
  subjectName: string;
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number;
  totalSessions: number;
  bestScore: number;
  averageScore: number;
  lastAttempted: string;
  difficulty?: string;
};

type ProgressData = {
  questionId: string;
  subjectId: string;
  isCorrect: boolean;
  difficulty?: string;
  timestamp: string;
};

type SessionData = {
  id: string;
  subjectId?: string;
  subjectName: string;
  questionCount: number;
  score: number;
  accuracy: number;
  startTime: string;
  endTime?: string;
  completed: boolean;
};

export default function DashboardPage() {
  ensureAmplifyConfigured();
  const client = useMemo(() => generateClient<Schema>(), []);
  const router = useRouter();
  
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [recentProgress, setRecentProgress] = useState<ProgressData[]>([]);
  const [recentSessions, setRecentSessions] = useState<SessionData[]>([]);
  const [overallStats, setOverallStats] = useState({
    totalAnswered: 0,
    totalCorrect: 0,
    overallAccuracy: 0,
    subjectsAttempted: 0
  });
  const [refreshing, setRefreshing] = useState(false);

  const formatDate = (iso: string) => {
    try {
      const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-GB';
      return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
    } catch {
      return new Date(iso).toISOString().slice(0, 10);
    }
  };

  // Check authentication
  useEffect(() => {
    (async () => {
      try {
        const currentUser = await getCurrentUser();
        const session = await fetchAuthSession();
        const idPayload: any = session?.tokens?.idToken?.payload ?? {};
        const emailFromToken: string | undefined = idPayload?.email as string | undefined;
        const emailFallback: string = (currentUser as any)?.signInDetails?.loginId || currentUser?.username || "";

        setIsAuthenticated(true);
        setUserEmail(emailFromToken || emailFallback);
        setUserId(currentUser.userId);
      } catch {
        setIsAuthenticated(false);
        router.push("/auth/sign-in");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // Load subjects
  useEffect(() => {
    if (!isAuthenticated) return;
    
    (async () => {
      try {
        const { data: subjectsData } = await client.models.QuizSubject.list({});
        setSubjects(subjectsData.map(s => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          description: s.description || undefined
        })));
      } catch (e: any) {
        console.error("Failed to load subjects:", e);
      }
    })();
  }, [client, isAuthenticated]);

  // Load user progress data
  const loadUserData = async () => {
    if (!isAuthenticated || !userId) return;
    
    try {
      // Get user progress data
      const { data: progressData } = await client.models.UserProgress.list({
        filter: { userId: { eq: userId } },
        authMode: 'userPool'
      });

      // Get recent progress (last 10 attempts)
      const sortedProgress = progressData
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);
      
      setRecentProgress(sortedProgress.map(p => ({
        questionId: p.questionId,
        subjectId: p.subjectId,
        isCorrect: p.isCorrect,
        difficulty: p.difficulty || undefined,
        timestamp: p.timestamp
      })));

      // Get recent sessions
      const { data: sessionData } = await client.models.QuizSession.list({
        filter: { userId: { eq: userId }, completed: { eq: true } },
        authMode: 'userPool'
      });

      const sortedSessions = sessionData
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        .slice(0, 5);

      setRecentSessions(sortedSessions.map(s => ({
        id: s.id,
        subjectId: s.subjectId || undefined,
        subjectName: s.subjectName,
        questionCount: s.questionCount,
        score: s.score,
        accuracy: s.accuracy,
        startTime: s.startTime,
        endTime: s.endTime || undefined,
        completed: s.completed
      })));

      // Get user subject stats (raw, may include duplicates/zeros from earlier runs)
      const { data: userStatsData } = await client.models.UserSubjectStats.list({
        filter: { userId: { eq: userId } },
        authMode: 'userPool'
      });

      // Build helper maps from live progress and sessions
      const progressBySubject = new Map<string, { total: number; correct: number; last: string }>();
      for (const p of progressData) {
        const entry = progressBySubject.get(p.subjectId) || { total: 0, correct: 0, last: '' };
        entry.total += 1;
        if (p.isCorrect) entry.correct += 1;
        if (!entry.last || new Date(p.timestamp).getTime() > new Date(entry.last).getTime()) {
          entry.last = p.timestamp;
        }
        progressBySubject.set(p.subjectId, entry);
      }

      const sessionsBySubject = new Map<string, { totalSessions: number; bestScore: number; scoreSum: number }>();
      for (const s of sessionData) {
        const sid = s.subjectId || 'general';
        const entry = sessionsBySubject.get(sid) || { totalSessions: 0, bestScore: 0, scoreSum: 0 };
        entry.totalSessions += 1;
        if (s.score > entry.bestScore) entry.bestScore = s.score;
        entry.scoreSum += s.score;
        sessionsBySubject.set(sid, entry);
      }

      // Deduplicate stats by subjectId, pick most recent by lastAttempted
      const statsBySubject = new Map<string, typeof userStatsData[number]>();
      for (const s of userStatsData) {
        const existing = statsBySubject.get(s.subjectId);
        if (!existing) {
          statsBySubject.set(s.subjectId, s);
        } else {
          const a = new Date(existing.lastAttempted).getTime();
          const b = new Date(s.lastAttempted).getTime();
          if (b >= a) statsBySubject.set(s.subjectId, s);
        }
      }

      // Union of subjects from progress, sessions, and stored stats
      const allSubjectIds = new Set<string>([
        ...Array.from(progressBySubject.keys()),
        ...Array.from(sessionsBySubject.keys()),
        ...Array.from(statsBySubject.keys()),
      ]);

      const finalStats: UserStats[] = Array.from(allSubjectIds).map((sid) => {
        const stored = statsBySubject.get(sid);
        const prog = progressBySubject.get(sid) || { total: 0, correct: 0, last: '' };
        const sess = sessionsBySubject.get(sid) || { totalSessions: 0, bestScore: 0, scoreSum: 0 };
        const totalQuestions = stored && stored.totalQuestions > 0 ? stored.totalQuestions : prog.total;
        const correctAnswers = stored && stored.correctAnswers > 0 ? stored.correctAnswers : prog.correct;
        const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : (stored?.accuracy ?? 0);
        const totalSessions = stored && stored.totalSessions > 0 ? stored.totalSessions : sess.totalSessions;
        const bestScore = stored && stored.bestScore > 0 ? stored.bestScore : sess.bestScore;
        const averageScore = stored && stored.averageScore > 0 ? stored.averageScore : (sess.totalSessions > 0 ? sess.scoreSum / sess.totalSessions : 0);
        const subjectName = stored?.subjectName || (subjects.find(s => s.subjectId === sid)?.subjectName ?? 'Mixed Topics');
        const lastAttempted = stored?.lastAttempted || prog.last || new Date(0).toISOString();

        return {
          subjectId: sid,
          subjectName,
          totalQuestions,
          correctAnswers,
          accuracy,
          totalSessions,
          bestScore,
          averageScore,
          lastAttempted,
        };
      });

      // Sort and set for UI (unique subjectId keys)
      setUserStats(finalStats.sort((a, b) => new Date(b.lastAttempted).getTime() - new Date(a.lastAttempted).getTime()));

      // Calculate overall stats from raw progress
      const totalAnswered = progressData.length;
      const totalCorrect = progressData.filter(p => p.isCorrect).length;
      const overallAccuracy = totalAnswered > 0 ? (totalCorrect / totalAnswered) * 100 : 0;
      const subjectsAttempted = allSubjectIds.size;

      setOverallStats({
        totalAnswered,
        totalCorrect,
        overallAccuracy,
        subjectsAttempted
      });

    } catch (e: any) {
      console.error("Failed to load user progress:", e);
    }
  };

  const refreshData = async () => {
    setRefreshing(true);
    await loadUserData();
    setRefreshing(false);
  };

  // Debug utilities removed for production UI

  useEffect(() => {
    loadUserData();
  }, [client, isAuthenticated, userId]);

  // Auto-refresh every 30 seconds when user is on the page
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    
    const interval = setInterval(() => {
      loadUserData();
    }, 30000);

    return () => clearInterval(interval);
  }, [isAuthenticated, userId]);

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const getPerformanceBadge = (accuracy: number) => {
    if (accuracy >= 90) return { text: "Excellent", color: "bg-green-100 text-green-800" };
    if (accuracy >= 80) return { text: "Very Good", color: "bg-blue-100 text-blue-800" };
    if (accuracy >= 70) return { text: "Good", color: "bg-yellow-100 text-yellow-800" };
    if (accuracy >= 60) return { text: "Fair", color: "bg-orange-100 text-orange-800" };
    return { text: "Needs Work", color: "bg-red-100 text-red-800" };
  };

  const getImprovementSuggestion = (stats: UserStats) => {
    if (stats.accuracy < 60) {
      return "Focus on understanding the fundamentals. Review basic concepts and practice more questions.";
    }
    if (stats.accuracy < 70) {
      return "Good progress! Try to identify weak areas and practice similar questions.";
    }
    if (stats.accuracy < 80) {
      return "You're doing well! Focus on attention to detail and time management.";
    }
    if (stats.accuracy < 90) {
      return "Great job! Fine-tune your knowledge with advanced practice questions.";
    }
    return "Excellent performance! You've mastered this subject. Consider helping others or exploring advanced topics.";
  };

  if (loading) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="text-white text-xl">Loading your dashboard...</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect to sign-in
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-400 via-purple-500 to-fuchsia-600 text-white p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-purple-100">Welcome back, {userEmail}</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={refreshData}
              disabled={refreshing}
              className={`px-4 py-2 rounded-lg transition-colors ${
                refreshing 
                  ? 'bg-white/10 text-purple-200 cursor-not-allowed' 
                  : 'bg-white/20 hover:bg-white/30 text-white'
              }`}
            >
              {refreshing ? '↻ Refreshing...' : '↻ Refresh'}
            </button>
            <Link
              href="/"
              className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              Take Quiz
            </Link>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/20 backdrop-blur-sm rounded-xl p-6">
            <div className="text-2xl font-bold">{overallStats.totalAnswered}</div>
            <div className="text-purple-100">Questions Answered</div>
          </div>
          <div className="bg-white/20 backdrop-blur-sm rounded-xl p-6">
            <div className="text-2xl font-bold">{overallStats.totalCorrect}</div>
            <div className="text-purple-100">Correct Answers</div>
          </div>
          <div className="bg-white/20 backdrop-blur-sm rounded-xl p-6">
            <div className="text-2xl font-bold">{overallStats.overallAccuracy.toFixed(1)}%</div>
            <div className="text-purple-100">Overall Accuracy</div>
          </div>
          <div className="bg-white/20 backdrop-blur-sm rounded-xl p-6">
            <div className="text-2xl font-bold">{overallStats.subjectsAttempted}</div>
            <div className="text-purple-100">Subjects Attempted</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Subject Progress */}
          <div className="bg-white/20 backdrop-blur-sm rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Subject Progress</h2>
            {userStats.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-purple-100 mb-4">No progress data yet</div>
                <Link
                  href="/"
                  className="inline-block px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
                >
                  Start Your First Quiz
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {userStats.map((stats) => {
                  const badge = getPerformanceBadge(stats.accuracy);
                  return (
                    <div key={stats.subjectId} className="bg-white/10 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-medium">{stats.subjectName}</h3>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.color}`}>
                          {badge.text}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm mb-3">
                        <div>
                          <div className="text-purple-100">Questions</div>
                          <div className="font-semibold">{stats.totalQuestions}</div>
                        </div>
                        <div>
                          <div className="text-purple-100">Correct</div>
                          <div className="font-semibold">{stats.correctAnswers}</div>
                        </div>
                        <div>
                          <div className="text-purple-100">Accuracy</div>
                          <div className="font-semibold">{stats.accuracy.toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="text-purple-100">Sessions</div>
                          <div className="font-semibold">{stats.totalSessions}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-xs mb-3">
                        <div>
                          <div className="text-purple-100">Best Score</div>
                          <div className="font-semibold">{stats.bestScore}/{stats.totalSessions > 0 ? Math.ceil(stats.totalQuestions / stats.totalSessions) : 0}</div>
                        </div>
                        <div>
                          <div className="text-purple-100">Avg Score</div>
                          <div className="font-semibold">{stats.averageScore.toFixed(1)}</div>
                        </div>
                      </div>
                      <div className="w-full bg-white/20 rounded-full h-2 mb-2">
                        <div
                          className="bg-gradient-to-r from-green-400 to-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(stats.accuracy, 100)}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-purple-100">
                        Last attempted: {formatDate(stats.lastAttempted)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Improvement Suggestions */}
          <div className="space-y-6">
            {/* Recent Sessions */}
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-4">Recent Sessions</h2>
              {recentSessions.length === 0 ? (
                <div className="text-purple-100">No recent sessions</div>
              ) : (
                <div className="space-y-3">
                  {recentSessions.map((session) => {
                    const sessionDate = new Date(session.startTime);
                    const durationMinutes = session.endTime 
                      ? Math.round((new Date(session.endTime).getTime() - sessionDate.getTime()) / 60000)
                      : null;
                    
                    return (
                      <div key={session.id} className="bg-white/10 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-medium">{session.subjectName}</h3>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            session.accuracy >= 80 
                              ? 'bg-green-100 text-green-800' 
                              : session.accuracy >= 60
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {session.accuracy.toFixed(1)}%
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                          <div>
                            <div className="text-purple-100">Score</div>
                            <div className="font-semibold">{session.score}/{session.questionCount}</div>
                          </div>
                          <div>
                            <div className="text-purple-100">Questions</div>
                            <div className="font-semibold">{session.questionCount}</div>
                          </div>
                          <div>
                            <div className="text-purple-100">Duration</div>
                            <div className="font-semibold">{durationMinutes ? `${durationMinutes}m` : 'N/A'}</div>
                          </div>
                        </div>
                        <div className="text-xs text-purple-100">
                          {formatDate(session.startTime)} at {new Intl.DateTimeFormat(typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(sessionDate)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Improvement Tips */}
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-4">Improvement Tips</h2>
              {userStats.length === 0 ? (
                <div className="text-purple-100">Take some quizzes to get personalized tips!</div>
              ) : (
                <div className="space-y-4">
                  {userStats.slice(0, 3).map((stats) => (
                    <div key={stats.subjectId} className="bg-white/10 rounded-lg p-4">
                      <h3 className="font-medium mb-2">{stats.subjectName}</h3>
                      <p className="text-sm text-purple-100">
                        {getImprovementSuggestion(stats)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

