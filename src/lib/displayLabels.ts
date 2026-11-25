const projectTypes = new Map([
  ['مسکونی', 'Residential'], ['اداری', 'Office'], ['تجاری', 'Commercial'],
  ['مختلط', 'Mixed Use'], ['رستوران', 'Restaurant'], ['آموزشی', 'Education'],
])

const statusNames = new Map([
  ['شروع نشده', 'Not Started'], ['در حال طراحی', 'Design in Progress'], ['بررسی داخلی', 'Internal Review'],
  ['اصلاحات', 'Revisions'], ['ثبت‌شده', 'Open'], ['ارجاع‌شده', 'Assigned'], ['در حال اجرا', 'In Progress'], ['در انتظار بررسی', 'In Review'], ['بازگشت برای اصلاح', 'Rework'], ['بسته‌شده', 'Closed'], ['ارسال برای کارفرما', 'Submitted to Client'], ['صادر شد', 'Issued'],
])

export const projectTypeLabel = (value: string) => projectTypes.get(value.trim()) ?? value
export const statusLabel = (value: string) => statusNames.get(value.trim()) ?? value

const systemLabels = new Map([
  ['مدیرعامل', 'CEO'],
  ['پیروزی انقلاب اسلامی', 'Islamic Revolution Day'],
  ['ملی شدن صنعت نفت', 'Oil Nationalization Day'],
  ['نوروز', 'Nowruz'],
  ['روز جمهوری اسلامی', 'Islamic Republic Day'],
  ['روز طبیعت', 'Nature Day'],
])

export const systemLabel = (value: string) => systemLabels.get(value.trim()) ?? value

// Older sync runs and notifications store the system's message as text.
export function legacySystemText(value: string) {
  if (value === 'حساب سرویس Google روی سرور تنظیم نشده است (GOOGLE_SERVICE_ACCOUNT_FILE).') {
    return 'The Google service account is not configured on the server (GOOGLE_SERVICE_ACCOUNT_FILE).'
  }
  const failed = value.match(/^Sync (.+) ناموفق بود$/u)
  if (failed) return 'Sync failed for ' + failed[1]
  const read = value.match(/^خواندن MDR \(Tab «(.+)»\) از Google Sheets…$/u)
  if (read) return 'Reading MDR from Google Sheets, tab “' + read[1] + '”…'
  if (value === 'حساب شما تأیید شد') return 'Your account was approved'
  const joined = value.match(/^عضو تیم (.+) شدید\. خوش آمدید\.$/u)
  if (joined) return 'You joined the ' + joined[1] + ' team. Welcome.'
  const deadline = value.match(/^ددلاین «(.+)» نزدیک است$/u)
  if (deadline) return 'Deadline for “' + deadline[1] + '” is approaching'
  return value
}
