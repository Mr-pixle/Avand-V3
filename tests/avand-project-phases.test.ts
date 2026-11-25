import assert from 'node:assert/strict'
import { upgradeProjectPhases } from '../server/migrations'
import { prepare } from '../server/sanitize'
import { guard, managesTaskScope } from '../src/lib/policy'
import { initialState, reducer } from '../src/lib/state'
import { emptyStaffing, taskScope, scopeTeam, WORK_SCOPES } from '../src/lib/organization'
import { projectProgress } from '../src/lib/projectProgress'
import { taskColor } from '../src/lib/brand'
import type { Project, Task, User } from '../src/lib/types'

const owner: User = { id:'owner', username:'owner', name:'Owner', role:'ceo', status:'active', teamId:'mgt', capacity:8, createdAt:'2026-11-24' }
const manager: User = { ...owner, id:'manager', username:'manager', role:'pm', teamId:'p1b' }
const project: Project = { id:'NEW', code:'NEW', name:'New project', type:'Office', phase1TeamId:'p1a', sdTeamId:'p1b', phase2TeamId:'p2a', mdrUrl:'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz1234567890/edit', mdrTab:'MDR', staffing:{ ...emptyStaffing(), sd:{ managerId:manager.id, designerIds:[], assistantIds:[] } } }
let state = { ...initialState(), users:[owner,manager], session:owner.id }
const create = prepare({ type:'projectAdd', project }, owner, state.tasks).action
assert.equal(guard(state,create), null)
state = { ...reducer(state,create), session:owner.id }
assert.equal(scopeTeam(state.projects.find(p=>p.id===project.id)!, 'sd'), 'p1b')
const roots = Object.values(state.tasks).filter(t=>t.projectId===project.id&&t.kind==='phase')
assert.deepEqual(roots.map(t=>taskScope(state.tasks,t)), [...WORK_SCOPES])
const sd = roots.find(t=>t.workScope==='sd')!, cd = roots.find(t=>t.workScope==='phase1')!
const make = (id:string, parent:Task):Task => ({ id, name:id, projectId:project.id, parentId:parent.id, kind:'manual', order:1, source:'manual', statusId:state.statusSets.office[0].id })
const first=make('SD-task',sd), second=make('CD-task',cd)
state = { ...state, tasks:{ ...state.tasks, [first.id]:first, [second.id]:second } }
assert.equal(taskScope(state.tasks,first),'sd')
assert.equal(managesTaskScope(state,manager,first),true)
assert.equal(managesTaskScope(state,manager,second),false)
assert.equal(taskColor(state,first),taskColor(state,{...second, assigneeTeamId:'p1a'}))
assert.equal(projectProgress(state,project.id).phases.find(p=>p.phase==='sd')?.count,1)
assert.notEqual(guard(state,{type:'projectUpdate',id:project.id,patch:{sdTeamId:'p2a'}}),null)
const upgraded=upgradeProjectPhases(state)
assert.deepEqual(upgraded.tasks,state.tasks)
assert.deepEqual(upgradeProjectPhases(upgraded),upgraded)
const legacy={...state, projects:[{...project,sdTeamId:undefined,staffing:undefined}], tasks:{[second.id]:{...second,parentId:null,workScope:'phase1' as const}}}
const migrated=upgradeProjectPhases(legacy)
assert.equal(migrated.projects[0].sdTeamId,project.phase1TeamId)
assert.deepEqual(migrated.tasks[second.id],legacy.tasks[second.id])
assert.equal(Object.values(migrated.tasks).filter(t=>t.kind==='phase').length,4)
console.log('Four project phases, independent SD permissions, shared CD palette, report counts and idempotent migration passed.')
