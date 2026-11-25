import { useEffect, useRef } from 'react'
import { getRemote, useStore } from '@/lib/store'

/** The original English reference renders in its own document so application styles cannot change it. */
export function Auth() {
  const frame = useRef<HTMLIFrameElement>(null)
  const { dispatch } = useStore()

  useEffect(() => {
    function onReferenceMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'AVAND_SIGNED_IN') void getRemote().boot()
      if (event.data?.type === 'AVAND_AUTH_THEME') {
        const theme = event.data.theme
        if (theme === 'light' || theme === 'dark') dispatch({ type: 'setTheme', theme })
      }
    }

    window.addEventListener('message', onReferenceMessage)
    return () => window.removeEventListener('message', onReferenceMessage)
  }, [dispatch])

  return <iframe ref={frame} src="/auth/login.html" title="Avand sign in" className="fixed inset-0 block h-full w-full border-0" />
}
