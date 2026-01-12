# Quick Authentication Test Flow

## 🚨 BEFORE TESTING: Deploy Schema Changes

```bash
npx ampx sandbox --once
```

Wait for deployment to complete, then proceed with testing.

---

## Test 1: Guest User (Not Signed In)

### Steps:
1. Open browser in **incognito/private mode**
2. Navigate to `http://localhost:3000`
3. Open browser console (F12)

### Expected Results:
✅ Console shows:
```
[QuizPage] Loading subjects with authMode: identityPool, isAuthenticated: false
[QuizPage] Loaded X subjects
```

✅ UI shows:
- Subject dropdown populated with options
- Question count displayed (e.g., "Select up to 50 questions")
- "Start Quiz" button is enabled (when count is valid)
- "Track Your Progress" signup prompt visible

### ❌ If you see errors:
- Check if `npx ampx sandbox --once` completed successfully
- Verify `identity_pool_id` exists in `amplify_outputs.json` line 6
- Refresh the page

---

## Test 2: Authenticated Non-Admin User

### Steps:
1. Sign up a new account OR sign in with existing non-admin account
2. Navigate to `http://localhost:3000`
3. Open browser console (F12)

### Expected Results:
✅ Console shows:
```
[QuizPage] User authenticated: your-email@example.com, role: User
[QuizPage] Loading subjects with authMode: userPool, isAuthenticated: true
[QuizPage] Loaded X subjects
```

✅ UI shows:
- Top-right: "Welcome, your-email@example.com" and "Dashboard" button
- Subject dropdown populated
- Question count displayed
- "Start Quiz" button enabled
- NO signup prompt (since you're authenticated)

### ✅ After completing a quiz:
1. Navigate to `/dashboard`
2. Should see:
   - Overall statistics (questions answered, correct answers, accuracy)
   - Subject progress cards
   - Recent sessions
   - Improvement tips

### ❌ If you see errors:
- "No federated jwt": Schema not deployed or using wrong auth mode
- Empty subjects: Check console for error messages
- Can't save progress: Check browser console for auth errors

---

## Test 3: Try Accessing Admin Panel (Non-Admin)

### Steps:
1. While signed in as non-admin user
2. Navigate to `http://localhost:3000/admin`

### Expected Results:
✅ See "Admin Access Required" page with:
- 🔒 Lock icon
- "Admin Access Required" heading
- Message: "You're signed in but don't have admin privileges"
- Two navigation buttons:
  - 📊 Go to Dashboard
  - 🚀 Take a Quiz

### ❌ Should NOT:
- Redirect to sign-in page
- Show admin panel
- Show error 404

---

## Test 4: Admin User (If you have one)

### Steps:
1. Sign in with admin account
2. Navigate to `http://localhost:3000/admin`

### Expected Results:
✅ Full admin panel access:
- Subject management
- Question creation/editing
- Bulk CSV upload
- All CRUD operations work

---

## Visual Test Checklist

### Home Page (`/`)
```
┌────────────────────────────────────────┐
│  [Sign Up] [Sign In]     OR    Welcome │
│                         [Dashboard] 🏠  │
├────────────────────────────────────────┤
│          💬 MCQ Quiz                   │
│   Test your knowledge with our         │
│        interactive quiz                │
│                                        │
│  Number of questions                   │
│  ┌──────────────────────────────────┐ │
│  │         [Input Box]              │ │
│  └──────────────────────────────────┘ │
│  ✓ 5 subjects available               │
│                                        │
│  Subject                               │
│  ┌──────────────────────────────────┐ │
│  │ Any subject            [▼]       │ │
│  │ - Cybersecurity                  │ │
│  │ - Network Security               │ │
│  │ - ... more subjects ...          │ │
│  └──────────────────────────────────┘ │
│                                        │
│       [🚀 Start Quiz]                 │
│                                        │
│  Challenge yourself with randomly      │
│  selected questions from our bank!     │
└────────────────────────────────────────┘
```

### Dashboard (`/dashboard`)
```
┌────────────────────────────────────────┐
│  Dashboard          [↻] [Quiz] [Sign]  │
│  Welcome back, user@example.com        │
├────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│  │  50  │ │  35  │ │ 70.0%│ │  3   │ │
│  │Quest.│ │Corrct│ │Accur.│ │Subjs │ │
│  └──────┘ └──────┘ └──────┘ └──────┘ │
├────────────────────────────────────────┤
│  Subject Progress                      │
│  ┌──────────────────────────────────┐ │
│  │ Cybersecurity      [Very Good]   │ │
│  │ Questions: 20 | Accuracy: 85%    │ │
│  │ ████████████░░░░ 85%             │ │
│  └──────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### Admin Access Denied (`/admin` as non-admin)
```
┌────────────────────────────────────────┐
│                                        │
│             🔒                         │
│     Admin Access Required              │
│  This area is restricted to            │
│     administrators only                │
│                                        │
│  ℹ️  You're signed in but don't have  │
│     admin privileges.                  │
│     You can still take quizzes and     │
│     track progress on dashboard!       │
│                                        │
│  [📊 Go to Dashboard] [🚀 Take Quiz]  │
│                                        │
│  [Force Refresh]      [Sign Out]      │
└────────────────────────────────────────┘
```

---

## Console Debugging

### Healthy Auth Flow (Authenticated):
```
[QuizPage] User authenticated: user@example.com, role: User
[QuizPage] Loading subjects with authMode: userPool, isAuthenticated: true
[QuizPage] Loaded 5 subjects
[QuizPage] Loading questions with authMode: userPool, subjectFilter: cybersecurity
[QuizPage] Found 20 valid questions
```

### Healthy Auth Flow (Guest):
```
[QuizPage] Loading subjects with authMode: identityPool, isAuthenticated: false
[QuizPage] Loaded 5 subjects
[QuizPage] Loading questions with authMode: identityPool, subjectFilter: none
[QuizPage] Found 50 valid questions
```

### ❌ Error Examples:

**Schema Not Deployed:**
```
Error: GraphQL error: Not Authorized to access list on type QuizSubject
```
**Solution:** Run `npx ampx sandbox --once`

**Wrong Auth Mode:**
```
[QuizPage] Failed to load subjects: No federated jwt
```
**Solution:** Schema not allowing `private` access or not deployed

---

## Quick Verification Commands

### Check if sandbox is running:
```bash
# Look for running Amplify process
ps aux | grep amplify
```

### Check amplify_outputs.json has identity pool:
```bash
# Should show identity_pool_id
grep -A 2 "identity_pool_id" amplify_outputs.json
```

### Expected output:
```json
"identity_pool_id": "us-east-1:xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
```

---

## Success Criteria

✅ **All tests pass if:**
1. Guests can see subjects and questions
2. Authenticated non-admin users can:
   - See subjects and questions
   - Take quizzes
   - Save progress
   - View dashboard
   - See "Admin Access Required" page (not admin panel)
3. Admin users can access admin panel
4. Console shows correct auth modes
5. No "No federated jwt" errors for authenticated users
