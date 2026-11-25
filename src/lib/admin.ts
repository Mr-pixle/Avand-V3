// Administrative module — pure rules for requests, timesheets and their reports.
// No UI or storage here, so the same functions run in the browser version, the tests and later the server.
//
// Daily rule (as agreed): a working day asks for 8 h of net work plus at least 30 min of break and lunch (8:30 in the office).
// Net work = check-out − check-in − break. Anything above the required net work is overtime; Thursday, Friday and holidays
// require nothing, so all work there is overtime. Approved leave lowers the requirement of its day.
import { addDays, isWeekend, jMonthLength, fromJalali, rangeDays, startOfWeek, toJalali } from './jalali'
import type {
  AdminRequest, AdminRequestKind, AdminRequestStatus, Leave, LeaveCategory, LeaveDetails, MonthClose, OtherCategory, TimesheetCalc, TimesheetConfig, TimesheetDay,
} from './types'

export const KIND_FA: Record<AdminRequestKind, string> = { leave: 'Leave', overtime: 'Overtime', other: 'Other Requests', it: 'IT Support' }
export const STATUS_FA: Record<AdminRequestStatus, string> = {
  pending_it: 'With Project Controls', it_in_progress: 'In Progress', it_resolved: 'Resolved',
  pending_office: 'With Office Manager', pending_ceo: 'With CEO', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', cancelled: 'Cancelled',
}
export const LEAVE_CAT_FA: Record<LeaveCategory, string> = { unified: 'Leave', annual: 'Annual Leave', sick: 'Sick Leave', unpaid: 'Unpaid Leave' }
export const OTHER_CAT_FA: Record<OtherCategory, string> = { mission: 'Business Trip', certificate: 'Employment Certificate', advance_pay: 'Advance Pay', equipment: 'Equipment', other: 'Other' }
export const PENDING: AdminRequestStatus[] = ['pending_office', 'pending_ceo', 'pending_it', 'it_in_progress']
export const isPending = (r: AdminRequest) => PENDING.includes(r.status)

export const DEFAULT_TIMESHEET_CONFIG: Omit<TimesheetConfig, 'by' | 'at'> = {
  version: 1, from: '2000-01-01', dutyNetMinutes: 8 * 60, minBreakMinutes: 30, editDays: 7, reason: "Basic rule: 8 hours of pure work and 30 minutes of rest and lunch",
}
/** limits that keep obviously wrong entries out */
export const MAX_PRESENCE = 20 * 60
export const MAX_ADVANCE_OT = 12 * 60
export const MAX_LEAVE_SPAN = 60

// ---------- time ----------
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/
export const isHM = (s: unknown): s is string => typeof s === 'string' && HM.test(s)
export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
/** 510 → "8:30" */
export const hm = (m: number) => `${Math.floor(Math.abs(m) / 60)}:${String(Math.abs(m) % 60).padStart(2, '0')}`
/** minutes between check-in and check-out; a check-out at or before the check-in is on the next day */
export function presenceOf(checkIn?: string, checkOut?: string) {
  if (!isHM(checkIn) || !isHM(checkOut)) return 0
  const d = toMin(checkOut) - toMin(checkIn)
  return d > 0 ? d : d + 1440
}

// ---------- calendar ----------
export const dayKey = (userId: string, date: string) => `${userId}|${date}`
/** "1405-08" */
export function jMonthKey(iso: string) { const j = toJalali(iso); return `${j.jy}-${String(j.jm).padStart(2, '0')}` }
export function monthRange(key: string) {
  const [jy, jm] = key.split('-').map(Number)
  return { from: fromJalali(jy, jm, 1), to: fromJalali(jy, jm, jMonthLength(jy, jm)) }
}
export const isMonthClosed = (closes: Pick<MonthClose, 'month'>[], date: string) => closes.some((c) => c.month === jMonthKey(date))
export const isOffDay = (date: string, holidays: Set<string>) => isWeekend(date) || holidays.has(date)
export function configFor(configs: TimesheetConfig[], date: string): TimesheetConfig {
  let c = configs[0]
  for (const x of configs) if (x.from <= date && x.version >= c.version) c = x
  return c
}
/** working days of a day-leave (Thursday, Friday and holidays are not counted); the single day of an hourly leave */
export function leaveDates(l: Pick<LeaveDetails, 'mode' | 'from' | 'to'>, holidays: Set<string>) {
  if (l.mode === 'hour') return [l.from]
  if (!l.from || !l.to || l.to < l.from) return []
  return rangeDays(l.from, l.to).filter((d) => !isOffDay(d, holidays))
}
export function hourLeaveMinutes(l: Pick<LeaveDetails, 'startTime' | 'endTime'>) {
  if (!isHM(l.startTime) || !isHM(l.endTime)) return 0
  return Math.max(0, toMin(l.endTime) - toMin(l.startTime))
}
export function leaveMinutesOn(leaves: Leave[], userId: string, date: string) {
  return Math.round(leaves.filter((l) => l.userId === userId && l.date === date).reduce((s, l) => s + l.hours, 0) * 60)
}

