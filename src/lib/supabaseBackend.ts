import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Annotation,
  Assignment,
  Discipline,
  Group,
  JournalData,
  NewAssignment,
  NewDiscipline,
  Profile,
  StudentCredentials,
  Submission,
  SubmissionVersion,
  TeacherProfileInput,
  TeacherRegistration,
  TestDataResult,
  UploadProgress,
  WorkRow,
} from './types'
import type { AnnotationInput, Backend, SubmissionFilters } from './backend'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'
import { extensionOf, safeMime, sanitizeFileName } from './fileTypes'
import { validateGrade } from './grades'
import { normalizeTeacherProfile, validateTeacherProfile } from './profile'
import { buildTestAssignments, TEST_STUDENTS } from './testData'

function client(): SupabaseClient {
  if (!supabase) throw new Error('Supabase не настроен')
  return supabase
}

interface ProfileRow {
  id: string
  role: 'student' | 'admin'
  full_name: string
  group_name: string | null
  created_at: string
  avatar_path: string | null
  contact_email: string | null
  phone: string | null
  bio: string | null
}

function avatarPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const { data } = client().storage.from('avatars').getPublicUrl(path)
  return data.publicUrl || null
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    role: row.role,
    full_name: row.full_name,
    group_name: row.group_name,
    created_at: row.created_at,
    avatar_url: avatarPublicUrl(row.avatar_path),
    contact_email: row.contact_email,
    phone: row.phone,
    bio: row.bio,
  }
}

const PROFILE_SELECT =
  'id, role, full_name, group_name, created_at, avatar_path, contact_email, phone, bio'

async function fetchProfile(id: string): Promise<Profile | null> {
  const { data, error } = await client()
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapProfile(data as ProfileRow) : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function requireProfile(): Promise<Profile> {
  const { data, error } = await client().auth.getUser()
  if (error || !data.user) throw new Error('Нужно войти в дневник')
  const profile = await fetchProfile(data.user.id)
  if (!profile) throw new Error('Профиль не найден. Обратитесь к преподавателю.')
  return profile
}

async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile()
  if (profile.role !== 'admin') throw new Error('Действие доступно только преподавателю')
  return profile
}

async function requireStudent(): Promise<Profile> {
  const profile = await requireProfile()
  if (profile.role !== 'student') throw new Error('Действие доступно только студенту')
  return profile
}

interface OwnedDiscipline {
  id: string
  name: string
  group_name: string
  teacher_id: string
}

async function loadOwnedDiscipline(
  disciplineId: string,
  teacherId: string,
): Promise<OwnedDiscipline> {
  const { data, error } = await client()
    .from('disciplines')
    .select('id, name, group_name, teacher_id')
    .eq('id', disciplineId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const discipline = data as OwnedDiscipline | null
  if (!discipline) throw new Error('Дисциплина не найдена')
  if (discipline.teacher_id !== teacherId) {
    throw new Error('Можно работать только со своей дисциплиной')
  }
  return discipline
}

function readableAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Неверный логин или пароль'
  if (/email not confirmed/i.test(message)) {
    return 'Подтверждение email включено. В настройках Supabase его нужно отключить.'
  }
  if (/rate limit/i.test(message)) return 'Слишком много попыток. Подождите минуту.'
  return message
}

function storagePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

async function uploadFileToStorage(
  path: string,
  file: File,
  mime: string,
  onProgress?: UploadProgress,
): Promise<void> {
  const { data, error } = await client().auth.getSession()
  if (error || !data.session) throw new Error('Сессия истекла — войдите заново.')
  const token = data.session.access_token

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/submissions/${storagePath(path)}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', supabaseAnonKey)
    xhr.setRequestHeader('cache-control', '3600')
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onerror = () => reject(new Error('Не удалось загрузить файл. Проверьте интернет.'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100)
        resolve()
        return
      }
      let message = 'Не удалось загрузить файл в хранилище.'
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string; error?: string }
        message = body.message || body.error || message
      } catch {
        // ignore
      }
      if (xhr.status === 413) message = 'Файл больше лимита хранилища (50 МБ).'
      if (xhr.status === 403) message = 'Загрузка запрещена: работа уже оценена или файл не разрешён.'
      reject(new Error(message))
    }
    xhr.send(file)
  })
}

async function removeStorageObject(path: string): Promise<void> {
  try {
    await client().storage.from('submissions').remove([path])
  } catch {
    // Не критично: файл мог быть уже удалён.
  }
}

