import { TeamActivity } from '@/components/TeamActivity'
// Administrative module pages: my requests, timesheet, approver inbox, administrative reports.
import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck2, ChevronLeft, ChevronRight, Download, Inbox, LogIn, LogOut, Lock, Plus, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { requestSummary, useFmt, useStore } from '@/lib/store'
import { TODAY } from '@/lib/seed'
import { J_MONTHS, WEEKDAYS, WEEKDAYS_SHORT, addDays, rangeDays, tehranTime, toJalali, weekdayIndex } from '@/lib/jalali'
import {
  approverStats, configFor, dayKey, hm, isMonthClosed, isOffDay, isPending, jMonthKey, KIND_FA, leaveDates, monthRange, nextMonthKey, OT_FA, otState, overtimeIndex, overtimeSummary,
  prevMonthKey, STATUS_FA, toCSV, workSummary, type Bucket,
} from '@/lib/admin'
import type { AdminRequest, AdminRequestKind, AdminRequestStatus, TimesheetDay } from '@/lib/types'
import { Empty, Initials, JalaliDateField, PageHeader, Segmented } from '@/components/common'
import { UserSelect } from '@/components/FlowViews'
import { DayDialog, NewRequestDialog, OtChip, RequestDialog, RequestRow, RequestStatusPill, useHM, type RequestPreset } from '@/components/AdminViews'

// ---------- file export (the viewer confirms each save) ----------
type DownloadsNs = { save: (r: { filename: string; data: string }) => Promise<unknown> } | null
let downloadsNs: Promise<DownloadsNs> | null = null
async function saveCSV(filename: string, csv: string) {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude
  if (c?.use) {
    downloadsNs ??= c.use('downloads') as Promise<DownloadsNs>
    const dl = await downloadsNs
    if (!dl) { toast.error("File storage is not available in this view."); return }
    try { await dl.save({ filename, data: csv }) } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== 'declined') toast.error(code === 'rate_limited' ? "An open storage request; try again a little later." : "The file was not saved.")
    }
    return
  }
  // opened outside Claude (local preview): an ordinary browser download
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
function CsvButton({ name, head, rows }: { name: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <Button variant="outline" size="sm" className="h-8" disabled={!rows.length} onClick={() => saveCSV(`${name}-${TODAY}.csv`, toCSV(head, rows))}>
      <Download className="h-3.5 w-3.5" /> Excel (CSV)
    </Button>
  )
}

// ---------- my requests ----------
export function RequestsPage() {
  const { state, me } = useStore()
  const { n } = useFmt()
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all')
  const [newOpen, setNewOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(state.nav.requestId ?? null)
  const mine = state.adminRequests.filter((r) => r.userId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const list = mine.filter((r) => filter === 'all' || (filter === 'open' ? isPending(r) : !isPending(r)))
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Office" title="My Requests" actions={<Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New Request</Button>}>
        Leaves, overtime and other administrative requests are checked on the office card. Problems and IT requests are referred to project control.
      </PageHeader>
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: `All (${n(mine.length)})` }, { value: 'open', label: `In Progress (${n(mine.filter(isPending).length)})` }, { value: 'done', label: "Ended" },
      ]} />
      <section className="overflow-hidden glass-card">
        {list.length ? list.map((r) => <RequestRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)
          : <div className="p-4"><Empty title={mine.length ? "No request for this filter" : "You have not filed a request yet"} hint="Start with the “New Request” button or the Timesheet calendar." /></div>}
      </section>
      <NewRequestDialog open={newOpen} onOpenChange={setNewOpen} />
      <RequestDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

// ---------- approver inbox ----------
export function InboxPage() {
  const { state, me, can } = useStore()
  const { n } = useFmt()
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const [openId, setOpenId] = useState<string | null>(state.nav.requestId ?? null)
  const itInbox = can.perm('requests.it')
  const pending = state.adminRequests.filter((r) => can.handleItRequest(r) || can.decideRequest(r)).sort((a, b) => a.stageSince.localeCompare(b.stageSince))
  const done = state.adminRequests.filter((r) => itInbox && r.kind === 'it' && !isPending(r) || r.steps.some((s) => (s.stage === 'office' || s.stage === 'ceo' || s.stage === 'cancel') && s.by === me.id))
    .sort((a, b) => b.stageSince.localeCompare(a.stageSince))
  const stage = can.perm('requests.office') ? 'Office Manager' : 'CEO'
  const list = tab === 'pending' ? pending : done
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Office" title="Inbox">
        {itInbox ? "IT requests to track and update the situation." : <>Requests waiting for decision {stage} They are. {can.perm('requests.office') ? "Your confirmation takes the request to the CEO’s cartel; rejection ends the process." : "Your decision is final and will be announced to the applicant."} The oldest request is the first.</>}
      </PageHeader>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'pending', label: `Awaiting your action (${n(pending.length)})` }, { value: 'done', label: `Processed (${n(done.length)})` }]} />
      <section className="overflow-hidden glass-card">
        {list.length ? list.map((r) => <RequestRow key={r.id} r={r} showUser onOpen={() => setOpenId(r.id)} />)
          : <div className="p-4"><Empty icon={<Inbox className="h-6 w-6" />} title={tab === 'pending' ? "Carable is empty" : "You have not yet checked the request"} /></div>}
      </section>
      <RequestDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

