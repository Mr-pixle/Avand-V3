import { useSyncExternalStore } from 'react'
import type { ThemeChoice } from './state'

const key = (id: string, preference: string) => 'avand:' + id + ':' + preference

export function readTheme(id: string): ThemeChoice {
  try {
    const value = localStorage.getItem(key(id, 'theme'))
    if (value === 'light' || value === 'dark') return value
  } catch { /* storage unavailable */ }
  return 'system'
}

export function saveTheme(id: string, theme: ThemeChoice) {
  try { localStorage.setItem(key(id, 'theme'), theme) } catch { /* storage unavailable */ }
}

export type EnglishLocale = 'en-GB' | 'en-US'
const languageEvent = 'avand-display-language'
function subscribe(onChange: () => void) {
  window.addEventListener(languageEvent, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(languageEvent, onChange)
    window.removeEventListener('storage', onChange)
  }
}
export function useEnglishLocale(id?: string | null): EnglishLocale {
  return useSyncExternalStore(subscribe, () => {
    try { if (id && localStorage.getItem(key(id, 'language')) === 'en-US') return 'en-US' } catch { /* storage unavailable */ }
    return 'en-GB'
  })
}
export function saveEnglishLocale(id: string, locale: EnglishLocale) {
  try { localStorage.setItem(key(id, 'language'), locale) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(languageEvent))
}
