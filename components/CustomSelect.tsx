"use client";
import {useEffect,useRef,useState} from "react";

type Option={value:string|number;label:string};
type Props={value:string|number;options:Option[];onChange:(value:string)=>void;placeholder?:string;disabled?:boolean;required?:boolean;name?:string};

export default function CustomSelect({value,options,onChange,placeholder="Select an option",disabled=false,required=false,name}:Props){
 const [open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null);
 const selected=options.find(option=>String(option.value)===String(value));
 useEffect(()=>{
  function outside(event:MouseEvent){if(root.current&&!root.current.contains(event.target as Node))setOpen(false)}
  function escape(event:KeyboardEvent){if(event.key==="Escape")setOpen(false)}
  document.addEventListener("mousedown",outside);document.addEventListener("keydown",escape);
  return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",escape)};
 },[]);
 return <div className={"custom-select"+(open?" is-open":"")+(disabled?" is-disabled":"")} ref={root}>
  {name&&<input type="hidden" name={name} value={String(value)}/>}
  <button type="button" className="custom-select-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(v=>!v)}>
   <span className={selected?"":"custom-select-placeholder"}>{selected?.label||placeholder}</span><span className="custom-select-chevron" aria-hidden="true"/>
  </button>
  {open&&<div className="custom-select-menu" role="listbox">
   {options.map((option,index)=><button type="button" role="option" aria-selected={String(option.value)===String(value)} className={"custom-select-option"+(String(option.value)===String(value)?" selected":"")} key={String(option.value)} onClick={()=>{onChange(String(option.value));setOpen(false)}}>
    <span>{option.label}</span><span className="custom-select-indicator">{String(option.value)===String(value)?"✓":""}</span>
   </button>)}
   {!options.length&&<div className="custom-select-empty">No options available</div>}
  </div>}
  {required&&!selected&&<span className="sr-only">Please select an option</span>}
 </div>;
}
