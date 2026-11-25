import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useStore } from '@/lib/store'
import { defaultDeadlineRules } from '@/lib/office'
import { useWorkspaceSave } from '@/lib/useWorkspaceSave'
export function DeadlineSettings(){
  const {state,me}=useStore(),{save,busy}=useWorkspaceSave()
  const [rules,setRules]=useState(()=>state.deadlinePreferences[me.id]?.rules??defaultDeadlineRules())
  const [units,setUnits]=useState(['hours','hours','hours','hours'])
  return <section className="glass-card p-4" aria-label="Notification Preferences"><h2 className="font-semibold">Notification Preferences</h2><p className="my-2 text-xs text-muted-foreground">Set reminders before tasks are due. Deadlines use Tehran time. Tasks without an estimate use the first group.</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{['0–20 estimated hours','Over 20 to 50 hours','Over 50 to 100 hours','Over 100 hours'].map((label,i)=><fieldset key={i} className="rounded-xl border p-3"><legend className="px-1 text-sm">{label}</legend><label className="flex gap-2 text-sm"><input type="checkbox" checked={rules[i].enabled} onChange={e=>setRules(r=>r.map((x,j)=>i===j?{...x,enabled:e.target.checked}:x))}/>Enable reminder</label><label className="mt-2 block text-xs">Time before deadline<Input aria-label={`Reminder time for group ${i+1}`} type="number" min={0} max={units[i]==='days'?365:8760} step="any" disabled={!rules[i].enabled} value={rules[i].hours/(units[i]==='days'?24:1)} onChange={e=>setRules(r=>r.map((x,j)=>i===j?{...x,hours:Number(e.target.value)*(units[i]==='days'?24:1)}:x))}/></label><select aria-label={`Reminder unit for group ${i+1}`} className="mt-2 w-full rounded-md border bg-background p-2 text-sm" value={units[i]} onChange={e=>setUnits(u=>u.map((x,j)=>j===i?e.target.value:x))}><option value="hours">Hours</option><option value="days">Days</option></select></fieldset>)}</div><Button className="mt-3" disabled={busy} onClick={()=>void save({type:'deadlineSettings',rules})}>Save Notification Preferences</Button></section>
}
