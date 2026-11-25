import { myResponsibilityProjects } from './lib/projectResponsibilities'
import { isActiveProjectId } from './lib/projectDetails'
import { DocumentsPage, LinksPage } from '@/pages/Library'
import { useState } from 'react'
import { DirectionProvider } from '@radix-ui/react-direction'
import { Toaster } from 'sonner'
import { Bell, ClipboardCheck, Clock3, ListTodo, FileBarChart2, FilePen, FolderKanban, Gauge, GitPullRequestArrow, History, House, Inbox, Landmark, Lock, MessagesSquare, Settings, Settings2, Trophy, UsersRound, Warehouse } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { StoreProvider, useFmt, useStore, type Page } from '@/lib/store'
import { finSpacesOf } from '@/lib/policy'
import { Empty, Logo } from '@/components/common'
import { TaskDrawer } from '@/components/TaskDrawer'
import { ProfileDialog } from '@/components/Profile'
import { ProfileMenu, TopBar } from '@/components/TopBar'
import { SettingsPage } from '@/pages/Settings'
import { Home } from '@/pages/Home'
import { ProjectPage, Projects } from '@/pages/Projects'
import { Workload } from '@/pages/Workload'
import { SyncReview } from '@/pages/SyncReview'
import { SyncRuns } from '@/pages/SyncRuns'
import { Admin } from '@/pages/Admin'
import { Notifications } from '@/pages/Notifications'
import { ChatPage } from '@/pages/Chat'
import { Auth } from '@/pages/Auth'
import { SupervisionPage, TeamSpace } from '@/pages/Spaces'
import { PointsReport } from '@/pages/Points'
import { AdminReportsPage, InboxPage, RequestsPage, TimesheetPage } from '@/pages/AdminModule'
import { PersonalPage } from '@/pages/Personal'
import { FinAdminPage } from '@/pages/FinAdmin'

