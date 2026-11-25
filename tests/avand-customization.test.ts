import assert from 'node:assert/strict'
import { viewOf } from '../server/view'
import { prepare } from '../server/sanitize'
import { applyDelta, entriesOf, fromEntries } from '../src/lib/collections'
import { canSeeRequest, guard } from '../src/lib/policy'
import { initialState, reducer, type Action } from '../src/lib/state'
import type { Role, User } from '../src/lib/types'

function user(role: Role): User {
  return { id: role, username: role, name: role, role, teamId: '', status: 'active', capacity: 8, createdAt: '2025-01-01' }
}

const [member, control, office, ceo] = (['member', 'control', 'office', 'ceo'] as const).map(user)
let state = { ...initialState(), users: [member, control, office, ceo], session: member.id }

function send(actor: User, action: Action) {
  const acting = { ...state, session: actor.id }
  const prepared = prepare(action, actor, state.tasks).action
  assert.equal(guard(acting, prepared), null)
  state = { ...reducer(acting, prepared), session: actor.id }
}

send(member, { type: 'reqCreate', req: { kind: 'it', description: 'Details', it: { title: 'Printer' } } })
const request = state.adminRequests[0]
assert.equal(request.status, 'pending_it')
assert.deepEqual(state.notifications.map((n) => n.userId), [control.id])
assert.equal(canSeeRequest(member, request), true)
assert.equal(canSeeRequest(office, request), false)
assert.equal(canSeeRequest(ceo, request), false)
assert.equal(viewOf(state, ceo).adminRequests?.length, 0)
assert.equal(viewOf(state, control).adminRequests?.length, 1)
const update = { type: 'reqItUpdate', id: request.id, status: 'it_in_progress' } as const
assert.notEqual(guard({ ...state, session: office.id }, update), null)
assert.notEqual(guard({ ...state, session: ceo.id }, update), null)
assert.notEqual(guard({ ...state, session: member.id }, update), null)
assert.notEqual(guard({ ...state, session: control.id }, { type: 'reqDecide', id: request.id, decision: 'approve' }), null)
send(control, update)
assert.equal(state.adminRequests[0].status, 'it_in_progress')
assert.notEqual(guard({ ...state, session: member.id }, { type: 'reqWithdraw', id: request.id }), null)
send(control, { ...update, status: 'it_resolved', note: 'Fixed' })
assert.equal(state.adminRequests[0].status, 'it_resolved')
assert.equal(state.notifications[0].userId, member.id)
send(member, { type: 'reqCreate', req: { kind: 'other', description: '', other: { title: 'Certificate', category: 'certificate' } } })
const other = state.adminRequests[1]
assert.equal(other.status, 'pending_office')
send(office, { type: 'reqDecide', id: other.id, decision: 'approve' })
assert.equal(state.adminRequests[1].status, 'pending_ceo')
send(ceo, { type: 'reqDecide', id: other.id, decision: 'approve' })
assert.equal(state.adminRequests[1].status, 'approved')

const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/at8l1sAAAAASUVORK5CYII='
const folder = { type: 'folderIconSave', category: 'forms', icon } as const
assert.notEqual(guard({ ...state, session: member.id }, folder), null)
assert.notEqual(guard({ ...state, session: control.id }, { ...folder, icon: 'data:image/svg+xml;base64,AAAA' }), null)
send(control, folder)
assert.deepEqual(fromEntries('folderIcons', entriesOf('folderIcons', state.folderIcons)), { forms: icon })
assert.deepEqual(applyDelta({ folderIcons: {} }, { set: { folderIcons: [['forms', icon]] }, del: {} }).folderIcons, { forms: icon })
send(control, { type: 'linkSave', link: { id: 'link1', title: 'Example', address: 'https://example.com', kind: 'website', description: '', icon } })
assert.equal(state.importantLinks.link1.icon, icon)
send(control, { type: 'docSave', id: 'doc1', title: 'Document', category: 'forms', icon, files: [{ name: 'note.txt', mime: 'text/plain', size: 3, dataUrl: 'data:text/plain;base64,YWJj' }] })
assert.equal(state.documents.doc1.icon, icon)
send(control, { type: 'docSave', id: 'doc1', title: 'Updated', category: 'forms' })
assert.equal(state.documents.doc1.icon, icon)
send(control, { type: 'teamAdd', team: { id: 'avand-test', name: 'New Team', kind: 'other', icon } })
send(control, { type: 'teamUpdate', id: 'avand-test', patch: { name: 'New Team', kind: 'other', icon: 'users' } })
assert.equal(state.teams.find((team) => team.id === 'avand-test')?.icon, 'users')
console.log('IT routing, access, status updates, existing approvals, and icons verified')
