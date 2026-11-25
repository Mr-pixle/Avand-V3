import { supervisionGuard, applySupervision, type SupervisionAction, type SupervisionWorkflow } from './supervision'
import type { State } from './state'
import type { Priority, User } from './types'
import { canViewSupervisionOf, canViewTask, has } from './policy'
import { isClosed, isFlowTask, isWorkItem, statusOf } from './domain'
import { isActiveProjectId } from './projectDetails'

export interface DeadlineRule { enabled: boolean; hours: number }
export interface DeadlinePreferences { id: string; rules: DeadlineRule[]; updatedAt: string }
export interface SiteVisit { id: string; projectId: string; title: string; description: string; at: string; assigneeId: string; participantIds: string[]; priority: Priority; status: 'planned'|'confirmed'|'completed'|'cancelled'; createdBy: string; createdAt: string; updatedAt: string }
export interface OfficeData { supervisionWorkflows?: Record<string,SupervisionWorkflow>; deadlinePreferences: Record<string, DeadlinePreferences>; deadlineEvents: Record<string,{id:string;at:string}>; siteVisits: Record<string,SiteVisit> }
export const emptyOffice = ():OfficeData=>({supervisionWorkflows:{},deadlinePreferences:{},deadlineEvents:{},siteVisits:{}})
export const defaultDeadlineRules = ():DeadlineRule[]=>[24,48,72,120].map(hours=>({enabled:true,hours}))
export const estimationGroup=(hours:number)=>hours<=20?0:hours<=50?1:hours<=100?2:3
export const VISIT_STATUS={planned:"Scheduled",confirmed:"Coordinated",completed:"It was done",cancelled:"Cancelled"}
export type OfficeAction = SupervisionAction | {type:'deadlineSettings';rules:DeadlineRule[]}|{type:'sysDeadlines';now:string}|{type:'visitSave';visit:Omit<SiteVisit,'createdBy'|'createdAt'|'updatedAt'>}|{type:'visitDelete';id:string}
export const OFFICE_ACTIONS=new Set(['supervisionWorkflow','supervisionStatus','deadlineSettings','sysDeadlines','visitSave','visitDelete'])
export const canViewVisit=(s:State,u:User,v:SiteVisit)=>u.status==='active'&&(canViewSupervisionOf(s,u,v.projectId)||v.assigneeId===u.id||v.participantIds.includes(u.id))
const date=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))
export function officeGuard(s:State,raw:unknown):string|null{
  const a=raw as OfficeAction
  if(a.type==='supervisionWorkflow'||a.type==='supervisionStatus')return supervisionGuard(s,a)
  if(a.type==='sysDeadlines')return !s.session&&date(a.now)?null:"This operation is only for the server."
  const u=s.users.find(u=>u.id===s.session)
  if(!u||u.status!=='active')return "Entering an active account is required."
  if(a.type==='deadlineSettings')return Array.isArray(a.rules)&&a.rules.length===4&&a.rules.every(r=>r&&typeof r.enabled==='boolean'&&typeof r.hours==='number'&&Number.isFinite(r.hours)&&r.hours>=0&&r.hours<=8760)?null:"Four intervals with zero time up to 8760 hours are required."
  if(!has(u,'supervision.create'))return "Visiting management is only for the supervisor and manager."
  if(a.type==='visitDelete')return s.siteVisits[a.id]?null:"No visit was found."
  if(a.type==='visitSave'){
    const v=a.visit
    if(!v||typeof v.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v.id)||['__proto__','constructor','prototype'].includes(v.id)||!s.projects.some(p=>p.id===v.projectId)||typeof v.title!=='string'||!v.title.trim()||v.title.length>200||typeof v.description!=='string'||v.description.length>10000||!date(v.at)||!Object.hasOwn(VISIT_STATUS,v.status)||!['none','low','normal','high','urgent'].includes(v.priority))return "The visit profile is invalid."
    if(!Array.isArray(v.participantIds)||new Set(v.participantIds).size!==v.participantIds.length||![v.assigneeId,...v.participantIds].every(id=>s.users.some(p=>p.id===id&&p.status==='active')))return "Choose the responsible and active participants."
    return null
  }
  return "Operation is unknown."
}
export function applyOffice(s:State,a:OfficeAction):State{
  if(a.type==='supervisionWorkflow'||a.type==='supervisionStatus')return applySupervision(s,a)
  const at=new Date().toISOString()
  if(a.type==='deadlineSettings')return {...s,deadlinePreferences:{...s.deadlinePreferences,[s.session!]:{id:s.session!,rules:a.rules,updatedAt:at}}}
  if(a.type==='visitSave'){
    const old=s.siteVisits[a.visit.id]
    return {...s,siteVisits:{...s.siteVisits,[a.visit.id]:{...a.visit,createdAt:old?.createdAt??at,createdBy:old?.createdBy??s.session!,updatedAt:at}}}
  }
  if(a.type==='visitDelete'){const siteVisits={...s.siteVisits};delete siteVisits[a.id];return {...s,siteVisits}}
  const now=Date.parse(a.now),notifications=[...s.notifications],events={...s.deadlineEvents}
  let changed=false
  for(const t of Object.values(s.tasks)){
    if((!isWorkItem(t)&&!isFlowTask(t))||!isActiveProjectId(s.projects,t.projectId)||t.removedFromMdr||!t.assigneeUserId||!t.due||isClosed(s,t)||/لغو|cancel/i.test(statusOf(s,t)?.name??''))continue
    const user=s.users.find(u=>u.id===t.assigneeUserId&&u.status==='active')
    if(!user||!canViewTask(s,user,t))continue
    const due=Date.parse(`${t.due}T23:59:59+03:30`)
    const group=estimationGroup(Number.isFinite(t.estimation)?Math.max(0,t.estimation!):0),rule=(s.deadlinePreferences[user.id]?.rules??defaultDeadlineRules())[group]
    // A zero-hour alert must survive the scheduler's 15-second polling interval.
    if(!Number.isFinite(due)||now>due+(rule.hours===0?60000:0))continue
    if(!rule.enabled||now<due-rule.hours*3600000)continue
    const id=`deadline-${t.id}-${user.id}-${t.due}-${group}-${rule.hours}`
    if(events[id])continue
    notifications.unshift({id,userId:user.id,at:a.now,kind:'due',title:`Deadline for “${t.name}” is approaching`,body:`${s.projects.find(p=>p.id===t.projectId)?.name??'Studio work'} · ${Math.max(0,Math.ceil((due-now)/3600000))} hours remaining (Tehran time)`,link:{type:'task',id:t.id},read:false})
    events[id]={id,at:a.now};changed=true
  }
  return changed?{...s,notifications,deadlineEvents:events}:s
}
