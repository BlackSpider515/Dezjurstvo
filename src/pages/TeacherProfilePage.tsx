import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  Loader2,
  Mail,
  Phone,
  Save,
  Trash2,
  UserRound,
} from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Avatar } from '../components/Avatar'
import { ErrorBox, Spinner } from '../components/Feedback'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { backend } from '../lib/api'
import { prepareAvatar } from '../lib/avatar'
import { PROFILE_LIMITS, validateTeacherProfile } from '../lib/profile'
import type { Profile } from '../lib/types'

export function TeacherProfilePage({ self = false }: { self?: boolean }) {
  const { teacherId } = useParams()
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()
  const targetId = self ? profile?.id ?? null : teacherId ?? null
  const isSelf = Boolean(profile && profile.role === 'admin' && profile.id === targetId)

  const [teacher, setTeacher] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!targetId) {
      setLoading(false)
      setError('Преподаватель не найден')
      return
    }
    let mounted = true
    setLoading(true)
    setError('')
    backend.profiles
      .getTeacher(targetId)
      .then((value) => {
        if (!mounted) return
        if (!value) {
          setError('Преподаватель не найден')
          setTeacher(null)
          return
        }
        setTeacher(value)
        setEmail(value.contact_email ?? '')
        setPhone(value.phone ?? '')
        setBio(value.bio ?? '')
      })
      .catch((err: Error) => {
        if (mounted) setError(err.message)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [targetId])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setFormError('')
    const input = {
      contact_email: email.trim() || null,
      phone: phone.trim() || null,
      bio: bio.trim() || null,
    }
    const message = validateTeacherProfile(input)
    if (message) {
      setFormError(message)
      return
    }
    setSaving(true)
    try {
      const value = await backend.profiles.updateMine(input)
      setTeacher(value)
      setEmail(value.contact_email ?? '')
      setPhone(value.phone ?? '')
      setBio(value.bio ?? '')
      await refreshProfile()
      toast.success('Профиль сохранён')
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAvatarBusy(true)
    try {
      const prepared = await prepareAvatar(file)
      const value = await backend.profiles.uploadAvatar(prepared)
      setTeacher(value)
      await refreshProfile()
      toast.success('Аватар обновлён')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAvatarBusy(false)
    }
  }

  const removeAvatar = async () => {
    if (!teacher?.avatar_url) return
    setAvatarBusy(true)
    try {
      const value = await backend.profiles.removeAvatar()
      setTeacher(value)
      await refreshProfile()
      toast.success('Аватар удалён')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAvatarBusy(false)
    }
  }

  const backTo = profile?.role === 'admin' ? '/admin/journal' : '/journal'

  return (
    <AppShell role={profile?.role ?? 'student'}>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            {isSelf ? 'Кабинет преподавателя' : 'Профиль преподавателя'}
          </span>
          <h1>{isSelf ? 'Мой профиль' : teacher?.full_name || 'Преподаватель'}</h1>
          <p>
            {isSelf
              ? 'Заполните контакты и описание — студенты увидят эту информацию на странице преподавателя.'
              : 'Контактные данные преподавателя по вашей дисциплине.'}
          </p>
        </div>
        <div className="page-head__actions">
          <Link to={backTo} className="btn btn--ghost btn--sm">
            <ArrowLeft size={16} /> Назад
          </Link>
        </div>
      </div>

      {loading ? (
        <Spinner label="Загружаем профиль…" />
      ) : error || !teacher ? (
        <ErrorBox>{error || 'Преподаватель не найден'}</ErrorBox>
      ) : (
        <div className="profile-layout">
          <aside className="profile-card">
            <Avatar profile={teacher} size="xl" />
            <h2>{teacher.full_name}</h2>
            <span className="badge badge--blue">
              <UserRound size={13} /> Преподаватель
            </span>

            {isSelf ? (
              <div className="profile-card__avatar-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={chooseAvatar}
                  hidden
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarBusy}
                >
                  {avatarBusy ? <Loader2 className="spin" size={15} /> : <Camera size={15} />}
                  Сменить фото
                </button>
                {teacher.avatar_url ? (
                  <button
                    type="button"
                    className="text-btn text-btn--danger"
                    onClick={removeAvatar}
                    disabled={avatarBusy}
                  >
                    <Trash2 size={13} /> Удалить
                  </button>
                ) : null}
              </div>
            ) : null}

            <dl className="profile-contacts">
              <div>
                <dt>
                  <Mail size={14} /> Почта
                </dt>
                <dd>
                  {teacher.contact_email ? (
                    <a href={`mailto:${teacher.contact_email}`}>{teacher.contact_email}</a>
                  ) : (
                    <span className="muted">Не указана</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  <Phone size={14} /> Телефон
                </dt>
                <dd>
                  {teacher.phone ? (
                    <a href={`tel:${teacher.phone.replace(/[^+\d]/g, '')}`}>{teacher.phone}</a>
                  ) : (
                    <span className="muted">Не указан</span>
                  )}
                </dd>
              </div>
            </dl>
          </aside>

          <section className="profile-panel">
            {isSelf ? (
              <form className="profile-form" onSubmit={save}>
                <div>
                  <span className="eyebrow">Как вас видят студенты</span>
                  <h2>Контактные данные</h2>
                  <p className="muted">
                    Почта и телефон необязательны. Описание поможет студентам понять, как с вами
                    связаться.
                  </p>
                </div>

                <div className="form-row form-row--two">
                  <label className="field">
                    <span>Почта</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="teacher@example.com"
                      maxLength={PROFILE_LIMITS.email}
                    />
                  </label>
                  <label className="field">
                    <span>Телефон</span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="+7 900 000-00-00"
                      maxLength={PROFILE_LIMITS.phone}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Описание</span>
                  <textarea
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    placeholder="Например: веду информатику, консультации по средам после 16:00."
                    maxLength={PROFILE_LIMITS.bio}
                    rows={6}
                  />
                  <small className="field__counter">
                    {bio.length} / {PROFILE_LIMITS.bio}
                  </small>
                </label>

                {formError ? <ErrorBox>{formError}</ErrorBox> : null}

                <div className="profile-form__actions">
                  <button type="submit" className="btn btn--primary" disabled={saving}>
                    {saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                    Сохранить профиль
                  </button>
                </div>
              </form>
            ) : (
              <div className="profile-readonly">
                <span className="eyebrow">О преподавателе</span>
                <h2>{teacher.full_name}</h2>
                <p className={teacher.bio ? '' : 'muted'}>
                  {teacher.bio || 'Преподаватель пока не добавил описание.'}
                </p>
                <div className="profile-readonly__contacts">
                  <span>
                    <Mail size={15} />
                    {teacher.contact_email ? (
                      <a href={`mailto:${teacher.contact_email}`}>{teacher.contact_email}</a>
                    ) : (
                      'Почта не указана'
                    )}
                  </span>
                  <span>
                    <Phone size={15} />
                    {teacher.phone ? (
                      <a href={`tel:${teacher.phone.replace(/[^+\d]/g, '')}`}>{teacher.phone}</a>
                    ) : (
                      'Телефон не указан'
                    )}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  )
}
