# WeShare Quiz

A quiz and assessment platform for WeShare lessons.

## Product flow

1. Anyone signs in with Google to create and manage quizzes.
2. Quizzers publish a shareable quiz link into a WeShare lesson.
3. Participants open the shared quiz link and sign in with Google to submit their answers.
4. Examination mode withholds results until the quizzer releases them.
5. Tutorial mode provides immediate feedback and supports remedial questions.

## Stack

- Next.js / React
- Supabase Auth and PostgreSQL with Row Level Security
- Vercel hosting
- GitHub source control

## Assessment rules

- Primary questions: five options, two marks.
- Remedial questions: two options, 0.5 marks each.
- Examination answer keys and scores stay hidden until results are released.
- Retakes are controlled per quiz.

## Security

- Never commit Supabase service-role keys or other secrets.
- Use the Supabase anon/publishable key in browser code with RLS.
- Enforce scoring, answer visibility, and release rules in trusted database functions.

## Status

Implementation and deployment are in progress. Verify the current production build and database RPC security before inviting real participants.
