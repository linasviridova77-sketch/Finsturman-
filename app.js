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
  bonus_debt_pct: 50,
  bonus_reserve_pct: 30,
  bonus_self_pct: 20,
  impulse_pause_hours: 72,
  strategy_mode: "Сбалансированный",
  buffer_per_period: 5000,
  extra_debt_share_balanced: 50,
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
function previousOccurrence(day){
  const now=new Date(); let y=now.getFullYear(),m=now.getMonth();
  let candidate=new Date(y,m,Math.min(Number(day),new Date(y,m+1,0).getDate()),0,0,0);
  if(candidate>now){m--; if(m<0){m=11;y--;} candidate=new Date(y,m,Math.min(Number(day),new Date(y,m+1,0).getDate()),0,0,0);}
  return candidate;
}
function nextSalary(){
  const a=nextOccurrence(state.salary_day_1),b=nextOccurrence(state.salary_day_2);
  const rows=[
    {...a,part:"1-я часть",amount:Number(state.salary_1)},
    {...b,part:"2-я часть",amount:Number(state.salary_2)}
  ];
  return rows.sort((x,y)=>x.date-y.date)[0];
}
function currentPeriod(){
  const p1=previousOccurrence(state.salary_day_1),p2=previousOccurrence(state.salary_day_2);
  const start=p1>p2?p1:p2;
  const next=nextSalary();
  return {start,end:next.date,days:Math.max(next.days,1),part:next.part};
}
function expenseEventsInPeriod(){
  const p=currentPeriod();
  return state.history.filter(h=>{
    const d=new Date(h.date);
    return d>=p.start && d<p.end && Number(h.amount)<0 && ["Покупка","Расход"].includes(h.kind);
  });
}
function spentThisPeriod(){
  return expenseEventsInPeriod().reduce((s,h)=>s+Math.abs(Number(h.amount||0)),0);
}
function categorySpent(categoryId){
  return expenseEventsInPeriod()
    .filter(h=>h.meta?.categoryId===categoryId)
    .reduce((s,h)=>s+Math.abs(Number(h.amount||0)),0);
}
function remainingLifeThisPeriod(){
  return Math.max(0,monthlyLife()/2-spentThisPeriod());
}
function nextDebtDueDate(day){
  return nextOccurrence(day).date;
}
function debtDueBeforeNextSalary(){
  const n=nextSalary();
  return state.debts.filter(x=>Number(x.balance)>0).reduce((sum,x)=>{
    const due=nextDebtDueDate(x.due_day);
    return due<=n.date ? sum+Number(x.payment||0) : sum;
  },0);
}
function safeDaily(){
  const n=nextSalary();
  const remaining=remainingLifeThisPeriod();
  return { ...n, daily:remaining/Math.max(n.days,1), remaining, spent:spentThisPeriod() };
}
function pendingPauses(){
  const now=Date.now();
  return state.history.filter(h=>h.kind==="Отложила покупку" && h.meta?.unlockAt && new Date(h.meta.unlockAt).getTime()>now);
}
function fundingSources(){
  const personal=state.accounts.map(a=>({
    key:`account:${a.id}`,
    label:`${a.name} · свои средства ${money(a.balance)}`,
    kind:"account",
    ref:a
  }));
  const credit=state.debts.filter(d=>d.type==="Кредитная карта").map(d=>({
    key:`credit:${d.id}`,
    label:`${d.name} · кредитка, долг ${money(d.balance)}`,
    kind:"credit",
    ref:d
  }));
  return [...personal,...credit];
}
function sourceOptions(selected=""){
  return fundingSources().map(s=>`<option value="${s.key}" ${s.key===selected?"selected":""}>${esc(s.label)}</option>`).join("");
}
function applyExpenseToSource(sourceKey,amount){
  const [kind,refId]=String(sourceKey||"").split(":");
  if(kind==="account"){
    const a=state.accounts.find(x=>x.id===refId);
    if(!a) return {ok:false,msg:"Источник средств не найден"};
    if(Number(a.balance)<amount) return {ok:false,msg:`На «${a.name}» указано только ${money(a.balance)}.`};
    a.balance=Math.max(0,Number(a.balance)-amount);
    return {ok:true,kind:"account",name:a.name};
  }
  if(kind==="credit"){
    const d=state.debts.find(x=>x.id===refId);
    if(!d) return {ok:false,msg:"Кредитная карта не найдена"};
    d.balance=Number(d.balance)+amount;
    state.start_debt=Math.max(Number(state.start_debt||0),totalDebt(),1);
    return {ok:true,kind:"credit",name:d.name};
  }
  return {ok:false,msg:"Выбери, откуда оплачена покупка"};
}
function applyIncomeToAccount(accountId,amount){
  const a=state.accounts.find(x=>x.id===accountId);
  if(!a) return false;
  a.balance=Number(a.balance)+amount;
  return true;
}
function payDebtFromAccount(accountId,debtId,amount){
  const a=state.accounts.find(x=>x.id===accountId);
  const d=state.debts.find(x=>x.id===debtId);
  if(!a||!d) return {ok:false,msg:"Счёт или долг не найден"};
  if(amount<=0) return {ok:false,msg:"Введи сумму"};
  if(Number(a.balance)<amount) return {ok:false,msg:`На «${a.name}» только ${money(a.balance)}.`};
  const actual=Math.min(amount,Number(d.balance));
  a.balance=Number(a.balance)-actual;
  d.balance=Math.max(0,Number(d.balance)-actual);
  return {ok:true,actual,account:a,debt:d};
}
function personalFunds(){
  return state.accounts.reduce((s,a)=>s+Number(a.balance||0),0);
}
function creditCardDebt(){
  return state.debts.filter(d=>d.type==="Кредитная карта").reduce((s,d)=>s+Number(d.balance||0),0);
}
function periodBuffer(){ return Math.max(0,Number(state.buffer_per_period||0)); }
function strategyShare(){
  const mode=state.strategy_mode||"Сбалансированный";
  if(mode==="Бережный") return 0.25;
  if(mode==="Ускоренный") return 0.75;
  return Math.max(0,Math.min(1,Number(state.extra_debt_share_balanced||50)/100));
}
function freeMoneyNow(){
  return Math.max(0,personalFunds()-remainingLifeThisPeriod()-debtDueBeforeNextSalary()-periodBuffer());
}


