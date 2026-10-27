import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  Download,
  FileText,
  FileX,
  History,
  Info,
  Loader2,
  Highlighter,
  MessageSquareWarning,
  PencilLine,
  Save,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import { Stars } from './Stars'
import { GradeBadge } from './GradeBadge'
import { FileViewer } from './viewers/FileViewer'
import { backend } from '../lib/api'
import { editingEnabled } from '../lib/supabase'
import type {
  Annotation,
  AnnotationRect,
  GradeType,
  Submission,
  SubmissionVersion,
} from '../lib/types'
import { formatDateTime, formatSize } from '../lib/format'
import { gradeLabel, gradeTypeLabel, normalizeGradeType, validateGrade } from '../lib/grades'
import { fileKind } from '../lib/fileTypes'
import { useToast } from '../context/ToastContext'

export interface ReviewMeta {
  studentName?: string
  assignmentTitle?: string
  groupName?: string
  gradeType?: GradeType
}

interface ReviewDrawerProps {
  open: boolean
  submissionId: string | null
  mode: 'student' | 'admin'
  meta?: ReviewMeta
  onClose: () => void
  onChanged?: () => void
}

type Draft =
  | { kind: 'pdf'; page: number; rects: AnnotationRect[] }
  | { kind: 'text'; range: { start: number; end: number; text: string } }

const COLORS = [
  { value: '#f2b705', label: 'жёлтый' },
  { value: '#e05252', label: 'красный' },
  { value: '#2e9b6b', label: 'зелёный' },
  { value: '#4f7fd6', label: 'синий' },
]

function CommentComposer({
  draft,
  saving,
  onSave,
  onCancel,
}: {
  draft: Draft
  saving: boolean
  onSave: (comment: string, color: string) => void
  onCancel: () => void
}) {
  const [comment, setComment] = useState('')
  const [color, setColor] = useState(COLORS[0].value)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Фокус ставится ОДИН раз при появлении формы. Ввод хранится локально,
  // поэтому каждая буква не перерисовывает родителя и не сбрасывает фокус.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    if (!comment.trim() || saving) return
    onSave(comment.trim(), color)
  }

  return (
    <form
      className="annotation-composer"
      data-testid="annotation-composer"
      onMouseDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="annotation-composer__head">
        <span className="annotation-composer__icon">
          <Highlighter size={17} />
        </span>
        <div>
          <strong>Новое замечание</strong>
          <span>
            {draft.kind === 'pdf'
              ? `Прямоугольник на странице ${draft.page}`
              : `Выделенный текст: «${draft.range.text.slice(0, 80)}${
                  draft.range.text.length > 80 ? '…' : ''
                }»`}
          </span>
        </div>
        <button type="button" className="icon-btn" aria-label="Отменить замечание" onClick={onCancel}>
          <X size={17} />
        </button>
      </div>
      <textarea
        ref={inputRef}
        className="annotation-input"
        rows={3}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        placeholder="Коротко опишите ошибку или замечание…"
        data-testid="annotation-comment"
      />
      <div className="annotation-composer__colors" role="group" aria-label="Цвет выделения">
        {COLORS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`color-dot ${color === item.value ? 'is-active' : ''}`}
            style={{ backgroundColor: item.value }}
            onClick={() => setColor(item.value)}
            aria-label={`Цвет ${item.label}`}
            title={item.label}
          />
        ))}
        <span className="annotation-composer__hint">Ctrl+Enter — сохранить</span>
      </div>
      <div className="annotation-composer__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} disabled={saving}>
          Отмена
        </button>
        <button
          type="submit"
          className="btn btn--primary btn--sm"
          disabled={!comment.trim() || saving}
          data-testid="annotation-save"
        >
          {saving ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
          Сохранить
        </button>
      </div>
    </form>
  )
}

