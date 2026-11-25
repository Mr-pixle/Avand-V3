import { saveTheme, useEnglishLocale } from './preferences'
import { englishDigits } from './digits'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'
import { buildSeed, refreshToday, TODAY } from './seed'
import { J_MONTHS, WEEKDAYS, tehranISO, tehranTime, toJalali, weekdayIndex } from './jalali'
import { activeOf, channelMembers, isWorkItem, isSupervisionMember } from './domain'
import type { AdminRequest, AuditEntry, Task, User, WorkLog } from './types'
import { RemoteStore, SERVER_MODE } from './remote'
import { isActiveProjectId } from './projectDetails'
import { createPlanner } from './planning'
import {
  canAssignTo, canCreateInternalProject, canCreateProjectTask, canDecideReview, canEditLog, canLogTime, canSeeAllLogs, canEditStatus, canManageFlowTask, canPlanTask, canSeeTeamSpace, canSyncProject, canViewSupervisionOf, canViewTask, has, isExecutor, type Perm,
  managesItRequests, canHandleItRequest, canDecideRequest, canSeeRequest, canSeeTimesheetOf, canSeeAuditEntry, canSeeFinSpace,
} from './policy'
import { CONTROL_PAGES, WRITEBACK_DELAY_SEC, reducer, rollupMap, type Action, type Page, type State } from './state'
import { navigationHash, readNavigation } from './navigation'
import { orderedTeams, compareTeams } from './brand'

export * from './state'

// The viewer may already set data-theme on <html>; remember it so "system" can hand control back
const HOST_THEME = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null

function initialUi(): Pick<State, 'nav' | 'openTaskId' | 'profileUserId' | 'theme' | 'profileTab' | 'denial'> {
  const nav = readNavigation(typeof location === 'undefined' ? '' : location.hash)
  return { nav, openTaskId: null, profileUserId: null, profileTab: 'profile', theme: 'system', denial: null }
}
function init(): State {
  return { ...buildSeed(), roleDefinitions: {}, whiteboards: {}, supervisionWorkflows: {}, deadlinePreferences: {}, deadlineEvents: {}, siteVisits: {}, folderIcons: {}, documents: {}, importantLinks: {}, mindMaps: {}, stickyNotes: {}, reminders: {}, writeQueue: [], lastRead: {}, session: null, ...initialUi() }
}

// ---------- where the state lives: this page (demo) or the Taraz server ----------
let remote: RemoteStore | null = null
/** The connection to the server (server version only) */
export function getRemote() {
  if (!remote) { remote = new RemoteStore(initialUi()); void remote.boot() }
  return remote
}
function useRemoteSource(): [State, (a: Action) => void] {
  const r = getRemote()
  const state = useSyncExternalStore(r.subscribe, r.snapshot)
  return [state, r.dispatch]
}
const useLocalSource = (): [State, (a: Action) => void] => useReducer(reducer, undefined, init)
const useSource = SERVER_MODE ? useRemoteSource : useLocalSource
/** Signed-out placeholder so the sign-in page can render before any user is loaded */
const GUEST: User = { id: '', name: '', username: '', teamId: '', role: 'member', capacity: 0, status: 'pending', createdAt: '' }

// ---------- context ----------
const Ctx = createContext<ReturnType<typeof useStoreValue> | null>(null)

