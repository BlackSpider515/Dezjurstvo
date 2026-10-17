import {initializeApp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {getFirestore,doc,setDoc,onSnapshot,collection} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {firebaseConfig} from "./firebase-config.js";

const ADMIN = !!window.ADMIN;
const DAYS = ["Пн","Вт","Ср","Чт","Пт"];          // дни дежурства
const BASE = "2026-10-12";                          // понедельник, с которого дежурит 1-я пара
const DEFAULT_PAIRS = [
 ["Алиев Али","Авдощенко Руслан"],["Пономаренко Григорий","Тибенко Дмитрий"],
 ["Солньшкин Данил","Дзюба Антон"],["Музыкин Григорий","Неделько Денис"],
 ["Топаров Данил","Хинельцев Сергей"],["Носарев Анатолий","Ковалевский Богдан"],
 ["Спасская Диана","Остапенко Софья"],["Мишалов Никита","Иванов Андрей"]];

const db = getFirestore(initializeApp(firebaseConfig));
const auth = getAuth();
let pairs = DEFAULT_PAIRS, base = BASE, weeks = {}, user = null, draft = null;
const monday = d => { const x = new Date(d); x.setHours(12,0,0,0); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; };
let view = monday(new Date());
const iso = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const fmt = d => d.toLocaleDateString("ru",{day:"numeric",month:"long"});
const esc = s => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $ = id => document.getElementById(id);

function defaultNames(d){
  const w = Math.round((monday(d)-new Date(base+"T12:00:00"))/604800000);
  return pairs[((w%pairs.length)+pairs.length)%pairs.length];
}
const weekData = d => weeks[iso(d)] || {names:defaultNames(d),marks:{},subs:{}};
const save = (d,fn) => { const w = structuredClone(weekData(d)); w.marks ||= {}; w.subs ||= {}; fn(w); return setDoc(doc(db,"weeks",iso(d)),w); };

function counts(){
  const c = {}; pairs.flat().forEach(n=>{ if(n) c[n]=0; });
  for(const w of Object.values(weeks)) for(const k in (w.marks||{}))
    if(w.marks[k]==="yes"){ const n=(w.subs||{})[k]||w.names[+k.split("|")[1]]; c[n]=(c[n]||0)+1; }
  return c;
}

function render(){
  const app = $("app");
  if(ADMIN && !user){ app.innerHTML = '<p class="hint">Войди, чтобы редактировать дежурство.</p>'; $("editor").innerHTML=""; return; }
  const w = weekData(view), c = counts(), ed = ADMIN && user;
  const order = Object.keys(c).sort((a,b)=>c[a]-c[b]||a.localeCompare(b));
  const thisWeek = iso(view)===iso(monday(new Date()));
  const end = new Date(view); end.setDate(end.getDate()+4);
  let h = `<div class="card nav"><button data-a="prev">←</button><b>${fmt(view)} – ${fmt(end)}${thisWeek?" (эта неделя)":""}</b><button data-a="next">→</button></div>`;
  h += `<div class="card now"><h2>Дежурят: ${esc(w.names[0])} и ${esc(w.names[1])}</h2>`;
  if(ed){
    h += `<label class="hint">Другая пара на эту неделю:</label> <select data-a="pair">`+
      pairs.map((p,i)=>`<option value="${i}" ${p[0]===w.names[0]&&p[1]===w.names[1]?"selected":""}>${esc(p[0])} и ${esc(p[1])}</option>`).join("")+`</select>`;
  }
  h += `</div><div class="card"><h2>По дням</h2>`;
  DAYS.forEach((dn,d)=>{
    const dd = new Date(view); dd.setDate(dd.getDate()+d);
    h += `<div class="day"><div><b>${dn}</b><div class="st">${fmt(dd)}</div></div>`;
    [0,1].forEach(s=>{
      const k = d+"|"+s, sub = w.subs[k], who = sub||w.names[s], m = w.marks[k];
      h += `<div class="slot"><span>${esc(who)}${sub?' <span class="st">(замена)</span>':""}</span>`;
      if(ed){
        h += `<span><button class="${m==="yes"?"on-yes":""}" data-a="mark" data-k="${k}" data-v="yes">✔ был</button> <button class="${m==="no"?"on-no":""}" data-a="mark" data-k="${k}" data-v="no">✖ нет</button></span>`;
        h += `<select data-a="sub" data-k="${k}"><option value="">без замены</option>`+
          order.map(n=>`<option ${n===sub?"selected":""} value="${esc(n)}">${esc(n)} (${c[n]})</option>`).join("")+`</select>`;
      } else h += `<span class="st ${m==="yes"?"ok":m==="no"?"bad":""}">${m==="yes"?"✔ продежурил":m==="no"?"✖ не дежурил":"—"}</span>`;
      h += `</div>`;
    });
    h += `</div>`;
  });
  h += `</div><div class="card"><h2>Рейтинг: меньше всего дежурств — выше</h2>`+
    order.map(n=>`<div class="rank"><span>${esc(n)}</span><b>${c[n]}</b></div>`).join("")+
    `<p class="hint">Если пара не может, ставят тех, кто сверху списка.</p></div>`;
  app.innerHTML = h;
}

function renderEditor(){
  const el = $("editor");
  if(!(ADMIN && user)){ el.innerHTML=""; return; }
  draft ||= structuredClone(pairs);
  el.innerHTML = `<div class="card"><h2>Состав пар</h2><p class="hint">Поменяй имя в поле и нажми «Сохранить пары». Порядок сверху вниз — очередь дежурств.</p>`+
    draft.map((p,i)=>`<div class="row"><b>${i+1}</b><input data-i="${i}" data-j="0" value="${esc(p[0])}"><input data-i="${i}" data-j="1" value="${esc(p[1])}"><button data-a="del" data-i="${i}">✖</button></div>`).join("")+
    `<button data-a="add">+ Добавить пару</button> <button class="p" data-a="savepairs">Сохранить пары</button></div>`;
}

document.addEventListener("click", async e=>{
  const b = e.target.closest("button"); if(!b) return; const a = b.dataset.a;
  if(a==="prev"||a==="next"){ view.setDate(view.getDate()+(a==="next"?7:-7)); render(); }
  else if(a==="mark"){ const {k,v}=b.dataset; save(view,w=>{ w.marks[k]===v?delete w.marks[k]:w.marks[k]=v; }); }
  else if(a==="add"){ draft.push(["",""]); renderEditor(); }
  else if(a==="del"){ draft.splice(+b.dataset.i,1); renderEditor(); }
  else if(a==="savepairs"){
    const clean = draft.filter(p=>p[0].trim()&&p[1].trim()).map(p=>[p[0].trim(),p[1].trim()]);
    if(!clean.length) return alert("Добавь хотя бы одну пару");
    await setDoc(doc(db,"settings","main"),{pairs:clean,base}); draft=null; renderEditor(); alert("Пары сохранены");
  }
  else if(a==="login"){
    try{ await signInWithEmailAndPassword(auth,$("em").value,$("pw").value); }catch{ alert("Неверная почта или пароль"); }
  }
  else if(a==="logout") signOut(auth);
});
document.addEventListener("change", e=>{
  const s = e.target; if(!ADMIN||!user) return;
  if(s.dataset.a==="pair") save(view,w=>{ w.names=[...pairs[+s.value]]; w.marks={}; w.subs={}; });
  if(s.dataset.a==="sub") save(view,w=>{ s.value?w.subs[s.dataset.k]=s.value:delete w.subs[s.dataset.k]; });
});
document.addEventListener("input", e=>{ const i=e.target.dataset; if(draft && i.i!==undefined && i.j!==undefined) draft[+i.i][+i.j]=e.target.value; });

onSnapshot(doc(db,"settings","main"), s=>{ if(s.exists()){ pairs=s.data().pairs; base=s.data().base||BASE; } render(); if(!draft) renderEditor(); });
onSnapshot(collection(db,"weeks"), s=>{ weeks={}; s.forEach(d=>weeks[d.id]=d.data()); render(); });
if(ADMIN) onAuthStateChanged(auth,u=>{
  user=u; draft=null;
  $("auth").innerHTML = u ? `<button data-a="logout">Выйти</button>` :
    `<input id="em" type="email" placeholder="Почта" autocomplete="username"> <input id="pw" type="password" placeholder="Пароль" autocomplete="current-password"> <button class="p" data-a="login">Войти</button>`;
  render(); renderEditor();
});
