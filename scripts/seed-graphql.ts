#!/usr/bin/env ts-node
import { readFileSync } from "fs";
import { resolve } from "path";

// GraphQL mutations
const CREATE_QUIZ_SUBJECT = `
  mutation CreateQuizSubject($input: CreateQuizSubjectInput!) {
    createQuizSubject(input: $input) {
      id
      subjectId
      subjectName
      description
      createdAt
      updatedAt
    }
  }
`;

const CREATE_QUIZ_QUESTION = `
  mutation CreateQuizQuestion($input: CreateQuizQuestionInput!) {
    createQuizQuestion(input: $input) {
      id
      questionId
      subjectId
      question
      options
      correctAnswer
      explanation
      difficulty
      createdAt
      updatedAt
    }
  }
`;

const LIST_QUIZ_SUBJECTS = `
  query ListQuizSubjects($filter: ModelQuizSubjectFilterInput) {
    listQuizSubjects(filter: $filter) {
      items {
        id
        subjectId
        subjectName
        description
      }
    }
  }
`;

type LegacyQuestion = { 
  id?: string | number; 
  question: string; 
  options: string[]; 
  answer_index: number;
};

function genId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function graphqlRequest(url: string, apiKey: string, query: string, variables: any = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors, null, 2)}`);
  }

  return result.data;
}

async function ensureGeneralSubject(url: string, apiKey: string) {
  const subjectName = "General Knowledge";
  
  // Check if subject already exists
  const existingSubjects = await graphqlRequest(url, apiKey, LIST_QUIZ_SUBJECTS, {
    filter: {
      subjectName: { eq: subjectName }
    }
  });

  if (existingSubjects.listQuizSubjects.items.length > 0) {
    return existingSubjects.listQuizSubjects.items[0];
  }

  // Create new subject
  const subjectInput = {
    subjectId: genId(),
    subjectName,
    description: "Default subject seeded from legacy questions"
  };

  const result = await graphqlRequest(url, apiKey, CREATE_QUIZ_SUBJECT, {
    input: subjectInput
  });

  return result.createQuizSubject;
}

async function main() {
  // Load amplify outputs
  const amplifyOutputs = JSON.parse(readFileSync(resolve("amplify_outputs.json"), "utf8"));
  
  const graphqlUrl = amplifyOutputs.data.url;
  const apiKey = amplifyOutputs.data.api_key;
  
  if (!graphqlUrl || !apiKey) {
    throw new Error("GraphQL URL or API key not found in amplify_outputs.json");
  }

  console.log(`🚀 Seeding data to GraphQL API: ${graphqlUrl}`);

  // Load legacy questions
  const legacy: LegacyQuestion[] = JSON.parse(readFileSync(resolve("scripts/seed-questions.json"), "utf8"));
  
  // Ensure General Knowledge subject exists
  console.log("📚 Creating/finding General Knowledge subject...");
  const subject = await ensureGeneralSubject(graphqlUrl, apiKey);
  console.log(`✅ Subject ready: ${subject.subjectName} (ID: ${subject.subjectId})`);

  // Seed questions
  let inserted = 0, skipped = 0;
  
  console.log(`📝 Processing ${legacy.length} questions...`);
  
  for (const q of legacy) {
    if (!q.options || q.options.length !== 4) {
      console.log(`⚠️  Skipping question with invalid options: ${q.question}`);
      skipped++;
      continue;
    }

    const questionId = q.id ? String(q.id) : genId();
    const correctAnswer = q.options[q.answer_index];

    const questionInput = {
      questionId,
      subjectId: subject.subjectId,
      question: q.question,
      options: q.options,
      correctAnswer,
      explanation: `The correct answer is: ${correctAnswer}`,
      difficulty: "MEDIUM"
    };

    try {
      await graphqlRequest(graphqlUrl, apiKey, CREATE_QUIZ_QUESTION, {
        input: questionInput
      });
      
      console.log(`✅ Inserted: ${q.question.substring(0, 50)}...`);
      inserted++;
    } catch (error: any) {
      if (error.message.includes("already exists") || error.message.includes("ConditionalCheckFailedException")) {
        console.log(`⏭️  Skipped existing: ${q.question.substring(0, 50)}...`);
        skipped++;
      } else {
        console.error(`❌ Error inserting question: ${error.message}`);
        skipped++;
      }
    }
  }

  console.log("\n🎉 Seeding completed!");
  console.log(`📊 Summary: ${inserted} inserted, ${skipped} skipped`);
  console.log(`📍 Subject: ${subject.subjectName} (${subject.subjectId})`);
}

main().catch((error) => {
  console.error("❌ Seeding failed:", error);
  process.exit(1);
});
