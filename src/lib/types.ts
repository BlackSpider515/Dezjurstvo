export type Role = 'student' | 'admin'
export type GradeType = 'stars' | 'pass_fail' | 'points'

export interface Profile {
  id: string
  role: Role
  full_name: string
  group_name: string | null
  created_at: string
  avatar_url?: string | null
  contact_email?: string | null
  phone?: string | null
  bio?: string | null
}

export interface TeacherProfileInput {
  contact_email: string | null
  phone: string | null
  bio: string | null
}

export interface TestDataResult {
  studentsCreated: number
  assignmentsCreated: number
  studentsSkipped: number
  assignmentsSkipped: number
  errors: string[]
}

export interface Group {
  name: string
  created_at: string
}

export interface Discipline {
  id: string
  name: string
  group_name: string
  teacher_id: string
  teacher_name: string
  created_at: string
}

export interface Assignment {
  id: string
  discipline_id: string | null
  title: string
  description: string
  group_name: string
  subject: string
  grade_type: GradeType
  assigned_date: string
  lesson_number: number
  due_at: string | null
  created_at: string
}

export type SubmissionStatus = 'submitted' | 'reviewed' | 'revoked'

export interface Submission {
  id: string
  assignment_id: string
  student_id: string
  file_path: string | null
  original_name: string | null
  mime: string | null
  size: number | null
  submitted_at: string
  grade: number | null
  status: SubmissionStatus
  version: number
  reviewed_at: string | null
  file_deleted_at: string | null
  updated_at: string
}

export interface SubmissionVersion {
  id: string
  submission_id: string
  file_path: string | null
  original_name: string | null
  mime: string | null
  size: number | null
  version: number
  created_at: string
  file_deleted_at: string | null
}

export interface AnnotationRange {
  start: number
  end: number
  text: string
}

export interface AnnotationRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Annotation {
  id: string
  submission_id: string
  kind: 'pdf' | 'text'
  page: number | null
  rects: AnnotationRect[] | null
  range: AnnotationRange | null
  color: string
  comment: string
  created_by: string | null
  created_at: string
}

export interface JournalEntry {
  submission_id: string | null
  assignment_id: string
  student_id: string
  grade: number | null
  status: SubmissionStatus | null
  submitted_at: string | null
  /** Активные замечания: оставленные после последней загруженной версии. */
  annotation_count: number
}

export interface JournalData {
  assignments: Assignment[]
  students: Profile[]
  entries: JournalEntry[]
}

export interface StudentCredentials {
  login: string
  password: string
  fullName?: string
  groupName?: string
}

export interface TeacherRegistration {
  profile: Profile
  login: string
}

export interface NewAssignment {
  title: string
  description: string
  discipline_id: string
  grade_type: GradeType
  assigned_date: string
  lesson_number: number
  due_at: string | null
}

export interface NewDiscipline {
  name: string
  groupName: string
}

export interface WorkRow {
  submission: Submission
  assignment: Assignment
  student: Pick<Profile, 'id' | 'full_name' | 'group_name'>
}

export type UploadProgress = (percent: number) => void

export interface FileWithMeta {
  path: string
  name: string
  mime: string | null
  size: number | null
}
