import assert from 'node:assert/strict'
import { prepare, Rejected } from '../server/sanitize'
import { viewOf } from '../server/view'
import { initialState, reducer } from '../src/lib/state'
import type { User } from '../src/lib/types'

const owner: User = { id: 'owner', username: 'owner', name: 'Owner', role: 'ceo', status: 'active', teamId: 'mgt', capacity: 8, createdAt: '2026-11-17' }
const teammate: User = { ...owner, id: 'designer', username: 'designer', name: 'Designer', role: 'member' }
let state = { ...initialState(), users: [owner, teammate], session: owner.id }
const apply = (raw: unknown) => {
  const prepared = prepare(raw, owner, state.tasks)
  state = { ...reducer(state, prepared.action), session: owner.id }
}
const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const newProject = {
  id: 'QA', code: 'QA', name: 'QA project', type: 'Office', phase1TeamId: 'p1a', phase2TeamId: 'p2a',
  mdrUrl: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz1234567890/edit', mdrTab: 'MDR', coverImage: cover,
}
apply({ type: 'projectAdd', project: newProject })
assert.equal(state.projects.find(p => p.id === 'QA')?.coverImage, cover)
apply({ type: 'projectUpdate', id: 'QA', patch: { name: 'Renamed' } })
assert.equal(state.projects.find(p => p.id === 'QA')?.coverImage, cover)
const replacement = cover.replace('image/png', 'image/webp')
apply({ type: 'projectUpdate', id: 'QA', patch: { coverImage: replacement } })
assert.equal(state.projects.find(p => p.id === 'QA')?.coverImage, replacement)
assert.throws(() => prepare({ type: 'projectUpdate', id: 'QA', patch: { coverImage: 'data:image/svg+xml;base64,AAAA' } }, owner, state.tasks), Rejected)
apply({ type: 'projectUpdate', id: 'QA', patch: { coverImage: null } })
assert.equal(state.projects.find(p => p.id === 'QA')?.coverImage, null)

apply({ type: 'updateUser', id: owner.id, patch: { email: 'owner@example.test' } })
const displayedOwner = (viewer: User) => viewOf(state, viewer).users?.find(([id]) => id === owner.id)?.[1] as User
assert.equal(displayedOwner(owner).email, 'owner@example.test')
assert.equal(displayedOwner(teammate).email, undefined)
apply({ type: 'updateUser', id: owner.id, patch: { email: null } })
assert.equal(displayedOwner(owner).email, null)
console.log('Project cover create, replace and removal, image validation, and private email settings passed.')
