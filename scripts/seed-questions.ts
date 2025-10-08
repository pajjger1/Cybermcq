#!/usr/bin/env ts-node
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "fs";
import { resolve } from "path";

type LegacyQ = { id?: string | number; question: string; options: string[]; answer_index: number };

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function genId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function ensureGeneralSubject(doc: DynamoDBDocumentClient, subjectsTable: string) {
  // unique by subjectName via GSI SubjectNameIndex
  const subjectName = "General Knowledge";
  const q = await doc.send(new QueryCommand({
    TableName: subjectsTable,
    IndexName: "SubjectNameIndex",
    KeyConditionExpression: "subjectName = :n",
    ExpressionAttributeValues: { ":n": subjectName },
    Limit: 1,
  }));
  if (q.Items && q.Items.length) return q.Items[0];
  const item = {
    subjectId: genId(),
    subjectName,
    description: "Default subject seeded from legacy questions",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await doc.send(new PutCommand({
    TableName: subjectsTable,
    Item: item,
    ConditionExpression: "attribute_not_exists(subjectId)",
  }));
  return item;
}

async function main() {
  const region = (process.argv.includes("--region") ? process.argv[process.argv.indexOf("--region") + 1] : "eu-west-2");
  const profileIdx = process.argv.indexOf("--profile");
  if (profileIdx !== -1) process.env.AWS_PROFILE = process.argv[profileIdx + 1];

  const ddb = new DynamoDBClient({ region });
  const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } });

  const subjectsTable = process.env.SUBJECTS_TABLE || "QuizSubjects";
  const questionsTable = process.env.QUESTIONS_TABLE || "QuizQuestions";

  const legacy: LegacyQ[] = JSON.parse(readFileSync(resolve("scripts/seed-questions.json"), "utf8"));
  const subject = await ensureGeneralSubject(doc, subjectsTable);

  let inserted = 0, skipped = 0;
  for (const q of legacy) {
    if (!q.options || q.options.length !== 4) { skipped++; continue; }
    const questionId = q.id ? String(q.id) : genId();
    const exists = await doc.send(new GetCommand({ TableName: questionsTable, Key: { questionId } }));
    if (exists.Item) { skipped++; continue; }
    const item = {
      questionId,
      question: q.question,
      options: q.options,
      answerIndex: Number(q.answer_index),
      tags: [],
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await doc.send(new PutCommand({ TableName: questionsTable, Item: item, ConditionExpression: "attribute_not_exists(questionId)" }));
    inserted++;
  }

  console.log(JSON.stringify({ region, subjectsTable, questionsTable, subjectId: subject.subjectId, inserted, skipped }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


