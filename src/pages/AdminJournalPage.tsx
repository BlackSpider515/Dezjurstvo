import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Check, FlaskConical, Loader2, RefreshCw, Star, X } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { JournalTable } from '../components/JournalTable'
import { AssignmentDialog } from '../components/AssignmentDialog'
import { ReviewDrawer } from '../components/ReviewDrawer'
import { DisciplinePicker } from '../components/DisciplinePicker'
import { Modal } from '../components/Modal'
import { ErrorBox, Spinner } from '../components/Feedback'
import { useAuth } from '../context/AuthContext'
import { useDisciplines } from '../context/DisciplineContext'
import { useToast } from '../context/ToastContext'
import { backend } from '../lib/api'
import type {
  Assignment,
  GradeType,
  JournalData,
  JournalEntry,
  Profile,
} from '../lib/types'
import { formatDate } from '../lib/format'
import { gradeLabel, gradeTypeLabel, normalizeGradeType, validateGrade } from '../lib/grades'

interface CellDraft {
  student: Profile
  assignment: Assignment
  entry: JournalEntry | null
}

interface ReviewState {
  submissionId: string
  studentName: string
  assignmentTitle: string
  gradeType: GradeType
}

export function AdminJournalPage() {
  const toast = useToast()
  const { profile } = useAuth()
  const { active, loading: disciplinesLoading } = useDisciplines()
  const [data, setData] = useState<JournalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null)
  const [cell, setCell] = useState<CellDraft | null>(null)
  const [cellBusy, setCellBusy] = useState(false)
  const [cellPoints, setCellPoints] = useState('')
  const [review, setReview] = useState<ReviewState | null>(null)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async () => {
    if (!active) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      await backend.submissions.cleanupReviewedFiles().catch(() => undefined)
      const value = await backend.journal(active.id)
      setData(value)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    if (!disciplinesLoading) void load()
  }, [load, refreshKey, disciplinesLoading])

  const reviewMeta = useMemo(() => {
    if (!review || !active) return undefined
    return {
      studentName: review.studentName,
      assignmentTitle: review.assignmentTitle,
      groupName: active.group_name,
      gradeType: review.gradeType,
    }
  }, [review, active])

  const cellGradeType = normalizeGradeType(cell?.assignment.grade_type)

  const handleCellClick = (
    student: Profile,
    assignment: Assignment,
    entry: JournalEntry | null,
  ) => {
    if (entry?.submission_id) {
      setReview({
        submissionId: entry.submission_id,
        studentName: student.full_name,
        assignmentTitle: assignment.title,
        gradeType: normalizeGradeType(assignment.grade_type),
      })
      return
    }
    setCellPoints(entry?.grade != null ? String(entry.grade) : '')
    setCell({ student, assignment, entry })
  }

  const ensureSubmission = async (): Promise<string | null> => {
    if (!cell) return null
    if (cell.entry?.submission_id) return cell.entry.submission_id
    const created = await backend.submissions.markSubmitted(cell.assignment.id, cell.student.id)
    setCell((current) =>
      current
        ? {
            ...current,
            entry: {
              submission_id: created.id,
              assignment_id: created.assignment_id,
              student_id: created.student_id,
              grade: created.grade,
              status: created.status,
              submitted_at: created.submitted_at,
              annotation_count: 0,
            },
          }
        : current,
    )
    return created.id
  }

  const markSubmitted = async () => {
    if (!cell) return
    setCellBusy(true)
    try {
      await ensureSubmission()
      toast.success('Отметка «+» поставлена')
      setCell(null)
      setCellPoints('')
      setRefreshKey((value) => value + 1)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setCellBusy(false)
    }
  }

  const setCellGrade = async (grade: number) => {
    if (!cell) return
    const message = validateGrade(cell.assignment.grade_type, grade)
    if (message) {
      toast.error(message)
      return
    }
    setCellBusy(true)
    try {
      const submissionId = await ensureSubmission()
      if (!submissionId) throw new Error('Не удалось создать отметку')
      await backend.submissions.setGrade(submissionId, grade)
      toast.success(`Оценка: ${gradeLabel(cell.assignment.grade_type, grade)}`)
      setCell(null)
      setCellPoints('')
      setRefreshKey((value) => value + 1)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setCellBusy(false)
    }
  }

  const deleteAssignment = async (assignment: Assignment) => {
    if (
      !window.confirm(
        `Удалить задание «${assignment.title}»? Вместе с ним удалятся все сданные работы этой группы.`,
      )
    ) {
      return
    }
    try {
      await backend.assignments.remove(assignment.id)
      toast.success('Задание удалено')
      setRefreshKey((value) => value + 1)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const seedTestData = async () => {
    if (!active) return
    const confirmed = window.confirm(
      `Добавить в «${active.name}» 30 тестовых студентов и 50 заданий? В Supabase студенты будут созданы как реальные аккаунты.`,
    )
    if (!confirmed) return
    setSeeding(true)
    try {
      const result = await backend.testData.seed(active.id)
      const skipped = result.studentsSkipped + result.assignmentsSkipped
      const summary = `Создано студентов: ${result.studentsCreated}, заданий: ${result.assignmentsCreated}${
        skipped ? ` · уже было: ${skipped}` : ''
      }`
      if (result.errors.length) {
        toast.error(`${summary}. Ошибки: ${result.errors.slice(0, 2).join('; ')}`)
      } else {
        toast.success(summary)
      }
      setRefreshKey((value) => value + 1)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <AppShell role="admin">
      {disciplinesLoading ? (
        <Spinner label="Загружаем дисциплины…" />
      ) : !active ? (
        <DisciplinePicker role="admin" />
      ) : (
        <>
          <div className="page-head">
            <div>
              <span className="eyebrow">Кабинет преподавателя</span>
              <h1>Журнал · {active.name}</h1>
              <p>
                {profile?.full_name || active.teacher_name} · группа {active.group_name} · клик
                по ячейке открывает работу или позволяет поставить отметку
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
                className="btn btn--ghost btn--sm"
                onClick={seedTestData}
                disabled={seeding || loading}
                title="Добавить 30 студентов и 50 заданий для проверки"
                data-testid="seed-test-data"
              >
                {seeding ? <Loader2 className="spin" size={16} /> : <FlaskConical size={16} />}
                Тест-данные
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  setEditingAssignment(null)
                  setAssignmentOpen(true)
                }}
                data-testid="add-assignment"
              >
                <CalendarPlus size={16} /> Добавить задание
              </button>
            </div>
          </div>

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          {loading && !data ? (
            <Spinner label="Загружаем журнал…" />
          ) : data ? (
            <JournalTable
              data={data}
              disciplineName={active.name}
              groupName={active.group_name}
              teacherName={profile?.full_name || active.teacher_name}
              mode="admin"
              onCellClick={handleCellClick}
              onEditAssignment={(assignment) => {
                setEditingAssignment(assignment)
                setAssignmentOpen(true)
              }}
              onDeleteAssignment={deleteAssignment}
              actions={
                <span className="journal-toolbar__hint">
                  <Star size={15} /> Система оценивания задаётся в задании
                </span>
              }
            />
          ) : null}

          <AssignmentDialog
            open={assignmentOpen}
            discipline={active}
            assignment={editingAssignment}
            onClose={() => setAssignmentOpen(false)}
            onSaved={() => setRefreshKey((key) => key + 1)}
          />

          <Modal
            open={Boolean(cell)}
            onClose={() => {
              setCell(null)
              setCellPoints('')
            }}
            title="Отметка в журнале"
            subtitle={
              cell
                ? `${cell.student.full_name} · ${cell.assignment.title} · ${formatDate(
                    cell.assignment.assigned_date,
                  )}`
                : undefined
            }
            size="sm"
          >
            {cell ? (
              <div className="cell-editor">
                <p className="cell-editor__hint">
                  Студент ещё не прикреплял файл. Можно поставить «+» вручную или сразу оценку.
                  Оценка автоматически создаст отметку о сдаче.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  onClick={markSubmitted}
                  disabled={cellBusy}
                  data-testid="mark-submitted"
                >
                  {cellBusy ? <Loader2 className="spin" size={17} /> : <Check size={17} />}
                  Поставить «+» (сдано)
                </button>
                <div className="grade-picker">
                  <span>Оценка · {gradeTypeLabel(cellGradeType)}:</span>
                  {cellGradeType === 'stars' ? (
                    [1, 2, 3, 4, 5].map((grade) => (
                      <button
                        key={grade}
                        type="button"
                        className="grade-picker__btn"
                        onClick={() => setCellGrade(grade)}
                        disabled={cellBusy}
                        title={`Оценка ${grade}`}
                        data-testid={`cell-grade-${grade}`}
                      >
                        {grade} <Star size={14} />
                      </button>
                    ))
                  ) : cellGradeType === 'pass_fail' ? (
                    <>
                      <button
                        type="button"
                        className="grade-picker__btn grade-picker__btn--wide"
                        onClick={() => setCellGrade(1)}
                        disabled={cellBusy}
                        data-testid="cell-grade-pass"
                      >
                        <Check size={14} /> Зачёт
                      </button>
                      <button
                        type="button"
                        className="grade-picker__btn grade-picker__btn--wide"
                        onClick={() => setCellGrade(0)}
                        disabled={cellBusy}
                        data-testid="cell-grade-fail"
                      >
                        <X size={14} /> Незачёт
                      </button>
                    </>
                  ) : (
                    <div className="grade-points-editor grade-points-editor--compact">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={cellPoints}
                        onChange={(event) => setCellPoints(event.target.value)}
                        placeholder="0–100"
                        disabled={cellBusy}
                        data-testid="cell-points-input"
                      />
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => setCellGrade(Number(cellPoints))}
                        disabled={cellBusy || !cellPoints.trim()}
                        data-testid="cell-save-points"
                      >
                        {cellBusy ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
                        Поставить
                      </button>
                    </div>
                  )}
                </div>
                <p className="cell-editor__note">
                  Если студент прикрепит файл позже, оценка сохранится, а файл можно будет
                  посмотреть в его работе.
                </p>
              </div>
            ) : null}
          </Modal>

          <ReviewDrawer
            open={Boolean(review)}
            submissionId={review?.submissionId ?? null}
            mode="admin"
            meta={reviewMeta}
            onClose={() => setReview(null)}
            onChanged={() => setRefreshKey((value) => value + 1)}
          />
        </>
      )}
    </AppShell>
  )
}
