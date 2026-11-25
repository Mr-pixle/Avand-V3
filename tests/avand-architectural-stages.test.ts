import assert from 'node:assert/strict'
import { PROJECT_STAGES, STAGE_FA, STAGE_BY_SCOPE, PRIMARY_SCOPE_BY_STAGE, stageFromName, taskStage, projectProgress } from '../src/lib/projectProgress'
import { taskScope } from '../src/lib/organization'
import { initialState, reducer } from '../src/lib/state'
import { upgradeStages } from '../server/migrations'
import { guard } from '../src/lib/policy'
import type { Project, Task, User } from '../src/lib/types'

const expected = ['Project Studies / PD','Concept Design / CD','Phase 1 Execution / SD','Municipal Approval','Design Coordination','Interior Design / IN','Preliminary Phase 2','Detail Design / DD']
assert.deepEqual(PROJECT_STAGES.map(s=>STAGE_FA[s]),expected)
for (const stage of PROJECT_STAGES) assert.equal(stageFromName(STAGE_FA[stage]),stage)
for (const [name,stage] of Object.entries({
  'PD':'studies','CD':'concept','SD':'phase1_execution','IN':'interior','DD':'phase2','PD – Pre-Design':'studies','SD – Schematic Design':'phase1_execution',
  'Phase 1 Execution Design':'phase1_execution','Preliminary Phase 2 Design':'phase2_preliminary','Phase 2 Design':'phase2','Detailed Design':'phase2',
  'مطالعات پروژه':'studies','طراحی مفهومی':'concept','فاز ۱ اجرایی':'phase1_execution','تایید شهرداری':'municipality','هماهنگی دیسیپلین':'coordination','طراحی داخلی':'interior','فاز ۲ مقدماتی':'phase2_preliminary','فاز ۲':'phase2',
})) assert.equal(stageFromName(name),stage,name)
assert.equal(stageFromName('PD / CD'),undefined)
assert.equal(stageFromName('Concept Design + Interior Design'),undefined)
assert.equal(PRIMARY_SCOPE_BY_STAGE.phase1_execution,'sd')
assert.equal(STAGE_BY_SCOPE.sd,'phase1_execution')

const owner: User={id:'owner',username:'owner',name:'Owner',role:'ceo',status:'active',teamId:'mgt',capacity:8,createdAt:'2026-11-24'}
const project: Project={id:'P-QA',name:'QA',code:'P-QA',type:'Office',phase1TeamId:'p1a',sdTeamId:'p1b',phase2TeamId:'p2a',mdrUrl:'',mdrTab:'MDR'}
const base={...initialState(),projects:[project],users:[owner],session:owner.id}
const todo=base.statusSets.office.find(s=>s.category==='todo')!, done=base.statusSets.office.find(s=>s.category==='done')!
const tasks:Record<string,Task>={}
for (const [i,stage] of PROJECT_STAGES.entries()) {
  const root=`root-${i}`,id=`task-${i}`
  tasks[root]={id:root,projectId:project.id,parentId:null,kind:'phase',name:STAGE_FA[stage],order:i,source:'manual'}
  tasks[id]={id,projectId:project.id,parentId:root,kind:'manual',name:`Document ${i}`,order:i,source:'manual',statusId:i%2?done.id:todo.id}
  assert.equal(taskStage(tasks,tasks[id]),stage)
}
assert.equal(taskScope(tasks,tasks['task-2']),'sd')
tasks.sub={...tasks['task-2'],id:'sub',parentId:'task-2',name:'Child task',statusId:done.id}
const state={...base,tasks}
const report=projectProgress(state,project.id)
assert.deepEqual(report.stages.map(r=>r.count),Array(8).fill(1))
assert.equal(report.totalCount,8);assert.equal(report.classifiedCount,8);assert.equal(report.total,50)
assert.equal(report.stages.find(s=>s.stage==='phase1_execution')?.progress,todo.progress)
const explicit={...tasks['task-2'],projectStage:'interior' as const,workScope:'phase1' as const}
assert.equal(taskStage(tasks,explicit),'interior');assert.equal(taskScope(tasks,explicit),'phase1')
assert.equal(taskStage(tasks,{...tasks['task-2'],parentId:null,workScope:'sd'}),'phase1_execution')
assert.equal(taskStage(tasks,{...tasks['task-2'],name:'PD / CD',parentId:null,workScope:'sd'}),undefined)
const nested={...tasks['root-3'],kind:'stage' as const,parentId:'root-1'}
assert.equal(taskStage({...tasks,'root-3':nested,'root-1':{...tasks['root-1'],projectStage:'concept'}},tasks['task-3']),'municipality','nearest named stage takes precedence over its broader phase')
const updated=upgradeStages(state)
assert.equal(updated.tasks['task-2'].projectStage,'phase1_execution')
assert.equal(updated.tasks['task-6'].projectStage,'phase2_preliminary')
assert.equal(updated.tasks['task-2'].workScope,tasks['task-2'].workScope)
assert.deepEqual(upgradeStages(updated),updated)
const explicitState={...state,tasks:{...tasks,[explicit.id]:explicit}}
assert.equal(upgradeStages(explicitState).tasks[explicit.id].projectStage,'interior')
const action={type:'classifyTasks',ids:['task-2'],projectStage:'municipality'} as const
assert.equal(guard(state,action),null)
assert.equal(reducer(state,action).tasks['task-2'].projectStage,'municipality')
assert.equal(reducer(state,action).tasks['task-2'].workScope,tasks['task-2'].workScope)
console.log('All eight architectural stages, legacy labels, SD default mapping, progress counts, and permission-preserving migration passed.')