type NavItem = { page: Page; label: string; icon: typeof House; restricted?: boolean }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Workspace', items: [
    { page: 'home', label: 'Overview', icon: House },
    { page: 'notifications', label: 'Notifications', icon: Bell },
    { page: 'projects', label: 'Projects', icon: FolderKanban },
    { page: 'supervision', label: 'Site Supervision', icon: ClipboardCheck },
    { page: 'team', label: 'Team Spaces', icon: Warehouse },
    { page: 'documents', label: 'Documents', icon: FolderKanban },
    { page: 'links', label: 'Links', icon: Warehouse },
    { page: 'personal', label: 'Personal Tasks', icon: ListTodo },
  ] },
  { group: 'Office', items: [
    { page: 'requests', label: 'My Requests', icon: FilePen },
    { page: 'timesheet', label: 'Timesheet', icon: Clock3 },
    { page: 'inbox', label: 'Inbox', icon: Inbox, restricted: true },
    { page: 'adminreports', label: 'Office Reports', icon: FileBarChart2, restricted: true },
    { page: 'finadmin', label: 'Finance & Administration', icon: Landmark, restricted: true },
  ] },
  { group: 'Chat', items: [
    { page: 'pchat', label: 'Project Chat', icon: MessagesSquare },
    { page: 'chat', label: 'General Chat', icon: UsersRound },
  ] },
  { group: 'Project Controls', items: [
    { page: 'workload', label: 'Workload', icon: Gauge, restricted: true },
    { page: 'review', label: 'Sync Review', icon: GitPullRequestArrow, restricted: true },
    { page: 'runs', label: 'Sync History', icon: History, restricted: true },
    { page: 'points', label: 'Points Report', icon: Trophy, restricted: true },
    { page: 'admin', label: 'Administration', icon: Settings2, restricted: true },
  ] },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { state, dispatch, can, unread, myChannels, unreadIn, me } = useStore()
  const { n } = useFmt()
  const pending = state.syncItems.filter((x) => x.state === 'pending').length
  const requests = state.users.filter((u) => u.status === 'pending').length
  const current = state.nav.page === 'project' ? 'projects' : state.nav.page
  // CEO and Project Control land on the overview of all team spaces; everyone else on their own team
  const go = (page: Page) => dispatch({ type: 'nav', nav: page === 'team' && !can.perm('teamspace.all') ? { page, teamId: me.teamId } : { page } })
  const badgeOf = (p: Page) => p === 'notifications' ? unread
    : p === 'review' ? pending
      : p === 'runs' ? state.writeQueue.length
        : p === 'admin' ? requests
          : p === 'pchat' ? myChannels.filter((c) => c.startsWith('project:')).reduce((s, c) => s + unreadIn(c), 0)
            : p === 'chat' ? unreadIn('general') + unreadIn('announce')
              : p === 'supervision' ? Object.values(state.tasks).filter((t) => t.kind === 'supervision' && isActiveProjectId(state.projects,t.projectId) && ((t.assigneeUserId === me.id && ['assigned', 'rework'].includes(t.flow ?? '')) || (t.reviewerId === me.id && t.flow === 'in_review'))).length
                : p === 'team' ? Object.values(state.tasks).filter((t) => t.kind === 'internal' && ((t.assigneeUserId === me.id && ['assigned', 'rework'].includes(t.flow ?? '')) || (t.reviewerId === me.id && t.flow === 'in_review'))).length
                  : p === 'inbox' ? state.adminRequests.filter((r) => can.decideRequest(r) || can.handleItRequest(r)).length
                    : p === 'timesheet' ? Object.values(state.timesheets).filter((d) => d.userId === me.id && d.calc.undecided > 0).length
                      : p === 'finadmin' ? Object.values(state.tasks).filter((t) => t.kind === 'finadmin' && can.viewTask(t) && ((t.assigneeUserId === me.id && ['assigned', 'rework'].includes(t.flow ?? '')) || (t.reviewerId === me.id && t.flow === 'in_review'))).length : 0
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <Logo className="h-8 w-8 text-foreground" />
        <div className="leading-tight">
          <div className="text-[18px] font-normal tracking-[0.28em]">PARGAR</div>
          <div className="text-[11px] text-muted-foreground">Avand Workspace</div>
        </div>
      </div>
      {/* nav and projects scroll on short screens so the footer stays reachable */}
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-3">
      <nav className="flex flex-col gap-4 px-3" aria-label="Main navigation">
        {NAV.map((g) => {
          const items = g.items.filter((x) => can.page(x.page))
          if (!items.length) return null
          return (
            <div key={g.group} className="flex flex-col gap-1.5">
              <div className="eyebrow px-2.5 pb-0.5">{g.group}</div>
              {items.map((x) => {
                const Icon = x.icon
                const badge = badgeOf(x.page)
                // the section is named after the spaces this person may open: both for the CEO, one for each manager
                const fin = x.page === 'finadmin' ? finSpacesOf(me) : []
                const label = x.page !== 'finadmin' || fin.length !== 1 ? x.label : fin[0] === 'finance' ? 'Finance' : 'Administration'
                return (
                  <button key={x.page} onClick={() => { go(x.page); onNavigate?.() }}
                    aria-current={current === x.page ? 'page' : undefined}
                    className="studio-nav-item">
                    <Icon className="size-5" strokeWidth={1.5} />
                    <span className="flex-1 text-start">{label}</span>
                    {badge > 0 && <span className="num rounded-full bg-azure px-1.5 text-[11px] font-semibold text-azure-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.25)]">{n(badge)}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>
      <div className="mt-5 px-4">
        <div className="eyebrow mb-1.5">My Projects</div>
        <div className="flex flex-col">
          {myResponsibilityProjects(state, me.id).map((p) => (
            <button key={p.id} onClick={() => { dispatch({ type: 'nav', nav: { page: 'project', projectId: p.id } }); onNavigate?.() }}
              className={cn('flex items-center gap-2 rounded-lg px-1.5 py-1 text-start text-[12.5px] transition-colors hover:bg-foreground/[0.06]', state.nav.page === 'project' && state.nav.projectId === p.id ? 'bg-foreground/[0.06] font-semibold text-foreground' : 'text-muted-foreground')}>
              <span className="mono w-8 shrink-0 text-[10.5px]">{p.code}</span><span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      </div>
      <div className="glass-divider shrink-0 space-y-2 border-t p-3">
        <button aria-current={current === 'settings' ? 'page' : undefined} className="studio-nav-item w-full" onClick={() => { go('settings'); onNavigate?.() }}>
          <Settings className="size-5" strokeWidth={1.5} /> Settings
        </button>
        <ProfileMenu sidebar onAction={onNavigate} />
      </div>
    </div>
  )
}

function Main() {
  const { state, can } = useStore()
  const p = state.nav.page
  if (!can.page(p)) {
    if (p === 'requests' || p === 'timesheet') return <Empty title="This section is unavailable to the CEO." />
    if (p === 'inbox') return <Empty icon={<Lock className="h-6 w-6" />} title="Your role does not have access to this inbox." hint="Track your own requests in My Requests." />
    if (p === 'adminreports') return <Empty icon={<Lock className="h-6 w-6" />} title="Office reports are available to the CEO, Project Controls and the Office Manager." hint="See your own timesheet and requests in the Office section." />
    if (p === 'finadmin') return <Empty icon={<Lock className="h-6 w-6" />} title="This workspace is restricted to the CEO, Finance Manager and Office Manager." hint="Your role does not have access to this section or its tasks." />
    return <Empty icon={<Lock className="h-6 w-6" />} title="This section is available to the CEO and Project Controls." hint="See your own points in Profile → My Points." />
  }
  switch (p) {
    case 'documents': return <DocumentsPage />
    case 'links': return <LinksPage />
    case 'home': return <Home />
    case 'settings': return <SettingsPage />
    case 'notifications': return <Notifications />
    case 'projects': return <Projects />
    case 'project': return <ProjectPage projectId={state.nav.projectId ?? ''} />
    case 'pchat': return <ChatPage kind="project" />
    case 'chat': return <ChatPage kind="general" />
    case 'workload': return <Workload />
    case 'review': return <SyncReview />
    case 'runs': return <SyncRuns />
    case 'admin': return <Admin />
    case 'supervision': return <SupervisionPage />
    case 'team': return <TeamSpace teamId={state.nav.teamId} />
    case 'points': return <PointsReport />
    case 'requests': return <RequestsPage />
    case 'timesheet': return <TimesheetPage />
    case 'inbox': return <InboxPage />
    case 'adminreports': return <AdminReportsPage />
    case 'personal': return <PersonalPage />
    case 'finadmin': return <FinAdminPage />
  }
}

function Shell() {
  const [menu, setMenu] = useState(false)
  const { state } = useStore()
  if (!state.session) return <Auth />
  return (
    <div className="studio-shell flex min-h-full">
      <div className="studio-sidebar-column hidden shrink-0 lg:block">
        <aside className="studio-sidebar glass-card thin-scroll sticky overflow-y-auto" aria-label="Sidebar">
          <SidebarContent />
        </aside>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMenu(true)} />
        <main className={cn("mx-auto w-full max-w-[1440px] flex-1 py-6", state.nav.page !== 'home' && "lg:py-8")} style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }} key={JSON.stringify([state.nav.page, state.nav.projectId, state.nav.teamId, state.nav.requestId, state.nav.userId, state.nav.date])}>
          <div className="page-enter lg:px-4"><Main /></div>
        </main>
      </div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="studio-mobile-sidebar w-[min(300px,calc(100vw-24px))] p-0" dir="ltr" style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setMenu(false)} />
        </SheetContent>
      </Sheet>
      <TaskDrawer />
      <ProfileDialog />
    </div>
  )
}

function ThemedToaster() {
  const { state } = useStore()
  return (
    <Toaster dir="ltr" position="bottom-right" theme={state.theme} toastOptions={{
      style: {
        fontFamily: 'var(--font-sans)',
        background: 'var(--glass-bg-strong)',
        color: 'hsl(var(--foreground))',
        border: '1px solid var(--glass-border)',
        borderRadius: 16,
        boxShadow: 'inset 0 1px 0 var(--glass-highlight), 0 0 0 1px var(--glass-edge), var(--glass-shadow-pop)',
        backdropFilter: 'blur(var(--glass-blur-strong)) saturate(170%)',
        WebkitBackdropFilter: 'blur(var(--glass-blur-strong)) saturate(170%)',
      },
    }} />
  )
}

export default function App() {
  return (
    <DirectionProvider dir="ltr">
      <StoreProvider>
        <Shell />
        <ThemedToaster />
      </StoreProvider>
    </DirectionProvider>
  )
}
