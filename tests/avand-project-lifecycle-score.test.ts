import assert from 'node:assert/strict'
import { taskScore, reconcileScores } from '../server/scores'
import { prepare } from '../server/sanitize'
import { viewOf } from '../server/view'
import { diffData } from '../server/db'
import { loadData } from '../server/db'
import { startServer } from '../server/main'
import { setPassword } from '../server/auth'
import { initialState, reducer, type Action } from '../src/lib/state'
import { guard } from '../src/lib/policy'
import { activeProject, categoryOfProject, compareProjectNames, projectCategories, projectDocumentCounts, DEFAULT_PROJECT_CATEGORIES } from '../src/lib/projectDetails'
import { statusOf } from '../src/lib/domain'
import { supervisionStatus } from '../src/lib/supervision'
import type { Project, Task, User } from '../src/lib/types'

const user=(id:string,role:User['role'],teamId:string):User=>({id,username:id,name:id,role,teamId,status:'active',capacity:8,createdAt:'2026-11-25'})
const admin=user('admin','ceo','mgt'),member=user('member','member','p1a'),supervisor=user('site','inspector','sup'),pm={...user('pm','control','ctl'),username:'qa-pm'},outsideControl=user('other-control','control','p1a')
const project:Project={id:'P1',code:'P1',name:'Alpha Studio',type:'مسکونی',phase1TeamId:'p1a',phase2TeamId:'p2a',mdrUrl:'',mdrTab:'MDR'}
const second={...project,id:'P2',code:'P2',name:'Beta Studio'}
const task:Task={id:'doc',projectId:project.id,kind:'document',name:'Drawing',source:'manual',order:1,parentId:null,statusId:'st-issued',actualStart:'2026-11-01',due:'2026-11-11',actualFinish:'2026-11-11',assigneeUserId:member.id}
const issue:Task={...task,id:'issue',kind:'supervision',name:'Site observation',flow:'assigned',actualFinish:undefined,creatorTeamId:'sup',reporterId:supervisor.id}
let state={...initialState(),projects:[project,second],tasks:{doc:task,issue},users:[admin,member,supervisor,pm,outsideControl],session:admin.id}
for(const [end,score] of [['2026-11-10',64],['2026-11-06',80],['2026-11-01',100],['2026-11-11',60],['2026-11-13',52],['2026-11-16',40],['2026-11-21',20],['2026-11-25',20]] as const)assert.equal(taskScore({...task,actualFinish:end},new Set(['2026-11-05'])).score,score)
for(const patch of [{actualStart:undefined},{due:'2026-11-01'},{due:'2026-10-30'},{due:'2026-02-30'},{actualFinish:'2026-10-30'},{actualFinish:undefined}])assert.equal(taskScore({...task,...patch}).score,null)
assert.equal(reconcileScores(state)['task:doc'].score,60)
assert.equal(reconcileScores(state)['task:issue'],undefined)
assert.equal(reconcileScores({...state,tasks:{...state.tasks,doc:{...task,actualFinish:'2026-11-13'}}})['task:doc'].score,52)
const incomplete={...task,statusId:'st-todo',actualStart:undefined,actualFinish:undefined}
const completedWithoutStart=reducer({...state,tasks:{...state.tasks,doc:incomplete}},{type:'setStatus',taskId:task.id,statusId:'st-issued'})
assert.equal(completedWithoutStart.tasks.doc.actualStart,undefined)
assert.equal(reconcileScores(completedWithoutStart)['task:doc'].score,null)
const reopened=reducer(state,{type:'setStatus',taskId:task.id,statusId:'st-todo'})
assert.equal(reconcileScores(reopened)['task:doc'],undefined)
const rated={...state,scores:reconcileScores(state),session:pm.id}
const override={type:'taskScoreOverride' as const,taskId:task.id,value:85,reason:'QA adjustment'}
assert.equal(guard(rated,override),null)
for(const u of [member,supervisor,outsideControl])assert.ok(guard({...rated,session:u.id},override))
assert.ok(guard(rated,{...override,value:101}));assert.ok(guard(rated,{...override,value:19}));assert.ok(guard(rated,{...override,reason:''}))
const overridden=reducer(rated,override),result=reconcileScores(overridden)
assert.equal(result['task:doc'].score,85);assert.equal(result['task:doc'].calculatedScore,60);assert.equal(result['user:member'].score,85);assert.equal(overridden.scoreOverrides?.doc.by,pm.id)
assert.ok(diffData(rated,overridden).some(r=>r.kind==='scoreOverrides'))
assert.equal(viewOf({...overridden,scores:result},supervisor).scoreOverrides?.length,0)
assert.equal(reconcileScores({...overridden,tasks:{...overridden.tasks,doc:{...task,actualFinish:'2026-11-13'}}})['task:doc'].calculatedScore,52)
assert.equal(reconcileScores({...overridden,tasks:{...overridden.tasks,doc:{...task,actualStart:undefined}}})['task:doc'].score,null)
const reset=reducer({...overridden,scores:result},{...override,value:null,reason:'Restore formula'})
assert.equal(reconcileScores(reset)['task:doc'].score,60);assert.equal(reset.scoreOverrides?.doc,undefined)
for(const name of DEFAULT_PROJECT_CATEGORIES)assert.ok(projectCategories(state).includes(name))
assert.equal(categoryOfProject(project),'Residential')
assert.deepEqual(['Zeta','alpha','Beta'].sort(compareProjectNames),['alpha','Beta','Zeta'])
assert.deepEqual(['ب','آ','پ'].sort(compareProjectNames),['آ','ب','پ'])
assert.deepEqual(projectDocumentCounts([task,issue,{...task,id:'not-issued',statusId:'st-todo'},{...task,id:'removed',removedFromMdr:true}],project.id,t=>statusOf(state,t)),{total:2,issued:1})
const apply=(raw:Action)=>{const a=prepare(raw,admin,state.tasks).action;assert.equal(guard(state,a),null);state={...reducer(state,a),session:admin.id}}
const before=state
apply({type:'projectCategory',op:'create',name:'Cultural'})
assert.ok(projectCategories(state).includes('Cultural'))
assert.ok(diffData(before,state).some(r=>r.kind==='projectCategories'))
apply({type:'projectUpdate',id:project.id,patch:{type:'Cultural'}})
apply({type:'projectCategory',op:'rename',name:'Cultural',replacement:'Culture'})
assert.equal(state.projects[0].type,'Culture')
apply({type:'projectCategory',op:'remove',name:'Culture'})
assert.equal(state.projects[0].type,'Other');assert.equal(state.projects[1].type,second.type)
assert.ok(!projectCategories(state).includes('Culture'))
const previousTasks=state.tasks
apply({type:'projectLifecycle',id:project.id,op:'archive'})
assert.equal(activeProject(state.projects[0]),false);assert.deepEqual(state.tasks,previousTasks)
assert.equal(reconcileScores(state)['user:member'].score,null)
assert.equal(reconcileScores(state)['projectTeam:P1:p1a'].score,60)
apply({type:'projectLifecycle',id:project.id,op:'unarchive'})
assert.ok(activeProject(state.projects[0]));assert.deepEqual(state.tasks,previousTasks)
assert.ok(guard(state,{type:'projectLifecycle',id:project.id,op:'delete',confirmation:'wrong'}))
assert.ok(guard({...state,session:member.id},{type:'projectLifecycle',id:project.id,op:'delete',confirmation:project.name}))
apply({type:'projectLifecycle',id:project.id,op:'delete',confirmation:project.name})
assert.ok(state.projects[0].deletedAt);assert.deepEqual(state.tasks,previousTasks)
assert.ok(!viewOf(state,member).projects?.some(([id])=>id===project.id))
assert.ok(!viewOf(state,member).tasks?.some(([id])=>id===task.id))
apply({type:'projectLifecycle',id:project.id,op:'restore'})
assert.ok(activeProject(state.projects[0]));assert.deepEqual(state.tasks,previousTasks)
const action=prepare({type:'supervisionStatus',taskId:issue.id,statusId:'in_progress'},supervisor,state.tasks).action
assert.ok(guard({...state,session:member.id},action))
const siteState={...state,session:supervisor.id}
assert.equal(guard(siteState,action),null)
const moved=reducer(siteState,action)
assert.equal(supervisionStatus(moved,moved.tasks.issue).id,'in_progress');assert.equal(moved.tasks.issue.flow,'in_progress')
assert.ok(diffData(siteState,moved).some(r=>r.kind==='tasks'&&r.upsert.some(([id])=>id==='issue')))
console.log('Score examples, invalid dates, re-score, category persistence and legacy mapping, lifecycle/restore, permission checks and supervision status persistence delta passed.')

