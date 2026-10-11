-- =========================================================================
-- Newton Enhancer - Supabase PostgreSQL Schema (ap-south-1 Mumbai)
-- =========================================================================

-- 1. Create the quizzes table
create table if not exists public.quizzes (
  assessment_hash text primary key,
  course_hash text,
  title text,
  total_questions integer not null default 0,
  has_answers_revealed boolean not null default false,
  questions jsonb not null default '[]'::jsonb,
  archived_by_uid text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Indexes for instant lookups
create index if not exists idx_quizzes_course_hash on public.quizzes (course_hash);
create index if not exists idx_quizzes_has_answers on public.quizzes (has_answers_revealed);

-- 3. Enable Row Level Security (RLS)
alter table public.quizzes enable row level security;

-- Policy 1: Anyone with the anon public key can read archived quizzes
create policy "Allow public read access"
  on public.quizzes
  for select
  using (true);

-- Policy 2: Anyone with the anon public key can insert new quizzes
create policy "Allow public insert"
  on public.quizzes
  for insert
  with check (true);

-- Policy 3: Immutable Answer Lock
-- Quizzes can only be updated if their answers were NOT previously revealed.
-- Once has_answers_revealed is true, answers cannot be corrupted or overwritten!
create policy "Allow updating unrevealed quizzes only"
  on public.quizzes
  for update
  using (has_answers_revealed = false)
  with check (true);
