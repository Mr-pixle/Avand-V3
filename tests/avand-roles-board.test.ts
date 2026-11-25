import assert from 'node:assert/strict'
import { initialState, reducer, type Action } from '../src/lib/state'
import { guard, has } from '../src/lib/policy'
import { viewOf } from '../server/view'
import { englishDigits } from '../src/lib/digits'
import { scopeTeam, staffingOf, emptyStaffing } from '../src/lib/organization'
import type { Project, User } from '../src/lib/types'

const createUser = (id: string, role: User['role'], teamId = ''): User => ({ id, role, teamId, name:id, username:id, status:'active', capacity:8, createdAt:'2025-01-01' })
const ceo = createUser('ceo','ceo')
const member = createUser('member','member','revit')
const outsider = createUser('outsider','member','elsewhere')
const project: Project = { id:'ABC', code:'ABC', name:'Test', type:'Test', phase1TeamId:'cd', phase2TeamId:'revit', staffing:emptyStaffing() }
let state = { ...initialState(), users:[ceo, member, outsider], projects:[project], session: ceo.id }
const as = (id: string) => ({ ...state, session:id })
const send = (id: string, action: Action) => {
  assert.equal(guard(as(id),action),null)
  state = { ...reducer(as(id),action), session:ceo.id }
}
assert.equal(englishDigits('تاریخ ۱۴۰۵ و ١٢'), 'تاریخ 1405 و 12')
assert.equal(scopeTeam(project,'phase2'),'revit')
assert.equal(scopeTeam(project,'revit'),'revit')
assert.deepEqual(staffingOf({ ...project, staffing: { ...emptyStaffing(), revit: { designerIds:[member.id], assistantIds:[] } } }, state.users).phase2.designerIds,[member.id])
const role: Action = { type:'roleSave', role:{ id:'role-board', name:'Designer', description:'', permissions:['project.view','whiteboard.view','whiteboard.create','whiteboard.edit'] } }
assert.notEqual(guard(as(member.id),role),null)
send(ceo.id,role)
send(ceo.id,{ type:'roleAssign', userId:member.id, roleId:'role-board' })
assert.equal(has(state.users[1],'project.define'),false)
assert.notEqual(guard(as(ceo.id),{type:'roleDelete',id:'role-board'}),null)
assert.notEqual(guard(as(ceo.id),{...role,role:{...role.role,id:'ceo'}}),null)
const board: Action = { type:'whiteboardSave', board:{ id:'wb-test', projectId:project.id, title:'Design', revision:0, scene:{ elements:[],files:{},settings:{grid:false,snap:false} } } }
assert.notEqual(guard(as(outsider.id),board),null)
send(member.id,board)
assert.equal(state.whiteboards['wb-test'].revision,1)
assert.equal(viewOf(state,state.users[2]).whiteboards?.length,0)
assert.equal(viewOf(state,state.users[1]).whiteboards?.length,1)
assert.notEqual(guard(as(member.id),board),null)
send(member.id,{ ...board, board:{ ...board.board, title:'Design 2', revision:1 } })
assert.equal(state.whiteboards['wb-test'].title,'Design 2')
assert.notEqual(guard(as(member.id),{type:'whiteboardDelete',id:'wb-test',revision:2}),null)
send(ceo.id,{type:'whiteboardDelete',id:'wb-test',revision:2})
assert.equal(state.whiteboards['wb-test'],undefined)
send(ceo.id,{...role,role:{...role.role,permissions:['project.view']}})
assert.equal(has(state.users[1],'whiteboard.view'),false)
send(ceo.id,{type:'roleAssign',userId:member.id,roleId:'member'})
send(ceo.id,{type:'roleDelete',id:'role-board'})
console.log('Phase 2, digits, role changes, and Whiteboard permissions / revision checks passed.')
