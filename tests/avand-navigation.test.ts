import assert from 'node:assert/strict'
import { navigationHash, navigationSelection, readNavigation } from '../src/lib/navigation'
import { initialState, reducer, type Action, type Nav } from '../src/lib/state'

const routes: Nav[] = [
  { page: 'home' },
  { page: 'projects' },
  { page: 'project', projectId: 'DEMO-01', tab: 'mindmap', taskView: 'kanban' },
  { page: 'team', teamId: 'phase2-crew' },
  { page: 'finadmin', space: 'shared' },
  { page: 'pchat', channelId: 'project:DEMO-01' },
  { page: 'chat', channelId: 'general' },
  { page: 'inbox', requestId: 'a?b#c' },
  { page: 'timesheet', userId: 'teammate', date: '2026-11-18' },
]
for (const nav of routes) assert.deepEqual(readNavigation(navigationHash(nav)), nav)
assert.deepEqual(readNavigation('#project-4545'), { page: 'project', projectId: '4545' })
assert.deepEqual(readNavigation('#team-ctl'), { page: 'team', teamId: 'ctl' })
assert.deepEqual(readNavigation('#project-%!'), { page: 'home' })
assert.deepEqual(readNavigation('#missing?tab=teams'), { page: 'home' })

const actions: Action[] = []
const nav: Nav = { page: 'project', projectId: 'DEMO-01', taskView: 'kanban' }
const tabs = navigationSelection(nav, action => actions.push(action), 'tab', 'wbs', ['wbs', 'mindmap'])
tabs.onChange('wbs')
assert.equal(actions.length, 0)
tabs.onChange('mindmap')
assert.deepEqual(actions, [{ type: 'nav', nav: { page: 'project', projectId: 'DEMO-01', taskView: undefined, tab: 'mindmap' } }])
assert.equal(navigationSelection({ ...nav, tab: 'hidden' }, () => {}, 'tab', 'wbs', ['wbs', 'mindmap']).value, 'wbs')

const previous = { ...initialState(), nav, openTaskId: 'task', profileUserId: 'user' }
const restored = reducer(previous, { type: 'nav', nav: { page: 'projects' }, fromHistory: true })
assert.equal(restored.nav.page, 'projects')
assert.equal(restored.openTaskId, null)
assert.equal(restored.profileUserId, null)
console.log('Navigation links, tab selections and restoration passed.')
