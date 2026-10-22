/* ==========================================================================
   app.js — вся логика сайта «Дежурства группы».

   Один и тот же файл работает и на index.html (только просмотр),
   и на admin.html (просмотр + редактирование).
   Режим определяется атрибутом <body data-page="view|admin">.

   Данные лежат в Firebase Firestore:
     people  — { name, days }                       люди и счётчик дней
     pairs   — { order, memberIds, memberNames }    пары и очередь
     duties  — { week, day, personId, status, ... } дежурства
     meta    — служебный документ «база уже создана»
   ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, writeBatch, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  firebaseConfig, IS_CONFIGURED, GROUP_TITLE, ANCHOR_DATE, SEED_PAIRS,
  DUTY_DAYS, ROOM_BY_DAY, DEFAULT_ROOM, OFF_MONTHS, SEASON_START
} from './firebase-config.js';


/* ==========================================================================
   1. НЕБОЛЬШИЕ УТИЛИТЫ (даты, текст, всплывающие подсказки)
   ========================================================================== */

const MS_DAY = 24 * 60 * 60 * 1000;

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

/** Дежурные дни недели по порядку (например [1,2,3,4,5] = вторник–суббота). */
const DUTY_DAY_LIST = [...DUTY_DAYS].sort((a, b) => a - b);

/** Сколько недель вперёд показывать в карточке «Кто дежурит дальше». */
const NEXT_WEEKS_COUNT = 4;

/** Кабинет для дня недели: 2 -> "12", остальные -> DEFAULT_ROOM. */
function roomForDay(day) {
  return ROOM_BY_DAY[day] || DEFAULT_ROOM;
}

/** Описание кабинетов словами (для подсказок). */
function roomsHint() {
  const special = DUTY_DAY_LIST
    .filter((d) => ROOM_BY_DAY[d])
    .map((d) => `${DAYS_SHORT[d]} — каб. ${ROOM_BY_DAY[d]}`);
  const rest = DUTY_DAY_LIST.filter((d) => !ROOM_BY_DAY[d]);
  const parts = [];
  if (rest.length) parts.push(`остальные дни — каб. ${DEFAULT_ROOM}`);
  return [...special, ...parts].join(', ');
}

/** Экранирование текста, чтобы имена не могли сломать разметку. */
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** "2026-03-09" -> Date (локальное время, без сюрпризов часовых поясов). */
function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date -> "2026-03-09" */
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

/** Понедельник той недели, в которую попадает дата. */
function mondayOf(date) {
  const d = startOfDay(date);
  const weekday = (d.getDay() + 6) % 7; // 0 = понедельник ... 6 = воскресенье
  return addDays(d, -weekday);
}

/** Ключ недели — ISO-дата её понедельника. Именно он хранится в базе. */
function weekKeyOf(date) {
  return toISO(mondayOf(date));
}

function todayISO() {
  return toISO(new Date());
}

/** "9 – 15 марта 2026" */
function weekLabel(weekKey) {
  const mon = parseISO(weekKey);
  const sun = addDays(mon, 6);
  const y = sun.getFullYear();
  if (mon.getMonth() === sun.getMonth()) {
    return `${mon.getDate()} – ${sun.getDate()} ${MONTHS_GEN[sun.getMonth()]} ${y}`;
  }
  return `${mon.getDate()} ${MONTHS_GEN[mon.getMonth()]} – ` +
    `${sun.getDate()} ${MONTHS_GEN[sun.getMonth()]} ${y}`;
}