// ---------- the day ----------
export interface DayContext {
  cfg: TimesheetConfig
  holidays: Set<string>
  leaveMinutes: number
  /** overtime requests of this person for this day, any status */
  requests: AdminRequest[]
  closed: boolean
}
const LIVE: AdminRequestStatus[] = ['pending_office', 'pending_ceo', 'approved', 'rejected']

export function computeDay(day: Pick<TimesheetDay, 'date' | 'checkIn' | 'checkOut' | 'breakMinutes' | 'otChoice'>, ctx: DayContext): TimesheetCalc {
  const off = isOffDay(day.date, ctx.holidays)
  const presence = presenceOf(day.checkIn, day.checkOut)
  const breakMinutes = presence ? Math.min(presence, off ? Math.max(0, day.breakMinutes) : Math.max(day.breakMinutes, ctx.cfg.minBreakMinutes)) : 0
  const worked = presence - breakMinutes
  const duty = off ? 0 : Math.max(0, ctx.cfg.dutyNetMinutes - ctx.leaveMinutes)
  const complete = presence > 0
  const excess = complete ? Math.max(0, worked - duty) : 0
  const deficit = complete && !off ? Math.max(0, duty - worked) : 0
  const live = ctx.requests.filter((r) => LIVE.includes(r.status) && r.overtime)
  const sum = (rs: AdminRequest[], f: (r: AdminRequest) => number) => rs.reduce((s, r) => s + f(r), 0)
  const requested = sum(live, (r) => r.overtime!.minutes)
  const approved = Math.min(excess, sum(live.filter((r) => r.status === 'approved'), (r) => r.overtime!.approvedMinutes ?? r.overtime!.minutes))
  const pending = Math.min(excess - approved, sum(live.filter(isPending), (r) => r.overtime!.minutes))
  const decided = live.length > 0 || day.otChoice === 'unpaid' || ctx.closed
  const unpaid = decided ? excess - approved - pending : 0
  return {
    presence, breakMinutes, worked, duty, leave: ctx.leaveMinutes, offDay: off,
    excess, requested, approved, pending, unpaid, undecided: decided ? 0 : excess, deficit, configVersion: ctx.cfg.version,
  }
}
export const sameCalc = (a: TimesheetCalc, b: TimesheetCalc) => (Object.keys(a) as (keyof TimesheetCalc)[]).every((k) => a[k] === b[k])

export type OtState = 'none' | 'undecided' | 'pending' | 'approved' | 'partial' | 'rejected' | 'unpaid'
export const OT_FA: Record<OtState, string> = { none: '', undecided: "No assignment", pending: "Pending Review", approved: "Approved", partial: "Part Confirmed", rejected: "Rejected", unpaid: "No payment" }
export function otState(c: TimesheetCalc, reqs: AdminRequest[] = []): OtState {
  if (!c.excess) return 'none'
  if (c.undecided) return 'undecided'
  if (c.pending) return 'pending'
  if (c.approved >= c.excess) return 'approved'
  if (c.approved > 0) return 'partial'
  return reqs.some((r) => r.status === 'rejected') ? 'rejected' : 'unpaid'
}
/** overtime of a recorded day that is not yet covered by a request */
export function overtimeAvailable(c: TimesheetCalc, reqs: AdminRequest[]) {
  return Math.max(0, c.excess - reqs.filter((r) => LIVE.includes(r.status) && r.overtime).reduce((s, r) => s + r.overtime!.minutes, 0))
}

