"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import CustomSelect from "@/components/CustomSelect";
import Brand from "@/components/Brand";
import { ArrowUpRight, LogOut, Plus } from "lucide-react";

type Quiz = { id: string; title: string; mode: string; status: string; slug: string };

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("exam");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) { setLoading(false); return; }
    db.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = db.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!db || !session?.user) { setProfile(null); setQuizzes([]); return; }
    let active = true;
    (async () => {
      setLoading(true);
      const user = session.user;
      const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Quizzer";
      const { data: existing, error: lookupError } = await db!.from("instructors").select("*").eq("user_id", user.id).maybeSingle();
      if (!active) return;
      if (lookupError) { setMessage(lookupError.message); setLoading(false); return; }
      if (!existing) {
        const { error: insertError } = await db!.from("instructors").insert({ user_id: user.id, display_name: displayName });
        if (insertError && insertError.code !== "23505") {
          setMessage(insertError.message);
          setLoading(false);
          return;
        }
      }
      const [{ data: savedProfile, error: profileError }, { data: savedQuizzes, error: quizError }] = await Promise.all([
        db!.from("instructors").select("*").eq("user_id", user.id).single(),
        db!.from("quizzes").select("id,title,mode,status,slug").eq("owner_id", user.id).order("created_at", { ascending: false })
      ]);
      if (!active) return;
      if (profileError || quizError) setMessage(profileError?.message || quizError?.message || "Unable to load your workspace.");
      setProfile(savedProfile);
      setQuizzes(savedQuizzes || []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [session]);

  async function signIn() {
    if (!db) return;
    setBusy(true);
    setMessage("");
    const { error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin, queryParams: { access_type: "offline", prompt: "select_account" } }
    });
    if (error) { setMessage(error.message); setBusy(false); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!db || !session?.user || !title.trim()) return;
    setBusy(true);
    setMessage("");
    const { data, error } = await db.from("quizzes").insert({ owner_id: session.user.id, title: title.trim(), mode }).select("id").single();
    setBusy(false);
    if (error) setMessage(error.message);
    else location.href = "/instructor/" + data.id;
  }

  if (!db) return <main className="wrap"><section className="hero"><span className="eyebrow">WESHARE ASSESSMENTS</span><h1>One link.<br />Clear assessments.</h1><p>Supabase configuration is missing. Add the public Supabase URL and anon key to Vercel.</p></section></main>;

  return <>
    <header className="top"><Brand /><span className="subtle">QUIZ WORKSPACE</span></header>
    <main className="wrap">
      {!session ? <section className="hero">
        <div><span className="eyebrow">ASSESSMENT, MADE CLEAR</span><h1>Better questions.<br />Clearer outcomes.</h1><p>Create examinations and guided tutorials, or open a shared quiz link to take an assessment.</p></div>
        <section className="panel"><span className="eyebrow">GOOGLE SIGN-IN</span><h2>Continue with Google</h2><p>Sign in once to create quizzes or take an assessment shared with you.</p><button className="btn" disabled={busy} onClick={signIn}>{busy ? "Redirecting…" : "Continue with Google"}</button>{message && <p className="notice">{message}</p>}</section>
      </section> : loading ? <section className="panel narrow"><p>Preparing your Quizzer workspace…</p></section> : <>
        <section className="welcome"><div><span className="eyebrow">QUIZZER WORKSPACE</span><h1>Welcome, {profile?.display_name || session.user.user_metadata?.full_name || "Quizzer"}</h1><p>Create a quiz or manage your published assessments.</p></div><button className="btn ghost" onClick={() => db!.auth.signOut()}><LogOut size={16} /> Sign out</button></section>
        <section className="panel"><h2>Create a quiz</h2><form className="create" onSubmit={create}><label>Quiz title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. MTH 202: Calculus Test" /></label><label>Quiz mode<CustomSelect value={mode} onChange={setMode} options={[{ value: "exam", label: "Examination, results released later" }, { value: "tutorial", label: "Tutorial, immediate feedback" }]} /></label><button className="btn" disabled={busy}><Plus size={17} /> {busy ? "Creating…" : "Create quiz"}</button></form>{message && <p className="notice">{message}</p>}</section>
        <section className="section"><div className="sectionhead"><h2>Your quizzes</h2><span className="subtle">{quizzes.length} total</span></div>{quizzes.length === 0 ? <p className="empty">Your quizzes will appear here.</p> : <div className="quizlist">{quizzes.map(q => <a className="quizrow" href={"/instructor/" + q.id} key={q.id}><div><strong>{q.title}</strong><small>{q.mode} · {q.status}</small></div><span>Manage <ArrowUpRight size={16} /></span></a>)}</div>}</section>
      </>}
    </main>
    <footer>WeShare Quiz <span>Built for focused learning</span></footer>
  </>;
}
