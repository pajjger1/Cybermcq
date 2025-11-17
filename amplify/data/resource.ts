// Data schema for quiz application
import { defineData } from "@aws-amplify/backend";

const schema = /* GraphQL */ `
  type QuizSubject @model @auth(rules: [
    { allow: public },
    { allow: groups, groups: ["Admin"] }
  ]) {
    id: ID!
    subjectId: String! @index(name: "bySubjectId")
    subjectName: String! @index(name: "bySubjectName")
    slug: String! @index(name: "bySlug")
    description: String
    links: [AWSURL]
    createdAt: AWSDateTime!
    updatedAt: AWSDateTime!
  }

  type QuizQuestion @model @auth(rules: [
    { allow: public },
    { allow: groups, groups: ["Admin"] }
  ]) {
    id: ID!
    questionId: String! @index(name: "byQuestionId")
    subjectId: String! @index(name: "bySubjectId")
    question: String!
    options: [String!]!
    correctAnswer: String!
    explanation: String
    difficulty: String
    createdAt: AWSDateTime!
    updatedAt: AWSDateTime!
  }

  type QuizSession @model @auth(rules: [
    { allow: owner, ownerField: "userId", identityClaim: "sub" },
    { allow: groups, groups: ["Admin"] }
  ]) {
    id: ID!
    userId: String! @index(name: "byUserId")
    subjectId: String @index(name: "bySubjectId")
    subjectName: String
    questionCount: Int!
    score: Int!
    accuracy: Float!
    startTime: AWSDateTime!
    endTime: AWSDateTime
    completed: Boolean!
    createdAt: AWSDateTime!
    updatedAt: AWSDateTime!
  }

  type UserProgress @model @auth(rules: [
    { allow: owner, ownerField: "userId", identityClaim: "sub" },
    { allow: groups, groups: ["Admin"] }
  ]) {
    id: ID!
    userId: String! @index(name: "byUserId")
    subjectId: String! @index(name: "bySubjectId")
    questionId: String! @index(name: "byQuestionId")
    sessionId: String @index(name: "bySessionId")
    isCorrect: Boolean!
    selectedAnswer: String!
    correctAnswer: String!
    difficulty: String
    timestamp: AWSDateTime!
    createdAt: AWSDateTime!
    updatedAt: AWSDateTime!
  }

  type UserSubjectStats @model @auth(rules: [
    { allow: owner, ownerField: "userId", identityClaim: "sub" },
    { allow: groups, groups: ["Admin"] }
  ]) {
    id: ID!
    userId: String! @index(name: "byUserId")
    subjectId: String! @index(name: "bySubjectId")
    subjectName: String!
    totalQuestions: Int!
    correctAnswers: Int!
    accuracy: Float!
    totalSessions: Int!
    bestScore: Int!
    averageScore: Float!
    lastAttempted: AWSDateTime!
    createdAt: AWSDateTime!
    updatedAt: AWSDateTime!
  }
`;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
    userPoolAuthorizationMode: {},
  },
});

export type Schema = any;


