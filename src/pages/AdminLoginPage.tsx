import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  GraduationCap,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ErrorBox } from '../components/Feedback'

type Tab = 'login' | 'register'

export function AdminLoginPage() {
  const { profile, loading, login, logout, registerTeacher } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('login')
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fullName, setFullName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingRegistration, setPendingRegistration] = useState(false)
  const [registered, setRegistered] = useState<{ login: string; fullName: string } | null>(null)

  if (loading) {
    return (
      <div className="auth-page auth-page--loading">
        <Loader2 className="spin" size={28} /> <span>Загружаем кабинет…</span>
      </div>
    )
  }

  if (profile?.role === 'admin' && !pendingRegistration) {
    return <Navigate to="/admin/journal" replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!loginValue.trim() || !password) {
      setError('Введите логин и пароль')
      return
    }
    setBusy(true)
    try {
      const value = await login(loginValue.trim(), password)
      if (value.role !== 'admin') {
        await logout()
        setError('Этот аккаунт не является преподавательским. Войдите как студент на главной странице.')
        return
      }
      navigate('/admin/journal', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (fullName.trim().split(/\s+/).length < 3) {
      setError('Укажите ФИО полностью: фамилия, имя и отчество')
      return
    }
    if (password.length < 8) {
      setError('Пароль должен содержать минимум 8 символов')
      return
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают')
      return
    }
    setBusy(true)
    setPendingRegistration(true)
    try {
      const value = await registerTeacher(fullName.trim(), password)
      setRegistered({ login: value.login, fullName: value.profile.full_name })
    } catch (err) {
      setPendingRegistration(false)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const switchTab = (next: Tab) => {
    setTab(next)
    setError('')
  }

  return (
    <div className="admin-login">
      <div className="admin-login__decor" aria-hidden="true" />
      <div className="admin-login__card">
        <div className="admin-login__brand">
          <span className="admin-login__mark">
            <GraduationCap size={26} />
          </span>
          <span>
            <strong>Кабинет преподавателя</strong>
            <small>Электронный дневник</small>
          </span>
        </div>

        <div className="admin-login__teacher">
          <span className="admin-login__avatar">
            <Users size={19} />
          </span>
          <div>
            <strong>Преподаватели</strong>
            <span>журнал, дисциплины и проверка работ</span>
          </div>
        </div>

        {registered ? (
          <div className="teacher-registered">
            <span className="teacher-registered__icon">
              <ShieldCheck size={24} />
            </span>
            <h2>Кабинет создан</h2>
            <p>
              <strong>{registered.fullName}</strong>, сохраните логин — он понадобится для
              следующего входа.
            </p>
            <div className="teacher-registered__login">
              <span>Ваш логин</span>
              <code>{registered.login}</code>
            </div>
            <p className="muted">
              Пароль — тот, который вы придумали при регистрации. Теперь создайте первую
              дисциплину и привяжите её к группе.
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => navigate('/admin/journal', { replace: true })}
            >
              Перейти в журнал
            </button>
          </div>
        ) : profile?.role === 'student' ? (
          <div className="admin-login__student">
            <p>
              Вы вошли как студент <strong>{profile.full_name}</strong>. Для входа в кабинет
              преподавателя нужно выйти из студенческого аккаунта.
            </p>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => logout()}
            >
              Выйти из аккаунта студента
            </button>
          </div>
        ) : (
          <>
            <div className="auth-tabs" role="tablist" aria-label="Вход или регистрация">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'login'}
                className={tab === 'login' ? 'is-active' : ''}
                onClick={() => switchTab('login')}
              >
                Вход
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'register'}
                className={tab === 'register' ? 'is-active' : ''}
                onClick={() => switchTab('register')}
              >
                Регистрация
              </button>
            </div>

            {tab === 'login' ? (
              <form className="form" onSubmit={handleSubmit}>
                {error ? <ErrorBox>{error}</ErrorBox> : null}
                <label className="field">
                  <span>Логин преподавателя</span>
                  <div className="input-with-icon">
                    <KeyRound size={17} />
                    <input
                      name="adminLogin"
                      autoComplete="username"
                      value={loginValue}
                      onChange={(event) => setLoginValue(event.target.value)}
                      placeholder="логин или email"
                      data-testid="admin-login-input"
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Пароль</span>
                  <div className="input-with-icon">
                    <LockKeyhole size={17} />
                    <input
                      name="adminPassword"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="пароль"
                      data-testid="admin-password-input"
                    />
                  </div>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(event) => setShowPassword(event.target.checked)}
                  />
                  <span>Показать пароль</span>
                </label>
                <button
                  type="submit"
                  className="btn btn--primary btn--block"
                  disabled={busy}
                  data-testid="admin-login-submit"
                >
                  {busy ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
                  {busy ? 'Проверяем…' : 'Войти в кабинет'}
                </button>
              </form>
            ) : (
              <form className="form" onSubmit={handleRegister}>
                {error ? <ErrorBox>{error}</ErrorBox> : null}
                <label className="field">
                  <span>ФИО преподавателя</span>
                  <div className="input-with-icon">
                    <UserPlus size={17} />
                    <input
                      name="teacherFullName"
                      autoComplete="name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      placeholder="Фамилия Имя Отчество"
                      required
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Пароль</span>
                  <div className="input-with-icon">
                    <LockKeyhole size={17} />
                    <input
                      name="teacherPassword"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="минимум 8 символов"
                      required
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Повторите пароль</span>
                  <div className="input-with-icon">
                    <LockKeyhole size={17} />
                    <input
                      name="teacherPasswordConfirm"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="ещё раз"
                      required
                    />
                  </div>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(event) => setShowPassword(event.target.checked)}
                  />
                  <span>Показать пароли</span>
                </label>
                <p className="muted admin-login__hint">
                  Регистрация доступна только преподавателям из утверждённого списка. После
                  создания кабинета вы попадёте в «Журнал» и создадите свою дисциплину.
                </p>
                <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
                  {busy ? <Loader2 className="spin" size={18} /> : <UserPlus size={18} />}
                  {busy ? 'Создаём кабинет…' : 'Зарегистрироваться'}
                </button>
              </form>
            )}
          </>
        )}

        <div className="admin-login__foot">
          <Link to="/" className="subtle-link">
            <ArrowLeft size={14} /> На страницу студентов
          </Link>
          <span className="muted">Только для преподавателей</span>
        </div>
      </div>
    </div>
  )
}