export interface SettleInput {
  days: Record<string, TimesheetDay>; requests: AdminRequest[]; leaves: Leave[]
  holidays: string[]; configs: TimesheetConfig[]; closes: MonthClose[]
  /** recalculate these days as closed (used while a month is being closed) */
  closing?: string
}
export function overtimeIndex(requests: AdminRequest[]) {
  const by = new Map<string, AdminRequest[]>()
  for (const r of requests) if (r.kind === 'overtime' && r.overtime) {
    const k = dayKey(r.userId, r.overtime.date)
    ;(by.get(k) ?? by.set(k, []).get(k)!).push(r)
  }
  return by
}
/** Recalculate every day of an open month; returns the new map and the days whose figures changed */
export function settleDays(inp: SettleInput) {
  const holidays = new Set(inp.holidays)
  const ot = overtimeIndex(inp.requests)
  const leave = new Map<string, number>()
  for (const l of inp.leaves) leave.set(dayKey(l.userId, l.date), (leave.get(dayKey(l.userId, l.date)) ?? 0) + l.hours)
  const closedMonths = new Set(inp.closes.map((c) => c.month))
  const out: Record<string, TimesheetDay> = {}
  const changed: { prev: TimesheetDay; next: TimesheetDay }[] = []
  for (const [k, day] of Object.entries(inp.days)) {
    const m = jMonthKey(day.date)
    if (closedMonths.has(m)) { out[k] = day; continue }
    const calc = computeDay(day, {
      cfg: configFor(inp.configs, day.date), holidays, leaveMinutes: Math.round((leave.get(k) ?? 0) * 60), requests: ot.get(k) ?? [], closed: inp.closing === m,
    })
    if (sameCalc(calc, day.calc)) { out[k] = day; continue }
    const next = { ...day, calc }
    out[k] = next
    changed.push({ prev: day, next })
  }
  return { days: out, changed }
}

// ---------- validation shared by the guard and the forms ----------
export interface LeaveCheck { holidays: Set<string>; today: string; cfg: TimesheetConfig; closes: MonthClose[]; existing: Leave[]; pending: AdminRequest[]; userId: string }
export function checkLeave(l: LeaveDetails | undefined, c: LeaveCheck): string | null {
  if (!l || !['day', 'hour'].includes(l.mode)) return "Identify the type of vacation."
  if (!(l.category in LEAVE_CAT_FA)) return "Choose the vacation category."
  if (!l.from || !l.to) return "Choose the date of vacation."
  if (l.to < l.from) return "The end of the vacation cannot be before it begins."
  if (l.mode === 'day' && rangeDays(l.from, l.to).length > MAX_LEAVE_SPAN) return `The maximum day off is ${MAX_LEAVE_SPAN}.`
  const dates = leaveDates(l, c.holidays)
  if (l.mode === 'hour') {
    if (l.from !== l.to) return "It’s a one-day vacation."
    if (isOffDay(l.from, c.holidays)) return "This is a holiday; no vacation is required."
    const m = hourLeaveMinutes(l)
    if (!m) return "Enter the start and end of the time break."
    if (m >= c.cfg.dutyNetMinutes) return "Day leave should be shorter than a working day; take a day off."
  }
  if (!dates.length) return "There is no work day at this time."
  if (dates.some((d) => isMonthClosed(c.closes, d))) return "The month of this date is closed."
  const taken = new Set(c.existing.filter((x) => x.userId === c.userId).map((x) => x.date))
  for (const r of c.pending) if (r.userId === c.userId && r.kind === 'leave' && r.leave && isPending(r)) for (const d of leaveDates(r.leave, c.holidays)) taken.add(d)
  const clash = dates.find((d) => taken.has(d))
  if (clash) return "Some of these days you have a registered or ongoing vacation."
  return null
}

export interface OvertimeCheck { today: string; closes: MonthClose[]; day?: TimesheetDay; requests: AdminRequest[] }
/** Overtime after the day is capped by what the timesheet shows; an advance request (day not finished yet) by MAX_ADVANCE_OT */
export function checkOvertime(o: { date?: string; minutes?: number } | undefined, c: OvertimeCheck): string | null {
  if (!o?.date) return "Choose an overtime date."
  if (!Number.isInteger(o.minutes) || (o.minutes ?? 0) <= 0) return "Enter the extra amount of work."
  if (isMonthClosed(c.closes, o.date)) return "The month of this date is closed."
  const finished = !!c.day?.checkOut
  if (finished) {
    const free = overtimeAvailable(c.day!.calc, c.requests)
    if (!free) return "No extra work is required for this day."
    if (o.minutes! > free) return `The maximum possible overtime of this day is ${hm(free)}.`
    return null
  }
  if (o.date < c.today) return "For the past few days, register the first hour of arrival and departure in Time Sheet."
  if (o.minutes! > MAX_ADVANCE_OT) return `Overtime requested in advance is limited to ${hm(MAX_ADVANCE_OT)} hours.`
  return null
}