async function deleteFilesForSubmission(submissionId: string): Promise<boolean> {
  const db = client()
  const [submissionResult, versionsResult] = await Promise.all([
    db.from('submissions').select('file_path').eq('id', submissionId).maybeSingle(),
    db.from('submission_versions').select('file_path').eq('submission_id', submissionId),
  ])
  if (submissionResult.error) throw new Error(submissionResult.error.message)
  if (versionsResult.error) throw new Error(versionsResult.error.message)

  const paths = [
    ...new Set(
      [
        (submissionResult.data as { file_path: string | null } | null)?.file_path ?? null,
        ...((versionsResult.data ?? []) as { file_path: string | null }[]).map(
          (version) => version.file_path,
        ),
      ].filter((path): path is string => Boolean(path)),
    ),
  ]
  if (!paths.length) return false

  const { error: storageError } = await db.storage.from('submissions').remove(paths)
  if (storageError) throw new Error(storageError.message)

  const deletedAt = new Date().toISOString()
  const { error: submissionError } = await db
    .from('submissions')
    .update({ file_path: null, file_deleted_at: deletedAt })
    .eq('id', submissionId)
  if (submissionError) throw new Error(submissionError.message)

  const { error: versionsError } = await db
    .from('submission_versions')
    .update({ file_path: null, file_deleted_at: deletedAt })
    .eq('submission_id', submissionId)
  if (versionsError) throw new Error(versionsError.message)
  return true
}

async function edgeFunctionError(error: unknown, fallback: string): Promise<string> {
  const source = error as { message?: string; context?: Response }
  let message = source?.message || fallback
  const context = source?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      // ignore
    }
  }
  return message
}

async function storeSubmission(
  profile: Profile,
  assignmentId: string,
  file: File,
  onProgress?: UploadProgress,
): Promise<Submission> {
  const db = client()
  const { data: assignment, error: assignmentError } = await db
    .from('assignments')
    .select('*')
    .eq('id', assignmentId)
    .maybeSingle()
  if (assignmentError) throw new Error(assignmentError.message)
  if (!assignment) throw new Error('Задание не найдено')
  if (assignment.group_name !== profile.group_name) throw new Error('Это задание другой группы')

  const { data: existing, error: existingError } = await db
    .from('submissions')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', profile.id)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message)
  if (existing?.grade != null) {
    throw new Error('Работа уже оценена — заменить файл больше нельзя')
  }

  const ext = extensionOf(file.name)
  if (!ext) throw new Error('У файла нет расширения')
  const path = `${profile.id}/${assignmentId}/${crypto.randomUUID()}.${ext}`
  const mime = safeMime(file)
  const version = (existing?.version ?? 0) + 1

  await uploadFileToStorage(path, file, mime, onProgress)

  const payload = {
    file_path: path,
    original_name: sanitizeFileName(file.name),
    mime,
    size: file.size,
    submitted_at: new Date().toISOString(),
    status: 'submitted' as const,
    version,
    reviewed_at: null,
    file_deleted_at: null,
  }

  let submission: Submission | null = null
  if (existing) {
    const { data, error } = await db
      .from('submissions')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) {
      await removeStorageObject(path)
      throw new Error(
        error.code === 'PGRST116' || error.code === '42501'
          ? 'Работа уже оценена или нет прав на замену файла.'
          : error.message,
      )
    }
    submission = data as Submission
  } else {
    const { data, error } = await db
      .from('submissions')
      .insert({
        assignment_id: assignmentId,
        student_id: profile.id,
        ...payload,
      })
      .select('*')
      .single()
    if (error) {
      await removeStorageObject(path)
      throw new Error(error.message)
    }
    submission = data as Submission
  }

  const { error: versionError } = await db.from('submission_versions').insert({
    submission_id: submission.id,
    file_path: path,
    original_name: payload.original_name,
    mime,
    size: file.size,
    version,
  })
  if (versionError) console.warn('Не удалось сохранить версию файла', versionError.message)

  return submission
}

