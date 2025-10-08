#!/usr/bin/env ts-node
import { readFileSync } from "fs";
import { resolve } from "path";

// GraphQL mutations and queries
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

type EnhancedQuestion = { 
  id: string; 
  question: string; 
  options: string[]; 
  answer_index: number;
  subject: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
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

async function ensureSubject(url: string, apiKey: string, subjectName: string, description?: string) {
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
    description: description || `Questions related to ${subjectName}`
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

  console.log(`🚀 Seeding enhanced data to GraphQL API: ${graphqlUrl}`);

  // Load enhanced questions
  const questions: EnhancedQuestion[] = JSON.parse(readFileSync(resolve("scripts/enhanced-seed-data.json"), "utf8"));
  
  // Get unique subjects
  const uniqueSubjects = [...new Set(questions.map(q => q.subject))];
  console.log(`📚 Found ${uniqueSubjects.length} subjects: ${uniqueSubjects.join(', ')}`);

  // Create subjects
  const subjectMap = new Map<string, any>();
  
  for (const subjectName of uniqueSubjects) {
    console.log(`📖 Creating/finding subject: ${subjectName}...`);
    const subject = await ensureSubject(graphqlUrl, apiKey, subjectName);
    subjectMap.set(subjectName, subject);
    console.log(`✅ Subject ready: ${subject.subjectName} (ID: ${subject.subjectId})`);
  }

  // Seed questions
  let inserted = 0, skipped = 0;
  
  console.log(`📝 Processing ${questions.length} questions...`);
  
  for (const q of questions) {
    if (!q.options || q.options.length !== 4) {
      console.log(`⚠️  Skipping question with invalid options: ${q.question}`);
      skipped++;
      continue;
    }

    const subject = subjectMap.get(q.subject);
    if (!subject) {
      console.log(`⚠️  Skipping question - subject not found: ${q.subject}`);
      skipped++;
      continue;
    }

    const correctAnswer = q.options[q.answer_index];

    const questionInput = {
      questionId: q.id,
      subjectId: subject.subjectId,
      question: q.question,
      options: q.options,
      correctAnswer,
      explanation: `The correct answer is: ${correctAnswer}`,
      difficulty: q.difficulty
    };

    try {
      await graphqlRequest(graphqlUrl, apiKey, CREATE_QUIZ_QUESTION, {
        input: questionInput
      });
      
      console.log(`✅ [${q.subject}] ${q.question.substring(0, 50)}...`);
      inserted++;
    } catch (error: any) {
      if (error.message.includes("already exists") || error.message.includes("ConditionalCheckFailedException")) {
        console.log(`⏭️  [${q.subject}] Skipped existing: ${q.question.substring(0, 50)}...`);
        skipped++;
      } else {
        console.error(`❌ [${q.subject}] Error: ${error.message}`);
        skipped++;
      }
    }
  }

  console.log("\n🎉 Enhanced seeding completed!");
  console.log(`📊 Summary: ${inserted} inserted, ${skipped} skipped`);
  console.log(`📚 Subjects created: ${uniqueSubjects.length}`);
  
  // Print subject summary
  console.log("\n📋 Subject Summary:");
  for (const [name, subject] of subjectMap) {
    const questionCount = questions.filter(q => q.subject === name).length;
    console.log(`  • ${name}: ${questionCount} questions (ID: ${subject.subjectId})`);
  }
}

main().catch((error) => {
  console.error("❌ Enhanced seeding failed:", error);
  process.exit(1);
});