// ---------- reports ----------
export interface DayRow { day: TimesheetDay; c: TimesheetCalc }
export type Bucket = 'day' | 'week' | 'month'
export function bucketOf(date: string, by: Bucket) { return by === 'day' ? date : by === 'week' ? startOfWeek(date) : jMonthKey(date) }
export interface WorkRow { key: string; userId: string; days: number; worked: number; duty: number; deficit: number; excess: number; leave: number }
export function workSummary(days: TimesheetDay[], by: Bucket): WorkRow[] {
  const m = new Map<string, WorkRow>()
  for (const d of days) {
    const key = bucketOf(d.date, by)
    const k = `${d.userId}|${key}`
    const r = m.get(k) ?? m.set(k, { key, userId: d.userId, days: 0, worked: 0, duty: 0, deficit: 0, excess: 0, leave: 0 }).get(k)!
    if (d.calc.presence) r.days++
    r.worked += d.calc.worked; r.duty += d.calc.duty; r.deficit += d.calc.deficit; r.excess += d.calc.excess; r.leave += d.calc.leave
  }
  return [...m.values()].sort((a, b) => b.key.localeCompare(a.key) || a.userId.localeCompare(b.userId))
}
export interface OtRow { userId: string; days: number; excess: number; offDay: number; requested: number; approved: number; pending: number; unpaid: number; undecided: number }
export function overtimeSummary(days: TimesheetDay[]): OtRow[] {
  const m = new Map<string, OtRow>()
  for (const d of days) {
    if (!d.calc.excess && !d.calc.requested) continue
    const r = m.get(d.userId) ?? m.set(d.userId, { userId: d.userId, days: 0, excess: 0, offDay: 0, requested: 0, approved: 0, pending: 0, unpaid: 0, undecided: 0 }).get(d.userId)!
    if (d.calc.excess) r.days++
    r.excess += d.calc.excess; if (d.calc.offDay) r.offDay += d.calc.excess
    r.requested += d.calc.requested; r.approved += d.calc.approved; r.pending += d.calc.pending; r.unpaid += d.calc.unpaid; r.undecided += d.calc.undecided
  }
  return [...m.values()].sort((a, b) => b.excess - a.excess)
}
export function statusCounts(reqs: AdminRequest[]) {
  const c: Record<AdminRequestStatus, number> = { pending_it: 0, it_in_progress: 0, it_resolved: 0, pending_office: 0, pending_ceo: 0, approved: 0, rejected: 0, withdrawn: 0, cancelled: 0 }
  for (const r of reqs) c[r.status]++
  return c
}
/** Response of each approver step: handled, approved, rejected, average hours to decide, still waiting, oldest wait */
export interface StageRow { stage: 'office' | 'ceo'; handled: number; approved: number; rejected: number; avgHours: number | null; pending: number; oldestHours: number | null }
export function approverStats(reqs: AdminRequest[], now: string): StageRow[] {
  const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000
  return (['office', 'ceo'] as const).map((stage) => {
    let handled = 0, approved = 0, rejected = 0, total = 0
    for (const r of reqs) {
      const i = r.steps.findIndex((s) => s.stage === stage)
      if (i < 0) continue
      const s = r.steps[i]
      const arrived = [...r.steps.slice(0, i)].reverse().find((x) => x.stage === 'submit' || x.stage === 'office' || x.stage === 'system')?.at ?? r.createdAt
      handled++; if (s.decision === 'approve') approved++; else rejected++
      total += Math.max(0, hours(arrived, s.at))
    }
    const waiting = reqs.filter((r) => r.status === (stage === 'office' ? 'pending_office' : 'pending_ceo'))
    const oldest = waiting.length ? Math.max(...waiting.map((r) => hours(r.stageSince, now))) : null
    return { stage, handled, approved, rejected, avgHours: handled ? total / handled : null, pending: waiting.length, oldestHours: oldest }
  })
}
/** Spreadsheet-friendly CSV (UTF-8 with BOM so Excel shows Persian correctly) */
export function toCSV(head: string[], rows: (string | number)[][]) {
  const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n')
}
export const monthOf = (iso: string) => jMonthKey(iso)
export const prevMonthKey = (key: string) => { const { from } = monthRange(key); return jMonthKey(addDays(from, -1)) }
export const nextMonthKey = (key: string) => { const { to } = monthRange(key); return jMonthKey(addDays(to, 1)) }
