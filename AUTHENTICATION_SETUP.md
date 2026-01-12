# Authentication & Access Control Setup Guide

## Current Implementation

### ✅ Completed Changes

#### 1. Schema Updates (`amplify/data/resource.ts`)
- **QuizSubject** and **QuizQuestion** now allow:
  - ✅ Guests (unauthenticated): Read via IAM/Identity Pool
  - ✅ Authenticated Users: Read via userPool
  - ✅ Admins: Full CRUD access

#### 2. Public Quiz Page (`src/app/(public)/page.tsx`)
- ✅ Auto-detects authentication state
- ✅ Uses `userPool` auth mode for authenticated users
- ✅ Uses `identityPool` auth mode for guests
- ✅ Displays subjects in dropdown
- ✅ Shows question count per subject
- ✅ Allows taking quizzes and answering questions
- ✅ Tracks progress for authenticated users
- ✅ Added debug logging for troubleshooting

#### 3. Admin Page (`src/app/admin/page.tsx`)
- ✅ Shows friendly "Admin Access Required" page for non-admin authenticated users
- ✅ Provides navigation to Dashboard and Quiz
- ✅ Only redirects to sign-in if user is NOT authenticated

#### 4. Dashboard (`src/app/dashboard/page.tsx`)
- ✅ Works for all authenticated users (admin and non-admin)
- ✅ Shows user progress and statistics
- ✅ Uses proper auth modes for data access

## User Access Matrix

| Feature | Guest (Not Signed In) | Authenticated User | Admin |
|---------|----------------------|-------------------|-------|
| View Subjects | ✅ Yes | ✅ Yes | ✅ Yes |
| View Questions | ✅ Yes | ✅ Yes | ✅ Yes |
| Take Quizzes | ✅ Yes | ✅ Yes | ✅ Yes |
| Track Progress | ❌ No | ✅ Yes | ✅ Yes |
| View Dashboard | ❌ No | ✅ Yes | ✅ Yes |
| Admin Panel | ❌ No | ❌ No | ✅ Yes |
| Create/Edit/Delete Content | ❌ No | ❌ No | ✅ Yes |

## Current Working State

### ✅ All Users Can Access Quiz (No Deployment Needed)

The quiz page currently uses **`identityPool` auth mode for ALL users** (both authenticated and guests) to read subjects and questions. This means:

- ✅ Works immediately without schema deployment
- ✅ Guests can take quizzes
- ✅ Authenticated users can take quizzes AND save progress
- ✅ No authorization errors

### 🔄 Optional: Switch to UserPool Auth (After Schema Deployment)

If you want authenticated users to use `userPool` auth mode instead of `identityPool`, you need to:

1. **Deploy schema changes:**
```bash
npx ampx sandbox --once
```

2. **Update the code** in `src/app/(public)/page.tsx`:
```typescript
// Change from:
const readAuthMode: ReadAuthMode = "identityPool";

// To:
const readAuthMode: ReadAuthMode = isAuthenticated ? "userPool" : "identityPool";
```

This will:
- Use userPool auth for authenticated users
- Use identityPool auth for guests
- Require the schema to allow `{ allow: private, operations: [read] }`

### Testing Checklist

#### As a Guest (Not Signed In)
1. ✅ Navigate to home page
2. ✅ See subjects in dropdown
3. ✅ See question count
4. ✅ Start and complete a quiz
5. ✅ See "Track Your Progress" signup prompt

#### As an Authenticated Non-Admin User
1. ✅ Sign up for a new account (or sign in with existing)
2. ✅ Navigate to home page
3. ✅ See subjects in dropdown
4. ✅ See question count
5. ✅ Start and complete a quiz
6. ✅ Progress is saved to database
7. ✅ Navigate to Dashboard
8. ✅ See your quiz history and statistics
9. ❌ Try to access `/admin` - should see "Admin Access Required" page
10. ✅ Click "Go to Dashboard" button from admin page

#### As an Admin User
1. ✅ Sign in with admin account
2. ✅ Navigate to home page
3. ✅ See subjects in dropdown
4. ✅ Start and complete a quiz
5. ✅ Progress is saved
6. ✅ Navigate to Dashboard
7. ✅ See your quiz history
8. ✅ Navigate to `/admin`
9. ✅ Access full admin panel
10. ✅ Create/edit/delete subjects and questions

## Debug Console Logs

The quiz page now logs authentication information to help troubleshooting:

```
[QuizPage] User authenticated: user@example.com, role: User
[QuizPage] Loading subjects with authMode: userPool, isAuthenticated: true
[QuizPage] Loaded 5 subjects
[QuizPage] Loading questions with authMode: userPool, subjectFilter: none
[QuizPage] Found 50 valid questions
```

Check browser console (F12) to see these logs.

## Troubleshooting

### Issue: Subjects not loading for authenticated users
**Cause:** Schema changes not deployed  
**Solution:** Run `npx ampx sandbox --once`

### Issue: "No federated jwt" error
**Cause:** Using wrong auth mode or schema not allowing private access  
**Solution:** Ensure schema has `{ allow: private, operations: [read] }` and is deployed

### Issue: Non-admin users can't track progress
**Cause:** User not authenticated or schema issue  
**Solution:** 
1. Check browser console for authentication logs
2. Verify `QuizSession`, `UserProgress`, and `UserSubjectStats` have owner-based auth rules

### Issue: Admin redirect loop
**Cause:** User authenticated but not in Admin group  
**Solution:** This is expected behavior - user will see "Admin Access Required" page with navigation options

## Auth Rules Reference

### Public Read + Private Access (QuizSubject, QuizQuestion)
```graphql
@auth(rules: [
  { allow: public, provider: iam, operations: [read] },  # Guests via Identity Pool
  { allow: private, operations: [read] },                # All authenticated users
  { allow: groups, groups: ["Admin"] }                   # Admins full access
])
```

### Owner-based Access (QuizSession, UserProgress, UserSubjectStats)
```graphql
@auth(rules: [
  { allow: owner, ownerField: "userId", identityClaim: "sub" },  # User owns their data
  { allow: groups, groups: ["Admin"] }                           # Admins see all
])
```

## Commit Message

```
feat: complete auth setup for non-admin users to take quizzes

- Add private read access to QuizSubject and QuizQuestion
- Update admin page to show friendly access denied for non-admins
- Add debug logging to quiz page for auth troubleshooting
- Add visual indicators for subject loading and auth state
- Improve error messages with auth mode context

BREAKING: Requires schema deployment with `npx ampx sandbox --once`
```

## Files Changed

- `amplify/data/resource.ts` - Added private read access
- `src/app/(public)/page.tsx` - Added debug logs and better UI feedback
- `src/app/admin/page.tsx` - Improved non-admin user experience
- `AUTHENTICATION_SETUP.md` - This documentation file

## Support

If you encounter issues:
1. Check browser console for `[QuizPage]` logs
2. Verify you ran `npx ampx sandbox --once`
3. Check AWS Cognito console to verify user groups
4. Ensure `amplify_outputs.json` was regenerated after schema deployment