function migrate(d){
  const out={...clone(DEFAULT),...d};
  ["categories","accounts","debts","history"].forEach(k=>{ if(!Array.isArray(out[k])) out[k]=clone(DEFAULT[k]); });
  out.categories.forEach(x=>x.id ||= id()); out.accounts.forEach(x=>x.id ||= id()); out.debts.forEach(x=>x.id ||= id());
  out.history.forEach(x=>x.id ||= id());
  out.start_debt=Math.max(Number(out.start_debt||0),totalDebtOf(out),1);
  out._updated_at=out._updated_at||"1970-01-01T00:00:00.000Z";
  return out;
}
function totalDebtOf(d){ return d.debts.reduce((s,x)=>s+Number(x.balance||0),0); }
function cacheKey(){ return user ? `fin_shturman_cache_${user.id}` : "fin_shturman_cache"; }
function nowIso(){ return new Date().toISOString(); }
function cacheState(updatedAt=state._updated_at||nowIso()){
  state._updated_at=updatedAt;
  localStorage.setItem(cacheKey(),JSON.stringify({payload:state,updated_at:updatedAt}));
}
function cachedState(){
  try{
    const raw=JSON.parse(localStorage.getItem(cacheKey())||"null");
    if(!raw)return null;
    if(raw.payload)return raw;
    return {payload:raw,updated_at:raw._updated_at||"1970-01-01T00:00:00.000Z"};
  }catch{return null}
}
function toast(msg){ const t=$("#toast"); t.textContent=msg;t.classList.remove("hidden");setTimeout(()=>t.classList.add("hidden"),2400); }
function setSync(ok=true,text=""){
  const b=$("#syncBadge"); if(!b)return;
  b.classList.toggle("offline",!ok);
  b.textContent=ok?"●":"●";
  b.setAttribute("title",text||(ok?"Сохранено в облаке":"Не синхронизировано"));
  const t=$("#syncText"); if(t)t.textContent=ok?"сохранено":"не синхр.";
}
async function saveState({silent=false}={}){
  const updatedAt=nowIso();
  state._updated_at=updatedAt;
  cacheState(updatedAt);
  if(!user || !navigator.onLine){setSync(false,"Сохранено только на устройстве");return {ok:false,local:true};}
  try{
    const {data,error}=await supabase.from("finance_state").upsert({
      user_id:user.id,payload:state,updated_at:updatedAt
    },{onConflict:"user_id"}).select("updated_at").single();
    if(error)throw error;
    const cloudTime=data?.updated_at||updatedAt;
    state._updated_at=cloudTime; cacheState(cloudTime); setSync(true,"Сохранено в Supabase");
    if(!silent) toast("Сохранено");
    return {ok:true,updated_at:cloudTime};
  }catch(error){
    console.error("saveState",error); setSync(false,"Ошибка сохранения в Supabase");
    if(!silent) toast("Не удалось сохранить в облако. Данные оставлены на устройстве.");
    return {ok:false,error};
  }
}
async function loadState(){
  const local=cachedState();
  if(local?.payload) state=migrate(local.payload);
  if(!user || !navigator.onLine){setSync(false,"Работаю с локальной копией");return;}
  try{
    const {data,error}=await supabase.from("finance_state").select("payload,updated_at").eq("user_id",user.id).maybeSingle();
    if(error)throw error;
    if(!data?.payload){
      if(local?.payload) state=migrate(local.payload); else state=migrate(clone(DEFAULT));
      await saveState({silent:true}); return;
    }
    const localTime=new Date(local?.updated_at||"1970-01-01").getTime();
    const cloudTime=new Date(data.updated_at||data.payload?._updated_at||"1970-01-01").getTime();
    if(local?.payload && localTime>cloudTime){
      state=migrate(local.payload);
      await saveState({silent:true});
    }else{
      state=migrate(data.payload); state._updated_at=data.updated_at||state._updated_at||nowIso(); cacheState(state._updated_at); setSync(true,"Загружено из Supabase");
    }
  }catch(error){
    console.error("loadState",error); setSync(false,"Не удалось загрузить облако — использую устройство");
    if(!local?.payload) state=migrate(clone(DEFAULT));
  }
}
function addHistory(kind,amount,note,meta={}){
  state.history.push({id:id(),date:new Date().toISOString(),kind,amount:Number(amount||0),note,meta});
}

