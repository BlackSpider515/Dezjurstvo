import type {
  Annotation,
  Assignment,
  Discipline,
  Group,
  Profile,
  Submission,
  SubmissionVersion,
} from '../types'
const DB_KEY = 'diary_demo_v5'
const DB_VERSION = 5 as const

export interface DemoUser {
  login: string
  password: string
  profile: Profile
}

export interface DemoDb {
  version: typeof DB_VERSION
  groups: Group[]
  users: DemoUser[]
  disciplines: Discipline[]
  assignments: Assignment[]
  submissions: Submission[]
  versions: SubmissionVersion[]
  annotations: Annotation[]
  sessionLogin: string | null
}

function now(): string {
  return new Date().toISOString()
}

export function demoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function createSeedDb(): DemoDb {
  const created = now()
  const groups: Group[] = ['211', '311'].map((name) => ({ name, created_at: created }))

  return {
    version: DB_VERSION,
    groups,
    users: [],
    disciplines: [],
    assignments: [],
    submissions: [],
    versions: [],
    annotations: [],
    sessionLogin: null,
  }
}

let cache: DemoDb | null = null

export function loadDb(): DemoDb {
  // В демо-режиме один и тот же браузер могут открывать в нескольких вкладках
  // (например, студент и преподаватель). Всегда читаем актуальную копию из
  // localStorage, иначе вкладка с устаревшим кэшем затрёт чужие данные.
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDb
      if (parsed && parsed.version === DB_VERSION) {
        cache = parsed
        return cache
      }
    }
  } catch (error) {
    console.warn('Не удалось прочитать демо-базу', error)
  }
  if (cache) return cache
  cache = createSeedDb()
  saveDb()
  return cache
}

export function saveDb(): void {
  if (!cache) return
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(cache))
  } catch (error) {
    console.warn('Не удалось сохранить демо-базу', error)
  }
}

export function resetDb(): void {
  cache = createSeedDb()
  saveDb()
}

export function patchDb(mutator: (db: DemoDb) => void): void {
  const db = loadDb()
  mutator(db)
  saveDb()
}

export function getSessionProfile(): Profile | null {
  const db = loadDb()
  if (!db.sessionLogin) return null
  const user = db.users.find((u) => u.login === db.sessionLogin)
  return user ? { ...user.profile } : null
}

export function coerceProfile(value: Profile): Profile {
  return {
    id: value.id,
    role: value.role,
    full_name: value.full_name,
    group_name: value.group_name,
    created_at: value.created_at,
    avatar_url: value.avatar_url ?? null,
    contact_email: value.contact_email ?? null,
    phone: value.phone ?? null,
    bio: value.bio ?? null,
  }
}

// ---------------- IndexedDB для файлов демо-режима ----------------

const FILE_DB = 'diary_demo_files'
const FILE_STORE = 'files'

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function putDemoFile(path: string, blob: Blob): Promise<void> {
  const db = await openFileDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite')
    tx.objectStore(FILE_STORE).put(blob, path)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function getDemoFile(path: string): Promise<Blob | null> {
  const db = await openFileDb()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readonly')
    const req = tx.objectStore(FILE_STORE).get(path)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return blob
}

export async function deleteDemoFile(path: string): Promise<void> {
  const db = await openFileDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite')
    tx.objectStore(FILE_STORE).delete(path)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function clearDemoFiles(): Promise<void> {
  const db = await openFileDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite')
    tx.objectStore(FILE_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
