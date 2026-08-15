import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.FIN_CONFIG || {};
const configured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes("PASTE_") &&
  !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clone = (x) => JSON.parse(JSON.stringify(x));
const id = () => crypto.randomUUID();

const DEFAULT = {
  salary_total: 91000,
  salary_1: 45500,
  salary_2: 45500,
  salary_day_1: 10,
  salary_day_2: 25,
  reserve_target: 50000,
  bonus_debt_pct: 70,
  bonus_reserve_pct: 20,
  bonus_self_pct: 10,
  categories: [
    {id:"c1",name:"Еда и продукты",monthly:18000,priority:"Обязательно"},
    {id:"c2",name:"Машина / бензин",monthly:8000,priority:"Обязательно"},
    {id:"c3",name:"Транспорт / такси",monthly:3000,priority:"Обычно"},
    {id:"c4",name:"Связь / интернет",monthly:1500,priority:"Обязательно"},
    {id:"c5",name:"Мелкие расходы",monthly:5000,priority:"Обычно"},
    {id:"c6",name:"Для себя",monthly:4000,priority:"Можно сократить"}
  ],
  accounts: [
    {id:"a1",name:"Карта 1",type:"Карта",balance:0},
    {id:"a2",name:"Вклад / подушка",type:"Накопления",balance:20000}
  ],
  debts: [
    {id:"d1",name:"Единый кредит",type:"Кредит",balance:460000,apr:0,payment:16900,due_day:25},
    {id:"d2",name:"Кредитка 1",type:"Кредитная карта",balance:90000,apr:0,payment:0,due_day:20}
  ],
  history: [],
  start_debt: 550000
};

let supabase = configured ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
let state = clone(DEFAULT);
let user = null;
let authMode = "login";
let selectedIncomeType = "1-я часть зарплаты";
let currentScreen = "today";

function money(v){ return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Number(v||0))+" ₽"; }
function esc(s){ return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m])); }
function totalDebt(){ return state.debts.reduce((s,x)=>s+Number(x.balance||0),0); }
function totalMoney(){ return state.accounts.reduce((s,x)=>s+Number(x.balance||0),0); }
function savings(){ return state.accounts.filter(x=>x.type==="Накопления").reduce((s,x)=>s+Number(x.balance||0),0); }
function monthlyLife(){ return state.categories.reduce((s,x)=>s+Number(x.monthly||0),0); }
function mandatoryDebt(){ return state.debts.filter(x=>Number(x.balance)>0).reduce((s,x)=>s+Number(x.payment||0),0); }
function priorityDebt(){
  const active=state.debts.filter(x=>Number(x.balance)>0);
  return active.sort((a,b)=>(Number(b.apr)-Number(a.apr)) || ((b.type==="Кредитная карта")-(a.type==="Кредитная карта")))[0]||null;
}
function nextOccurrence(day){
  const now=new Date(); let y=now.getFullYear(),m=now.getMonth();
  let candidate=new Date(y,m,Math.min(Number(day),new Date(y,m+1,0).getDate()),23,59,59);
  if(candidate<now){m++; if(m>11){m=0;y++;} candidate=new Date(y,m,Math.min(Number(day),new Date(y,m+1,0).getDate()),23,59,59);}
  const days=Math.max(0,Math.ceil((candidate-now)/86400000));
  return {date:candidate,days};
}
function nextSalary(){
  const a=nextOccurrence(state.salary_day_1),b=nextOccurrence(state.salary_day_2);
  const rows=[
    {...a,part:"1-я часть",amount:Number(state.salary_1)},
    {...b,part:"2-я часть",amount:Number(state.salary_2)}
  ];
  return rows.sort((x,y)=>x.date-y.date)[0];
}
function safeDaily(){
  const n=nextSalary();
  return { ...n, daily:(monthlyLife()/2)/Math.max(n.days,1) };
}
function migrate(d){
  const out={...clone(DEFAULT),...d};
  ["categories","accounts","debts","history"].forEach(k=>{ if(!Array.isArray(out[k])) out[k]=clone(DEFAULT[k]); });
  out.categories.forEach(x=>x.id ||= id()); out.accounts.forEach(x=>x.id ||= id()); out.debts.forEach(x=>x.id ||= id());
  out.history.forEach(x=>x.id ||= id());
  out.start_debt=Math.max(Number(out.start_debt||0),totalDebtOf(out),1);
  return out;
}
function totalDebtOf(d){ return d.debts.reduce((s,x)=>s+Number(x.balance||0),0); }
function cacheKey(){ return user ? `fin_shturman_cache_${user.id}` : "fin_shturman_cache"; }
function cacheState(){ localStorage.setItem(cacheKey(),JSON.stringify(state)); }
function cachedState(){ try{return JSON.parse(localStorage.getItem(cacheKey())||"null")}catch{return null} }
function toast(msg){ const t=$("#toast"); t.textContent=msg;t.classList.remove("hidden");setTimeout(()=>t.classList.add("hidden"),2400); }
function setSync(ok=true){ $("#syncBadge")?.classList.toggle("offline",!ok); $("#syncBadge")?.setAttribute("title",ok?"Синхронизировано":"Локально / нет связи"); }

