import { useWorkspaceSave } from '@/lib/useWorkspaceSave'
import { TeamName } from '@/components/ItemIcon'
// Administrative module — shared pieces: request status, request form and detail, timesheet day.
import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, CircleSlash, Clock3, FileText, History, Lock, Send, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { requestSummary, useFmt, useStore, type NewFile, type NewRequest } from '@/lib/store'
import { TODAY } from '@/lib/seed'
import { WEEKDAYS, diffDays, weekdayIndex } from '@/lib/jalali'
import {
  checkLeave, checkOvertime, configFor, dayKey, hm, hourLeaveMinutes, isHM, isMonthClosed, isOffDay, isPending, KIND_FA, LEAVE_CAT_FA, leaveDates, OT_FA, OTHER_CAT_FA,
  otState, overtimeAvailable, overtimeIndex, presenceOf, STATUS_FA, type OtState,
} from '@/lib/admin'
import { activeLogs } from '@/lib/worklog'
import type { AdminRequest, AdminRequestKind, AdminRequestStatus, LeaveCategory, OtherCategory, TimesheetDay } from '@/lib/types'
import { Initials, JalaliDateField, Segmented } from './common'
import { FilePicker, fmtSize } from './FlowViews'

/** "۸:۳۰" */
export function useHM() {
  const { digits } = useFmt()
  return (m: number) => digits(hm(m))
}

const STATUS_CLS: Record<AdminRequestStatus, string> = {
  pending_it: 'bg-azure-soft text-azure-ink', it_in_progress: 'bg-warning-soft text-warning-ink', it_resolved: 'bg-leaf-soft text-leaf-ink',
  pending_office: 'bg-azure-soft text-azure-ink', pending_ceo: 'bg-azure-soft text-azure-ink', approved: 'bg-leaf-soft text-leaf-ink',
  rejected: 'bg-destructive/10 text-destructive', withdrawn: 'bg-secondary text-muted-foreground', cancelled: 'bg-secondary text-muted-foreground',
}
export function RequestStatusPill({ s, className }: { s: AdminRequestStatus; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium', STATUS_CLS[s], className)}>{STATUS_FA[s]}</span>
}

const OT_CLS: Record<OtState, string> = {
  none: '', undecided: 'bg-[var(--status-warning)]/25 text-foreground ring-1 ring-[var(--status-warning)]', pending: 'bg-azure-soft text-azure-ink',
  approved: 'bg-leaf-soft text-leaf-ink', partial: 'bg-leaf-soft text-leaf-ink ring-1 ring-leaf/40', rejected: 'bg-secondary text-muted-foreground', unpaid: 'bg-secondary text-muted-foreground',
}
export function OtChip({ state, minutes, className }: { state: OtState; minutes: number; className?: string }) {
  const h = useHM()
  if (state === 'none') return null
  return <span className={cn('num inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-medium', OT_CLS[state], className)} title={OT_FA[state]}>+{h(minutes)}<span className="hidden sm:inline">{OT_FA[state]}</span></span>
}

/** Submitted → Administrative Manager → CEO → result */
export function RequestStepper({ r }: { r: AdminRequest }) {
  const { userById } = useStore()
  const office = r.steps.find((s) => s.stage === 'office')
  const ceo = r.steps.find((s) => s.stage === 'ceo')
  const skippedOffice = r.steps.some((s) => s.stage === 'system') && !office
  const node = (label: string, state: 'done' | 'now' | 'no' | 'idle' | 'skip', who?: string) => (
    <li className="flex min-w-0 items-center gap-1.5">
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]',
        state === 'done' ? 'bg-leaf text-leaf-foreground' : state === 'now' ? 'bg-azure text-azure-foreground' : state === 'no' ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-muted-foreground')}>
        {state === 'done' ? <Check className="h-3 w-3" /> : state === 'no' ? <X className="h-3 w-3" /> : state === 'now' ? <Clock3 className="h-3 w-3" /> : state === 'skip' ? '–' : ''}
      </span>
      <span className={cn('truncate text-[11.5px]', state === 'now' ? 'font-semibold' : state === 'idle' || state === 'skip' ? 'text-muted-foreground' : '')} title={who}>{label}</span>
    </li>
  )
  if (r.kind === 'it') {
    const step = [...r.steps].reverse().find((s) => s.stage === 'it')
    return <ol className="flex flex-wrap items-center gap-2" aria-label="The process of requesting IT">
      {node('Submit', 'done', userById[r.userId]?.name)}
      {node('Project Controls', r.status === 'it_resolved' ? 'done' : isPending(r) ? 'now' : 'idle', step ? userById[step.by]?.name : undefined)}
      {node(STATUS_FA[r.status], r.status === 'it_resolved' ? 'done' : 'idle')}
    </ol>
  }
  const ended = ['withdrawn', 'cancelled'].includes(r.status)
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Application process">
      {node('Submit', 'done', userById[r.userId]?.name)}
      <span className="h-px w-3 bg-border" aria-hidden="true" />
      {node('Office Manager', skippedOffice ? 'skip' : office ? (office.decision === 'approve' ? 'done' : 'no') : r.status === 'pending_office' ? 'now' : ended ? 'idle' : 'idle', office ? userById[office.by]?.name : undefined)}
      <span className="h-px w-3 bg-border" aria-hidden="true" />
      {node('CEO', ceo ? (ceo.decision === 'approve' ? 'done' : 'no') : r.status === 'pending_ceo' ? 'now' : r.status === 'approved' ? 'done' : 'idle', ceo ? userById[ceo.by]?.name : undefined)}
      <span className="h-px w-3 bg-border" aria-hidden="true" />
      {node(r.status === 'approved' ? 'Final Approval' : r.status === 'rejected' ? 'Reject' : r.status === 'withdrawn' ? "He was taken back" : r.status === 'cancelled' ? "Cancelled" : "Results", r.status === 'approved' ? 'done' : r.status === 'rejected' ? 'no' : 'idle')}
    </ol>
  )
}

