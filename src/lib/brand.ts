import type { Team, Task } from './types'
import type { State } from './state'
import { flowOf, flowProgress, FLOW_ORDER, isFlowTask, statusesFor, statusOf, teamOfTask } from './domain'
import { supervisionStatuses } from './supervision'
import { taskScope } from './organization'

export const TEAM_REFERENCE_COLORS = { PM:'#BB6830', PD:'#9F956C', CD:'#A5C3C1', IN:'#788046', CG:'#043F62', GD:'#F4D35E', DD:'#798479', CA:'#C72935', MG:'#808579' } as const
export type TeamCode = keyof typeof TEAM_REFERENCE_COLORS
export const TEAM_GROUP_ORDER = ['PM','PD','CD','SD','IN','CG','GD','DD','CA','MG'] as const
export type TeamGroupCode = typeof TEAM_GROUP_ORDER[number]
export const teamGroupRank = (code: TeamGroupCode) => { const rank=TEAM_GROUP_ORDER.indexOf(code);return rank<0?TEAM_GROUP_ORDER.length:rank }
const fixed: Record<string,TeamCode> = {ctl:'PM',rd:'PD',int:'IN',sup:'CA',ren:'CG',prs:'GD',mgt:'MG'}
export function teamCode(t?: Team): TeamCode {
  return t?.brandCode ?? (t?.kind==='phase1'?'CD':t?.kind==='phase2'||t?.kind==='revit'?'DD':t?.kind==='supervision'?'CA':t?.kind==='management'?'MG':fixed[t?.id??'']??'MG')
}
export function compareTeams(a?:Team,b?:Team) { return teamGroupRank(teamCode(a))-teamGroupRank(teamCode(b)) || (a?.name??'').localeCompare(b?.name??'','en',{numeric:true,sensitivity:'base'}) || (a?.id??'').localeCompare(b?.id??'') }
export const orderedTeams = (teams: readonly Team[]) => [...teams].sort(compareTeams)
export function orderTeamGroups<T extends { code:TeamGroupCode }>(groups: readonly T[]) { return [...groups].sort((a,b)=>teamGroupRank(a.code)-teamGroupRank(b.code)) }
export function taskGroupCode(state: Pick<State,'tasks'|'teams'|'users'>, t:Task):TeamGroupCode {
  if (t.kind==='supervision') return 'CA'
  const scope=taskScope(state.tasks,t)
  if (scope==='sd') return 'SD'
  const team=state.teams.find(x=>x.id===(t.teamSpaceId??teamOfTask(state,t)))
  if(team)return teamCode(team)
  const code=t.kind==='phase' ? /(?:^|\/\s*)(PM|PD|CD|SD|IN|CG|GD|DD|CA)(?:\b|$)/i.exec(t.name)?.[1]?.toUpperCase() as TeamGroupCode|undefined : undefined
  return code ?? (scope==='pd'?'PD':scope==='phase1'?'CD':scope==='phase2'||scope==='revit'?'DD':'MG')
}
export const compareTaskGroups = (state:Pick<State,'tasks'|'teams'|'users'>,a:Task,b:Task) => teamGroupRank(taskGroupCode(state,a))-teamGroupRank(taskGroupCode(state,b))
export function standardTeams(teams: Team[]): Team[] {
  return teams.map(t=>{
    const code=teamCode(t), siblings=teams.filter(x=>x.kind===t.kind), index=siblings.findIndex(x=>x.id===t.id)
    const name=t.kind==='revit'?'DD / Revit':t.kind==='phase1'||t.kind==='phase2'?`${code}-${String.fromCharCode(65+index)}`:fixed[t.id]??t.name
    return {...t,name,brandCode:code,parentPhase:t.kind==='revit'||t.kind==='phase2'?'DD':t.kind==='phase1'?'CD':undefined}
  })
}
export function rgb(hex:string) { return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)) }
export function mix(a:string,b:string,t:number) { const aa=rgb(a),bb=rgb(b);return '#'+aa.map((v,i)=>Math.round(v+(bb[i]-v)*t).toString(16).padStart(2,'0')).join('') }
export function luminance(hex:string) { const c=rgb(hex).map(x=>{const v=x/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722 }
export function contrast(a:string,b:string) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
export function inkOn(bg:string) { return contrast(bg,'#000000')>=contrast(bg,'#FFFFFF')?'#000000':'#FFFFFF' }
export function statusColor(base:string,index:number,count:number) { return mix('#FFFFFF',base,count<=1?1:.18+.82*Math.max(0,Math.min(count-1,index))/(count-1)) }
export const TEAM_COLORS = Object.fromEntries(Object.entries(TEAM_REFERENCE_COLORS).map(([k,v])=>[k,mix(v,'#000000',.10)])) as Record<TeamCode,string>
export function teamStatusTone(code:TeamCode,progress:number,dark=false){const base=dark?mix(TEAM_REFERENCE_COLORS[code],'#000000',.04):TEAM_COLORS[code];return mix('#FFFFFF',base,.3+.7*Math.max(0,Math.min(100,progress))/100)}
export function themePaint(light:string,dark:string){return `light-dark(${light}, ${dark})`}
export function teamStatusStyle(team:Team|undefined,progress=100){const code=teamCode(team),l=teamStatusTone(code,progress),d=teamStatusTone(code,progress,true);return {backgroundColor:themePaint(l,d),color:themePaint(inkOn(l),inkOn(d)),borderColor:themePaint(l,d)}}
export function teamOutline(team?: Team, code = teamCode(team)) {
  return { borderColor: themePaint(TEAM_COLORS[code], TEAM_REFERENCE_COLORS[code]) }
}
export function taskColor(s:State,t:Task,statusId?:string,dark=false) {
  const team=s.teams.find(x=>x.id===teamOfTask(s,t)),scope=taskScope(s.tasks,t),code=scope==='sd'?'CD':!team&&scope==='phase1'?'CD':!team&&scope==='pd'?'PD':!team&&scope==='phase2'?'DD':teamCode(team)
  if(isFlowTask(t)) {
    const list=t.kind==='supervision'?supervisionStatuses(s):FLOW_ORDER.map(phase=>({id:phase,phase}))
    const phase=statusId?list.find(x=>x.id===statusId)?.phase:flowOf(t)
    return teamStatusTone(code,flowProgress({...t,flow:phase??flowOf(t)}),dark)
  }
  const st=statusId?statusesFor(s,t).find(x=>x.id===statusId):statusOf(s,t)
  return teamStatusTone(code,st?.progress??0,dark)
}
export function taskPaint(s:State,t:Task,statusId?:string){return themePaint(taskColor(s,t,statusId),taskColor(s,t,statusId,true))}
export function taskColorStyle(s:State,t:Task,statusId?:string) {const l=taskColor(s,t,statusId),d=taskColor(s,t,statusId,true);return {backgroundColor:themePaint(l,d),color:themePaint(inkOn(l),inkOn(d)),borderColor:themePaint(l,d)}}
/** Project aggregate colors are intentionally independent of team status colors. */
export function projectProgressStyle(value:number) {
  const p=Math.max(0,Math.min(100,Number.isFinite(value)?value:0)),a=p<=50?'red':'yellow',b=p<=50?'yellow':'green',ratio=p<=50?p*2:(p-50)*2
  return {color:`color-mix(in srgb, var(--project-${a}) ${100-ratio}%, var(--project-${b}) ${ratio}%)`}
}

export function phaseTitle(t:Task) { return t.kind==='phase'?t.name.replace(/فاز\s*[۱1١]/g,t.workScope==='sd'||/اجرایی/.test(t.name)?'SD':'CD').replace(/فاز\s*[۲2٢]/g,'DD').replace(/رویت|Revit/gi,'DD / Revit'):t.name }
