import assert from 'node:assert/strict'
import { prepare } from '../server/sanitize'
import { viewOf } from '../server/view'
import { guard } from '../src/lib/policy'
import { projectSupervisors, PROJECT_TYPES } from '../src/lib/projectDetails'
import { initialState, reducer } from '../src/lib/state'
import type { Project, User } from '../src/lib/types'

const owner: User = { id: 'owner', username: 'owner', name: 'Owner', role: 'ceo', status: 'active', teamId: 'mgt', capacity: 8, createdAt: '2026-11-18' }
const member = { ...owner, id: 'site-member', role: 'member' as const, teamId: 'sup' }
const inspector = { ...owner, id: 'inspector', role: 'inspector' as const }
const otherUser = { ...member, id: 'other', teamId: 'p1a' }
const disabled = { ...member, id: 'disabled', status: 'disabled' as const }
const archived = { ...member, id: 'archived', teamId: 'archived-team' }
const seed = initialState()
const teams = [...seed.teams, { ...seed.teams.find(t => t.id === 'sup')!, id: 'archived-team', archived: true }]
let state = { ...seed, users: [owner, member, inspector, otherUser, disabled, archived], teams, session: owner.id }
assert.deepEqual(projectSupervisors(state.users, state.teams).map(u => u.id), [member.id, inspector.id])
assert.equal(PROJECT_TYPES.length, 11)

const fields = {
  type: 'Hospitality', areaM2: 1250.75, location: 'Tehran', clientName: 'Avand',
  structuralConsultant: 'Structures', mechanicalConsultant: 'Mechanical', electricalConsultant: 'Electrical',
  constructionBy: 'Builders', supervisorId: member.id, photographer: 'Studio', interiorDesignByPargar: false,
}
const project: Project = {
  id: 'QA', code: 'QA', name: 'QA project', phase1TeamId: 'p1a', phase2TeamId: 'p2a',
  mdrUrl: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz1234567890/edit', mdrTab: 'MDR',
  ...fields,
}
const apply = (raw: unknown) => {
  const { action } = prepare(raw, owner, state.tasks)
  assert.equal(guard(state, action), null)
  state = { ...reducer(state, action), session: owner.id }
}
apply({ type: 'projectAdd', project })
assert.deepEqual(viewOf(state, owner).projects?.find(([id]) => id === project.id)?.[1], state.projects.find(p => p.id === project.id))
for (const [key, value] of Object.entries(fields)) {
  assert.equal(state.projects.find(p => p.id === project.id)?.[key as keyof Project], value)
}

apply({ type: 'projectUpdate', id: project.id, patch: { type: 'Office', areaM2: 0, location: null, supervisorId: inspector.id, interiorDesignByPargar: true } })
assert.deepEqual(state.projects.find(p => p.id === project.id), {
  ...project, sdTeamId: project.phase1TeamId, type: 'Office', areaM2: 0, location: null, supervisorId: inspector.id, interiorDesignByPargar: true,
  staffing: state.projects.find(p => p.id === project.id)?.staffing,
})
for (const patch of [
  { type: 'Unknown' }, { areaM2: '120' }, { areaM2: -1 }, { areaM2: Infinity },
  { clientName: 42 }, { photographer: 'x'.repeat(501) }, { interiorDesignByPargar: 'false' },
  ...[otherUser, disabled, archived].map(user => ({ supervisorId: user.id })),
]) {
  const { action } = prepare({ type: 'projectUpdate', id: project.id, patch }, owner, state.tasks)
  assert.ok(guard(state, action), JSON.stringify(patch))
}

const legacy: Project = { ...project, id: 'OLD', code: 'OLD', type: 'Former category' }
state = { ...state, projects: [...state.projects, legacy], users: state.users.map(u => u.id === member.id ? { ...u, status: 'disabled' } : u) }
apply({ type: 'projectUpdate', id: legacy.id, patch: { location: 'New address' } })
assert.equal(state.projects.find(p => p.id === legacy.id)?.type, legacy.type)
assert.equal(state.projects.find(p => p.id === legacy.id)?.supervisorId, member.id)
apply({ type: 'projectUpdate', id: legacy.id, patch: { supervisorId: null } })
assert.equal(state.projects.find(p => p.id === legacy.id)?.supervisorId, null)
console.log('Project details, supervisor eligibility, validation, and legacy project edits passed.')