async function saveState(){
  cacheState();
  if(!user || !navigator.onLine){setSync(false);return;}
  const {error}=await supabase.from("finance_state").upsert({
    user_id:user.id,payload:state,updated_at:new Date().toISOString()
  },{onConflict:"user_id"});
  setSync(!error);
  if(error) console.error(error);
}
async function loadState(){
  const local=cachedState();
  if(local) state=migrate(local);
  if(!navigator.onLine){setSync(false);return;}
  const {data,error}=await supabase.from("finance_state").select("payload").eq("user_id",user.id).maybeSingle();
  if(error){console.error(error);setSync(false);return;}
  if(data?.payload) state=migrate(data.payload);
  else await saveState();
  cacheState();setSync(true);
}
function addHistory(kind,amount,note,meta={}){
  state.history.push({id:id(),date:new Date().toISOString(),kind,amount:Number(amount||0),note,meta});
}

function standardPlan(incoming,partNo){
  const target=priorityDebt(), life=monthlyLife()/2, reserveGap=Math.max(0,state.reserve_target-savings());
  let rem=incoming; const a=[];
  let v=Math.min(rem,life); a.push(["На жизнь до следующей выплаты",v]); rem-=v;
  if(partNo===2){
    v=Math.min(rem,mandatoryDebt()); if(v>0)a.push(["Обязательные платежи по долгам",v]); rem-=v;
  }
  v=Math.min(rem,partNo===1?3000:2000,reserveGap); if(v>0)a.push(["В подушку",v]); rem-=v;
  if(target&&rem>0){v=Math.min(rem,target.balance);a.push([`Досрочно → ${target.name}`,v]);rem-=v;}
  if(rem>0)a.push(["Свободный остаток",rem]);
  return {alloc:a,target,reason:partNo===1
    ?"Первая часть защищает жизнь до следующей выплаты. Только остаток идёт в подушку и долг."
    :"Вторая часть дополнительно резервирует обязательные платежи, после них ускоряет погашение долга."};
}
function bonusPlan(incoming){
  const target=priorityDebt(),sum=Math.max(state.bonus_debt_pct+state.bonus_reserve_pct+state.bonus_self_pct,1),a=[];
  let d=incoming*state.bonus_debt_pct/sum,r=incoming*state.bonus_reserve_pct/sum,s=incoming*state.bonus_self_pct/sum;
  if(target)a.push([`В долг → ${target.name}`,Math.min(d,target.balance)]);else r+=d;
  if(r>0)a.push(["В подушку",r]);if(s>0)a.push(["Себе без чувства вины",s]);
  const used=a.reduce((x,y)=>x+y[1],0);if(incoming-used>1)a.push(["Свободный остаток",incoming-used]);
  return {alloc:a,target,reason:"Премия не становится новой постоянной зарплатой. Поэтому обычный бюджет автоматически не увеличивается."};
}
function vacationPlan(incoming,vacationBudget){
  const target=priorityDebt(),n=safeDaily();let rem=incoming,a=[];
  let life=Math.min(rem,n.daily*Math.max(n.days,1));if(life>0)a.push([`Резерв на жизнь до ${n.date.toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"})}`,life]);rem-=life;
  let pay=Math.min(rem,mandatoryDebt());if(pay>0)a.push(["Ближайшие обязательные платежи",pay]);rem-=pay;
  let vac=Math.min(rem,vacationBudget);if(vac>0)a.push(["На отпуск / поездку",vac]);rem-=vac;
  if(target&&rem>0){let v=Math.min(rem,target.balance);a.push([`Остаток досрочно → ${target.name}`,v]);rem-=v;}
  if(rem>0)a.push(["Свободный остаток",rem]);
  return {alloc:a,target,reason:"Отпускные не считаются полностью свободными: сначала защищаем жизнь до следующей выплаты и обязательные платежи."};
}
function otherPlan(incoming,purpose){
  const target=priorityDebt();let a=[];
  if(purpose==="Сохранить на цель")a=[["Оставить под цель",incoming]];
  else if(purpose==="В подушку")a=[["В подушку",incoming]];
  else if(purpose==="В долг"&&target)a=[[`В долг → ${target.name}`,Math.min(incoming,target.balance)]];
  else{
    if(target)a.push([`В долг → ${target.name}`,incoming*.5]);
    a.push(["В подушку",incoming*.3],["Себе / на цель",target?incoming*.2:incoming*.7]);
  }
  return {alloc:a,target,reason:"Разовое поступление не меняет размер твоей обычной зарплаты."};
}

