import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardList, RefreshCw, Sparkles } from 'lucide-react'
import { AppShell } from '../components/AppShell'
import { DisciplinePicker } from '../components/DisciplinePicker'
import { JournalTable } from '../components/JournalTable'
import { ReviewDrawer } from '../components/ReviewDrawer'
import { SubmitDialog } from '../components/SubmitDialog'
import { ErrorBox, Spinner } from '../components/Feedback'
import { useAuth } from '../context/AuthContext'
import { useDisciplines } from '../context/DisciplineContext'
import { useToast } from '../context/ToastContext'
import { backend } from '../lib/api'
import type { Assignment, JournalData, Submission } from '../lib/types'

export function StudentJournalPage() {
  const { profile } = useAuth()
  const { active, loading: disciplinesLoading } = useDisciplines()
  const toast = useToast()
  const [data, setData] = useState<JournalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [submitAssignment, setSubmitAssignment] = useState<Assignment | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!active) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
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
    if (!reviewId || !data || !profile || !active) {
      return { studentName: profile?.full_name }
    }
    const entry = data.entries.find((item) => item.submission_id === reviewId)
    const assignment = data.assignments.find((item) => item.id === entry?.assignment_id)
    return {
      studentName: profile.full_name,
      assignmentTitle: assignment?.title,
      groupName: active.group_name,
      gradeType: assignment?.grade_type,
    }
  }, [reviewId, data, profile, active])

  const handleUploaded = (_submission: Submission) => {
    setRefreshKey((value) => value + 1)
    void load()
  }

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
              <span className="eyebrow">Личный кабинет студента</span>
              <h1>
                {active.name} · группа {active.group_name}
              </h1>
              <p>
                {profile.full_name} · преподаватель{' '}
                <Link className="teacher-link" to={`/teacher/${active.teacher_id}`}>
                  {active.teacher_name}
                </Link>
                . Ваша строка подсвечена цветом.
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
              <Link to="/assignments" className="btn btn--primary btn--sm">
                Мои задания <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          <div className="student-tip">
            <span className="student-tip__icon">
              <Sparkles size={18} />
            </span>
            <p>
              <strong>Как сдать работу:</strong> найдите своё задание в строке с вашей фамилией
              и нажмите «Сдать», либо откройте вкладку{' '}
              <Link to="/assignments">«Задания»</Link>. После загрузки в журнале появится «+».
            </p>
          </div>

          {error ? (
            <ErrorBox>
              {error}{' '}
              <button type="button" className="text-btn" onClick={() => setRefreshKey((value) => value + 1)}>
                Повторить
              </button>
            </ErrorBox>
          ) : null}

          {loading && !data ? (
            <Spinner label="Собираем рапортичку…" />
          ) : data ? (
            <JournalTable
              data={data}
              disciplineName={active.name}
              groupName={active.group_name}
              teacherName={active.teacher_name}
              mode="student"
              currentStudentId={profile.id}
              onSubmitAssignment={(assignment) => setSubmitAssignment(assignment)}
              onOpenSubmission={(id) => setReviewId(id)}
              actions={
                <span className="journal-toolbar__hint">
                  <ClipboardList size={15} /> {data.assignments.length} заданий
                </span>
              }
            />
          ) : null}

          <SubmitDialog
            open={Boolean(submitAssignment)}
            onClose={() => setSubmitAssignment(null)}
            assignment={submitAssignment}
            onUploaded={handleUploaded}
          />

          <ReviewDrawer
            open={Boolean(reviewId)}
            submissionId={reviewId}
            mode="student"
            meta={reviewMeta}
            onClose={() => setReviewId(null)}
            onChanged={() => {
              load()
              toast.notify('Данные обновлены')
            }}
          />
        </>
      )}
    </AppShell>
  )
}
