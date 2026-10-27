import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  BookOpenCheck,
  ClipboardList,
  GraduationCap,
  Layers3,
  LogOut,
  Repeat2,
  RotateCcw,
  UserRound,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDisciplines } from '../context/DisciplineContext'
import { backend, isDemoMode } from '../lib/api'
import { formatSize } from '../lib/format'
import { Avatar } from './Avatar'

interface AppShellProps {
  role: 'student' | 'admin'
  children: React.ReactNode
}

const STUDENT_LINKS = [
  { to: '/journal', label: 'Журнал', icon: ClipboardList },
  { to: '/assignments', label: 'Задания', icon: BookOpenCheck },
]

const ADMIN_LINKS = [
  { to: '/admin/journal', label: 'Журнал', icon: ClipboardList },
  { to: '/admin/assignments', label: 'Задания', icon: BookOpenCheck },
  { to: '/admin/groups', label: 'Группы', icon: Users },
  { to: '/admin/profile', label: 'Профиль', icon: UserRound },
]

export function AppShell({ role, children }: AppShellProps) {
  const { profile, logout } = useAuth()
  const { active, select } = useDisciplines()
  const navigate = useNavigate()
  const [resetting, setResetting] = useState(false)
  const links = role === 'admin' ? ADMIN_LINKS : STUDENT_LINKS
  const home = role === 'admin' ? '/admin/journal' : '/journal'

  const handleLogout = async () => {
    await logout()
    navigate(role === 'admin' ? '/admin' : '/', { replace: true })
  }

  const handleResetDemo = async () => {
    if (!backend.resetDemo) return
    if (!window.confirm('Сбросить демо-данные? Все тестовые профили и работы будут удалены.')) return
    setResetting(true)
    try {
      await backend.resetDemo()
      navigate('/', { replace: true })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <button type="button" className="brand" onClick={() => navigate(home)}>
            <span className="brand__mark" aria-hidden="true">
              <GraduationCap size={24} />
            </span>
            <span className="brand__text">
              <strong>Электронный дневник</strong>
              <span>{role === 'admin' ? 'Кабинет преподавателя' : 'Дневник студента'}</span>
            </span>
          </button>

          <div className="topbar__right">
            {active ? (
              <button
                type="button"
                className="discipline-chip"
                onClick={() => {
                  select(null)
                  navigate(home)
                }}
                title="Сменить дисциплину"
              >
                <Layers3 size={16} />
                <span className="discipline-chip__text">
                  <strong>{active.name}</strong>
                  <span>группа {active.group_name}</span>
                </span>
                <Repeat2 size={14} />
              </button>
            ) : null}
            {profile ? (
              profile.role === 'admin' ? (
                <Link
                  to="/admin/profile"
                  className="user-chip user-chip--link"
                  title={`${profile.full_name} · открыть профиль`}
                >
                  <Avatar profile={profile} />
                  <span className="user-chip__text">
                    <strong>{profile.full_name}</strong>
                    <span>преподаватель</span>
                  </span>
                </Link>
              ) : (
                <div className="user-chip" title={profile.full_name}>
                  <Avatar profile={profile} />
                  <span className="user-chip__text">
                    <strong>{profile.full_name}</strong>
                    <span>группа {profile.group_name}</span>
                  </span>
                </div>
              )
            ) : null}
            <button
              type="button"
              className="icon-btn icon-btn--ghost"
              onClick={handleLogout}
              title="Выйти"
              aria-label="Выйти"
              data-testid="logout"
            >
              <LogOut size={19} />
            </button>
          </div>
        </div>

        <nav className="main-nav" aria-label="Основная навигация">
          <div className="main-nav__inner">
            {links.map((link) => {
              const Icon = link.icon
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `main-nav__link ${isActive ? 'is-active' : ''}`}
                >
                  <Icon size={18} />
                  <span>{link.label}</span>
                </NavLink>
              )
            })}
          </div>
        </nav>
      </header>

      <main className="page">{children}</main>

      <footer className="app-footer">
        <div className="app-footer__inner">
          <span>
            {role === 'admin'
              ? profile?.full_name || 'Преподаватель'
              : `Преподаватель: ${active?.teacher_name || '—'}`}{' '}
            · Электронный дневник
          </span>
          {isDemoMode ? (
            <span className="demo-note">
              <span className="demo-dot" /> Демо-режим · данные только в этом браузере
              <button
                type="button"
                className="text-btn"
                onClick={handleResetDemo}
                disabled={resetting}
              >
                <RotateCcw size={13} /> сбросить
              </button>
            </span>
          ) : (
            <span className="muted">Файлы хранятся в приватном Supabase Storage</span>
          )}
        </div>
      </footer>
    </div>
  )
}

export function SubmissionSizeHint({ size }: { size: number | null }) {
  return <span className="muted">{formatSize(size)}</span>
}