export function ReviewDrawer({
  open,
  submissionId,
  mode,
  meta,
  onClose,
  onChanged,
}: ReviewDrawerProps) {
  const toast = useToast()
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [versions, setVersions] = useState<SubmissionVersion[]>([])
  const [blob, setBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  const [error, setError] = useState('')
  const [markerActive, setMarkerActive] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftKey, setDraftKey] = useState(0)
  const [savingAnnotation, setSavingAnnotation] = useState(false)
  const [gradeBusy, setGradeBusy] = useState(false)
  const [gradeConfirm, setGradeConfirm] = useState<number | null>(null)
  const [pointsDraft, setPointsDraft] = useState('')
  const [removing, setRemoving] = useState(false)
  const [editingText, setEditingText] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [savingText, setSavingText] = useState(false)
  const composerWrapRef = useRef<HTMLDivElement>(null)

  const loadAnnotations = useCallback(async (id: string) => {
    const value = await backend.annotations.list(id)
    setAnnotations(value)
  }, [])

  const loadBlob = useCallback(async (path: string | null) => {
    if (!path) {
      setBlob(null)
      setFileError('')
      return
    }
    try {
      const value = await backend.files.blob(path)
      setBlob(value)
      setFileError('')
    } catch (err) {
      setBlob(null)
      setFileError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!open || !submissionId) return
    let cancelled = false
    setLoading(true)
    setError('')
    setMarkerActive(false)
    setDraft(null)
    setGradeConfirm(null)
    setEditingText(false)
    setTextValue('')
    setBlob(null)
    setFileError('')

    const load = async () => {
      try {
        const [submissionValue, annotationValue, versionValue] = await Promise.all([
          backend.submissions.get(submissionId),
          backend.annotations.list(submissionId),
          backend.submissions.versions(submissionId),
        ])
        if (cancelled) return
        setSubmission(submissionValue)
        setAnnotations(annotationValue)
        setVersions(versionValue)
        setLoading(false)
        await loadBlob(submissionValue.file_path)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, submissionId, loadBlob])

  useEffect(() => {
    if (!open || !submission) return
    setPointsDraft(submission.grade != null ? String(submission.grade) : '')
  }, [open, submission?.id, submission?.grade])

  const gradeType = normalizeGradeType(meta?.gradeType)
  const latestVersionAt = versions.reduce((latest, version) => {
    const time = new Date(version.created_at).getTime()
    return Number.isNaN(time) ? latest : Math.max(latest, time)
  }, 0)
  const activeAnnotations = annotations.filter((annotation) => {
    const time = new Date(annotation.created_at).getTime()
    return Number.isNaN(time) || time > latestVersionAt
  })
  const gradeLockedByRemarks =
    mode === 'admin' && submission?.grade == null && activeAnnotations.length > 0
  const kind = submission ? fileKind(submission.original_name ?? '') : null
  const fileDeleted = Boolean(
    submission &&
      (submission.file_deleted_at ||
        (!submission.file_path && Boolean(submission.original_name))),
  )
  const hasStoredFiles = Boolean(
    submission && (submission.file_path || versions.some((version) => version.file_path)),
  )
  const canMark =
    mode === 'admin' && !fileDeleted && kind && ['pdf', 'docx', 'txt'].includes(kind.preview)

  const pickRect = (page: number, rect: AnnotationRect) => {
    setDraft({ kind: 'pdf', page, rects: [rect] })
    setDraftKey((value) => value + 1)
    window.setTimeout(() => {
      if (window.innerWidth < 900) composerWrapRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 60)
  }

  const pickRange = (range: { start: number; end: number; text: string }) => {
    setDraft({ kind: 'text', range })
    setDraftKey((value) => value + 1)
    window.setTimeout(() => {
      if (window.innerWidth < 900) composerWrapRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 60)
    window.getSelection()?.removeAllRanges()
  }

  const saveAnnotation = async (comment: string, color: string) => {
    if (!submission || !draft) return
    setSavingAnnotation(true)
    try {
      await backend.annotations.create({
        submission_id: submission.id,
        kind: draft.kind,
        page: draft.kind === 'pdf' ? draft.page : null,
        rects: draft.kind === 'pdf' ? draft.rects : null,
        range: draft.kind === 'text' ? draft.range : null,
        color,
        comment,
      })
      setDraft(null)
      await loadAnnotations(submission.id)
      toast.success('Замечание сохранено')
      onChanged?.()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSavingAnnotation(false)
    }
  }

  const deleteAnnotation = async (annotation: Annotation) => {
    if (!submission) return
    if (!window.confirm('Удалить это замечание?')) return
    try {
      await backend.annotations.remove(annotation.id)
      await loadAnnotations(submission.id)
      toast.success('Замечание удалено')
      onChanged?.()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const commitGrade = async (grade: number | null, deleteFiles: boolean) => {
    if (!submission || gradeBusy) return
    if (gradeLockedByRemarks && grade != null) {
      toast.error('Сначала исправьте замечания: пока они активны, оценку ставить нельзя')
      return
    }
    const message = validateGrade(gradeType, grade)
    if (message) {
      toast.error(message)
      return
    }
    setGradeBusy(true)
    try {
      const updated = await backend.submissions.setGrade(submission.id, grade, {
        deleteFiles,
      })
      setSubmission(updated)
      if (deleteFiles) {
        setBlob(null)
        const nextVersions = await backend.submissions.versions(submission.id)
        setVersions(nextVersions)
      }
      toast.success(
        grade != null ? `Оценка: ${gradeLabel(gradeType, grade)}` : 'Оценка снята',
      )
      if (deleteFiles) {
        toast.notify('Файл и прошлые версии удалены из хранилища')
      }
      onChanged?.()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setGradeBusy(false)
    }
  }

  const requestGrade = (grade: number | null) => {
    if (!submission || gradeBusy) return
    if (gradeLockedByRemarks && grade != null) {
      toast.error('Сначала исправьте замечания: пока они активны, оценку ставить нельзя')
      return
    }
    const message = validateGrade(gradeType, grade)
    if (message) {
      toast.error(message)
      return
    }
    if (grade != null && hasStoredFiles) {
      setGradeConfirm(grade)
      return
    }
    void commitGrade(grade, false)
  }

  const savePointsGrade = () => {
    if (!pointsDraft.trim()) {
      toast.error('Введите балл от 0 до 100')
      return
    }
    const value = Number(pointsDraft)
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      toast.error('Балл должен быть целым числом от 0 до 100')
      return
    }
    requestGrade(value)
  }

  const removeSubmission = async () => {
    if (!submission) return
    if (
      !window.confirm(
        'Снять отметку о сдаче? Работа и её файл будут удалены из журнала и хранилища.',
      )
    ) {
      return
    }
    setRemoving(true)
    try {
      await backend.submissions.remove(submission.id)
      toast.success('Отметка снята')
      onChanged?.()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRemoving(false)
    }
  }

  const download = async () => {
    if (!submission?.file_path) return
    try {
      await backend.files.download(
        submission.file_path,
        submission.original_name || 'работа',
      )
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const downloadVersion = async (version: SubmissionVersion) => {
    if (!version.file_path) return
    try {
      await backend.files.download(
        version.file_path,
        version.original_name || `версия-${version.version}`,
      )
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const startTextEditing = () => {
    if (!blob) return
    blob
      .text()
      .then((value) => {
        setTextValue(value)
        setEditingText(true)
      })
      .catch((err: Error) => toast.error(err.message))
  }

  const saveText = async () => {
    if (!submission) return
    setSavingText(true)
    try {
      const updated = await backend.submissions.saveText(submission.id, textValue)
      setSubmission(updated)
      setEditingText(false)
      await Promise.all([loadBlob(updated.file_path), loadAnnotations(updated.id)])
      const nextVersions = await backend.submissions.versions(updated.id)
      setVersions(nextVersions)
      toast.success('Новая версия TXT сохранена')
      onChanged?.()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSavingText(false)
    }
  }

  if (!open || !submissionId) return null

  const title = submission?.original_name || meta?.assignmentTitle || 'Работа студента'
  const subtitle = [
    meta?.studentName || (mode === 'student' ? 'Моя работа' : 'Студент'),
    meta?.assignmentTitle,
    meta?.groupName ? `группа ${meta.groupName}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        subtitle={subtitle}
        size="full"
        className="review-modal"
        closeOnBackdrop={false}
      >
      {loading ? (
        <div className="viewer-loading viewer-loading--page">
          <Loader2 className="spin" size={26} /> Загружаем работу…
        </div>
      ) : error ? (
        <div className="viewer-fallback viewer-fallback--page">
          <MessageSquareWarning size={32} />
          <h3>Работа недоступна</h3>
          <p>{error}</p>
        </div>
      ) : submission ? (
        <div className="review-layout">
          <section className="review-main">
            <div className="review-toolbar">
              <div className="review-toolbar__file">
                {kind ? <span className="file-kind">{kind.label}</span> : null}
                <span title={submission.original_name ?? undefined}>
                  {submission.original_name || 'Файл не прикреплён'}
                </span>
                {submission.size ? (
                  <span className="muted">{formatSize(submission.size)}</span>
                ) : null}
                {fileDeleted ? (
                  <span className="file-deleted-note">удалён после проверки</span>
                ) : null}
              </div>
              <div className="review-toolbar__actions">
                {submission.file_path && !fileDeleted ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={download}>
                    <Download size={16} /> Скачать
                  </button>
                ) : null}
                {mode === 'admin' && canMark ? (
                  <button
                    type="button"
                    className={`btn btn--sm ${markerActive ? 'btn--marker-active' : 'btn--secondary'}`}
                    onClick={() => {
                      setMarkerActive((value) => !value)
                      setDraft(null)
                    }}
                    data-testid="marker-toggle"
                  >
                    <Highlighter size={16} /> {markerActive ? 'Маркер включён' : 'Маркер'}
                  </button>
                ) : null}
              </div>
            </div>

            {markerActive ? (
              <div className="marker-banner">
                <Highlighter size={16} />
                <span>
                  {kind?.preview === 'pdf'
                    ? 'Зажмите и протяните прямоугольник вокруг ошибки на странице.'
                    : 'Выделите мышью фрагмент текста с ошибкой.'}{' '}
                  Комментарий появится в панели справа.
                </span>
              </div>
            ) : null}

            <div className="review-viewer">
              {fileError ? (
                <div className="viewer-fallback">
                  <FileText size={30} />
                  <h3>Не удалось загрузить файл</h3>
                  <p>{fileError}</p>
                  <button type="button" className="btn btn--secondary" onClick={download}>
                    <Download size={16} /> Скачать файл
                  </button>
                </div>
              ) : fileDeleted ? (
                <div className="viewer-fallback viewer-fallback--deleted">
                  <FileX size={30} />
                  <h3>Файл удалён после проверки</h3>
                  <p>
                    Файл и его прошлые версии удалены из хранилища сразу после подтверждения
                    проверки. Оценка, замечания и данные о работе сохранены.
                  </p>
                </div>
              ) : !submission.file_path ? (
                <div className="viewer-fallback">
                  <Info size={30} />
                  <h3>Файл не прикреплён</h3>
                  <p>
                    Преподаватель отметил сдачу вручную. Студент может прикрепить файл из
                    вкладки «Задания», пока оценка не выставлена.
                  </p>
                </div>
              ) : !blob ? (
                <div className="viewer-loading viewer-loading--page">
                  <Loader2 className="spin" size={24} /> Скачиваем файл…
                </div>
              ) : editingText ? (
                <div className="text-editor">
                  <textarea
                    value={textValue}
                    onChange={(event) => setTextValue(event.target.value)}
                    className="text-editor__area"
                    spellCheck={false}
                    data-testid="text-editor"
                  />
                  <div className="text-editor__actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setEditingText(false)}
                      disabled={savingText}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={saveText}
                      disabled={savingText}
                    >
                      {savingText ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                      Сохранить новую версию
                    </button>
                  </div>
                </div>
              ) : (
                <FileViewer
                  blob={blob}
                  name={submission.original_name ?? ''}
                  size={submission.size}
                  annotations={annotations}
                  markerActive={markerActive}
                  onPickRect={pickRect}
                  onPickRange={pickRange}
                  onDownload={download}
                />
              )}
            </div>
          </section>

          <aside className="review-side">
            <div className="review-info">
              <div className="review-info__row">
                <UserRound size={15} />
                <span>{meta?.studentName || (mode === 'student' ? 'Моя работа' : '—')}</span>
              </div>
              <div className="review-info__row">
                <BookOpen size={15} />
                <span>{meta?.assignmentTitle || 'Задание'}</span>
              </div>
              <div className="review-info__row">
                <History size={15} />
                <span>Сдано {formatDateTime(submission.submitted_at)}</span>
              </div>
              <div className="review-info__meta">
                <span
                  className={`status-pill status-pill--${
                    submission.grade != null ? 'graded' : 'sent'
                  }`}
                >
                  {submission.grade != null ? 'Оценено' : 'На проверке'}
                </span>
                <span className="muted">версия {submission.version}</span>
              </div>
            </div>

            <div className="grade-card">
              <div className="grade-card__head">
                <strong>Оценка</strong>
                <span className="muted">
                  {mode === 'admin' ? gradeTypeLabel(gradeType) : 'преподаватель'}
                </span>
              </div>

              {gradeLockedByRemarks ? (
                <div className="grade-lock-note" data-testid="grade-lock-remarks">
                  <MessageSquareWarning size={15} />
                  <span>
                    Пока есть активные замечания, оценку ставить нельзя. Сначала студент
                    должен загрузить исправленную версию.
                  </span>
                </div>
              ) : null}

              {gradeType === 'pass_fail' ? (
                <div className="grade-choice">
                  {mode === 'admin' ? (
                    <>
                      <button
                        type="button"
                        className={`grade-choice__btn grade-choice__btn--pass ${
                          submission.grade === 1 ? 'is-active' : ''
                        }`}
                        onClick={() => requestGrade(1)}
                        disabled={gradeBusy || gradeLockedByRemarks}
                        data-testid="grade-pass"
                      >
                        <Check size={17} /> Зачёт
                      </button>
                      <button
                        type="button"
                        className={`grade-choice__btn grade-choice__btn--fail ${
                          submission.grade === 0 ? 'is-active' : ''
                        }`}
                        onClick={() => requestGrade(0)}
                        disabled={gradeBusy || gradeLockedByRemarks}
                        data-testid="grade-fail"
                      >
                        <X size={17} /> Незачёт
                      </button>
                      {submission.grade != null ? (
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() => requestGrade(null)}
                          disabled={gradeBusy}
                        >
                          Снять
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <GradeBadge grade={submission.grade} type="pass_fail" />
                  )}
                </div>
              ) : gradeType === 'points' ? (
                <div className="grade-points-editor">
                  {mode === 'admin' ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={pointsDraft}
                        onChange={(event) => setPointsDraft(event.target.value)}
                        placeholder="0–100"
                        disabled={gradeBusy || gradeLockedByRemarks}
                        data-testid="points-grade-input"
                      />
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={savePointsGrade}
                        disabled={gradeBusy || gradeLockedByRemarks}
                        data-testid="save-points-grade"
                      >
                        {gradeBusy ? (
                          <Loader2 className="spin" size={15} />
                        ) : (
                          <Save size={15} />
                        )}
                        Сохранить
                      </button>
                      {submission.grade != null ? (
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() => requestGrade(null)}
                          disabled={gradeBusy}
                        >
                          Снять
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <GradeBadge grade={submission.grade} type="points" size={20} />
                  )}
                </div>
              ) : (
                <div className="grade-card__stars">
                  <Stars
                    value={submission.grade}
                    onChange={
                      mode === 'admin' && !gradeLockedByRemarks ? requestGrade : undefined
                    }
                    size={24}
                    showEmpty
                    label={
                      submission.grade != null
                        ? `Оценка ${submission.grade} из 5`
                        : 'Оценки пока нет'
                    }
                  />
                  {submission.grade != null ? (
                    <b className="grade-card__num">{submission.grade}</b>
                  ) : null}
                </div>
              )}

              {mode === 'admin' ? (
                <p className="grade-card__hint">
                  {gradeLockedByRemarks
                    ? 'Оценка станет доступна после загрузки студентом новой версии или после удаления замечаний.'
                    : gradeType === 'pass_fail'
                      ? 'Выберите «Зачёт» или «Незачёт». Перед сохранением подтвердите проверку — файл удалится сразу, оценка останется.'
                      : gradeType === 'points'
                        ? 'Введите целое число от 0 до 100 и нажмите «Сохранить». Перед сохранением подтвердите проверку — файл удалится сразу.'
                        : 'Нажмите на звезду, чтобы выставить оценку. Перед сохранением подтвердите проверку — файл удалится сразу. Повторное нажатие снимает оценку.'}
                </p>
              ) : (
                <p className="grade-card__hint">
                  {submission.grade != null
                    ? fileDeleted
                      ? `Ваша оценка: ${gradeLabel(
                          gradeType,
                          submission.grade,
                        )}. Файл удалён из хранилища после проверки.`
                      : `Ваша оценка: ${gradeLabel(
                          gradeType,
                          submission.grade,
                        )}. Замена файла больше недоступна.`
                    : 'Пока оценки нет — файл можно заменить в разделе «Задания».'}
                </p>
              )}

              {mode === 'admin' ? (
                <button
                  type="button"
                  className="text-btn text-btn--danger"
                  onClick={removeSubmission}
                  disabled={removing}
                >
                  {removing ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                  Снять отметку о сдаче
                </button>
              ) : null}
            </div>

            <div className="annotations-card">
              <div className="annotations-card__head">
                <strong>
                  <MessageSquareWarning size={16} /> Замечания
                </strong>
                <span className="badge">{annotations.length}</span>
              </div>

              <div ref={composerWrapRef}>
                {draft ? (
                  <CommentComposer
                    key={draftKey}
                    draft={draft}
                    saving={savingAnnotation}
                    onSave={saveAnnotation}
                    onCancel={() => setDraft(null)}
                  />
                ) : null}
              </div>

              {annotations.length ? (
                <ul className="annotation-list">
                  {annotations.map((annotation) => (
                    <li key={annotation.id} className="annotation-item">
                      <span
                        className="annotation-item__dot"
                        style={{ backgroundColor: annotation.color }}
                      />
                      <div className="annotation-item__body">
                        <p>{annotation.comment}</p>
                        <span>
                          {annotation.kind === 'pdf'
                            ? `стр. ${annotation.page ?? 1}`
                            : `«${(annotation.range?.text ?? '').slice(0, 42)}${
                                (annotation.range?.text.length ?? 0) > 42 ? '…' : ''
                              }»`}
                        </span>
                      </div>
                      {mode === 'admin' ? (
                        <button
                          type="button"
                          className="mini-icon-btn mini-icon-btn--danger"
                          onClick={() => deleteAnnotation(annotation)}
                          aria-label="Удалить замечание"
                          title="Удалить замечание"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="annotations-empty">
                  {mode === 'admin'
                    ? 'Замечаний пока нет. Включите «Маркер» и выделите ошибку.'
                    : 'Преподаватель пока не оставил замечаний.'}
                </p>
              )}

              {mode === 'student' ? (
                <p className="annotations-note">
                  Замечания не меняют ваш файл — они хранятся отдельно и видны только вам и
                  преподавателю.
                </p>
              ) : null}
            </div>

            {mode === 'student' &&
            editingEnabled &&
            kind?.preview === 'txt' &&
            submission.grade == null &&
            blob ? (
              <div className="edit-card">
                <strong>
                  <PencilLine size={16} /> Онлайн-редактирование
                </strong>
                <p>Можно исправить текст и сохранить новую версию. Старая версия останется в истории.</p>
                <button type="button" className="btn btn--secondary btn--sm" onClick={startTextEditing}>
                  <PencilLine size={15} /> Редактировать текст
                </button>
              </div>
            ) : null}

            {versions.length ? (
              <details className="versions-card">
                <summary>
                  <History size={16} /> История версий ({versions.length})
                </summary>
                <ul>
                  {versions.map((version) => {
                    const deleted = Boolean(version.file_deleted_at || !version.file_path)
                    return (
                      <li key={version.id}>
                        <div>
                          <strong>Версия {version.version}</strong>
                          <span>
                            {formatDateTime(version.created_at)} · {formatSize(version.size)}
                          </span>
                        </div>
                        {deleted ? (
                          <span className="version-deleted">файл удалён</span>
                        ) : (
                          <button
                            type="button"
                            className="mini-icon-btn"
                            onClick={() => downloadVersion(version)}
                            title="Скачать версию"
                            aria-label={`Скачать версию ${version.version}`}
                          >
                            <Download size={14} />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </details>
            ) : null}

            {mode === 'student' && !editingEnabled ? (
              <p className="review-side__hint">
                Чтобы исправить работу: скачайте файл, отредактируйте его и загрузите новую версию
                в разделе «Задания» — пока оценка не выставлена.
              </p>
            ) : null}
          </aside>
        </div>
      ) : null}
      </Modal>

      <Modal
        open={gradeConfirm !== null}
        onClose={() => setGradeConfirm(null)}
        title="Вы точно проверили задание полностью?"
        subtitle="Это подтверждение нужно перед выставлением оценки"
        size="sm"
        closeOnBackdrop={false}
      >
        <div className="grade-confirm">
          <p>
            После подтверждения файл работы и все прошлые версии будут <strong>сразу удалены</strong>{' '}
            из хранилища. Оценка, замечания и данные о сдаче останутся в журнале.
          </p>
          <div className="grade-confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setGradeConfirm(null)}
              disabled={gradeBusy}
            >
              Нет
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (gradeConfirm === null) return
                const value = gradeConfirm
                setGradeConfirm(null)
                void commitGrade(value, true)
              }}
              disabled={gradeBusy}
              data-testid="grade-confirm-delete"
            >
              {gradeBusy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
              Проверено
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