const qa=process.env.AVAND_LIFECYCLE_QA_DB
if(qa){
  const url=new URL(qa);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55441');assert.equal(url.pathname,'/avand_lifecycle_qa')
  const password='synthetic-lifecycle-test-only', env={DATABASE_URL:qa,HOST:'127.0.0.1',TARAZ_ADMIN_USERNAME:'qa-ceo',TARAZ_ADMIN_PASSWORD:password,TARAZ_SYNC_SCHEDULE:'off'}
  const first=await startServer({env,port:0,log:()=>{}})
  try{
    const boot=first.core.state.users[0]
    const extraProjects=['Delta','Echo','Gamma'].map((name,i)=>({...project,id:`P${i+3}`,code:`P${i+3}`,name,type:'Office'}))
    await first.core.exclusive(()=>first.core.commit({...first.core.state,projectCategories:{},scoreOverrides:{},users:[boot,supervisor,member,pm,outsideControl],projects:[project,second,...extraProjects],tasks:{doc:task,issue}},async c=>{for(const u of [supervisor,member,pm,outsideControl])await setPassword(c,u.id,password)}))
    const origin=`http://127.0.0.1:${first.port}`
    const post=(p:string,body:unknown,cookie?:string)=>fetch(origin+p,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)})
    const login=async(username:string)=>{const res=await post('/api/auth/login',{username,password});assert.equal(res.status,200);return res.headers.get('set-cookie')!.split(';')[0]}
    const cc=await login('qa-ceo'),sc=await login(supervisor.username),mc=await login(member.username),pc=await login(pm.username),oc=await login(outsideControl.username)
    const write=(cookie:string,action:Action)=>post('/api/action',{action},cookie)
    assert.equal((await write(mc,{type:'supervisionStatus',taskId:issue.id,statusId:'in_progress'})).status,403)
    assert.equal((await write(sc,{type:'supervisionStatus',taskId:issue.id,statusId:'in_progress'})).status,200)
    assert.equal((await write(cc,{type:'projectCategory',op:'create',name:'Research Labs'})).status,200)
    assert.equal((await write(cc,{type:'projectUpdate',id:project.id,patch:{type:'Research Labs'}})).status,200)
    assert.equal((await write(cc,{type:'projectLifecycle',id:project.id,op:'archive'})).status,200)
    const report=await fetch(origin+'/api/scores/report',{headers:{cookie:cc}}).then(r=>r.json());assert.equal(report.count,0)
    assert.equal((await write(cc,{type:'projectLifecycle',id:project.id,op:'unarchive'})).status,200)
    assert.equal((await write(mc,{type:'projectLifecycle',id:project.id,op:'delete',confirmation:project.name})).status,403)
    assert.equal((await write(cc,{type:'projectLifecycle',id:project.id,op:'delete',confirmation:'wrong'})).status,403)
    assert.equal((await write(cc,{type:'projectLifecycle',id:project.id,op:'delete',confirmation:project.name})).status,200)
    assert.equal((await write(cc,{type:'projectLifecycle',id:project.id,op:'restore'})).status,200)
    assert.equal((await write(mc,override)).status,403);assert.equal((await write(oc,override)).status,403);assert.equal((await write(pc,{...override,value:120})).status,403)
    assert.equal((await write(pc,override)).status,200)
    const manualReport=await fetch(origin+'/api/scores/report?user=member',{headers:{cookie:pc}}).then(r=>r.json());assert.equal(manualReport.rows.find((r:{taskId:string})=>r.taskId==='doc').score,85)
    const db=await loadData(first.db);assert.equal(db.tasks.issue.flow,'in_progress');assert.equal(db.projects.find(p=>p.id===project.id)?.type,'Research Labs');assert.equal(db.projects.find(p=>p.id===project.id)?.deletedAt,undefined);assert.equal(db.scores?.['task:doc'].score,85);assert.equal(db.scores?.['task:doc'].calculatedScore,60);assert.equal(db.scoreOverrides?.doc.by,pm.id)
    assert.ok(db.projectCategories?.office.names.includes('Research Labs'))
    assert.ok(db.tasks.doc);assert.ok(db.projects.find(p=>p.id===second.id));
  }finally{await first.close()}
  const secondServer=await startServer({env,port:0,log:()=>{}})
  try{const restored=secondServer.core.state;assert.equal(restored.tasks.issue.flow,'in_progress');assert.ok(restored.projectCategories?.office.names.includes('Research Labs'));assert.equal(restored.projects.find(p=>p.id===project.id)?.type,'Research Labs');assert.equal(restored.scores?.['task:doc'].version,3);assert.equal(restored.scores?.['task:doc'].score,85);assert.equal(restored.scoreOverrides?.doc.value,85);const resetResult=await secondServer.core.dispatch(pm.id,{...override,value:null,reason:'Restore formula'});assert.equal(resetResult.denial,undefined);assert.equal((await loadData(secondServer.db)).scores?.['task:doc'].score,60)}finally{await secondServer.close()}
  console.log('Real HTTP/PostgreSQL: authorized supervision move, rejected unauthorized transitions/deletes, category persistence, archive report filtering, manual score override and reset after restart passed.')
}
