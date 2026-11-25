import { legacySystemText } from '@/lib/displayLabels'
import { useEffect, useState } from 'react'
import { ArrowLeftRight, ChevronDown, ChevronLeft, CircleAlert, Clock, Loader2, RefreshCw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getRemote, statusOf, useFmt, useStore, WRITEBACK_DELAY_SEC } from '@/lib/store'
import { api, ApiError, SERVER_MODE } from '@/lib/remote'
import type { RunState, SyncRun, SyncTrigger } from '@/lib/types'
import { PageHeader } from '@/components/common'

type Store = ReturnType<typeof useStore>

/**
 * Sync with the MDR. The server version reads the project's Google Sheet on the server and puts every difference in
 * Sync Review; the browser-only demo has no server and says so in the run it records.
 */
export function runManualSync(store: Store, projectId: string | 'all') {
  const { state, dispatch } = store
  const label = projectId === 'all' ? 'All Projects' : store.projectById[projectId]?.name
  if (SERVER_MODE) {
    toast("Sync started", { description: `${label} — Read MDR from Google Sheets` })
    api<{ runs: SyncRun[] }>(projectId === 'all' ? '/api/sync/all' : `/api/projects/${encodeURIComponent(projectId)}/sync`, {})
      .then(({ runs }) => {
        const bad = runs.filter((r) => r.state === 'failed')
        const d = runs.reduce((x, r) => ({ new: x.new + r.diffs.new, changed: x.changed + r.diffs.changed, removed: x.removed + r.diffs.removed }), { new: 0, changed: 0, removed: 0 })
        if (bad.length) toast.error(`Sync ${bad.length === runs.length ? "It was unsuccessful" : "Part was unsuccessful"}`, { description: bad[0].log.find((l) => l.level === 'error')?.text })
        else toast.success("Sync is over", { description: d.new + d.changed + d.removed ? `${d.new} New, ${d.changed} Change, ${d.removed} Delete in Sync Review queue` : "MDR is the same system; there was no change." })
      })
      .catch((e) => toast.error("Sync not done", { description: e instanceof ApiError ? e.message : "The connection to the server was not established." }))
    return
  }
  const id = `run-m-${Date.now()}`
  dispatch({ type: 'addRun', run: { id, projectId, trigger: 'manual', at: new Date().toISOString(), durationSec: 0, state: 'running', rowsRead: 0, diffs: { new: 0, changed: 0, removed: 0 }, cellsWritten: 0, log: [{ level: 'info', text: "Version (no server)..." }] } })
  toast("Sync in Demo", { description: label })
  setTimeout(() => {
    dispatch({
      type: 'updateRun', id, patch: {
        state: 'success', durationSec: 1, rowsRead: 0,
        log: [
          { level: 'warn', text: "This demo is not connected to the server and Google Sheets; MDR is not read. The actual Sync (Read MDR, Compare, and Sync Review queue) runs in the server version." },
          { level: 'info', text: `${state.syncItems.filter((x) => x.state === 'pending' && (projectId === 'all' || x.projectId === projectId)).length} The sample row is already in the Sync Review queue.` },
        ],
      },
    })
    toast("Demo", { description: "The real Sync is done with MDR in the server version." })
  }, 600)
}

/** How Sync runs on this installation (from the server), or that this is the browser-only demo */
function SyncSetupNote() {
  const { n } = useFmt()
  if (!SERVER_MODE) return <>Server-free demos: This page's run is sampled. In the server version, manual Sync, periodic schedule on working days and write-back are executed after changing Status on the server.</>
  const info = getRemote().info
  return (
    <>
      Manual sync available. {info.syncEveryHours ? `Auto-sync runs every ${n(info.syncEveryHours)} hours on working days` : "Automatic sync is paused"} · Write-back {n(Math.round((info.writebackDelaySec ?? 120) / 60))} minutes after the last status change. Network errors are retried.{' '}
      {info.google?.configured
        ? <>Every MDR should be with a service account <bdi className="mono text-foreground">{info.google.email}</bdi> (editor) to be shared.</>
        : <span className="text-destructive">The Google service account is not set up on the server; Sync and Write-back record errors until you set it up.</span>}
    </>
  )
}

const TRIGGER: Record<SyncTrigger, string> = { manual: "Manual", scheduled: "Recurring Schedule", writeback: 'Write-back' }
const STATE: Record<RunState, { label: string; cls: string }> = {
  success: { label: "Successfully", cls: 'bg-leaf-soft text-leaf-ink' },
  partial: { label: "In line error", cls: 'bg-secondary text-foreground ring-1 ring-destructive/40' },
  failed: { label: "failed", cls: 'bg-danger-soft text-destructive' },
  retrying: { label: "Retry", cls: 'bg-azure-soft text-azure-ink' },
  running: { label: "Running", cls: 'bg-azure-soft text-azure-ink' },
}

