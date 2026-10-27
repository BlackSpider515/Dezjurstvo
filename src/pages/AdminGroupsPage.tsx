import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { Modal } from '../components/Modal'
import { EmptyState, ErrorBox, Spinner } from '../components/Feedback'
import { useDisciplines } from '../context/DisciplineContext'
import { useToast } from '../context/ToastContext'
import { backend } from '../lib/api'
import { formatDate, plural } from '../lib/format'
import type { Group, Profile } from '../lib/types'

interface GroupRow {
  group: Group
  students: Profile[]
}

export function AdminGroupsPage() {
  const toast = useToast()
  const { refresh: refreshDisciplines } = useDisciplines()
  const [rows, setRows] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Group | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const groups = await backend.groups.list()
      const withDetails = await Promise.all(
        groups.map(async (group) => ({
          group,
          students: await backend.students(group.name),
        })),
      )
      setRows(withDetails)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const openCreate = () => {
    setRenameTarget(null)
    setName('')
    setFormError('')
    setDialogOpen(true)
  }

  const openRename = (group: Group) => {
    setRenameTarget(group)
    setName(group.name)
    setFormError('')
    setDialogOpen(true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError('')
    const value = name.trim()
    if (!value) {
      setFormError('Введите название группы')
      return
    }
    if (value.length > 20) {
      setFormError('Название группы — не больше 20 символов')
      return
    }
    setBusy(true)
    try {
      if (renameTarget) {
        await backend.groups.rename(renameTarget.name, value)
        void refreshDisciplines()
        toast.success(`Группа ${renameTarget.name} переименована в ${value}`)
      } else {
        await backend.groups.create(value)
        toast.success(`Группа ${value} создана`)
      }
      setDialogOpen(false)
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openDelete = (row: GroupRow) => {
    setDeleteTarget(row)
    setDeleteError('')
  }

  const removeGroup = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await backend.groups.remove(deleteTarget.group.name)
      void refreshDisciplines()
      toast.success(`Группа ${deleteTarget.group.name} удалена`)
      setDeleteTarget(null)
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleteBusy(false)
    }
  }

  const totalStudents = rows.reduce((sum, row) => sum + row.students.length, 0)

  return (
    <AppShell role="admin">
      <div className="page-head">
        <div>
          <span className="eyebrow">Структура дневника</span>
          <h1>Группы</h1>
          <p>
            {rows.length} {plural(rows.length, ['группа', 'группы', 'групп'])} · {totalStudents}{' '}
            {plural(totalStudents, ['студент', 'студента', 'студентов'])} · студенты появляются
            после самостоятельной регистрации
          </p>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={openCreate}
            data-testid="add-group"
          >
            <Plus size={16} /> Добавить группу
          </button>
        </div>
      </div>

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {loading && !rows.length ? (
        <Spinner label="Загружаем группы…" />
      ) : rows.length ? (
        <div className="group-grid">
          {rows.map((row) => {
            const { group, students } = row
            return (
            <article className="group-card" key={group.name}>
              <header className="group-card__head">
                <span className="group-card__mark">
                  <GraduationCap size={22} />
                </span>
                <div>
                  <span className="eyebrow">Группа</span>
                  <h2>{group.name}</h2>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => openRename(group)}
                  title="Переименовать группу"
                  aria-label={`Переименовать группу ${group.name}`}
                  data-testid={`rename-group-${group.name}`}
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn group-card__delete"
                  onClick={() => openDelete(row)}
                  title="Удалить группу"
                  aria-label={`Удалить группу ${group.name}`}
                  data-testid={`delete-group-${group.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </header>

              <div className="group-card__stats">
                <div>
                  <strong>{students.length}</strong>
                  <span>{plural(students.length, ['студент', 'студента', 'студентов'])}</span>
                </div>
                <div>
                  <strong>{group.created_at ? formatDate(group.created_at.slice(0, 10)) : '—'}</strong>
                  <span>создана</span>
                </div>
              </div>

              {students.length ? (
                <ul className="group-students">
                  {students.slice(0, 5).map((student) => (
                    <li key={student.id}>
                      <span className="avatar avatar--sm">
                        {student.full_name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join('')}
                      </span>
                      {student.full_name}
                    </li>
                  ))}
                  {students.length > 5 ? (
                    <li className="muted">и ещё {students.length - 5}…</li>
                  ) : null}
                </ul>
              ) : (
                <p className="group-card__empty">
                  <Users size={16} /> Студентов пока нет — рапортичка заполнится после регистрации.
                </p>
              )}

              <footer className="group-card__foot">
                <Link to="/admin/journal" className="text-btn">
                  Перейти в журнал <ArrowRight size={14} />
                </Link>
                <Link to="/admin/assignments" className="text-btn">
                  Работы <ArrowRight size={14} />
                </Link>
              </footer>
            </article>
            )
          })}

          <button type="button" className="group-add-card" onClick={openCreate}>
            <span>
              <Plus size={24} />
            </span>
            <strong>Добавить группу</strong>
            <small>например, 411</small>
          </button>
        </div>
      ) : (
        <EmptyState
          icon={<Users size={30} />}
          title="Групп пока нет"
          text="Создайте первую группу — она появится в списке при регистрации студентов."
          action={
            <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
              <Plus size={15} /> Добавить группу
            </button>
          }
        />
      )}

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={renameTarget ? 'Переименовать группу' : 'Новая группа'}
        subtitle={
          renameTarget
            ? 'Студенты и задания автоматически перейдут в новую группу'
            : 'Студенты увидят группу при регистрации'
        }
        size="sm"
      >
        <form className="form" onSubmit={submit}>
          {formError ? <div className="error-box">{formError}</div> : null}
          <label className="field">
            <span>Название группы</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="211"
              maxLength={20}
              autoFocus
              data-testid="group-name-input"
            />
          </label>
          {renameTarget ? (
            <p className="form-note">
              При переименовании <strong>{renameTarget.name}</strong> все профили студентов и
              задания обновятся каскадно.
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDialogOpen(false)}
              disabled={busy}
            >
              Отмена
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} data-testid="group-save">
              {busy ? <Loader2 className="spin" size={17} /> : renameTarget ? <Pencil size={17} /> : <Plus size={17} />}
              {busy ? 'Сохраняем…' : renameTarget ? 'Переименовать' : 'Создать группу'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleteBusy) setDeleteTarget(null)
        }}
        title="Удалить группу?"
        subtitle="Действие нельзя отменить"
        size="sm"
      >
        {deleteTarget ? (
          <div className="form">
            <p className="form-note">
              Группа <strong>{deleteTarget.group.name}</strong> будет удалена безвозвратно.
              Все дисциплины и задания этой группы удалятся каскадно.
            </p>

            {deleteTarget.students.length ? (
              <div className="error-box">
                В группе есть студенты ({deleteTarget.students.length}). Удалить её нельзя, пока
                студентов не переведут в другую группу или не удалят.
              </div>
            ) : (
              <p className="form-note">Студентов в группе нет — удаление безопасно.</p>
            )}

            {deleteError ? <div className="error-box">{deleteError}</div> : null}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={removeGroup}
                disabled={deleteBusy || deleteTarget.students.length > 0}
                data-testid="delete-group-confirm"
              >
                {deleteBusy ? <Loader2 className="spin" size={17} /> : <Trash2 size={17} />}
                {deleteBusy ? 'Удаляем…' : 'Удалить группу'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </AppShell>
  )
}
