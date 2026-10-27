import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DisciplineProvider } from './context/DisciplineContext'
import { ToastProvider } from './context/ToastContext'
import { StudentAuthPage } from './pages/StudentAuthPage'
import { AdminLoginPage } from './pages/AdminLoginPage'
import { StudentJournalPage } from './pages/StudentJournalPage'
import { StudentAssignmentsPage } from './pages/StudentAssignmentsPage'
import { AdminJournalPage } from './pages/AdminJournalPage'
import { AdminAssignmentsPage } from './pages/AdminAssignmentsPage'
import { AdminGroupsPage } from './pages/AdminGroupsPage'
import { TeacherProfilePage } from './pages/TeacherProfilePage'
import { Loader2 } from 'lucide-react'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) {
    return (
      <div className="app-loading">
        <Loader2 className="spin" size={30} />
        <span>Открываем дневник…</span>
      </div>
    )
  }
  if (!profile) return <Navigate to="/" replace />
  return <>{children}</>
}

function RequireRole({ role, children }: { role: 'student' | 'admin'; children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) {
    return (
      <div className="app-loading">
        <Loader2 className="spin" size={30} />
        <span>Открываем дневник…</span>
      </div>
    )
  }
  if (!profile) {
    return <Navigate to={role === 'admin' ? '/admin' : '/'} replace />
  }
  if (role === 'student' && profile.role !== 'student') {
    return <Navigate to="/admin/journal" replace />
  }
  if (role === 'admin' && profile.role !== 'admin') {
    return <Navigate to="/admin" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <DisciplineProvider>
          <Routes>
          <Route path="/" element={<StudentAuthPage />} />
          <Route
            path="/journal"
            element={
              <RequireRole role="student">
                <StudentJournalPage />
              </RequireRole>
            }
          />
          <Route
            path="/assignments"
            element={
              <RequireRole role="student">
                <StudentAssignmentsPage />
              </RequireRole>
            }
          />
          <Route path="/admin" element={<AdminLoginPage />} />
          <Route
            path="/admin/journal"
            element={
              <RequireRole role="admin">
                <AdminJournalPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/assignments"
            element={
              <RequireRole role="admin">
                <AdminAssignmentsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/groups"
            element={
              <RequireRole role="admin">
                <AdminGroupsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/profile"
            element={
              <RequireRole role="admin">
                <TeacherProfilePage self />
              </RequireRole>
            }
          />
          <Route
            path="/teacher/:teacherId"
            element={
              <RequireAuth>
                <TeacherProfilePage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </DisciplineProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