// ---------- timesheet ----------
export function TimesheetPage() {
  const { state, dispatch, me, can, activeUsers } = useStore()
  const { digits, n, dLong } = useFmt()
  const h = useHM()
  const viewAll = can.perm('timesheet.view.all')
  const [userId, setUserId] = useState(state.nav.userId && can.seeTimesheet(state.nav.userId) ? state.nav.userId : me.id)
  const [month, setMonth] = useState(jMonthKey(state.nav.date ?? TODAY))
  const [dayOpen, setDayOpen] = useState<string | null>(state.nav.date ?? null)
  const [preset, setPreset] = useState<RequestPreset | undefined>()
  const [reqOpen, setReqOpen] = useState(false)
  const self = userId === me.id
  const holidays = useMemo(() => new Set(state.holidays.map((x) => x.date)), [state.holidays])
  const { from, to } = monthRange(month)
  const closed = state.monthCloses.find((c) => c.month === month)
  const days = useMemo(() => {
    const m = new Map<string, TimesheetDay>()
    for (const d of Object.values(state.timesheets)) if (d.userId === userId && d.date >= from && d.date <= to) m.set(d.date, d)
    return m
  }, [state.timesheets, userId, from, to])
  const leaves = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of state.leaves) if (l.userId === userId && l.date >= from && l.date <= to) m.set(l.date, (m.get(l.date) ?? 0) + l.hours)
    return m
  }, [state.leaves, userId, from, to])
  const ot = useMemo(() => overtimeIndex(state.adminRequests), [state.adminRequests])
  const today = state.timesheets[dayKey(me.id, TODAY)]
  const undecided = Object.values(state.timesheets).filter((d) => d.userId === me.id && d.calc.undecided > 0).sort((a, b) => b.date.localeCompare(a.date))
  const list = [...days.values()]
  const sum = (f: (d: TimesheetDay) => number) => list.reduce((s, d) => s + f(d), 0)
  const workdaysSoFar = rangeDays(from, to < TODAY ? to : addDays(TODAY, -1)).filter((d) => !isOffDay(d, holidays))
  const missing = workdaysSoFar.filter((d) => !days.has(d) && (leaves.get(d) ?? 0) < 8).length
  const j = toJalali(from)
  const lead = weekdayIndex(from)
  const cells: (string | null)[] = [...Array(lead).fill(null), ...rangeDays(from, to)]
  const openRequest = (p: RequestPreset) => { setPreset(p); setDayOpen(null); setReqOpen(true) }

  if (!can.seeTimesheet(userId)) return <Empty title="Everyone's time sheet is just for themselves" />
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Office" title="Timesheet"
        actions={viewAll ? <div className="w-[220px]"><UserSelect id="ts-user" value={userId} onChange={(v) => setUserId(v ?? me.id)} users={activeUsers} grouped /></div> : undefined}>
        Every working day is 8 hours of pure work plus at least 30 minutes of rest and lunch. Work is more than that of overtime and must be determined: Overtime or no-payment application. On Thursday, Friday and holidays are all overtime work.
      </PageHeader>

      {self && (
        <section className="glass-card flex flex-wrap items-center gap-3 p-4" aria-label="Today">
          <div className="min-w-0 flex-1">
            <div className="eyebrow">Today, {WEEKDAYS[weekdayIndex(TODAY)]} {dLong(TODAY)}</div>
            <div className="mt-0.5 text-[14px] font-semibold">
              {!today?.checkIn ? "No clock-in recorded today." : !today.checkOut ? <>from <span className="num">{digits(today.checkIn)}</span> · In the office</> : <>Clock In <span className="num">{digits(today.checkIn)}</span>, clock-out <span className="num">{digits(today.checkOut)}</span> · Net work <span className="num">{h(today.calc.worked)}</span></>}
            </div>
          </div>
          {!today?.checkIn && <Button onClick={() => { dispatch({ type: 'tsPunch', kind: 'in' }); toast.success(`Login ${digits(tehranTime())} Registered`) }}><LogIn className="h-4 w-4" /> Clock In</Button>}
          {today?.checkIn && !today.checkOut && <Button onClick={() => { dispatch({ type: 'tsPunch', kind: 'out' }); toast.success(`Exit ${digits(tehranTime())} Registered`) }}><LogOut className="h-4 w-4" /> Clock Out</Button>}
          <Button variant="ghost" onClick={() => setDayOpen(TODAY)}>Manual editing</Button>
        </section>
      )}

      {self && undecided.length > 0 && (
        <section className="glass-card p-4 ring-1 ring-[var(--status-warning)]" aria-label="Overtime without assignment">
          <h2 className="flex items-center gap-1.5 text-[14px] font-bold"><AlertTriangle className="h-4 w-4" style={{ color: 'var(--status-warning)' }} /> {n(undecided.length)} Overtime day is not determined</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Apply for an overtime application for each day or leave it without payment. By closing the month, the remainder will be recorded without payment.</p>
          <ul className="mt-2 flex flex-col divide-y">
            {undecided.slice(0, 8).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <button type="button" className="num text-[13px] hover:text-azure" onClick={() => { setMonth(jMonthKey(d.date)); setDayOpen(d.date) }}>{WEEKDAYS[weekdayIndex(d.date)]} {dLong(d.date)}</button>
                <span className="num rounded-full bg-[var(--status-warning)]/25 px-2 text-[12px] font-semibold">{h(d.calc.undecided)}</span>
                <span className="ms-auto flex gap-1.5">
                  <Button size="sm" className="h-7" onClick={() => openRequest({ kind: 'overtime', date: d.date, minutes: d.calc.undecided, taskIds: [...new Set(state.workLogs.filter((l) => !l.deletedAt && l.userId === me.id && l.workDate === d.date).map((l) => l.taskId))] })}>Overtime Request</Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => { dispatch({ type: 'tsUnpaid', date: d.date }); toast.success("No request for leave has been filed") }}>No leave request</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="key key-ghost rounded-full p-1.5" onClick={() => setMonth(prevMonthKey(month))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <h2 className="num min-w-[110px] text-center text-[15px] font-bold">{J_MONTHS[j.jm - 1]} {digits(j.jy)}</h2>
          <button type="button" className="key key-ghost rounded-full p-1.5" onClick={() => setMonth(nextMonthKey(month))} aria-label="Next month" disabled={from > TODAY}><ChevronRight className="h-4 w-4" /></button>
          {month !== jMonthKey(TODAY) && <Button variant="ghost" size="sm" className="h-7" onClick={() => setMonth(jMonthKey(TODAY))}>This month</Button>}
          {closed && <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11.5px]"><Lock className="h-3 w-3" /> Closed</span>}
          {!self && <span className="ms-auto text-[12.5px] font-medium">{state.users.find((u) => u.id === userId)?.name}</span>}
        </div>
        <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[
            ['Net Hours', h(sum((d) => d.calc.worked))], ['Scheduled', h(sum((d) => d.calc.duty))], ['Overtime', h(sum((d) => d.calc.excess))], ["Approved", h(sum((d) => d.calc.approved))],
            ['Pending', h(sum((d) => d.calc.pending))], ["No payment", h(sum((d) => d.calc.unpaid))], ["No assignment", h(sum((d) => d.calc.undecided))], ["Operating fraction", h(sum((d) => d.calc.deficit))],
          ].map(([k, v]) => <div key={k} className="rounded-lg bg-background/50 px-2.5 py-1.5"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="num text-[15px] font-semibold">{v}</dd></div>)}
        </dl>
        {missing > 0 && <p className="mb-2 text-[12px] text-muted-foreground">{n(missing)} The last working day of this month is without registration and departure.</p>}
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground" aria-hidden="true">
          {WEEKDAYS_SHORT.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Time Sheet Calendar">
          {cells.map((c, i) => {
            if (!c) return <div key={i} />
            const d = days.get(c)
            const off = isOffDay(c, holidays)
            const lv = leaves.get(c) ?? 0
            const st = d ? otState(d.calc, ot.get(d.id) ?? []) : 'none'
            const future = c > TODAY
            return (
              <button key={c} type="button" role="gridcell" onClick={() => setDayOpen(c)} disabled={future && !self}
                aria-label={`${WEEKDAYS[weekdayIndex(c)]} ${dLong(c)}${d?.checkIn ? `, Login ${d.checkIn}` : ''}${d?.checkOut ? `, Exit ${d.checkOut}, Net Work ${hm(d.calc.worked)}` : ''}${lv ? "the Holidays" : ''}${st !== 'none' ? `, Overtime ${OT_FA[st]}` : ''}`}
                className={cn('flex min-h-[54px] flex-col items-stretch gap-0.5 rounded-lg border p-1 text-start text-[11px] transition-colors hover:border-azure/50 sm:min-h-[88px] sm:p-1.5',
                  off ? 'bg-foreground/[0.04]' : 'bg-background/50', c === TODAY && 'ring-2 ring-azure', future && 'opacity-60')}>
                <span className="flex items-center justify-between gap-1">
                  <span className={cn('num text-[12px] font-semibold', off && 'text-muted-foreground')}>{digits(toJalali(c).jd)}</span>
                  {lv > 0 && <>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-leaf sm:hidden" aria-hidden="true" />
                    <span className="hidden rounded bg-leaf-soft px-1 text-[10px] text-leaf-ink sm:inline">{lv >= 8 ? 'Leave' : <span className="num">Â·Â¢ÂÂ¬ÂâÂ¦ÂÃ¢ââ€Â®Â°ÂàÂîÂìÂ {h(Math.round(lv * 60))}</span>}</span>
                  </>}
                </span>
                {d?.checkIn && <span className="num hidden truncate text-muted-foreground sm:block" dir="ltr">{digits(d.checkIn)}–{digits(d.checkOut ?? '…')}</span>}
                {d?.checkOut && <span className="num hidden font-medium sm:block">{h(d.calc.worked)}</span>}
                {st !== 'none' && <OtChip state={st} minutes={d!.calc.excess} className="self-start" />}
                {d && d.calc.deficit > 0 && <span className="num hidden text-destructive sm:block">−{h(d.calc.deficit)}</span>}
                {!d && !off && !future && lv < 8 && <span className="hidden text-muted-foreground/70 sm:block">Unregistered</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground" aria-label="Guides">
          {(['undecided', 'pending', 'approved', 'unpaid'] as const).map((s) => <span key={s} className="inline-flex items-center gap-1.5"><OtChip state={s} minutes={60} />{OT_FA[s]}</span>)}
          <span className="inline-flex items-center gap-1.5"><span className="rounded bg-leaf-soft px-1 text-[10px] text-leaf-ink">Leave</span> Approved Leave</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-foreground/[0.08]" /> Thursday, Friday and Holiday</span>
        </div>
      </section>

      <DayDialog userId={userId} date={dayOpen} onClose={() => setDayOpen(null)} onRequest={openRequest} />
      <NewRequestDialog open={reqOpen} onOpenChange={setReqOpen} preset={preset} />
    </div>
  )
}

// ---------- administrative reports ----------
type Tab = 'attendance' | 'hours' | 'overtime' | 'requests' | 'handling' | 'ops'
const REQ_KIND_ALL = 'all'

export function AdminReportsPage() {
  const { state, can, activeUsers, teamById, userById } = useStore()
  const { d, digits, n, time } = useFmt()
  const h = useHM()
  const [tab, setTab] = useState<Tab | 'activity'>('activity')
  const [f, setF] = useState({ team: 'all', user: 'all', from: monthRange(jMonthKey(TODAY)).from as string | undefined, to: TODAY as string | undefined, kind: REQ_KIND_ALL as AdminRequestKind | 'all', status: 'all' as AdminRequestStatus | 'all' })
  const [by, setBy] = useState<Bucket>('week')
  const [limit, setLimit] = useState(200)
  const [openId, setOpenId] = useState<string | null>(null)
  const [dayOpen, setDayOpen] = useState<{ userId: string; date: string } | null>(null)
  const holidays = useMemo(() => new Set(state.holidays.map((x) => x.date)), [state.holidays])
  if (!can.perm('admin.reports')) return <Empty icon={<Lock className="h-6 w-6" />} title="Office reports are available to the CEO, Project Controls and the Office Manager." />

  const userOk = (uid: string) => (f.user === 'all' || uid === f.user) && (f.team === 'all' || userById[uid]?.teamId === f.team)
  const dateOk = (x: string) => (!f.from || x >= f.from) && (!f.to || x <= f.to)
  const days = Object.values(state.timesheets).filter((x) => userOk(x.userId) && dateOk(x.date)).sort((a, b) => b.date.localeCompare(a.date) || (userById[a.userId]?.name ?? '').localeCompare(userById[b.userId]?.name ?? ''))
  const ot = overtimeIndex(state.adminRequests)
  const reqDate = (r: AdminRequest) => r.overtime?.date ?? r.leave?.from ?? r.other?.date ?? r.createdAt.slice(0, 10)
  const reqs = state.adminRequests.filter((r) => userOk(r.userId) && dateOk(reqDate(r)) && (f.kind === 'all' || r.kind === f.kind) && (f.status === 'all' || r.status === f.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const name = (uid: string) => userById[uid]?.name ?? ''
  const tabs: { value: Tab | 'activity'; label: string }[] = [
    { value: 'activity', label: 'Team Activity' },
    { value: 'attendance', label: 'Clock In and Out' }, { value: 'hours', label: 'Worked Hours' }, { value: 'overtime', label: 'Overtime' },
    { value: 'requests', label: 'Requests' }, { value: 'handling', label: 'Processing' }, ...(can.perm('timesheet.close') ? [{ value: 'ops' as Tab, label: 'Office Operations' }] : []),
  ]
  const th = (labels: string[]) => <thead className="border-b bg-foreground/[0.03] text-[11px] text-muted-foreground"><tr>{labels.map((x) => <th key={x} className="whitespace-nowrap px-3 py-2 text-start font-medium">{x}</th>)}</tr></thead>
  const td = 'whitespace-nowrap px-3 py-1.5'

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Office" title="Office Reports">
        Team assignments, attendance, worked hours, overtime and requests. Closed months show the figures recorded at closing.
      </PageHeader>
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Filters">
        <div><Label htmlFor="ar-team" className="eyebrow">Department</Label>
          <Select value={f.team} onValueChange={(v) => setF({ ...f, team: v, user: 'all' })}><SelectTrigger id="ar-team" className="mt-1 h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Departments</SelectItem>{state.teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label htmlFor="ar-user" className="eyebrow">User</Label>
          <Select value={f.user} onValueChange={(v) => setF({ ...f, user: v })}><SelectTrigger id="ar-user" className="mt-1 h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72"><SelectItem value="all">All Users</SelectItem>{activeUsers.filter((u) => f.team === 'all' || u.teamId === f.team).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select></div>
        {tab !== 'activity' && <><div><Label htmlFor="ar-from" className="eyebrow">From</Label><div className="mt-1 w-[140px]"><JalaliDateField id="ar-from" value={f.from} onChange={(v) => setF({ ...f, from: v })} placeholder="Start date" /></div></div>
        <div><Label htmlFor="ar-to" className="eyebrow">To</Label><div className="mt-1 w-[140px]"><JalaliDateField id="ar-to" value={f.to} onChange={(v) => setF({ ...f, to: v })} placeholder="Today" /></div></div></>}
        {(tab === 'requests' || tab === 'handling') && <>
          <div><Label htmlFor="ar-kind" className="eyebrow">Request Type</Label>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as AdminRequestKind | 'all' })}><SelectTrigger id="ar-kind" className="mt-1 h-9 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{(Object.keys(KIND_FA) as AdminRequestKind[]).map((k) => <SelectItem key={k} value={k}>{KIND_FA[k]}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="ar-status" className="eyebrow">Status</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as AdminRequestStatus | 'all' })}><SelectTrigger id="ar-status" className="mt-1 h-9 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{(Object.keys(STATUS_FA) as AdminRequestStatus[]).map((k) => <SelectItem key={k} value={k}>{STATUS_FA[k]}</SelectItem>)}</SelectContent></Select></div>
        </>}
      </div>
      <Segmented value={tab} onChange={(v) => { setTab(v); setLimit(200) }} compact options={tabs} />

      {tab === 'activity' && <TeamActivity teamId={f.team !== 'all' ? f.team : undefined} userId={f.user !== 'all' ? f.user : undefined} />}
      {tab === 'attendance' && (
        <section className="overflow-hidden glass-card">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
            <h2 className="text-[14px] font-bold">Daily Attendance</h2><span className="num text-[12px] text-muted-foreground">{n(days.length)} Recorded Day</span>
            <span className="ms-auto"><CsvButton name="attendance" head={['Date', 'User', 'Department', 'Clock In', 'Sign out', 'Break', 'Net Hours', 'Scheduled', 'Overtime', 'Overtime Status', 'Deficit', 'Description']}
              rows={days.map((x) => [d(x.date), name(x.userId), teamById[userById[x.userId]?.teamId ?? '']?.name ?? '', x.checkIn ?? '', x.checkOut ?? '', hm(x.calc.breakMinutes), hm(x.calc.worked), hm(x.calc.duty), hm(x.calc.excess), OT_FA[otState(x.calc, ot.get(x.id) ?? [])], hm(x.calc.deficit), x.note ?? ''])} /></span>
          </header>
          {days.length ? (
            <div className="scroll-x thin-scroll"><table className="w-full min-w-[920px] text-[12.5px]">
              {th(['Date', 'User', 'Clock In', 'Sign out', 'Break', 'Net Hours', 'Scheduled', 'Overtime', 'Deficit', 'Description'])}
              <tbody>{days.slice(0, limit).map((x) => (
                <tr key={x.id} className="cursor-pointer border-b last:border-0 hover:bg-foreground/[0.035]" onClick={() => setDayOpen({ userId: x.userId, date: x.date })}>
                  <td className={cn(td, 'num')}>{WEEKDAYS_SHORT[weekdayIndex(x.date)]} {d(x.date)}</td>
                  <td className={td}><span className="flex items-center gap-1.5"><Initials user={userById[x.userId]} size={20} />{name(x.userId)}</span></td>
                  <td className={cn(td, 'num')}>{digits(x.checkIn ?? '—')}</td><td className={cn(td, 'num')}>{digits(x.checkOut ?? '—')}</td>
                  <td className={cn(td, 'num')}>{h(x.calc.breakMinutes)}</td><td className={cn(td, 'num font-medium')}>{h(x.calc.worked)}</td><td className={cn(td, 'num text-muted-foreground')}>{h(x.calc.duty)}</td>
                  <td className={td}><OtChip state={otState(x.calc, ot.get(x.id) ?? [])} minutes={x.calc.excess} /></td>
                  <td className={cn(td, 'num', x.calc.deficit && 'text-destructive')}>{x.calc.deficit ? h(x.calc.deficit) : '—'}</td>
                  <td className="max-w-[200px] truncate px-3 py-1.5 text-muted-foreground">{x.note}</td>
                </tr>))}</tbody>
            </table></div>
          ) : <div className="p-4"><Empty title="One day it is not registered with these filters" /></div>}
          {days.length > limit && <div className="border-t p-2 text-center"><Button variant="ghost" size="sm" onClick={() => setLimit(limit + 300)}>Show {n(Math.min(300, days.length - limit))} Other Rows</Button></div>}
        </section>
      )}

      {tab === 'hours' && (() => {
        const rows = workSummary(days, by)
        const label = (k: string) => (by === 'month' ? `${J_MONTHS[Number(k.slice(5)) - 1]} ${digits(k.slice(0, 4))}` : by === 'week' ? `Week ${d(k)}` : `${WEEKDAYS_SHORT[weekdayIndex(k)]} ${d(k)}`)
        return (
          <section className="overflow-hidden glass-card">
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <h2 className="text-[14px] font-bold">Worked Hours</h2>
              <Segmented size="sm" value={by} onChange={setBy} options={[{ value: 'day', label: "Daily" }, { value: 'week', label: "Weekly" }, { value: 'month', label: "Monthly" }]} />
              <span className="ms-auto"><CsvButton name={`hours-${by}`} head={["Category: Course", 'User', "Workday", 'Net Hours', 'Scheduled', 'Deficit', 'Overtime', 'Leave']}
                rows={rows.map((r) => [by === 'month' ? r.key : d(r.key), name(r.userId), r.days, hm(r.worked), hm(r.duty), hm(r.deficit), hm(r.excess), hm(r.leave)])} /></span>
            </header>
            {rows.length ? (
              <div className="scroll-x thin-scroll"><table className="w-full min-w-[760px] text-[12.5px]">
                {th(["Category: Course", 'User', "Workday", 'Net Hours', 'Scheduled', "Operating fraction", 'Overtime', 'Leave'])}
                <tbody>{rows.slice(0, limit).map((r) => (
                  <tr key={`${r.userId}|${r.key}`} className="border-b last:border-0">
                    <td className={cn(td, 'num')}>{label(r.key)}</td><td className={td}>{name(r.userId)}</td><td className={cn(td, 'num')}>{n(r.days)}</td>
                    <td className={cn(td, 'num font-medium')}>{h(r.worked)}</td><td className={cn(td, 'num text-muted-foreground')}>{h(r.duty)}</td>
                    <td className={cn(td, 'num', r.deficit && 'text-destructive')}>{r.deficit ? h(r.deficit) : '—'}</td><td className={cn(td, 'num')}>{r.excess ? h(r.excess) : '—'}</td><td className={cn(td, 'num')}>{r.leave ? h(r.leave) : '—'}</td>
                  </tr>))}</tbody>
              </table></div>
            ) : <div className="p-4"><Empty title="No data with these filters" /></div>}
            {rows.length > limit && <div className="border-t p-2 text-center"><Button variant="ghost" size="sm" onClick={() => setLimit(limit + 300)}>View More Rows</Button></div>}
          </section>
        )
      })()}

      {tab === 'overtime' && (() => {
        const rows = overtimeSummary(days)
        const t = rows.reduce((a, r) => ({ excess: a.excess + r.excess, approved: a.approved + r.approved, pending: a.pending + r.pending, unpaid: a.unpaid + r.unpaid, undecided: a.undecided + r.undecided, offDay: a.offDay + r.offDay, requested: a.requested + r.requested }), { excess: 0, approved: 0, pending: 0, unpaid: 0, undecided: 0, offDay: 0, requested: 0 })
        return (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {[["Total Overtime", t.excess], ["Request", t.requested], ["Approved and payable", t.approved], ['In Review', t.pending], ["No payment", t.unpaid], ["No assignment", t.undecided], ["On the closed day", t.offDay]]
                .map(([k, v]) => <div key={k as string} className="glass-card px-3 py-2"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="num text-[17px] font-bold">{h(v as number)}</dd></div>)}
            </dl>
            <section className="overflow-hidden glass-card">
              <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                <h2 className="text-[14px] font-bold">Overtime of each user</h2>
                <span className="text-[12px] text-muted-foreground">Actual function, request, confirmed and unpaid are kept separate</span>
                <span className="ms-auto"><CsvButton name="overtime" head={['User', 'Department', "Days", "General", "Closed Day", "Request", "Approved (payable)", 'Pending', "No payment", "No assignment"]}
                  rows={rows.map((r) => [name(r.userId), teamById[userById[r.userId]?.teamId ?? '']?.name ?? '', r.days, hm(r.excess), hm(r.offDay), hm(r.requested), hm(r.approved), hm(r.pending), hm(r.unpaid), hm(r.undecided)])} /></span>
              </header>
              {rows.length ? (
                <div className="scroll-x thin-scroll"><table className="w-full min-w-[880px] text-[12.5px]">
                  {th(['User', "Days", "General", "Closed Day", "Request", "Approved (payable)", 'Pending', "No payment", "No assignment"])}
                  <tbody>{rows.map((r) => (
                    <tr key={r.userId} className="cursor-pointer border-b last:border-0 hover:bg-foreground/[0.035]" onClick={() => setF({ ...f, user: r.userId })} title="Filter on this user">
                      <td className={td}><span className="flex items-center gap-1.5"><Initials user={userById[r.userId]} size={20} />{name(r.userId)}</span></td>
                      <td className={cn(td, 'num')}>{n(r.days)}</td><td className={cn(td, 'num font-semibold')}>{h(r.excess)}</td><td className={cn(td, 'num')}>{r.offDay ? h(r.offDay) : '—'}</td>
                      <td className={cn(td, 'num')}>{r.requested ? h(r.requested) : '—'}</td><td className={cn(td, 'num font-medium text-leaf-ink')}>{r.approved ? h(r.approved) : '—'}</td><td className={cn(td, 'num')}>{r.pending ? h(r.pending) : '—'}</td>
                      <td className={cn(td, 'num text-muted-foreground')}>{r.unpaid ? h(r.unpaid) : '—'}</td><td className={cn(td, 'num')}>{r.undecided ? h(r.undecided) : '—'}</td>
                    </tr>))}</tbody>
                </table></div>
              ) : <div className="p-4"><Empty title="There's nothing over there" /></div>}
            </section>
          </>
        )
      })()}

      {tab === 'requests' && (() => {
        const counts = (Object.keys(STATUS_FA) as AdminRequestStatus[]).map((s) => [s, reqs.filter((r) => r.status === s).length] as const)
        return (
          <>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(KIND_FA) as AdminRequestKind[]).filter((k) => f.kind === 'all' || f.kind === k).map((k) => {
                const list = reqs.filter((r) => r.kind === k)
                return <div key={k} className="glass-card px-3 py-2 text-[12px]"><div className="text-[13px] font-semibold">{KIND_FA[k]} <span className="num text-muted-foreground">({n(list.length)})</span></div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">{(Object.keys(STATUS_FA) as AdminRequestStatus[]).map((s) => { const c = list.filter((r) => r.status === s).length; return c ? <span key={s}>{STATUS_FA[s]}: <b className="num text-foreground">{n(c)}</b></span> : null })}</div></div>
              })}
            </div>
            <section className="overflow-hidden glass-card">
              <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                <h2 className="text-[14px] font-bold">Requests</h2><span className="num text-[12px] text-muted-foreground">{counts.filter(([, c]) => c).map(([s, c]) => `${STATUS_FA[s]} ${digits(c)}`).join(', ')}</span>
                <span className="ms-auto"><CsvButton name="requests" head={["No", 'Type', 'User', 'Description', "Registration date", 'Status', 'Office Manager', 'CEO', 'Description']}
                  rows={reqs.map((r) => { const o = r.steps.find((s) => s.stage === 'office'), c = r.steps.find((s) => s.stage === 'ceo'); return [r.no, KIND_FA[r.kind], name(r.userId), requestSummary(r, holidays), d(r.createdAt.slice(0, 10)), STATUS_FA[r.status], o ? `${o.decision === 'approve' ? 'Approve' : 'Reject'} ${d(o.at.slice(0, 10))}` : '', c ? `${c.decision === 'approve' ? 'Approve' : 'Reject'} ${d(c.at.slice(0, 10))}` : '', r.description] })} /></span>
              </header>
              {reqs.length ? (
                <div className="scroll-x thin-scroll"><table className="w-full min-w-[820px] text-[12.5px]">
                  {th(['#', 'Type', 'User', 'Description', 'Submit', 'Status'])}
                  <tbody>{reqs.slice(0, limit).map((r) => (
                    <tr key={r.id} className="cursor-pointer border-b last:border-0 hover:bg-foreground/[0.035]" onClick={() => setOpenId(r.id)}>
                      <td className={cn(td, 'num text-muted-foreground')}>{digits(r.no)}</td><td className={td}>{KIND_FA[r.kind]}</td><td className={td}>{name(r.userId)}</td>
                      <td className="max-w-[320px] truncate px-3 py-1.5">{requestSummary(r, holidays)}</td><td className={cn(td, 'text-muted-foreground')}>{time(r.createdAt)}</td><td className={td}><RequestStatusPill s={r.status} /></td>
                    </tr>))}</tbody>
                </table></div>
              ) : <div className="p-4"><Empty title="No request with these filters" /></div>}
            </section>
          </>
        )
      })()}

      {tab === 'handling' && (() => {
        const st = approverStats(reqs, new Date().toISOString())
        const waiting = reqs.filter(isPending).sort((a, b) => a.stageSince.localeCompare(b.stageSince))
        const hrs = (x: number | null) => (x == null ? '—' : x < 24 ? `${n(x, 1)} Hours` : `${n(x / 24, 1)} Day`)
        return (
          <section className="overflow-hidden glass-card">
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <h2 className="text-[14px] font-bold">Administrative Manager and Director</h2>
              <span className="ms-auto"><CsvButton name="handling" head={['Stage', "It's done", 'Approve', 'Reject', "Average response time (hour)", 'Pending', "The oldest wait (hour)"]}
                rows={st.map((s) => [s.stage === 'office' ? 'Office Manager' : 'CEO', s.handled, s.approved, s.rejected, s.avgHours == null ? '' : s.avgHours.toFixed(1), s.pending, s.oldestHours == null ? '' : s.oldestHours.toFixed(1)])} /></span>
            </header>
            <div className="scroll-x thin-scroll"><table className="w-full min-w-[720px] text-[12.5px]">
              {th(['Stage', "It's done", 'Approve', 'Reject', "Average response time", "Now waiting", "The oldest expectation"])}
              <tbody>{st.map((s) => (
                <tr key={s.stage} className="border-b last:border-0">
                  <td className={cn(td, 'font-medium')}>{s.stage === 'office' ? 'Office Manager' : 'CEO'}</td><td className={cn(td, 'num')}>{n(s.handled)}</td><td className={cn(td, 'num')}>{n(s.approved)}</td><td className={cn(td, 'num')}>{n(s.rejected)}</td>
                  <td className={cn(td, 'num')}>{hrs(s.avgHours)}</td><td className={cn(td, 'num', s.pending && 'font-semibold')}>{n(s.pending)}</td><td className={cn(td, 'num', (s.oldestHours ?? 0) > 72 && 'text-destructive')}>{hrs(s.oldestHours)}</td>
                </tr>))}</tbody>
            </table></div>
            <h3 className="border-t px-4 pb-1 pt-3 text-[13px] font-semibold">the Carables</h3>
            {waiting.length ? waiting.map((r) => (
              <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center gap-2 border-t px-4 py-2 text-start text-[12.5px] hover:bg-foreground/[0.035]">
                <span className="num text-muted-foreground">#{digits(r.no)}</span>{KIND_FA[r.kind]}<span>{name(r.userId)}</span><RequestStatusPill s={r.status} /><span className="ms-auto text-muted-foreground">Waiting from {time(r.stageSince)}</span>
              </button>
            )) : <p className="px-4 pb-3 text-[12.5px] text-muted-foreground">There is no demand waiting.</p>}
          </section>
        )
      })()}

      {tab === 'ops' && <OfficeOps />}

      <RequestDialog id={openId} onClose={() => setOpenId(null)} />
      {dayOpen && <DayDialog userId={dayOpen.userId} date={dayOpen.date} onClose={() => setDayOpen(null)} onRequest={() => undefined} />}
    </div>
  )
}

/** Administrative Manager only: month close, direct leave entry (exceptions), timesheet rules */
function OfficeOps() {
  const { state, dispatch, activeUsers, userById } = useStore()
  const { d, digits, n, time } = useFmt()
  const h = useHM()
  const holidays = useMemo(() => new Set(state.holidays.map((x) => x.date)), [state.holidays])
  const firstDay = Object.values(state.timesheets).reduce((m, x) => (x.date < m ? x.date : m), TODAY)
  const months: string[] = []
  for (let k = jMonthKey(firstDay); monthRange(k).to < TODAY; k = nextMonthKey(k)) months.push(k)
  const [lv, setLv] = useState({ user: undefined as string | undefined, date: undefined as string | undefined, hours: '8', note: '' })
  const cfg = configFor(state.timesheetConfigs, TODAY)
  const [c, setC] = useState({ duty: String(cfg.dutyNetMinutes / 60), brk: String(cfg.minBreakMinutes), edit: String(cfg.editDays), from: addDays(TODAY, 1) as string | undefined, reason: '' })
  const direct = state.leaves.filter((l) => !l.requestId && l.by).sort((a, b) => b.date.localeCompare(a.date))
  const monthLabel = (k: string) => `${J_MONTHS[Number(k.slice(5)) - 1]} ${digits(k.slice(0, 4))}`

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="glass-card p-4 lg:col-span-2">
        <h2 className="flex items-center gap-1.5 text-[14px] font-bold"><CalendarCheck2 className="h-4 w-4" /> Close the Moon</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">After closing, no number will change from that month, and overtimes will be recorded without payment. The fish can be closed, which is done and there is no request for leave or overtime in the cartel.</p>
        <ul className="mt-2 flex flex-col divide-y">
          {months.map((k) => {
            const closed = state.monthCloses.find((m) => m.month === k)
            const { from, to } = monthRange(k)
            const md = Object.values(state.timesheets).filter((x) => x.date >= from && x.date <= to)
            const und = md.reduce((s, x) => s + x.calc.undecided, 0)
            const pend = state.adminRequests.filter((r) => isPending(r) && ((r.overtime && r.overtime.date >= from && r.overtime.date <= to) || (r.leave && leaveDates(r.leave, holidays).some((x) => x >= from && x <= to)))).length
            return (
              <li key={k} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]">
                <span className="num min-w-[100px] font-semibold">{monthLabel(k)}</span>
                {closed ? <span className="text-muted-foreground"><Lock className="me-1 inline h-3 w-3" />It was closed {userById[closed.by]?.name}, {time(closed.at)} ·  {h(closed.unpaidMinutes)} No charge, no payment</span>
                  : <>
                    <span className="text-muted-foreground">{n(md.length)} The day is recorded, {h(und)} No assignment{pend ? `, ${n(pend)} Applicant in Carable` : ''}</span>
                    <Button size="sm" className="ms-auto h-7" disabled={pend > 0} onClick={() => { dispatch({ type: 'monthClose', month: k }); toast.success(`Month ${monthLabel(k)} Closed`) }}>Close the Moon</Button>
                  </>}
              </li>
            )
          })}
          {!months.length && <li className="py-2 text-[12.5px] text-muted-foreground">The moon is not over.</li>}
        </ul>
      </section>

      <section className="glass-card p-4">
        <h2 className="text-[14px] font-bold">Record Leave</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Only for exceptions (e.g., a sick leave that was later notified). The normal routine is to ask for leave of the employees themselves. The reason is mandatory and stays in AuditLog.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="col-span-2"><Label htmlFor="dl-user" className="eyebrow">User</Label><UserSelect id="dl-user" value={lv.user} onChange={(v) => setLv({ ...lv, user: v })} users={activeUsers} grouped noneLabel="Select user" /></div>
          <div><Label htmlFor="dl-date" className="eyebrow">Days</Label><div className="mt-1"><JalaliDateField id="dl-date" value={lv.date} onChange={(v) => setLv({ ...lv, date: v })} /></div></div>
          <div><Label htmlFor="dl-hours" className="eyebrow">Hour (8 = Full Day)</Label><Input id="dl-hours" type="number" min={0.5} max={8} step={0.5} dir="ltr" className="num mt-1 h-9" value={lv.hours} onChange={(e) => setLv({ ...lv, hours: e.target.value })} /></div>
          <div className="col-span-2"><Label htmlFor="dl-note" className="eyebrow">Reason</Label><Input id="dl-note" className="mt-1 h-9" value={lv.note} onChange={(e) => setLv({ ...lv, note: e.target.value })} /></div>
          <Button className="col-span-2 sm:col-span-1" onClick={() => {
            if (!lv.user || !lv.date) { toast.error("Choose the user and day."); return }
            if (!lv.note.trim()) { toast.error("Write down the reason for the direct registration."); return }
            if (isMonthClosed(state.monthCloses, lv.date)) { toast.error("The month of this date is closed."); return }
            dispatch({ type: 'addLeave', leave: { id: `l-d${Date.now().toString(36)}`, userId: lv.user, date: lv.date, hours: Number(lv.hours), note: lv.note } })
            setLv({ ...lv, date: undefined, note: '' }); toast.success("Leave is registered")
          }}>Submit</Button>
        </div>
        {direct.length > 0 && (
          <ul className="mt-3 flex flex-col divide-y border-t text-[12.5px]">
            {direct.slice(0, 12).map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-1.5">
                <span className="num">{d(l.date)}</span><span>{userById[l.userId]?.name}</span><span className="num text-muted-foreground">{n(l.hours, 1)} Hours</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{l.note}</span>
                {!isMonthClosed(state.monthCloses, l.date) && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete" onClick={() => dispatch({ type: 'removeLeave', id: l.id })}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass-card p-4">
        <h2 className="flex items-center gap-1.5 text-[14px] font-bold"><Settings2 className="h-4 w-4" /> Timesheet rules</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Current version {digits(cfg.version)} · Net work {h(cfg.dutyNetMinutes)} · Minimum break {digits(cfg.minBreakMinutes)} minutes · Edit window {digits(cfg.editDays)} days. New rules apply from their effective date.</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div><Label htmlFor="tc-duty" className="eyebrow">Net Hours</Label><Input id="tc-duty" type="number" step={0.25} dir="ltr" className="num mt-1 h-9" value={c.duty} onChange={(e) => setC({ ...c, duty: e.target.value })} /></div>
          <div><Label htmlFor="tc-brk" className="eyebrow">Rest (min)</Label><Input id="tc-brk" type="number" step={5} dir="ltr" className="num mt-1 h-9" value={c.brk} onChange={(e) => setC({ ...c, brk: e.target.value })} /></div>
          <div><Label htmlFor="tc-edit" className="eyebrow">Reform deadline (day)</Label><Input id="tc-edit" type="number" dir="ltr" className="num mt-1 h-9" value={c.edit} onChange={(e) => setC({ ...c, edit: e.target.value })} /></div>
          <div><Label htmlFor="tc-from" className="eyebrow">From History</Label><div className="mt-1"><JalaliDateField id="tc-from" value={c.from} onChange={(v) => setC({ ...c, from: v })} /></div></div>
          <div className="col-span-2"><Label htmlFor="tc-reason" className="eyebrow">Reason</Label><Input id="tc-reason" className="mt-1 h-9" value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} /></div>
        </div>
        <Button className="mt-2" variant="outline" onClick={() => {
          const duty = Math.round(Number(c.duty) * 60), brk = Number(c.brk), edit = Number(c.edit)
          if (!(duty >= 60 && duty <= 720) || !Number.isInteger(brk) || !Number.isInteger(edit)) { toast.error("Check the values."); return }
          if (!c.from || c.from < TODAY) { toast.error("New rules apply from today or after."); return }
          if (!c.reason.trim()) { toast.error("Write down the reason for the change."); return }
          dispatch({ type: 'tsConfig', config: { dutyNetMinutes: duty, minBreakMinutes: brk, editDays: edit, from: c.from }, reason: c.reason })
          setC({ ...c, reason: '' }); toast.success("New rules are registered")
        }}>Register a new version</Button>
        {state.timesheetConfigs.length > 1 && (
          <ul className="mt-3 flex flex-col gap-1 border-t pt-2 text-[12px] text-muted-foreground">
            {[...state.timesheetConfigs].reverse().map((x) => <li key={x.version} className="num">Versions {digits(x.version)} from {d(x.from)}: {h(x.dutyNetMinutes)} + {digits(x.minBreakMinutes)} Minutes — {x.reason}</li>)}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Home card: today's check-in/out and overtime still waiting for a choice */
export function TimesheetTodayCard() {
  const { state, dispatch, me } = useStore()
  const { digits, n } = useFmt()
  const h = useHM()
  const today = state.timesheets[dayKey(me.id, TODAY)]
  const undecided = Object.values(state.timesheets).filter((x) => x.userId === me.id && x.calc.undecided > 0)
  const pendingMine = state.adminRequests.filter((r) => r.userId === me.id && isPending(r)).length
  return (
    <section className="glass-card flex flex-wrap items-center gap-3 px-4 py-3" aria-label="Time Sheet Today">
      <div className="min-w-0 flex-1 text-[13px]">
        <span className="eyebrow me-2">Time Sheet Today</span>
        {!today?.checkIn ? "No clock-in recorded" : !today.checkOut ? <>Clock In <span className="num">{digits(today.checkIn)}</span></> : <>Net Hours <span className="num">{h(today.calc.worked)}</span></>}
        {undecided.length > 0 && <button type="button" className="ms-3 inline-flex items-center gap-1 text-[12.5px] font-medium hover:underline" onClick={() => dispatch({ type: 'nav', nav: { page: 'timesheet' } })}><AlertTriangle className="h-3.5 w-3.5" style={{ color: 'var(--status-warning)' }} />{n(undecided.length)} Overtime day without assignment</button>}
        {pendingMine > 0 && <button type="button" className="ms-3 text-[12.5px] text-muted-foreground hover:underline" onClick={() => dispatch({ type: 'nav', nav: { page: 'requests' } })}>{n(pendingMine)} Request in the process</button>}
      </div>
      {!today?.checkIn && <Button size="sm" onClick={() => { dispatch({ type: 'tsPunch', kind: 'in' }); toast.success(`Login ${digits(tehranTime())} Registered`) }}><LogIn className="h-4 w-4" /> Clock In</Button>}
      {today?.checkIn && !today.checkOut && <Button size="sm" variant="outline" onClick={() => { dispatch({ type: 'tsPunch', kind: 'out' }); toast.success(`Exit ${digits(tehranTime())} Registered`) }}><LogOut className="h-4 w-4" /> Clock Out</Button>}
    </section>
  )
}
