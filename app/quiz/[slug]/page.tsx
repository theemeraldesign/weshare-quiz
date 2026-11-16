"use client";
import {useEffect,useRef,useState} from "react";
import {useParams} from "next/navigation";
import {db} from "@/lib/db";
import Brand from "@/components/Brand";
import {ClipboardCheck,SearchCheck,LogOut,ShieldCheck,LockKeyhole,Mail,ArrowRight,Clock3} from "lucide-react";
type Q={id:string;prompt:string;options:string[];parent_question_id?:string|null;position:number;image_url?:string|null};
type ParticipantProfile={user_id:string;full_name:string;matric_number:string;department:string;email:string};
type Result={status:string;message?:string;score?:number;max_score?:number;submitted_at?:string;participant_name?:string};
function stableHash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
export default function ParticipantQuiz(){
 const {slug}=useParams<{slug:string}>();
 const userIdRef=useRef<string|null>(null);
 const [quiz,setQuiz]=useState<any>(null),[session,setSession]=useState<any>(null),[profile,setProfile]=useState<ParticipantProfile|null>(null);
 const [answers,setAnswers]=useState<Record<string,number>>({}),[unlocked,setUnlocked]=useState<Record<string,boolean>>({}),[followups,setFollowups]=useState<Record<string,Q[]>>({});
 const [extra,setExtra]=useState<Record<string,string>>({}),[message,setMessage]=useState("");
 const [submitted,setSubmitted]=useState(false),[result,setResult]=useState<Result|null>(null),[lookupMode,setLookupMode]=useState(false);
 const [busy,setBusy]=useState(false),[authLoading,setAuthLoading]=useState(true),[participantLoading,setParticipantLoading]=useState(true),[currentStep,setCurrentStep]=useState(0);
 useEffect(()=>{if(!db)return;let active=true;
  db.rpc("get_public_quiz_v2",{p_slug:slug}).then(({data,error})=>{if(!active)return;if(error)setMessage(error.message);else setQuiz(data)});
  db.auth.getSession().then(({data})=>{if(!active)return;setSession(data.session);setAuthLoading(false)});
  const {data:listener}=db.auth.onAuthStateChange((_event,next)=>{setSession(next);setProfile(null);setAuthLoading(false)});
  return()=>{active=false;listener.subscription.unsubscribe()};
 },[slug]);
 useEffect(()=>{if(!db||!session?.user||!quiz)return;let active=true;
  (async()=>{
   setParticipantLoading(true);
   const user=session.user;
   const displayName=user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split("@")[0]||"Participant";
   const {data:existing,error}=await db!.from("participant_profiles").select("*").eq("user_id",user.id).maybeSingle();
   if(!active)return;
   if(error){setMessage(error.message);setParticipantLoading(false);return}
   let saved=existing;
   if(!saved){
    const {data:created,error:createError}=await db!.from("participant_profiles").insert({user_id:user.id,full_name:displayName,matric_number:"",department:"",email:(user.email||"").toLowerCase()}).select("*").single();
    if(createError&&createError.code==="23505"){
     const {data:again,error:againError}=await db!.from("participant_profiles").select("*").eq("user_id",user.id).single();
     if(againError){setMessage(againError.message);setParticipantLoading(false);return}
     saved=again;
    }else if(createError){setMessage(createError.message);setParticipantLoading(false);return}
    else saved=created;
   }
   if(!active)return;
   setProfile(saved);
   const next:Record<string,string>={};
   for(const f of quiz.participant_fields||[]){
    const key=String(f.label).trim().toLowerCase();
    if(key==="name")next[f.label]=saved.full_name;
    else if(key==="matric number"||key==="matric no")next[f.label]=saved.matric_number;
    else if(key==="department")next[f.label]=saved.department;
   }
   setExtra(old=>({...next,...old}));
   if(quiz.mode==="tutorial"){
    const {data:progress,error:progressError}=await db!.rpc("get_tutorial_progress",{p_slug:slug});
    if(!active)return;
    if(progressError)setMessage(progressError.message);
    else{
     const a:Record<string,number>={},u:Record<string,boolean>={},f:Record<string,Q[]>={};
     for(const item of progress||[]){
      a[item.question_id]=item.selected_option;
      if(item.unlocks_remedial){
       u[item.question_id]=true;
       const {data:followupsData}=await db!.rpc("get_unlocked_followups",{p_slug:slug,p_question_id:item.question_id});
       f[item.question_id]=followupsData||[];
      }
     }
     setAnswers(a);setUnlocked(u);setFollowups(f);
    }
   }
   const {data:priorSubmission}=await db!.rpc("lookup_assessment_result",{p_slug:slug,p_email:saved.email,p_matric:saved.matric_number});
   if(!active)return;
   if(priorSubmission){setSubmitted(true);setLookupMode(quiz.mode==="exam");setResult(priorSubmission)}
   setParticipantLoading(false);
  })();
  return()=>{active=false};
 },[session,quiz,slug]);
 if(!db)return <main className="quizwrap"><section className="panel">Assessment service is not configured.</section></main>;
 if(!quiz)return <main className="quizwrap"><Brand/><section className="panel">{message||"Loading assessment…"}</section></main>;
 const primary:Q[]=(quiz.questions||[]).filter((q:Q)=>!q.parent_question_id).slice();
 const seed=(session?.user?.id||"guest")+":"+slug;const randomizedPrimary=[...primary].sort((a,b)=>stableHash(seed+":"+a.id)-stableHash(seed+":"+b.id)||a.id.localeCompare(b.id));
 const steps:{q:Q}[]=randomizedPrimary.map(q=>({q}));
 const activeStep=Math.min(currentStep,Math.max(0,steps.length-1));const current=steps[activeStep];
 const currentFollowups=current&&quiz.mode==="tutorial"&&unlocked[current.q.id]?(followups[current.q.id]||[]):[];
 const currentGroupComplete=!!current&&answers[current.q.id]!==undefined&&currentFollowups.every(q=>answers[q.id]!==undefined);
 const participantFields:any[]=quiz.participant_fields||[];
 const profileExtra:Record<string,string>={};for(const f of participantFields){const key=String(f.label).trim().toLowerCase();if(key==="name")profileExtra[f.label]=profile?.full_name||"";else if(key==="matric number"||key==="matric no")profileExtra[f.label]=profile?.matric_number||"";else if(key==="department")profileExtra[f.label]=profile?.department||"";}
 async function signIn(){setBusy(true);setMessage("");const {error}=await db!.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.href,queryParams:{prompt:"select_account"}}});if(error){setMessage(error.message);setBusy(false)}}
 async function choose(q:Q,index:number){if(answers[q.id]!==undefined||busy)return;
  if(quiz.mode==="tutorial"){setBusy(true);setMessage("");const {data,error}=await db!.rpc("lock_tutorial_answer",{p_slug:slug,p_question_id:q.id,p_selected_option:index});
   if(error){setBusy(false);setMessage(error.message);return}
   setAnswers(old=>({...old,[q.id]:data.selected_option}));
   if(data.unlocks_remedial){const {data:followupsData,error:followupsError}=await db!.rpc("get_unlocked_followups",{p_slug:slug,p_question_id:q.id});if(followupsError)setMessage(followupsError.message);else{setUnlocked(old=>({...old,[q.id]:true}));setFollowups(old=>({...old,[q.id]:followupsData||[]}))}}
   setBusy(false);
  }else setAnswers(old=>({...old,[q.id]:index}));
 }
 async function submit(e:React.FormEvent){e.preventDefault();if(!profile){setMessage("Complete your participant profile first.");return}
  const required=quiz.mode==="exam"?primary:[...primary,...Object.values(followups).flat()];
  if(required.some(q=>answers[q.id]===undefined)){setMessage("Please answer every available question before submitting.");return}
  setBusy(true);setMessage("");const payload=required.map(q=>({question_id:q.id,selected_option:answers[q.id]}));
  const {data,error}=await db!.rpc("submit_assessment",{p_slug:slug,p_name:profile.full_name,p_email:profile.email,p_matric:profile.matric_number,p_extra:{...profileExtra,...extra},p_answers:payload});
  setBusy(false);if(error){setMessage(error.message);return}setSubmitted(true);setLookupMode(quiz.mode==="exam");if(data?.score!==undefined)setResult(data);
 }
 async function lookup(){if(!profile)return;setBusy(true);setMessage("");const {data,error}=await db!.rpc("lookup_assessment_result",{p_slug:slug,p_email:profile.email,p_matric:profile.matric_number});setBusy(false);if(error){setMessage(error.message);return}setResult(data)}
 const description=quiz.mode==="exam"?"Complete the questions and submit your work. Your result will be available when it is released.":"Work through the questions carefully. Your selections are saved as you go.";
 return <main className="quizwrap"><Brand/><section className="quizhero"><span className="eyebrow">{quiz.mode==="exam"?"EXAMINATION":"GUIDED PRACTICE"}</span><h1>{quiz.title}</h1><p>{quiz.description||description}</p></section>
 {!session?<section className="panel participant-auth"><span className="eyebrow">PARTICIPANT ACCESS</span><h2>Continue with Google</h2><p>Sign in with your Google account to save your details and assessment progress securely.</p><button className="btn" disabled={busy||authLoading} onClick={signIn}>{busy?"Opening Google…":"Continue with Google"} <ArrowRight size={17}/></button>{message&&<p className="notice">{message}</p>}</section>
 :participantLoading?<section className="panel">Preparing your Google account…</section> :!profile?<section className="panel">{message||"Unable to prepare your Google profile. Refresh and try again."}</section> :submitted?<><section className="panel"><span className="eyebrow">SUBMISSION COMPLETE</span><h2>Submission received</h2><p>{quiz.mode==="exam"?"Your examination has been submitted. Your result will appear here after your quizzer releases it.":"Your tutorial has been submitted successfully."}</p>{quiz.mode==="exam"&&<div className="result-pending"><Clock3 size={18}/> Result pending quizzer release</div>}{quiz.mode==="tutorial"&&result&&<div className="result-score"><span>Your result</span><strong>{result.score} / {result.max_score}</strong></div>}</section>{lookupMode&&<section className="panel"><h2>Your result</h2><p>Signed in as {profile.email}</p><button className="btn ghost" disabled={busy} onClick={lookup}><SearchCheck size={17}/>{busy?"Checking…":"Check result"}</button>{result&&<ResultView result={result}/>}{message&&<p className="notice">{message}</p>}</section>}</>
 :<form className="panel" onSubmit={submit}><div className="participant-signed"><div><span className="eyebrow">SIGNED IN</span><strong>{profile.full_name}</strong><small>{profile.email}</small></div><button className="text-action" type="button" onClick={()=>db!.auth.signOut()}><LogOut size={15}/> Sign out</button></div><h2>Your details</h2><div className="google-email"><Mail size={16}/>{profile.email}<ShieldCheck size={17}/></div><div className="identity">{participantFields.map((f:any)=><label key={f.label}>{f.label}<input required={!!f.required} value={profileExtra[f.label]!==undefined?profileExtra[f.label]:(extra[f.label]||"")} disabled={["name","matric number","matric no","department"].includes(String(f.label).trim().toLowerCase())} onChange={e=>setExtra({...extra,[f.label]:e.target.value})}/></label>)}</div><hr/><div className="question-progress"><div><h2>Questions</h2><span>Question {activeStep+1} of {steps.length}</span></div><div className="progress-track"><span style={{width:((activeStep+1)/Math.max(steps.length,1)*100)+"%"}}/></div></div>{current&&<><article className="participantq active-question" key={current.q.id}><small>QUESTION {activeStep+1}</small>{current.q.image_url&&<img className="participant-question-image" src={current.q.image_url} alt="Question illustration"/>}<strong>{current.q.prompt}</strong>{current.q.options.map((option,j)=><label className={`answer ${answers[current.q.id]===j?"selected":""}`} key={j}><input type="radio" name={current.q.id} checked={answers[current.q.id]===j} disabled={answers[current.q.id]!==undefined||busy} onChange={()=>choose(current.q,j)}/>{String.fromCharCode(65+j)}. {option}{answers[current.q.id]===j&&<LockKeyhole size={15}/>}</label>)}</article>{currentFollowups.map((r,index)=><article className="participantq active-question followup-question" key={r.id}><small>FOLLOW-UP {index+1}</small>{r.image_url&&<img className="participant-question-image" src={r.image_url} alt="Question illustration"/>}<strong>{r.prompt}</strong>{r.options.map((option,j)=><label className={`answer ${answers[r.id]===j?"selected":""}`} key={j}><input type="radio" name={r.id} checked={answers[r.id]===j} disabled={answers[r.id]!==undefined||busy} onChange={()=>choose(r,j)}/>{String.fromCharCode(65+j)}. {option}{answers[r.id]===j&&<LockKeyhole size={15}/>}</label>)}</article>)}</>}<div className="question-navigation"><button type="button" className="btn ghost" disabled={activeStep===0||busy} onClick={()=>setCurrentStep(x=>Math.max(0,x-1))}>Previous</button>{activeStep<steps.length-1?<button type="button" className="btn" disabled={!currentGroupComplete||busy} onClick={()=>setCurrentStep(x=>Math.min(steps.length-1,x+1))}>Next</button>:<button type="submit" className="btn" disabled={busy||!currentGroupComplete||steps.some(step=>answers[step.q.id]===undefined)||Object.values(followups).flat().some(q=>answers[q.id]===undefined)}><ClipboardCheck size={17}/>{busy?"Submitting…":"Submit assessment"}</button>}</div>{message&&<p className="notice">{message}</p>}</form>}
 </main>
}
function ResultView({result}:{result:Result}){if(result.status==="pending")return <div className="result-pending"><Clock3 size={18}/>{result.message||"Your result has not been released yet."}</div>;if(result.status!=="released"&&result.score===undefined)return <p className="notice">Your result is not available yet.</p>;return <div className="result-card"><div><span>Score</span><strong>{result.score} / {result.max_score}</strong></div><div><span>Submitted</span><strong>{result.submitted_at?new Date(result.submitted_at).toLocaleString():"Recorded"}</strong></div></div>}