export const supabaseBackend: Backend = {
  mode: 'supabase',

  auth: {
    async getProfile() {
      const { data } = await client().auth.getSession()
      if (!data.session?.user) return null
      try {
        return await fetchProfile(data.session.user.id)
      } catch {
        return null
      }
    },
    onAuthChange(callback) {
      const { data } = client().auth.onAuthStateChange((_event, session) => {
        if (!session?.user) {
          callback(null)
          return
        }
        fetchProfile(session.user.id)
          .then(callback)
          .catch(() => callback(null))
      })
      return () => data.subscription.unsubscribe()
    },
    async signIn(login, password) {
      const raw = login.trim()
      const email = raw.includes('@') ? raw.toLowerCase() : `${raw.toLowerCase()}@diary.local`
      const { data, error } = await client().auth.signInWithPassword({ email, password })
      if (error) throw new Error(readableAuthError(error.message))
      if (!data.user) throw new Error('Не удалось войти')
      const profile = await fetchProfile(data.user.id)
      if (!profile) {
        await client().auth.signOut()
        throw new Error('Профиль не найден. Обратитесь к преподавателю.')
      }
      return profile
    },
    async signOut() {
      await client().auth.signOut()
    },
    async register(fullName, groupName): Promise<StudentCredentials> {
      const { data, error } = await client().functions.invoke('register', {
        body: { fullName, groupName },
      })
      if (error) {
        let message = error.message || 'Не удалось создать аккаунт'
        const context = (error as { context?: Response }).context
        if (context && typeof context.json === 'function') {
          try {
            const body = (await context.json()) as { error?: string }
            if (body?.error) message = body.error
          } catch {
            // ignore
          }
        }
        if (/Failed to send a request|not found|404/i.test(message)) {
          message =
            'Сервис регистрации не задеплоен. Задеплойте Edge Function «register» (см. README).'
        }
        throw new Error(message)
      }
      if (data?.error) throw new Error(data.error as string)
      return data as StudentCredentials
    },
    async registerTeacher(fullName, password): Promise<TeacherRegistration> {
      const { data, error } = await client().functions.invoke('register-teacher', {
        body: { fullName, password },
      })
      if (error) {
        let message = await edgeFunctionError(error, 'Не удалось создать кабинет преподавателя')
        if (/Failed to send a request|not found|404/i.test(message)) {
          message =
            'Сервис регистрации преподавателей не задеплоен. Задеплойте Edge Function «register-teacher» (см. README).'
        }
        throw new Error(message)
      }
      if (data?.error) throw new Error(data.error as string)
      const login = String(data?.login ?? '').trim()
      if (!login) throw new Error('Сервис регистрации не вернул логин')
      const profile = await supabaseBackend.auth.signIn(login, password)
      return { profile, login }
    },
  },

  disciplines: {
    async list(): Promise<Discipline[]> {
      const { data, error } = await client()
        .from('discipline_catalog')
        .select('id, name, group_name, teacher_id, teacher_name, created_at')
        .order('group_name')
        .order('name')
      if (error) throw new Error(error.message)
      return (data ?? []) as Discipline[]
    },
    async create(input: NewDiscipline): Promise<Discipline> {
      const admin = await requireAdmin()
      const name = input.name.trim().replace(/\s+/g, ' ')
      const groupName = input.groupName.trim()
      if (!name || name.length > 150) {
        throw new Error('Название дисциплины должно быть длиной от 1 до 150 символов')
      }
      const { data, error } = await client()
        .from('disciplines')
        .insert({
          name,
          group_name: groupName,
          teacher_id: admin.id,
        })
        .select('id, name, group_name, teacher_id, created_at')
        .single()
      if (error) {
        throw new Error(
          error.code === '23505'
            ? 'Такая дисциплина уже есть у этой группы'
            : error.message,
        )
      }
      return { ...(data as Omit<Discipline, 'teacher_name'>), teacher_name: admin.full_name }
    },
    async remove(id: string) {
      const admin = await requireAdmin()
      await loadOwnedDiscipline(id, admin.id)
      const db = client()

      const { data: assignments, error: assignmentsError } = await db
        .from('assignments')
        .select('id')
        .eq('discipline_id', id)
      if (assignmentsError) throw new Error(assignmentsError.message)
      const assignmentIds = (assignments ?? []).map((row: { id: string }) => row.id)

      const paths = new Set<string>()
      if (assignmentIds.length) {
        for (const ids of chunk(assignmentIds, 100)) {
          const { data: submissions, error: submissionsError } = await db
            .from('submissions')
            .select('id, file_path')
            .in('assignment_id', ids)
          if (submissionsError) throw new Error(submissionsError.message)
          const submissionIds: string[] = []
          for (const submission of (submissions ?? []) as {
            id: string
            file_path: string | null
          }[]) {
            submissionIds.push(submission.id)
            if (submission.file_path) paths.add(submission.file_path)
          }
          for (const submissionIdsChunk of chunk(submissionIds, 100)) {
            const { data: versions, error: versionsError } = await db
              .from('submission_versions')
              .select('file_path')
              .in('submission_id', submissionIdsChunk)
            if (versionsError) throw new Error(versionsError.message)
            for (const version of (versions ?? []) as { file_path: string | null }[]) {
              if (version.file_path) paths.add(version.file_path)
            }
          }
        }
      }

      // Сначала удаляем файлы, пока строки сдач ещё существуют: Storage-политика
      // проверяет путь через submissions/submission_versions.
      for (const pathChunk of chunk([...paths], 100)) {
        if (!pathChunk.length) continue
        const { error: storageError } = await db.storage.from('submissions').remove(pathChunk)
        if (storageError) throw new Error(storageError.message)
      }

      const { error } = await db.from('disciplines').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  },

  profiles: {
    async getTeacher(id: string): Promise<Profile | null> {
      const { data, error } = await client()
        .from('teacher_profiles')
        .select('id, full_name, avatar_path, contact_email, phone, bio, created_at')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      const row = data as Omit<ProfileRow, 'role' | 'group_name'>
      return {
        id: row.id,
        role: 'admin',
        full_name: row.full_name,
        group_name: null,
        created_at: row.created_at,
        avatar_url: avatarPublicUrl(row.avatar_path),
        contact_email: row.contact_email,
        phone: row.phone,
        bio: row.bio,
      }
    },
    async updateMine(input: TeacherProfileInput): Promise<Profile> {
      const admin = await requireAdmin()
      const value = normalizeTeacherProfile(input)
      const message = validateTeacherProfile(value)
      if (message) throw new Error(message)
      const { data, error } = await client()
        .from('profiles')
        .update({
          contact_email: value.contact_email,
          phone: value.phone,
          bio: value.bio,
        })
        .eq('id', admin.id)
        .select(PROFILE_SELECT)
        .single()
      if (error) throw new Error(error.message)
      return mapProfile(data as ProfileRow)
    },
    async uploadAvatar(file: File): Promise<Profile> {
      const admin = await requireAdmin()
      const db = client()
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${admin.id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await db.storage.from('avatars').upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (uploadError) throw new Error(uploadError.message)

      const { data: old } = await db
        .from('profiles')
        .select('avatar_path')
        .eq('id', admin.id)
        .maybeSingle()

      const { data, error } = await db
        .from('profiles')
        .update({ avatar_path: path })
        .eq('id', admin.id)
        .select(PROFILE_SELECT)
        .single()
      if (error) {
        await db.storage.from('avatars').remove([path])
        throw new Error(error.message)
      }

      const oldPath = (old as { avatar_path: string | null } | null)?.avatar_path ?? null
      if (oldPath && oldPath !== path) {
        await db.storage.from('avatars').remove([oldPath])
      }
      return mapProfile(data as ProfileRow)
    },
    async removeAvatar(): Promise<Profile> {
      const admin = await requireAdmin()
      const db = client()
      const { data: old } = await db
        .from('profiles')
        .select('avatar_path')
        .eq('id', admin.id)
        .maybeSingle()
      const oldPath = (old as { avatar_path: string | null } | null)?.avatar_path ?? null

      const { data, error } = await db
        .from('profiles')
        .update({ avatar_path: null })
        .eq('id', admin.id)
        .select(PROFILE_SELECT)
        .single()
      if (error) throw new Error(error.message)
      if (oldPath) await db.storage.from('avatars').remove([oldPath])
      return mapProfile(data as ProfileRow)
    },
  },

  groups: {
    async list(): Promise<Group[]> {
      const { data, error } = await client()
        .from('groups')
        .select('name, created_at')
        .order('name')
      if (error) throw new Error(error.message)
      return (data ?? []) as Group[]
    },
    async create(name: string) {
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 20) {
        throw new Error('Название группы должно быть длиной от 1 до 20 символов')
      }
      const { data, error } = await client()
        .from('groups')
        .insert({ name: trimmed })
        .select('name, created_at')
        .single()
      if (error) {
        throw new Error(error.code === '23505' ? 'Такая группа уже существует' : error.message)
      }
      return data as Group
    },
    async rename(oldName: string, newName: string) {
      const { error } = await client().rpc('rename_group', { p_old: oldName, p_new: newName })
      if (error) throw new Error(error.message)
    },
    async remove(name: string) {
      const { error } = await client().rpc('delete_group', { p_name: name })
      if (error) throw new Error(error.message)
    },
  },

  async students(groupName: string) {
    const { data, error } = await client()
      .from('profiles')
      .select('id, role, full_name, group_name, created_at')
      .eq('group_name', groupName)
      .eq('role', 'student')
      .order('full_name')
    if (error) throw new Error(error.message)
    return (data ?? []) as Profile[]
  },

  assignments: {
    async list(disciplineId: string) {
      const { data, error } = await client()
        .from('assignments')
        .select('*')
        .eq('discipline_id', disciplineId)
        .order('assigned_date')
        .order('lesson_number')
      if (error) throw new Error(error.message)
      return (data ?? []) as Assignment[]
    },
    async create(input: NewAssignment) {
      const admin = await requireAdmin()
      const discipline = await loadOwnedDiscipline(input.discipline_id, admin.id)
      const { data, error } = await client()
        .from('assignments')
        .insert({
          discipline_id: discipline.id,
          title: input.title.trim(),
          description: input.description.trim(),
          group_name: discipline.group_name,
          subject: discipline.name,
          grade_type: input.grade_type || 'stars',
          assigned_date: input.assigned_date,
          lesson_number: input.lesson_number,
          due_at: input.due_at || null,
        })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data as Assignment
    },
    async update(id: string, input: NewAssignment) {
      const admin = await requireAdmin()
      const discipline = await loadOwnedDiscipline(input.discipline_id, admin.id)
      const { data, error } = await client()
        .from('assignments')
        .update({
          discipline_id: discipline.id,
          title: input.title.trim(),
          description: input.description.trim(),
          group_name: discipline.group_name,
          subject: discipline.name,
          grade_type: input.grade_type || 'stars',
          assigned_date: input.assigned_date,
          lesson_number: input.lesson_number,
          due_at: input.due_at || null,
        })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data as Assignment
    },
    async remove(id: string) {
      await requireAdmin()
      const db = client()
      const { data: submissions, error: submissionsError } = await db
        .from('submissions')
        .select('id, file_path')
        .eq('assignment_id', id)
      if (submissionsError) throw new Error(submissionsError.message)

      const submissionIds = (submissions ?? []).map((s: { id: string }) => s.id)
      const paths = (submissions ?? [])
        .map((s: { file_path: string | null }) => s.file_path)
        .filter((p): p is string => Boolean(p))

      // История версий удаляется каскадно вместе со сдачами, поэтому пути
      // нужно собрать до удаления задания.
      if (submissionIds.length) {
        const { data: versions } = await db
          .from('submission_versions')
          .select('file_path')
          .in('submission_id', submissionIds)
        for (const version of (versions ?? []) as { file_path: string }[]) {
          if (version.file_path) paths.push(version.file_path)
        }
      }

      // Сначала удаляем объекты, пока строки сдач и версий ещё существуют:
      // политика Storage проверяет путь по этим строкам. Если удалить задание
      // первым, каскад уберёт строки и файлы навсегда останутся в бакете.
      const uniquePaths = [...new Set(paths)].filter(Boolean)
      if (uniquePaths.length) {
        const { error: storageError } = await db.storage.from('submissions').remove(uniquePaths)
        if (storageError) throw new Error(storageError.message)
      }

      const { error } = await db.from('assignments').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  },

  async journal(disciplineId: string): Promise<JournalData> {
    await requireProfile()
    const db = client()
    const { data: discipline, error: disciplineError } = await db
      .from('disciplines')
      .select('id, name, group_name, teacher_id')
      .eq('id', disciplineId)
      .maybeSingle()
    if (disciplineError) throw new Error(disciplineError.message)
    if (!discipline) throw new Error('Дисциплина не найдена')
    const group = (discipline as { group_name: string }).group_name

    const [studentsResult, assignmentsResult] = await Promise.all([
      db
        .from('profiles')
        .select('id, role, full_name, group_name, created_at')
        .eq('group_name', group)
        .eq('role', 'student')
        .order('full_name'),
      db
        .from('assignments')
        .select('*')
        .eq('discipline_id', disciplineId)
        .order('assigned_date')
        .order('lesson_number'),
    ])
    if (studentsResult.error) throw new Error(studentsResult.error.message)
    if (assignmentsResult.error) throw new Error(assignmentsResult.error.message)

    const assignments = (assignmentsResult.data ?? []) as Assignment[]
    const assignmentIds = assignments.map((a) => a.id)
    let entries: JournalData['entries'] = []
    if (assignmentIds.length) {
      const { data, error } = await db
        .from('journal_entries')
        .select('submission_id, assignment_id, student_id, grade, status, submitted_at')
        .in('assignment_id', assignmentIds)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Array<
        Omit<JournalData['entries'][number], 'annotation_count'>
      >
      entries = rows.map((row) => ({ ...row, annotation_count: 0 }))

      // RLS отдаёт студенту только его замечания, преподавателю — все.
      const submissionIds = rows
        .map((row) => row.submission_id)
        .filter((id): id is string => Boolean(id))
      if (submissionIds.length) {
        const counts = new Map<string, number>()
        // Режем длинный список id на части, чтобы не упереться в лимит длины URL.
        for (let index = 0; index < submissionIds.length; index += 100) {
          const chunk = submissionIds.slice(index, index + 100)
          const [versionsResult, annotationsResult] = await Promise.all([
            db
              .from('submission_versions')
              .select('submission_id, created_at')
              .in('submission_id', chunk),
            db
              .from('annotations')
              .select('submission_id, created_at')
              .in('submission_id', chunk),
          ])
          if (versionsResult.error) throw new Error(versionsResult.error.message)
          if (annotationsResult.error) throw new Error(annotationsResult.error.message)

          const latestVersion = new Map<string, number>()
          for (const version of (versionsResult.data ?? []) as {
            submission_id: string
            created_at: string
          }[]) {
            const time = new Date(version.created_at).getTime()
            if (Number.isNaN(time)) continue
            const current = latestVersion.get(version.submission_id) ?? 0
            if (time > current) latestVersion.set(version.submission_id, time)
          }

          // «Исправить» показываем только для замечаний, оставленных после
          // последней загруженной версии. Новая версия автоматически снимает статус.
          for (const annotation of (annotationsResult.data ?? []) as {
            submission_id: string
            created_at: string
          }[]) {
            const time = new Date(annotation.created_at).getTime()
            const versionTime = latestVersion.get(annotation.submission_id) ?? 0
            if (Number.isNaN(time) || time > versionTime) {
              counts.set(annotation.submission_id, (counts.get(annotation.submission_id) ?? 0) + 1)
            }
          }
        }
        entries = entries.map((entry) => ({
          ...entry,
          annotation_count:
            entry.grade == null && entry.submission_id
              ? counts.get(entry.submission_id) ?? 0
              : 0,
        }))
      }
    }

    return {
      assignments,
      students: (studentsResult.data ?? []) as Profile[],
      entries,
    }
  },

  submissions: {
    async mine() {
      const profile = await requireStudent()
      const { data, error } = await client()
        .from('submissions')
        .select('*')
        .eq('student_id', profile.id)
        .order('submitted_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as Submission[]
    },
    async list(disciplineId: string, filters: SubmissionFilters = {}): Promise<WorkRow[]> {
      const admin = await requireAdmin()
      const discipline = await loadOwnedDiscipline(disciplineId, admin.id)
      const db = client()
      const [assignmentsResult, studentsResult] = await Promise.all([
        db.from('assignments').select('*').eq('discipline_id', disciplineId),
        db
          .from('profiles')
          .select('id, full_name, group_name, role')
          .eq('group_name', discipline.group_name)
          .eq('role', 'student'),
      ])
      if (assignmentsResult.error) throw new Error(assignmentsResult.error.message)
      if (studentsResult.error) throw new Error(studentsResult.error.message)

      const assignments = (assignmentsResult.data ?? []) as Assignment[]
      const assignmentById = new Map(assignments.map((a) => [a.id, a]))
      const studentById = new Map(
        ((studentsResult.data ?? []) as Profile[]).map((s) => [s.id, s]),
      )
      const assignmentIds = filters.assignmentId ? [filters.assignmentId] : assignments.map((a) => a.id)
      if (!assignmentIds.length) return []

      let query = db
        .from('submissions')
        .select('*')
        .in('assignment_id', assignmentIds)
        .order('submitted_at', { ascending: false })
      if (filters.studentId) query = query.eq('student_id', filters.studentId)
      const { data, error } = await query
      if (error) throw new Error(error.message)

      return ((data ?? []) as Submission[])
        .map((submission) => {
          const assignment = assignmentById.get(submission.assignment_id)
          const student = studentById.get(submission.student_id)
          if (!assignment || !student) return null
          return {
            submission,
            assignment,
            student: {
              id: student.id,
              full_name: student.full_name,
              group_name: student.group_name,
            },
          } satisfies WorkRow
        })
        .filter((row): row is WorkRow => row !== null)
    },
    async get(id: string) {
      const { data, error } = await client().from('submissions').select('*').eq('id', id).single()
      if (error) throw new Error(error.message)
      return data as Submission
    },
    async upload(assignmentId, file, onProgress) {
      const profile = await requireStudent()
      return storeSubmission(profile, assignmentId, file, onProgress)
    },
    async replace(submissionId, file, onProgress) {
      const profile = await requireStudent()
      const { data: submission, error } = await client()
        .from('submissions')
        .select('*')
        .eq('id', submissionId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!submission) throw new Error('Работа не найдена')
      if (submission.student_id !== profile.id) throw new Error('Это чужая работа')
      return storeSubmission(profile, submission.assignment_id, file, onProgress)
    },
    async setGrade(
      submissionId: string,
      grade: number | null,
      options: { deleteFiles?: boolean } = {},
    ) {
      const admin = await requireAdmin()
      const { data: submission, error: submissionError } = await client()
        .from('submissions')
        .select('assignment_id, grade')
        .eq('id', submissionId)
        .single()
      if (submissionError) throw new Error(submissionError.message)
      const { data: assignment, error: assignmentError } = await client()
        .from('assignments')
        .select('grade_type, discipline_id')
        .eq('id', (submission as { assignment_id: string }).assignment_id)
        .single()
      if (assignmentError) throw new Error(assignmentError.message)
      const disciplineId = (assignment as { discipline_id: string | null }).discipline_id
      if (!disciplineId) throw new Error('Задание не привязано к дисциплине')
      await loadOwnedDiscipline(disciplineId, admin.id)

      const message = validateGrade(
        (assignment as { grade_type: string | null }).grade_type,
        grade,
      )
      if (message) throw new Error(message)

      // Блокируем только первую оценку. Если оценка уже стоит, преподаватель
      // может её изменить или снять, даже если замечания остались.
      if (grade != null && (submission as { grade: number | null }).grade == null) {
        const { data: lastVersion, error: versionError } = await client()
          .from('submission_versions')
          .select('created_at')
          .eq('submission_id', submissionId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (versionError) throw new Error(versionError.message)

        let annotationQuery = client()
          .from('annotations')
          .select('id', { count: 'exact', head: true })
          .eq('submission_id', submissionId)
        const latestVersionAt = (lastVersion as { created_at?: string } | null)?.created_at
        if (latestVersionAt) {
          annotationQuery = annotationQuery.gt('created_at', latestVersionAt)
        }
        const { count, error: annotationError } = await annotationQuery
        if (annotationError) throw new Error(annotationError.message)
        if ((count ?? 0) > 0) {
          throw new Error(
            'Сначала исправьте замечания: пока они активны, оценку ставить нельзя',
          )
        }
      }

      const { data, error } = await client()
        .from('submissions')
        .update({
          grade,
          status: grade != null ? 'reviewed' : 'submitted',
          reviewed_at: grade != null ? new Date().toISOString() : null,
        })
        .eq('id', submissionId)
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      let updated = data as Submission

      if (grade != null && options.deleteFiles) {
        const deleted = await deleteFilesForSubmission(submissionId)
        if (deleted) {
          const { data: refreshed, error: refreshError } = await client()
            .from('submissions')
            .select('*')
            .eq('id', submissionId)
            .single()
          if (refreshError) throw new Error(refreshError.message)
          updated = refreshed as Submission
        }
      }
      return updated
    },
    async markSubmitted(assignmentId: string, studentId: string) {
      await requireAdmin()
      const { data, error } = await client()
        .from('submissions')
        .insert({
          assignment_id: assignmentId,
          student_id: studentId,
          status: 'submitted',
          version: 1,
        })
        .select('*')
        .single()
      if (error) {
        if (error.code === '23505') {
          const { data: existing, error: existingError } = await client()
            .from('submissions')
            .select('*')
            .eq('assignment_id', assignmentId)
            .eq('student_id', studentId)
            .single()
          if (existingError) throw new Error(existingError.message)
          return existing as Submission
        }
        throw new Error(error.message)
      }
      return data as Submission
    },
    async remove(submissionId: string) {
      await requireAdmin()
      const db = client()
      const { data } = await db
        .from('submissions')
        .select('file_path')
        .eq('id', submissionId)
        .maybeSingle()
      const currentPath = (data as { file_path: string | null } | null)?.file_path

      // Сначала собираем файлы всех версий, иначе после каскадного удаления
      // строк узнать их пути будет уже нельзя, и объекты останутся в бакете.
      const { data: versions } = await db
        .from('submission_versions')
        .select('file_path')
        .eq('submission_id', submissionId)
      const paths = [
        ...(currentPath ? [currentPath] : []),
        ...((versions ?? []) as { file_path: string }[]).map((version) => version.file_path),
      ]

      const uniquePaths = [...new Set(paths)].filter(Boolean)
      if (uniquePaths.length) {
        // Удаляем объекты до строки сдачи: иначе политика Storage уже не сможет
        // сопоставить путь с работой и откажет в удалении.
        const { error: storageError } = await db.storage.from('submissions').remove(uniquePaths)
        if (storageError) throw new Error(storageError.message)
      }

      const { error } = await db.from('submissions').delete().eq('id', submissionId)
      if (error) throw new Error(error.message)
    },
    async versions(submissionId: string) {
      const { data, error } = await client()
        .from('submission_versions')
        .select('*')
        .eq('submission_id', submissionId)
        .order('version', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as SubmissionVersion[]
    },
    async saveText(submissionId: string, text: string) {
      const profile = await requireStudent()
      const { data: submission, error } = await client()
        .from('submissions')
        .select('*')
        .eq('id', submissionId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!submission) throw new Error('Работа не найдена')
      if (submission.student_id !== profile.id) throw new Error('Это чужая работа')
      if (submission.grade != null) throw new Error('Оценённая работа заблокирована')
      if (!String(submission.original_name ?? '').toLowerCase().endsWith('.txt')) {
        throw new Error('Онлайн-редактирование доступно только для TXT')
      }
      const file = new File([text], submission.original_name as string, { type: 'text/plain' })
      return storeSubmission(profile, submission.assignment_id, file)
    },
    async cleanupReviewedFiles() {
      await requireAdmin()
      const db = client()

      const { data, error } = await db
        .from('submissions')
        .select('id, file_path')
        .not('grade', 'is', null)
        .is('file_deleted_at', null)
      if (error) throw new Error(error.message)

      const rows = (data ?? []) as { id: string; file_path: string | null }[]
      if (!rows.length) return 0
      const submissionIds = rows.map((row) => row.id)

      const { data: versionData, error: versionError } = await db
        .from('submission_versions')
        .select('submission_id, file_path')
        .in('submission_id', submissionIds)
      if (versionError) throw new Error(versionError.message)

      const withFiles = new Set<string>()
      for (const row of rows) {
        if (row.file_path) withFiles.add(row.id)
      }
      for (const version of (versionData ?? []) as {
        submission_id: string
        file_path: string | null
      }[]) {
        if (version.file_path) withFiles.add(version.submission_id)
      }
      if (!withFiles.size) return 0

      const paths = [
        ...new Set(
          [
            ...rows.map((row) => row.file_path),
            ...((versionData ?? []) as { file_path: string | null }[]).map(
              (version) => version.file_path,
            ),
          ].filter((path): path is string => Boolean(path)),
        ),
      ]

      // Сначала удаляем объекты, затем помечаем строки. Если обновление не
      // пройдёт, следующий запуск повторит попытку (повторное удаление безопасно).
      if (paths.length) {
        const { error: storageError } = await db.storage.from('submissions').remove(paths)
        if (storageError) throw new Error(storageError.message)
      }

      const deletedAt = new Date().toISOString()
      const ids = [...withFiles]
      const { error: updateError } = await db
        .from('submissions')
        .update({ file_path: null, file_deleted_at: deletedAt })
        .in('id', ids)
      if (updateError) throw new Error(updateError.message)

      const { error: versionsError } = await db
        .from('submission_versions')
        .update({ file_path: null, file_deleted_at: deletedAt })
        .in('submission_id', ids)
      if (versionsError) throw new Error(versionsError.message)

      return ids.length
    },
  },

  testData: {
    async seed(disciplineId: string): Promise<TestDataResult> {
      const admin = await requireAdmin()
      const discipline = await loadOwnedDiscipline(disciplineId, admin.id)
      const db = client()
      const errors: string[] = []

      const { data: existingStudents, error: studentsError } = await db
        .from('profiles')
        .select('full_name')
        .eq('group_name', discipline.group_name)
        .eq('role', 'student')
      if (studentsError) throw new Error(studentsError.message)
      const existingNames = new Set(
        ((existingStudents ?? []) as { full_name: string }[]).map((row) =>
          row.full_name.toLocaleLowerCase('ru-RU'),
        ),
      )
      const missingStudents = TEST_STUDENTS.filter(
        (name) => !existingNames.has(name.toLocaleLowerCase('ru-RU')),
      )

      let studentsCreated = 0
      for (const names of chunk([...missingStudents], 5)) {
        const results = await Promise.allSettled(
          names.map(async (fullName) => {
            const { data, error } = await db.functions.invoke('register', {
              body: { fullName, groupName: discipline.group_name },
            })
            if (error) {
              throw new Error(await edgeFunctionError(error, 'Не удалось создать студента'))
            }
            if (data?.error) throw new Error(String(data.error))
          }),
        )
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            studentsCreated += 1
          } else {
            errors.push(`${names[index]}: ${(result.reason as Error).message}`)
          }
        })
      }

      const { data: existingAssignments, error: assignmentsError } = await db
        .from('assignments')
        .select('title')
        .eq('discipline_id', disciplineId)
      if (assignmentsError) throw new Error(assignmentsError.message)
      const existingTitles = new Set(
        ((existingAssignments ?? []) as { title: string }[]).map((row) =>
          row.title.toLocaleLowerCase('ru-RU'),
        ),
      )
      const generatedAll = buildTestAssignments()
      const generated = generatedAll.filter(
        (assignment) => !existingTitles.has(assignment.title.toLocaleLowerCase('ru-RU')),
      )

      let assignmentsCreated = 0
      for (const rows of chunk(generated, 10)) {
        const { error } = await db.from('assignments').insert(
          rows.map((assignment) => ({
            discipline_id: discipline.id,
            title: assignment.title,
            description: assignment.description,
            group_name: discipline.group_name,
            subject: discipline.name,
            grade_type: assignment.grade_type,
            assigned_date: assignment.assigned_date,
            lesson_number: assignment.lesson_number,
            due_at: assignment.due_at,
          })),
        )
        if (error) {
          errors.push(error.message)
        } else {
          assignmentsCreated += rows.length
        }
      }

      return {
        studentsCreated,
        assignmentsCreated,
        studentsSkipped: TEST_STUDENTS.length - missingStudents.length,
        assignmentsSkipped: generatedAll.length - generated.length,
        errors,
      }
    },
  },

  annotations: {
    async list(submissionId): Promise<Annotation[]> {
      const { data, error } = await client()
        .from('annotations')
        .select('*')
        .eq('submission_id', submissionId)
        .order('created_at')
      if (error) throw new Error(error.message)
      return (data ?? []) as Annotation[]
    },
    async create(input: AnnotationInput) {
      const admin = await requireAdmin()
      if (!input.comment.trim()) throw new Error('Добавьте комментарий к замечанию')
      const { data, error } = await client()
        .from('annotations')
        .insert({
          submission_id: input.submission_id,
          kind: input.kind,
          page: input.page ?? null,
          rects: input.rects ?? null,
          range: input.range ?? null,
          color: input.color,
          comment: input.comment.trim(),
          created_by: admin.id,
        })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data as Annotation
    },
    async remove(id: string) {
      await requireAdmin()
      const { error } = await client().from('annotations').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
  },

  files: {
    async blob(path: string) {
      const url = await supabaseBackend.files.url(path)
      const response = await fetch(url)
      if (!response.ok) throw new Error('Не удалось скачать файл из хранилища')
      return response.blob()
    },
    async url(path: string) {
      const { data, error } = await client()
        .storage.from('submissions')
        .createSignedUrl(path, 60 * 30)
      if (error || !data?.signedUrl) {
        throw new Error(error?.message || 'Не удалось получить ссылку на файл')
      }
      return data.signedUrl
    },
    async download(path: string, name: string) {
      const blob = await supabaseBackend.files.blob(path)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    },
  },
}