/** One line per request, for lists and the inbox */
export function RequestRow({ r, onOpen, showUser }: { r: AdminRequest; onOpen: () => void; showUser?: boolean }) {
  const { state, userById } = useStore()
  const { time, digits } = useFmt()
  const holidays = useMemo(() => new Set(state.holidays.map((h) => h.date)), [state.holidays])
  return (
    <button type="button" onClick={onOpen} className="flex w-full flex-col gap-1.5 border-b px-4 py-3 text-start last:border-0 hover:bg-foreground/[0.035]">
      <span className="flex w-full flex-wrap items-center gap-2">
        <span className="num text-[11.5px] text-muted-foreground">#{digits(r.no)}</span>
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium">{KIND_FA[r.kind]}</span>
        {showUser && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium"><Initials user={userById[r.userId]} size={20} />{userById[r.userId]?.name}</span>}
        <span className="min-w-0 flex-1 truncate text-[13px]">{requestSummary(r, holidays)}</span>
        <RequestStatusPill s={r.status} />
      </span>
      <span className="flex w-full flex-wrap items-center justify-between gap-2">
        <RequestStepper r={r} />
        <span className="text-[11px] text-muted-foreground">Submit {time(r.createdAt)}</span>
      </span>
    </button>
  )
}

// ---------- new request ----------
export interface RequestPreset { kind?: AdminRequestKind; date?: string; minutes?: number; taskIds?: string[] }

export function NewRequestDialog({ open, onOpenChange, preset }: { open: boolean; onOpenChange: (o: boolean) => void; preset?: RequestPreset }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="ltr" className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
        {open && <NewRequestForm preset={preset} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function NewRequestForm({ preset, onDone }: { preset?: RequestPreset; onDone: () => void }) {
  const { state, dispatch, me, workItems } = useStore()
  const { save, busy } = useWorkspaceSave()
  const { digits, n, d } = useFmt()
  const h = useHM()
  const holidays = useMemo(() => new Set(state.holidays.map((x) => x.date)), [state.holidays])
  const [itTitle, setItTitle] = useState('')
  const [kind, setKind] = useState<AdminRequestKind>(preset?.kind ?? 'leave')
  const [lv, setLv] = useState({ mode: 'day' as 'day' | 'hour', category: 'unified' as LeaveCategory, from: preset?.date, to: preset?.date, start: '14:00', end: '16:00' })
  const [ot, setOt] = useState({ date: preset?.date, h: String(Math.floor((preset?.minutes ?? 60) / 60)), m: String((preset?.minutes ?? 0) % 60), taskIds: preset?.taskIds ?? [] as string[] })
  const [oth, setOth] = useState({ title: '', category: 'certificate' as OtherCategory, date: undefined as string | undefined })
  const [desc, setDesc] = useState('')
  const [files, setFiles] = useState<NewFile[]>([])
  const cfg = configFor(state.timesheetConfigs, TODAY)
  const otDay = ot.date ? state.timesheets[dayKey(me.id, ot.date)] : undefined
  const otReqs = ot.date ? overtimeIndex(state.adminRequests).get(dayKey(me.id, ot.date)) ?? [] : []
  const minutes = (Number(ot.h) || 0) * 60 + (Number(ot.m) || 0)
  // tasks to pick: the ones logged that day first, then my open tasks
  const taskChoices = useMemo(() => {
    const logged = ot.date ? [...new Set(activeLogs(state.workLogs).filter((l) => l.userId === me.id && l.workDate === ot.date).map((l) => l.taskId))] : []
    const mine = workItems.filter((t) => t.assigneeUserId === me.id && !t.actualFinish).map((t) => t.id)
    const flow = Object.values(state.tasks).filter((t) => (t.kind === 'supervision' || t.kind === 'internal') && t.assigneeUserId === me.id && t.flow !== 'closed').map((t) => t.id)
    return [...new Set([...logged, ...ot.taskIds, ...mine, ...flow])].slice(0, 14).map((id) => state.tasks[id]).filter(Boolean)
  }, [ot.date, ot.taskIds, state.workLogs, state.tasks, workItems, me.id])
  const leaveDays = lv.from ? leaveDates({ mode: lv.mode, from: lv.from, to: lv.mode === 'hour' ? lv.from : lv.to ?? lv.from }, holidays) : []

  const submit = async () => {
    let req: NewRequest
    if (kind === 'leave') {
      const leave = { mode: lv.mode, category: lv.category, from: lv.from ?? '', to: lv.mode === 'hour' ? lv.from ?? '' : lv.to ?? lv.from ?? '', ...(lv.mode === 'hour' ? { startTime: lv.start, endTime: lv.end } : {}) }
      const err = checkLeave(leave, { holidays, today: TODAY, cfg, closes: state.monthCloses, existing: state.leaves, pending: state.adminRequests, userId: me.id })
      if (err) { toast.error(err); return }
      req = { kind, description: desc, leave }
    } else if (kind === 'overtime') {
      const err = checkOvertime({ date: ot.date, minutes }, { today: TODAY, closes: state.monthCloses, day: otDay, requests: otReqs })
      if (err) { toast.error(err); return }
      req = { kind, description: desc, overtime: { date: ot.date!, minutes, taskIds: ot.taskIds } }
    } else if (kind === 'it') {
      if (!itTitle.trim()) { toast.error("Write the request title."); return }
      req = { kind, description: desc, it: { title: itTitle } }
    } else {
      if (!oth.title.trim()) { toast.error("Write the request title."); return }
      req = { kind, description: desc, other: { title: oth.title, category: oth.category, date: oth.date } }
    }
    const no = Math.max(0, ...state.adminRequests.map((x) => x.no)) + 1
    if (kind === 'it') {
      if (await save({ type: 'reqCreate', req, files }, "The application was registered in the Project Control Cart.")) onDone()
      return
    }
    dispatch({ type: 'reqCreate', req, files })
    toast.success(`Request ${KIND_FA[kind]} # ${digits(no)} Registered`, { description: me.role === 'ceo' ? "The manager’s request was filed without approval." : me.role === 'office' ? "He went to the CEO’s office." : "He went to the office manager's office." })
    onDone()
  }

  return (
    <>
      <DialogHeader className="pe-8 text-start">
        <DialogTitle>New office application</DialogTitle>
        <DialogDescription>Follow the results here and the notifications.</DialogDescription>
      </DialogHeader>
      <div><Label htmlFor="rq-kind">Request Type</Label><select id="rq-kind" className="mt-1 h-10 w-full rounded-md border bg-background px-2" value={kind} onChange={(e) => setKind(e.target.value as AdminRequestKind)}>{(Object.keys(KIND_FA) as AdminRequestKind[]).map((value) => <option key={value} value={value}>{KIND_FA[value]}</option>)}</select></div>

      {kind === 'leave' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-wrap items-center gap-2">
            <Segmented size="sm" value={lv.mode} onChange={(v) => setLv({ ...lv, mode: v })} options={[{ value: 'day', label: "Daily" }, { value: 'hour', label: "Hourly" }]} />
            
          </div>
          {lv.mode === 'day' ? (
            <>
              <div><Label htmlFor="rq-from" className="eyebrow">from</Label><div className="mt-1"><JalaliDateField id="rq-from" value={lv.from} onChange={(v) => setLv({ ...lv, from: v, to: !lv.to || (v && lv.to < v) ? v : lv.to })} /></div></div>
              <div><Label htmlFor="rq-to" className="eyebrow">to</Label><div className="mt-1"><JalaliDateField id="rq-to" value={lv.to} onChange={(v) => setLv({ ...lv, to: v })} /></div></div>
            </>
          ) : (
            <>
              <div className="col-span-2"><Label htmlFor="rq-from" className="eyebrow">Days</Label><div className="mt-1"><JalaliDateField id="rq-from" value={lv.from} onChange={(v) => setLv({ ...lv, from: v, to: v })} /></div></div>
              <div><Label htmlFor="rq-start" className="eyebrow">From the clock</Label><Input id="rq-start" type="time" dir="ltr" className="num mt-1 h-9" value={lv.start} onChange={(e) => setLv({ ...lv, start: e.target.value })} /></div>
              <div><Label htmlFor="rq-end" className="eyebrow">Until the hour</Label><Input id="rq-end" type="time" dir="ltr" className="num mt-1 h-9" value={lv.end} onChange={(e) => setLv({ ...lv, end: e.target.value })} /></div>
            </>
          )}
          <p className="col-span-2 text-[12px] text-muted-foreground">
            {lv.mode === 'hour' ? (isHM(lv.start) && isHM(lv.end) ? `Duration: ${h(hourLeaveMinutes({ startTime: lv.start, endTime: lv.end }))} — The time required for that day is so low.` : '')
              : lv.from ? `${n(leaveDays.length)} Workday (Thursday, Friday and holidays are not counted).` : "Choose the vacation period."}
          </p>
        </div>
      )}

      {kind === 'overtime' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label htmlFor="rq-ot-date" className="eyebrow">Days</Label><div className="mt-1"><JalaliDateField id="rq-ot-date" value={ot.date} onChange={(v) => setOt({ ...ot, date: v })} /></div></div>
          <div><Label htmlFor="rq-ot-h" className="eyebrow">Hours</Label><Input id="rq-ot-h" type="number" min={0} max={12} dir="ltr" className="num mt-1 h-9" value={ot.h} onChange={(e) => setOt({ ...ot, h: e.target.value })} /></div>
          <div><Label htmlFor="rq-ot-m" className="eyebrow">minute</Label><Input id="rq-ot-m" type="number" min={0} max={59} step={5} dir="ltr" className="num mt-1 h-9" value={ot.m} onChange={(e) => setOt({ ...ot, m: e.target.value })} /></div>
          <p className="col-span-2 rounded-lg bg-secondary/70 px-3 py-2 text-[12px] leading-relaxed">
            {!ot.date ? "Choose the extra working day."
              : otDay?.checkOut ? <>Net Hours {d(ot.date)}: <b className="num">{h(otDay.calc.worked)}</b>the Overwork <b className="num">{h(otDay.calc.excess)}</b>Requested, <b className="num">{h(overtimeAvailable(otDay.calc, otReqs))}</b>.</>
                : <>Overtime work in advance. After registering the time sheet that day, the maximum amount payable is as real as overtime work.</>}
          </p>
          <fieldset className="col-span-2">
            <legend className="eyebrow mb-1">The Tasks of this Overtime</legend>
            {taskChoices.length ? (
              <div className="thin-scroll flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                {taskChoices.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                    <Checkbox checked={ot.taskIds.includes(t.id)} onCheckedChange={(v) => setOt({ ...ot, taskIds: v ? [...ot.taskIds, t.id] : ot.taskIds.filter((x) => x !== t.id) })} />
                    <span className="truncate">{t.docNumber ? <span className="mono me-1 text-[11px] text-muted-foreground">{t.docNumber}</span> : null}{t.name}</span>
                  </label>
                ))}
              </div>
            ) : <p className="text-[12px] text-muted-foreground">The task is not left to you; write down the work done in the description.</p>}
          </fieldset>
        </div>
      )}

      {kind === 'it' && <div><Label htmlFor="rq-it-title">Problem Title or Request</Label><Input id="rq-it-title" className="mt-1" value={itTitle} maxLength={120} onChange={(e) => setItTitle(e.target.value)} /></div>}
      {kind === 'other' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label htmlFor="rq-title" className="eyebrow">Title</Label><Input id="rq-title" className="mt-1" value={oth.title} onChange={(e) => setOth({ ...oth, title: e.target.value })} placeholder="For example: Employment Certificate" /></div>
          <div><Label htmlFor="rq-ocat" className="eyebrow">Category</Label>
            <Select value={oth.category} onValueChange={(v) => setOth({ ...oth, category: v as OtherCategory })}>
              <SelectTrigger id="rq-ocat" className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(OTHER_CAT_FA) as OtherCategory[]).map((k) => <SelectItem key={k} value={k}>{OTHER_CAT_FA[k]}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label htmlFor="rq-odate" className="eyebrow">Date (optional)</Label><div className="mt-1"><JalaliDateField id="rq-odate" value={oth.date} onChange={(v) => setOth({ ...oth, date: v })} /></div></div>
        </div>
      )}

      <div><Label htmlFor="rq-desc" className="eyebrow">Description</Label><Textarea id="rq-desc" className="mt-1 min-h-[64px]" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <FilePicker id="rq-files" files={files} onChange={setFiles} label="Appendix (e.g. doctor’s certificate)" />
      <DialogFooter className="gap-2 sm:justify-start">
        <Button onClick={submit} disabled={busy}><Send className="h-4 w-4" /> Request Registration</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </DialogFooter>
    </>
  )
}

