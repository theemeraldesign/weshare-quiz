"use client";
import {useEffect,useState} from "react";
import {useParams} from "next/navigation";
import {db} from "@/lib/db";
import Brand from "@/components/Brand";
import {ClipboardCheck,SearchCheck,LogOut,ShieldCheck,LockKeyhole,Mail,ArrowRight,CheckCircle2,Clock3} from "lucide-react";

type Q={id:string;kind:"primary"|"remedial";prompt:string;options:string[];parent_question_id:string|null;position:number};
type ParticipantProfile={user_id:string;full_name:string;matric_number:string;department:string;email:string};
type Result={status:string;message?:string;score?:number;max_score?:number;submitted_at?:string;participant_name?:string};

export default function ParticipantQuiz(){
 const {slug}=useParams<{slug:string}>();
 const [quiz,setQuiz]=useState<any>(null),[session,setSession]=useState<any>(null),[profile,setProfile]=useState<ParticipantProfile|null>(null);
 const [profileForm,setProfileForm]=useState({full_name:"",matric_number:"",department:""});
 const [answers,setAnswers]=useState<Record<string,number>>({}),[unlocked,setUnlocked]=useState<Record<string,boolean>>({});
 const [identity,setIdentity]=useState({email:""}),[extra,setExtra]=useState<Record<string,string>>({});
 const [message,setMessage]=useState(""),[submitted,setSubmitted]=useState(false),[result,setResult]=useState<Result|null>(null);
 const [lookupMode,setLookupMode]=useState(false),[busy,setBusy]=useState(false),[authLoading,setAuthLoading]=useState(true),[profileSaving,setProfileSaving]=useState(false);
 useEffect(()=>{if(!db)return;let active=true;
  db.rpc("get_public_quiz",{p_slug:slug}).then(({data,error})=>{if(!active)return;if(error)setMessage(error.message);else setQuiz(data)});
  db.auth.getSession().then(async({data})=>{if(!active)return;setSession(data.session);setAuthLoading(false)});
  const {data:listener}=db.auth.onAuthStateChange((_event,next)=>{setSession(next);setProfile(null);setAuthLoading(false)});
  return()=>{active=false;listener.subscription.unsubscribe()};
 },[slug]);
 useEffect(()=>{if(!db||!session?.user)return;let active=true;
  (async()=>{const email=session.user.email||"";setIdentity({email});const {data,error}=await db!.from("participant_profiles").select("*").eq("user_id",session.user.id).maybeSingle();
   if(!active)return;if(error){setMessage(error.message);return}
   if(data){setProfile(data);setProfileForm({full_name:data.full_name,matric_number:data.matric_number,department:data.department});
    if(quiz?.participant_fields){const next:Record<string,string>={};for(const f of quiz.participant_fields){const key=String(f.label).trim().toLowerCase();if(key==="name")next[f.label]=data.full_name;else if(key==="matric number"||key==="matric no")next[f.label]=data.matric_number;else if(key==="department")next[f.label]=data.department;}setExtra(old=>({...next,...old}))}
    if(quiz?.mode==="tutorial"){const {data:progress,error:progressError}=await db!.rpc("get_tutorial_progress",{p_slug:slug});if(!active)return;if(progressError)setMessage(progressError.message);else{const a:Record<string,number>={},u:Record<string,boolean>={};for(const item of progress||[]){a[item.question_id]=item.selected_option;if(item.unlocks_remedial)u[item.question_id]=true}setAnswers(a);setUnlocked(u)}}
   }
  })();return()=>{active=false};
 },[session,quiz,slug]);
 if(!db)return <main className="quizwrap"><section className="panel">Assessment service is not configured.</section></main>;
 if(!quiz)return <main className="quizwrap"><Brand/><section className="panel">{message||"Loading assessment…"}</section></main>;
 const questions:Q[]=quiz.questions||[],primary=questions.filter(q=>q.kind==="primary").sort((a,b)=>a.position-b.position),remedial=questions.filter(q=>q.kind==="remedial");
 const participantFields:any[]=quiz.participant_fields||[];
 const profileExtra:Record<string,string>={};for(const f of participantFields){const key=String(f.label).trim().toLowerCase();if(key==="name")profileExtra[f.label]=profile?.full_name||"";else if(key==="matric number"||key==="matric no")profileExtra[f.label]=profile?.matric_number||"";else if(key==="department")profileExtra[f.label]=profile?.department||"";}
