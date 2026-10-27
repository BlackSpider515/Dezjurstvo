import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { backend } from '../lib/api'
import type { Discipline } from '../lib/types'
import { useAuth } from './AuthContext'

interface DisciplineContextValue {
  disciplines: Discipline[]
  active: Discipline | null
  loading: boolean
  error: string
  select: (id: string | null) => void
  refresh: () => Promise<void>
}

const DisciplineContext = createContext<DisciplineContextValue | null>(null)

function storageKey(profileId: string): string {
  return `diary_discipline_${profileId}`
}

function savedDiscipline(profileId: string): string | null {
  try {
    return localStorage.getItem(storageKey(profileId))
  } catch {
    return null
  }
}

export function DisciplineProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const profileId = profile?.id ?? null

  const load = useCallback(
    async (keepSelection: boolean) => {
      if (!profileId) {
        setDisciplines([])
        setActiveId(null)
        setLoading(false)
        setError('')
        return
      }
      setLoading(true)
      setError('')
      try {
        const list = await backend.disciplines.list()
        setDisciplines(list)
        setActiveId((current) => {
          if (keepSelection && current && list.some((item) => item.id === current)) {
            return current
          }
          const saved = savedDiscipline(profileId)
          const savedValid = saved && list.some((item) => item.id === saved) ? saved : null
          if (savedValid) return savedValid
          if (list.length === 1) return list[0].id
          return null
        })
      } catch (err) {
        setDisciplines([])
        setActiveId(null)
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [profileId],
  )

  useEffect(() => {
    setDisciplines([])
    setActiveId(null)
    void load(false)
  }, [load])

  const select = useCallback(
    (id: string | null) => {
      setActiveId(id)
      if (!profileId) return
      try {
        if (id) localStorage.setItem(storageKey(profileId), id)
        else localStorage.removeItem(storageKey(profileId))
      } catch {
        // localStorage может быть недоступен в приватном режиме.
      }
    },
    [profileId],
  )

  const refresh = useCallback(async () => {
    await load(true)
  }, [load])

  const active = disciplines.find((item) => item.id === activeId) ?? null

  const value = useMemo(
    () => ({ disciplines, active, loading, error, select, refresh }),
    [disciplines, active, loading, error, select, refresh],
  )

  return <DisciplineContext.Provider value={value}>{children}</DisciplineContext.Provider>
}

export function useDisciplines(): DisciplineContextValue {
  const value = useContext(DisciplineContext)
  if (!value) {
    throw new Error('useDisciplines должен использоваться внутри DisciplineProvider')
  }
  return value
}
