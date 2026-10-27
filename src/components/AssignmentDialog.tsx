import { useEffect, useState, type FormEvent } from 'react'
import { CalendarDays, Clock3, Layers3, Loader2, Save } from 'lucide-react'
import { Modal } from './Modal'
import type { Assignment, Discipline, GradeType, NewAssignment } from '../lib/types'
import { backend } from '../lib/api'
import { todayISO } from '../lib/format'
import { GRADE_TYPES, toDateTimeLocal } from '../lib/grades'
import { useToast } from '../context/ToastContext'

interface AssignmentDialogProps {
  open: boolean
  discipline: Discipline
  assignment: Assignment | null
  onClose: () => void
  onSaved: (assignment: Assignment) => void
}

export function AssignmentDialog({
  open,
  discipline,
  assignment,
  onClose,
  onSaved,
}: AssignmentDialogProps) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayISO())
  const [lesson, setLesson] = useState(1)
  const [gradeType, setGradeType] = useState<GradeType>('stars')
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setBusy(false)
    if (assignment) {
      setTitle(assignment.title)
      setDescription(assignment.description)
      setDate(assignment.assigned_date)
      setLesson(assignment.lesson_number)
      setGradeType(assignment.grade_type || 'stars')
      setDueAt(toDateTimeLocal(assignment.due_at))
    } else {
      setTitle('')
      setDescription('')
      setDate(todayISO())
      setLesson(1)
      setGradeType('stars')
      setDueAt('')
    }
  }, [open, assignment])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Введите название задания')
      return
    }
    let dueIso: string | null = null
    if (dueAt) {
      const parsed = new Date(dueAt)
      if (Number.isNaN(parsed.getTime())) {
        setError('Некорректный дедлайн')
        return
      }
      dueIso = parsed.toISOString()
    }
    setBusy(true)
    const payload: NewAssignment = {
      title: title.trim(),
      description: description.trim(),
      discipline_id: discipline.id,
      grade_type: gradeType,
      assigned_date: date || todayISO(),
      lesson_number: lesson,
      due_at: dueIso,
    }
    try {
      const value = assignment
        ? await backend.assignments.update(assignment.id, payload)
        : await backend.assignments.create(payload)
      toast.success(assignment ? 'Задание обновлено' : 'Задание добавлено')
      onSaved(value)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={assignment ? 'Редактировать задание' : 'Новое задание'}
      subtitle={
        assignment
          ? 'Изменения появятся в журнале дисциплины и у студентов'
          : 'Задание появится в журнале выбранной дисциплины'
      }
      size="md"
    >
      <form className="form" onSubmit={submit}>
        {error ? <div className="error-box">{error}</div> : null}
        <div className="assignment-discipline">
          <span className="assignment-discipline__icon">
            <Layers3 size={17} />
          </span>
          <span>
            <strong>{discipline.name}</strong>
            <small>
              группа {discipline.group_name} · {discipline.teacher_name}
            </small>
          </span>
        </div>
        <label className="field">
          <span>Название задания</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например, ПЗ 5. Навигация в приложении"
            data-testid="assignment-title"
            autoFocus
          />
        </label>
        <label className="field">
          <span>Описание и требования</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="Что нужно сделать, какие файлы прикрепить…"
            data-testid="assignment-description"
          />
        </label>
        <div className="form-row form-row--two">
          <label className="field">
            <span>Дата выдачи</span>
            <div className="input-with-icon">
              <CalendarDays size={16} />
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                data-testid="assignment-date"
              />
            </div>
          </label>
          <label className="field field--narrow">
            <span>Пара</span>
            <select value={lesson} onChange={(event) => setLesson(Number(event.target.value))}>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row form-row--two">
          <label className="field">
            <span>Система оценивания</span>
            <select
              value={gradeType}
              onChange={(event) => setGradeType(event.target.value as GradeType)}
              data-testid="assignment-grade-type"
            >
              {GRADE_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <small className="field-hint">
              {GRADE_TYPES.find((item) => item.value === gradeType)?.hint}. После выставления
              оценок систему менять нельзя.
            </small>
          </label>
          <label className="field">
            <span>Дедлайн сдачи — дата и время</span>
            <div className="input-with-icon">
              <Clock3 size={16} />
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                data-testid="assignment-due-at"
              />
            </div>
            <small className="field-hint">
              Можно оставить пустым. После дедлайна несданные работы подсветятся красным.
            </small>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} data-testid="assignment-save">
            {busy ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
            {busy ? 'Сохраняем…' : assignment ? 'Сохранить' : 'Добавить задание'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
