# Supabase Setup Guide (ap-south-1 Mumbai)

Newton Enhancer uses **Supabase** hosted directly in **AWS Mumbai (`ap-south-1`)** for ultra-low latency (<5ms) and native PostgreSQL JSONB storage with immutable Row Level Security (RLS).

---

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and click **"New Project"**.
2. **Project Name**: `newton-enhancer` (or any name you prefer).
3. **Region**: Select **India (Mumbai) - `ap-south-1`** (This ensures it is colocated with Newton LMS for 0ms ping).
4. Set a database password and click **Create new project**.

---

## 2. Apply Database Schema & Security Rules

1. Open your project dashboard in Supabase.
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **"New query"**.
4. Paste the entire content of [`schema.sql`](./schema.sql) and click **Run**.
5. You should see `Success. No rows returned`.

---

## 3. Link Extension to Supabase

1. In your Supabase dashboard, go to **Project Settings** (gear icon) -> **API**.
2. Copy:
   - **Project URL** (e.g. `https://xyzcompany.supabase.co`)
   - **Project API keys** -> `anon` / `public` key (e.g. `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)
3. Open `extension/src/quiz-client.js` and update `SUPABASE_CONFIG`:
   ```javascript
   export const SUPABASE_CONFIG = {
     url: 'https://YOUR_PROJECT_ID.supabase.co',
     anonKey: 'YOUR_SUPABASE_ANON_KEY'
   };
   ```

---

## 4. Why This Architecture is Tamper-Proof

- **Direct PostgREST REST API**: The extension communicates directly with Supabase via HTTPS REST, requiring zero heavy dependencies.
- **Row Level Security (RLS)**:
  - Read access is public for all quizzes.
  - Insert is allowed for new quizzes.
  - Update is **strictly restricted** to quizzes where `has_answers_revealed = false`. Once answers are revealed, PostgreSQL rejects any modifications at the database engine level, preventing anyone from tampering with verified answers.
