// Supabase Edge Function: register
// Создаёт аккаунт студента (auth.users + public.profiles) с service_role
// и возвращает сгенерированные логин/пароль ОДИН раз.
//
// Деплой:
//   supabase functions deploy register --no-verify-jwt
// Секреты Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) доступны автоматически.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function translit(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? (/[a-z0-9]/.test(ch) ? ch : ''))
    .join('')
    .replace(/[^a-z0-9]/g, '')
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('')
}

function normalizeFullName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function isValidFullName(value: string): boolean {
  return value.length >= 5 && value.length <= 150 && /^[А-Яа-яЁёA-Za-z\s-]+$/.test(value) && value.split(' ').length >= 2
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Сервер не настроен: отсутствуют переменные Supabase' }, 500)
  }

  let payload: { fullName?: string; groupName?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  const fullName = normalizeFullName(String(payload.fullName ?? ''))
  const groupName = String(payload.groupName ?? '').trim()

  if (!isValidFullName(fullName)) {
    return json({ error: 'Укажите ФИО полностью (только буквы, пробелы и дефис)' }, 400)
  }
  if (!groupName) {
    return json({ error: 'Выберите группу' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Группа должна существовать (список групп ведёт преподаватель).
  const { data: group, error: groupError } = await admin
    .from('groups')
    .select('name')
    .eq('name', groupName)
    .maybeSingle()

  if (groupError || !group) return json({ error: 'Такой группы не существует' }, 404)

  // Защита от дублей: ФИО + группа (без учёта регистра).
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('group_name', groupName)
    .ilike('full_name', fullName)
    .maybeSingle()

  if (existing) {
    return json(
      { error: 'Студент с таким ФИО уже зарегистрирован в этой группе. Войдите со своими логином и паролем.' },
      409,
    )
  }

  // Уникальный логин вида botnar4821@diary.local
  const base = translit(fullName.split(' ')[0]).slice(0, 12) || 'student'
  let login = ''
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`
    const { data: clash } = await admin.from('profiles').select('id').eq('login', candidate).maybeSingle()
    if (!clash) {
      login = candidate
      break
    }
  }
  if (!login) login = `student${Date.now().toString().slice(-8)}`

  const password = randomString(10)
  const email = `${login}@diary.local`

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, group_name: groupName, login },
  })

  if (createError || !created.user) {
    return json({ error: 'Не удалось создать аккаунт. Попробуйте ещё раз.' }, 500)
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    role: 'student',
    full_name: fullName,
    group_name: groupName,
    login,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id)
    if (profileError.code === '23505') {
      return json({ error: 'Студент с таким ФИО уже зарегистрирован в этой группе.' }, 409)
    }
    return json({ error: 'Не удалось создать профиль. Попробуйте ещё раз.' }, 500)
  }

  return json({ login, password, email, fullName, groupName })
})
