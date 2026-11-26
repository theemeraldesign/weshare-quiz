import { createClient } from "npm:@supabase/supabase-js@2.105.4";
const EDUTECH_URL = "https://fpbsvxplmjifcpvczfot.supabase.co";
const EDUTECH_KEY = "sb_publishable_7XKS46xxlEn5GWoX0dsgxg_pNBE6b1B";
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin === "https://weshareeduteach.name.ng" || origin?.endsWith(".workers.dev")
    ? origin : "https://weshareeduteach.name.ng",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
});
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function authenticateEduTech(req: Request) {
  const header = req.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("EduTech sign-in is required");
  const response = await fetch(`${EDUTECH_URL}/auth/v1/user`, { headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Your EduTech session is invalid or expired");
  const user = await response.json();
  if (!user?.id) throw new Error("Unable to verify your EduTech account");
  return { id: String(user.id), email: String(user.email || ""), token };
}
async function verifyLessonOwner(user: any, lessonId: string) {
  const response = await fetch(`${EDUTECH_URL}/rest/v1/posts?id=eq.${encodeURIComponent(lessonId)}&select=id,author_user_id,title`, {
    headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${user.token}`, Accept: "application/vnd.pgrst.object+json" },
  });
  if (!response.ok) throw new Error("Unable to verify lesson ownership");
  const post = await response.json();
  if (!post?.id || post.author_user_id !== user.id) throw new Error("Only the lesson publisher can manage its assessment");
  return post;
}
async function getSession(req: Request, userId: string) {
  const body = await req.clone().json().catch(() => ({}));
  const token = String(body.session_token || "");
  if (token.length < 32) throw new Error("Assessment session is missing");
  const { data, error } = await admin.from("edutech_integration_sessions").select("id,edutech_user_id,lesson_id,quiz_id,quiz_version_id,expires_at,revoked_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (error || !data || data.edutech_user_id !== userId || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) {
    throw new Error("Assessment session expired. Reopen the lesson to continue.");
  }
  return data;
}
async function snapshotForQuiz(quiz: any) {
  const { data: existing, error: versionError } = await admin.from("quiz_versions").select("id,version_number,snapshot")
    .eq("quiz_id", quiz.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  if (versionError) throw versionError;
  if (existing) return existing;
  const { data: questions, error } = await admin.from("questions")
    .select("id,parent_question_id,position,kind,prompt,options,correct_option,points,image_url,video_url")
    .eq("quiz_id", quiz.id).order("position", { ascending: true });
  if (error) throw error;
  const snapshot = { title: quiz.title, description: quiz.description, mode: quiz.mode, time_limit_minutes: quiz.time_limit_minutes, participant_fields: quiz.participant_fields, questions: questions || [] };
  const { data: created, error: insertError } = await admin.from("quiz_versions")
    .insert({ quiz_id: quiz.id, version_number: 1, snapshot, created_by_edutech_user_id: quiz.owner_edutech_user_id })
    .select("id,version_number,snapshot").single();
  if (insertError) throw insertError;
  return created;
}
async function createOrUpdateIntegratedQuiz(user: any, payload: any) {
  const lessonId = String(payload.lesson_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) throw new Error("Invalid lesson reference");
  const post = await verifyLessonOwner(user, lessonId);
  const title = String(payload.title || "").trim().slice(0, 180);
  const questionsInput = Array.isArray(payload.questions) ? payload.questions : [];
  if (!title || questionsInput.length < 1 || questionsInput.length > 200) throw new Error("Add a title and between 1 and 200 questions");
  for (const q of questionsInput) {
    if (!String(q.prompt || "").trim() || !Array.isArray(q.options) || q.options.length < 2 ||
        !Number.isInteger(Number(q.correct_option)) || Number(q.correct_option) < 0 || Number(q.correct_option) >= q.options.length) {
      throw new Error("Each question needs a prompt, at least two options, and one correct answer");
    }
  }
  const { data: existing, error: findError } = await admin.from("quizzes")
    .select("id,owner_edutech_user_id").eq("linked_lesson_id", lessonId).maybeSingle();
  if (findError) throw findError;
  if (existing && existing.owner_edutech_user_id !== user.id) throw new Error("This lesson already has a linked assessment");
  const config = {
    title, description: String(payload.description || "").slice(0, 2000),
    mode: "exam", status: payload.publish === false ? "draft" : "published",
    attempt_limit: payload.attempt_limit == null ? null : Math.max(1, Math.min(100, Number(payload.attempt_limit))),
    release_mode: ["automatic","manual","scheduled"].includes(payload.release_mode) ? payload.release_mode : "manual",
    release_at: payload.release_mode === "scheduled" && payload.release_at ? payload.release_at : null,
    time_limit_minutes: payload.time_limit_minutes == null ? null : Math.max(1, Math.min(600, Number(payload.time_limit_minutes))),
    participant_fields: [],
  };
  let quizId = existing?.id;
  if (!quizId) {
    const { data: created, error } = await admin.from("quizzes").insert({
      ...config, owner_id: null, owner_edutech_user_id: user.id, linked_lesson_id: lessonId,
      allow_retakes: true, edutech_results_released: false,
    }).select("id").single();
    if (error) throw error;
    quizId = created.id;
  } else {
    const { error } = await admin.from("quizzes").update(config).eq("id", quizId);
    if (error) throw error;
  }
  const { data: latest } = await admin.from("quiz_versions").select("version_number")
    .eq("quiz_id", quizId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const versionNumber = (latest?.version_number || 0) + 1;
  const { data: version, error: versionError } = await admin.from("quiz_versions")
    .insert({ quiz_id: quizId, version_number: versionNumber, snapshot: {}, created_by_edutech_user_id: user.id })
    .select("id").single();
  if (versionError) throw versionError;
  const rows = questionsInput.map((q: any, i: number) => ({
    quiz_id: quizId, quiz_version_id: version.id, position: i,
    kind: "primary", prompt: String(q.prompt).trim().slice(0, 3000),
    options: q.options.map((o: unknown) => String(o).slice(0, 500)),
    correct_option: Number(q.correct_option), points: Math.max(0, Math.min(100, Number(q.points ?? 1))),
    image_url: q.image_url ? String(q.image_url).slice(0, 2000) : null,
    video_url: q.video_url ? String(q.video_url).slice(0, 2000) : null,
  }));
  const { data: inserted, error: questionsError } = await admin.from("questions").insert(rows)
    .select("id,parent_question_id,position,kind,prompt,options,correct_option,points,image_url,video_url");
  if (questionsError) throw questionsError;
  const snapshot = { ...config, questions: inserted || [] };
  const { error: snapshotError } = await admin.from("quiz_versions").update({ snapshot }).eq("id", version.id);
  if (snapshotError) throw snapshotError;
  const { error: linkError } = await fetch(`${EDUTECH_URL}/rest/v1/posts?id=eq.${encodeURIComponent(lessonId)}`, {
    method: "PATCH",
    headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${user.token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ linked_quiz_id: quizId }),
  }).then(async (r) => ({ error: r.ok ? null : await r.text() }));
  if (linkError) throw new Error("Assessment was saved, but the lesson link could not be updated: " + linkError);
  return { quiz_id: quizId, version_id: version.id, status: config.status, question_count: rows.length };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  try {
    const payload = await req.json();
    const action = String(payload.action || "");
    if (action === "bootstrap") {
      const ticket = String(payload.launch_ticket || "");
      if (ticket.length !== 64) return json({ error: "Invalid launch ticket" }, 400, origin);
      const redeemed = await fetch(`${EDUTECH_URL}/functions/v1/redeem-quiz-ticket`, {
        method: "POST", headers: { apikey: EDUTECH_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const identity = await redeemed.json();
      if (!redeemed.ok || !identity?.user_id) return json({ error: identity?.error || "Launch ticket expired or already used" }, 401, origin);
      const lessonId = String(identity.lesson_id), quizId = String(identity.quiz_id), userId = String(identity.user_id);
      const { data: quiz, error } = await admin.from("quizzes")
        .select("id,title,description,mode,status,results_released,time_limit_minutes,participant_fields,attempt_limit,release_mode,release_at,owner_edutech_user_id,linked_lesson_id")
        .eq("id", quizId).eq("linked_lesson_id", lessonId).maybeSingle();
      if (error || !quiz || quiz.status !== "published") return json({ error: "This lesson has no available published assessment" }, 404, origin);
      const version = await snapshotForQuiz(quiz);
      const sessionToken = randomToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { error: sessionError } = await admin.from("edutech_integration_sessions").insert({
        token_hash: await sha256(sessionToken), edutech_user_id: userId, lesson_id: lessonId, quiz_id: quizId, quiz_version_id: version.id, expires_at: expiresAt,
      });
      if (sessionError) throw sessionError;
      const questions = (version.snapshot?.questions || []).map((q: any) => ({
        id: q.id, parent_question_id: q.parent_question_id, position: q.position,
        kind: q.kind, prompt: q.prompt, options: q.options, points: q.points, image_url: q.image_url, video_url: q.video_url,
      }));
      return json({ session_token: sessionToken, expires_at: expiresAt, version_id: version.id,
        quiz: { id: quiz.id, title: version.snapshot.title, description: version.snapshot.description, mode: version.snapshot.mode,
          time_limit_minutes: version.snapshot.time_limit_minutes, participant_fields: version.snapshot.participant_fields, attempt_limit: quiz.attempt_limit, release_mode: quiz.release_mode, questions } }, 200, origin);
    }

    const user = await authenticateEduTech(req);
    if (action === "dashboard") {
      const [{ data: quizzes, error: quizListError }, { data: submissions, error: submissionError }] = await Promise.all([
        admin.from("quizzes").select("id,title,linked_lesson_id,results_released,release_mode,release_at,attempt_limit,status")
          .not("linked_lesson_id", "is", null).in("status", ["published","closed"]),
        admin.from("submissions").select("quiz_id,id,score,max_score,submitted_at,attempt_number")
          .eq("edutech_user_id", user.id).order("attempt_number", { ascending: true }),
      ]);
      if (quizListError || submissionError) throw quizListError || submissionError;
      const items = (quizzes || []).map((quiz: any) => {
        const attempts = (submissions || []).filter((row: any) => row.quiz_id === quiz.id);
        const released = quiz.edutech_results_released || (quiz.release_mode === "scheduled" && quiz.release_at && new Date(quiz.release_at).getTime() <= Date.now());
        const best = attempts.reduce((best: any, row: any) => !best || Number(row.score) / Math.max(1, Number(row.max_score)) > Number(best.score) / Math.max(1, Number(best.max_score)) ? row : best, null);
        return { quiz_id: quiz.id, lesson_id: quiz.linked_lesson_id, title: quiz.title, attempt_count: attempts.length,
          attempt_limit: quiz.attempt_limit, released, best_attempt: released ? best : null };
      });
      return json({ assessments: items }, 200, origin);
    }
    if (action === "create_or_update") return json(await createOrUpdateIntegratedQuiz(user, payload), 200, origin);
    const session = await getSession(req, user.id);
    const { data: quiz, error: quizError } = await admin.from("quizzes")
      .select("id,title,status,edutech_results_released,attempt_limit,release_mode,release_at,owner_edutech_user_id")
      .eq("id", session.quiz_id).single();
    if (quizError || !quiz) throw new Error("Assessment not found");
    const isOwner = quiz.owner_edutech_user_id === user.id;

    if (action === "submit") {
      if (quiz.status !== "published") throw new Error("This assessment is closed");
      const { data: version, error: versionError } = await admin.from("quiz_versions")
        .select("id,snapshot").eq("id", session.quiz_version_id).eq("quiz_id", quiz.id).single();
      if (versionError || !version) throw new Error("Assessment version not found");
      const { count, error: countError } = await admin.from("submissions").select("id", { count: "exact", head: true })
        .eq("quiz_id", quiz.id).eq("edutech_user_id", user.id);
      if (countError) throw countError;
      const attemptNumber = (count || 0) + 1;
      if (quiz.attempt_limit && attemptNumber > quiz.attempt_limit) throw new Error("You have used all permitted attempts");
      const answers = payload.answers && typeof payload.answers === "object" ? payload.answers : {};
      const questions = version.snapshot?.questions || [];
      let score = 0, maxScore = 0;
      const answerRows: any[] = [];
      for (const q of questions) {
        if (q.kind !== "primary") continue;
        const points = Number(q.points || 0); maxScore += points;
        const selected = Number(answers[q.id]);
        const correct = Number.isInteger(selected) && selected === Number(q.correct_option);
        if (correct) score += points;
        if (Number.isInteger(selected)) answerRows.push({ question_id: q.id, selected_option: selected, is_correct: correct, awarded_points: correct ? points : 0 });
      }
      const { data: submission, error: insertError } = await admin.from("submissions").insert({
        quiz_id: quiz.id, participant_name: String(payload.participant_name || "EduTech learner").slice(0, 160),
        email: user.email, matric_number: "", extra_details: { source: "edutech", lesson_id: session.lesson_id },
        score, max_score: maxScore, edutech_user_id: user.id, quiz_version_id: version.id, attempt_number: attemptNumber,
      }).select("id,score,max_score,submitted_at,attempt_number").single();
      if (insertError) throw insertError;
      if (answerRows.length) {
        const { error: answerError } = await admin.from("answers").insert(answerRows.map((row) => ({ ...row, submission_id: submission.id })));
        if (answerError) throw answerError;
      }
      if (quiz.release_mode === "automatic" || (quiz.release_mode === "scheduled" && quiz.release_at && new Date(quiz.release_at).getTime() <= Date.now())) {
        await admin.from("quizzes").update({ edutech_results_released: true }).eq("id", quiz.id);
      }
      return json({ submission, attempts_used: attemptNumber, attempt_limit: quiz.attempt_limit }, 200, origin);
    }
    if (action === "results") {
      const released = quiz.results_released || (quiz.release_mode === "scheduled" && quiz.release_at && new Date(quiz.release_at).getTime() <= Date.now());
      if (!released && !isOwner) return json({ released: false, attempts: [] }, 200, origin);
      const { data: attempts, error } = await admin.from("submissions")
        .select("id,score,max_score,submitted_at,attempt_number,quiz_version_id")
        .eq("quiz_id", quiz.id).eq("edutech_user_id", user.id).order("attempt_number", { ascending: true });
      if (error) throw error;
      const bestAttempt = (attempts || []).reduce((best: any, row: any) => !best || Number(row.score) / Math.max(1, Number(row.max_score)) > Number(best.score) / Math.max(1, Number(best.max_score)) ? row : best, null);
      return json({ released: true, attempts: attempts || [], best_attempt: bestAttempt }, 200, origin);
    }
    if (action === "participants") {
      if (!isOwner) return json({ error: "Publisher access required" }, 403, origin);
      const [{ data: sessions, error: sessionsError }, { data: rows, error }] = await Promise.all([
        admin.from("edutech_integration_sessions").select("edutech_user_id,created_at")
          .eq("quiz_id", quiz.id).order("created_at", { ascending: false }),
        admin.from("submissions").select("id,edutech_user_id,score,max_score,submitted_at,attempt_number")
          .eq("quiz_id", quiz.id).not("edutech_user_id", "is", null).order("submitted_at", { ascending: false }),
      ]);
      if (sessionsError || error) throw sessionsError || error;
      const people = new Map<string, any>();
      for (const row of sessions || []) if (row.edutech_user_id !== quiz.owner_edutech_user_id) people.set(row.edutech_user_id, { edutech_user_id: row.edutech_user_id, started_at: row.created_at, submissions: 0, best_score: null, max_score: null, last_submitted_at: null });
      for (const row of rows || []) {
        if (row.edutech_user_id === quiz.owner_edutech_user_id) continue;
        const person = people.get(row.edutech_user_id) || { edutech_user_id: row.edutech_user_id, started_at: null, submissions: 0, best_score: null, max_score: null, last_submitted_at: null };
        person.submissions += 1;
        person.last_submitted_at ||= row.submitted_at;
        if (person.best_score === null || Number(row.score) / Math.max(1, Number(row.max_score)) > Number(person.best_score) / Math.max(1, Number(person.max_score))) {
          person.best_score = row.score; person.max_score = row.max_score;
        }
        people.set(row.edutech_user_id, person);
      }
      const participantRows = [...people.values()];
      const ids = participantRows.map((person: any) => person.edutech_user_id);
      let profiles: any[] = [];
      if (ids.length) {
        const profileResponse = await fetch(`${EDUTECH_URL}/rest/v1/profiles?user_id=in.(${ids.join(",")})&select=user_id,username,surname,othernames`, {
          headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${user.token}` },
        });
        if (profileResponse.ok) profiles = await profileResponse.json();
      }
      const profileMap = new Map(profiles.map((profile: any) => [profile.user_id, profile]));
      const participants = participantRows.map((person: any) => {
        const profile: any = profileMap.get(person.edutech_user_id) || {};
        return { ...person, display_name: [profile.surname, profile.othernames].filter(Boolean).join(" ") || profile.username || "EduTech learner", username: profile.username || "" };
      });
      return json({ participants }, 200, origin);
    }
    if (action === "release") {
      if (!isOwner) return json({ error: "Publisher access required" }, 403, origin);
      const { error } = await admin.from("quizzes").update({ results_released: true }).eq("id", quiz.id);
      if (error) throw error;
      return json({ released: true }, 200, origin);
    }
    return json({ error: "Unknown assessment action" }, 400, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Assessment request failed" }, 400, origin);
  }
});
