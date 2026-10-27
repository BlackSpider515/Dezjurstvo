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
import type { Profile, StudentCredentials, TeacherRegistration } from '../lib/types'

interface AuthContextValue {
  profile: Profile | null
  loading: boolean
  login: (login: string, password: string) => Promise<Profile>
  logout: () => Promise<void>
  register: (fullName: string, groupName: string) => Promise<StudentCredentials>
  registerTeacher: (fullName: string, password: string) => Promise<TeacherRegistration>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    backend.auth
      .getProfile()
      .then((value) => {
        if (mounted) setProfile(value)
      })
      .catch(() => {
        if (mounted) setProfile(null)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    const unsubscribe = backend.auth.onAuthChange((value) => {
      if (mounted) {
        setProfile(value)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const login = useCallback(async (loginValue: string, password: string) => {
    const value = await backend.auth.signIn(loginValue, password)
    setProfile(value)
    return value
  }, [])

  const logout = useCallback(async () => {
    await backend.auth.signOut()
    setProfile(null)
  }, [])

  const register = useCallback(async (fullName: string, groupName: string) => {
    return backend.auth.register(fullName, groupName)
  }, [])

  const registerTeacher = useCallback(async (fullName: string, password: string) => {
    const value = await backend.auth.registerTeacher(fullName, password)
    setProfile(value.profile)
    return value
  }, [])

  const refreshProfile = useCallback(async () => {
    const value = await backend.auth.getProfile()
    setProfile(value)
  }, [])

  const value = useMemo(
    () => ({ profile, loading, login, logout, register, registerTeacher, refreshProfile }),
    [profile, loading, login, logout, register, registerTeacher, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth должен использоваться внутри AuthProvider')
  return value
}
