"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

type Subject = {
  subjectId: string;
  subjectName: string;
  description?: string;
};

type QuizQuestion = {
  questionId: string;
  question: string;
  options: string[];
  answerIndex: number;
};

type UserAnswer = {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
};

type QuizState = 'setup' | 'active' | 'completed';

export default function PublicPage() {
  ensureAmplifyConfigured();
  const client = useMemo(() => generateClient<Schema>(), []);
  
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [countInput, setCountInput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableQuestions, setAvailableQuestions] = useState<number>(0);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [role, setRole] = useState<string>("User");
  
  // Derived: parsed numeric count and validity
  const countNumber = useMemo(() => {
    if (countInput.trim() === "") return NaN;
    const parsed = Number(countInput);
    return Number.isFinite(parsed) ? parsed : NaN;
  }, [countInput]);
  const isCountValid = useMemo(() => {
    return Number.isInteger(countNumber) && countNumber >= 1 && countNumber <= (availableQuestions || 0);
  }, [countNumber, availableQuestions]);

  // Keep input within dynamic bounds when subject changes
  useEffect(() => {
    if (countInput === "") return;
    if (!Number.isFinite(countNumber)) return;
    if (availableQuestions > 0 && countNumber > availableQuestions) {
      setCountInput(String(availableQuestions));
    }
  }, [availableQuestions]);
  
  // Quiz state management
  const [quizState, setQuizState] = useState<QuizState>('setup');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: subjectsData } = await client.models.QuizSubject.list({});
        setSubjects(subjectsData.map(s => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          description: s.description || undefined
        })));
      } catch (e: any) {
        setError(e?.message || "Failed to load subjects");
      }
    })();
  }, [client]);

  // Determine authentication state, user email, and role from Cognito group
  useEffect(() => {
    (async () => {
      try {
        const currentUser = await getCurrentUser();
        const session = await fetchAuthSession();
        const idPayload: any = session?.tokens?.idToken?.payload ?? {};
        const groups: string[] = (idPayload?.["cognito:groups"] as string[]) || [];
        const emailFromToken: string | undefined = idPayload?.email as string | undefined;
        const emailFallback: string = (currentUser as any)?.signInDetails?.loginId || currentUser?.username || "";

        setIsAuthenticated(true);
        setUserEmail(emailFromToken || emailFallback);
        setUserId(currentUser.userId);
        if (groups.includes("Admin")) {
          setRole("Admin");
        } else if (groups.length > 0) {
          setRole(groups[0]);
        } else {
          setRole("User");
        }
      } catch {
        setIsAuthenticated(false);
        setUserEmail("");
        setUserId("");
        setRole("User");
      }
    })();
  }, []);

  // Helper: fetch all questions across pages (optionally filtered by subject)
  const listAllQuestions = useCallback(async (subjectFilter?: string) => {
    const all: any[] = [];
    let nextToken: string | undefined = undefined;
    do {
      const args: any = {};
      if (subjectFilter) args.filter = { subjectId: { eq: subjectFilter } };
      if (nextToken) args.nextToken = nextToken;
      const res: any = await client.models.QuizQuestion.list(args);
      all.push(...(res.data || []));
      nextToken = res.nextToken as string | undefined;
    } while (nextToken);
    // Deduplicate and keep only valid questions
    const uniqueMap = new Map<string, any>();
    for (const q of all) {
      if (!uniqueMap.has(q.questionId)) uniqueMap.set(q.questionId, q);
    }
    const unique = Array.from(uniqueMap.values());
    const valid = unique.filter((q) => Array.isArray(q.options) && q.options.indexOf(q.correctAnswer) >= 0);
    return valid;
  }, [client]);

  // Update available question count when subject changes
  useEffect(() => {
    (async () => {
      try {
        const valid = await listAllQuestions(subjectId || undefined);
        setAvailableQuestions(valid.length);
      } catch (e: any) {
        console.error("Failed to count questions:", e);
        setAvailableQuestions(0);
      }
    })();
  }, [subjectId, client, listAllQuestions]);

  const selectedSubject = useMemo(
    () => subjects.find((s) => s.subjectId === subjectId) || null,
    [subjects, subjectId]
  );

  async function saveUserProgress(question: QuizQuestion, selectedIndex: number, isCorrect: boolean) {
    try {
      const result = await client.models.UserProgress.create({
        userId: userId,
        subjectId: subjectId || 'general',
        questionId: question.questionId,
        sessionId: currentSessionId,
        isCorrect: isCorrect,
        selectedAnswer: question.options[selectedIndex],
        correctAnswer: question.options[question.answerIndex],
        difficulty: 'medium', // Default difficulty
        timestamp: new Date().toISOString()
      }, { authMode: 'userPool' });
      
      console.log('Progress saved successfully for question:', question.questionId);
    } catch (error) {
      console.error('Failed to save user progress:', error);
    }
  }

  async function createQuizSession(questionCount: number) {
    if (!isAuthenticated || !userId) return null;
    
    try {
      const sessionData = await client.models.QuizSession.create({
        userId,
        subjectId: subjectId || null,
        subjectName: selectedSubject?.subjectName || 'Mixed Topics',
        questionCount,
        score: 0,
        accuracy: 0,
        startTime: new Date().toISOString(),
        completed: false
      }, { authMode: 'userPool' });
      
      const newId = (sessionData as unknown as { data?: { id?: string } })?.data?.id;
      console.log('Session created with ID:', newId);
      return newId || null;
    } catch (error) {
      console.error('Failed to create quiz session:', error);
      return null;
    }
  }

  async function completeQuizSession() {
    if (!currentSessionId || !isAuthenticated) return;
    
    try {
      const score = userAnswers.filter(answer => answer.isCorrect).length;
      const accuracy = userAnswers.length > 0 ? (score / userAnswers.length) * 100 : 0;
      
      const result = await client.models.QuizSession.update({
        id: currentSessionId,
        score,
        accuracy,
        endTime: new Date().toISOString(),
        completed: true
      }, { authMode: 'userPool' });
      
      console.log('Session completed with score:', score, '/', userAnswers.length);
    } catch (error) {
      console.error('Failed to complete quiz session:', error);
    }
  }

  async function updateSubjectStats() {
    if (!isAuthenticated || !userId) return;
    
    try {
      const effectiveSubjectId = subjectId || 'general';
      
      // Get all user progress for this subject to calculate stats
      const { data: progressData } = await client.models.UserProgress.list({
        filter: { 
          userId: { eq: userId },
          subjectId: { eq: effectiveSubjectId }
        },
        authMode: 'userPool'
      });

      // Get all sessions for this subject to calculate session stats
      const { data: sessionData } = await client.models.QuizSession.list({
        filter: {
          userId: { eq: userId },
          subjectId: subjectId ? { eq: subjectId } : { attributeExists: false },
          completed: { eq: true }
        },
        authMode: 'userPool'
      });

      const totalQuestions = progressData.length;
      const correctAnswers = progressData.filter(p => p.isCorrect).length;
      const accuracy = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
      const lastAttempted = new Date().toISOString();
      
      const totalSessions = sessionData.length;
      const bestScore = sessionData.length > 0 ? Math.max(...sessionData.map(s => s.score)) : 0;
      const averageScore = sessionData.length > 0 ? sessionData.reduce((sum, s) => sum + s.score, 0) / sessionData.length : 0;

      // Get subject name
      const subject = subjects.find(s => s.subjectId === subjectId);
      const subjectName = subject?.subjectName || 'Mixed Topics';

      // Check if stats record already exists
      const { data: existingStats } = await client.models.UserSubjectStats.list({
        filter: {
          userId: { eq: userId },
          subjectId: { eq: effectiveSubjectId }
        },
        authMode: 'userPool'
      });

      if (existingStats && existingStats.length > 0) {
        // Update existing stats
        await client.models.UserSubjectStats.update({
          id: existingStats[0].id,
          totalQuestions,
          correctAnswers,
          accuracy,
          totalSessions,
          bestScore,
          averageScore,
          lastAttempted
        }, { authMode: 'userPool' });
        console.log('Updated stats for subject:', subjectName);
      } else {
        // Create new stats record
        await client.models.UserSubjectStats.create({
          userId,
          subjectId: effectiveSubjectId,
          subjectName,
          totalQuestions,
          correctAnswers,
          accuracy,
          totalSessions,
          bestScore,
          averageScore,
          lastAttempted
        }, { authMode: 'userPool' });
        console.log('Created new stats for subject:', subjectName);
      }
    } catch (error) {
      console.error('Failed to update subject stats:', error);
    }
  }

  async function startQuiz() {
    setLoading(true);
    setError(null);
    try {
      // Validate question count
      if (!isCountValid) {
        setError(`Please enter a number between 1 and ${availableQuestions}.`);
        return;
      }
      const desiredCount = countNumber;

      // Create quiz session if user is authenticated
      let sessionId = null;
      if (isAuthenticated && userId) {
        sessionId = await createQuizSession(desiredCount);
        setCurrentSessionId(sessionId);
      }

      // Get questions from the selected subject or all subjects (all pages)
      const valid = await listAllQuestions(subjectId || undefined);

      if (valid.length === 0) {
        setError("No questions found for the selected criteria");
        return;
      }

      // Shuffle and limit questions
      const shuffled = [...valid].sort(() => Math.random() - 0.5);
      const limited = shuffled.slice(0, Math.min(desiredCount, valid.length));
      
      const quizQuestions = limited.map(q => ({
        questionId: q.questionId,
        question: q.question,
        options: q.options,
        answerIndex: q.options.indexOf(q.correctAnswer)
      }));
      
      setQuiz(quizQuestions);
      setQuizState('active');
      setCurrentQuestionIndex(0);
      setUserAnswers([]);
      setSelectedAnswer(null);
      setShowFeedback(false);
    } catch (e: any) {
      setError(e?.message || "Failed to start quiz");
    } finally {
      setLoading(false);
    }
  }

  function handleAnswerSelect(answerIndex: number) {
    setSelectedAnswer(answerIndex);
  }

  function submitAnswer() {
    if (selectedAnswer === null || !quiz) return;
    
    const currentQuestion = quiz[currentQuestionIndex];
    const isCorrect = selectedAnswer === currentQuestion.answerIndex;
    
    const userAnswer: UserAnswer = {
      questionId: currentQuestion.questionId,
      selectedIndex: selectedAnswer,
      isCorrect
    };
    
    setUserAnswers(prev => [...prev, userAnswer]);
    setShowFeedback(true);

    // Save progress to database if user is authenticated
    if (isAuthenticated && userId) {
      saveUserProgress(currentQuestion, selectedAnswer, isCorrect);
    }
  }

  async function goToNextQuestion() {
    if (!quiz) return;
    if (currentQuestionIndex < quiz.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setShowFeedback(false);
    } else {
      setQuizState('completed');
      // Complete session and update stats when quiz is completed
      if (isAuthenticated && userId) {
        await completeQuizSession();
        await updateSubjectStats();
      }
    }
  }

  function resetQuiz() {
    setQuizState('setup');
    setQuiz(null);
    setCurrentQuestionIndex(0);
    setUserAnswers([]);
    setSelectedAnswer(null);
    setShowFeedback(false);
    setCurrentSessionId(null);
    setError(null);
  }

  const currentQuestion = quiz && quizState === 'active' ? quiz[currentQuestionIndex] : null;
  const score = userAnswers.filter(answer => answer.isCorrect).length;
  const percentage = userAnswers.length > 0 ? Math.round((score / userAnswers.length) * 100) : 0;
  const quizById = useMemo(() => {
    const map = new Map<string, QuizQuestion>();
    if (quiz) {
      for (const q of quiz) map.set(q.questionId, q);
    }
    return map;
  }, [quiz]);

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="fixed top-4 right-4 flex items-center gap-3">
        {isAuthenticated ? (
          <>
            <div className="hidden sm:block text-right leading-tight">
              <div className="text-sm font-medium">Welcome, {userEmail}</div>
              <div className="text-xs opacity-90">{role}</div>
            </div>
            <Link
              href="/dashboard"
              className="rounded-xl px-4 py-2 text-white font-medium bg-gradient-to-r from-blue-600 to-cyan-600 shadow-lg shadow-blue-500/30 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              Dashboard
            </Link>
            {role === "Admin" && (
              <Link
                href="/admin"
                className="rounded-xl px-4 py-2 text-white font-medium bg-gradient-to-r from-purple-700 to-indigo-700 shadow-lg shadow-purple-500/30 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-purple-400"
              >
                ADMIN
              </Link>
            )}
          </>
        ) : (
          <div className="flex gap-2">
            <Link
              href="/auth/sign-up"
              className="rounded-xl px-4 py-2 text-white font-medium bg-gradient-to-r from-green-600 to-emerald-600 shadow-lg shadow-green-500/30 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-green-400"
            >
              Sign Up
            </Link>
            <Link
              href="/auth/sign-in"
              className="rounded-xl px-4 py-2 text-white font-medium bg-gradient-to-r from-purple-700 to-indigo-700 shadow-lg shadow-purple-500/30 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              Sign In
            </Link>
          </div>
        )}
      </div>
      <div className="w-full max-w-xl bg-white text-gray-900 rounded-3xl shadow-xl/20 shadow-black/30 p-8">
        <div className="flex items-center justify-center gap-2">
          <span className="text-3xl">💬</span>
          <h1 className="text-3xl font-extrabold text-purple-700 tracking-tight">MCQ Quiz</h1>
        </div>
        <p className="text-center text-gray-600 mt-2">Test your knowledge with our interactive quiz</p>

        {error && <div className="text-red-600 text-sm text-center mt-2">{error}</div>}

        {/* Quiz Setup State */}
        {quizState === 'setup' && (
          <div className="mt-6 grid gap-2">
            <label className="text-sm font-medium text-gray-700">Number of questions</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="How many questions do you want to start with?"
              value={countInput}
              onChange={(e) => {
                const raw = e.target.value;
                // Allow empty; otherwise only digits
                const digitsOnly = raw.replace(/[^0-9]/g, "");
                if (digitsOnly === "") {
                  setCountInput("");
                  return;
                }
                const next = Number(digitsOnly);
                if (!Number.isFinite(next)) return;
                if (availableQuestions > 0) {
                  const clamped = Math.min(Math.max(next, 1), availableQuestions);
                  setCountInput(String(clamped));
                } else {
                  // If we don't yet know max, keep numeric string as-is
                  setCountInput(String(Math.max(next, 1)));
                }
              }}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder:text-gray-400"
            />
            <div className="text-center text-xs text-purple-600">
              {availableQuestions > 0 
                ? `Select up to ${availableQuestions} questions${subjectId ? ` from ${selectedSubject?.subjectName}` : ' (all subjects)'}`
                : 'Loading questions...'}
            </div>

            <label className="text-sm font-medium text-gray-700 mt-4">Subject</label>
            <select
              className="border rounded-xl p-3"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">Any subject</option>
              {subjects.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>{s.subjectName}</option>
              ))}
            </select>

            <button
              className="mt-5 rounded-xl px-5 py-3 text-white font-medium bg-gradient-to-r from-purple-500 to-indigo-500 shadow-lg shadow-purple-500/30 disabled:opacity-60"
              onClick={startQuiz}
              disabled={loading || !isCountValid || availableQuestions === 0}
            >
              {loading ? "Loading..." : "🚀 Start Quiz"}
            </button>
            {selectedSubject?.description && (
              <p className="text-center text-xs text-gray-500">{selectedSubject.description}</p>
            )}

            <p className="text-center text-gray-500 mt-6 text-sm">
              Challenge yourself with randomly selected questions from our question bank!
            </p>
            
            {!isAuthenticated && (
              <div className="mt-6 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                <div className="text-center">
                  <h3 className="text-lg font-semibold text-purple-700 mb-2">Track Your Progress!</h3>
                  <p className="text-sm text-purple-600 mb-3">
                    Sign up to track your performance across subjects, see detailed analytics, and get personalized improvement suggestions.
                  </p>
                  <Link
                    href="/auth/sign-up"
                    className="inline-block px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
                  >
                    Create Free Account
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Active Quiz State */}
        {quizState === 'active' && currentQuestion && quiz && (
          <div className="mt-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-gray-500">
                Question {currentQuestionIndex + 1} of {quiz.length}
              </span>
              <div className="w-full bg-gray-200 rounded-full h-2 mx-4">
                <div 
                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((currentQuestionIndex + 1) / quiz.length) * 100}%` }}
                ></div>
              </div>
            </div>

            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-4">{currentQuestion.question}</h2>
              
              <div className="grid gap-3">
                {currentQuestion.options.map((option, index) => (
                  <button
                    key={index}
                    onClick={() => handleAnswerSelect(index)}
                    disabled={showFeedback}
                    className={`p-4 text-left rounded-xl border-2 transition-all duration-200 ${
                      selectedAnswer === index
                        ? showFeedback
                          ? index === currentQuestion.answerIndex
                            ? 'border-green-500 bg-green-50 text-green-800'
                            : 'border-red-500 bg-red-50 text-red-800'
                          : 'border-purple-500 bg-purple-50'
                        : showFeedback && index === currentQuestion.answerIndex
                          ? 'border-green-500 bg-green-50 text-green-800'
                          : 'border-gray-300 hover:border-purple-300 hover:bg-purple-50'
                    } ${showFeedback ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className="font-medium mr-2">{String.fromCharCode(65 + index)}.</span>
                    {option}
                  </button>
                ))}
              </div>

              {showFeedback && (
                <div className={`mt-4 p-3 rounded-lg ${
                  selectedAnswer === currentQuestion.answerIndex 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-red-100 text-red-800'
                }`}>
                  {selectedAnswer === currentQuestion.answerIndex ? '✅ Correct!' : '❌ Incorrect!'}
                  {selectedAnswer !== currentQuestion.answerIndex && (
                    <div className="mt-1 text-sm">
                      The correct answer is: {String.fromCharCode(65 + currentQuestion.answerIndex)}. {currentQuestion.options[currentQuestion.answerIndex]}
                    </div>
                  )}
                </div>
              )}

              {showFeedback && (
                <button
                  onClick={goToNextQuestion}
                  className="mt-4 w-full rounded-xl px-5 py-3 text-white font-medium bg-gradient-to-r from-purple-500 to-indigo-500 shadow-lg shadow-purple-500/30"
                >
                  {currentQuestionIndex < (quiz?.length ?? 0) - 1 ? 'Next Question' : 'See Results'}
                </button>
              )}

              {selectedAnswer !== null && !showFeedback && (
                <button
                  onClick={submitAnswer}
                  className="mt-4 w-full rounded-xl px-5 py-3 text-white font-medium bg-gradient-to-r from-purple-500 to-indigo-500 shadow-lg shadow-purple-500/30"
                >
                  Submit Answer
                </button>
              )}
            </div>
          </div>
        )}

        {/* Completed Quiz State */}
        {quizState === 'completed' && (
          <div className="mt-6 text-center">
            <div className="mb-6">
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-purple-700 mb-2">Quiz Complete!</h2>
              <div className="text-4xl font-bold text-purple-600 mb-2">
                {score}/{userAnswers.length}
              </div>
              <div className="text-xl text-gray-600 mb-4">
                {percentage}% Correct
              </div>
              
              <div className={`inline-block px-4 py-2 rounded-full text-sm font-medium ${
                percentage >= 80 ? 'bg-green-100 text-green-800' :
                percentage >= 60 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {percentage >= 80 ? 'Excellent!' : 
                 percentage >= 60 ? 'Good Job!' : 
                 'Keep Practicing!'}
              </div>
            </div>

            <div className="grid gap-2 mb-6">
              <h3 className="font-semibold text-left">Review:</h3>
              {quiz && userAnswers.map((answer, index) => {
                const question = quizById.get(answer.questionId);
                if (!question) return null;
                
                return (
                  <div key={`${answer.questionId}-${index}`} className={`p-3 rounded-lg text-left ${
                    answer.isCorrect ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                  }`}>
                    <div className="text-sm font-medium">
                      Q{index + 1}: {question.question}
                    </div>
                    <div className="text-xs mt-1">
                      Your answer: {String.fromCharCode(65 + answer.selectedIndex)}. {question.options[answer.selectedIndex]}
                      {!answer.isCorrect && (
                        <div className="text-green-700 mt-1">
                          Correct: {String.fromCharCode(65 + question.answerIndex)}. {question.options[question.answerIndex]}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={resetQuiz}
              className="w-full rounded-xl px-5 py-3 text-white font-medium bg-gradient-to-r from-purple-500 to-indigo-500 shadow-lg shadow-purple-500/30"
            >
              Take Another Quiz
            </button>
          </div>
        )}
      </div>
    </main>
  );
}


