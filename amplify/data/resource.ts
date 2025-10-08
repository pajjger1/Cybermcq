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
`;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});

export type Schema = any;


