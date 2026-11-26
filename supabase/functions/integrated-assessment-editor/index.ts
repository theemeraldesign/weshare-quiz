import { createClient } from "npm:@supabase/supabase-js@2.105.4";
const EDUTECH_URL = "https://fpbsvxplmjifcpvczfot.supabase.co";
const EDUTECH_KEY = "sb_publishable_7XKS46xxlEn5GWoX0dsgxg_pNBE6b1B";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin === "https://weshareeduteach.name.ng" || origin?.endsWith(".workers.dev") ? origin : "https://weshareeduteach.name.ng", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" });
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
    if (!token) return json({ error: "Sign in to manage this assessment" }, 401, origin);
    const auth = await fetch(`${EDUTECH_URL}/auth/v1/user`, { headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${token}` } });
    if (!auth.ok) return json({ error: "Your EduTech session is invalid or expired" }, 401, origin);
    const user = await auth.json();
    const { lesson_id } = await req.json();
    const postResponse = await fetch(`${EDUTECH_URL}/rest/v1/posts?id=eq.${encodeURIComponent(String(lesson_id))}&select=id,author_user_id,linked_quiz_id`, {
      headers: { apikey: EDUTECH_KEY, Authorization: `Bearer ${token}`, Accept: "application/vnd.pgrst.object+json" },
    });
    if (!postResponse.ok) throw new Error("Lesson not found");
    const post = await postResponse.json();
    if (!post?.id || post.author_user_id !== user.id) return json({ error: "Only the lesson publisher can edit this assessment" }, 403, origin);
    if (!post.linked_quiz_id) return json({ quiz: null }, 200, origin);
    const { data: quiz, error } = await admin.from("quizzes").select("id,title,description,status,attempt_limit,release_mode,release_at,time_limit_minutes")
      .eq("id", post.linked_quiz_id).eq("owner_edutech_user_id", user.id).single();
    if (error || !quiz) throw new Error("Linked assessment not found");
    const { data: version, error: versionError } = await admin.from("quiz_versions").select("id,version_number,snapshot")
      .eq("quiz_id", quiz.id).order("version_number", { ascending: false }).limit(1).single();
    if (versionError) throw versionError;
    const questions = (version.snapshot?.questions || []).map((q: any) => ({
      prompt: q.prompt, options: q.options, correct_option: q.correct_option, points: q.points,
      image_url: q.image_url || "", video_url: q.video_url || "",
    }));
    return json({ quiz, version_id: version.id, version_number: version.version_number, questions }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to load assessment" }, 400, origin);
  }
});
