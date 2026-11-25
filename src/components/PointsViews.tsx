import {scorePresentation} from '@/lib/scores'
import { useEffect, useState } from 'react'
import { useFmt, useStore } from '@/lib/store'
import { api, SERVER_MODE } from '@/lib/remote'
import { SCORE_FORMULA, type ScoreRecord, type ScoreReport } from '@/lib/scores'
import { Empty } from './common'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { canOverrideTaskScore, guard } from '@/lib/policy'
import { isActiveProjectId } from '@/lib/projectDetails'
import { toast } from 'sonner'

export function useSigned() { const { n } = useFmt(); return (x: number, frac = 1) => `\u2066${x > 0 ? '+' : x < 0 ? '−' : ''}${n(Math.abs(x), frac)}\u2069` }
export const deltaCls = (x: number) => x > 0 ? 'text-leaf-ink' : x < 0 ? 'text-destructive' : 'text-muted-foreground'
export function ScoreValue({ value }: { value: number | null | undefined }) {
 const {n}=useFmt(),p=scorePresentation(value)
 if(!p)return <span className="num text-muted-foreground">N/A</span>
 return <span className="inline-flex min-w-[88px] flex-col gap-1 align-middle text-xs" dir="ltr" style={{color:`var(--score-${p.tone})`}}><span className="num font-semibold">{n(value!,2)} <span className="text-muted-foreground">/ {n(100)}</span></span><span role="meter" aria-label="Score on scale 100" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.width} aria-valuetext={`Actual Rating ${value} ; Display Scale 100`} className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"><span className="block h-full rounded-full" style={{width:`${p.width}%`,background:'currentColor'}}/></span></span>
}
export function useScoreReport(filters: Record<string, string | undefined>) {
  const { state } = useStore(), query = new URLSearchParams(Object.entries(filters).filter(([,v]) => !!v) as [string,string][]).toString()
  const [result, setResult] = useState<{query: string; report?: ScoreReport; error?: string}>({query: ''})
  useEffect(() => {
    let cancelled = false
    if (!SERVER_MODE) { setResult({query,error:"The calculation of points requires a server connection."}); return }
    setResult({query})
    api<ScoreReport>(`/api/scores/report?${query}`).then(report => { if(!cancelled) setResult({query,report}) }).catch(e => { if(!cancelled) setResult({query,error:String(e.message)}) })
    return () => { cancelled = true }
  }, [query, state.scores])
  return result.query === query ? result : {query}
}
export function UserScore({userId}: {userId: string}) {
  const {state} = useStore(), r = state.scores?.[`user:${userId}`]
  return <div className="glass-card p-3 text-sm">User Rating: <b><ScoreValue value={r?.score}/></b><span className="ms-2 text-xs text-muted-foreground">The average number of completed tasks</span></div>
}
export function TaskScore({taskId}: {taskId: string}) {
  const {state,me,can} = useStore(), {n} = useFmt(), t = state.tasks[taskId], r = state.scores?.[`task:${taskId}`]
  if (!t || (!can.perm('points.manage') && t.assigneeUserId !== me.id)) return null
  return <section className="mt-3 rounded-xl border bg-background/45 p-3"><div className="eyebrow">Task Score</div><b className="text-xl"><ScoreValue value={r?.score}/></b><p className="text-xs text-muted-foreground">{r?.error ?? (!r ? "After completing and registering the actual end, it is calculated on the server." : `max(20, min(100, 60 − 40 × ${n(r.delta!,2)} ÷ ${n(r.duration!,2)})) · Calendar days`)}</p>{r?.override&&<p className="mt-1 text-xs">Manual score · Automatic: {r.calculatedScore==null?'N/A':n(r.calculatedScore,2)} · {r.override.reason}</p>}</section>
}
export function ScoreTiles({report:r}: {report:ScoreReport}) {
 const {n} = useFmt()
 return <div className="grid grid-cols-2 overflow-hidden glass-card lg:grid-cols-4">{[
 ["Average level of stress",<ScoreValue value={r.average}/>],["Reliable Task",n(r.count)],["Invalid/Incomplete Date",n(r.invalid)],["Early / early / later",`${n(r.early)} / ${n(r.ontime)} / ${n(r.late)}`]
 ].map(([label,value],i)=><div className="border-s p-4" key={i}><div className="eyebrow">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>)}</div>
}
export function ScoreTasks({rows}: {rows:ScoreRecord[]}) {
 const {state,dispatch,can,me,userById,teamById} = useStore(), {d,n} = useFmt()
 const [editing,setEditing]=useState<ScoreRecord|null>(null),[value,setValue]=useState(''),[reason,setReason]=useState('')
 const edit=(r:ScoreRecord)=>{setEditing(r);setValue(String(r.score??''));setReason('')}
 const save=(reset=false)=>{if(!editing?.taskId)return;const action={type:'taskScoreOverride' as const,taskId:editing.taskId,value:reset?null:Number(value),reason};const error=guard(state,action);if(error){toast.error(error);return}dispatch(action);setEditing(null)}
 if(!rows.length) return <Empty title="No tasks were completed in this period."/>
 return <><div className="scroll-x thin-scroll rounded-xl border"><table className="w-full min-w-[740px] text-xs"><thead><tr>{['Task',"Assignee / Team",'Actual Start',"Due Date",'Actual Finish',"Score / Reason"].map(x=><th className="p-3 text-start" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=>{const t=state.tasks[r.taskId!];const canEdit=t&&can.viewTask(t)&&canOverrideTaskScore(state,me)&&isActiveProjectId(state.projects,t.projectId)&&(r.score!==null||!!r.override);return <tr key={r.id} className="border-t"><td className="p-3">{t && can.viewTask(t)?<button className="text-start hover:underline" onClick={()=>{dispatch({type:'openProfile',id:null});dispatch({type:'openTask',id:t.id})}}>{t.name}</button>:"Task details unavailable"}</td><td className="p-3">{userById[r.userId??'']?.name??"No assignee"}<div className="text-muted-foreground">{teamById[r.teamId??'']?.name??"No team"}</div></td>{[r.actualStart,r.due,r.actualFinish].map((v,i)=><td key={i} className="num whitespace-nowrap p-3">{v?d(v):'—'}</td>)}<td className="p-3"><b><ScoreValue value={r.score}/></b><div className="text-muted-foreground">{r.error??`${n(r.duration!)} calendar days allowed, ${n(r.delta!)} calendar days late (negative means early)`}</div>{r.override&&<div className="mt-1 text-xs"><span className="rounded bg-secondary px-1.5 py-0.5 font-medium">Manual</span> · Calculated: {r.calculatedScore==null?'N/A':n(r.calculatedScore,2)}<p className="mt-1 break-words text-muted-foreground">{r.override.reason} · {userById[r.override.by]?.name??'PM'}</p></div>}{canEdit&&<Button size="sm" variant="outline" className="mt-2" onClick={()=>edit(r)}>Edit Score</Button>}</td></tr>})}</tbody></table></div><Dialog open={!!editing} onOpenChange={v=>{if(!v)setEditing(null)}}><DialogContent><DialogHeader><DialogTitle>Edit Task Score</DialogTitle><DialogDescription>{state.tasks[editing?.taskId??'']?.name} · Automatic formula score: {editing?.calculatedScore==null?'N/A':n(editing.calculatedScore,2)}. Manual values are used in reports until reset. Enter an audit reason.</DialogDescription></DialogHeader><label className="text-sm">Score (20–100)<Input type="number" min={20} max={100} step="0.01" value={value} onChange={e=>setValue(e.target.value)}/></label><label className="text-sm">Reason<Textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} placeholder="Why is this score being adjusted?"/></label><DialogFooter>{editing?.override&&<Button variant="outline" disabled={!reason.trim()} onClick={()=>save(true)}>Reset to Automatic</Button>}<Button disabled={!reason.trim()||!value||!Number.isFinite(Number(value))||Number(value)<20||Number(value)>100||editing?.calculatedScore===null} onClick={()=>save()}>Save Score</Button></DialogFooter></DialogContent></Dialog></>
}
export function MyPoints({userId}: {userId:string}) {
 const {report,error}=useScoreReport({user:userId})
 return <div className="flex flex-col gap-4"><p className="text-xs text-muted-foreground">{SCORE_FORMULA}; calendar days, 60 for on-time completion, bounded from 20 to 100.</p>{error?<p role="alert">{error}</p>:!report?<p>Getting points...</p>:<><ScoreTiles report={report}/><ScoreTasks rows={report.rows}/></>}</div>
}
export function TeamScore({teamId}: {teamId:string}) {
 const {state,can,dispatch}=useStore(),{n}=useFmt(),r=state.scores?.[`team:${teamId}`], [open,setOpen]=useState(false)
 const {report,error}=useScoreReport({team:teamId})
 return <section className="glass-card p-4"><div className="flex flex-wrap items-center gap-3"><h2 className="font-bold">Group overall score: <ScoreValue value={r?.score}/></h2><span className="text-xs text-muted-foreground">Average score {n(r?.count??0)} Active member with privileges; independent of group points in the project</span><button className="ms-auto text-sm underline" onClick={()=>setOpen(!open)}>Points Details</button></div>{open&&<div className="mt-4 space-y-3">{!can.perm('points.manage')&&<p className="text-xs text-muted-foreground">Details only include your own tasks; the overall score of the group of all eligible members is calculated.</p>}{error?<p role="alert">{error}</p>:report?<><div className="flex flex-wrap gap-3">{Object.values(state.scores??{}).filter(u=>u.kind==='user'&&u.teamId===teamId&&u.score!==null&&state.users.find(x=>x.id===u.userId)?.status==='active').map(u=><button className="underline" key={u.id} onClick={()=>dispatch({type:"openProfile",id:u.userId!,tab:"points"})}>{state.users.find(x=>x.id===u.userId)?.name}: <ScoreValue value={u.score}/></button>)}</div><ScoreTasks rows={report.rows.filter(r=>state.users.some(u=>u.id===r.userId&&u.status==='active'&&u.teamId===teamId))}/></>:<p>receiving...</p>}</div>}</section>
}