// ---------- request detail ----------
export function RequestDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { state } = useStore()
  const r = id ? state.adminRequests.find((x) => x.id === id) : undefined
  return (
    <Dialog open={!!r} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent dir="ltr" className="thin-scroll max-h-[88vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        {r && <RequestDetail r={r} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="eyebrow">{label}</dt><dd className="mt-0.5 text-[13px]">{children}</dd></div>
}

function RequestDetail({ r, onClose }: { r: AdminRequest; onClose: () => void }) {
  const { state, dispatch, me, can, userById, teamById } = useStore()
  const { save, busy } = useWorkspaceSave()
  const { d, dLong, time, clock, digits, n } = useFmt()
  const h = useHM()
  const holidays = useMemo(() => new Set(state.holidays.map((x) => x.date)), [state.holidays])
  const [note, setNote] = useState('')
  const officeMinutes = [...r.steps].reverse().find((s) => s.stage === 'office' && s.minutes != null)?.minutes
  const cap = r.overtime ? officeMinutes ?? r.overtime.minutes : 0
  const [mins, setMins] = useState(String(cap))
  const u = userById[r.userId]
  const canDecide = can.decideRequest(r)
  const canWithdraw = r.userId === me.id && isPending(r) && !r.steps.some((s) => s.stage === 'office' || s.stage === 'ceo' || s.stage === 'it')
  const canCancel = can.perm('requests.office') && r.kind === 'leave' && r.status === 'approved'
  const day = r.overtime ? state.timesheets[dayKey(r.userId, r.overtime.date)] : undefined
  const dayLogs = r.overtime ? activeLogs(state.workLogs).filter((l) => l.userId === r.userId && l.workDate === r.overtime!.date) : []
  const stageFa = { it: 'Project Controls', submit: "Request Registration", office: 'Office Manager', ceo: 'CEO', withdraw: 'Withdraw', cancel: 'Cancel', system: "System" } as const

  const updateIt = async (status: 'it_in_progress' | 'it_resolved') => {
    if (await save({ type: 'reqItUpdate', id: r.id, status, note }, "The request status is saved.")) onClose()
  }
  const decide = (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !note.trim()) { toast.error("Write down the reason for rejection."); return }
    const m = Number(mins)
    if (decision === 'approve' && r.kind === 'overtime' && (!Number.isInteger(m) || m <= 0 || m > cap)) { toast.error(`The confirmation value must be between 1 and ${digits(cap)} minutes.`); return }
    dispatch({ type: 'reqDecide', id: r.id, decision, note: note.trim() || undefined, minutes: decision === 'approve' && r.kind === 'overtime' ? m : undefined })
    toast.success(decision === 'reject' ? "The request was rejected" : r.status === 'pending_office' ? "Confirmed and went to the CEO’s cartel" : "Final confirmation")
    onClose()
  }
  return (
    <>
      <DialogHeader className="pe-8 text-start">
        <DialogTitle className="flex flex-wrap items-center gap-2">Request {KIND_FA[r.kind]} <span className="num text-muted-foreground">#{digits(r.no)}</span><RequestStatusPill s={r.status} /></DialogTitle>
        <DialogDescription className="flex items-center gap-2"><Initials user={u} size={20} />{u?.name}, <TeamName team={teamById[u?.teamId ?? '']} /> · Submitted {time(r.createdAt)}</DialogDescription>
      </DialogHeader>
      <RequestStepper r={r} />
      <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-background/40 p-3">
        {r.leave && <>
          <Fact label="Type">{LEAVE_CAT_FA[r.leave.category]}, {r.leave.mode === 'hour' ? "Hourly" : "Daily"}</Fact>
          <Fact label="Time">{r.leave.mode === 'hour' ? <span className="num">{d(r.leave.from)} from {digits(r.leave.startTime ?? '')} to {digits(r.leave.endTime ?? '')}</span> : <span className="num">{d(r.leave.from)} to {d(r.leave.to)}</span>}</Fact>
          <Fact label="Time (disambiguation)">{r.leave.mode === 'hour' ? h(hourLeaveMinutes(r.leave)) : `${n(leaveDates(r.leave, holidays).length)} Working Day`}</Fact>
        </>}
        {r.overtime && <>
          <Fact label="Days"><span className="num">{WEEKDAYS[weekdayIndex(r.overtime.date)]} {dLong(r.overtime.date)}</span></Fact>
          <Fact label="Request Quantity"><span className="num">{h(r.overtime.minutes)}</span>{r.overtime.source === 'advance' ? " (Before)" : ''}</Fact>
          {r.overtime.approvedMinutes != null && <Fact label="Approved"><span className="num">{h(r.overtime.approvedMinutes)}</span></Fact>}
          {day?.checkOut && <Fact label="Timesheet for This Day"><span className="num">{digits(day.checkIn ?? '')} to {digits(day.checkOut)} · Net work {h(day.calc.worked)} · Overtime {h(day.calc.excess)}</span></Fact>}
        </>}
        {r.it && <Fact label="Title">{r.it.title}</Fact>}
        {r.other && <>
          <Fact label="Title">{r.other.title}</Fact>
          <Fact label="Category">{OTHER_CAT_FA[r.other.category]}</Fact>
          {r.other.date && <Fact label="Date"><span className="num">{d(r.other.date)}</span></Fact>}
        </>}
        {r.description && <div className="col-span-2"><Fact label="Description"><span className="whitespace-pre-wrap">{r.description}</span></Fact></div>}
      </dl>
      {r.overtime && (r.overtime.taskIds.length > 0 || dayLogs.length > 0) && (
        <section>
          <h3 className="eyebrow mb-1">Tasks and Work Log that day</h3>
          <ul className="flex flex-col gap-1 text-[12.5px]">
            {[...new Set([...r.overtime.taskIds, ...dayLogs.map((l) => l.taskId)])].map((tid) => {
              const t = state.tasks[tid]
              const m = dayLogs.filter((l) => l.taskId === tid).reduce((s, l) => s + l.minutes, 0)
              return t ? (
                <li key={tid} className="flex items-center gap-2">
                  {r.overtime!.taskIds.includes(tid) ? <Check className="h-3.5 w-3.5 shrink-0 text-leaf" aria-label="Selected in the request" /> : <span className="w-3.5 shrink-0" />}
                  <button type="button" className="min-w-0 truncate text-start hover:text-azure" onClick={() => can.viewTask(t) && dispatch({ type: 'openTask', id: t.id })}>{t.name}</button>
                  {m > 0 && <span className="num ms-auto shrink-0 text-muted-foreground">Work Log {h(m)}</span>}
                </li>
              ) : null
            })}
          </ul>
        </section>
      )}
      {r.files.length > 0 && (
        <ul className="flex flex-wrap gap-2">{r.files.map((f) => <li key={f.id}><a href={f.dataUrl} download={f.name} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] hover:bg-accent"><FileText className="h-3.5 w-3.5" />{f.name}<span className="num text-muted-foreground">{digits(fmtSize(f.size))}</span></a></li>)}</ul>
      )}
      <section>
        <h3 className="eyebrow mb-1.5">Category: History</h3>
        <ol className="flex flex-col gap-2 border-s ps-3">
          {r.steps.map((s, i) => (
            <li key={i} className="relative text-[12.5px]">
              <span className={cn('absolute -start-[17px] top-1 h-2 w-2 rounded-full', s.decision === 'reject' ? 'bg-destructive' : s.decision === 'approve' ? 'bg-leaf' : 'bg-foreground/40')} />
              <span className="font-medium">{stageFa[s.stage]}</span>
              {s.itStatus && <span className="ms-1.5">{STATUS_FA[s.itStatus]}</span>}
              {s.decision && <span className={cn('ms-1.5', s.decision === 'reject' ? 'text-destructive' : 'text-leaf-ink')}>{s.decision === 'approve' ? 'Approve' : 'Reject'}</span>}
              {s.minutes != null && <span className="num ms-1.5">({h(s.minutes)})</span>}
              <span className="ms-1.5 text-muted-foreground">{s.by === 'system' ? "System" : userById[s.by]?.name}, <span className="num">{d(s.at.slice(0, 10))} Hours {clock(s.at)}</span></span>
              {s.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{s.note}</p>}
            </li>
          ))}
        </ol>
      </section>

      {can.handleItRequest(r) && <section className="rounded-xl border p-3">
        <h3 className="mb-2 font-semibold">Project Control</h3>
        <Textarea aria-label="Review Note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Notes for the Applicant (optional)" />
        <div className="mt-2 flex flex-wrap gap-2">
          {r.status === 'pending_it' && <Button variant="outline" disabled={busy} onClick={() => void updateIt('it_in_progress')}>Start the investigation</Button>}
          <Button disabled={busy} onClick={() => void updateIt('it_resolved')}>Request Resolution Registration</Button>
        </div>
      </section>}
      {canDecide && (
        <section className="rounded-xl border border-azure/30 bg-azure-soft/30 p-3">
          <h3 className="mb-2 text-[13px] font-semibold">{r.status === 'pending_office' ? "Office Manager Review" : "Final decision of the CEO"}</h3>
          {r.kind === 'overtime' && (
            <div className="mb-2 flex items-center gap-2">
              <Label htmlFor="rq-dec-min" className="text-[12.5px]">Confirm value(min)</Label>
              <Input id="rq-dec-min" type="number" min={1} max={cap} dir="ltr" className="num h-8 w-24" value={mins} onChange={(e) => setMins(e.target.value)} />
              <span className="num text-[12px] text-muted-foreground">Max {h(cap)}The remaining is paid without</span>
            </div>
          )}
          <Textarea id="rq-dec-note" aria-label="Explain the decision" className="min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Description (Required for rejection)" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => decide('approve')}><Check className="h-4 w-4" /> {r.status === 'pending_office' ? "Confirmation and referral to the CEO" : 'Final Approval'}</Button>
            <Button variant="outline" className="text-destructive" onClick={() => decide('reject')}><X className="h-4 w-4" /> Reject</Button>
          </div>
        </section>
      )}
      {(canWithdraw || canCancel) && (
        <DialogFooter className="gap-2 sm:justify-start">
          {canWithdraw && <Button variant="outline" onClick={() => { dispatch({ type: 'reqWithdraw', id: r.id }); toast.success("Request was withdrawn"); onClose() }}><Undo2 className="h-4 w-4" /> Get back the request</Button>}
          {canCancel && <CancelLeave r={r} onDone={onClose} />}
        </DialogFooter>
      )}
    </>
  )
}

