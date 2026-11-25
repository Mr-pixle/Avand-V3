import assert from 'node:assert/strict'
import { initialState,reducer } from '../src/lib/state'
import { guard,canSeeFinSpace,canViewTask,canManageFlowTask } from '../src/lib/policy'
import { channelMembers,isSiteIssue,finProjectId } from '../src/lib/domain'
import { reconcileDocumentReviews,isDocumentReview } from '../src/lib/documentReview'
import { prepare } from '../server/sanitize'
import { viewOf } from '../server/view'
import type { Task,User,Project } from '../src/lib/types'
import { startServer } from '../server/main'
import { setPassword } from '../server/auth'
import { loadData } from '../server/db'

const user=(id:string,teamId:string,role:User['role']='member',rolePermissions?:User['rolePermissions']):User=>({id,username:id,name:id,teamId,role,rolePermissions,status:'active',capacity:8,createdAt:'2026-11-24'})
const ceo=user('ceo','mgt','ceo'),ca=user('site','sup'),designer=user('designer','p1a'),pm=user('pm','ctl','control',['fin.finance','fin.office','fin.shared','task.view','task.edit']),finance=user('finance','mgt','finance',['fin.office','fin.shared']),office=user('office','mgt','office',['fin.finance','fin.shared']),mg=user('mg','mgt','management',['fin.finance','task.view']),both=user('both','mgt','management',['fin.finance','fin.office','fin.shared'])
const project:Project={id:'P',code:'P',name:'P',type:'Office',phase1TeamId:'p1a',phase2TeamId:'p2a',sdTeamId:'p1b',mdrUrl:'',mdrTab:'MDR'}
const base={...initialState(),users:[ceo,ca,designer,pm,finance,office,mg,both],projects:[project],session:ca.id}
const issue:Task={id:'issue',projectId:'P',kind:'supervision',name:'Site defect',source:'manual',order:1,parentId:null,assigneeUserId:designer.id,assigneeTeamId:'p1a'}
const a=prepare({type:'createFlowTask',task:{...issue,creatorTeamId:'ctl',reviewSourceTaskId:'fake'}},ca,base.tasks).action
assert.equal(guard(base,a),null)
const created=reducer(base,a);assert.equal(created.tasks.issue.creatorTeamId,'sup');assert.equal(created.tasks.issue.reviewSourceTaskId,undefined);assert.equal(created.tasks.issue.assigneeTeamId,'p1a');assert.ok(isSiteIssue(created,created.tasks.issue))
assert.notEqual(guard({...base,session:designer.id},a),null)
assert.ok(channelMembers(base,'project:P').includes(ca.id));assert.equal(guard(base,{type:'sendMessage',channelId:'project:P',text:'Site update'}),null)
assert.equal(guard(created,{type:'flow',taskId:'issue',op:'assignTeam',assigneeId:'p2a'}),null)
const assigned=reducer(created,{type:'flow',taskId:'issue',op:'assignTeam',assigneeId:'p2a'});assert.equal(assigned.tasks.issue.assigneeTeamId,'p2a');assert.equal(assigned.tasks.issue.assigneeUserId,undefined);assert.equal(assigned.tasks.issue.creatorTeamId,'sup')
const statuses=[...base.statusSets.office,{id:'other-done',name:'Complete',progress:100,category:'done' as const},{id:'issued-partial',name:'Issued',progress:90,category:'doing' as const}]
const source:Task={id:'source',projectId:'P',kind:'document',name:'Drawing',source:'manual',order:1,parentId:null,statusId:'other-done',assigneeUserId:designer.id}
let s={...assigned,statusSets:{office:statuses},tasks:{...assigned.tasks,source}}
assert.equal(Object.values(reconcileDocumentReviews(s).tasks).filter(isDocumentReview).length,0)
s={...s,tasks:{...s.tasks,source:{...source,statusId:'issued-partial'}}};assert.equal(Object.values(reconcileDocumentReviews(s).tasks).filter(isDocumentReview).length,0)
s={...s,tasks:{...s.tasks,source:{...source,statusId:'st-issued',actualFinish:'2026-11-24'}}};const r=reconcileDocumentReviews(s);const review=Object.values(r.tasks).find(isDocumentReview)!;assert.equal(review.reviewSourceTaskId,'source');assert.equal(review.assigneeTeamId,'sup');assert.equal(review.disciplineTeamId,'p1a');assert.equal(review.issuedDate,'2026-11-24');assert.equal(isSiteIssue(r,review),false);assert.equal(reconcileDocumentReviews(r),r)
const changed=reconcileDocumentReviews({...r,tasks:{...r.tasks,source:{...r.tasks.source,name:'Revised drawing'}}});assert.equal(changed.tasks[review.id].name,'Revised drawing');assert.equal(Object.values(changed.tasks).filter(isDocumentReview).length,1)
assert.equal(canViewTask(changed,ca,review),true);assert.equal(canManageFlowTask(changed,ca,review),true);assert.equal(guard(changed,{type:'flow',taskId:review.id,op:'assign',assigneeId:designer.id})!==null,true)
for(const [u,f,o,shared] of [[ceo,true,true,true],[pm,false,false,false],[finance,true,false,false],[office,false,true,false],[mg,true,false,false],[both,true,true,true],[ca,false,false,false]] as const){assert.equal(canSeeFinSpace(u,'finance'),f);assert.equal(canSeeFinSpace(u,'office'),o);assert.equal(canSeeFinSpace(u,'shared'),shared)}
const fin:Task={...issue,id:'fin',kind:'finadmin',projectId:finProjectId('finance'),assigneeUserId:undefined,assigneeTeamId:undefined,flow:'open'}, admin:Task={...fin,id:'admin',projectId:finProjectId('office')}
const secure={...changed,tasks:{...changed.tasks,fin,admin},users:changed.users.map(u=>u.id===designer.id?{...u,nationalId:'test-only-value',birthday:'test',telegramId:'test'}:u)}
assert.equal(canViewTask(secure,pm,fin),false);assert.equal(canViewTask(secure,office,fin),false);assert.equal(canViewTask(secure,finance,admin),false);assert.equal(canViewTask(secure,finance,fin),true)
assert.notEqual(guard({...secure,session:pm.id},{type:'updateTask',taskId:'fin',patch:{name:'Denied'}}),null)
assert.notEqual(guard({...secure,session:pm.id},{type:'finTaskArchive',taskId:'fin',archived:true}),null)
assert.notEqual(guard({...secure,session:office.id},{type:'finTaskArchive',taskId:'fin',archived:true}),null)
const archiveState=reducer({...secure,session:finance.id},{type:'finTaskArchive',taskId:'fin',archived:true});assert.ok(archiveState.tasks.fin.archivedAt)
assert.notEqual(guard(archiveState,{type:'updateTask',taskId:'fin',patch:{name:'Denied While Archived'}}),null)
assert.equal(reducer(archiveState,{type:'finTaskArchive',taskId:'fin',archived:false}).tasks.fin.archivedAt,undefined)
assert.equal((viewOf(secure,pm).tasks??[]).some(([id])=>id==='fin'||id==='admin'),false)
assert.equal((viewOf(secure,ca).users??[]).find(([id])=>id===designer.id)?.[1] && ((viewOf(secure,ca).users??[]).find(([id])=>id===designer.id)![1] as User).nationalId,undefined)
assert.equal(((viewOf(secure,ceo).users??[]).find(([id])=>id===designer.id)![1] as User).nationalId,'test-only-value')
console.log('CA creator provenance, independently assigned teams, project chat, idempotent Issued document reviews, finance/office isolation and private profile data passed.')

