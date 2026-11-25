import { isWorkItem, statusesFor, teamOfTask } from './domain'
import { statusLabel } from './displayLabels'
import { scopeTeam, taskScope } from './organization'
import type { State } from './state'
import type { Task } from './types'
import { activeProject } from './projectDetails'

export const isDocumentReview=(t:Task)=>t.kind==='supervision'&&!!t.reviewSourceTaskId
/** Called by the authoritative server transaction, including startup and status-set edits. */
export function reconcileDocumentReviews(state:State, at=new Date().toISOString()):State {
  const ca=state.teams.find(t=>t.id==='sup'&&t.kind==='supervision'&&!t.archived)??state.teams.find(t=>t.kind==='supervision'&&!t.archived)
  if(!ca)return state
  const reviews=new Map(Object.values(state.tasks).filter(isDocumentReview).map(t=>[t.reviewSourceTaskId!,t]))
  let tasks=state.tasks
  for(const t of Object.values(state.tasks))if(t.kind==='supervision'&&!t.creatorTeamId&&!t.reviewSourceTaskId){const creator=state.users.find(u=>u.id===(t.createdBy??t.reporterId));if(creator?.teamId&&state.teams.some(tm=>tm.id===creator.teamId))tasks={...tasks,[t.id]:{...t,creatorTeamId:creator.teamId}}}
  for(const source of Object.values(state.tasks)){
    if(!isWorkItem(source)||source.removedFromMdr||source.archivedAt)continue
    const project=state.projects.find(p=>p.id===source.projectId);if(!project||!activeProject(project))continue
    const status=statusesFor(state,source)?.find(s=>s.id===source.statusId)
    const issued=status?.progress===100&&statusLabel(status.name).trim().toLowerCase()==='issued'
    const prior=reviews.get(source.id)
    if(!prior&&!issued)continue
    const scope=taskScope(state.tasks,source), discipline=teamOfTask(state,source)??(scope?scopeTeam(project,scope):undefined)
    const issuedDate=issued?(source.actualFinish??prior?.issuedDate??at.slice(0,10)):prior?.issuedDate
    const fields={name:source.name,projectId:source.projectId,disciplineTeamId:discipline,issuedDate}
    if(prior){if(prior.name===fields.name&&prior.projectId===fields.projectId&&prior.disciplineTeamId===discipline&&prior.issuedDate===issuedDate)continue;tasks={...tasks,[prior.id]:{...prior,...fields}};continue}
    let id=`review:${source.id}`;while(tasks[id])id+=':review'
    const review:Task={...fields,id,parentId:null,order:source.order,source:'manual',kind:'supervision',type:'documentation',flow:'assigned',priority:'normal',assigneeTeamId:ca.id,creatorTeamId:ca.id,reviewSourceTaskId:source.id,createdBy:'system',createdAt:at}
    tasks={...tasks,[id]:review}
  }
  return tasks===state.tasks?state:{...state,tasks}
}
