import { ImageUp, Trash2 } from 'lucide-react'
import { ProjectCover, resizeProjectCover } from './ProjectCover'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { useStore } from '@/lib/store'
import { guard } from '@/lib/policy'
import { emptyStaffing, SCOPE_FA, scopeTeam, staffingOf, WORK_SCOPES } from '@/lib/organization'
import { mdrHref } from '@/lib/mdr'
import { projectTypeLabel } from '@/lib/displayLabels'
import { PROJECT_TEXT_FIELDS, PROJECT_TEXT_KEYS, PROJECT_TEXT_LIMIT, categoryOfProject, projectCategories, projectSupervisors } from '@/lib/projectDetails'
import type { Project, WorkScope } from '@/lib/types'
import type { Action } from '@/lib/state'

const selectClass = 'mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm'
export function ProjectEditor({ project, open, onOpenChange }: { project?: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, dispatch, can } = useStore()
  const [f, setF] = useState({ code: project?.code ?? '', name: project?.name ?? '', type: project?categoryOfProject(project):projectCategories(state).includes('Residential')?'Residential':'Other', phase1TeamId: project?.phase1TeamId ?? '', sdTeamId: project?.sdTeamId ?? project?.phase1TeamId ?? '', phase2TeamId: project?.phase2TeamId ?? '', mdrUrl: project?.mdrUrl ?? '', mdrTab: project?.mdrTab ?? 'MDR', teamIds: project?.teamIds ?? [] })
  const [staffing, setStaffing] = useState(() => project ? structuredClone(staffingOf(project, state.users)) : emptyStaffing())
  const areaInput = useRef<HTMLInputElement>(null)
  const [area, setArea] = useState(String(project?.areaM2 ?? ''))
  const [areaError, setAreaError] = useState(false)
  const [details, setDetails] = useState(() => ({
    location: project?.location ?? '',
    clientName: project?.clientName ?? '',
    structuralConsultant: project?.structuralConsultant ?? '',
    mechanicalConsultant: project?.mechanicalConsultant ?? '',
    electricalConsultant: project?.electricalConsultant ?? '',
    constructionBy: project?.constructionBy ?? '',
    photographer: project?.photographer ?? '',
    supervisorId: project?.supervisorId ?? '',
    interiorDesignByPargar: project ? project.interiorDesignByPargar ?? null : false,
  }))
  const [cover, setCover] = useState(project?.coverImage ?? null)
  const [readingCover, setReadingCover] = useState(false)
  const [coverError, setCoverError] = useState('')
  const chooseCover = async (file: File) => {
    setReadingCover(true)
    setCoverError('')
    try { setCover(await resizeProjectCover(file)) }
    catch (error) { setCoverError(error instanceof Error && error.name !== 'EncodingError' ? error.message : 'This image could not be opened.') }
    finally { setReadingCover(false) }
  }
  const [q, setQ] = useState('')
  const people = state.users.filter((u) => u.status !== 'pending' && u.status !== 'rejected')
  const supervisors = projectSupervisors(state.users, state.teams)
  const categories = projectCategories(state)
  const legacyType = project && !categories.includes(categoryOfProject(project)) ? categoryOfProject(project) : null
  const formerSupervisor = project?.supervisorId && !supervisors.some(u => u.id === project.supervisorId)
    ? project.supervisorId : null
  const pickPerson = (label: string, value: string | undefined, change: (value?: string) => void) => <div><Label>{label}</Label><select aria-label={label} className={selectClass} value={value ?? ''} onChange={(e) => change(e.target.value || undefined)}><option value="">Unassigned</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name} (@{u.username}){u.status !== 'active' ? '  — Disabled' : ''}</option>)}</select></div>
  const teamField = (scope: WorkScope) => {
    if (scope === 'pd') return <div key="pd"><Label>Department PD</Label><Input readOnly value={state.teams.find(t => t.id === 'rd')?.name ?? 'PD'} /></div>
    const key = scope === 'sd' ? 'sdTeamId' : scope === 'phase1' ? 'phase1TeamId' : 'phase2TeamId'
    const kind = scope === 'sd' ? 'phase1' : scope
    return <div key={key}><Label htmlFor={`project-${key}`}>Department {SCOPE_FA[scope]}</Label><select id={`project-${key}`} className={selectClass} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}><option value="">Select a team</option>{state.teams.filter((t) => (t.kind === kind || (scope === 'phase2' && t.kind === 'revit') || t.id === f[key]) && (!t.archived || t.id === f[key])).map((t) => <option key={t.id} value={t.id} disabled={t.archived}>{t.name}</option>)}</select></div>
  }
  const submit = () => {
    if (!project && !f.sdTeamId) { toast.error('Select the responsible CD team for SD.'); return }
    const areaM2 = area === '' ? null : Number(area)
    if (areaInput.current?.validity.badInput || (areaM2 !== null && (!Number.isFinite(areaM2) || areaM2 < 0))) {
      setAreaError(true)
      areaInput.current?.focus()
      return
    }
    const code = f.code.trim().toUpperCase()
    const url = mdrHref(f.mdrUrl)
    // Existing sample projects can be edited without replacing an intentionally missing MDR.
    if ((!project || f.mdrUrl !== project.mdrUrl) && !url) { toast.error('Enter a valid Google Sheets link for the project.'); return }
    const resources = { phase1TeamId: f.phase1TeamId, sdTeamId: f.sdTeamId || f.phase1TeamId, phase2TeamId: f.phase2TeamId, teamIds: f.teamIds, staffing }
    const metadata: Partial<Project> = {}
    for (const key of PROJECT_TEXT_KEYS) {
      const value = details[key].trim() || null
      if (value !== (project?.[key] ?? null)) metadata[key] = value
    }
    const supervisorId = details.supervisorId || null
    if (supervisorId !== (project?.supervisorId ?? null)) metadata.supervisorId = supervisorId
    if (areaM2 !== (project?.areaM2 ?? null)) metadata.areaM2 = areaM2
    if (details.interiorDesignByPargar !== (project?.interiorDesignByPargar ?? null)) metadata.interiorDesignByPargar = details.interiorDesignByPargar
    const values = { ...metadata, ...(cover !== (project?.coverImage ?? null) ? { coverImage: cover } : {}), name: f.name.trim(), mdrTab: f.mdrTab.trim() }
    const resourcePatch = project && can.perm('staffing.edit') ? {
      ...(resources.phase1TeamId !== project.phase1TeamId ? { phase1TeamId: resources.phase1TeamId } : {}),
      ...(resources.sdTeamId !== project.sdTeamId ? { sdTeamId: resources.sdTeamId } : {}),
      ...(resources.phase2TeamId !== project.phase2TeamId ? { phase2TeamId: resources.phase2TeamId } : {}),
      ...(resources.teamIds.join() !== (project.teamIds ?? []).join() ? { teamIds: resources.teamIds } : {}),
      ...(JSON.stringify(staffing) !== JSON.stringify(staffingOf(project, state.users)) ? { staffing } : {}),
    } : {}
    const action: Action = project
      ? { type: 'projectUpdate', id: project.id, patch: { ...values, ...resourcePatch, ...(f.type !== categoryOfProject(project) ? { type: f.type } : {}), ...(f.mdrUrl !== project.mdrUrl ? { mdrUrl: url! } : {}) } }
      : { type: 'projectAdd', project: { ...values, ...resources, type: f.type, id: code, code, mdrUrl: url! } }
    const error = guard(state, action)
    if (error) { toast.error(error); return }
    dispatch(action); onOpenChange(false)
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent dir="ltr" className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader className="text-start"><DialogTitle>{project ? 'Edit Project Details and Responsibilities' : 'New Project'}</DialogTitle><DialogDescription>Project responsibilities are assigned independently of company roles and teams.</DialogDescription></DialogHeader>
    <fieldset className="flex flex-wrap items-center gap-4 rounded-xl border p-3">
      <legend className="px-1 text-sm font-medium">Project Cover Image</legend>
      <ProjectCover image={cover} className="w-32 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <label htmlFor="np-cover" className="block text-sm font-medium">{cover ? 'Replace image' : 'Upload image'}</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ImageUp className="size-4 text-muted-foreground" aria-hidden="true" />
          <input id="np-cover" type="file" className="max-w-full text-xs" accept="image/jpeg,image/png,image/webp" disabled={readingCover} aria-describedby="np-cover-hint" onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file) void chooseCover(file)
          }} />
          {cover && <Button type="button" variant="ghost" size="sm" disabled={readingCover} onClick={() => { setCover(null); setCoverError('') }}><Trash2 className="size-4" /> Remove image</Button>}
        </div>
        <p id="np-cover-hint" className="mt-1 text-xs text-muted-foreground">{readingCover ? 'Preparing image…' : 'JPEG, PNG or WebP, up to 12 MB.'}</p>
        {coverError && <p role="alert" className="text-sm text-destructive">{coverError}</p>}
      </div>
    </fieldset>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div><Label htmlFor="np-code">Project Code</Label><Input id="np-code" dir="ltr" value={f.code} disabled={!!project} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
      <div><Label htmlFor="np-name">Project Name</Label><Input id="np-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><Label htmlFor="np-type">Project Type</Label><select id="np-type" className={selectClass} value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
        {legacyType !== null && <option value={legacyType} disabled>{projectTypeLabel(legacyType) || 'Unspecified'}</option>}
        {categories.map(type => <option key={type} value={type}>{type}</option>)}
      </select></div>
      {(!project || can.perm('staffing.edit')) && WORK_SCOPES.map(teamField)}
      <div className="sm:col-span-2"><Label htmlFor="np-url">MDR Link</Label><Input id="np-url" dir="ltr" value={f.mdrUrl} onChange={(e) => setF({ ...f, mdrUrl: e.target.value })} /></div>
      <div><Label htmlFor="np-tab">MDR Sheet Name</Label><Input id="np-tab" value={f.mdrTab} onChange={(e) => setF({ ...f, mdrTab: e.target.value })} /></div>
      {(!project || can.perm('staffing.edit')) && pickPerson('Chief Architect', staffing.chiefArchitectId, (id) => setStaffing({ ...staffing, chiefArchitectId: id }))}
    </div>
    <fieldset className="rounded-xl border p-3">
      <legend className="px-1 text-sm font-semibold">Project Information</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="np-area">Area (m²)</Label>
          <Input id="np-area" ref={areaInput} type="number" min={0} step="any" inputMode="decimal" value={area}
            aria-invalid={areaError || undefined} aria-describedby={areaError ? 'np-area-error' : undefined}
            onChange={e => { setArea(e.target.value); setAreaError(false) }} />
          {areaError && <p id="np-area-error" className="mt-1 text-xs text-destructive">Enter a non-negative number.</p>}
        </div>
        {PROJECT_TEXT_KEYS.map(key => <div key={key}>
          <Label htmlFor={`np-${key}`}>{PROJECT_TEXT_FIELDS[key]}</Label>
          <Input id={`np-${key}`} value={details[key]} maxLength={PROJECT_TEXT_LIMIT} onChange={e => setDetails({ ...details, [key]: e.target.value })} />
        </div>)}
        <div>
          <Label htmlFor="np-supervisor">Supervisor</Label>
          <select id="np-supervisor" className={selectClass} value={details.supervisorId} onChange={e => setDetails({ ...details, supervisorId: e.target.value })}>
            <option value="">Unassigned</option>
            {formerSupervisor && <option value={formerSupervisor} disabled>{state.users.find(u => u.id === formerSupervisor)?.name ?? 'Previous supervisor'} — Unavailable</option>}
            {supervisors.map(u => <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="np-interior">Interior Design By Pargar</Label>
          <select id="np-interior" className={selectClass} value={String(details.interiorDesignByPargar)} onChange={e => setDetails({ ...details, interiorDesignByPargar: e.target.value === 'true' })}>
            {project && project.interiorDesignByPargar == null && <option value="null" disabled>Unspecified</option>}
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
      </div>
    </fieldset>
    {(!project || can.perm('staffing.edit')) && <><fieldset className="rounded-xl border p-3"><legend className="px-1 text-sm font-semibold">Other Project Teams</legend><div className="flex flex-wrap gap-3">{state.teams.filter((t) => !['management','revit'].includes(t.kind) && (!t.archived || f.teamIds.includes(t.id))).map((t) => <label key={t.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.teamIds.includes(t.id)} onChange={(e) => setF({ ...f, teamIds: e.target.checked ? [...f.teamIds, t.id] : f.teamIds.filter((id) => id !== t.id) })} />{t.name}</label>)}</div></fieldset>
    <Input aria-label="Find Project Members" placeholder="Search designers and assistants by name or username" value={q} onChange={(e) => setQ(e.target.value)} />
    {WORK_SCOPES.map((scope) => <fieldset key={scope} className="rounded-xl border p-3"><legend className="px-1 font-semibold">Responsibilities: {SCOPE_FA[scope]}</legend>
      {pickPerson(`Project Manager: ${SCOPE_FA[scope]}`, staffing[scope].managerId, (id) => setStaffing({ ...staffing, [scope]: { ...staffing[scope], managerId: id } }))}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{(['designerIds', 'assistantIds'] as const).map((key) => <fieldset key={key}><legend className="mb-1 text-sm">{key === 'designerIds' ? 'Designers' : 'Assistant Designers'} {SCOPE_FA[scope]} ({staffing[scope][key].length})</legend><div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">{people.filter((u) => !q || u.name.includes(q) || u.username.includes(q)).map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input aria-label={`${key === 'designerIds' ? 'Designer' : 'Assistant Designer'} ${SCOPE_FA[scope]} ${u.username}`} type="checkbox" checked={staffing[scope][key].includes(u.id)} onChange={(e) => setStaffing({ ...staffing, [scope]: { ...staffing[scope], [key]: e.target.checked ? [...staffing[scope][key], u.id] : staffing[scope][key].filter((id) => id !== u.id) } })} />{u.name}</label>)}</div></fieldset>)}</div>
    </fieldset>)}</>}
    <DialogFooter className="gap-2 sm:justify-start"><Button disabled={readingCover} onClick={submit}>{project ? 'Save Project' : 'New Project'}</Button><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button></DialogFooter>
  </DialogContent></Dialog>
}

export function ProjectResponsibilities({ project }: { project: Project }) {
  const { state, userById, teamById } = useStore()
  const staff = staffingOf(project, state.users)
  const names = (ids: string[]) => ids.map((id) => userById[id]?.name ?? id).join(', ') || 'Unassigned'
  const details = [
    ['Project Type', projectTypeLabel(project.type)],
    ['Area (m²)', project.areaM2 == null ? null : `${project.areaM2.toLocaleString('en-US', { maximumSignificantDigits: 21 })} m²`],
    ...PROJECT_TEXT_KEYS.map(key => [PROJECT_TEXT_FIELDS[key], project[key]]),
    ['Supervisor', project.supervisorId ? userById[project.supervisorId]?.name ?? 'Unavailable' : 'Unassigned'],
    ['Interior Design By Pargar', project.interiorDesignByPargar == null ? null : project.interiorDesignByPargar ? 'Yes' : 'No'],
  ]
  return <section className="glass-card p-4" aria-label="Project Responsibilities"><h2 className="font-semibold">Project Staffing</h2><p className="mt-2 text-sm">Chief Architect: {staff.chiefArchitectId ? names([staff.chiefArchitectId]) : 'Unassigned'}</p><div className="mt-3 grid gap-4 md:grid-cols-2">{WORK_SCOPES.map((scope) => <div key={scope} className="rounded-xl border p-3 text-sm"><h3 className="font-semibold">{SCOPE_FA[scope]} · {teamById[scopeTeam(project, scope)]?.name ?? 'No team'}</h3><p className="mt-2">Manager: {staff[scope].managerId ? names([staff[scope].managerId!]) : 'Unassigned'}</p><p className="mt-2">Designers: {names(staff[scope].designerIds)}</p><p className="mt-2">Help Designers: {names(staff[scope].assistantIds)}</p></div>)}</div>
    <details className="mt-3 rounded-xl border p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Project Information</summary>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {details.map(([label, value]) => <div key={label} className="min-w-0">
          <dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value || '—'}</dd>
        </div>)}
      </dl>
    </details>
  </section>
}
