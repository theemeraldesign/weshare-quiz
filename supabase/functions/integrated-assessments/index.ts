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
  const response = await fetch(`${EDUTECH_URL}/rest/v1/posts?id=eq.${encodeURIComponent(lessonId)}&select=id,author_user_id,title,linked_quiz_id`, {
    headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${user.token}`, Accept: "application/vnd.pgrst.object+json" },
  });
  if (!response.ok) throw new Error("Unable to verify lesson ownership");
  const post = await response.json();
  if (!post?.id || post.author_user_id !== user.id) throw new Error("Only the lesson publisher can manage its assessment");
  return post;
}
async function getSession(body: any, userId: string) {
  const token = String(body.session_token || "");
  if (token.length < 32) throw new Error("Assessment session is missing");
  const { data, error } = await admin.from("edutech_integration_sessions").select("id,edutech_user_id,lesson_id,quiz_id,quiz_version_id,expires_at,revoked_at,created_at").eq("token_hash", await sha256(token)).maybeSingle();
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
    const kind = q.kind === "remedial" ? "remedial" : "primary";
    const expectedOptions = kind === "primary" ? 5 : 2;
    if (!String(q.prompt || "").trim() || !Array.isArray(q.options) || q.options.length !== expectedOptions ||
        q.options.some((option: unknown) => !String(option || "").trim()) ||
        !Number.isInteger(Number(q.correct_option)) || Number(q.correct_option) < 0 || Number(q.correct_option) >= q.options.length) {
      throw new Error(kind === "primary"
        ? "Each primary question needs a prompt, five complete options, and one correct answer"
        : "Each remedial question needs a prompt, two complete options, and one correct answer");
    }
  }
  if (payload.mode === "exam" && questionsInput.some((q: any) => q.kind === "remedial")) {
    throw new Error("Remedial questions are only available in tutorial mode");
  }
  if (payload.mode === "tutorial") {
    const primaryIndexes = questionsInput.map((q: any, i: number) => q.kind !== "remedial" ? i : -1).filter((i: number) => i >= 0);
    for (const primaryIndex of primaryIndexes) {
      const remedials = questionsInput.filter((q: any) => q.kind === "remedial" && Number(q.parent_index) === primaryIndex);
      if (remedials.length !== 2) throw new Error("Each primary tutorial question needs exactly two remedial questions");
    }
    if (questionsInput.some((q: any) => q.kind === "remedial" && !primaryIndexes.includes(Number(q.parent_index)))) {
      throw new Error("Each remedial question must belong to a primary question");
    }
  }
  const { data: existing, error: findError } = await admin.from("quizzes")
    .select("id,owner_edutech_user_id").eq("linked_lesson_id", lessonId).maybeSingle();
  if (findError) throw findError;
  if (existing && existing.owner_edutech_user_id !== user.id) throw new Error("This lesson already has a linked assessment");
  const config = {
    title, description: String(payload.description || "").slice(0, 2000),
    mode: payload.mode === "tutorial" ? "tutorial" : "exam", status: payload.publish === false ? "draft" : "published",
    attempt_limit: payload.attempt_limit == null ? null : Math.max(1, Math.min(100, Number(payload.attempt_limit))),
    release_mode: ["automatic","manual","scheduled"].includes(payload.release_mode) ? payload.release_mode : "manual",
    release_at: payload.release_mode === "scheduled" && payload.release_at ? payload.release_at : null,
    time_limit_minutes: payload.time_limit_minutes == null ? null : Math.max(1, Math.min(600, Number(payload.time_limit_minutes))),
    participant_fields: Array.isArray(payload.participant_fields) ? payload.participant_fields.slice(0,20).map((field: any) => ({ label: String(field.label || "").trim().slice(0,80), required: !!field.required })).filter((field: any) => field.label) : [],
    allow_retakes: payload.allow_retakes !== false,
  };
  let quizId = existing?.id;
  if (!quizId) {
    const { data: created, error } = await admin.from("quizzes").insert({
      ...config, owner_id: null, owner_edutech_user_id: user.id, linked_lesson_id: lessonId,
      edutech_results_released: false,
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
    kind: q.kind === "remedial" ? "remedial" : "primary", parent_question_id: null,
    prompt: String(q.prompt).trim().slice(0, 3000),
    options: q.options.map((o: unknown) => String(o).slice(0, 500)),
    correct_option: Number(q.correct_option), points: q.kind === "remedial" ? 0.5 : Math.max(0, Math.min(100, Number(q.points ?? 2))),
    image_url: q.image_url ? String(q.image_url).slice(0, 2000) : null,
    video_url: q.video_url ? String(q.video_url).slice(0, 2000) : null,
  }));
  const { data: inserted, error: questionsError } = await admin.from("questions").insert(rows)
    .select("id,parent_question_id,position,kind,prompt,options,correct_option,points,image_url,video_url");
  if (questionsError) throw questionsError;
  const orderedInserted = [...(inserted || [])].sort((a: any, b: any) => Number(a.position) - Number(b.position));
  const primaryIds = new Map<number, string>();
  orderedInserted.forEach((q: any, i: number) => { if (q.kind === "primary") primaryIds.set(i, q.id); });
  const versionQuestions = orderedInserted.map((q: any, i: number) => {
    const source = questionsInput[i];
    const parentId = q.kind === "remedial" ? primaryIds.get(Number(source.parent_index)) || null : null;
    return { ...q, parent_question_id: parentId };
  });
  for (const q of versionQuestions) {
    if (q.kind === "remedial") {
      const { error } = await admin.from("questions").update({ parent_question_id: q.parent_question_id }).eq("id", q.id);
      if (error) throw error;
    }
  }
  const snapshot = { ...config, questions: versionQuestions };
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


async function attachExistingQuiz(user: any, payload: any) {
  const lessonId = String(payload.lesson_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) throw new Error("Invalid lesson reference");
  const post = await verifyLessonOwner(user, lessonId);
  if (post.linked_quiz_id) throw new Error("This lesson already has a linked assessment");
  let sourceUrl: URL;
  try { sourceUrl = new URL(String(payload.quiz_url || "")); } catch { throw new Error("Paste a valid WeShare Quiz link"); }
  if (!sourceUrl.hostname.endsWith("vercel.app") || !sourceUrl.hostname.includes("weshare-quiz")) {
    throw new Error("Use a quiz link from weshare-quiz.vercel.app");
  }
  const pathParts = sourceUrl.pathname.split("/").filter(Boolean);
  if (pathParts.length !== 2 || pathParts[0] !== "quiz") throw new Error("The link must point to a published quiz");
  const slug = decodeURIComponent(pathParts[1]);
  const { data: source, error: sourceError } = await admin.from("quizzes")
    .select("id,owner_id,slug,title,description,mode,status,time_limit_minutes,participant_fields")
    .eq("slug", slug).maybeSingle();
  if (sourceError || !source) throw new Error("WeShare Quiz could not find that quiz");
  if (source.mode !== "exam") throw new Error("Only exam quizzes can be attached. Tutorial quizzes keep their standalone flow.");
  if (source.status !== "published") throw new Error("Publish the original quiz before attaching it");
  if (!source.owner_id) throw new Error("This quiz has no standalone owner to verify");
  const { data: ownerResult, error: ownerError } = await admin.auth.admin.getUserById(source.owner_id);
  if (ownerError || !ownerResult.user?.email || ownerResult.user.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("The quiz owner email must match your signed-in EduTech email");
  }
  const { data: sourceQuestions, error: questionsError } = await admin.from("questions")
    .select("id,parent_question_id,position,kind,prompt,options,correct_option,points,image_url,video_url")
    .eq("quiz_id", source.id).order("position", { ascending: true });
  if (questionsError) throw questionsError;
  if (!sourceQuestions?.length || sourceQuestions.some((q: any) => q.kind !== "primary")) {
    throw new Error("This exam contains tutorial follow-up questions. Create a primary-question exam to attach it.");
  }
  const config = {
    title: source.title, description: source.description, mode: "exam",
    status: payload.publish === false ? "draft" : "published",
    owner_id: null, owner_edutech_user_id: user.id, linked_lesson_id: lessonId,
    attempt_limit: payload.attempt_limit == null ? null : Math.max(1, Math.min(100, Number(payload.attempt_limit))),
    release_mode: ["automatic","manual","scheduled"].includes(payload.release_mode) ? payload.release_mode : "manual",
    release_at: payload.release_mode === "scheduled" && payload.release_at ? payload.release_at : null,
    time_limit_minutes: source.time_limit_minutes, participant_fields: source.participant_fields || [],
    allow_retakes: true, edutech_results_released: false,
  };
  const { data: clone, error: cloneError } = await admin.from("quizzes").insert(config).select("id").single();
  if (cloneError) throw cloneError;
  const { data: version, error: versionError } = await admin.from("quiz_versions")
    .insert({ quiz_id: clone.id, version_number: 1, snapshot: {}, created_by_edutech_user_id: user.id })
    .select("id").single();
  if (versionError) throw versionError;
  const rows = sourceQuestions.map((q: any) => ({
    quiz_id: clone.id, quiz_version_id: version.id, position: q.position, kind: "primary",
    prompt: q.prompt, options: q.options, correct_option: q.correct_option, points: q.points,
    image_url: q.image_url, video_url: q.video_url,
  }));
  const { data: copied, error: copyError } = await admin.from("questions").insert(rows)
    .select("id,parent_question_id,position,kind,prompt,options,correct_option,points,image_url,video_url");
  if (copyError) throw copyError;
  const snapshot = { title: source.title, description: source.description, mode: "exam",
    time_limit_minutes: source.time_limit_minutes, participant_fields: source.participant_fields || [], questions: copied || [] };
  const { error: snapshotError } = await admin.from("quiz_versions").update({ snapshot }).eq("id", version.id);
  if (snapshotError) throw snapshotError;
  const patch = await fetch(`${EDUTECH_URL}/rest/v1/posts?id=eq.${encodeURIComponent(lessonId)}`, {
    method: "PATCH",
    headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${user.token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ linked_quiz_id: clone.id }),
  });
  if (!patch.ok) throw new Error("Quiz copy created, but the lesson link could not be saved");
  return { quiz_id: clone.id, title: source.title, description: source.description, time_limit_minutes: source.time_limit_minutes, question_count: copied?.length || 0, questions: (copied || []).map((q: any) => ({ prompt: q.prompt, options: q.options, correct_option: q.correct_option, points: q.points, image_url: q.image_url || "", video_url: q.video_url || "" })), attached_copy: true };
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
        .select("id,title,description,mode,status,time_limit_minutes,participant_fields,attempt_limit,allow_retakes,release_mode,release_at,owner_edutech_user_id,linked_lesson_id")
        .eq("id", quizId).eq("linked_lesson_id", lessonId).maybeSingle();
      if (error || !quiz || quiz.status !== "published") return json({ error: "This lesson has no available published assessment" }, 404, origin);
      const { count: attemptsUsed, error: attemptCountError } = await admin.from("submissions")
        .select("id", { count: "exact", head: true }).eq("quiz_id", quiz.id).eq("edutech_user_id", userId);
      if (attemptCountError) throw attemptCountError;
      const canAttempt = (quiz.allow_retakes !== false || (attemptsUsed || 0) === 0) && (!quiz.attempt_limit || (attemptsUsed || 0) < quiz.attempt_limit);
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
      return json({ session_token: sessionToken, expires_at: expiresAt, version_id: version.id, attempts_used: attemptsUsed || 0, can_attempt: canAttempt,
        quiz: { id: quiz.id, title: version.snapshot.title, description: version.snapshot.description, mode: version.snapshot.mode,
          time_limit_minutes: version.snapshot.time_limit_minutes, participant_fields: version.snapshot.participant_fields, attempt_limit: quiz.attempt_limit, release_mode: quiz.release_mode, questions } }, 200, origin);
    }

    const user = await authenticateEduTech(req);
    if (action === "dashboard") {
      const [{ data: quizzes, error: quizListError }, { data: submissions, error: submissionError }] = await Promise.all([
        admin.from("quizzes").select("id,title,linked_lesson_id,edutech_results_released,release_mode,release_at,attempt_limit,status")
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
    if (action === "attach_existing") return json(await attachExistingQuiz(user, payload), 200, origin);
    const session = await getSession(payload, user.id);
    const { data: quiz, error: quizError } = await admin.from("quizzes")
      .select("id,title,status,mode,edutech_results_released,attempt_limit,allow_retakes,release_mode,release_at,owner_edutech_user_id,time_limit_minutes")
      .eq("id", session.quiz_id).single();
    if (quizError || !quiz) throw new Error("Assessment not found");
    const isOwner = quiz.owner_edutech_user_id === user.id;

    if (action === "tutorial_answer") {
      if (quiz.mode !== "tutorial" || quiz.status !== "published") throw new Error("Tutorial answers are not available");
      const { data: version, error: versionError } = await admin.from("quiz_versions")
        .select("snapshot").eq("id", session.quiz_version_id).eq("quiz_id", quiz.id).single();
      if (versionError || !version) throw new Error("Tutorial version not found");
      const questionId = String(payload.question_id || "");
      const selected = Number(payload.selected_option);
      const question = (version.snapshot?.questions || []).find((item: any) => item.id === questionId);
      if (!question || !["primary", "remedial"].includes(question.kind)) throw new Error("Tutorial question not found");
      if (!Number.isInteger(selected) || selected < 0 || selected >= question.options.length) throw new Error("Choose a valid answer");
      if (question.kind === "remedial") {
        const { data: parentLock } = await admin.from("edutech_tutorial_answer_locks").select("is_correct")
          .eq("quiz_id", quiz.id).eq("edutech_user_id", user.id).eq("question_id", question.parent_question_id).maybeSingle();
        if (!parentLock || parentLock.is_correct) throw new Error("This follow-up question is not unlocked");
      }
      const { data: existing } = await admin.from("edutech_tutorial_answer_locks")
        .select("selected_option,is_correct").eq("quiz_id", quiz.id).eq("edutech_user_id", user.id).eq("question_id", questionId).maybeSingle();
      if (existing) {
        const followups = question.kind === "primary" && !existing.is_correct
          ? (version.snapshot?.questions || []).filter((item: any) => item.kind === "remedial" && item.parent_question_id === questionId).map(({ correct_option, ...item }: any) => item)
          : [];
        return json({ selected_option: existing.selected_option, unlocks_remedial: question.kind === "primary" && !existing.is_correct, followups }, 200, origin);
      }
      const correct = selected === Number(question.correct_option);
      const { error: lockError } = await admin.from("edutech_tutorial_answer_locks").insert({
        quiz_id: quiz.id, edutech_user_id: user.id, question_id: questionId, selected_option: selected, is_correct: correct,
      });
      if (lockError) throw lockError;
      const followups = question.kind === "primary" && !correct
        ? (version.snapshot?.questions || []).filter((item: any) => item.kind === "remedial" && item.parent_question_id === questionId)
        : [];
      if (question.kind === "primary" && !correct && followups.length !== 2) throw new Error("This tutorial question is missing its two follow-up questions");
      return json({ selected_option: selected, unlocks_remedial: question.kind === "primary" && !correct, followups }, 200, origin);
    }
    if (action === "submit") {
      if (quiz.status !== "published") throw new Error("This assessment is closed");
      if (quiz.time_limit_minutes && session.created_at) {
        const deadline = new Date(session.created_at).getTime() + Number(quiz.time_limit_minutes) * 60_000;
        if (Date.now() > deadline + 15_000) throw new Error("The assessment time limit has expired");
      }
      const { data: version, error: versionError } = await admin.from("quiz_versions")
        .select("id,snapshot").eq("id", session.quiz_version_id).eq("quiz_id", quiz.id).single();
      if (versionError || !version) throw new Error("Assessment version not found");
      const { count, error: countError } = await admin.from("submissions").select("id", { count: "exact", head: true })
        .eq("quiz_id", quiz.id).eq("edutech_user_id", user.id);
      if (countError) throw countError;
      const attemptNumber = (count || 0) + 1;
      if (quiz.allow_retakes === false && attemptNumber > 1) throw new Error("You have already submitted this assessment");
      if (quiz.attempt_limit && attemptNumber > quiz.attempt_limit) throw new Error("You have used all permitted attempts");
      const answers = payload.answers && typeof payload.answers === "object" ? payload.answers : {};
      const questions = version.snapshot?.questions || [];
      let score = 0, maxScore = 0;
      const answerRows: any[] = [];
      if (quiz.mode === "tutorial") {
        const { data: locks, error: locksError } = await admin.from("edutech_tutorial_answer_locks")
          .select("question_id,selected_option").eq("quiz_id", quiz.id).eq("edutech_user_id", user.id);
        if (locksError) throw locksError;
        const lockMap = new Map((locks || []).map((row: any) => [row.question_id, Number(row.selected_option)]));
        const primary = questions.filter((q: any) => q.kind === "primary");
        if (!primary.length || primary.some((q: any) => !lockMap.has(q.id))) throw new Error("Complete every primary question before submitting");
        const incorrectPrimary = primary.filter((q: any) => lockMap.get(q.id) !== Number(q.correct_option));
        const required = [...primary];
        for (const parent of incorrectPrimary) {
          const remedials = questions.filter((q: any) => q.kind === "remedial" && q.parent_question_id === parent.id);
          if (remedials.length !== 2 || remedials.some((q: any) => !lockMap.has(q.id))) throw new Error("Complete both unlocked follow-up questions before submitting");
          required.push(...remedials);
        }
        for (const q of required) {
          const selected = Number(lockMap.get(q.id));
          const correct = selected === Number(q.correct_option);
          const points = Number(q.points || 0);
          maxScore += points;
          if (correct) score += points;
          answerRows.push({ question_id: q.id, selected_option: selected, is_correct: correct, awarded_points: correct ? points : 0 });
        }
      } else {
        for (const q of questions) {
          if (q.kind !== "primary") continue;
          const points = Number(q.points || 0); maxScore += points;
          const selected = Number(answers[q.id]);
          const correct = Number.isInteger(selected) && selected === Number(q.correct_option);
          if (correct) score += points;
          if (Number.isInteger(selected)) answerRows.push({ question_id: q.id, selected_option: selected, is_correct: correct, awarded_points: correct ? points : 0 });
        }
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
      const released = quiz.edutech_results_released || (quiz.release_mode === "scheduled" && quiz.release_at && new Date(quiz.release_at).getTime() <= Date.now());
      if (!released && !isOwner) return json({ released: false, attempts: [] }, 200, origin);
      const { data: attempts, error } = await admin.from("submissions")
        .select("id,score,max_score,submitted_at,attempt_number,quiz_version_id")
        .eq("quiz_id", quiz.id).eq("edutech_user_id", user.id).order("attempt_number", { ascending: true });
      if (error) throw error;
      const bestAttempt = (attempts || []).reduce((best: any, row: any) => !best || Number(row.score) / Math.max(1, Number(row.max_score)) > Number(best.score) / Math.max(1, Number(best.max_score)) ? row : best, null);
      let review: any[] = [];
      if (bestAttempt) {
        const { data: version } = await admin.from("quiz_versions").select("snapshot").eq("id", bestAttempt.quiz_version_id).maybeSingle();
        const { data: answerRows } = await admin.from("answers")
          .select("question_id,selected_option,is_correct,awarded_points")
          .eq("submission_id", bestAttempt.id);
        const answerMap = new Map((answerRows || []).map((row: any) => [row.question_id, row]));
        review = (version?.snapshot?.questions || []).filter((q: any) => quiz.mode === "tutorial" || q.kind === "primary").map((q: any) => {
          const answer: any = answerMap.get(q.id) || {};
          return { id: q.id, prompt: q.prompt, options: q.options, correct_option: q.correct_option,
            selected_option: answer.selected_option ?? null, is_correct: !!answer.is_correct,
            awarded_points: Number(answer.awarded_points || 0), points: Number(q.points || 0) };
        });
      }
      return json({ released, attempts: attempts || [], best_attempt: bestAttempt, review }, 200, origin);
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
      if (quiz.release_mode !== "manual") return json({ error: "This assessment does not use manual result release" }, 400, origin);
      const { error } = await admin.from("quizzes").update({ edutech_results_released: true }).eq("id", quiz.id);
      if (error) throw error;
      return json({ released: true }, 200, origin);
    }
    return json({ error: "Unknown assessment action" }, 400, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Assessment request failed" }, 400, origin);
  }
});