function WriteBackQueue() {
  const store = useStore()
  const { state, dispatch } = store
  const { n, digits } = useFmt()
  const [, tick] = useState(0)
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(h) }, [])
  const q = state.writeQueue
  const last = q.length ? Math.max(...q.map((w) => w.queuedAt)) : 0
  const left = Math.max(0, Math.round((last + WRITEBACK_DELAY_SEC * 1000 - Date.now()) / 1000))
  return (
    <div className="glass-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <div className="flex items-center gap-1.5 font-semibold"><Send className="h-4 w-4" /> Writing-back</div>
          <div className="text-[12px] text-muted-foreground">Only 3 columns of Last Status Date, Last Status and Progress (inner) with delay {n(WRITEBACK_DELAY_SEC / 60)} The minute after the last change of status is written.</div>
        </div>
        <Button size="sm" variant="outline" disabled={!q.length} onClick={() => {
          if (SERVER_MODE) {
            api<{ runs: SyncRun[] }>('/api/writeback/flush', {})
              .then(({ runs }) => runs.some((r) => r.state === 'failed') ? toast.error("Writing-back not done", { description: runs.find((r) => r.state === 'failed')?.log.find((l) => l.level === 'error')?.text }) : toast.success("Write-back is done", { description: `${runs.reduce((x, r) => x + r.cellsWritten, 0)} The cell was written in internal columns.` }))
              .catch((e) => toast.error("Writing-back not done", { description: e instanceof ApiError ? e.message : "The connection to the server was not established." }))
            return
          }
          dispatch({ type: 'flushWriteBack' }); toast.success("Write-back", { description: "In the server version, cells are actually written in MDR." })
        }}>Send Now</Button>
      </div>
      {q.length === 0 ? (
        <div className="px-4 py-4 text-[12.5px] text-muted-foreground">The queue is empty. Status change a MDR document so that it can be seen here.</div>
      ) : (
        <div>
          <div className="flex items-center gap-1.5 bg-azure-soft px-4 py-2 text-[12.5px] text-azure-ink"><Clock className="h-3.5 w-3.5" /> Send Auto To <span className="num font-semibold">{digits(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`)}</span> Other</div>
          <ul className="divide-y text-[12.5px]">
            {q.map((w) => {
              const t = state.tasks[w.taskId]
              return (
                <li key={w.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                  <span className="mono">{t.docNumber}</span>
                  <span className="text-muted-foreground">Row {n(t.mdrRow ?? 0)}</span>
                  <span className="ms-auto">«{w.statusName}», {n(w.progress)}%</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function MdrMapping() {
  const { state } = useStore()
  const { n, d } = useFmt()
  const rows = Object.values(state.tasks).filter((t) => t.projectId === 'BBT' && t.source === 'mdr').sort((a, b) => (a.mdrRow ?? 0) - (b.mdrRow ?? 0)).slice(0, 9)
  const headers = ['phase', 'Stage', 'summary', 'Docs', 'Document Number', 'Sheets Name', 'Floor', 'Weight', 'Package', 'Plan Issue Date', 'SubTask', 'Last Status Date (internal)', 'Last Status (internal)', 'Progress (internal)']
  const read = new Set(['phase', 'Stage', 'summary', 'Docs', 'Document Number', 'Sheets Name', 'Floor', 'Weight', 'Package'])
  const write = new Set(['Last Status Date (internal)', 'Last Status (internal)', 'Progress (internal)'])
  const cell = (t: (typeof rows)[number], h: string) => {
    const s = statusOf(state, t)
    switch (h) {
      case 'phase': return t.kind === 'phase' ? t.name : ''
      case 'Stage': return t.kind === 'stage' ? t.name : ''
      case 'summary': return t.kind === 'group' ? t.name : ''
      case 'Docs': return t.kind === 'doctype' ? t.name : ''
      case 'Document Number': return t.docNumber ?? ''
      case 'Sheets Name': return t.kind === 'document' ? t.name : ''
      case 'Floor': return t.kind === 'document' ? t.floor : ''
      case 'Weight': return t.weight != null ? n(t.weight, 2) : ''
      case 'Package': return t.kind === 'document' ? t.pkg : ''
      case 'Plan Issue Date': return t.planIssue ? d(t.planIssue) : ''
      case 'Last Status Date (internal)': return t.kind === 'document' && t.due && s?.category === 'done' ? d(t.due) : ''
      case 'Last Status (internal)': return t.kind === 'document' ? s?.name : ''
      case 'Progress (internal)': return t.kind === 'document' ? `${n(s?.progress ?? 0)}%` : ''
      default: return ''
    }
  }
  return (
    <div className="glass-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-1.5 font-semibold"><ArrowLeftRight className="h-4 w-4" /> Map of MDR columns</div>
        <div className="text-[12px] text-muted-foreground">Row 1 Name and type of project, row 2 headers, data from row 3. Columns are always found by the name of the header, not by the letter of the column.</div>
      </div>
      <div className="flex flex-wrap gap-3 px-4 pt-3 text-[11.5px]">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-secondary ring-1 ring-border" /> Read (MDR → App)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-azure-soft ring-1 ring-azure/40" /> Rewrite (App → MDR)</span>
        <span className="inline-flex items-center gap-1.5"><span className="hatch h-3 w-3 rounded-sm ring-1 ring-border" /> Sync is not</span>
      </div>
      <div className="scroll-x thin-scroll p-4" dir="ltr">
        <table className="w-max min-w-full border-collapse text-[11.5px]">
          <thead>
            <tr><td className="border bg-foreground/[0.03] px-2 py-1 text-muted-foreground">1</td><td colSpan={headers.length} className="border px-2 py-1 font-semibold" dir="ltr">Babolsar Residential Tower – The Most High Residential</td></tr>
            <tr>
              <td className="border bg-foreground/[0.03] px-2 py-1 text-muted-foreground">2</td>
              {headers.map((h) => <th key={h} className={cn('whitespace-nowrap border px-2 py-1 text-start font-semibold', read.has(h) ? 'bg-secondary' : write.has(h) ? 'bg-azure-soft text-azure-ink' : 'hatch')}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="num border bg-foreground/[0.03] px-2 py-1 text-muted-foreground">{t.mdrRow}</td>
                {headers.map((h) => <td key={h} className={cn('whitespace-nowrap border px-2 py-1 text-start', write.has(h) && 'bg-azure-soft/50')}><bdi dir={h === 'Document Number' || h === 'Floor' || h === 'Package' ? 'ltr' : 'auto'} className={cn(h === 'Document Number' && 'mono')}>{cell(t, h)}</bdi></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RunRow({ r }: { r: SyncRun }) {
  const { projectById } = useStore()
  const { n, time } = useFmt()
  const [open, setOpen] = useState(r.state !== 'success')
  const st = STATE[r.state]
  return (
    <div className="border-b last:border-0">
      <button className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-start hover:bg-foreground/[0.035] md:grid-cols-[auto_150px_minmax(0,1fr)_120px_210px_auto]" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronLeft className="h-4 w-4 text-muted-foreground" />}
        <div className="min-w-0">
          <div className="font-medium">{r.projectId === 'all' ? 'All Projects' : projectById[r.projectId]?.name}</div>
          <div className="text-[11.5px] text-muted-foreground">{TRIGGER[r.trigger]}, {time(r.at)}</div>
        </div>
        <div className="hidden text-[12px] text-muted-foreground md:block">
          {r.trigger === 'writeback' ? `${n(r.cellsWritten)} The cell was written` : `${n(r.rowsRead)} Row read`}
        </div>
        <div className="hidden md:block">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium', st.cls)}>{r.state === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}{st.label}</span>
        </div>
        <div className="num hidden gap-3 text-[12px] md:flex">
          <span>New <b>{n(r.diffs.new)}</b></span><span>Change <b>{n(r.diffs.changed)}</b></span><span>Delete <b>{n(r.diffs.removed)}</b></span>
        </div>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium md:hidden', st.cls)}>{st.label}</span>
        <span className="num hidden text-[11.5px] text-muted-foreground md:inline">{n(r.durationSec)} Seconds</span>
      </button>
      {open && (
        <ul className="mx-4 mb-3 flex flex-col gap-1 rounded-md bg-foreground/[0.03] p-3 text-[12px]">
          {r.log.map((l, i) => (
            <li key={i} className={cn('flex items-start gap-2', l.level === 'error' && 'text-destructive', l.level === 'warn' && 'text-foreground')}>
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', l.level === 'error' ? 'bg-destructive' : l.level === 'warn' ? 'bg-foreground' : 'bg-muted-foreground/60')} />
              <span className={cn(l.text.match(/^[A-Z]{3}-/) && 'mono')}>{legacySystemText(l.text)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SyncRuns() {
  const store = useStore()
  const { state } = store
  const [target, setTarget] = useState<string>('all')
  const errors = state.syncRuns.filter((r) => r.state === 'failed' || r.state === 'partial').length
  const running = state.syncRuns.some((r) => r.state === 'running')
  const { n } = useFmt()
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Sync with MDR" title="Sync Runs" actions={
        <div className="flex items-center gap-2">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="sync-target" className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {state.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => runManualSync(store, target)} disabled={running} aria-busy={running}><RefreshCw className={cn('h-4 w-4', running && 'animate-spin')} /> {running ? "Syncing..." : "Run Sync Manually"}</Button>
        </div>
      }>
        <SyncSetupNote />
      </PageHeader>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 overflow-hidden glass-card">
          <div className="flex items-center justify-between border-b bg-foreground/[0.03] px-4 py-2.5 text-[12.5px]">
            <span className="font-semibold">Latest Performances</span>
            {errors > 0 && <span className="inline-flex items-center gap-1 text-destructive"><CircleAlert className="h-3.5 w-3.5" /> {n(errors)} Run with Error</span>}
          </div>
          {state.syncRuns.map((r) => <RunRow key={r.id} r={r} />)}
        </div>
        <WriteBackQueue />
      </div>
      <MdrMapping />
    </div>
  )
}
