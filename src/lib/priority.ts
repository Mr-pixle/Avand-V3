import type { Priority } from './types'
export const PRIORITY_FA:Record<Priority,string>={none:'No Priority',low:'Low',normal:'Normal',high:'High',urgent:'Urgent'}
export const PRIORITY_RANK:Record<Priority,number>={none:-1,low:0,normal:1,high:2,urgent:3}
export const PRIORITY_CLASS:Record<Priority,string>={none:'bg-muted text-muted-foreground',low:'bg-info-soft text-info-ink',normal:'bg-warning-soft text-warning-ink',high:'bg-elevated-alert-soft text-elevated-alert-ink',urgent:'bg-destructive text-destructive-foreground'}