/** "9 марта" */
function dayShort(date) {
  return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]}`;
}

/** Русское склонение: plural(1, ['день','дня','дней']) -> "день" */
function plural(n, forms) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

let toastTimer = null;
/** Короткое сообщение внизу экрана. type: 'ok' | 'err' */
function toast(message, type = 'ok') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.className = 'toast show' + (type === 'err' ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    t.hidden = true;
  }, 3400);
}

function showError(err) {
  console.error(err);
  const text = err && err.message ? err.message : String(err);
  toast('Ошибка: ' + text, 'err');
}


/* ==========================================================================
   2. СОСТОЯНИЕ ПРИЛОЖЕНИЯ
   ========================================================================== */

const state = {
  mode: document.body.dataset.page === 'admin' ? 'admin' : 'view',
  user: null,
  authChecked: false,
  loaded: { people: false, pairs: false, duties: false },
  people: [],   // [{ id, name, days }]
  pairs: [],    // [{ id, order, memberIds, memberNames }]
  duties: [],   // [{ id, week, day, personId, personName, role, status }]
  week: nextDutyWeek(weekKeyOf(new Date())),  // какая неделя сейчас показана
  tab: 'week',
  editingPair: null,
  busy: false,
  syncing: false,
  unsubs: []
};

const ANCHOR_MONDAY = toISO(mondayOf(parseISO(ANCHOR_DATE)));

let db = null;
let auth = null;


/* ==========================================================================
   3. ЛОГИКА ДЕЖУРСТВ
   ========================================================================== */

/** Номер недели относительно точки отсчёта (0 — неделя пары №1). */
function weekNumber(weekKey) {
  const diff = parseISO(weekKey).getTime() - parseISO(ANCHOR_MONDAY).getTime();
  return Math.round(diff / (7 * MS_DAY));
}

/**
 * Каникулярная неделя?
 * Так считается, только если ВСЕ дежурные дни этой недели попали в каникулярные
 * месяцы. Если в неделе есть хотя бы один дежурный день — неделя рабочая
 * (иначе терялась бы первая неделя сентября, когда 1-е число не понедельник).
 */
function isOffWeek(weekKey) {
  const mon = parseISO(weekKey);
  return DUTY_DAY_LIST.every((day) => OFF_MONTHS.includes(addDays(mon, day).getMonth()));
}

/** Первый день учебной сессии для указанной даты (обычно 1 сентября). */
function seasonStartFor(date) {
  const [month, day] = String(SEASON_START).split('-').map(Number);
  let year = date.getFullYear();
  let start = new Date(year, (month || 9) - 1, day || 1);
  if (start > date) {
    year -= 1;
    start = new Date(year, (month || 9) - 1, day || 1);
  }
  return start;
}

/**
 * Точка отсчёта очереди для этой недели:
 * понедельник недели, в которую попадает начало сессии (1 сентября).
 * Раньше самой первой точки отсчёта (ANCHOR_DATE) не уходим.
 */
function seasonAnchorMonday(weekKey) {
  const mon = parseISO(weekKey);
  // Неделю относим к сессии, если 1 сентября попадает в эту неделю,
  // поэтому смотрим на конец недели (воскресенье), а не на понедельник.
  const monday = mondayOf(seasonStartFor(addDays(mon, 6)));
  return monday.getTime() < parseISO(ANCHOR_MONDAY).getTime() ? parseISO(ANCHOR_MONDAY) : monday;
}

const dutyIndexCache = new Map();

/**
 * Номер недели в очереди.
 * Считается от начала сессии (1 сентября), поэтому каждый учебный год
 * очередь снова начинается с пары №1. Каникулярные недели не считаются.
 */
function dutyWeekIndex(weekKey) {
  if (dutyIndexCache.has(weekKey)) return dutyIndexCache.get(weekKey);

  const target = parseISO(weekKey);
  const anchor = seasonAnchorMonday(weekKey);
  let index = 0;
  let cursor = anchor;

  if (target >= anchor) {
    while (cursor < target) {
      cursor = addDays(cursor, 7);
      if (!isOffWeek(toISO(cursor))) index += 1;
    }
  } else {
    while (cursor > target) {
      if (!isOffWeek(toISO(cursor))) index -= 1;
      cursor = addDays(cursor, -7);
    }
  }

  dutyIndexCache.set(weekKey, index);
  return index;
}

/** Пара, дежурящая в эту неделю (по кругу). */
function pairForWeek(weekKey) {
  const list = sortedPairs();
  if (!list.length) return null;
  const n = dutyWeekIndex(weekKey);
  const idx = ((n % list.length) + list.length) % list.length;
  return list[idx];
}

function sortedPairs() {
  return [...state.pairs].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

/** Следующая/предыдущая дежурная неделя (каникулярные перескакиваем). */
function shiftWeek(weekKey, direction) {
  let key = toISO(addDays(parseISO(weekKey), direction * 7));
  let guard = 0;
  while (isOffWeek(key) && guard < 120) {
    key = toISO(addDays(parseISO(key), direction * 7));
    guard += 1;
  }
  return key;
}

/** Ближайшая дежурная неделя, начиная с указанной. */
function nextDutyWeek(weekKey) {
  return isOffWeek(weekKey) ? shiftWeek(weekKey, 1) : weekKey;
}

/** Живое имя человека по id (если человек удалён — null). */
function personNameById(id) {
  const p = state.people.find((x) => x.id === id);
  return p ? p.name : null;
}

/** Состав пары: [{ id, name }, ...] (в порядке слотов). */
function pairMembers(pair) {
  if (!pair) return [];
  const ids = pair.memberIds || [];
  const names = pair.memberNames || [];
  return [0, 1].map((i) => {
    const id = ids[i] || null;
    const live = id ? personNameById(id) : null;
    return { id, name: live || names[i] || '' };
  }).filter((m) => m.id || m.name);
}

function pairTitle(pair) {
  const names = pairMembers(pair).map((m) => m.name || 'Вакансия');
  return names.length ? names.join(' и ') : 'Вакансия';
}

/** Идентификатор документа дежурства. */
function dutyId(week, day, personId, role) {
  return `${week}__${day}__${personId}__${role}`;
}

function mainDuty(week, day, personId) {
  return state.duties.find((d) =>
    d.week === week && d.day === day && d.personId === personId && d.role === 'main');
}

function replacementsFor(week, day) {
  return state.duties.filter((d) =>
    d.week === week && d.day === day && d.role === 'replacement');
}

/** В этот день дежурства нет (праздник или выходной)? */
function isDayOff(week, day) {
  return state.duties.some((d) =>
    d.role === 'skip' && d.week === week && d.day === day);
}

/** Дежурные дни недели без нерабочих дней (праздников). */
function dutyDaysOfWeek(week) {
  return DUTY_DAY_LIST.filter((day) => !isDayOff(week, day));
}

/** Сколько человек из пары в этот день отмечены «не продежурил». */
function missedCount(week, day) {
  if (isDayOff(week, day)) return 0;   // дежурства нет — пропусков тоже нет
  return state.duties.filter((d) =>
    d.week === week && d.day === day && d.role === 'main' && d.status === 'missed').length;
}

/**
 * Сколько замен уже взято в работу: назначенные («ждёт отметки») и подтверждённые
 * («продежурил»). Замена, которая сама не пришла (✗), не считается — на её место
 * нужно искать другого.
 */
function activeReplacementsCount(week, day) {
  return replacementsFor(week, day).filter((r) => r.status !== 'missed').length;
}

/** Сколько замен ещё не хватает: пропустило N человек — назначено M. */
function missingReplacementsCount(week, day) {
  return Math.max(0, missedCount(week, day) - activeReplacementsCount(week, day));
}

/** Подпись про нехватку замен: «нужна замена» или «нужно замен: 2». */
function missingReplacementsText(week, day) {
  const n = missingReplacementsCount(week, day);
  return n > 1 ? `нужно замен: ${n}` : 'нужна замена';
}

/** Нужна ли в этот день ещё хотя бы одна замена. */
function needsReplacement(week, day) {
  return missingReplacementsCount(week, day) > 0;
}

/** Сколько дней отдежурил каждый человек (по всем неделям). */
function computeStats() {
  const map = new Map();
  for (const p of state.people) {
    map.set(p.id, { id: p.id, name: p.name, done: 0, missed: 0, known: true });
  }
  for (const d of state.duties) {
    // Пометки «в этот день дежурства нет» людей не касаются.
    if (!d.personId || d.role === 'skip') continue;
    let rec = map.get(d.personId);
    if (!rec) {
      rec = { id: d.personId, name: d.personName || '—', done: 0, missed: 0, known: false };
      map.set(d.personId, rec);
    }
    if (!rec.name || rec.name === '—') rec.name = d.personName || rec.name;
    if (d.status === 'done') rec.done += 1;
    else if (d.status === 'missed') rec.missed += 1;
  }
  return [...map.values()];
}

/** Рейтинг: от меньшего количества дней к большему. */
function ranking() {
  return computeStats().sort((a, b) =>
    a.done - b.done ||
    a.missed - b.missed ||
    String(a.name).localeCompare(String(b.name), 'ru'));
}

/** Подсказка: кого логичнее поставить на замену (у кого меньше всего дней). */
function suggestedReplacements(pair, day, limit = 5) {
  const week = state.week;
  const taken = new Set(replacementsFor(week, day).map((r) => r.personId));
  const inPair = new Set(pairMembers(pair).map((m) => m.id));
  return ranking()
    .filter((p) => p.known && !taken.has(p.id) && !inPair.has(p.id))
    .slice(0, limit);
}

/** Обновляет «people.days», чтобы счётчик дней лежал и в базе. */
async function syncPeopleCounters() {
  if (state.syncing || !state.user) return;
  const stats = computeStats();
  const byId = new Map(state.people.map((p) => [p.id, p]));
  const changed = stats.filter((s) => {
    const p = byId.get(s.id);
    return p && (Number(p.days) || 0) !== s.done;
  });
  if (!changed.length) return;
  state.syncing = true;
  try {
    const batch = writeBatch(db);
    for (const s of changed) batch.update(doc(db, 'people', s.id), { days: s.done });
    await batch.commit();
  } catch (err) {
    console.warn('Не удалось обновить счётчики дней:', err);
  } finally {
    state.syncing = false;
  }
}


/* ==========================================================================
   4. РАБОТА С FIREBASE (подключение, вход, слушатели данных)
   ========================================================================== */

function initFirebase() {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
}

/** Реальное время: подписка на collections. */
function startDataListeners() {
  stopDataListeners();

  state.unsubs.push(onSnapshot(collection(db, 'people'), (snap) => {
    state.people = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded.people = true;
    renderAll();
  }, showError));

  state.unsubs.push(onSnapshot(collection(db, 'pairs'), (snap) => {
    state.pairs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded.pairs = true;
    renderAll();
  }, showError));

  state.unsubs.push(onSnapshot(collection(db, 'duties'), (snap) => {
    state.duties = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded.duties = true;
    renderAll();
    // Держим счётчик people.days в базе в актуальном состоянии.
    syncPeopleCounters();
  }, showError));
}

function stopDataListeners() {
  state.unsubs.forEach((fn) => { try { fn(); } catch (e) { /* ничего */ } });
  state.unsubs = [];
}

/**
 * Первый запуск: если базы ещё нет — создаём 16 человек и 8 пар.
 * Делать это может только вошедший администратор.
 */
async function seedIfEmpty() {
  const metaRef = doc(db, 'meta', 'state');
  const metaSnap = await getDoc(metaRef);
  if (metaSnap.exists()) return false;

  const peopleSnap = await getDocs(collection(db, 'people'));
  const pairsSnap = await getDocs(collection(db, 'pairs'));
  if (!peopleSnap.empty || !pairsSnap.empty) {
    await setDoc(metaRef, { initialized: true, anchorDate: ANCHOR_MONDAY, note: 'метка создана автоматически' });
    return false;
  }

  const batch = writeBatch(db);
  const ids = new Map();

  for (const [name1, name2] of SEED_PAIRS) {
    for (const name of [name1, name2]) {
      if (ids.has(name)) continue;
      const ref = doc(collection(db, 'people'));
      ids.set(name, ref.id);
      batch.set(ref, { name, days: 0, createdAt: serverTimestamp() });
    }
  }

  SEED_PAIRS.forEach(([name1, name2], index) => {
    const ref = doc(collection(db, 'pairs'));
    batch.set(ref, {
      order: index,
      memberIds: [ids.get(name1), ids.get(name2)],
      memberNames: [name1, name2],
      createdAt: serverTimestamp()
    });
  });

  batch.set(metaRef, {
    initialized: true,
    anchorDate: ANCHOR_MONDAY,
    seededAt: serverTimestamp()
  });

  await batch.commit();
  toast('База создана: 16 человек и 8 пар');
  return true;
}


/* ==========================================================================
   5. ДЕЙСТВИЯ АДМИНИСТРАТОРА (запись в базу)
   ========================================================================== */

function requireAdmin() {
  if (!state.user) { toast('Нужно войти в админку', 'err'); return false; }
  return true;
}

function dutyPayload(week, day, person, role, status) {
  const pair = pairForWeek(week);
  return {
    week,
    day,
    personId: person.id,
    personName: person.name,
    role,
    status,
    pairId: pair ? pair.id : null,
    pairOrder: pair ? (Number(pair.order) || 0) : null,
    pairNames: pair ? pairMembers(pair).map((m) => m.name) : [],
    updatedAt: serverTimestamp(),
    updatedBy: state.user ? state.user.email : null
  };
}

/** Отметка «продежурил / не продежурил». Повторный клик по той же кнопке снимает отметку. */
async function markDuty(week, day, personId, status) {
  if (!requireAdmin() || state.busy) return;
  const person = state.people.find((p) => p.id === personId);
  if (!person) { toast('Человек не найден', 'err'); return; }

  const ref = doc(db, 'duties', dutyId(week, day, personId, 'main'));
  const existing = mainDuty(week, day, personId);

  state.busy = true;
  try {
    if (existing && existing.status === status) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, dutyPayload(week, day, person, 'main', status));
    }
  } catch (err) {
    showError(err);
  } finally {
    state.busy = false;
  }
}

/** Отметить сразу всю неделю одному человеку. */
async function fillWeek(week, personId, status) {
  if (!requireAdmin() || state.busy) return;
  const person = state.people.find((p) => p.id === personId);
  if (!person) return;

  const batch = writeBatch(db);
  for (const day of dutyDaysOfWeek(week)) {
    const ref = doc(db, 'duties', dutyId(week, day, personId, 'main'));
    batch.set(ref, dutyPayload(week, day, person, 'main', status));
  }
  state.busy = true;
  try {
    await batch.commit();
    toast(`Все дежурные дни отмечены: ${person.name}`);
  } catch (err) {
    showError(err);
  } finally {
    state.busy = false;
  }
}

/** Снять все отметки недели у человека. */
async function clearWeek(week, personId) {
  if (!requireAdmin() || state.busy) return;
  const person = state.people.find((p) => p.id === personId);
  const batch = writeBatch(db);
  for (const day of DUTY_DAY_LIST) {
    const existing = mainDuty(week, day, personId);
    if (existing) batch.delete(doc(db, 'duties', existing.id));
  }
  state.busy = true;
  try {
    await batch.commit();
    if (person) toast(`Отметки сняты: ${person.name}`);
  } catch (err) {
    showError(err);
  } finally {
    state.busy = false;
  }
}

/** Отметить день нерабочим (праздник, выходной) или вернуть дежурство обратно. */
async function toggleDayOff(week, day) {
  if (!requireAdmin() || state.busy) return;
  const ref = doc(db, 'duties', `${week}__${day}__skip`);
  const off = isDayOff(week, day);
  const date = dayShort(addDays(parseISO(week), day));

  // Ставим нерабочий день поверх уже поставленных отметок — предупреждаем.
  if (!off) {
    const marks = state.duties.filter((d) =>
      d.week === week && d.day === day && d.role !== 'skip');
    if (marks.length && !window.confirm(
      `${DAYS_SHORT[day]}, ${date}: в этот день уже есть отметки (${marks.length}).\n\n` +
      'Отметить день нерабочим и удалить их?')) return;
  }

  state.busy = true;
  try {
    if (off) {
      await deleteDoc(ref);
      toast(`${DAYS_SHORT[day]}, ${date}: дежурство снова есть`);
    } else {
      const batch = writeBatch(db);
      for (const d of state.duties) {
        if (d.week === week && d.day === day && d.role !== 'skip') {
          batch.delete(doc(db, 'duties', d.id));
        }
      }
      batch.set(ref, {
        week,
        day,
        role: 'skip',
        status: 'skip',
        personId: null,
        personName: '',
        updatedAt: serverTimestamp(),
        updatedBy: state.user ? state.user.email : null
      });
      await batch.commit();
      toast(`${DAYS_SHORT[day]}, ${date}: дежурства нет`);
    }
  } catch (err) {
    showError(err);
  } finally {
    state.busy = false;
  }
}

/** Назначить замену на конкретный день. */
async function assignReplacement(week, day, personId) {
  if (!requireAdmin()) return;
  const person = state.people.find((p) => p.id === personId);
  if (!person) { toast('Выберите человека из списка', 'err'); return; }

  // Себя заменить нельзя: человек своей же пары в этот день и так дежурит.
  const pair = pairForWeek(week);
  if (pairMembers(pair).some((m) => m.id === personId)) {
    toast(`${person.name} в этот день уже дежурит — заменить себя нельзя`, 'err');
    return;
  }

  try {
    await setDoc(doc(db, 'duties', dutyId(week, day, personId, 'replacement')),
      dutyPayload(week, day, person, 'replacement', 'pending'));
    toast(`Замена назначена: ${person.name} · ждёт отметки`);
  } catch (err) {
    showError(err);
  }
}

async function setReplacementStatus(duty, status) {
  if (!requireAdmin()) return;
  try {
    await updateDoc(doc(db, 'duties', duty.id), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: state.user ? state.user.email : null
    });
  } catch (err) {
    showError(err);
  }
}

async function removeReplacement(duty) {
  if (!requireAdmin()) return;
  try {
    await deleteDoc(doc(db, 'duties', duty.id));
  } catch (err) {
    showError(err);
  }
}

async function addPerson(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const ref = doc(collection(db, 'people'));
  await setDoc(ref, { name: clean, days: 0, createdAt: serverTimestamp() });
  return ref.id;
}

async function renamePerson(id, name) {
  if (!requireAdmin()) return;
  const clean = String(name || '').trim();
  if (!clean) return;
  try {
    await updateDoc(doc(db, 'people', id), { name: clean, updatedAt: serverTimestamp() });
  } catch (err) {
    showError(err);
  }
}

async function deletePerson(id) {
  if (!requireAdmin()) return;
  const person = state.people.find((p) => p.id === id);
  if (!person) return;

  // Если человек стоит в паре — предупреждаем, что пара останется без него.
  const inPairs = state.pairs.filter((p) => (p.memberIds || []).includes(id));
  const message = inPairs.length
    ? `Удалить «${person.name}»?\n\nЭтот человек сейчас в паре: ${inPairs.map(pairTitle).join('; ')}. ` +
      'Пара останется с пустым местом.\n\nИстория дежурств сохранится за этим человеком.'
    : `Удалить «${person.name}»?\n\nИстория дежурств сохранится за этим человеком.`;

  if (!window.confirm(message)) return;

  try {
    const batch = writeBatch(db);
    for (const p of inPairs) {
      const ids = (p.memberIds || []).slice();
      const names = (p.memberNames || []).slice();
      const i = ids.indexOf(id);
      if (i >= 0) { ids[i] = null; names[i] = ''; }
      batch.update(doc(db, 'pairs', p.id), { memberIds: ids, memberNames: names });
    }
    batch.delete(doc(db, 'people', id));
    await batch.commit();
    toast('Человек удалён');
  } catch (err) {
    showError(err);
  }
}

/** Сохранить состав пары. slots = [{id, name}, {id, name}] */
async function savePair(pairId, slots) {
  if (!requireAdmin()) return;
  const ids = slots.map((s) => (s && s.id) || null);
  const names = slots.map((s) => (s && s.name) || '');

  if (ids[0] && ids[1] && ids[0] === ids[1]) {
    toast('В паре два одинаковых человека — так нельзя', 'err');
    return;
  }

  try {
    await updateDoc(doc(db, 'pairs', pairId), {
      memberIds: ids,
      memberNames: names,
      updatedAt: serverTimestamp()
    });
    state.editingPair = null;
    toast('Пара сохранена. История прошлых дежурств не изменилась.');
    renderAll();
  } catch (err) {
    showError(err);
  }
}

/** Поменять пару местами в очереди (вверх/вниз). */
async function movePair(pairId, direction) {
  if (!requireAdmin()) return;
  const list = sortedPairs();
  const i = list.findIndex((p) => p.id === pairId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'pairs', list[i].id), { order: j });
    batch.update(doc(db, 'pairs', list[j].id), { order: i });
    await batch.commit();
    toast('Очередь обновлена');
  } catch (err) {
    showError(err);
  }
}


/* ==========================================================================
   6. ОТРИСОВКА (склейка HTML и вставка в страницу)
   ========================================================================== */

function allLoaded() {
  return state.loaded.people && state.loaded.pairs && state.loaded.duties;
}

function renderAll() {
  if (!IS_CONFIGURED) return;
  renderChrome();
  const ready = allLoaded();
  const tabs = document.getElementById('tabs');
  if (tabs) tabs.hidden = !ready;
  updateTabs();
  if (!ready) return;

  renderWeekSwitcher();
  renderCurrentCard();
  renderNextCard();
  renderSchedule();
  renderStats();
  renderHistory();
  renderManage();
  renderNotices();
}

/** Шапка, кнопки входа/выхода, видимость админских элементов. */
function renderChrome() {
  document.title = state.mode === 'admin' ? `${GROUP_TITLE} — админка` : GROUP_TITLE;

  const title = document.getElementById('app-title');
  if (title) title.textContent = GROUP_TITLE;

  const sub = document.getElementById('app-subtitle');
  if (sub) {
    sub.textContent = state.mode === 'admin'
      ? 'Режим администратора — можно отмечать дежурства'
      : 'Просмотр — кто дежурит и статистика';
  }

  const slot = document.getElementById('auth-slot');
  if (slot) {
    if (state.mode === 'admin' && state.user) {
      slot.innerHTML = `<span class="who">${esc(state.user.email || '')}</span>` +
        '<button type="button" class="btn ghost small" data-action="logout">Выйти</button>';
    } else {
      slot.innerHTML = '';
    }
  }

  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.hidden = state.mode !== 'admin';
  });
}

function updateTabs() {
  document.querySelectorAll('#tabs .tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  });
  ['week', 'stats', 'history', 'manage'].forEach((name) => {
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.hidden = name !== state.tab;
  });
}

function renderNotices() {
  const box = document.getElementById('notice');
  if (!box) return;
  const items = [];

  if (!IS_CONFIGURED) {
    items.push({
      type: 'warn',
      text: 'Сайт пока не подключён к Firebase. Откройте файл <b>firebase-config.js</b> ' +
        'и вставьте туда ваш конфиг (пошаговая инструкция — в файле README.md).'
    });
  } else if (state.mode === 'admin' && state.user && state.loaded.people && !state.people.length && !state.pairs.length) {
    items.push({ type: 'warn', text: 'База пуста, создаём начальные пары…' });
  } else if (state.loaded.people && !state.people.length && state.mode !== 'admin') {
    items.push({
      type: 'warn',
      text: 'База ещё пуста. Попросите администратора зайти в админку — начальные пары создадутся сами.'
    });
  }

  box.innerHTML = items.map((i) => `<div class="notice-item ${i.type}">${i.text}</div>`).join('');
  box.hidden = !items.length;
}

function renderWeekSwitcher() {
  const box = document.getElementById('week-switcher');
  if (!box) return;
  if (state.mode !== 'admin' || !state.user) { box.hidden = true; return; }

  const isNow = state.week === nextDutyWeek(weekKeyOf(new Date()));
  const total = sortedPairs().length || 8;
  const weekNo = ((dutyWeekIndex(state.week) % total) + total) % total + 1;

  box.hidden = false;
  box.innerHTML = `
    <div class="week-switcher">
      <button type="button" class="nav-btn" data-action="week-prev" title="Предыдущая дежурная неделя">‹</button>
      <div class="week-switcher-label">
        <strong>${esc(weekLabel(state.week))}</strong>
        <span>неделя №${weekNo} в очереди${isNow ? ' · сейчас идёт' : ''} · ${esc(roomsHint())}</span>
      </div>
      <button type="button" class="nav-btn" data-action="week-next" title="Следующая дежурная неделя">›</button>
      <button type="button" class="btn ghost small" data-action="week-today" ${isNow ? 'disabled' : ''}>
        К текущей неделе
      </button>
    </div>`;
}

function renderCurrentCard() {
  const box = document.getElementById('current-card');
  if (!box) return;
  box.hidden = false;

  const week = state.week;
  const nowWeek = weekKeyOf(new Date());
  const isNow = week === nextDutyWeek(nowWeek);

  // Сейчас каникулы: показываем, с какой недели дежурства возобновятся.
  if (isOffWeek(nowWeek)) {
    const resume = nextDutyWeek(nowWeek);
    const resumePair = pairForWeek(resume);
    box.innerHTML = `
      <div class="card-label">Каникулы</div>
      <div class="pair-title">Сейчас дежурств нет</div>
      <div class="week-range">${OFF_MONTHS.map((m) => MONTHS_FULL[m]).join(', ')} — каникулярные месяцы</div>
      <p class="muted" style="margin:10px 0 0">
        Дежурства возобновятся с недели ${esc(weekLabel(resume))}.${
          resumePair ? ` Дежурить будет пара: <b>${esc(pairTitle(resumePair))}</b>.` : ''}
      </p>`;
    return;
  }

  // Просматривают каникулярную неделю — дежурств ни у кого нет.
  if (isOffWeek(week)) {
    const resume = nextDutyWeek(week);
    const resumePair = pairForWeek(resume);
    box.innerHTML = `
      <div class="card-label">Каникулы</div>
      <div class="pair-title">В эти дни дежурств нет</div>
      <div class="week-range">${esc(weekLabel(week))}</div>
      <p class="muted" style="margin:10px 0 0">
        Дежурства возобновятся с недели ${esc(weekLabel(resume))}.${
          resumePair ? ` Дежурить будет пара: <b>${esc(pairTitle(resumePair))}</b>.` : ''}
      </p>`;
    return;
  }

  const pair = pairForWeek(week);

  if (!pair) {
    box.innerHTML = '<p class="muted">Пары пока не заданы. Зайдите в раздел «Люди и пары».</p>';
    return;
  }

  const members = pairMembers(pair);
  const stats = new Map(computeStats().map((s) => [s.id, s]));
  const weekDuties = state.duties.filter((d) => d.week === week);
  const dutyDays = dutyDaysOfWeek(week);

  const membersHtml = members.map((m) => {
    const done = weekDuties.filter((d) =>
      d.personId === m.id && d.role === 'main' && d.status === 'done').length;
    const missed = weekDuties.filter((d) =>
      d.personId === m.id && d.role === 'main' && d.status === 'missed').length;
    const repDone = weekDuties.filter((d) =>
      d.personId === m.id && d.role === 'replacement' && d.status === 'done').length;
    const total = stats.get(m.id);
    return `
      <div class="member">
        <span class="mname">${esc(m.name || 'Вакансия')}</span>
        <span class="mstats">на этой неделе: <b>${done}</b> из ${dutyDays.length}${
          missed ? ` · пропущено <b class="missed">${missed}</b>` : ''}${
          repDone ? ` · подменяет: <b>${repDone}</b> дн.` : ''}</span>
        <span class="mtotal">всего отдежурено: <b>${total ? total.done : 0}</b> ${plural(total ? total.done : 0, ['день', 'дня', 'дней'])}</span>
      </div>`;
  }).join('');

  const offNote = dutyDays.length < DUTY_DAY_LIST.length
    ? `<p class="muted small" style="margin:10px 0 0">Дежурных дней на этой неделе: ${
        dutyDays.length} из ${DUTY_DAY_LIST.length} — в остальные дни дежурств нет.</p>`
    : '';

  box.innerHTML = `
    <div class="card-label">${isNow ? 'Дежурят на этой неделе' : 'Дежурят на выбранной неделе'}</div>
    <div class="pair-title">${esc(pairTitle(pair))}</div>
    <div class="week-range">${esc(weekLabel(week))}${isNow ? ' · идёт сейчас' : ''}</div>
    <div class="members">${membersHtml}</div>
    ${offNote}`;
}

/** «Кто дежурит дальше»: несколько ближайших дежурных недель (каникулы пропускаем). */
function renderNextCard() {
  const box = document.getElementById('next-card');
  if (!box) return;

  const current = nextDutyWeek(weekKeyOf(new Date()));
  const weeks = [];
  let cursor = current;
  for (let i = 0; i < NEXT_WEEKS_COUNT; i += 1) {
    weeks.push(cursor);
    const next = shiftWeek(cursor, 1);
    if (next === cursor) break;
    cursor = next;
  }

  const rows = weeks.map((week) => {
    const pair = pairForWeek(week);
    const isNow = week === current;
    return `<li class="${isNow ? 'is-now' : ''}">
      <span class="next-week">${esc(weekLabel(week).replace(/\s+\d{4}$/, ''))}${
        isNow ? ' · сейчас' : ''}</span>
      <span class="next-pair">${
        pair ? esc(pairTitle(pair)) : '<span class="muted">пары не заданы</span>'}</span>
    </li>`;
  }).join('');

  box.innerHTML = `
    <div class="card-label">Кто дежурит дальше</div>
    <ul class="next-list">${rows}</ul>`;
  box.hidden = false;
}

function renderSchedule() {
  const panel = document.getElementById('panel-week');
  if (!panel) return;

  const week = state.week;
  const pair = pairForWeek(week);
  const isAdmin = state.mode === 'admin' && !!state.user;

  if (isOffWeek(week)) {
    const resume = nextDutyWeek(week);
    const resumePair = pairForWeek(resume);
    panel.innerHTML = `
      <div class="card">
        <h2>Каникулы</h2>
        <p class="muted">Неделя ${esc(weekLabel(week))} — каникулярная, дежурств нет.</p>
        <p class="muted">Дежурства продолжатся с недели ${esc(weekLabel(resume))}${
          resumePair ? `, дежурит пара <b>${esc(pairTitle(resumePair))}</b>` : ''}.</p>
      </div>`;
    return;
  }

  if (!pair) {
    panel.innerHTML = '<div class="card"><p class="muted">Пары пока не заданы.</p></div>';
    return;
  }

  const members = pairMembers(pair);
  const today = todayISO();
  const mon = parseISO(week);

  // Блок с подсказкой «кого ставить на замену» + быстрые действия (только админ).
  let suggestHtml = '';
  if (isAdmin) {
    const inPairIds = new Set(members.map((m) => m.id));
    const top = ranking().filter((p) => p.known && !inPairIds.has(p.id)).slice(0, 5);
    const quick = members.filter((m) => m.id).map((m) => `
      <button type="button" class="btn ghost small" data-action="fill-week"
        data-week="${week}" data-person="${m.id}" data-status="done">
        ✓ вся неделя: ${esc(m.name)}
      </button>
      <button type="button" class="btn ghost small" data-action="clear-week"
        data-week="${week}" data-person="${m.id}">
        снять отметки: ${esc(m.name)}
      </button>`).join('');
    suggestHtml = `
      <div class="suggest-box">
        <b>Кого ставить на замену?</b> Сайт предлагает тех, у кого меньше всего отдежуренных дней:
        ${top.map((p) => `${esc(p.name)} <b>(${p.done})</b>`).join(' · ') || '—'}
      </div>
      <div class="quick-actions">
        <span class="quick-label">Быстрые действия:</span>
        ${quick}
      </div>`;
  }

  // Заголовки
  // Колонку «Замена» показываем админу всегда, а остальным — если в этой неделе
  // что-то по заменам есть (иначе это была бы пустая колонка).
  const showRepColumn = isAdmin || DUTY_DAY_LIST.some((day) =>
    replacementsFor(week, day).length > 0 || needsReplacement(week, day));

  let head = '<tr><th class="col-day">День</th>';
  for (const m of members) head += `<th>${esc(m.name || 'Вакансия')}</th>`;
  if (showRepColumn) head += '<th>Замена</th>';
  head += '</tr>';

  // Строки по дежурным дням
  const rows = DUTY_DAY_LIST.map((day) => {
    const date = addDays(mon, day);
    const iso = toISO(date);
    const isToday = iso === today;
    const off = isDayOff(week, day);

    let cells = '';

    if (off) {
      // День нерабочий: дежурств нет ни у кого.
      for (const m of members) {
        cells += `<td data-label="${esc(m.name || 'Вакансия')}"><span class="muted small">—</span></td>`;
      }
      if (isAdmin || showRepColumn) {
        cells += '<td data-label="Замена"><span class="muted small">—</span></td>';
      }
    } else {
      for (const m of members) {
        const duty = m.id ? mainDuty(week, day, m.id) : null;
        const status = duty ? duty.status : null;

        if (!isAdmin) {
          let chip = '<span class="chip chip-none">— нет отметки</span>';
          if (status === 'done') chip = '<span class="chip chip-done">✓ продежурил</span>';
          else if (status === 'missed') chip = '<span class="chip chip-missed">✗ не продежурил</span>';
          cells += `<td data-label="${esc(m.name || 'Вакансия')}">${m.id ? chip : '<span class="chip chip-empty">вакансия</span>'}</td>`;
        } else if (!m.id) {
          cells += `<td data-label="Вакансия"><span class="chip chip-empty">вакансия</span></td>`;
        } else {
          cells += `<td data-label="${esc(m.name)}">
          <div class="marker">
            <button type="button" class="mbtn mbtn-done ${status === 'done' ? 'active' : ''}"
              data-action="mark" data-week="${week}" data-day="${day}" data-person="${m.id}"
              data-status="done" title="Продежурил">✓</button>
            <button type="button" class="mbtn mbtn-missed ${status === 'missed' ? 'active' : ''}"
              data-action="mark" data-week="${week}" data-day="${day}" data-person="${m.id}"
              data-status="missed" title="Не продежурил">✗</button>
          </div>
        </td>`;
        }
      }

      if (isAdmin) {
        cells += `<td data-label="Замена">${renderReplacementCell(week, day, pair)}</td>`;
      } else if (showRepColumn) {
        cells += `<td data-label="Замена">${replacementInfo(week, day)}</td>`;
      }
    }

    // Подпись дня: комната дежурства или пометка «дежурства нет».
    const caption = off
      ? '<span class="chip chip-off">дежурства нет</span>'
      : `<span class="room">каб. ${esc(roomForDay(day))}</span>`;

    // Кнопка для админа: отметить день нерабочим и вернуть обратно.
    const offBtn = isAdmin
      ? `<button type="button" class="linkbtn" data-action="day-off"
           data-week="${week}" data-day="${day}"
           title="${off ? 'Снова дежурим в этот день' : 'Праздник или выходной — в этот день дежурства нет'}">${
           off ? 'вернуть дежурство' : 'нет дежурства'}</button>`
      : '';

    return `<tr class="${[isToday ? 'is-today' : '', off ? 'is-off' : ''].filter(Boolean).join(' ')}">
      <th class="col-day">
        <span class="dow">${DAYS_SHORT[day]}</span><span class="dnum">${dayShort(date)}</span>
        ${caption}
        ${offBtn}
      </th>
      ${cells}
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="card">
      <h2>Расписание по дням</h2>
      ${suggestHtml}
      <div class="table-wrap">
        <table class="schedule"><thead>${head}</thead><tbody>${rows}</tbody></table>
      </div>
      <details class="rules">
        <summary>Как это работает</summary>
        <ul>
          <li>Одну неделю дежурит одна пара, потом следующая по очереди. После 8-й пары снова идёт 1-я.</li>
          <li>Дежурные дни: ${DUTY_DAY_LIST.map((d) => DAYS_FULL[d]).join(', ')}. Понедельник и воскресенье — выходные.</li>
          <li>Кабинеты: ${esc(roomsHint())}.</li>
          <li>Каникулы — ${OFF_MONTHS.map((m) => MONTHS_GEN[m]).join(', ')}: дежурств нет, эти недели в расписании не показываются.</li>
          <li>Учебный год начинается 1 сентября: с первой недели сентября очередь снова идёт с 1-й пары.</li>
          <li>По каждому человеку и дню админ отмечает: продежурил или нет.</li>
          <li>Если в какой-то день занятия отменяют (праздник, выходной), админ отмечает день как «дежурства нет» — в этот день никто не дежурит и отметок нет.</li>
          <li>Себя заменить нельзя: человек своей же пары в этот день и так дежурит.</li>
          <li>Если человек отмечен как «не продежурил», его недостающие дни не пропадают — они добираются позже: на такие дни ставят тех, у кого меньше всего отдежуренных дней. Замен нужно ровно столько, сколько человек пропустило этот день.</li>
          <li>Назначенная замена сначала «ждёт отметки»: после дежурства админ ставит ей ✓ или ✗. В статистику день идёт только после ✓.</li>
          <li>В рейтинге люди отсортированы от меньшего количества отдежуренных дней к большему.</li>
          <li>Если в паре поменяли человека, история прошлых дежурств остаётся за прежним человеком.</li>
        </ul>
      </details>
    </div>`;
}

/** Замена в этот день для всех (только просмотр, без кнопок). */
function replacementInfo(week, day) {
  const reps = replacementsFor(week, day);
  const need = needsReplacement(week, day);
  if (!reps.length && !need) return '<span class="muted small">—</span>';

  const chips = reps.map((r) => {
    const cls = r.status === 'done' ? 'chip-done'
      : (r.status === 'missed' ? 'chip-missed' : 'chip-none');
    const mark = r.status === 'done' ? '✓ продежурил'
      : (r.status === 'missed' ? '✗ не продежурил' : 'ждёт отметки');
    return `<span class="chip ${cls}">${esc(r.personName || '—')} · ${mark}</span>`;
  }).join('');

  const needChip = need
    ? `<span class="chip chip-missed">${missingReplacementsText(week, day)}</span>` : '';

  return `<div class="reps">${chips}${needChip}</div>`;
}

function renderReplacementCell(week, day, pair) {
  const reps = replacementsFor(week, day);
  const need = needsReplacement(week, day);
  let html = '<div class="reps">';

  for (const r of reps) {
    const pending = r.status !== 'done' && r.status !== 'missed';
    html += `<span class="rep-chip">
      <span class="rep-name">${esc(r.personName || '—')}</span>
      ${pending ? '<span class="rep-wait">ждёт отметки</span>' : ''}
      <button type="button" class="mbtn mbtn-done ${r.status === 'done' ? 'active' : ''}"
        data-action="rep-status" data-id="${r.id}" data-status="done" title="Продежурил">✓</button>
      <button type="button" class="mbtn mbtn-missed ${r.status === 'missed' ? 'active' : ''}"
        data-action="rep-status" data-id="${r.id}" data-status="missed" title="Не продежурил">✗</button>
      <button type="button" class="xbtn" data-action="rep-remove" data-id="${r.id}" title="Убрать замену">×</button>
    </span>`;
  }

  if (need) {
    const suggestions = suggestedReplacements(pair, day, 5);
    const suggestedIds = new Set(suggestions.map((s) => s.id));
    const takenIds = new Set(reps.map((r) => r.personId));
    // Пару этой недели в списке не показываем: себя заменить нельзя.
    const pairIds = new Set(pairMembers(pair).map((m) => m.id));
    const rest = ranking().filter((p) =>
      p.known && !suggestedIds.has(p.id) && !takenIds.has(p.id) && !pairIds.has(p.id));

    let options = '<option value="">— выбрать человека —</option>';
    if (suggestions.length) {
      options += '<optgroup label="Меньше всего дежурств (рекомендуем)">';
      options += suggestions.map((s) =>
        `<option value="${s.id}">${esc(s.name)} — ${s.done} дн.</option>`).join('');
      options += '</optgroup>';
    }
    if (rest.length) {
      options += '<optgroup label="Остальные">';
      options += rest.map((s) =>
        `<option value="${s.id}">${esc(s.name)} — ${s.done} дн.</option>`).join('');
      options += '</optgroup>';
    }

    const label = missingReplacementsText(week, day);
    html += `
      <form class="rep-form" data-action="rep-add-form" data-week="${week}" data-day="${day}">
        <select name="person" aria-label="Кому поставить замену (${label})">${options}</select>
        <button type="submit" class="btn small">Назначить</button>
      </form>`;
  }

  html += '</div>';
  return html;
}

function renderStats() {
  const panel = document.getElementById('panel-stats');
  if (!panel) return;

  const list = ranking();
  const max = Math.max(1, ...list.map((p) => p.done));
  const minDone = list.length ? Math.min(...list.filter((p) => p.known).map((p) => p.done)) : 0;
  const totalDone = list.reduce((sum, p) => sum + p.done, 0);

  const rows = list.map((p, i) => {
    const isMin = p.known && p.done === minDone;
    return `<tr class="${isMin ? 'min-row' : ''}">
      <td class="pos">${i + 1}</td>
      <td>${esc(p.name)}${p.known ? '' : ' <span class="muted small">(нет в списке)</span>'}
        ${isMin ? ' <span class="chip chip-done">кандидат на замену</span>' : ''}</td>
      <td class="num hide-sm">
        <span class="bar-wrap"><span class="bar" style="width:${Math.round((p.done / max) * 100)}%"></span></span>
      </td>
      <td class="num"><b>${p.done}</b></td>
      <td class="num hide-sm">${p.missed}</td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="card">
      <h2>Статистика: кто сколько отдежурил</h2>
      <p class="muted small">Отсортировано от меньшего количества дней к большему.
        «Пропущено» — дни, отмеченные как «не продежурил»: они не пропадают и добираются позже.</p>
      <div class="table-wrap">
        <table class="rank-table">
          <thead>
            <tr>
              <th class="pos">№</th>
              <th>ФИО</th>
              <th class="hide-sm"></th>
              <th class="num">Отдежурено</th>
              <th class="num hide-sm">Пропущено</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted">Пока нет данных.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="muted small" style="margin-top:12px">Всего отметок «продежурил»: <b>${totalDone}</b>.</p>
    </div>`;
}

/** Дежурные недели: с первой недели с данными (или с текущей) по текущую. */
function listWeeks() {
  const current = nextDutyWeek(weekKeyOf(new Date()));
  const set = new Set(state.duties.map((d) => d.week).filter((w) => !isOffWeek(w)));
  set.add(current);

  const sorted = [...set].sort();
  const first = sorted[0] || current;
  const out = [];
  let cursor = parseISO(first);
  const end = parseISO(current);
  let guard = 0;
  while (cursor <= end && guard < 400) {
    const key = toISO(cursor);
    if (!isOffWeek(key)) out.push(key);
    cursor = addDays(cursor, 7);
    guard += 1;
  }
  if (!out.length) out.push(current);
  return out.sort().reverse().slice(0, 80);
}

function renderHistory() {
  const panel = document.getElementById('panel-history');
  if (!panel) return;

  const current = nextDutyWeek(weekKeyOf(new Date()));
  const weeks = listWeeks();

  const cards = weeks.map((week) => {
    const duties = state.duties.filter((d) => d.week === week);
    const mains = duties.filter((d) => d.role === 'main');
    const reps = duties.filter((d) => d.role === 'replacement');

    const pair = pairForWeek(week);
    const recordedNames = [...new Set(mains.map((d) => d.personName).filter(Boolean))];
    const names = recordedNames.length ? recordedNames
      : (pair ? pairMembers(pair).map((m) => m.name) : []);

    const perPerson = new Map();
    for (const d of [...mains, ...reps]) {
      const key = d.personId || d.personName;
      if (!perPerson.has(key)) {
        perPerson.set(key, { name: d.personName || '—', done: 0, missed: 0, pending: 0, isRep: d.role === 'replacement' });
      }
      const rec = perPerson.get(key);
      if (d.status === 'done') rec.done += 1;
      else if (d.status === 'missed') rec.missed += 1;
      else rec.pending += 1;
    }

    const uncovered = DUTY_DAY_LIST.filter((day) => needsReplacement(week, day)).length;
    const isNow = week === current;

    const items = [...perPerson.values()].map((p) => `
      <li>
        <span class="hname">${esc(p.name)}${p.isRep ? '<span class="rep-tag">замена</span>' : ''}</span>
        <span class="hval">отдежурено: <b>${p.done}</b>${
          p.missed ? ` · пропущено: <b class="missed">${p.missed}</b>` : ''}${
          p.pending ? ` · ждёт отметки: <b>${p.pending}</b>` : ''}</span>
      </li>`).join('');

    return `
      <div class="card week-card ${isNow ? 'now' : ''}">
        <div class="week-card-head">
          <div>
            <div class="week-range">${esc(weekLabel(week))}${isNow ? ' · сейчас' : ''}</div>
            <div class="pair-title small">${esc(names.join(' и ') || 'нет данных')}</div>
          </div>
        </div>
        ${items ? `<ul class="hist-list">${items}</ul>`
          : '<p class="muted small" style="margin:10px 0 0">Отметок за эту неделю нет.</p>'}
        ${uncovered ? `<div class="warn-line">Дней без замены: ${uncovered}</div>` : ''}
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="card">
      <h2>История прошлых недель</h2>
      <p class="muted small">Сначала самые свежие. История не меняется, даже если состав пары потом поменяли.</p>
    </div>
    ${cards}`;
}

function renderManage() {
  const panel = document.getElementById('panel-manage');
  if (!panel) return;
  if (state.mode !== 'admin' || !state.user) { panel.innerHTML = ''; return; }

  /* --- пары --- */
  const pairs = sortedPairs();
  const pairsHtml = pairs.map((pair, index) => {
    const editing = state.editingPair === pair.id;
    const members = pairMembers(pair);
    return `
      <div class="pair-card">
        <div class="pair-head">
          <span class="pair-order">${index + 1}</span>
          <span class="pair-names">${esc(pairTitle(pair))}</span>
          <button type="button" class="icon-btn" data-action="pair-up" data-pair="${pair.id}"
            title="Выше в очереди" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-action="pair-down" data-pair="${pair.id}"
            title="Ниже в очереди" ${index === pairs.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn ghost small" data-action="pair-edit" data-pair="${pair.id}">
            ${editing ? 'Свернуть' : 'Редактировать'}
          </button>
        </div>
        ${editing ? renderPairEditor(pair, members) : ''}
      </div>`;
  }).join('');

  /* --- люди --- */
  const people = [...state.people].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'ru'));
  const statsById = new Map(computeStats().map((s) => [s.id, s]));

  const peopleHtml = people.map((p) => {
    const st = statsById.get(p.id) || { done: 0, missed: 0 };
    const inPair = sortedPairs().findIndex((pair) => (pair.memberIds || []).includes(p.id));
    return `
      <li class="person-row">
        <span class="pname">${esc(p.name)}${
          inPair >= 0 ? ` <span class="muted small">· пара №${inPair + 1}</span>` : ''}</span>
        <span class="pdays">отдежурено: <b>${st.done}</b>${st.missed ? ` · пропущено: <b>${st.missed}</b>` : ''}</span>
        <button type="button" class="icon-btn" data-action="person-rename" data-person="${p.id}">Переименовать</button>
        <button type="button" class="icon-btn" data-action="person-delete" data-person="${p.id}">Удалить</button>
      </li>`;
  }).join('');

  panel.innerHTML = `
    <div class="card">
      <h2>Пары и очередь</h2>
      <p class="muted small">Порядок сверху вниз = порядок дежурств. Стрелками можно подвинуть пару в очереди.</p>
      ${pairsHtml || '<p class="muted">Пары ещё не созданы.</p>'}
    </div>
    <div class="card">
      <h2>Люди (${people.length})</h2>
      <ul class="person-list">${peopleHtml || '<li class="muted">Список пуст.</li>'}</ul>
      <form class="inline-form" data-action="person-add-form">
        <label>Добавить человека
          <input type="text" name="name" placeholder="Фамилия Имя" required>
        </label>
        <button type="submit" class="btn">Добавить</button>
      </form>
    </div>`;
}

function renderPairEditor(pair, members) {
  const optionsFor = (selectedId) => {
    let html = '<option value="">— вакансия (пусто) —</option>';
    for (const p of [...state.people].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'))) {
      html += `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`;
    }
    html += '<option value="__new__">+ Добавить нового человека…</option>';
    return html;
  };

  return `
    <form class="pair-form" data-action="pair-save-form" data-pair="${pair.id}">
      <label>Первый человек в паре
        <select name="m0">${optionsFor(members[0] ? members[0].id : null)}</select>
      </label>
      <label>Второй человек в паре
        <select name="m1">${optionsFor(members[1] ? members[1].id : null)}</select>
      </label>
      <p class="hint">Если нужного человека нет в списке — выберите «+ Добавить нового человека…»
        и впишите ФИО. История прошлых дежурств остаётся за прежним человеком.</p>
      <div class="row">
        <button type="submit" class="btn">Сохранить</button>
        <button type="button" class="btn ghost" data-action="pair-cancel">Отмена</button>
      </div>
    </form>`;
}

function renderGate(errorText) {
  const gate = document.getElementById('gate');
  if (!gate) return;
  gate.hidden = false;
  gate.innerHTML = `
    <h2>Вход для администратора</h2>
    <p class="muted small">Доступ только по email и паролю, созданным в Firebase Authentication.
      Без входа админка ничего не показывает и не даёт менять данные.</p>
    <form data-action="login-form">
      <label>Email
        <input type="email" name="email" autocomplete="username" required>
      </label>
      <label>Пароль
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <button type="submit" class="btn" style="width:100%">Войти</button>
      <p class="err">${esc(errorText || '')}</p>
    </form>`;
}


/* ==========================================================================
   7. РЕАКЦИЯ НА КЛИКИ И ФОРМЫ
   ========================================================================== */

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case 'tab': {
      state.tab = el.dataset.tab;
      updateTabs();
      renderAll();
      break;
    }

    case 'logout': {
      try { await signOut(auth); toast('Вы вышли из админки'); } catch (err) { showError(err); }
      break;
    }

    case 'week-prev':
    case 'week-next': {
      const dir = action === 'week-prev' ? -1 : 1;
      state.week = shiftWeek(state.week, dir);
      renderAll();
      break;
    }

    case 'week-today': {
      state.week = nextDutyWeek(weekKeyOf(new Date()));
      renderAll();
      break;
    }

    case 'day-off': {
      await toggleDayOff(el.dataset.week, Number(el.dataset.day));
      break;
    }

    case 'mark': {
      await markDuty(el.dataset.week, Number(el.dataset.day), el.dataset.person, el.dataset.status);
      break;
    }

    case 'fill-week': {
      await fillWeek(el.dataset.week, el.dataset.person, el.dataset.status);
      break;
    }

    case 'clear-week': {
      await clearWeek(el.dataset.week, el.dataset.person);
      break;
    }

    case 'rep-status': {
      const duty = state.duties.find((d) => d.id === el.dataset.id);
      if (duty) await setReplacementStatus(duty, el.dataset.status);
      break;
    }

    case 'rep-remove': {
      const duty = state.duties.find((d) => d.id === el.dataset.id);
      if (duty) await removeReplacement(duty);
      break;
    }

    case 'pair-edit': {
      state.editingPair = state.editingPair === el.dataset.pair ? null : el.dataset.pair;
      renderAll();
      break;
    }

    case 'pair-cancel': {
      state.editingPair = null;
      renderAll();
      break;
    }

    case 'pair-up': {
      await movePair(el.dataset.pair, -1);
      break;
    }

    case 'pair-down': {
      await movePair(el.dataset.pair, 1);
      break;
    }

    case 'person-rename': {
      const person = state.people.find((p) => p.id === el.dataset.person);
      if (!person) break;
      const next = window.prompt('Новое ФИО:', person.name);
      if (next != null && next.trim() && next.trim() !== person.name) {
        await renamePerson(person.id, next.trim());
        toast('ФИО обновлено');
      }
      break;
    }

    case 'person-delete': {
      await deletePerson(el.dataset.person);
      break;
    }

    default:
      break;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-action]');
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;

  if (action === 'login-form') {
    const email = String(form.elements.namedItem('email').value).trim();
    const password = String(form.elements.namedItem('password').value);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast('Добро пожаловать!');
    } catch (err) {
      const map = {
        'auth/invalid-email': 'Некорректный email.',
        'auth/user-not-found': 'Такого пользователя нет. Проверьте, что аккаунт создан в Firebase Authentication.',
        'auth/wrong-password': 'Неверный пароль.',
        'auth/invalid-credential': 'Неверный email или пароль.',
        'auth/too-many-requests': 'Слишком много попыток входа. Попробуйте позже.'
      };
      renderGate(map[err.code] || ('Ошибка входа: ' + err.message));
    }
    return;
  }

  if (action === 'rep-add-form') {
    const personId = String(form.elements.namedItem('person').value);
    if (!personId) { toast('Выберите человека из списка', 'err'); return; }
    await assignReplacement(form.dataset.week, Number(form.dataset.day), personId);
    return;
  }

  if (action === 'person-add-form') {
    const name = String(form.elements.namedItem('name').value).trim();
    if (!name) return;
    try {
      if (!requireAdmin()) return;
      await addPerson(name);
      toast(`Добавлен человек: ${name}`);
    } catch (err) { showError(err); }
    return;
  }

  if (action === 'pair-save-form') {
    if (!requireAdmin()) return;
    try {
      const slots = [];
      for (const key of ['m0', 'm1']) {
        const raw = String(form.elements.namedItem(key).value);
        if (!raw) { slots.push({ id: null, name: '' }); continue; }
        if (raw === '__new__') {
          const typed = window.prompt('Введите ФИО нового человека:');
          if (!typed || !typed.trim()) { slots.push({ id: null, name: '' }); continue; }
          const name = typed.trim();
          const newId = await addPerson(name);
          slots.push({ id: newId, name });
        } else {
          const person = state.people.find((p) => p.id === raw);
          slots.push({ id: raw, name: person ? person.name : '' });
        }
      }
      await savePair(form.dataset.pair, slots);
    } catch (err) {
      showError(err);
    }
    return;
  }
});


/* ==========================================================================
   8. ЗАПУСК САЙТА
   ========================================================================== */

function showGateScreen() {
  const gate = document.getElementById('gate');
  const content = document.getElementById('content');
  const loading = document.getElementById('loading');
  const card = document.getElementById('current-card');
  const notice = document.getElementById('notice');

  if (content) content.hidden = true;
  if (loading) loading.hidden = true;
  if (card) card.hidden = true;
  if (notice) notice.hidden = true;
  if (gate) gate.hidden = false;
}

function showAdminScreen() {
  const gate = document.getElementById('gate');
  const content = document.getElementById('content');
  const loading = document.getElementById('loading');
  if (gate) gate.hidden = true;
  if (loading) loading.hidden = true;
  if (content) content.hidden = false;
}

/* ==========================================================================
   Цвет и фон: выбор темы (зелёная, розовая, оранжевая, снежная).
   Тема меняет акцент всего сайта и вид фона. Выбор хранится в браузере
   (localStorage) и применяется сразу, без перезагрузки страницы.
   ========================================================================== */

const THEME_KEY = 'duty-theme';

const THEMES = {
  green:  { label: 'Зелёный',   hint: 'точки',     swatch: '#3fae74', bg: 'dots' },
  pink:   { label: 'Розовый',   hint: 'ромбы',     swatch: '#e0568f', bg: 'ornament' },
  orange: { label: 'Оранжевый', hint: 'соты',      swatch: '#e58f34', bg: 'comb' },
  snow:   { label: 'Снежный',   hint: 'снежинки',  swatch: '#54a2e0', bg: 'snow' }
};

const THEME_ORDER = ['green', 'pink', 'orange', 'snow'];

const themeListeners = [];
let activeTheme = 'green';

/** Подписаться на смену темы (фон и счётчик перерисовываются сами). */
function onThemeChange(fn) {
  themeListeners.push(fn);
}

function savedTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved && THEMES[saved]) return saved;
  } catch (err) {
    // приватный режим браузера — просто используем тему по умолчанию
  }
  return 'green';
}

/** Режим фона для текущей темы: dots | ornament | comb | snow. */
function bgMode() {
  return (THEMES[activeTheme] || THEMES.green).bg;
}

function applyTheme(name) {
  const next = THEMES[name] ? name : 'green';
  activeTheme = next;
  document.documentElement.dataset.theme = next;
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch (err) {
    // запомнить не получилось — не страшно, тема просто не сохранится
  }
  themeListeners.forEach((fn) => {
    try { fn(next); } catch (err) { console.error(err); }
  });
}

/** Кнопка «Цвет» в шапке и список тем. */
function renderThemePicker() {
  const mount = document.getElementById('theme-mount');
  if (!mount || mount.querySelector('.theme-picker')) return;

  const wrap = document.createElement('div');
  wrap.className = 'theme-picker';
  wrap.innerHTML =
    '<button type="button" class="theme-btn" id="theme-btn" aria-haspopup="true" aria-expanded="false">' +
      '<span class="theme-btn-dot"></span><span>Цвет</span>' +
    '</button>' +
    '<div class="theme-menu" id="theme-menu" role="menu" hidden>' +
      '<p class="theme-menu-title">Цвет и фон</p>' +
      THEME_ORDER.map((key) => (
        '<button type="button" class="theme-item" role="menuitemradio" data-theme="' + key + '" aria-checked="false">' +
          '<span class="theme-swatch" style="background:' + THEMES[key].swatch + '"></span>' +
          '<span class="theme-name">' + THEMES[key].label + '</span>' +
          '<span class="theme-hint">' + THEMES[key].hint + '</span>' +
        '</button>'
      )).join('') +
    '</div>';
  mount.appendChild(wrap);

  const btn = wrap.querySelector('#theme-btn');
  const menu = wrap.querySelector('#theme-menu');

  function closeMenu() {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-theme]');
    if (!item) return;
    applyTheme(item.dataset.theme);
    closeMenu();
  });

  document.addEventListener('click', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { closeMenu(); btn.focus(); }
  });

  const mark = () => {
    wrap.querySelectorAll('.theme-item').forEach((item) => {
      const on = item.dataset.theme === activeTheme;
      item.classList.toggle('is-active', on);
      item.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    wrap.querySelector('.theme-btn-dot').style.background = THEMES[activeTheme].swatch;
    btn.title = 'Цвет и фон: ' + THEMES[activeTheme].label;
  };

  mark();
  onThemeChange(mark);
}

/* ==========================================================================
   Интерактивный фон. Узор зависит от темы:
   • зелёная — точки, • розовая — ромбы, • оранжевая — соты, • снежная — снежинки.
   Плюс мягкое свечение под курсором, рост узора рядом с ним и волна от клика.
   • На компьютере свечение ходит за мышкой.
   • На телефоне (курсора нет) оно медленно плавает само.
   • Если в системе включено «уменьшить движение» — фон не включается.
   ========================================================================== */

const BG_STEP = 46;       // шаг узора, px
const BG_NEAR = 155;      // на каком расстоянии курсор подсвечивает узор
const BG_GLOW_R = 320;    // радиус свечения, px
const BG_FLAKE_AREA = 16000; // одна снежинка примерно на столько пикселей площади

/** "#2f8f5b" -> { r, g, b } */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 47, g: 143, b: 91 };
}

/** Контур фигуры узора в точке (x, y) с «радиусом» s. */
function bgShape(ctx, mode, x, y, s) {
  ctx.beginPath();
  if (mode === 'comb') {
    // шестиугольник — «соты»
    for (let i = 0; i < 6; i += 1) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = x + Math.cos(a) * s;
      const py = y + Math.sin(a) * s;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (mode === 'ornament') {
    // ромб — «узор»
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
  } else {
    ctx.arc(x, y, s, 0, Math.PI * 2);
  }
}

/** Снежинка: три луча с веточками. */
function bgFlake(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 3; i += 1) {
    const a = (i * Math.PI) / 3;
    const dx = Math.cos(a);
    const dy = Math.sin(a);

    ctx.moveTo(x - dx * r, y - dy * r);
    ctx.lineTo(x + dx * r, y + dy * r);

    // по две веточки на каждом луче
    const bx = x + dx * r * 0.6;
    const by = y + dy * r * 0.6;
    const px = -dy * r * 0.32 - dx * r * 0.14;
    const py = dx * r * 0.32 - dy * r * 0.14;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + px, by + py);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - px, by - py);
  }
  ctx.stroke();
}

function initBackground() {
  if (!document.body) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.getElementById('bg-canvas')) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'bg-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  let theme = null;
  let mode = 'dots';
  let W = 0, H = 0, dpr = 1;
  let pattern = null;
  let points = [];
  let flakes = [];
  let rafId = 0;
  let lastDraw = 0;
  let drift = 0;
  const ripples = [];
  const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, real: false };

  function readTheme() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    return { rgb: hexToRgb(accent), dark: mq.matches };
  }

  function rgba(a) {
    return `rgba(${theme.rgb.r},${theme.rgb.g},${theme.rgb.b},${a})`;
  }

  /** Размер холста, узор фона и снежинки. Узор рисуем один раз в запасной холст. */
  function build() {
    theme = readTheme();
    mode = bgMode();

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    points = [];
    for (let y = BG_STEP / 2; y < H; y += BG_STEP) {
      for (let x = BG_STEP / 2; x < W; x += BG_STEP) points.push([x, y]);
    }

    pattern = document.createElement('canvas');
    pattern.width = canvas.width;
    pattern.height = canvas.height;

    if (mode !== 'snow') {
      const pctx = pattern.getContext('2d');
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const base = rgba(theme.dark ? 0.22 : 0.17);
      pctx.fillStyle = base;
      pctx.strokeStyle = base;
      pctx.lineWidth = 1.2;

      for (const [x, y] of points) {
        bgShape(pctx, mode, x, y, mode === 'dots' ? 1.5 : 5.5);
        if (mode === 'dots') {
          pctx.fill();
        } else {
          pctx.stroke();
          if (mode === 'ornament') {           // в центре ромба — точка
            pctx.beginPath();
            pctx.arc(x, y, 1.1, 0, Math.PI * 2);
            pctx.fill();
          }
        }
      }
    }

    flakes = [];
    if (mode === 'snow') {
      const count = Math.max(24, Math.round((W * H) / BG_FLAKE_AREA));
      for (let i = 0; i < count; i += 1) {
        flakes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 2.5 + Math.random() * 5,
          vy: 0.3 + Math.random() * 0.9,
          vx: (Math.random() - 0.5) * 0.3,
          ph: Math.random() * Math.PI * 2
        });
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (pattern) ctx.drawImage(pattern, 0, 0, W, H);

    const hasPointer = pointer.x > -9000;

    if (hasPointer) {
      // свечение вокруг курсора (только нужный квадрат, а не весь экран)
      const g = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, BG_GLOW_R);
      const a = theme.dark ? 0.10 : 0.13;
      g.addColorStop(0, rgba(a));
      g.addColorStop(0.6, rgba(a * 0.32));
      g.addColorStop(1, rgba(0));
      ctx.fillStyle = g;
      ctx.fillRect(pointer.x - BG_GLOW_R, pointer.y - BG_GLOW_R, BG_GLOW_R * 2, BG_GLOW_R * 2);
    }

    if (mode === 'snow') {
      // снежинки падают сами, рядом с курсором светятся сильнее
      ctx.strokeStyle = rgba(1);
      ctx.lineWidth = 1.2;
      for (const f of flakes) {
        let k = 0;
        if (hasPointer) {
          const d = Math.hypot(f.x - pointer.x, f.y - pointer.y);
          if (d < BG_NEAR * 1.6) k = 1 - d / (BG_NEAR * 1.6);
        }
        ctx.globalAlpha = (theme.dark ? 0.5 : 0.62) * (0.45 + 0.55 * k);
        bgFlake(ctx, f.x, f.y, f.r);
      }
      ctx.globalAlpha = 1;
    } else if (hasPointer) {
      // узор рядом с курсором — крупнее и ярче
      ctx.strokeStyle = rgba(1);
      ctx.fillStyle = rgba(1);
      for (const [x, y] of points) {
        const d = Math.hypot(x - pointer.x, y - pointer.y);
        if (d >= BG_NEAR) continue;
        const k = 1 - d / BG_NEAR;

        if (mode === 'dots') {
          ctx.globalAlpha = k * k * (theme.dark ? 0.55 : 0.45);
          bgShape(ctx, 'dots', x, y, 1.5 + 2 * k);
          ctx.fill();
        } else {
          ctx.globalAlpha = k * (theme.dark ? 0.6 : 0.5);
          ctx.lineWidth = 1.2 + 0.9 * k;
          bgShape(ctx, mode, x, y, 5.5 * (1 + 0.5 * k));
          ctx.stroke();
          if (mode === 'ornament') {
            ctx.beginPath();
            ctx.arc(x, y, 1.1 + 1.1 * k, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // волны от кликов
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const rp = ripples[i];
      rp.r += 4.2;
      rp.a -= 0.013;
      if (rp.a <= 0) { ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(rp.a);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  function tick(now) {
    rafId = 0;
    if (now && now - lastDraw < 30) { rafId = requestAnimationFrame(tick); return; }
    const dt = lastDraw ? Math.min(3, (now - lastDraw) / 33) : 1;
    lastDraw = now || 0;

    if (pointer.real) {
      pointer.x += (pointer.tx - pointer.x) * 0.15;
      pointer.y += (pointer.ty - pointer.y) * 0.15;
    } else {
      drift += 0.005;
      pointer.x = W * (0.5 + 0.33 * Math.sin(drift));
      pointer.y = H * (0.45 + 0.27 * Math.cos(drift * 0.83));
    }

    if (mode === 'snow') {
      for (const f of flakes) {
        f.ph += 0.012 * dt;
        f.y += f.vy * dt;
        f.x += (f.vx + Math.sin(f.ph) * 0.35) * dt;
        if (f.y > H + 8) { f.y = -8; f.x = Math.random() * W; }
        if (f.x < -8) f.x = W + 8;
        else if (f.x > W + 8) f.x = -8;
      }
    }

    draw();

    const settled = pointer.real &&
      Math.abs(pointer.tx - pointer.x) < 0.7 && Math.abs(pointer.ty - pointer.y) < 0.7;
    if (!settled || ripples.length || mode === 'snow') rafId = requestAnimationFrame(tick);
  }

  function wake() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  window.addEventListener('pointermove', (e) => {
    pointer.tx = e.clientX;
    pointer.ty = e.clientY;
    if (!pointer.real) { pointer.x = pointer.tx; pointer.y = pointer.ty; pointer.real = true; }
    wake();
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    pointer.real = true;
    pointer.tx = e.clientX;
    pointer.ty = e.clientY;
    if (pointer.x < -9000) { pointer.x = e.clientX; pointer.y = e.clientY; }
    ripples.push({ x: e.clientX, y: e.clientY, r: 4, a: theme.dark ? 0.5 : 0.4 });
    wake();
  }, { passive: true });

  document.addEventListener('mouseleave', () => { pointer.real = false; wake(); });
  window.addEventListener('resize', () => { build(); wake(); });
  if (mq.addEventListener) {
    mq.addEventListener('change', () => { build(); wake(); }); // переключили день/ночь
  }
  onThemeChange(() => { build(); lastDraw = 0; wake(); });      // выбрали другую тему

  build();
  wake();
}

/* ---------------------- счётчик «до лета» в шапке -------------------------- */

const SUMMER_JOKES = [
  'Потерпи 😌',
  'Совсем скоро',
  'Уже недолго',
  'Тряпка тоже ждёт лета',
  'Держись, дежурный'
];

function daysBetween(later, earlier) {
  return Math.max(0, Math.round((later - earlier) / 86400000));
}

/** Цвет акцента темы как {r, g, b} — чтобы плашка была в цвет сайта. */
function accentRgb() {
  return hexToRgb(getComputedStyle(document.documentElement).getPropertyValue('--accent'));
}

/**
 * С какого месяца считается «лето» для плашки в шапке: 0 — январь, …, 5 — июнь.
 * Это только счётчик. Каникулы, когда нет дежурств, задаются отдельно —
 * OFF_MONTHS в firebase-config.js (июль и август), этот месяц их не меняет.
 */
const SUMMER_START_MONTH = 5;

/**
 * Сколько осталось до лета (до 1 июня) на конкретную дату. С июня по август
 * лето уже идёт — тогда считаем до 1 сентября.
 * progress — какая часть учебного года (с 1 сентября) уже прошла: 0…1.
 */
function summerCountdownAt(when) {
  const now = new Date(when.getFullYear(), when.getMonth(), when.getDate());

  const year = now.getFullYear();
  const lastOff = OFF_MONTHS[OFF_MONTHS.length - 1];
  const summerStart = new Date(year, SUMMER_START_MONTH, 1);   // 1 июня
  const summerEnd = new Date(year, lastOff + 1, 1);            // 1 сентября

  if (now >= summerStart && now < summerEnd) {
    return { summer: true, days: daysBetween(summerEnd, now), target: summerEnd, progress: 1 };
  }

  const target = now < summerStart ? summerStart : new Date(year + 1, SUMMER_START_MONTH, 1);
  const yearStart = new Date(target.getFullYear() - 1, 8, 1); // 1 сентября: начало учебного года
  const total = daysBetween(target, yearStart);
  const passed = daysBetween(now, yearStart);

  return {
    summer: false,
    days: daysBetween(target, now),
    target,
    progress: total > 0 ? Math.min(1, passed / total) : 0
  };
}

function summerCountdown() {
  return summerCountdownAt(new Date());
}

/** «до лета 257 дней» — текстом, без иконки. */
function summerText(when) {
  const c = when ? summerCountdownAt(when) : summerCountdown();
  const word = plural(c.days, ['день', 'дня', 'дней']);
  return c.summer ? `до 1 сентября ${c.days} ${word}` : `до лета ${c.days} ${word}`;
}

/** «1 июля 2027 г.» — для подсказки при наведении. */
function summerDateText(date) {
  try {
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (err) {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Плашка «до лета» рядом с заголовком в шапке.
 * • подкрашена в цвет темы и показывает, сколько учебного года уже позади;
 * • ближе 100 дней — заметнее, ближе 30 — «горит» и солнышко покачивается;
 * • клик — шутка всплывающей плашкой снизу (сам счётчик при этом не дёргается).
 */
function renderSummerBadge(when) {
  const mount = document.getElementById('summer-mount');
  if (!mount) return;

  let el = document.getElementById('summer-badge');
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'summer-badge';
    el.className = 'summer-badge';
    el.innerHTML =
      '<span class="summer-ico"></span>' +
      '<span class="summer-txt"></span>' +
      '<span class="summer-bar"><i></i></span>';

    el.addEventListener('click', () => {
      toast(SUMMER_JOKES[Math.floor(Math.random() * SUMMER_JOKES.length)]);
      el.classList.remove('bounce');
      void el.offsetWidth; // чтобы анимация запускалась и при быстрых кликах подряд
      el.classList.add('bounce');
      setTimeout(() => el.classList.remove('bounce'), 520);
    });

    mount.appendChild(el);

    // сменили день/ночь или цветовую тему — перекрасить плашку в новый акцент
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', () => renderSummerBadge());
    onThemeChange(() => renderSummerBadge());
  }

  const c = when ? summerCountdownAt(when) : summerCountdown();
  const rgb = accentRgb();
  el.style.setProperty('--sb-tint', `rgba(${rgb.r},${rgb.g},${rgb.b},.13)`);
  el.style.setProperty('--sb-line', `rgba(${rgb.r},${rgb.g},${rgb.b},.34)`);

  el.querySelector('.summer-ico').textContent = c.summer ? '🏖' : '☀️';
  el.querySelector('.summer-txt').innerHTML =
    (c.summer ? 'до 1 сентября ' : 'до лета ') +
    '<b>' + c.days + '</b> ' +
    plural(c.days, ['день', 'дня', 'дней']);
  el.querySelector('.summer-bar i').style.width = Math.round(c.progress * 100) + '%';

  el.title = (c.summer ? 'Каникулы до ' : 'Лето начнётся ') + summerDateText(c.target);
  el.classList.toggle('near', !c.summer && c.days <= 100 && c.days > 30);
  el.classList.toggle('soon', !c.summer && c.days <= 30);
}

/* Тема из памяти браузера применяется сразу, до первой отрисовки страницы. */
applyTheme(savedTheme());

async function boot() {
  initBackground();
  renderSummerBadge();
  renderThemePicker();

  if (!IS_CONFIGURED) {
    // Конфиг ещё не заполнен — просто показываем подсказку, ничего не ломаем.
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    const card = document.getElementById('current-card');
    if (loading) loading.hidden = true;
    if (content) content.hidden = false;
    if (card) card.hidden = true;
    renderNotices();
    return;
  }

  initFirebase();

  if (state.mode === 'admin') {
    showGateScreen();
    onAuthStateChanged(auth, async (user) => {
      state.user = user;
      state.authChecked = true;

      if (!user) {
        stopDataListeners();
        showGateScreen();
        renderGate('');
        renderChrome();
        renderNotices2();
        return;
      }

      showAdminScreen();
      renderChrome();
      renderAll();
      startDataListeners();
      try {
        await seedIfEmpty();
      } catch (err) {
        showError(err);
      }
    });
  } else {
    // Обычный просмотр: данные грузим сразу, входа не требуется.
    document.getElementById('content').hidden = false;
    renderChrome();
    startDataListeners();
  }
}

/** Для админки: подсказки показываем только когда конфиг есть. */
function renderNotices2() {
  const box = document.getElementById('notice');
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

boot();