function useStoreValue() {
  const [sourceState, applyAction] = useSource()
  const teams = useMemo(()=>orderedTeams(sourceState.teams),[sourceState.teams])
  const state = useMemo(()=>({...sourceState,teams}),[sourceState,teams])
  const dispatch = useCallback((action: Action) => {
    if (action.type === 'nav') {
      const hash = navigationHash(action.nav)
      if (hash !== location.hash) {
        try { history.pushState(null, '', hash) } catch { /* keep navigation available if history is restricted */ }
      }
    }
    applyAction(action)
  }, [applyAction])
  useEffect(() => {
    const restore = () => applyAction({ type: 'nav', nav: readNavigation(location.hash), fromHistory: true })
    const hash = navigationHash(readNavigation(location.hash))
    try {
      if (hash !== location.hash) history.replaceState(history.state, '', hash)
    } catch { /* history may be restricted */ }
    // Traversing entries with different fragments also fires hashchange.
    window.addEventListener('hashchange', restore)
    return () => window.removeEventListener('hashchange', restore)
  }, [applyAction])
  const derived = useMemo(() => rollupMap(state), [state.tasks, state.statusSets])
  const activeUsers = useMemo(() => { const byId=Object.fromEntries(teams.map(t=>[t.id,t]));return activeOf(state.users).sort((a,b)=>compareTeams(byId[a.teamId],byId[b.teamId])) }, [state.users,teams])
  const me = state.users.find((u) => u.id === state.session) ?? state.users[0] ?? GUEST
  const teamById = useMemo(() => Object.fromEntries(state.teams.map((t) => [t.id, t])), [state.teams])
  const userById = useMemo(() => Object.fromEntries(state.users.map((u) => [u.id, u])), [state.users])
  const projectById = useMemo(() => Object.fromEntries(state.projects.map((p) => [p.id, p])), [state.projects])

  const planner = (excludeTaskId?: string) =>
    createPlanner({ users: activeUsers, holidays: state.holidays.map((h) => h.date), leaves: state.leaves, allocations: state.allocations.filter(a=>!state.tasks[a.taskId]||isActiveProjectId(state.projects,state.tasks[a.taskId].projectId)) }, excludeTaskId)

  const teamOf = (t: Task) => (t.assigneeUserId ? userById[t.assigneeUserId]?.teamId : t.assigneeTeamId) ?? null
  // UI mirrors of lib/policy.ts — the reducer enforces the same rules again on every write
  const pageAllowed = (p: Page) =>
    (p === 'projects' || p === 'project' || p === 'pchat') && !has(me, 'project.view')&&!isSupervisionMember(state,me) ? false :
    (p === 'documents' || p === 'links') && !has(me, 'library.view') ? false :
    p === 'requests' && !has(me, 'requests.create') ? false : me.role === 'ceo' && (p === 'requests' || p === 'timesheet') ? false : p === 'inbox' ? managesItRequests(me) || has(me, 'requests.office') || has(me, 'requests.ceo') : p === 'adminreports' ? has(me, 'admin.reports') : p === 'finadmin' ? canSeeFinSpace(me) : !CONTROL_PAGES.includes(p) || has(me, 'control.section')
  const can = {
    /** has planning rights somewhere (PM: own projects, lead: own team) */
    plan: has(me, 'plan.all') || state.projects.some((p) => canCreateProjectTask(state, me, p.id)),
    control: has(me, 'control.section'),
    logTime: (t: Task) => canLogTime(state, me, t),
    seeAllLogs: (t: Task) => canSeeAllLogs(state, me, t),
    editLog: (log: WorkLog, t: Task) => canEditLog(state, me, log, t),
    admin: has(me, 'admin.view'),
    perm: (p: Perm) => has(me, p),
    page: pageAllowed,
    assignTo: (t: Task, r: { kind: 'user' | 'team'; id: string } | null) => canAssignTo(state, me, t, r),
    planTask: (t: Task) => canPlanTask(state, me, t),
    editStatus: (t: Task) => canEditStatus(state, me, t),
    editUser: (id: string) => id === me.id || has(me, 'users.manage'),
    viewTask: (t: Task) => canViewTask(state, me, t),
    syncProject: (pid: string) => canSyncProject(state, me, pid),
    createProjectTask: (pid: string) => canCreateProjectTask(state, me, pid),
    manageFlow: (t: Task) => canManageFlowTask(state, me, t),
    decideReview: (t: Task) => canDecideReview(state, me, t),
    executor: (t: Task) => isExecutor(state, me, t),
    seeTeam: (teamId: string) => canSeeTeamSpace(me, teamId),
    createInternalProject: (teamId: string) => canCreateInternalProject(me, teamId),
    viewSupervision: (pid: string) => canViewSupervisionOf(state, me, pid),
    seeTimesheet: (userId: string) => canSeeTimesheetOf(me, userId),
    seeRequest: (r: AdminRequest) => canSeeRequest(me, r),
    handleItRequest: (r: AdminRequest) => canHandleItRequest(me, r),
    decideRequest: (r: AdminRequest) => canDecideRequest(me, r),
    seeFin: canSeeFinSpace(me),
    seeAudit: (a: AuditEntry) => canSeeAuditEntry(state, me, a),
  }
  const workItems = useMemo(() => Object.values(state.tasks).filter(t=>isWorkItem(t)&&isActiveProjectId(state.projects,t.projectId)).sort((a, b) => a.order - b.order), [state.tasks,state.projects])
  const myNotifs = useMemo(() => state.notifications.filter((n) => n.userId === state.session).sort((a, b) => b.at.localeCompare(a.at)), [state.notifications, state.session])
  const unread = myNotifs.filter((n) => !n.read).length
  const myChannels = useMemo(() => {
    const ids = ['general', 'announce', ...state.projects.map((p) => `project:${p.id}`)]
    return ids.filter((c) => channelMembers(state, c).includes(me.id))
  }, [state.projects, state.users, me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const unreadIn = (channelId: string) => {
    const last = state.lastRead[`${me.id}|${channelId}`] ?? ''
    return state.messages.filter((m) => m.channelId === channelId && m.at > last && m.userId !== me.id).length
  }

  return { state, dispatch, ...derived, me, activeUsers, teamById, userById, projectById, planner, teamOf, can, workItems, myNotifs, unread, myChannels, unreadIn }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue()
  const { state, dispatch } = value
  const previousSession = useRef(state.session)
  // "today" rolls over at midnight (Tehran) even when the page stays open for days
  const [, setDay] = useState(TODAY)
  useEffect(() => { const h = setInterval(() => { if (refreshToday()) setDay(TODAY) }, 60_000); return () => clearInterval(h) }, [])
  useEffect(() => {
    // the server version writes back from the server; this timer is the browser-only demo's stand-in
    if (SERVER_MODE || !state.writeQueue.length) return
    const last = Math.max(...state.writeQueue.map((w) => w.queuedAt))
    const ms = Math.max(0, last + WRITEBACK_DELAY_SEC * 1000 - Date.now())
    const h = setTimeout(() => {
      dispatch({ type: 'flushWriteBack' })
      toast.success("Write-back is done", { description: "Last Status, Progress and Last Status Date were updated in MDR." })
    }, ms)
    return () => clearTimeout(h)
  }, [state.writeQueue, dispatch])
  useEffect(() => {
    const root = document.documentElement
    if (state.theme === 'system') { if (HOST_THEME) root.setAttribute('data-theme', HOST_THEME); else root.removeAttribute('data-theme') }
    else root.setAttribute('data-theme', state.theme)
    if (state.session) saveTheme(state.session, state.theme)
  }, [state.theme, state.session])
  useEffect(() => {
    if (state.denial) toast.error(state.denial.title ?? 'Permission denied', { description: state.denial.text })
  }, [state.denial?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (previousSession.current && !state.session) {
      try { history.replaceState(null, '', '#home') } catch { /* history may be restricted */ }
    }
    previousSession.current = state.session
  }, [state.session])
  const phase = SERVER_MODE ? getRemote().phase : 'in'
  if (phase === 'loading' || phase === 'offline') {
    return (
      <div role="status" className="flex min-h-full items-center justify-center p-6 text-center text-[14px] text-muted-foreground">
        {phase === 'loading' ? 'Connecting to Avand…' : 'Avand is unavailable. Retrying in a few seconds.'}
      </div>
    )
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('StoreProvider missing')
  return v
}

// ---------- formatting (all clock times in Asia/Tehran) ----------

export function useFmt() {
  const locale = useEnglishLocale(useContext(Ctx)?.state.session)
  const digits = englishDigits
  const n = (x: number, frac = 0) => x.toLocaleString(locale, { maximumFractionDigits: frac })
  const d = (iso?: string) => {
    if (!iso) return '—'
    const j = toJalali(iso)
    return digits(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`)
  }
  const dLong = (iso: string) => {
    const j = toJalali(iso)
    const month = J_MONTHS[j.jm - 1]
    return locale === 'en-US' ? month + ' ' + j.jd + ', ' + j.jy : j.jd + ' ' + month + ' ' + j.jy
  }
  const dShort = (iso: string) => {
    const j = toJalali(iso)
    const month = J_MONTHS[j.jm - 1]
    return locale === 'en-US' ? month + ' ' + j.jd : j.jd + ' ' + month
  }
  /** Clock time of a timestamp in Tehran */
  const clock = (ts: string | Date) => digits(tehranTime(typeof ts === 'string' ? new Date(ts) : ts))
  /** Day label of a timestamp in Tehran: امروز / دیروز / weekday + date */
  const dayLabel = (ts: string) => {
    const day = tehranISO(new Date(ts))
    if (day === tehranISO()) return 'Today'
    if (day === tehranISO(new Date(Date.now() - 86400000))) return 'Yesterday'
    return `${WEEKDAYS[weekdayIndex(day)]} ${dLong(day)}`
  }
  const time = (isoTs: string) => {
    const t = new Date(isoTs)
    const mins = Math.round((Date.now() - t.getTime()) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${digits(mins)} min ago`
    if (mins < 60 * 24) return `${digits(Math.round(mins / 60))} h ago`
    return `${digits(Math.round(mins / 1440))} d ago`
  }
  return { locale, digits, n, d, dLong, dShort, clock, dayLabel, time, pct: (x: number) => `${n(Math.round(x))}%`, h: (x: number) => `${n(x, 1)} h` }
}
