// Supabase Edge Function: register-teacher
// Создаёт аккаунт преподавателя только для ФИО из teacher_allowlist.
// Пароль придумывает сам преподаватель; логин генерируется и возвращается.
//
// Деплой:
//   supabase functions deploy register-teacher --no-verify-jwt
// Секреты SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY доступны автоматически.
// service_role не попадает во фронтенд.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

function normalizeFullName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function isValidFullName(value: string): boolean {
  return (
    value.length >= 5 &&
    value.length <= 150 &&
    /^[А-Яа-яЁёA-Za-z\s-]+$/.test(value) &&
    value.split(' ').filter(Boolean).length >= 3
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Сервер не настроен: отсутствуют переменные Supabase' }, 500)
  }

  let payload: { fullName?: string; password?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Некорректный запрос' }, 400)
  }

  const fullName = normalizeFullName(String(payload.fullName ?? ''))
  const password = String(payload.password ?? '')

  if (!isValidFullName(fullName)) {
    return json({ error: 'Укажите ФИО полностью: фамилия, имя и отчество' }, 400)
  }
  if (password.length < 8) {
    return json({ error: 'Пароль должен содержать минимум 8 символов' }, 400)
  }
  if (password.length > 72) {
    return json({ error: 'Пароль должен быть не длиннее 72 символов' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Проверяем разрешение до создания auth.users. Сравниваем ФИО в JS,
  // чтобы регистр не зависел от локали и collation базы.
  const { data: allowRows, error: allowError } = await admin
    .from('teacher_allowlist')
    .select('full_name, claimed_by')

  if (allowError) {
    return json({ error: 'Не удалось проверить список преподавателей' }, 500)
  }
  const allow =
    (allowRows ?? []).find(
      (row: { full_name: string }) =>
        normalizeFullName(row.full_name).toLowerCase() === fullName.toLowerCase(),
    ) ?? null
  if (!allow) {
    return json(
      { error: 'Этого преподавателя нет в утверждённом списке. Обратитесь к администратору дневника.' },
      403,
    )
  }
  if (allow.claimed_by) {
    return json(
      { error: 'Преподаватель с таким ФИО уже зарегистрирован. Войдите в свой кабинет.' },
      409,
    )
  }

  // Храним ФИО в том виде, в котором оно записано в allowlist, а не так,
  // как его набрал пользователь (регистр и лишние пробелы не важны для поиска).
  const canonicalName = allow.full_name

  const { data: adminProfiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'admin')

  const existingProfile = (adminProfiles ?? []).find(
    (profile: { full_name: string }) =>
      normalizeFullName(profile.full_name).toLowerCase() === fullName.toLowerCase(),
  )

  if (existingProfile) {
    return json(
      { error: 'Преподаватель с таким ФИО уже зарегистрирован. Войдите в свой кабинет.' },
      409,
    )
  }

  // Логин по фамилии. Для уже занятого логина добавляем номер.
  const base = translit(fullName.split(' ')[0]).slice(0, 16) || 'teacher'
  let login = ''
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`
    const { data: clash, error: clashError } = await admin
      .from('profiles')
      .select('id')
      .eq('login', candidate)
      .maybeSingle()
    if (clashError) {
      return json({ error: 'Не удалось подобрать логин' }, 500)
    }
    if (!clash) {
      login = candidate
      break
    }
  }
  if (!login) login = `teacher${Date.now().toString().slice(-8)}`

  const email = `${login}@diary.local`
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: canonicalName, role: 'admin', login },
  })

  if (createError || !created.user) {
    return json(
      { error: 'Не удалось создать аккаунт преподавателя. Попробуйте войти или обратитесь к администратору.' },
      500,
    )
  }

  const userId = created.user.id
  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    role: 'admin',
    full_name: canonicalName,
    group_name: null,
    login,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    return json({ error: 'Не удалось создать профиль преподавателя. Попробуйте ещё раз.' }, 500)
  }

  // Атомарно закрепляем ФИО за созданным профилем. Если параллельный запрос
  // успел раньше, откатываем только что созданный аккаунт.
  const { data: claimed, error: claimError } = await admin
    .from('teacher_allowlist')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('full_name', canonicalName)
    .is('claimed_by', null)
    .select('full_name')
    .maybeSingle()

  if (claimError || !claimed) {
    await admin.auth.admin.deleteUser(userId)
    return json(
      { error: 'Этот преподаватель уже зарегистрирован. Войдите в свой кабинет.' },
      409,
    )
  }

  return json({ login, email, fullName: canonicalName })
})
