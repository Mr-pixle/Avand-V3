import assert from 'node:assert/strict'
import { TEAM_GROUP_ORDER, teamCode, orderedTeams, orderTeamGroups, compareTaskGroups, taskGroupCode } from '../src/lib/brand'
import { initialState } from '../src/lib/state'
import { viewOf } from '../server/view'
import type { Task, User, Team } from '../src/lib/types'

const order=['PM','PD','CD','SD','IN','CG','GD','DD','CA']
assert.deepEqual(TEAM_GROUP_ORDER.slice(0,9),order)
const base=initialState(), reversed=[...base.teams].reverse(), physical=orderedTeams(reversed)
assert.deepEqual([...new Set(physical.map(teamCode))], [...order.filter(c=>c!=='SD'),'MG'])
assert.deepEqual(reversed,[...base.teams].reverse(),'sorting does not mutate storage')
const tabs=orderTeamGroups([...physical.map(t=>({id:t.id,code:teamCode(t)})),{id:'phase-sd',code:'SD'}])
assert.deepEqual([...new Set(tabs.map(t=>t.code))],[...order,'MG'])
const owner:User={id:'owner',username:'owner',name:'Owner',role:'ceo',teamId:'mgt',capacity:8,status:'active',createdAt:'2026-11-24'}
const state={...base,teams:reversed,users:[owner],session:owner.id}
assert.deepEqual((viewOf(state,owner).teams??[]).map(([,v])=>teamCode(v as Team)),physical.map(teamCode))
const make=(id:string,team:string,scope?:Task['workScope']):Task=>({id,projectId:'P',parentId:null,kind:'manual',name:id,order:0,source:'manual',assigneeTeamId:team,workScope:scope})
const tasks=[make('ca','sup'),make('dd','p2a'),make('sd','p1a','sd'),make('gd','prs'),make('cg','ren'),make('in','int'),make('cd','p1a','phase1'),make('pd','rd'),make('pm','ctl')]
assert.deepEqual(tasks.sort((a,b)=>compareTaskGroups(state,a,b)).map(t=>taskGroupCode(state,t)),order)
assert.equal(taskGroupCode(state,make('sd-unassigned','','sd')),'SD')
assert.equal(taskGroupCode(state,{...make('supervision','p1a'),kind:'supervision'}),'CA')
console.log('Canonical team order across server view, physical team selectors and independent SD task groups passed.')
