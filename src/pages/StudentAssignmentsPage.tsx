import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileUp,
  FileX,
  FolderOpen,
  MessageSquareWarning,
  RefreshCw,
  Replace,
  Star,
} from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { DisciplinePicker } from '../components/DisciplinePicker'
import { SubmitDialog } from '../components/SubmitDialog'
import { ReviewDrawer } from '../components/ReviewDrawer'
import { EmptyState, ErrorBox, Spinner } from '../components/Feedback'
import { GradeBadge } from '../components/GradeBadge'
import { useAuth } from '../context/AuthContext'
import { useDisciplines } from '../context/DisciplineContext'
import { backend } from '../lib/api'
import { formatDate, formatDateTime, formatSize, plural } from '../lib/format'
import { gradeLabel, isOverdue } from '../lib/grades'
import type { Assignment, Submission } from '../lib/types'

type Filter = 'all' | 'todo' | 'sent' | 'graded'

export function StudentAssignmentsPage() {
  const { profile } = useAuth()
  const { active, loading: disciplinesLoading } = useDisciplines()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [submitAssignment, setSubmitAssignment] = useState<Assignment | null>(null)
  const [editingSubmission, setEditingSubmission] = useState<Submission | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    if (!active) {
      setAssignments([])
      setSubmissions([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [assignmentList, allSubmissions] = await Promise.all([
        backend.assignments.list(active.id),
        backend.submissions.mine(),
      ])
      const assignmentIds = new Set(assignmentList.map((assignment) => assignment.id))
      setAssignments(assignmentList)
      setSubmissions(allSubmissions.filter((submission) => assignmentIds.has(submission.assignment_id)))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    if (!disciplinesLoading) void load()
  }, [load, refreshKey, disciplinesLoading])

  const byAssignment = useMemo(() => {
    const map = new Map<string, Submission>()
    for (const submission of submissions) map.set(submission.assignment_id, submission)
    return map
  }, [submissions])

  const submittedCount = assignments.filter((assignment) => byAssignment.has(assignment.id)).length
  const gradedCount = assignments.filter(
    (assignment) => byAssignment.get(assignment.id)?.grade != null,
  ).length
  const progress = assignments.length ? Math.round((submittedCount / assignments.length) * 100) : 0

  const filtered = useMemo(() => {
    return assignments.filter((assignment) => {
      const submission = byAssignment.get(assignment.id)
      if (filter === 'todo') return !submission
      if (filter === 'sent') return Boolean(submission && submission.grade == null)
      if (filter === 'graded') return submission?.grade != null
      return true
    })
  }, [assignments, byAssignment, filter])

  const reviewMeta = useMemo(() => {
    if (!reviewId) return undefined
    const submission = submissions.find((item) => item.id === reviewId)
    const assignment = assignments.find((item) => item.id === submission?.assignment_id)
    return {
      studentName: profile?.full_name,
      assignmentTitle: assignment?.title,
      groupName: active?.group_name,
      gradeType: assignment?.grade_type,
    }
  }, [reviewId, submissions, assignments, profile, active])

  if (!profile?.group_name) {
    return (
      <AppShell role="student">
        <ErrorBox>У профиля не указана группа. Обратитесь к преподавателю.</ErrorBox>
      </AppShell>
    )
  }

  return (
    <AppShell role="student">
      {disciplinesLoading ? (
        <Spinner label="Загружаем дисциплины…" />
      ) : !active ? (
        <DisciplinePicker role="student" />
      ) : (
        <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Учебные работы</span>
          <h1>{active.name} · мои задания</h1>
          <p>
            Группа {active.group_name} ·{' '}
            <Link className="teacher-link" to={`/teacher/${active.teacher_id}`}>
              {active.teacher_name}
            </Link>{' '}
            · сдано {submittedCount} из {assignments.length}{' '}
            {plural(assignments.length, ['задания', 'заданий', 'заданий'])}
          </p>
        </div>
        <div className="page-head__actions">
          <Link to="/journal" className="btn btn--ghost btn--sm">
            <ArrowLeft size={16} /> К журналу
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Обновить
          </button>
        </div>
      </div>

      <section className="progress-card">
        <div className="progress-card__top">
          <div>
            <span className="eyebrow">Прогресс по дисциплине</span>
            <h2>{progress}% работ сдано</h2>
            <p>
              {gradedCount > 0
                ? `Оценено ${gradedCount} ${plural(gradedCount, ['работа', 'работы', 'работ'])}`
                : 'Оценки появятся после проверки преподавателем'}
            </p>
          </div>
          <div className="progress-ring" style={{ ['--progress' as string]: `${progress}%` }}>
            <span>{progress}%</span>
          </div>
        </div>
        <div className="progress-track progress-track--large">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <div className="filter-tabs" role="tablist" aria-label="Фильтр заданий">
        <button
          type="button"
          className={filter === 'all' ? 'is-active' : ''}
          onClick={() => setFilter('all')}
        >
          Все <span>{assignments.length}</span>
        </button>
        <button
          type="button"
          className={filter === 'todo' ? 'is-active' : ''}
          onClick={() => setFilter('todo')}
        >
          К сдаче <span>{assignments.length - submittedCount}</span>
        </button>
        <button
          type="button"
          className={filter === 'sent' ? 'is-active' : ''}
          onClick={() => setFilter('sent')}
        >
          На проверке <span>{submittedCount - gradedCount}</span>
        </button>
        <button
          type="button"
          className={filter === 'graded' ? 'is-active' : ''}
          onClick={() => setFilter('graded')}
        >
          Оценено <span>{gradedCount}</span>
        </button>
      </div>

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {loading && !assignments.length ? (
        <Spinner label="Загружаем задания…" />
      ) : filtered.length ? (
        <div className="assignment-grid">
          {filtered.map((assignment) => {
            const submission = byAssignment.get(assignment.id)
            const graded = submission?.grade != null
            const overdue = !submission && isOverdue(assignment.due_at)
            const status = graded ? 'graded' : submission ? 'sent' : overdue ? 'overdue' : 'todo'
            return (
              <article className={`assignment-card assignment-card--${status}`} key={assignment.id}>
                <header className="assignment-card__head">
                  <span className={`status-pill status-pill--${status}`}>
                    {graded ? (
                      <>
                        <Star size={13} /> Оценено
                      </>
                    ) : submission ? (
                      <>
                        <Clock3 size={13} /> На проверке
                      </>
                    ) : overdue ? (
                      <>
                        <Clock3 size={13} /> Срочно сдать!
                      </>
                    ) : (
                      <>
                        <FileUp size={13} /> Не сдано
                      </>
                    )}
                  </span>
                  <span className="assignment-card__date">
                    <CalendarDays size={14} /> {formatDate(assignment.assigned_date)} ·{' '}
                    {assignment.lesson_number} пара
                  </span>
                  {assignment.due_at ? (
                    <span
                      className={`assignment-card__date assignment-card__date--due ${
                        overdue ? 'is-overdue' : ''
                      }`}
                    >
                      <Clock3 size={14} /> до {formatDateTime(assignment.due_at)}
                    </span>
                  ) : null}
                </header>
                <h3>{assignment.title}</h3>
                {assignment.description ? <p>{assignment.description}</p> : null}

                {submission ? (
                  <div
                    className={`assignment-card__file ${
                      submission.file_deleted_at ? 'assignment-card__file--deleted' : ''
                    }`}
                  >
                    {submission.file_deleted_at ? (
                      <FileX size={15} />
                    ) : (
                      <FileUp size={15} />
                    )}
                    <div>
                      <strong>{submission.original_name || 'Файл не прикреплён'}</strong>
                      <span>
                        {submission.file_deleted_at
                          ? 'файл удалён после проверки · данные работы сохранены'
                          : `${formatSize(submission.size)} · сдано ${formatDateTime(
                              submission.submitted_at,
                            )}`}
                      </span>
                    </div>
                  </div>
                ) : null}

                {graded ? (
                  <div className="assignment-card__grade">
                    <GradeBadge
                      grade={submission.grade}
                      type={assignment.grade_type}
                      size={18}
                    />
                    <span>
                      Оценка: <strong>{gradeLabel(assignment.grade_type, submission.grade)}</strong>
                    </span>
                  </div>
                ) : null}

                <footer className="assignment-card__actions">
                  {submission ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => setReviewId(submission.id)}
                      >
                        <FolderOpen size={15} /> Открыть работу
                      </button>
                      {submission.grade == null ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => {
                            setEditingSubmission(submission)
                            setSubmitAssignment(assignment)
                          }}
                          data-testid={`replace-${assignment.id}`}
                        >
                          <Replace size={15} /> Заменить файл
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => {
                        setEditingSubmission(null)
                        setSubmitAssignment(assignment)
                      }}
                      data-testid={`submit-assignment-${assignment.id}`}
                    >
                      <FileUp size={15} /> {overdue ? 'Срочно сдать!' : 'Сдать работу'}
                    </button>
                  )}
                  {submission ? (
                    <span className="assignment-card__marks">
                      <MessageSquareWarning size={14} /> замечания — внутри работы
                    </span>
                  ) : null}
                </footer>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={filter === 'graded' ? <CheckCircle2 size={30} /> : <BookOpenCheck size={30} />}
          title={
            filter === 'graded'
              ? 'Оценок пока нет'
              : filter === 'todo'
                ? 'Всё сдано!'
                : filter === 'sent'
                  ? 'Нет работ на проверке'
                  : 'Заданий пока нет'
          }
          text={
            filter === 'todo'
              ? 'У вас не осталось несданных работ. Преподаватель увидит все загрузки в журнале.'
              : 'Новые задания появятся здесь, как только преподаватель их добавит.'
          }
          action={
            <Link to="/journal" className="btn btn--secondary btn--sm">
              Перейти в журнал
            </Link>
          }
        />
      )}

      <SubmitDialog
        open={Boolean(submitAssignment)}
        onClose={() => {
          setSubmitAssignment(null)
          setEditingSubmission(null)
        }}
        assignment={submitAssignment}
        submission={editingSubmission}
        onUploaded={() => {
          setRefreshKey((value) => value + 1)
          setEditingSubmission(null)
        }}
      />

      <ReviewDrawer
        open={Boolean(reviewId)}
        submissionId={reviewId}
        mode="student"
        meta={reviewMeta}
        onClose={() => setReviewId(null)}
        onChanged={() => setRefreshKey((value) => value + 1)}
      />
        </>
      )}
    </AppShell>
  )
}
