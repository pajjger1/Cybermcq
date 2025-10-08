# MCQ Quiz (Next.js + Amplify Gen 2)

Region: eu-west-2

## Prerequisites
- Node.js 20+, npm 10+
- AWS credentials for eu-west-2 with permissions for Cognito, API Gateway, Lambda, DynamoDB, Amplify

## Install & Run (local)
```bash
npm install
npm run dev
```

## Amplify Gen 2 (code-first)
Only permitted command (pinned to eu-west-2):
```bash
npx ampx sandbox --once
```
If your shell has issues resolving npx on Windows, use the fallback script:
```bash
npm run sandbox
```
This provisions: Cognito (email sign-in, MFA REQUIRED, self sign-up disabled, group Admin), DynamoDB tables `QuizSubjects` and `QuizQuestions`, and REST API `quizApi` with Lambda (Python 3.12).

## Environment
Create `.env.local`:
```
NEXT_PUBLIC_QUIZ_API_URL=<rest_api_url>
NEXT_PUBLIC_COGNITO_USER_POOL_ID=<user_pool_id>
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=<user_pool_client_id>
```
Obtain values from the sandbox output. The sandbox runs in eu-west-2 (region pinned in `amplify/backend.ts`).

## Seeding
We remove runtime hardcoded questions. Seed legacy questions into DynamoDB:
```bash
npm run seed:questions -- --region eu-west-2
```
Idempotent: inserts default subject "General Knowledge" (if not present) and questions from `scripts/seed-questions.json`.

## Routes
- Public: `/` subject picker and runs quiz
- Admin: `/admin` (requires Cognito Admin group; non-admins get 404)
- Auth: `/auth/sign-in`, `/auth/forgot-password` (no sign-up)

## API Summary
- Public: `GET /subjects`, `GET /subjects/{id}`, `GET /quiz`
- Admin only (Admin group): CRUD for `/subjects` and `/questions`

## CORS
Allowed: `http://localhost:3000`, `https://cybermcq.com`, `https://www.cybermcq.com`, and Amplify Hosting domains (`*.amplifyapp.com`).

## Safety
- Never delete a sandbox. Do not use legacy Amplify CLI.

## Revert local changes
```bash
git restore -SW :/
# or
git checkout -- <file>
```
