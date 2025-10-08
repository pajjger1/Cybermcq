"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ensureAmplifyConfigured } from "@/lib/amplifyClient";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

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
  const [count, setCount] = useState<number>(5);
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableQuestions, setAvailableQuestions] = useState<number>(0);
  
  // Quiz state management
  const [quizState, setQuizState] = useState<QuizState>('setup');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);

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

  // Update available question count when subject changes
  useEffect(() => {
    (async () => {
      try {
        const filter = subjectId ? { subjectId: { eq: subjectId } } : undefined;
        const { data: questionsData } = await client.models.QuizQuestion.list(filter ? { filter } : {});
        // Deduplicate by questionId and keep only questions with a valid correct answer
        const uniqueMap = new Map<string, typeof questionsData[number]>();
        for (const q of questionsData) {
          if (!uniqueMap.has(q.questionId)) uniqueMap.set(q.questionId, q);
        }
        const unique = Array.from(uniqueMap.values());
        const valid = unique.filter((q) => Array.isArray(q.options) && q.options.indexOf(q.correctAnswer) >= 0);
        setAvailableQuestions(valid.length);
      } catch (e: any) {
        console.error("Failed to count questions:", e);
        setAvailableQuestions(0);
      }
    })();
  }, [subjectId, client]);

  const selectedSubject = useMemo(
    () => subjects.find((s) => s.subjectId === subjectId) || null,
    [subjects, subjectId]
  );

  async function startQuiz() {
    setLoading(true);
    setError(null);
    try {
      // Get questions from the selected subject or all subjects
      const filter = subjectId ? { subjectId: { eq: subjectId } } : undefined;
      const { data: questionsData } = await client.models.QuizQuestion.list(filter ? { filter } : {});
      
      if (questionsData.length === 0) {
        setError("No questions found for the selected criteria");
        return;
      }
      
      // Deduplicate by questionId and keep only questions with a valid correct answer
      const uniqueMap = new Map<string, typeof questionsData[number]>();
      for (const q of questionsData) {
        if (!uniqueMap.has(q.questionId)) uniqueMap.set(q.questionId, q);
      }
      const unique = Array.from(uniqueMap.values());
      const valid = unique.filter((q) => Array.isArray(q.options) && q.options.indexOf(q.correctAnswer) >= 0);

      if (valid.length === 0) {
        setError("No valid questions available");
        return;
      }

      // Shuffle and limit questions
      const shuffled = [...valid].sort(() => Math.random() - 0.5);
      const limited = shuffled.slice(0, Math.min(count, valid.length));
      
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
    
    // Auto-advance to next question after 1.5 seconds
    setTimeout(() => {
      if (currentQuestionIndex < quiz.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
        setSelectedAnswer(null);
        setShowFeedback(false);
      } else {
        setQuizState('completed');
      }
    }, 1500);
  }

  function resetQuiz() {
    setQuizState('setup');
    setQuiz(null);
    setCurrentQuestionIndex(0);
    setUserAnswers([]);
    setSelectedAnswer(null);
    setShowFeedback(false);
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
      <div className="fixed top-4 right-4">
        <Link
          href="/auth/sign-in"
          className="rounded-xl px-4 py-2 text-white font-medium bg-gradient-to-r from-purple-700 to-indigo-700 shadow-lg shadow-purple-500/30 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-purple-400"
        >
          Sign In
        </Link>
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
              type="number"
              min={1}
              max={availableQuestions || 50}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(availableQuestions || 50, Number(e.target.value))))}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center focus:outline-none focus:ring-2 focus:ring-purple-400"
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
              disabled={loading}
            >
              {loading ? "Loading..." : "🚀 Start Quiz"}
            </button>
            {selectedSubject?.description && (
              <p className="text-center text-xs text-gray-500">{selectedSubject.description}</p>
            )}

            <p className="text-center text-gray-500 mt-6 text-sm">
              Challenge yourself with randomly selected questions from our question bank!
            </p>
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


