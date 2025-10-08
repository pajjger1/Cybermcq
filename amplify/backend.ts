import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { quizApi } from "./functions/quizApi/resource";

export default defineBackend({
  auth,
  data,
  quizApi,
});


