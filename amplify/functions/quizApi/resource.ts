import { defineFunction } from "@aws-amplify/backend";

export const quizApi = defineFunction({
  name: "quizApi",
  entry: "./handler.ts",
  timeoutSeconds: 12,
  memoryMB: 512,
});


