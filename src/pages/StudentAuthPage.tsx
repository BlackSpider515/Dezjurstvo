import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { backend, isDemoMode } from '../lib/api'
import { copyText } from '../lib/clipboard'
import type { Group, StudentCredentials } from '../lib/types'
import { ErrorBox } from '../components/Feedback'

type Tab = 'login' | 'register'

export function StudentAuthPage() {
  const { profile, loading, login, register, logout } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('login')
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fullName, setFullName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [groupsLoading, setGroupsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [credentials, setCredentials] = useState<StudentCredentials | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    backend.groups
      .list()
      .then((list) => {
        setGroups(list)
        setGroupName((current) => current || list[0]?.name || '')
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setGroupsLoading(false))
  }, [])

  const year = useMemo(() => new Date().getFullYear(), [])

  if (loading) {
    return (
      <div className="auth-page auth-page--loading">
        <Loader2 className="spin" size={28} /> <span>Загружаем дневник…</span>
      </div>
    )
  }

  if (profile?.role === 'admin') {
    return <Navigate to="/admin/journal" replace />
  }

  if (profile?.role === 'student') {
    return <Navigate to="/journal" replace />
  }

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!loginValue.trim() || !password) {
      setError('Введите логин и пароль')
      return
    }
    setBusy(true)
    try {
      const value = await login(loginValue.trim(), password)
      if (value.role !== 'student') {
        await logout()
        setError('Это аккаунт преподавателя. Войдите в кабинет преподавателя по ссылке ниже.')
        return
      }
      navigate('/journal', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (fullName.trim().split(/\s+/).length < 2) {
      setError('Укажите фамилию и имя полностью')
      return
    }
    if (!groupName) {
      setError('Выберите группу')
      return
    }
    setBusy(true)
    try {
      const value = await register(fullName.trim(), groupName)
      setCredentials(value)
      setLoginValue(value.login)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleCopyCredentials = async () => {
    if (!credentials) return
    const text = `Логин: ${credentials.login}\nПароль: ${credentials.password}`
    const ok = await copyText(text)
    setCopied(ok)
    window.setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <Link className="auth-brand" to="/">
          <span className="auth-brand__mark">
            <BookOpenCheck size={28} />
          </span>
          <span>
            <strong>Электронный дневник</strong>
            <small>колледж · группа</small>
          </span>
        </Link>

        <div className="auth-hero__content">
          <span className="eyebrow">Цифровая рапортичка</span>
          <h1>
            Все задания,
            <br />
            сдачи и оценки —
            <br />
            <em>в одном месте</em>
          </h1>
          <p>
            Сдавайте работы прямо с телефона, следите за отметками и замечаниями
            преподавателя.
          </p>
          <ul className="auth-benefits">
            <li>
              <CheckCircle2 size={18} /> Журнал своей группы
            </li>
            <li>
              <CheckCircle2 size={18} /> Загрузка файлов до 50 МБ
            </li>
            <li>
              <CheckCircle2 size={18} /> Просмотр работ и замечаний онлайн
            </li>
          </ul>
        </div>

        <div className="paper-preview" aria-hidden="true">
          <div className="paper-preview__head">
            <span>Журнал группы</span>
            <b>211</b>
          </div>
          <div className="paper-preview__grid">
            <span />
            <span>Иванов П.</span>
            <span>Смирнова А.</span>
            <span>Кузнецов Д.</span>
            <span className="paper-preview__task">Задание 1</span>
            <span className="paper-preview__plus">+</span>
            <span />
            <span className="paper-preview__grade">5</span>
            <span className="paper-preview__task">Задание 2</span>
            <span className="paper-preview__plus">+</span>
            <span className="paper-preview__plus">+</span>
            <span />
            <span className="paper-preview__task">Задание 3</span>
            <span />
            <span className="paper-preview__plus">+</span>
            <span className="paper-preview__grade">4</span>
          </div>
          <small>Сдано отмечается «+», оценка — звёздами</small>
        </div>

        <footer className="auth-hero__footer">
          Электронный дневник · {year}
        </footer>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          {credentials ? (
            <div className="credentials" data-testid="credentials">
              <div className="credentials__icon">
                <Sparkles size={26} />
              </div>
              <h2>Аккаунт создан!</h2>
              <p>
                Студент <strong>{credentials.fullName}</strong> добавлен в группу{' '}
                <strong>{credentials.groupName}</strong> и появился в журнале.
              </p>
              <p className="credentials__warn">
                Сохраните логин и пароль — они показываются только один раз.
              </p>
              <div className="credentials__rows">
                <div>
                  <span>Логин</span>
                  <code data-testid="generated-login">{credentials.login}</code>
                </div>
                <div>
                  <span>Пароль</span>
                  <code data-testid="generated-password">{credentials.password}</code>
                </div>
              </div>
              <button type="button" className="btn btn--primary btn--block" onClick={handleCopyCredentials}>
                {copied ? <Check size={17} /> : <Copy size={17} />}
                {copied ? 'Скопировано' : 'Скопировать логин и пароль'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => {
                  setCredentials(null)
                  setTab('login')
                  setPassword('')
                  setError('')
                }}
              >
                Перейти ко входу <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="auth-card__head">
                <span className="auth-card__icon">
                  {tab === 'login' ? <KeyRound size={22} /> : <UserPlus size={22} />}
                </span>
                <div>
                  <h2>{tab === 'login' ? 'Вход для студента' : 'Регистрация'}</h2>
                  <p>
                    {tab === 'login'
                      ? 'Введите логин и пароль, которые получили при регистрации'
                      : 'Укажите ФИО и группу — аккаунт создастся автоматически'}
                  </p>
                </div>
              </div>

              <div className="auth-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'login'}
                  className={tab === 'login' ? 'is-active' : ''}
                  onClick={() => {
                    setTab('login')
                    setError('')
                  }}
                >
                  Вход
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'register'}
                  className={tab === 'register' ? 'is-active' : ''}
                  onClick={() => {
                    setTab('register')
                    setError('')
                  }}
                >
                  Регистрация
                </button>
              </div>

              {error ? <ErrorBox>{error}</ErrorBox> : null}

              {tab === 'login' ? (
                <form className="form" onSubmit={handleLogin}>
                  <label className="field">
                    <span>Логин</span>
                    <div className="input-with-icon">
                      <Users size={17} />
                      <input
                        name="login"
                        autoComplete="username"
                        value={loginValue}
                        onChange={(event) => setLoginValue(event.target.value)}
                        placeholder="например, botnar4821"
                        data-testid="login-input"
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span>Пароль</span>
                    <div className="input-with-icon">
                      <LockKeyhole size={17} />
                      <input
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="пароль из регистрации"
                        data-testid="password-input"
                      />
                      <button
                        type="button"
                        className="input-icon-btn"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </label>
                  <button
                    type="submit"
                    className="btn btn--primary btn--block"
                    disabled={busy}
                    data-testid="login-submit"
                  >
                    {busy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                    {busy ? 'Входим…' : 'Войти в дневник'}
                  </button>
                </form>
              ) : (
                <form className="form" onSubmit={handleRegister}>
                  <label className="field">
                    <span>ФИО</span>
                    <div className="input-with-icon">
                      <UserPlus size={17} />
                      <input
                        name="fullName"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder="Фамилия Имя Отчество"
                        autoComplete="name"
                        data-testid="register-name"
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span>Группа</span>
                    <div className="input-with-icon">
                      <Users size={17} />
                      <select
                        name="groupName"
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        disabled={groupsLoading || !groups.length}
                        data-testid="register-group"
                      >
                        {!groups.length ? <option value="">Нет доступных групп</option> : null}
                        {groups.map((group) => (
                          <option key={group.name} value={group.name}>
                            Группа {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <p className="form-note">
                    <ShieldCheck size={15} />
                    Логин и пароль система сгенерирует сама и покажет один раз. Вводить email не нужно.
                  </p>
                  <button
                    type="submit"
                    className="btn btn--primary btn--block"
                    disabled={busy || groupsLoading}
                    data-testid="register-submit"
                  >
                    {busy ? <Loader2 className="spin" size={18} /> : <ClipboardCheck size={18} />}
                    {busy ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
                  </button>
                </form>
              )}

              <div className="auth-card__foot">
                <Link to="/admin" className="subtle-link">
                  <LockKeyhole size={14} /> Вход для преподавателя
                </Link>
                {isDemoMode ? <span className="demo-pill">демо-режим</span> : null}
              </div>
            </>
          )}
        </div>

        <p className="auth-legal">
          Нажимая кнопку, вы соглашаетесь с использованием сервиса для учебных целей.
          Персональные данные видны только вашей группе и преподавателю.
        </p>
      </section>
    </div>
  )
}
