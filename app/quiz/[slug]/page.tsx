"use client";
import {useEffect,useState} from "react";
import {useParams} from "next/navigation";
import {db} from "@/lib/db";
import Brand from "@/components/Brand";
import {ClipboardCheck,SearchCheck,LogOut,ShieldCheck,LockKeyhole,Mail,ArrowRight,Clock3} from "lucide-react";
type Q={id:string;kind:"primary"|"remedial";prompt:string;options:string[];parent_question_id:string|null;position:number};
type ParticipantProfile={user_id:string;full_name:string;matric_number:string;department:string;email:string};
type Result={status:string;message?:string;score?:number;max_score?:number;submitted_at?:string;participant_name?:string};
export default function ParticipantQuiz(){
 const {slug}=useParams<{slug:string}>();
 const [quiz,setQuiz]=useState<any>(null),[session,setSession]=useState<any>(null),[profile,setProfile]=useState<ParticipantProfile|null>(null);
 const [profileForm,setProfileForm]=useState({full_name:"",matric_number:"",department:""});
 const [answers,setAnswers]=useState<Record<string,number>>({}),[unlocked,setUnlocked]=useState<Record<string,boolean>>({});
 const [extra,setExtra]=useState<Record<string,string>>({}),[message,setMessage]=useState("");
 const [submitted,setSubmitted]=useState(false),[result,setResult]=useState<Result|null>(null),[lookupMode,setLookupMode]=useState(false);
 const [busy,setBusy]=useState(false),[authLoading,setAuthLoading]=useState(true),[profileSaving,setProfileSaving]=useState(false),[participantLoading,setParticipantLoading]=useState(false);
 useEffect(()=>{if(!db)return;let active=true;
  db.rpc("get_public_quiz",{p_slug:slug}).then(({data,error})=>{if(!active)return;if(error)setMessage(error.message);else setQuiz(data)});
  db.auth.getSession().then(({data})=>{if(!active)return;setSession(data.session);setAuthLoading(false)});
  const {data:listener}=db.auth.onAuthStateChange((_event,next)=>{setSession(next);setProfile(null);setAuthLoading(false)});
  return()=>{active=false;listener.subscription.unsubscribe()};
 },[slug]);
 useEffect(()=>{if(!db||!session?.user||!quiz)return;let active=true;
  (async()=>{const {data,error}=await db!.from("participant_profiles").select("*").eq("user_id",session.user.id).maybeSingle();
   if(!active)return;if(error){setMessage(error.message);return}
   if(data){setParticipantLoading(true);setProfile(data);setProfileForm({full_name:data.full_name,matric_number:data.matric_number,department:data.department});
    const next:Record<string,string>={};for(const f of quiz.participant_fields||[]){const key=String(f.label).trim().toLowerCase();if(key==="name")next[f.label]=data.full_name;else if(key==="matric number"||key==="matric no")next[f.label]=data.matric_number;else if(key==="department")next[f.label]=data.department;}setExtra(old=>({...next,...old}));
    if(quiz.mode==="tutorial"){const {data:progress,error:progressError}=await db!.rpc("get_tutorial_progress",{p_slug:slug});if(!active)return;if(progressError)setMessage(progressError.message);else{const a:Record<string,number>={},u:Record<string,boolean>={};for(const item of progress||[]){a[item.question_id]=item.selected_option;if(item.unlocks_remedial)u[item.question_id]=true}setAnswers(a);setUnlocked(u)}}
    const {data:priorSubmission}=await db!.rpc("lookup_assessment_result",{p_slug:slug,p_email:data.email,p_matric:data.matric_number});if(!active)return;if(priorSubmission){setSubmitted(true);setLookupMode(true);setResult(priorSubmission)}setParticipantLoading(false);
   }
  })();return()=>{active=false};
 },[session,quiz,slug]);
 if(!db)return <main className="quizwrap"><section className="panel">Assessment service is not configured.</section></main>;
 if(!quiz)return <main className="quizwrap"><Brand/><section className="panel">{message||"Loading assessment…"}</section></main>;
 const questions:Q[]=quiz.questions||[],primary=questions.filter(q=>q.kind==="primary").sort((a,b)=>a.position-b.position),remedial=questions.filter(q=>q.kind==="remedial");
 const participantFields:any[]=quiz.participant_fields||[];
 const profileExtra:Record<string,string>={};for(const f of participantFields){const key=String(f.label).trim().toLowerCase();if(key==="name")profileExtra[f.label]=profile?.full_name||"";else if(key==="matric number"||key==="matric no")profileExtra[f.label]=profile?.matric_number||"";else if(key==="department")profileExtra[f.label]=profile?.department||"";}
 async function signIn(){setBusy(true);setMessage("");const {error}=await db!.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.href,queryParams:{prompt:"select_account"}}});if(error){setMessage(error.message);setBusy(false)}}
 async function saveProfile(e:React.FormEvent){e.preventDefault();if(!session?.user)return;setProfileSaving(true);setMessage("");
  const row={user_id:session.user.id,full_name:profileForm.full_name.trim(),matric_number:profileForm.matric_number.trim().toUpperCase(),department:profileForm.department.trim(),email:(session.user.email||"").toLowerCase()};
  const {data,error}=await db!.from("participant_profiles").insert(row).select("*").single();setProfileSaving(false);
  if(error){setMessage(error.code==="23505"?"A profile already exists for this Google account. Refresh the page.":error.message);return}setProfile(data);
 }
 async function choose(q:Q,index:number){if(answers[q.id]!==undefined||busy)return;
  if(quiz.mode==="tutorial"){setBusy(true);setMessage("");const {data,error}=await db!.rpc("lock_tutorial_answer",{p_slug:slug,p_question_id:q.id,p_selected_option:index});setBusy(false);
   if(error){setMessage(error.message);return}setAnswers(old=>({...old,[q.id]:data.selected_option}));if(data.unlocks_remedial)setUnlocked(old=>({...old,[q.id]:true}));
  }else setAnswers(old=>({...old,[q.id]:index}));
 }
 async function submit(e:React.FormEvent){e.preventDefault();if(!profile){setMessage("Complete your participant profile first.");return}
  const required=quiz.mode==="exam"?primary:questions.filter(q=>q.kind==="primary"||(q.kind==="remedial"&&unlocked[q.parent_question_id||""]));
  if(required.some(q=>answers[q.id]===undefined)){setMessage("Please answer every available question before submitting.");return}
  setBusy(true);setMessage("");const payload=required.map(q=>({question_id:q.id,selected_option:answers[q.id]}));
  const {data,error}=await db!.rpc("submit_assessment",{p_slug:slug,p_name:profile.full_name,p_email:profile.email,p_matric:profile.matric_number,p_extra:{...profileExtra,...extra},p_answers:payload});
  setBusy(false);if(error){setMessage(error.message);return}setSubmitted(true);setLookupMode(true);if(data?.score!==undefined)setResult(data);
 }
 async function lookup(){if(!profile)return;setBusy(true);setMessage("");const {data,error}=await db!.rpc("lookup_assessment_result",{p_slug:slug,p_email:profile.email,p_matric:profile.matric_number});setBusy(false);if(error){setMessage(error.message);return}setResult(data)}
 const description=quiz.mode==="exam"?"Complete the questions and submit your work. Your result will be available when it is released.":"Work through the questions carefully. Your selections are saved as you go.";
 return <main className="quizwrap"><Brand/><section className="quizhero"><span className="eyebrow">{quiz.mode==="exam"?"EXAMINATION":"GUIDED PRACTICE"}</span><h1>{quiz.title}</h1><p>{quiz.description||description}</p></section>
 {!session?<section className="panel participant-auth"><span className="eyebrow">PARTICIPANT ACCESS</span><h2>Continue with Google</h2><p>Sign in with your Google account to save your details and assessment progress securely.</p><button className="btn" disabled={busy||authLoading} onClick={signIn}>{busy?"Opening Google…":"Continue with Google"} <ArrowRight size={17}/></button>{message&&<p className="notice">{message}</p>}</section>
 :!profile?<section className="panel"><span className="eyebrow">ONE-TIME PARTICIPANT SETUP</span><h2>Your details</h2><div className="google-email"><Mail size={16}/><span>{session.user.email}</span><ShieldCheck size={17}/></div><p className="profile-reminder">Please verify your name, matric number and department carefully. These details identify your assessment records. You will not be able to change an answer after selecting it.</p><form onSubmit={saveProfile} className="profile-form"><label>Full name<input required autoComplete="name" value={profileForm.full_name} onChange={e=>setProfileForm({...profileForm,full_name:e.target.value})}/></label><label>Matric number<input required autoComplete="off" value={profileForm.matric_number} onChange={e=>setProfileForm({...profileForm,matric_number:e.target.value.toUpperCase()})}/></label><label>Department<input required value={profileForm.department} onChange={e=>setProfileForm({...profileForm,department:e.target.value})}/></label><button className="btn" disabled={profileSaving}>{profileSaving?"Saving details…":"Save details and continue"}</button></form>{message&&<p className="notice">{message}</p>}</section>
 :participantLoading?<section className="panel">Restoring your saved progress…</section> :submitted?<><section className="panel"><span className="eyebrow">SUBMISSION COMPLETE</span><h2>Submission received</h2><p>{quiz.mode==="exam"?"Your examination has been submitted. Your result will appear here after your lecturer releases it.":"Your tutorial has been submitted successfully."}</p>{quiz.mode==="exam"&&<div className="result-pending"><Clock3 size={18}/> Result pending lecturer release</div>}{quiz.mode==="tutorial"&&result&&<div className="result-score"><span>Your result</span><strong>{result.score} / {result.max_score}</strong></div>}</section>{lookupMode&&<section className="panel"><h2>Your result</h2><p>Signed in as {profile.email}</p><button className="btn ghost" disabled={busy} onClick={lookup}><SearchCheck size={17}/>{busy?"Checking…":"Check result"}</button>{result&&<ResultView result={result}/>}{message&&<p className="notice">{message}</p>}</section>}</>
 :<form className="panel" onSubmit={submit}><div className="participant-signed"><div><span className="eyebrow">SIGNED IN</span><strong>{profile.full_name}</strong><small>{profile.email}</small></div><button className="text-action" type="button" onClick={()=>db!.auth.signOut()}><LogOut size={15}/> Sign out</button></div><h2>Your details</h2><div className="google-email"><Mail size={16}/>{profile.email}<ShieldCheck size={17}/></div><div className="identity">{participantFields.map((f:any)=><label key={f.label}>{f.label}<input required={!!f.required} value={profileExtra[f.label]!==undefined?profileExtra[f.label]:(extra[f.label]||"")} disabled={["name","matric number","matric no","department"].includes(String(f.label).trim().toLowerCase())} onChange={e=>setExtra({...extra,[f.label]:e.target.value})}/></label>)}</div><hr/><h2>Questions</h2>{primary.map((q,i)=><article className="participantq" key={q.id}><small>QUESTION {i+1}</small><strong>{q.prompt}</strong>{q.options.map((option,j)=><label className={`answer ${answers[q.id]===j?"selected":""}`} key={j}><input type="radio" name={q.id} checked={answers[q.id]===j} disabled={answers[q.id]!==undefined||busy} onChange={()=>choose(q,j)}/>{String.fromCharCode(65+j)}. {option}{answers[q.id]===j&&<LockKeyhole size={15}/>}</label>)}{quiz.mode==="tutorial"&&unlocked[q.id]&&remedial.filter(r=>r.parent_question_id===q.id).sort((a,b)=>a.position-b.position).map(r=><div className="remedial" key={r.id}><strong>{r.prompt}</strong>{r.options.map((option,j)=><label className={`answer ${answers[r.id]===j?"selected":""}`} key={j}><input type="radio" name={r.id} checked={answers[r.id]===j} disabled={answers[r.id]!==undefined||busy} onChange={()=>choose(r,j)}/>{String.fromCharCode(65+j)}. {option}{answers[r.id]===j&&<LockKeyhole size={15}/>}</label>)}</div>)}</article>)}<button className="btn" disabled={busy}><ClipboardCheck size={17}/>{busy?"Saving…":"Submit assessment"}</button>{message&&<p className="notice">{message}</p>}</form>}
 </main>
}
function ResultView({result}:{result:Result}){if(result.status==="pending")return <div className="result-pending"><Clock3 size={18}/>{result.message||"Your result has not been released yet."}</div>;if(result.status!=="released")return <p className="notice">Your result is not available yet.</p>;return <div className="result-card"><div><span>Score</span><strong>{result.score} / {result.max_score}</strong></div><div><span>Submitted</span><strong>{result.submitted_at?new Date(result.submitted_at).toLocaleString():"Recorded"}</strong></div></div>}