function CancelLeave({ r, onDone }: { r: AdminRequest; onDone: () => void }) {
  const { dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!open) return <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}><CircleSlash className="h-4 w-4" /> Cancel leave</Button>
  return (
    <div className="flex w-full flex-col gap-2">
      <Textarea aria-label="Reason for Cancellation" value={note} onChange={(e) => setNote(e.target.value)} placeholder="The reason for the cancellation of approved leave" className="min-h-[56px]" />
      <div className="flex gap-2">
        <Button variant="destructive" onClick={() => { if (!note.trim()) { toast.error("Write down the reason for cancellation."); return } dispatch({ type: 'reqCancel', id: r.id, note }); toast.success("Leave cancelled"); onDone() }}>Cancel leave</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}

// ---------- timesheet day ----------
export function DayDialog({ userId, date, onClose, onRequest }: { userId: string; date: string | null; onClose: () => void; onRequest: (p: RequestPreset) => void }) {
  return (
    <Dialog open={!!date} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent dir="ltr" className="thin-scroll max-h-[88vh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        {date && <DayDetail key={`${userId}|${date}`} userId={userId} date={date} onClose={onClose} onRequest={onRequest} />}
      </DialogContent>
    </Dialog>
  )
}

/** Why this person cannot edit this day (null = can edit) */
export function dayLock(state: ReturnType<typeof useStore>['state'], meId: string, canEditAll: boolean, userId: string, date: string): string | null {
  if (date > TODAY) return "Next day"
  if (isMonthClosed(state.monthCloses, date)) return "This month is closed."
  if (userId !== meId) return canEditAll ? null : "Only the Office Manager can edit another user's timesheet."
  const cfg = configFor(state.timesheetConfigs, date)
  if (diffDays(TODAY, date) > cfg.editDays) return `Only ${cfg.editDays} the previous day can be recorded; for this day, tell the administrator.`
  const reqs = overtimeIndex(state.adminRequests).get(dayKey(userId, date)) ?? []
  if (reqs.some((r) => isPending(r) || r.status === 'approved')) return "Overwork this day is in progress or confirmed; the day is locked."
  return null
}

