import assert from 'node:assert/strict'
import { initialState, reducer, type Action } from '../src/lib/state'
import { guard, canPlanTask, canEditStatus, canAssignTo, canLogTime } from '../src/lib/policy'
import { isWorkItem, isDocumentTask, statusOf } from '../src/lib/domain'
import { projectDocumentCounts } from '../src/lib/projectDetails'
import { projectWorkItems } from '../src/lib/projectProgress'
import { hasField } from '../src/lib/taskFields'
import { upgradeManualDocTypes } from '../server/migrations'
import { prepare } from '../server/sanitize'
import { reconcileScores } from '../server/scores'
import { diffData } from '../server/db'
import type { Project, Task, User } from '../src/lib/types'

const user=(id:string,role:User['role'],teamId:string):User=>({id,username:id,name:id,role,teamId,status:'active',capacity:8,createdAt:'2026-11-25'})
const owner=user('owner','ceo','mgt'), creator=user('creator','member','p1a'), manager=user('manager','pm','p1a'), control=user('controller','control','ctl'), mg=user('mg','management','mgt'), colleague=user('colleague','member','p2a'), stranger=user('stranger','member','unrelated')
const p:Project={id:'p',code:'P',name:'Test Project',type:'Office',phase1TeamId:'p1a',phase2TeamId:'p2a',managerId:manager.id,mdrUrl:'',mdrTab:'MDR'}
const doc:Task={id:'manual-doc',projectId:p.id,name:'Legacy manual document',kind:'doctype',source:'manual',parentId:null,order:1,createdBy:creator.id}
const header:Task={...doc,id:'header',name:'MDR heading',source:'mdr',createdBy:undefined}
const mdr:Task={...doc,id:'mdr',kind:'document',source:'mdr',parentId:header.id,mdrKey:'drawing-1',docNumber:'D-001',statusId:'st-issued',createdBy:undefined}
const ordinary:Task={...doc,id:'ordinary',kind:'manual',statusId:'st-todo'}
const foreign:Task={...ordinary,id:'foreign',projectId:'other',createdBy:stranger.id}
let s={...initialState(),projects:[p,{...p,id:'other',managerId:stranger.id}],users:[owner,creator,manager,control,mg,colleague,stranger],tasks:{[doc.id]:doc,[header.id]:header,[mdr.id]:mdr,[ordinary.id]:ordinary,[foreign.id]:foreign},session:creator.id}
const migrated=upgradeManualDocTypes(s)
assert.equal(migrated.tasks[doc.id].statusId,'st-todo')
assert.equal(migrated.tasks[doc.id].createdBy,creator.id)
assert.equal(migrated.tasks[doc.id].reporterId,creator.id)
assert.deepEqual(migrated.tasks[header.id],header)
assert.deepEqual(upgradeManualDocTypes(migrated),migrated)
s={...s,...migrated}
const counts=()=>projectDocumentCounts(Object.values(s.tasks),p.id,t=>statusOf(s,t))
assert.deepEqual(counts(),{total:2,issued:1})
assert.ok(isWorkItem(doc)&&isDocumentTask(doc));assert.ok(!isWorkItem(header))
assert.ok(['assignee','due','status','worklog','point','subtasks'].every(k=>hasField(doc,k as Parameters<typeof hasField>[1])))
assert.ok(projectWorkItems(s.tasks,p.id).some(t=>t.id===doc.id))
for(const u of [creator,manager,control,mg,owner])assert.ok(canPlanTask(s,u,s.tasks[doc.id]))
assert.ok(!canPlanTask(s,stranger,doc));assert.ok(!canPlanTask(s,manager,foreign))
assert.ok(canEditStatus(s,creator,doc));assert.ok(canLogTime(s,creator,doc))
assert.ok(canAssignTo(s,creator,doc,{kind:'user',id:colleague.id}));assert.ok(!canAssignTo(s,creator,doc,{kind:'user',id:stranger.id}))
const apply=(u:User,raw:Action)=>{const a=prepare(raw,u,s.tasks).action;s={...s,session:u.id};assert.equal(guard(s,a),null,JSON.stringify(raw));const before=s;s=reducer(s,a);return diffData(before,s)}
for(const kind of ['manual','doctype'] as const){
  const t={...doc,id:`new-${kind}`,kind,name:`New ${kind}`,createdBy:undefined}
  apply(manager,{type:'addTask',task:t})
  assert.equal(s.tasks[t.id].createdBy,manager.id)
  assert.equal(s.tasks[t.id].statusId,'st-todo')
  apply(manager,{type:'updateTask',taskId:t.id,patch:{name:`Edited ${kind}`}})
}
assert.deepEqual(counts(),{total:3,issued:1})
apply(manager,{type:'updateTask',taskId:'new-doctype',patch:{kind:'manual'}})
assert.deepEqual(counts(),{total:2,issued:1})
assert.ok(apply(creator,{type:'updateTask',taskId:doc.id,patch:{name:'Revised title',description:'Retained description'}}).some(x=>x.kind==='tasks'))
apply(creator,{type:'savePlan',taskId:doc.id,assignee:{kind:'user',id:colleague.id},start:'2026-11-22',due:'2026-11-27',estimation:5,allocations:[]})
assert.equal(s.tasks[doc.id].assigneeUserId,colleague.id);assert.equal(s.tasks[doc.id].due,'2026-11-27')
apply(creator,{type:'addComment',taskId:doc.id,text:'QA comment'})
assert.ok(s.comments.some(c=>c.taskId===doc.id))
apply(creator,{type:'logWork',log:{taskId:doc.id,minutes:60,workDate:'2026-01-01',description:'test work'}})
assert.ok(s.workLogs.some(l=>l.taskId===doc.id&&l.minutes===60))
assert.ok(s.audit.some(a=>a.taskId===doc.id))
apply(creator,{type:'setStatus',taskId:doc.id,statusId:'st-issued'});assert.deepEqual(counts(),{total:2,issued:2})
apply(creator,{type:'updateTask',taskId:doc.id,patch:{kind:'manual'}});assert.deepEqual(counts(),{total:1,issued:1})
apply(creator,{type:'updateTask',taskId:doc.id,patch:{kind:'doctype'}});assert.deepEqual(counts(),{total:2,issued:2})
assert.equal(s.tasks[doc.id].name,'Revised title');assert.ok(s.comments.some(c=>c.taskId===doc.id))
apply(manager,{type:'updateTask',taskId:mdr.id,patch:{name:'Local MDR display title'}})
assert.equal(s.tasks[mdr.id].mdrKey,'drawing-1');assert.equal(s.tasks[mdr.id].mdrSourceName,mdr.name)
assert.ok(guard(s,{type:'updateTask',taskId:mdr.id,patch:{kind:'manual'}}))
assert.deepEqual(projectDocumentCounts([...Object.values(s.tasks),{...mdr,id:'duplicate'}, {...doc,id:'archived',archivedAt:'2026-11-25'}, {...doc,id:'removed',removedFromMdr:true}],p.id,t=>statusOf(s,t)),{total:2,issued:2})
const scored={...s,tasks:{...s.tasks,[doc.id]:{...s.tasks[doc.id],actualStart:'2026-11-22',actualFinish:'2026-11-27'}}}
assert.ok(reconcileScores(scored)[`task:${doc.id}`])
console.log('Manual Doc Type migration, creator/PM/MG permissions, assignment/planning, status, comments, conversion, counts, scores, and MDR identity passed.')
