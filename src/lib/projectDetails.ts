import type { Project, Status, Task, Team, User } from './types'
import { projectTypeLabel, statusLabel } from './displayLabels'
import { isDocumentTask } from './domain'

export const PROJECT_TYPES: readonly string[] = [
  'Commercial', 'Complex', 'Hospitality', 'Renovation', 'Residential', 'Public',
  'Urban Design', 'Industrial', 'Villa', 'Office', 'Interior Design',
]
export const DEFAULT_PROJECT_CATEGORIES = ['Residential', 'Office', 'Villa', 'Commercial', 'Mixed-Use', 'Other'] as const
export interface ProjectCategoryConfig { names: string[] }
export const categoryOfProject=(p:Pick<Project,'type'>)=>{const name=projectTypeLabel(p.type??'').trim();return name==='Mixed Use'?'Mixed-Use':name||'Other'}
export function projectCategories(state: { projects: Project[]; projectCategories?: Record<string, ProjectCategoryConfig> }) {
  return [...new Set(['Other', ...(state.projectCategories?.office?.names ?? [...DEFAULT_PROJECT_CATEGORIES,...PROJECT_TYPES]), ...state.projects.map(categoryOfProject)])].sort((a,b)=>compareProjectNames(a,b))
}
const collator = new Intl.Collator(['fa','en'],{numeric:true,sensitivity:'base'})
export const compareProjectNames = (a:string,b:string) => collator.compare(a,b)
export const activeProject = (p: Project) => !p.archivedAt && !p.deletedAt
export const isActiveProjectId = (projects:readonly Project[], id:string) => !projects.some(p=>p.id===id&&!activeProject(p))
export function projectDocumentCounts(tasks:readonly Task[],projectId:string,status:(task:Task)=>Status|undefined) {
  const unique = new Map<string,Task>()
  for (const t of tasks) {
    if(t.projectId!==projectId||!isDocumentTask(t)||t.removedFromMdr||t.archivedAt)continue
    const key=t.mdrKey?`mdr:${t.mdrKey}`:`task:${t.id}`
    if(!unique.has(key)||t.source==='mdr')unique.set(key,t)
  }
  const docs=[...unique.values()]
  return {total:docs.length,issued:docs.filter(t=>{const s=status(t);return !!s&&s.progress===100&&statusLabel(s.name).trim().toLowerCase()==='issued'}).length}
}
export const categoryNameValid = (v:unknown):v is string => typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=80

export const PROJECT_TEXT_FIELDS = {
  location: 'Project Location',
  clientName: 'Client Name',
  structuralConsultant: 'Structural Consultant',
  mechanicalConsultant: 'Mechanical Consultant',
  electricalConsultant: 'Electrical Consultant',
  constructionBy: 'Construction By',
  photographer: 'Photographer',
} as const

export const PROJECT_TEXT_KEYS = Object.keys(PROJECT_TEXT_FIELDS) as (keyof typeof PROJECT_TEXT_FIELDS)[]
export const PROJECT_TEXT_LIMIT = 500
export const PROJECT_DETAIL_KEYS = [...PROJECT_TEXT_KEYS, 'areaM2', 'supervisorId', 'interiorDesignByPargar'] as const

export function projectSupervisors(users: User[], teams: Team[]) {
  const supervisionTeams = new Set(teams.filter(t => t.kind === 'supervision' && !t.archived).map(t => t.id))
  return users.filter(u => u.status === 'active' && (u.role === 'inspector' || supervisionTeams.has(u.teamId)))
}

export function projectDetailProblem(patch: Partial<Project>, previous: Project | undefined, users: User[], teams: Team[], categories:readonly string[]=PROJECT_TYPES) {
  if ((!previous || ('type' in patch && patch.type !== previous.type)) && !categories.includes(patch.type ?? '')) {
    return 'Select a valid project type.'
  }
  if (patch.areaM2 != null && (!Number.isFinite(patch.areaM2) || patch.areaM2 < 0)) return 'Enter a non-negative area in square metres.'
  for (const key of PROJECT_TEXT_KEYS) {
    const value = patch[key]
    if (value != null && (typeof value !== 'string' || value.length > PROJECT_TEXT_LIMIT)) {
      return `${PROJECT_TEXT_FIELDS[key]} must be text of at most ${PROJECT_TEXT_LIMIT} characters.`
    }
  }
  if (patch.supervisorId != null && patch.supervisorId !== previous?.supervisorId &&
    !projectSupervisors(users, teams).some(u => u.id === patch.supervisorId)) return 'Select an active supervisor.'
  if (patch.interiorDesignByPargar != null && typeof patch.interiorDesignByPargar !== 'boolean') {
    return 'Select Yes or No for Interior Design By Pargar.'
  }
  return null
}
