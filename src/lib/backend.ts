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

export interface AnnotationInput {
  submission_id: string
  kind: 'pdf' | 'text'
  page?: number | null
  rects?: { x: number; y: number; w: number; h: number }[] | null
  range?: { start: number; end: number; text: string } | null
  color: string
  comment: string
}

export interface SubmissionFilters {
  assignmentId?: string
  studentId?: string
}

export interface Backend {
  mode: 'supabase' | 'demo'
  auth: {
    getProfile: () => Promise<Profile | null>
    onAuthChange: (callback: (profile: Profile | null) => void) => () => void
    signIn: (login: string, password: string) => Promise<Profile>
    signOut: () => Promise<void>
    register: (fullName: string, groupName: string) => Promise<StudentCredentials>
    registerTeacher: (fullName: string, password: string) => Promise<TeacherRegistration>
  }
  disciplines: {
    list: () => Promise<Discipline[]>
    create: (input: NewDiscipline) => Promise<Discipline>
    remove: (id: string) => Promise<void>
  }
  profiles: {
    getTeacher: (id: string) => Promise<Profile | null>
    updateMine: (input: TeacherProfileInput) => Promise<Profile>
    uploadAvatar: (file: File) => Promise<Profile>
    removeAvatar: () => Promise<Profile>
  }
  groups: {
    list: () => Promise<Group[]>
    create: (name: string) => Promise<Group>
    rename: (oldName: string, newName: string) => Promise<void>
    remove: (name: string) => Promise<void>
  }
  students: (groupName: string) => Promise<Profile[]>
  assignments: {
    list: (disciplineId: string) => Promise<Assignment[]>
    create: (input: NewAssignment) => Promise<Assignment>
    update: (id: string, input: NewAssignment) => Promise<Assignment>
    remove: (id: string) => Promise<void>
  }
  journal: (disciplineId: string) => Promise<JournalData>
  submissions: {
    mine: () => Promise<Submission[]>
    list: (disciplineId: string, filters?: SubmissionFilters) => Promise<WorkRow[]>
    get: (id: string) => Promise<Submission>
    upload: (assignmentId: string, file: File, onProgress?: UploadProgress) => Promise<Submission>
    replace: (submissionId: string, file: File, onProgress?: UploadProgress) => Promise<Submission>
    setGrade: (
      submissionId: string,
      grade: number | null,
      options?: { deleteFiles?: boolean },
    ) => Promise<Submission>
    markSubmitted: (assignmentId: string, studentId: string) => Promise<Submission>
    remove: (submissionId: string) => Promise<void>
    versions: (submissionId: string) => Promise<SubmissionVersion[]>
    saveText: (submissionId: string, text: string) => Promise<Submission>
    /** Удаляет файлы проверенных работ, оставшиеся в хранилище. */
    cleanupReviewedFiles: () => Promise<number>
  }
  annotations: {
    list: (submissionId: string) => Promise<Annotation[]>
    create: (input: AnnotationInput) => Promise<Annotation>
    remove: (id: string) => Promise<void>
  }
  testData: {
    /** Добавляет 30 тестовых студентов и 50 заданий в выбранную дисциплину. */
    seed: (disciplineId: string) => Promise<TestDataResult>
  }
  files: {
    blob: (path: string) => Promise<Blob>
    url: (path: string) => Promise<string>
    download: (path: string, name: string) => Promise<void>
  }
  resetDemo?: () => Promise<void>
}
