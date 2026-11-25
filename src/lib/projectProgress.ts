import type { ProjectStage, Task } from './types'
import type { State } from './state'
import { isWorkItem, taskProgress } from './domain'
import { taskScope, WORK_SCOPES } from './organization'

export const PROJECT_STAGES: readonly ProjectStage[] = ['studies', 'concept', 'phase1_execution', 'municipality', 'coordination', 'interior', 'phase2_preliminary', 'phase2']
export const STAGE_FA: Record<ProjectStage, string> = {
  studies: 'Project Studies / PD', concept: 'Concept Design / CD', phase1_execution: 'Phase 1 Execution / SD', municipality: 'Municipal Approval',
  coordination: 'Design Coordination', interior: 'Interior Design / IN', phase2_preliminary: 'Preliminary Phase 2', phase2: 'Detail Design / DD',
}
/** Architectural stages remain distinct from authorization/staffing scopes. The four primary phases supply defaults only. */
export const STAGE_BY_SCOPE = { pd: 'studies', phase1: 'concept', sd: 'phase1_execution', phase2: 'phase2', revit: 'phase2' } as const
export const PRIMARY_SCOPE_BY_STAGE = { studies: 'pd', concept: 'phase1', phase1_execution: 'sd', phase2: 'phase2' } as const satisfies Partial<Record<ProjectStage, import('./types').WorkScope>>
const norm = (s: string) => s.replace(/[ي]/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ').replace(/[۱١]/g, '1').replace(/[۲٢]/g, '2').replace(/[‐‑–—]/g, '-').trim()
const code = (s: string, phase: string) => new RegExp(`(?:^|[/|:(]\\s*)${phase}(?:\\s*[/|:)-]|$)`, 'i').test(s)
function stagesFromName(name: string): ProjectStage[] {
  const s = norm(name)
  const found: ProjectStage[] = []
  if (/مطالعات|\bproject studies\b|\bpre[- ]design\b/i.test(s) || code(s,'PD')) found.push('studies')
  if (/مفهومی|کانسپت|\bconcept design\b/i.test(s) || code(s,'CD')) found.push('concept')
  if (/فاز\s*1.*اجرایی|\bphase\s*1\s*execution\b|\bschematic design\b/i.test(s) || code(s,'SD')) found.push('phase1_execution')
  if (/شهرداری|\bmunicipal approval\b/i.test(s)) found.push('municipality')
  if (/هماهنگی.*دیسیپلین|هماهنگی.*رشته|\bdesign coordination\b|clash/i.test(s)) found.push('coordination')
  if (/طراحی داخلی|\binterior design\b/i.test(s) || code(s,'IN')) found.push('interior')
  const preliminary = /فاز\s*2.*مقدماتی|\bpreliminary\s+phase\s*2\b|\bphase\s*2\s+preliminary\b/i.test(s)
  if (preliminary) found.push('phase2_preliminary')
  if (/\bdetail(?:ed)? design\b/i.test(s) || code(s,'DD') || (!preliminary && /فاز\s*2|نقشه های اجرایی|\bphase\s*2\s+design\b/i.test(s) && !found.includes('phase1_execution'))) found.push('phase2')
  return found
}
/** English labels, legacy Persian headings and phase codes all resolve to the existing persisted stage IDs. */
export function stageFromName(name: string): ProjectStage | undefined {
  const found = stagesFromName(name)
  return found.length === 1 ? found[0] : undefined
}
export function taskStage(tasks: Record<string, Task>, t: Task): ProjectStage | undefined {
  const seen = new Set<string>()
  let cur: Task | undefined = t
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.projectStage && PROJECT_STAGES.includes(cur.projectStage)) return cur.projectStage
    const matches = stagesFromName(cur.name)
    if (matches.length > 1) return undefined // do not guess from ambiguous headings
    if (matches.length === 1) return matches[0]
    cur = cur.parentId ? tasks[cur.parentId] : undefined
  }
  const scope = taskScope(tasks, t)
  return scope ? STAGE_BY_SCOPE[scope] : undefined
}
/** Documents and independent manual work items contribute once; their manual checklist subtasks do not add weight. */
export function projectWorkItems(tasks: Record<string, Task>, pid: string) {
  return Object.values(tasks).filter((t) => {
    if (t.projectId !== pid || !isWorkItem(t) || t.removedFromMdr || t.archivedAt) return false
    const seen = new Set([t.id])
    let p = t.parentId ? tasks[t.parentId] : undefined
    while (p && !seen.has(p.id)) {
      if (isWorkItem(p) || p.removedFromMdr || p.archivedAt) return false
      seen.add(p.id); p = p.parentId ? tasks[p.parentId] : undefined
    }
    return true
  })
}
export function projectProgress(state: Pick<State, 'tasks' | 'statusSets'>, pid: string) {
  const items = projectWorkItems(state.tasks, pid)
  const stageOf = new Map(items.map(t => [t.id, taskStage(state.tasks,t)]))
  const classified = items.filter((t) => !!stageOf.get(t.id))
  // Use one comparable unit throughout a project; do not mix MDR percentages with person-hours.
  const weighted = classified.length > 0 && classified.every((t) => Number.isFinite(t.weight) && t.weight! >= 0) && classified.some((t) => t.weight! > 0)
  const effort = !weighted && classified.length > 0 && classified.every((t) => Number.isFinite(t.estimation) && t.estimation! > 0)
  const mode = weighted ? 'weight' : effort ? 'effort' : 'equal'
  const weight = (t: Task) => weighted ? t.weight! : effort ? t.estimation! : 1
  const summarize = (tasks: Task[]) => {
    const sum = tasks.reduce((n, t) => n + weight(t), 0)
    return { count: tasks.length, weight: sum, progress: sum > 0 ? tasks.reduce((n, t) => n + taskProgress(state, t) * weight(t), 0) / sum : null }
  }
  return { mode, total: summarize(classified).progress, totalCount: items.length, classifiedCount: classified.length,
    unclassified: items.filter((t) => !stageOf.get(t.id)),
    stages: PROJECT_STAGES.map((stage) => ({ stage, ...summarize(classified.filter((t) => stageOf.get(t.id) === stage)) })),
    phases: WORK_SCOPES.map(phase => {
      const list = items.filter(t => taskScope(state.tasks,t) === phase)
      const weights = list.every(t => Number.isFinite(t.weight) && t.weight! >= 0) && list.some(t => t.weight! > 0)
      const effort = !weights && list.every(t => Number.isFinite(t.estimation) && t.estimation! > 0)
      const units = (t: Task) => weights ? t.weight! : effort ? t.estimation! : 1
      const sum = list.reduce((n,t) => n + units(t), 0)
      return { phase, count: list.length, weight: sum, progress: sum ? list.reduce((n,t) => n + units(t) * taskProgress(state,t),0) / sum : null }
    }),
  }
}