function incomePlan(type,amount,vacation=0,purpose="Пока не знаю"){
  if(type==="1-я часть зарплаты") return standardPlan(amount,1);
  if(type==="2-я часть зарплаты") return standardPlan(amount,2);
  if(type==="Премия") return bonusPlan(amount);
  if(type==="Отпускные") return vacationPlan(amount,vacation);
  return otherPlan(amount,purpose);
}

function renderToday(){
  const debt=totalDebt(),cash=totalMoney(),reserve=savings(),start=Math.max(state.start_debt,debt,1),progress=Math.max(0,Math.min(100,(1-debt/start)*100));
  const n=safeDaily(),target=priorityDebt();
  const chips=["1-я часть зарплаты","2-я часть зарплаты","Премия","Отпускные","Другое"];
  const defaultAmount=selectedIncomeType==="1-я часть зарплаты"?state.salary_1:selectedIncomeType==="2-я часть зарплаты"?state.salary_2:0;

  $("#screen-today").innerHTML=`
    <div class="grid2">
      <div class="metric"><div class="k">Долги</div><div class="v">${money(debt)}</div></div>
      <div class="metric"><div class="k">Мои деньги</div><div class="v">${money(cash)}</div></div>
      <div class="metric"><div class="k">Подушка</div><div class="v">${money(reserve)}</div></div>
      <div class="metric"><div class="k">Расходы / месяц</div><div class="v">${money(monthlyLife())}</div></div>
    </div>
    <div class="card">
      <div class="row"><b>Путь к нулевому долгу</b><b>${progress.toFixed(0)}%</b></div>
      <div class="progress"><div style="width:${progress}%"></div></div>
      <div class="small muted">Было ${money(start)} → сейчас ${money(debt)}</div>
    </div>
    <div class="card tip good">
      <b>До следующей выплаты: ${n.days} дн.</b>
      <div style="font-size:22px;font-weight:800;margin:5px 0">${money(n.daily)} / день</div>
      <div class="small muted">${n.part}, ${n.date.toLocaleDateString("ru-RU")}. Это ориентир, а не запрет.</div>
    </div>

    <div class="section-title"><h2>💰 Мне пришли деньги</h2></div>
    <div class="chips">${chips.map(x=>`<button class="chip ${x===selectedIncomeType?"active":""}" data-income="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <div class="card">
      <div class="form-grid">
        <label class="wide">Сумма<input id="incomeAmount" type="number" min="0" step="500" value="${defaultAmount}"></label>
        ${selectedIncomeType==="Отпускные"?`<label class="wide">Сколько планируешь на отпуск<input id="vacationBudget" type="number" min="0" step="1000" value="0"></label>`:""}
        ${selectedIncomeType==="Другое"?`<label class="wide">Что хочешь сделать<select id="otherPurpose"><option>Пока не знаю</option><option>Сохранить на цель</option><option>В подушку</option><option>В долг</option></select></label>`:""}
      </div>
      <div id="incomePlanBox"></div>
      <button id="saveIncomeBtn" class="primary full" style="margin-top:10px">Записать поступление и план</button>
    </div>

    <div class="card">
      <h2>🛍️ Перед покупкой</h2>
      <div class="form-grid">
        <label class="wide">Что хочешь купить?<input id="purchaseName" placeholder="Например: одежда"></label>
        <label class="wide">Стоимость<input id="purchasePrice" type="number" min="0" step="500" value="0"></label>
      </div>
      <div id="purchaseAdvice" class="small muted" style="margin:10px 0"></div>
      <div class="grid2">
        <button id="delayPurchase">⏳ Отложить</button>
        <button id="boughtPurchase">Купила</button>
      </div>
    </div>
  `;

  $$("#screen-today [data-income]").forEach(b=>b.onclick=()=>{selectedIncomeType=b.dataset.income;renderToday();});
  const amount=$("#incomeAmount"),vac=$("#vacationBudget"),purpose=$("#otherPurpose"),box=$("#incomePlanBox");
  function updatePlan(){
    const v=Number(amount.value||0);if(v<=0){box.innerHTML="";return;}
    const p=incomePlan(selectedIncomeType,v,Number(vac?.value||0),purpose?.value);
    box.innerHTML=`<hr><h3>Я бы распределил так:</h3>${p.alloc.filter(x=>x[1]>0).map(x=>`<div class="allocation"><span>${esc(x[0])}</span><b>${money(x[1])}</b></div>`).join("")}
      <div class="notice"><b>Почему так?</b><br>${esc(p.reason)}</div>`;
  }
  [amount,vac,purpose].filter(Boolean).forEach(x=>x.oninput=updatePlan);updatePlan();
  $("#saveIncomeBtn").onclick=async()=>{
    const v=Number(amount.value||0);if(v<=0)return toast("Введи сумму");
    const p=incomePlan(selectedIncomeType,v,Number(vac?.value||0),purpose?.value);
    addHistory(selectedIncomeType,v,"Помощник сформировал план распределения.",{allocations:p.alloc,reason:p.reason});
    await saveState();renderHistory();toast("Сохранено в истории");
  };

  const price=$("#purchasePrice"),advice=$("#purchaseAdvice");
  price.oninput=()=>{
    const v=Number(price.value||0);if(!v){advice.textContent="";return;}
    const t=priorityDebt();let s=v<=n.daily?"Сумма примерно в пределах дневного ориентира.":"Покупка уменьшит бюджет текущего периода.";
    if(t)s+=` Если направить ${money(v)} в «${t.name}», там останется около ${money(Math.max(0,t.balance-v))}.`;
    advice.textContent=s;
  };
  $("#delayPurchase").onclick=async()=>{const v=Number(price.value||0);if(!v)return toast("Введи стоимость");addHistory("Отложила покупку",v,$("#purchaseName").value||"Покупка");await saveState();renderHistory();toast("Решение сохранено");};
  $("#boughtPurchase").onclick=async()=>{const v=Number(price.value||0);if(!v)return toast("Введи стоимость");addHistory("Покупка",-v,$("#purchaseName").value||"Покупка");await saveState();renderHistory();toast("Покупка записана");};
}

function renderMoney(){
  $("#screen-money").innerHTML=`
    <div class="section-title"><h2>Зарплата</h2></div>
    <div class="card form-grid">
      <label class="wide">Всего в месяц<input data-root="salary_total" type="number" value="${state.salary_total}"></label>
      <label>1-я часть<input data-root="salary_1" type="number" value="${state.salary_1}"></label>
      <label>2-я часть<input data-root="salary_2" type="number" value="${state.salary_2}"></label>
      <label>День 1-й выплаты<input data-root="salary_day_1" type="number" min="1" max="31" value="${state.salary_day_1}"></label>
      <label>День 2-й выплаты<input data-root="salary_day_2" type="number" min="1" max="31" value="${state.salary_day_2}"></label>
    </div>

    <div class="section-title"><h2>Премия</h2></div>
    <div class="card form-grid">
      <label>В долг, %<input data-root="bonus_debt_pct" type="number" value="${state.bonus_debt_pct}"></label>
      <label>В подушку, %<input data-root="bonus_reserve_pct" type="number" value="${state.bonus_reserve_pct}"></label>
      <label>Себе, %<input data-root="bonus_self_pct" type="number" value="${state.bonus_self_pct}"></label>
      <label>Цель подушки<input data-root="reserve_target" type="number" value="${state.reserve_target}"></label>
    </div>

    <div class="section-title"><h2>Обычные расходы</h2><button id="addCategory">＋</button></div>
    <div id="categoryList">${state.categories.map(c=>categoryHtml(c)).join("")}</div>

    <div class="section-title"><h2>Деньги и накопления</h2><button id="addAccount">＋</button></div>
    <div id="accountList">${state.accounts.map(a=>accountHtml(a)).join("")}</div>

    <div class="section-title"><h2>Долги</h2><button id="addDebt">＋</button></div>
    <div id="debtList">${state.debts.map(d=>debtHtml(d)).join("")}</div>

    <button id="saveAllBtn" class="primary full" style="margin-top:16px">💾 Сохранить изменения</button>
    <div class="notice">Используй условные названия: «Карта 1», «Вклад», «Кредитка». Номера карт не нужны.</div>
  `;

  $("#addCategory").onclick=()=>{state.categories.push({id:id(),name:"Новый расход",monthly:0,priority:"Обычно"});renderMoney();};
  $("#addAccount").onclick=()=>{state.accounts.push({id:id(),name:"Новый счёт",type:"Карта",balance:0});renderMoney();};
  $("#addDebt").onclick=()=>{state.debts.push({id:id(),name:"Новый долг",type:"Кредит",balance:0,apr:0,payment:0,due_day:25});renderMoney();};

  $$("[data-delete-category]").forEach(b=>b.onclick=()=>{state.categories=state.categories.filter(x=>x.id!==b.dataset.deleteCategory);renderMoney();});
  $$("[data-delete-account]").forEach(b=>b.onclick=()=>{state.accounts=state.accounts.filter(x=>x.id!==b.dataset.deleteAccount);renderMoney();});
  $$("[data-delete-debt]").forEach(b=>b.onclick=()=>{state.debts=state.debts.filter(x=>x.id!==b.dataset.deleteDebt);renderMoney();});

  $("#saveAllBtn").onclick=async()=>{
    $$("[data-root]").forEach(el=>state[el.dataset.root]=Number(el.value||0));
    state.categories.forEach(c=>{
      const base=`[data-cat-id="${c.id}"]`;c.name=$(`${base} [data-f="name"]`).value;c.monthly=Number($(`${base} [data-f="monthly"]`).value||0);c.priority=$(`${base} [data-f="priority"]`).value;
    });
    state.accounts.forEach(a=>{
      const base=`[data-account-id="${a.id}"]`;a.name=$(`${base} [data-f="name"]`).value;a.balance=Number($(`${base} [data-f="balance"]`).value||0);a.type=$(`${base} [data-f="type"]`).value;
    });
    state.debts.forEach(d=>{
      const base=`[data-debt-id="${d.id}"]`;d.name=$(`${base} [data-f="name"]`).value;d.balance=Number($(`${base} [data-f="balance"]`).value||0);d.payment=Number($(`${base} [data-f="payment"]`).value||0);d.apr=Number($(`${base} [data-f="apr"]`).value||0);d.type=$(`${base} [data-f="type"]`).value;d.due_day=Number($(`${base} [data-f="due_day"]`).value||25);
    });
    state.start_debt=Math.max(state.start_debt,totalDebt(),1);
    addHistory("Настройки обновлены",0,"Изменены доходы, расходы, счета или долги.");
    await saveState();renderToday();renderHistory();toast("Сохранено");
  };
}
function categoryHtml(c){return `<div class="item" data-cat-id="${c.id}">
  <div class="item-grid"><label>Категория<input data-f="name" value="${esc(c.name)}"></label><label>В месяц<input data-f="monthly" type="number" value="${c.monthly}"></label></div>
  <label>Важность<select data-f="priority">${["Обязательно","Обычно","Можно сократить"].map(x=>`<option ${x===c.priority?"selected":""}>${x}</option>`).join("")}</select></label>
  <button class="danger full delete" data-delete-category="${c.id}">Удалить</button></div>`;}
function accountHtml(a){return `<div class="item" data-account-id="${a.id}">
  <div class="item-grid"><label>Название<input data-f="name" value="${esc(a.name)}"></label><label>Сейчас там<input data-f="balance" type="number" value="${a.balance}"></label></div>
  <label>Тип<select data-f="type">${["Карта","Наличные","Накопления"].map(x=>`<option ${x===a.type?"selected":""}>${x}</option>`).join("")}</select></label>
  <button class="danger full delete" data-delete-account="${a.id}">Удалить</button></div>`;}
function debtHtml(d){return `<div class="item" data-debt-id="${d.id}">
  <label>Название<input data-f="name" value="${esc(d.name)}"></label>
  <div class="item-grid"><label>Остаток долга<input data-f="balance" type="number" value="${d.balance}"></label><label>Платёж / месяц<input data-f="payment" type="number" value="${d.payment}"></label></div>
  <div class="item-grid"><label>Ставка, %<input data-f="apr" type="number" step=".1" value="${d.apr}"></label><label>День платежа<input data-f="due_day" type="number" min="1" max="31" value="${d.due_day}"></label></div>
  <label>Тип<select data-f="type">${["Кредит","Кредитная карта"].map(x=>`<option ${x===d.type?"selected":""}>${x}</option>`).join("")}</select></label>
  <button class="danger full delete" data-delete-debt="${d.id}">Удалить</button></div>`;}

function renderHistory(){
  const h=[...state.history].reverse();
  $("#screen-history").innerHTML=`
    <div class="section-title"><h2>История</h2></div>
    ${h.length?h.map(x=>historyHtml(x)).join(""):`<div class="card muted">История пока пустая.</div>`}
    <div class="card">
      <h3>Резервная копия</h3>
      <p class="small muted">Supabase — основное хранилище. Файл можно сохранить дополнительно себе.</p>
      <div class="grid2"><button id="exportBtn">⬇️ Скачать</button><button id="importBtn">⬆️ Восстановить</button></div>
      <input id="importFile" type="file" accept="application/json" class="hidden">
    </div>
  `;
  $$("[data-delete-history]").forEach(b=>b.onclick=async()=>{state.history=state.history.filter(x=>x.id!==b.dataset.deleteHistory);await saveState();renderHistory();toast("Удалено");});
  $("#exportBtn").onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="fin-shturman-backup.json";a.click();URL.revokeObjectURL(a.href);};
  $("#importBtn").onclick=()=>$("#importFile").click();
  $("#importFile").onchange=async(e)=>{const f=e.target.files[0];if(!f)return;try{state=migrate(JSON.parse(await f.text()));await saveState();renderAll();toast("Копия восстановлена");}catch{toast("Не удалось прочитать файл");}};
}
function historyHtml(h){
  const amt=Number(h.amount||0);const d=new Date(h.date);const alloc=h.meta?.allocations||[];
  return `<div class="history-item"><div class="history-head"><div><b>${esc(h.kind)}</b><div class="small muted">${isNaN(d)?esc(h.date):d.toLocaleString("ru-RU")} · ${esc(h.note)}</div></div><div class="history-amount">${amt?`${amt>0?"+":""}${money(amt)}`:""}</div></div>
    ${alloc.length?`<details><summary>Как распределял помощник</summary>${alloc.map(x=>`<div class="allocation"><span>${esc(x[0])}</span><b>${money(x[1])}</b></div>`).join("")}<div class="small muted">${esc(h.meta.reason||"")}</div></details>`:""}
    <button class="danger full" data-delete-history="${h.id}" style="margin-top:8px">Удалить запись</button></div>`;
}

function renderAll(){renderToday();renderMoney();renderHistory();showScreen(currentScreen);}
function showScreen(name){
  currentScreen=name;
  $$(".screen").forEach(x=>x.classList.toggle("active",x.id===`screen-${name}`));
  $$(".nav-btn").forEach(x=>x.classList.toggle("active",x.dataset.screen===name));
  window.scrollTo({top:0,behavior:"smooth"});
}

async function init(){
  if(!configured){$("#setupScreen").classList.remove("hidden");return;}
  const {data:{session}}=await supabase.auth.getSession();
  if(session){user=session.user;await enterApp();}
  else $("#authScreen").classList.remove("hidden");

  supabase.auth.onAuthStateChange(async(_event,session)=>{
    if(session&&!user){user=session.user;await enterApp();}
    if(!session&&user){user=null;$("#app").classList.add("hidden");$("#authScreen").classList.remove("hidden");}
  });
}
async function enterApp(){
  $("#authScreen").classList.add("hidden");$("#app").classList.remove("hidden");
  await loadState();renderAll();
}
$$("[data-auth-mode]").forEach(b=>b.onclick=()=>{
  authMode=b.dataset.authMode;$$("[data-auth-mode]").forEach(x=>x.classList.toggle("active",x===b));
  $("#authSubmit").textContent=authMode==="login"?"Войти":"Создать вход";
  $("#authHint").textContent=authMode==="signup"?"После регистрации Supabase может попросить подтвердить email.":"";
});
$("#authSubmit").onclick=async()=>{
  const email=$("#authEmail").value.trim(),password=$("#authPassword").value;
  if(!email||password.length<6)return toast("Проверь email и пароль");
  $("#authSubmit").disabled=true;
  try{
    if(authMode==="signup"){
      const {data,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}});
      if(error)throw error;
      if(data.session){user=data.user;await enterApp();} else {$("#authHint").textContent="Проверь почту и подтверди регистрацию, затем войди.";toast("Письмо отправлено");}
    }else{
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw error;user=data.user;await enterApp();
    }
  }catch(e){toast(e.message||"Ошибка входа");}
  finally{$("#authSubmit").disabled=false;}
};
$("#logoutBtn").onclick=async()=>{await supabase.auth.signOut();};
$$(".nav-btn").forEach(b=>b.onclick=()=>showScreen(b.dataset.screen));
window.addEventListener("online",async()=>{setSync(true);if(user)await saveState();});
window.addEventListener("offline",()=>setSync(false));

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
init();
