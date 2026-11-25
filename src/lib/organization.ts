import type { PhaseStaff, Project, ProjectStaffing, Task, User, WorkScope } from './types'

export const WORK_SCOPES = ['pd', 'phase1', 'sd', 'phase2'] as const
export const effectiveScopeOf = (scope: WorkScope) => scope === 'revit' ? 'phase2' : scope
export const SCOPE_FA: Record<WorkScope, string> = { pd: 'PD', phase1: 'CD', sd: 'SD', phase2: 'DD', revit: 'DD / Revit' }
export const PHASE_NAMES = { pd: 'PD – Pre-Design', phase1: 'CD – Concept Design', sd: 'SD – Schematic Design', phase2: 'DD – Detail Design' } as const
const blankStaff = (): PhaseStaff => ({ designerIds: [], assistantIds: [] })
export const emptyStaffing = (): Required<Pick<ProjectStaffing, WorkScope>> & ProjectStaffing => ({ pd: blankStaff(), phase1: blankStaff(), sd: blankStaff(), phase2: blankStaff(), revit: blankStaff() })
export const scopeTeam = (p: Project, scope: WorkScope) => scope === 'pd' ? 'rd' : scope === 'sd' ? p.sdTeamId ?? p.phase1TeamId : scope === 'phase1' ? p.phase1TeamId : p.phase2TeamId
export const phasePeople = (s: PhaseStaff | undefined) => s ? [...new Set([s.managerId, ...s.designerIds, ...s.assistantIds].filter((id): id is string => !!id))] : []
export const projectPeople = (p: Project) => p.staffing ? [...new Set([p.staffing.chiefArchitectId, ...WORK_SCOPES.flatMap((s) => phasePeople(p.staffing![s]))].filter((id): id is string => !!id))] : p.managerId ? [p.managerId] : []
export const managedScopes = (p: Project | undefined, userId: string): WorkScope[] => p?.staffing ? WORK_SCOPES.filter((s) => p.staffing![s]?.managerId === userId) : []

/** One-time legacy snapshot. The prior project manager keeps their existing project-wide scope explicitly. */
export function staffingOf(p: Project, users: User[]): ReturnType<typeof emptyStaffing> {
  if (p.staffing) {
    const { phase2 } = p.staffing
    const revit = p.staffing.revit ?? emptyStaffing().revit
    return { ...emptyStaffing(), ...p.staffing, pd: p.staffing.pd ?? blankStaff(), sd: p.staffing.sd ?? blankStaff(), phase2: {
      managerId: (p.revitTeamId && p.revitTeamId === p.phase2TeamId ? revit.managerId ?? phase2.managerId : phase2.managerId ?? revit.managerId),
      designerIds: [...new Set([...phase2.designerIds, ...revit.designerIds])],
      assistantIds: [...new Set([...phase2.assistantIds, ...revit.assistantIds])],
    }, revit: emptyStaffing().revit }
  }
  const result = emptyStaffing()
  for (const scope of WORK_SCOPES) result[scope] = {
    ...(p.managerId ? { managerId: p.managerId } : {}),
    designerIds: users.filter((u) => u.teamId === scopeTeam(p, scope) && u.status === 'active').map((u) => u.id), assistantIds: [],
  }
  return result
}

/** Explicit task scope wins; otherwise inherit a scope from WBS, never infer authority from the assignee's current team. */
export function taskScope(tasks: Record<string, Task>, t: Task): WorkScope | undefined {
  const seen = new Set<string>()
  let cur: Task | undefined = t
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.workScope) return effectiveScopeOf(cur.workScope)
    if (['phase', 'stage', 'group', 'doctype'].includes(cur.kind) && /رویت|revit/i.test(cur.name)) return 'phase2'
    if (cur.kind === 'phase') {
      if (/^PD\b|\/\s*PD\b|pre[- ]design|project studies/i.test(cur.name)) return 'pd'
      if (/^SD\b|\/\s*SD\b|schematic design|phase\s*1\s*execution|فاز\s*[۱1١].*اجرایی/i.test(cur.name)) return 'sd'
      if (/^CD\b|concept design/i.test(cur.name)) return 'phase1'
      if (/^DD\b|detail(?:ed)? design/i.test(cur.name)) return 'phase2'
      if (/فاز\s*[۱1١]/.test(cur.name)) return 'phase1'
      if (/فاز\s*[۲2٢]/.test(cur.name)) return 'phase2'
      if (/رویت|revit/i.test(cur.name)) return 'phase2'
    }
    cur = cur.parentId ? tasks[cur.parentId] : undefined
  }
  return undefined
}

export function staffingProblem(raw: unknown, users: User[]): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return "The structure of the project’s responsibilities is invalid."
  const obj = raw as Record<string, unknown>
  if (Object.keys(obj).some((k) => ![...WORK_SCOPES, 'revit', 'chiefArchitectId'].includes(k))) return "Responsibility is unknown."
  const valid = (id: unknown) => typeof id === 'string' && users.some((u) => u.id === id)
  if (obj.chiefArchitectId != null && !valid(obj.chiefArchitectId)) return "Select the senior architect from defined users."
  for (const scope of WORK_SCOPES) {
    const s = obj[scope] as Record<string, unknown> | undefined
    if (!s && (scope === 'pd' || scope === 'sd')) continue // legacy clients and stored staffing
    if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some((k) => !['managerId', 'designerIds', 'assistantIds'].includes(k))) return "The structure of the members of the phase is invalid."
    if (s.managerId != null && !valid(s.managerId)) return "The manager must be defined by the users."
    for (const key of ['designerIds', 'assistantIds']) {
      const ids = s[key]
      if (!Array.isArray(ids) || ids.length > users.length || ids.some((id) => !valid(id)) || new Set(ids).size !== ids.length) return "The list of phase members is invalid or repetitive."
    }
  }
  return null
}

/** Add missing phase roots without relocating or modifying any existing WBS nodes. */
export function ensureProjectPhases(tasks: Record<string, Task>, project: Project): Record<string, Task> {
  const next = { ...tasks }
  for (const [order, scope] of WORK_SCOPES.entries()) {
    if (Object.values(next).some(t => t.projectId === project.id && t.kind === 'phase' && !t.parentId && !t.removedFromMdr && taskScope(next, t) === scope)) continue
    let id = `phase:${project.id}:${scope}`
    while (next[id]) id += ':new'
    next[id] = { id, projectId: project.id, parentId: null, kind: 'phase', name: PHASE_NAMES[scope], order, source: 'manual', workScope: scope }
  }
  return next
}