function standardPlan(incoming,partNo){
  const target=priorityDebt();
  const dueDebt=debtDueBeforeNextSalary();
  const lifeNeed=remainingLifeThisPeriod();
  const reserveGap=Math.max(0,Number(state.reserve_target||0)-savings());
  const bufferGoal=periodBuffer();
  const reserveGoal=Math.min(reserveGap,partNo===1?3000:2000);
  let rem=Number(incoming); const a=[];

  let v=Math.min(rem,dueDebt);
  if(v>0){a.push(["Защитить ближайшие платежи",v]);rem-=v;}

  v=Math.min(rem,lifeNeed);
  if(v>0){a.push(["Оставить на жизнь до следующей выплаты",v]);rem-=v;}

  v=Math.min(rem,bufferGoal);
  if(v>0){a.push(["Неприкосновенный остаток до выплаты",v]);rem-=v;}

  v=Math.min(rem,reserveGoal);
  if(v>0){a.push(["Пополнить подушку",v]);rem-=v;}

  if(rem>0 && target){
    const extra=Math.min(rem*strategyShare(),Number(target.balance));
    if(extra>0){a.push([`Досрочно → ${target.name}`,extra]);rem-=extra;}
  }
  if(rem>0)a.push(["Оставить свободными",rem]);

  const mode=state.strategy_mode||"Сбалансированный";
  return {alloc:a,target,reason:`Режим «${mode}»: сначала защищаю платежи, жизнь и неприкосновенный остаток ${money(bufferGoal)}. В долг уходит только часть действительно свободных денег.`};
}
function bonusPlan(incoming){
  const target=priorityDebt();
  let dp=Number(state.bonus_debt_pct||50),rp=Number(state.bonus_reserve_pct||30),sp=Number(state.bonus_self_pct||20);
  const total=Math.max(dp+rp+sp,1); dp/=total;rp/=total;sp/=total;
  const a=[]; let debtPart=incoming*dp,reservePart=incoming*rp,selfPart=incoming*sp;
  if(target)a.push([`В долг → ${target.name}`,Math.min(debtPart,target.balance)]); else reservePart+=debtPart;
  if(reservePart>0)a.push(["В подушку / накопления",reservePart]);
  if(selfPart>0)a.push(["Оставить себе",selfPart]);
  const used=a.reduce((s,x)=>s+x[1],0); if(incoming-used>1)a.push(["Свободный остаток",incoming-used]);
  return {alloc:a,target,reason:"Премия не считается обычной зарплатой: её можно делить между долгом, накоплениями и собой."};
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
  const n=safeDaily(),target=priorityDebt(),periodBudget=monthlyLife()/2;
  const chips=["1-я часть зарплаты","2-я часть зарплаты","Премия","Отпускные","Другое"];
  const defaultAmount=selectedIncomeType==="1-я часть зарплаты"?state.salary_1:selectedIncomeType==="2-я часть зарплаты"?state.salary_2:0;
  const pauses=pendingPauses();
  const dueSoon=debtDueBeforeNextSalary();

  const categoryCards=state.categories.map(c=>{
    const budget=Number(c.monthly||0)/2;
    const spent=categorySpent(c.id);
    const left=Math.max(0,budget-spent);
    const pct=budget>0?Math.min(100,spent/budget*100):0;
    return `<div class="budget-row">
      <div class="row"><span>${esc(c.name)}</span><b>${money(left)}</b></div>
      <div class="mini-progress"><div style="width:${pct}%"></div></div>
      <div class="small muted">потрачено ${money(spent)} из ${money(budget)} до следующей выплаты</div>
    </div>`;
  }).join("");

  $("#screen-today").innerHTML=`
    <div class="grid2">
      <div class="metric metric-debt"><div class="k">Общий долг</div><div class="v">${money(debt)}</div></div>
      <div class="metric"><div class="k">Кредитные карты</div><div class="v">${money(creditCardDebt())}</div></div>
      <div class="metric metric-own"><div class="k">Свои деньги</div><div class="v">${money(personalFunds())}</div></div>
      <div class="metric metric-free"><div class="k">Свободно сейчас</div><div class="v">${money(freeMoneyNow())}</div></div>
    </div>

    <div class="card">
      <div class="row"><b>Путь к нулевому долгу</b><b>${progress.toFixed(0)}%</b></div>
      <div class="progress"><div style="width:${progress}%"></div></div>
      <div class="small muted">Было ${money(start)} → сейчас ${money(debt)}</div>
    </div>

    <div class="card cashflow-card">
      <div class="eyebrow">ДО СЛЕДУЮЩЕЙ ВЫПЛАТЫ</div>
      <div class="cashflow-big">${money(n.remaining)}</div>
      <div class="muted">осталось на повседневную жизнь на ${n.days} дн.</div>
      <div class="cashflow-grid">
        <div><span>Средний ориентир</span><b>${money(n.daily)}/день</b></div>
        <div><span>Уже потрачено</span><b>${money(n.spent)}</b></div>
        <div><span>Платежи до выплаты</span><b>${money(dueSoon)}</b></div>
        <div><span>Неприкосновенный остаток</span><b>${money(periodBuffer())}</b></div>
      </div>
      <div class="small muted" style="margin-top:10px">Дневная сумма — только ориентир. Главное — общий остаток до следующей выплаты.</div>
    </div>

    ${pauses.length?`<div class="card tip warn"><b>⏳ У тебя есть покупки на паузе: ${pauses.length}</b>
      ${pauses.slice(-3).map(h=>`<div class="small" style="margin-top:7px">${esc(h.note)} · ${money(h.amount)} · до ${new Date(h.meta.unlockAt).toLocaleString("ru-RU")}</div>`).join("")}
    </div>`:""}

    <div class="section-title"><h2>🧾 Остатки по расходам</h2></div>
    <div class="card">${categoryCards || `<div class="muted">Добавь категории расходов в «Мои деньги».</div>`}</div>

    <div class="section-title"><h2>＋ Записать расход</h2></div>
    <div class="card">
      <div class="form-grid">
        <label>Категория<select id="quickExpenseCategory">${state.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <label>Сумма<input id="quickExpenseAmount" type="number" min="0" step="100" value="0"></label>
        <label class="wide">Откуда оплачено?<select id="quickExpenseSource">${sourceOptions()}</select></label>
        <label class="wide">Комментарий<input id="quickExpenseNote" placeholder="Например: бензин"></label>
      </div>
      <button id="saveExpenseBtn" class="primary full">Записать расход</button>
    </div>

    <div class="section-title"><h2>🧭 Как распределять свободные деньги</h2></div>
    <div class="card strategy-card">
      <div class="strategy-options">
        ${["Бережный","Сбалансированный","Ускоренный"].map(x=>`<button class="strategy-btn ${(state.strategy_mode||"Сбалансированный")===x?"active":""}" data-strategy="${x}">${x}</button>`).join("")}
      </div>
      <div id="strategyDescription" class="small muted"></div>
    </div>

    <div class="section-title"><h2>💰 Мне пришли деньги</h2></div>
    <div class="chips">${chips.map(x=>`<button class="chip ${x===selectedIncomeType?"active":""}" data-income="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <div class="card">
      <div class="form-grid">
        <label class="wide">Сумма<input id="incomeAmount" type="number" min="0" step="500" value="${defaultAmount}"></label>
        <label class="wide">Куда пришли деньги?<select id="incomeAccount">${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · сейчас ${money(a.balance)}</option>`).join("")}</select></label>
        ${selectedIncomeType==="Отпускные"?`<label class="wide">Сколько планируешь на отпуск<input id="vacationBudget" type="number" min="0" step="1000" value="0"></label>`:""}
        ${selectedIncomeType==="Другое"?`<label class="wide">Что хочешь сделать<select id="otherPurpose"><option>Пока не знаю</option><option>Сохранить на цель</option><option>В подушку</option><option>В долг</option></select></label>`:""}
      </div>
      <div id="incomePlanBox"></div>
      <button id="saveIncomeBtn" class="primary full" style="margin-top:10px">Записать поступление и план</button>
    </div>

    <div class="card">
      <h2>↔️ Перенаправить деньги</h2>
      <p class="small muted">Например: с личной карты погасить кредитку или кредит. ФинШтурман сразу уменьшит и деньги на счёте, и долг.</p>
      <div class="form-grid">
        <label>Откуда<select id="payFromAccount">${state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance)}</option>`).join("")}</select></label>
        <label>Куда<select id="payToDebt">${state.debts.filter(d=>Number(d.balance)>0).map(d=>`<option value="${d.id}">${esc(d.name)} · долг ${money(d.balance)}</option>`).join("")}</select></label>
        <label class="wide">Сумма<input id="payDebtAmount" type="number" min="0" step="500" value="0"></label>
      </div>
      <button id="payDebtBtn" class="primary full">Погасить долг из своих средств</button>
    </div>

    <div class="card impulse-card">
      <h2>🛍️ Хочу купить</h2>
      <p class="small muted">Не запрещаю покупку — показываю её цену для твоего плана и создаю паузу, если сумма крупная.</p>
      <div class="form-grid">
        <label class="wide">Что хочешь купить?<input id="purchaseName" placeholder="Например: одежда"></label>
        <label>Категория<select id="purchaseCategory">${state.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <label>Стоимость<input id="purchasePrice" type="number" min="0" step="500" value="0"></label>
        <label class="wide">Чем оплачиваешь?<select id="purchaseSource">${sourceOptions()}</select></label>
      </div>
      <div id="purchaseAdvice" class="notice" style="margin:10px 0">Введи сумму — я покажу последствия.</div>
      <div id="purchaseActions" class="grid2">
        <button id="delayPurchase">⏳ Пауза ${state.impulse_pause_hours||72} ч</button>
        <button id="boughtPurchase">Купила</button>
      </div>
      <div id="purchaseConfirm" class="hidden" style="margin-top:10px">
        <div class="notice warning">Покупка крупнее безопасного ориентира. Если решение всё ещё осознанное, можно записать её вторым нажатием.</div>
        <button id="confirmBought" class="danger full">Да, всё равно записать покупку</button>
      </div>
    </div>
  `;

  $("#saveExpenseBtn").onclick=async()=>{
    const amount=Number($("#quickExpenseAmount").value||0);
    if(amount<=0)return toast("Введи сумму расхода");
    const categoryId=$("#quickExpenseCategory").value;
    const cat=state.categories.find(c=>c.id===categoryId);
    const sourceKey=$("#quickExpenseSource").value;
    const applied=applyExpenseToSource(sourceKey,amount);
    if(!applied.ok)return toast(applied.msg);
    addHistory("Расход",-amount,$("#quickExpenseNote").value||cat?.name||"Расход",{
      categoryId,categoryName:cat?.name||"",sourceKey,sourceName:applied.name,sourceKind:applied.kind
    });
    await saveState();renderToday();renderMoney();renderHistory();
    toast(applied.kind==="credit"?"Расход записан — долг по кредитке вырос":"Расход списан из своих средств");
  };

  const strategyText={
    "Бережный":"Около 25% действительно свободных денег — в досрочное погашение. Больше остаётся у тебя.",
    "Сбалансированный":"Около 50% действительно свободных денег — в долг, остальное остаётся свободным.",
    "Ускоренный":"До 75% действительно свободных денег — в долг, но жизнь, платежи и резерв всё равно защищены."
  };
  if($("#strategyDescription"))$("#strategyDescription").textContent=strategyText[state.strategy_mode||"Сбалансированный"];
  $$("[data-strategy]").forEach(b=>b.onclick=async()=>{
    state.strategy_mode=b.dataset.strategy;
    await saveState({silent:true});
    renderToday();renderMoney();
  });

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
    const accountId=$("#incomeAccount").value;
    const account=state.accounts.find(a=>a.id===accountId);
    if(!applyIncomeToAccount(accountId,v))return toast("Не найден счёт для поступления");
    const p=incomePlan(selectedIncomeType,v,Number(vac?.value||0),purpose?.value);
    addHistory(selectedIncomeType,v,`Деньги пришли на «${account?.name||"счёт"}». Помощник сформировал план распределения.`,{
      allocations:p.alloc,reason:p.reason,accountId,accountName:account?.name||""
    });
    await saveState();renderToday();renderMoney();renderHistory();toast("Поступление добавлено на счёт");
  };

  $("#payDebtBtn").onclick=async()=>{
    const accountId=$("#payFromAccount").value;
    const debtId=$("#payToDebt").value;
    const v=Number($("#payDebtAmount").value||0);
    const r=payDebtFromAccount(accountId,debtId,v);
    if(!r.ok)return toast(r.msg);
    addHistory("Погашение долга",-r.actual,`${r.account.name} → ${r.debt.name}`,{
      sourceName:r.account.name,debtName:r.debt.name,debtId:r.debt.id
    });
    await saveState();renderToday();renderMoney();renderHistory();
    toast(`Долг уменьшен на ${money(r.actual)}`);
  };

  const price=$("#purchasePrice"),advice=$("#purchaseAdvice");
  function purchaseAnalysis(){
    const v=Number(price.value||0);
    if(!v){advice.innerHTML="Введи сумму — я покажу последствия.";return {large:false};}
    const categoryId=$("#purchaseCategory").value;
    const cat=state.categories.find(c=>c.id===categoryId);
    const sourceKey=$("#purchaseSource").value;
    const source=fundingSources().find(s=>s.key===sourceKey);
    const catBudget=Number(cat?.monthly||0)/2;
    const catLeft=Math.max(0,catBudget-categorySpent(categoryId));
    const large=v>Math.max(n.daily*2,catLeft*.35);
    const t=priorityDebt();
    let html=`<b>${large?"⚠️ Покупка крупная для текущего периода":"✓ Покупка не выглядит критичной по размеру"}</b><br>`;
    html+=`Безопасный ориентир сегодня: ${money(n.daily)}. В категории «${esc(cat?.name||"") }» до выплаты осталось ${money(catLeft)}.`;
    if(source?.kind==="credit") html+=`<br><b>Оплата с кредитки увеличит долг на ${money(v)}.</b>`;
    if(source?.kind==="account") html+=`<br>После покупки на «${esc(source.ref.name)}» останется примерно ${money(Math.max(0,Number(source.ref.balance)-v))}.`;
    if(t){
      const extra=Math.max(1,state.salary_total-monthlyLife()-mandatoryDebt());
      const delayDays=Math.max(1,Math.round(v/extra*30));
      html+=`<br>Если вместо покупки направить ${money(v)} в «${esc(t.name)}», его остаток станет около ${money(Math.max(0,t.balance-v))}. По текущему темпу это примерно ${delayDays} дн. финансового прогресса.`;
    }
    advice.innerHTML=html;
    return {large,categoryId,cat};
  }
  price.oninput=purchaseAnalysis;
  $("#purchaseCategory").onchange=purchaseAnalysis;

  $("#delayPurchase").onclick=async()=>{
    const v=Number(price.value||0);if(!v)return toast("Введи стоимость");
    const categoryId=$("#purchaseCategory").value,cat=state.categories.find(c=>c.id===categoryId);
    const hours=Number(state.impulse_pause_hours||72);
    const unlockAt=new Date(Date.now()+hours*3600000).toISOString();
    addHistory("Отложила покупку",v,$("#purchaseName").value||"Покупка",{categoryId,categoryName:cat?.name||"",unlockAt});
    await saveState();renderToday();renderHistory();toast(`Поставила паузу на ${hours} ч`);
  };
  $("#boughtPurchase").onclick=async()=>{
    const v=Number(price.value||0);if(!v)return toast("Введи стоимость");
    const a=purchaseAnalysis();
    if(a.large){$("#purchaseConfirm").classList.remove("hidden");return;}
    await recordPurchase();
  };
  $("#confirmBought").onclick=recordPurchase;

  async function recordPurchase(){
    const v=Number(price.value||0);if(!v)return;
    const categoryId=$("#purchaseCategory").value,cat=state.categories.find(c=>c.id===categoryId);
    const sourceKey=$("#purchaseSource").value;
    const applied=applyExpenseToSource(sourceKey,v);
    if(!applied.ok)return toast(applied.msg);
    addHistory("Покупка",-v,$("#purchaseName").value||"Покупка",{
      categoryId,categoryName:cat?.name||"",sourceKey,sourceName:applied.name,sourceKind:applied.kind
    });
    await saveState();renderToday();renderMoney();renderHistory();
    toast(applied.kind==="credit"?"Покупка записана — долг по кредитке вырос":"Покупка списана из своих средств");
  }
}

function renderMoney(){
  $("#screen-money").innerHTML=`
    <div class="card tip good"><b>💾 Автосохранение включено</b><div class="small muted">Изменения сохраняются на устройстве автоматически и синхронизируются с Supabase. Для уверенности можно также нажать «Сохранить сейчас».</div></div>
    <div class="section-title"><h2>Зарплата</h2></div>
    <div class="card form-grid">
      <label class="wide">Всего в месяц<input data-root="salary_total" type="number" value="${state.salary_total}"></label>
      <label>1-я часть<input data-root="salary_1" type="number" value="${state.salary_1}"></label>
      <label>2-я часть<input data-root="salary_2" type="number" value="${state.salary_2}"></label>
      <label>День 1-й выплаты<input data-root="salary_day_1" type="number" min="1" max="31" value="${state.salary_day_1}"></label>
      <label>День 2-й выплаты<input data-root="salary_day_2" type="number" min="1" max="31" value="${state.salary_day_2}"></label>
    </div>

    <div class="section-title"><h2>Моя стратегия</h2></div>
    <div class="card form-grid">
      <label class="wide">Режим<select data-root-text="strategy_mode">
        ${["Бережный","Сбалансированный","Ускоренный"].map(x=>`<option ${x===(state.strategy_mode||"Сбалансированный")?"selected":""}>${x}</option>`).join("")}
      </select></label>
      <label class="wide">Неприкосновенный остаток до следующей выплаты<input data-root="buffer_per_period" type="number" min="0" step="500" value="${state.buffer_per_period||5000}"></label>
      <label class="wide">В долг из свободных денег в сбалансированном режиме, %<input data-root="extra_debt_share_balanced" type="number" min="0" max="100" value="${state.extra_debt_share_balanced||50}"></label>
    </div>

    <div class="section-title"><h2>Премия</h2></div>
    <div class="card form-grid">
      <label>В долг, %<input data-root="bonus_debt_pct" type="number" value="${state.bonus_debt_pct}"></label>
      <label>В подушку, %<input data-root="bonus_reserve_pct" type="number" value="${state.bonus_reserve_pct}"></label>
      <label>Себе, %<input data-root="bonus_self_pct" type="number" value="${state.bonus_self_pct}"></label>
      <label>Цель подушки<input data-root="reserve_target" type="number" value="${state.reserve_target}"></label>
      <label class="wide">Пауза перед крупной покупкой, часов<input data-root="impulse_pause_hours" type="number" min="1" max="168" value="${state.impulse_pause_hours||72}"></label>
    </div>

    <div class="section-title"><h2>Обычные расходы</h2><button id="addCategory">＋</button></div>
    <div id="categoryList">${state.categories.map(c=>categoryHtml(c)).join("")}</div>

    <div class="section-title"><h2>Деньги и накопления</h2><button id="addAccount">＋</button></div>
    <div id="accountList">${state.accounts.map(a=>accountHtml(a)).join("")}</div>

    <div class="section-title"><h2>Долги</h2><button id="addDebt">＋</button></div>
    <div id="debtList">${state.debts.map(d=>debtHtml(d)).join("")}</div>

    <button id="saveAllBtn" class="primary full" style="margin-top:16px">💾 Сохранить сейчас</button>
    <div class="notice">Используй условные названия: «Карта 1», «Вклад», «Кредитка». Номера карт не нужны.</div>
  `;

  function harvestMoneyForm(){
    $$("[data-root]").forEach(el=>state[el.dataset.root]=Number(el.value||0));
    $$("[data-root-text]").forEach(el=>state[el.dataset.rootText]=el.value);
    state.categories.forEach(c=>{
      const base=`[data-cat-id="${c.id}"]`; const el=$(base); if(!el)return;
      c.name=$(`${base} [data-f="name"]`).value;c.monthly=Number($(`${base} [data-f="monthly"]`).value||0);c.priority=$(`${base} [data-f="priority"]`).value;
    });
    state.accounts.forEach(a=>{
      const base=`[data-account-id="${a.id}"]`; const el=$(base); if(!el)return;
      a.name=$(`${base} [data-f="name"]`).value;a.balance=Number($(`${base} [data-f="balance"]`).value||0);a.type=$(`${base} [data-f="type"]`).value;
    });
    state.debts.forEach(d=>{
      const base=`[data-debt-id="${d.id}"]`; const el=$(base); if(!el)return;
      d.name=$(`${base} [data-f="name"]`).value;d.balance=Number($(`${base} [data-f="balance"]`).value||0);d.payment=Number($(`${base} [data-f="payment"]`).value||0);d.apr=Number($(`${base} [data-f="apr"]`).value||0);d.type=$(`${base} [data-f="type"]`).value;d.due_day=Number($(`${base} [data-f="due_day"]`).value||25);
    });
    state.start_debt=Math.max(Number(state.start_debt||0),totalDebt(),1);
  }
  let autoSaveTimer=null;
  function scheduleAutoSave(){
    clearTimeout(autoSaveTimer); harvestMoneyForm(); cacheState(); setSync(false,"Ожидает синхронизации");
    autoSaveTimer=setTimeout(async()=>{await saveState({silent:true}); renderToday();},700);
  }
  $("#screen-money").querySelectorAll("input,select").forEach(el=>{
    el.addEventListener("input",scheduleAutoSave); el.addEventListener("change",scheduleAutoSave);
  });

  $("#addCategory").onclick=async()=>{harvestMoneyForm();state.categories.push({id:id(),name:"Новый расход",monthly:0,priority:"Обычно"});await saveState({silent:true});renderMoney();};
  $("#addAccount").onclick=async()=>{harvestMoneyForm();state.accounts.push({id:id(),name:"Новый счёт",type:"Карта",balance:0});await saveState({silent:true});renderMoney();};
  $("#addDebt").onclick=async()=>{harvestMoneyForm();state.debts.push({id:id(),name:"Новый долг",type:"Кредит",balance:0,apr:0,payment:0,due_day:25});await saveState({silent:true});renderMoney();};

  $$("[data-delete-category]").forEach(b=>b.onclick=async()=>{harvestMoneyForm();state.categories=state.categories.filter(x=>x.id!==b.dataset.deleteCategory);await saveState({silent:true});renderMoney();renderToday();});
  $$("[data-delete-account]").forEach(b=>b.onclick=async()=>{harvestMoneyForm();state.accounts=state.accounts.filter(x=>x.id!==b.dataset.deleteAccount);await saveState({silent:true});renderMoney();renderToday();});
  $$("[data-delete-debt]").forEach(b=>b.onclick=async()=>{harvestMoneyForm();state.debts=state.debts.filter(x=>x.id!==b.dataset.deleteDebt);await saveState({silent:true});renderMoney();renderToday();});

  $("#saveAllBtn").onclick=async()=>{
    harvestMoneyForm();
    addHistory("Настройки обновлены",0,"Изменены доходы, расходы, счета или долги.");
    const r=await saveState({silent:true});
    renderToday();renderHistory();
    toast(r.ok?"Сохранено в Supabase":"Сохранено на устройстве, но облачная синхронизация не удалась");
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
  return `<div class="history-item"><div class="history-head"><div><b>${esc(h.kind)}</b><div class="small muted">${isNaN(d)?esc(h.date):d.toLocaleString("ru-RU")} · ${esc(h.note)}${h.meta?.categoryName?` · ${esc(h.meta.categoryName)}`:""}${h.meta?.sourceName?` · ${esc(h.meta.sourceName)}`:""}</div></div><div class="history-amount">${amt?`${amt>0?"+":""}${money(amt)}`:""}</div></div>
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
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"&&user)saveState({silent:true});});
window.addEventListener("pagehide",()=>{if(user){cacheState();saveState({silent:true});}});

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.error));
init();
