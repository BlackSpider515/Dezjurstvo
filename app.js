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

/**
 * Нужна ли замена в этот день: кто-то из пары отмечен «не продежурил»,
 * и при этом день ещё никем не закрыт (нет замены со статусом «продежурил»).
 */
function needsReplacement(week, day) {
  const missed = state.duties.some((d) =>
    d.week === week && d.day === day && d.role === 'main' && d.status === 'missed');
  if (!missed) return false;
  const covered = replacementsFor(week, day).some((r) => r.status === 'done');
  return !covered;
}

/** Сколько дней отдежурил каждый человек (по всем неделям). */
function computeStats() {
  const map = new Map();
  for (const p of state.people) {
    map.set(p.id, { id: p.id, name: p.name, done: 0, missed: 0, known: true });
  }
  for (const d of state.duties) {
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
  for (const day of DUTY_DAY_LIST) {
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

/** Назначить замену на конкретный день. */
async function assignReplacement(week, day, personId) {
  if (!requireAdmin()) return;
  const person = state.people.find((p) => p.id === personId);
  if (!person) { toast('Выберите человека из списка', 'err'); return; }

  try {
    await setDoc(doc(db, 'duties', dutyId(week, day, personId, 'replacement')),
      dutyPayload(week, day, person, 'replacement', 'done'));
    toast(`Замена назначена: ${person.name}`);
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

  const membersHtml = members.map((m) => {
    const done = weekDuties.filter((d) =>
      d.personId === m.id && d.role === 'main' && d.status === 'done').length;
    const missed = weekDuties.filter((d) =>
      d.personId === m.id && d.role === 'main' && d.status === 'missed').length;
    const total = stats.get(m.id);
    return `
      <div class="member">
        <span class="mname">${esc(m.name || 'Вакансия')}</span>
        <span class="mstats">на этой неделе: <b>${done}</b> из ${DUTY_DAY_LIST.length}${
          missed ? ` · пропущено <b class="missed">${missed}</b>` : ''}</span>
        <span class="mtotal">всего отдежурено: <b>${total ? total.done : 0}</b> ${plural(total ? total.done : 0, ['день', 'дня', 'дней'])}</span>
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="card-label">${isNow ? 'Дежурят на этой неделе' : 'Дежурят на выбранной неделе'}</div>
    <div class="pair-title">${esc(pairTitle(pair))}</div>
    <div class="week-range">${esc(weekLabel(week))}${isNow ? ' · идёт сейчас' : ''}</div>
    <div class="members">${membersHtml}</div>`;
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
    const top = ranking().filter((p) => p.known).slice(0, 5);
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
  let head = '<tr><th class="col-day">День</th>';
  for (const m of members) head += `<th>${esc(m.name || 'Вакансия')}</th>`;
  if (isAdmin) head += '<th>Замена</th>';
  head += '</tr>';

  // Строки по дежурным дням
  const rows = DUTY_DAY_LIST.map((day) => {
    const date = addDays(mon, day);
    const iso = toISO(date);
    const isToday = iso === today;

    let cells = '';
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
    }

    return `<tr class="${isToday ? 'is-today' : ''}">
      <th class="col-day">
        <span class="dow">${DAYS_SHORT[day]}</span><span class="dnum">${dayShort(date)}</span>
        <span class="room">каб. ${esc(roomForDay(day))}</span>
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
          <li>Если человек отмечен как «не продежурил», его недостающие дни не пропадают — они добираются позже: на такие дни ставят тех, у кого меньше всего отдежуренных дней.</li>
          <li>В рейтинге люди отсортированы от меньшего количества отдежуренных дней к большему.</li>
          <li>Если в паре поменяли человека, история прошлых дежурств остаётся за прежним человеком.</li>
        </ul>
      </details>
    </div>`;
}

function renderReplacementCell(week, day, pair) {
  const reps = replacementsFor(week, day);
  let html = '<div class="reps">';

  for (const r of reps) {
    html += `<span class="rep-chip">
      <span class="rep-name">${esc(r.personName || '—')}</span>
      <button type="button" class="mbtn mbtn-done ${r.status === 'done' ? 'active' : ''}"
        data-action="rep-status" data-id="${r.id}" data-status="done" title="Продежурил">✓</button>
      <button type="button" class="mbtn mbtn-missed ${r.status === 'missed' ? 'active' : ''}"
        data-action="rep-status" data-id="${r.id}" data-status="missed" title="Не продежурил">✗</button>
      <button type="button" class="xbtn" data-action="rep-remove" data-id="${r.id}" title="Убрать замену">×</button>
    </span>`;
  }

  if (needsReplacement(week, day) || reps.length) {
    const suggestions = suggestedReplacements(pair, day, 5);
    const suggestedIds = new Set(suggestions.map((s) => s.id));
    const rest = ranking().filter((p) => p.known && !suggestedIds.has(p.id));

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

    const label = needsReplacement(week, day) ? 'нужна замена' : '';
    html += `
      <form class="rep-form" data-action="rep-add-form" data-week="${week}" data-day="${day}">
        <select name="person" aria-label="Кому поставить замену${label ? ' (' + label + ')' : ''}">${options}</select>
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
        perPerson.set(key, { name: d.personName || '—', done: 0, missed: 0, isRep: d.role === 'replacement' });
      }
      const rec = perPerson.get(key);
      if (d.status === 'done') rec.done += 1;
      else if (d.status === 'missed') rec.missed += 1;
    }

    const uncovered = DUTY_DAY_LIST.filter((day) => needsReplacement(week, day)).length;
    const isNow = week === current;

    const items = [...perPerson.values()].map((p) => `
      <li>
        <span class="hname">${esc(p.name)}${p.isRep ? '<span class="rep-tag">замена</span>' : ''}</span>
        <span class="hval">отдежурено: <b>${p.done}</b>${
          p.missed ? ` · пропущено: <b class="missed">${p.missed}</b>` : ''}</span>
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

async function boot() {
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