function Figure({ label, v, tone }: { label: string; v: number; tone?: string }) {
  const h = useHM()
  return <div className="rounded-lg bg-background/50 px-2.5 py-1.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className={cn('num text-[14px] font-semibold', tone)}>{h(v)}</div></div>
}

function DayDetail({ userId, date, onClose, onRequest }: { userId: string; date: string; onClose: () => void; onRequest: (p: RequestPreset) => void }) {
  const { state, dispatch, me, can, userById } = useStore()
  const { dLong, d, digits, clock, n } = useFmt()
  const h = useHM()
  const holidays = useMemo(() => new Set(state.holidays.map((x) => x.date)), [state.holidays])
  const day: TimesheetDay | undefined = state.timesheets[dayKey(userId, date)]
  const cfg = configFor(state.timesheetConfigs, date)
  const off = isOffDay(date, holidays)
  const holiday = state.holidays.find((x) => x.date === date)
  const leaves = state.leaves.filter((l) => l.userId === userId && l.date === date)
  const reqs = state.adminRequests.filter((r) => r.userId === userId && ((r.overtime?.date === date) || (r.leave && leaveDates(r.leave, holidays).includes(date))))
  const otReqs = reqs.filter((r) => r.kind === 'overtime')
  const logs = activeLogs(state.workLogs).filter((l) => l.userId === userId && l.workDate === date)
  const logTotal = logs.reduce((s, l) => s + l.minutes, 0)
  const self = userId === me.id
  const lock = dayLock(state, me.id, can.perm('timesheet.edit.all'), userId, date)
  const closed = isMonthClosed(state.monthCloses, date)
  const [f, setF] = useState({ in: day?.checkIn ?? '', out: day?.checkOut ?? '', br: String(day?.breakMinutes ?? (off ? 0 : cfg.minBreakMinutes)), note: day?.note ?? '', reason: '' })
  const [showHist, setShowHist] = useState(false)
  const st = day ? otState(day.calc, otReqs) : 'none'
  const presence = presenceOf(f.in || undefined, f.out || undefined)

  const save = () => {
    const br = Number(f.br)
    if (f.in && !isHM(f.in)) { toast.error("Entry time is invalid."); return }
    if (f.out && !isHM(f.out)) { toast.error("The hour of departure is invalid."); return }
    if (!f.in && f.out) { toast.error("Enter the entry hour first."); return }
    if (!Number.isInteger(br) || br < 0 || (f.out && br >= presence)) { toast.error("The rest period is invalid."); return }
    if (!self && !f.reason.trim()) { toast.error("Write down the reason for the correction."); return }
    dispatch({ type: 'tsSave', userId, date, checkIn: f.in || undefined, checkOut: f.out || undefined, breakMinutes: br, note: f.note, reason: self ? undefined : f.reason })
    toast.success("Timesheet Saved")
  }
  return (
    <>
      <DialogHeader className="pe-8 text-start">
        <DialogTitle className="num">{WEEKDAYS[weekdayIndex(date)]} {dLong(date)}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-2">
          {!self && <span>{userById[userId]?.name}</span>}
          <span className={cn('rounded px-1.5 py-0.5 text-[11px]', off ? 'bg-secondary' : 'bg-azure-soft text-azure-ink')}>{holiday ? `Closing: ${holiday.title}` : off ? "Thursday / Friday (without hours)" : `Working day · ${h(day?.calc.duty ?? Math.max(0, cfg.dutyNetMinutes - Math.round(leaves.reduce((s, l) => s + l.hours, 0) * 60)))} net hours required`}</span>
          {leaves.map((l) => <span key={l.id} className="rounded bg-leaf-soft px-1.5 py-0.5 text-[11px] text-leaf-ink">{l.hours >= 8 ? "Daily leave" : `Leave ${h(Math.round(l.hours * 60))}`}</span>)}
          {closed && <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px]"><Lock className="h-3 w-3" /> Closed Moon</span>}
        </DialogDescription>
      </DialogHeader>

      {day && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Figure label="Presence" v={day.calc.presence} />
          <Figure label="Break" v={day.calc.breakMinutes} />
          <Figure label="Net Hours" v={day.calc.worked} />
          <Figure label="Scheduled" v={day.calc.duty} />
          <Figure label="Overtime" v={day.calc.excess} tone={day.calc.excess ? 'text-azure-ink' : undefined} />
          <Figure label="Operating fraction" v={day.calc.deficit} tone={day.calc.deficit ? 'text-destructive' : undefined} />
        </div>
      )}
      {day && day.calc.excess > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-[12px]">
          <OtChip state={st} minutes={day.calc.excess} />
          <span>Request: <b className="num">{h(day.calc.requested)}</b></span>
          <span>Approved: <b className="num">{h(day.calc.approved)}</b></span>
          <span>Waiting: <b className="num">{h(day.calc.pending)}</b></span>
          <span>No payment: <b className="num">{h(day.calc.unpaid)}</b></span>
          {day.calc.undecided > 0 && <span>Pending decision: <b className="num">{h(day.calc.undecided)}</b></span>}
        </div>
      )}
      {self && day && day.calc.undecided > 0 && !closed && (
        <section className="rounded-xl p-3 ring-1 ring-[var(--status-warning)]" style={{ background: 'color-mix(in srgb, var(--status-warning) 12%, transparent)' }}>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><AlertTriangle className="h-4 w-4" style={{ color: 'var(--status-warning)' }} /> {h(day.calc.undecided)} Overtime this day has not been determined</p>
          <p className="mt-1 text-[12px] text-muted-foreground">If you do not apply, it will be registered without payment by closing the month.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onRequest({ kind: 'overtime', date, minutes: overtimeAvailable(day.calc, otReqs), taskIds: [...new Set(logs.map((l) => l.taskId))] })}>Overtime Request</Button>
            <Button size="sm" variant="outline" onClick={() => { dispatch({ type: 'tsUnpaid', date }); toast.success("No payment recorded") }}>No payment</Button>
          </div>
        </section>
      )}

      {!lock ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><Label htmlFor="ts-in" className="eyebrow">Clock In</Label><Input id="ts-in" type="time" dir="ltr" className="num mt-1 h-9" value={f.in} onChange={(e) => setF({ ...f, in: e.target.value })} /></div>
          <div><Label htmlFor="ts-out" className="eyebrow">Sign out</Label><Input id="ts-out" type="time" dir="ltr" className="num mt-1 h-9" value={f.out} onChange={(e) => setF({ ...f, out: e.target.value })} /></div>
          <div><Label htmlFor="ts-break" className="eyebrow">Rest (min)</Label><Input id="ts-break" type="number" min={0} step={5} dir="ltr" className="num mt-1 h-9" value={f.br} onChange={(e) => setF({ ...f, br: e.target.value })} /></div>
          <div className="flex items-end text-[11.5px] leading-snug text-muted-foreground">{off ? "Closed Day: Rest the same amount as entered" : `At least ${digits(cfg.minBreakMinutes)} minutes will be deducted`}</div>
          <div className="col-span-2 sm:col-span-4"><Label htmlFor="ts-note" className="eyebrow">Description of the day</Label><Input id="ts-note" className="mt-1 h-9" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          {!self && <div className="col-span-2 sm:col-span-4"><Label htmlFor="ts-reason" className="eyebrow">Reason for correction (required)</Label><Input id="ts-reason" className="mt-1 h-9" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>}
          <div className="col-span-2 flex items-center gap-3 sm:col-span-4">
            <Button onClick={save}>Save</Button>
            {f.in && f.out && <span className="num text-[12px] text-muted-foreground">Presence {h(presence)}</span>}
          </div>
        </section>
      ) : day ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="h-3.5 w-3.5" /> {digits(day.checkIn ?? '—')} to {digits(day.checkOut ?? '—')}, break {n(day.breakMinutes)} minute{day.note ? `, ${day.note}` : ''} — {lock}</p>
      ) : <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Nothing is recorded for this day. {lock}</p>}

      {(logs.length > 0 || (day?.checkOut && logTotal > (day?.calc.worked ?? 0))) && (
        <section>
          <h3 className="eyebrow mb-1">Work Log This Day <span className="num">({h(logTotal)})</span></h3>
          {day?.checkOut && logTotal > day.calc.worked && <p className="mb-1 flex items-center gap-1.5 text-[12px] text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> Work Log is more than just timesheet work.</p>}
          {leaves.some((l) => l.hours >= 8) && logs.length > 0 && <p className="mb-1 flex items-center gap-1.5 text-[12px] text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> This day is a full vacation, but it has work log.</p>}
          <ul className="flex flex-col gap-0.5 text-[12.5px]">
            {logs.map((l) => { const t = state.tasks[l.taskId]; return <li key={l.id} className="flex items-center gap-2"><button type="button" className="min-w-0 truncate text-start hover:text-azure" onClick={() => t && can.viewTask(t) && dispatch({ type: 'openTask', id: t.id })}>{t?.name}</button><span className="num ms-auto shrink-0 text-muted-foreground">{h(l.minutes)}</span></li> })}
          </ul>
        </section>
      )}
      {reqs.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1">Requests for this day</h3>
          <ul className="flex flex-col gap-1 text-[12.5px]">{reqs.map((r) => <li key={r.id} className="flex items-center gap-2"><span className="num text-muted-foreground">#{digits(r.no)}</span>{KIND_FA[r.kind]}{r.overtime && <span className="num">{h(r.overtime.minutes)}</span>}<RequestStatusPill s={r.status} className="ms-auto" /></li>)}</ul>
        </section>
      )}
      {self && !off && !closed && !leaves.length && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => onRequest({ kind: 'leave', date })}>Leave for this day</Button>
      )}
      {day && day.revisions.length > 0 && (
        <section>
          <button type="button" className="eyebrow inline-flex items-center gap-1 hover:text-foreground" onClick={() => setShowHist(!showHist)} aria-expanded={showHist}><History className="h-3.5 w-3.5" /> History of Change ({digits(day.revisions.length)})</button>
          {showHist && (
            <ul className="mt-1 flex flex-col gap-1 text-[12px] text-muted-foreground">
              {[...day.revisions].reverse().map((v, i) => <li key={i} className="num">{d(v.at.slice(0, 10))} {clock(v.at)}, {userById[v.by]?.name}: {digits(v.checkIn ?? '—')} to {digits(v.checkOut ?? '—')}, break {digits(v.breakMinutes)}{v.reason ? ` Reason: ${v.reason}` : ''}</li>)}
            </ul>
          )}
        </section>
      )}
      <DialogFooter className="sm:justify-start"><Button variant="ghost" onClick={onClose}>Close</Button></DialogFooter>
    </>
  )
}
