import type { Action, Nav, Page } from './state'

const pages: readonly Page[] = [
  'settings', 'home', 'projects', 'workload', 'review', 'runs', 'admin', 'notifications', 'chat', 'team',
  'supervision', 'points', 'documents', 'links', 'requests', 'timesheet', 'inbox', 'adminreports', 'personal', 'finadmin',
]
const details = ['channelId', 'requestId', 'userId', 'date', 'tab', 'taskView'] as const

export function readNavigation(hash: string): Nav {
  const fragment = hash.replace(/^#/, '')
  const separator = fragment.indexOf('?')
  const token = separator < 0 ? fragment : fragment.slice(0, separator)
  let nav: Nav
  if (token === 'project-chat') nav = { page: 'pchat' }
  else if (token === 'finadmin-finance' || token === 'finadmin-office' || token === 'finadmin-shared') {
    nav = { page: 'finadmin', space: token.slice(9) as Nav['space'] }
  } else if (token.startsWith('project-') || token.startsWith('team-')) {
    const project = token.startsWith('project-')
    try {
      const id = decodeURIComponent(token.slice(project ? 8 : 5))
      nav = project ? { page: 'project', projectId: id.toUpperCase() } : { page: 'team', teamId: id }
    } catch {
      return { page: 'home' }
    }
  } else if (pages.includes(token as Page)) nav = { page: token as Page }
  else return { page: 'home' }

  const params = new URLSearchParams(separator < 0 ? '' : fragment.slice(separator + 1))
  for (const key of details) {
    const value = params.get(key)
    if (value) nav[key] = value
  }
  return nav
}

export function navigationHash(nav: Nav): string {
  let token: string = nav.page
  if (nav.page === 'project') token = 'project-' + encodeURIComponent(nav.projectId?.toLowerCase() ?? '')
  if (nav.page === 'pchat') token = 'project-chat'
  if (nav.page === 'team' && nav.teamId) token = 'team-' + encodeURIComponent(nav.teamId)
  if (nav.page === 'finadmin' && nav.space) token = 'finadmin-' + nav.space

  const params = new URLSearchParams()
  for (const key of details) {
    const value = nav[key]
    if (value) params.set(key, value)
  }
  return params.size ? `#${token}?${params}` : `#${token}`
}

export function navigationSelection<T extends string>(
  nav: Nav, dispatch: (action: Action) => void, field: 'tab' | 'taskView', fallback: T, options: readonly T[],
) {
  const current = options.find(option => option === nav[field]) ?? fallback
  return {
    value: current,
    onChange: (value: T) => {
      if (value === current || !options.includes(value)) return
      dispatch({ type: 'nav', nav: {
        ...nav,
        ...(field === 'tab' ? { taskView: undefined } : {}),
        [field]: value === fallback ? undefined : value,
      } })
    },
  }
}