const qa=process.env.AVAND_DEV_QA_DB
if(qa){
  const url=new URL(qa);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/avand_dev_upgrade')
  const password='synthetic-qa-account-only'
  const server=await startServer({env:{DATABASE_URL:qa,HOST:'127.0.0.1',TARAZ_ADMIN_USERNAME:'qa-ceo',TARAZ_ADMIN_PASSWORD:password,TARAZ_SYNC_SCHEDULE:'off'},port:0,log:()=>{}})
  const origin=`http://127.0.0.1:${server.port}`
  const post=(path:string,body:unknown,cookie?:string)=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)})
  const login=async(username:string)=>{const res=await post('/api/auth/login',{username,password});assert.equal(res.status,200);return res.headers.get('set-cookie')!.split(';')[0]}
  const action=(cookie:string,a:unknown)=>post('/api/action',{action:a},cookie)
  const get=(cookie:string,path:string)=>fetch(origin+path,{headers:{cookie}})
  try{
    const boot=server.core.state.users[0], users=[boot,ca,designer,pm,finance,office,mg,both]
    await server.core.exclusive(()=>server.core.commit({...server.core.state,users,projects:[project],tasks:{source:{...source,statusId:'st-todo'},fin,admin},attachments:[{id:'qa-attachment',taskId:'fin',name:'financial-test.txt',mime:'text/plain',size:4,dataUrl:'/api/files/fl-fin-qa',uploadedBy:boot.id,uploadedAt:new Date().toISOString()}]},async c=>{for(const u of users.slice(1))await setPassword(c,u.id,password);await c.query('INSERT INTO files (id,name,mime,size,data,owner) VALUES ($1,$2,$3,$4,$5,$6)',['fl-fin-qa','financial-test.txt','text/plain',4,Buffer.from('test'),boot.id])}))
    const cc=await login('qa-ceo'), sc=await login(ca.username), pc=await login(pm.username), fc=await login(finance.username), oc=await login(office.username), mc=await login(mg.username)
    assert.equal((await action(sc,{type:'createFlowTask',task:issue})).status,200)
    assert.equal((await action(sc,{type:'sendMessage',channelId:'project:P',text:'QA site message'})).status,200)
    assert.equal((await action(cc,{type:'setStatus',taskId:'source',statusId:'st-issued'})).status,200)
    let stored=await loadData(server.db);const linked=Object.values(stored.tasks).find(isDocumentReview)!;assert.equal(linked.reviewSourceTaskId,'source');assert.equal(linked.assigneeTeamId,'sup')
    assert.equal((await action(cc,{type:'updateTask',taskId:'source',patch:{name:'Updated QA drawing'}})).status,200)
    stored=await loadData(server.db);assert.equal(stored.tasks[linked.id].name,'Updated QA drawing');assert.equal(Object.values(stored.tasks).filter(isDocumentReview).length,1)
    assert.equal((await action(sc,{type:'supervisionStatus',taskId:linked.id,statusId:'closed'})).status,200)
    for(const cookie of [pc,oc,sc]){assert.equal((await get(cookie,'/api/files/fl-fin-qa')).status,404);assert.equal((await action(cookie,{type:'updateTask',taskId:'fin',patch:{name:'Not allowed'}})).status,403)}
    for(const cookie of [cc,fc,mc])assert.equal((await get(cookie,'/api/files/fl-fin-qa')).status,200)
    assert.equal((await action(fc,{type:'updateTask',taskId:'admin',patch:{name:'Not allowed'}})).status,403)
    assert.equal((await action(fc,{type:'finTaskArchive',taskId:'fin',archived:true})).status,200)
    assert.equal((await action(oc,{type:'finTaskArchive',taskId:'fin',archived:false})).status,403)
    assert.equal((await action(fc,{type:'finTaskArchive',taskId:'fin',archived:false})).status,200)
    const data=(await (await get(pc,'/api/state')).json()).data
    assert.equal(data.tasks.some(([id]:[string,unknown])=>id==='fin'||id==='admin'),false)
    console.log('Real HTTP/PostgreSQL E2E: CA creation and chat, persisted automatic reviews, repeated updates, financial file access and archive permissions passed.')
  }finally{await server.close()}
}
