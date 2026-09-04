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
    {id:"d1",name:"Единый кредит",type:"Кредит",balance:460000,apr:0,payment:16900,due_day:25,
      loan_start:"2026-08-15",first_payment_date:"2026-09-25",term_months:36,payment_type:"Аннуитетный",scheduled_end:"2029-08-25"},
    {id:"d2",name:"Кредитка 1",type:"Кредитная карта",balance:90000,apr:0,payment:0,due_day:20,grace_enabled:true,grace_end:"2026-10-31",post_grace_apr:39.9}
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
  const grace=urgentGraceCard();
  if(grace)return grace;
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
function parseDateOnly(s){
  if(!s)return null;
  const d=new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime())?null:d;
}
function nextScheduledPaymentDate(debt){
  const first=parseDateOnly(debt.first_payment_date);
  const now=new Date();
  if(first && first>now)return first;
  if(!debt.due_day)return null;
  return nextOccurrence(debt.due_day).date;
}
function scheduledEndDate(debt){
  const explicit=parseDateOnly(debt.scheduled_end);
  if(explicit)return explicit;
  const start=parseDateOnly(debt.loan_start);
  if(start && Number(debt.term_months)>0){
    const d=new Date(start);
    d.setMonth(d.getMonth()+Number(debt.term_months));
    return d;
  }
  return null;
}
function daysBetweenNow(d){
  if(!d)return null;
  return Math.ceil((d.getTime()-Date.now())/86400000);
}
function timelineEvents(){
  const events=[];
  const s1=nextOccurrence(state.salary_day_1);
  const s2=nextOccurrence(state.salary_day_2);
  events.push({date:s1.date,type:"income",title:"1-я часть зарплаты",amount:Number(state.salary_1||0)});
  events.push({date:s2.date,type:"income",title:"2-я часть зарплаты",amount:Number(state.salary_2||0)});

  state.debts.filter(d=>Number(d.balance)>0).forEach(d=>{
    if(d.type==="Кредит"){
      const pd=nextScheduledPaymentDate(d);
      if(pd)events.push({date:pd,type:"debt",title:d.name,amount:Number(d.payment||0)});
    }
    if(d.type==="Кредитная карта"){
      const dl=graceDeadline(d);
      if(dl && dl>Date.now())events.push({date:dl,type:"grace",title:`${d.name} — конец 0%`,amount:Number(d.balance||0)});
      const pd=nextScheduledPaymentDate(d);
      if(pd && Number(d.payment||0)>0)events.push({date:pd,type:"debt",title:`${d.name} — мин. платёж`,amount:Number(d.payment||0)});
    }
  });
  return events.sort((a,b)=>a.date-b.date).slice(0,6);
}
function scheduledPaymentsBefore(date){
  if(!date)return 0;
  return state.debts.filter(d=>Number(d.balance)>0).reduce((sum,d)=>{
    const pd=nextScheduledPaymentDate(d);
    return pd && pd<=date ? sum+Number(d.payment||0) : sum;
  },0);
}

function debtDueBeforeNextSalary(){
  const n=nextSalary();
  return state.debts.filter(x=>Number(x.balance)>0).reduce((sum,x)=>{
    const pd=nextScheduledPaymentDate(x);
    return pd && pd<=n.date ? sum+Number(x.payment||0) : sum;
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
function graceDeadline(debt){
  if(!debt?.grace_enabled || !debt.grace_end)return null;
  const d=new Date(`${debt.grace_end}T23:59:59`);
  return Number.isNaN(d.getTime())?null:d;
}
function daysUntilDate(d){
  if(!d)return null;
  return Math.ceil((d.getTime()-Date.now())/86400000);
}
function salaryPaymentsUntil(deadline){
  if(!deadline)return 0;
  let count=0;
  let cursor=new Date();
  for(let i=0;i<24;i++){
    const y=cursor.getFullYear(),m=cursor.getMonth();
    for(const day of [Number(state.salary_day_1),Number(state.salary_day_2)]){
      const maxDay=new Date(y,m+1,0).getDate();
      const dt=new Date(y,m,Math.min(day,maxDay),12,0,0);
      if(dt>Date.now() && dt<=deadline)count++;
    }
    cursor=new Date(y,m+1,1);
    if(cursor>deadline)break;
  }
  return count;
}
function activeGraceCards(){
  return state.debts.filter(d=>{
    const dl=graceDeadline(d);
    return d.type==="Кредитная карта" && Number(d.balance)>0 && dl && dl>Date.now();
  }).sort((a,b)=>graceDeadline(a)-graceDeadline(b));
}
function graceReserveNeededPerPayment(debt){
  const dl=graceDeadline(debt);
  const n=Math.max(1,salaryPaymentsUntil(dl));
  return Number(debt.balance||0)/n;
}
function urgentGraceCard(){
  const cards=activeGraceCards();
  return cards[0]||null;
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
  out.categories.forEach(x=>{
    x.id ||= id();
    const n=String(x.name||"").toLowerCase();
    if(x.kind===undefined){
      x.kind=(n.includes("интернет")||n.includes("связ")||n.includes("жкх")||n.includes("телефон"))?"Обязательный платеж":"Повседневные";
    }
    if(x.due_day===undefined){
      x.due_day=n.includes("интернет")||n.includes("связ")?21:0;
    }
  });
  out.accounts.forEach(x=>x.id ||= id());
  out.debts.forEach(x=>{
    x.id ||= id();
    if(x.grace_enabled===undefined)x.grace_enabled=false;
    if(x.grace_end===undefined)x.grace_end="";
    if(x.post_grace_apr===undefined)x.post_grace_apr=Number(x.apr||0);
    if(x.loan_start===undefined)x.loan_start="";
    if(x.first_payment_date===undefined)x.first_payment_date="";
    if(x.term_months===undefined)x.term_months=0;
    if(x.payment_type===undefined)x.payment_type="Аннуитетный";
    if(x.scheduled_end===undefined)x.scheduled_end="";
  });
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


function addMonthsToDate(base,months){
  const d=new Date(base);
  d.setDate(1);
  d.setMonth(d.getMonth()+months);
  return d;
}
function strategyShareByName(mode){
  if(mode==="Бережный")return 0.25;
  if(mode==="Ускоренный")return 0.75;
  return Math.max(0,Math.min(1,Number(state.extra_debt_share_balanced||50)/100));
}
function forecastDebtPayoff(mode=state.strategy_mode||"Сбалансированный"){
  let debts=state.debts
    .filter(d=>Number(d.balance||0)>0)
    .map(d=>({
      id:d.id,name:d.name,type:d.type,
      balance:Number(d.balance||0),
      apr:Number(d.apr||0),
      payment:Number(d.payment||0),
      grace_enabled:Boolean(d.grace_enabled),
      grace_end:d.grace_end||"",
      post_grace_apr:Number(d.post_grace_apr||0)
    }));

  if(!debts.length)return {ok:true,months:0,totalInterest:0,totalPaid:0,finish:new Date(),rows:[],warning:""};

  const salary=Number(state.salary_total||0);
  const life=monthlyLife();
  const rollingBuffer=periodBuffer()*2;
  let reserve=savings();
  const reserveTarget=Number(state.reserve_target||0);
  const share=strategyShareByName(mode);

  let months=0,totalInterest=0,totalPaid=0;
  const rows=[];
  let warning="";
  const hasMissingRates=debts.some(d=>{
    if(d.type==="Кредитная карта" && d.grace_enabled)return Number(d.post_grace_apr||0)<=0;
    return Number(d.apr||0)<=0;
  });

  while(debts.some(d=>d.balance>0.01) && months<360){
    months++;

    // Until the emergency fund reaches its target, reserve a modest 5k/month.
    const reserveNeed=Math.max(0,reserveTarget-reserve);
    const reserveContribution=Math.min(5000,reserveNeed);

    // Mandatory payments are part of the amount available for debt, not an additional household expense.
    const mandatory=debts.reduce((s,d)=>s+Math.min(d.balance,Math.max(0,d.payment)),0);

    // Money left after ordinary life, planned reserve top-up and a rolling cash buffer.
    const afterProtection=Math.max(0,salary-life-reserveContribution-rollingBuffer);

    if(afterProtection+0.01 < mandatory){
      return {
        ok:false,
        months:null,
        totalInterest,
        totalPaid,
        finish:null,
        rows,
        warning:`При текущих вводных после жизни, подушки и резерва остаётся ${money(afterProtection)}, а минимальные платежи составляют ${money(mandatory)}. Сначала нужно скорректировать бюджет или платежи.`
      };
    }

    const extraFree=Math.max(0,afterProtection-mandatory);
    const extraBudget=extraFree*share;
    let debtBudget=mandatory+extraBudget;

    // Interest accrues first. Grace cards use 0% until their deadline,
    // then switch to post-grace APR.
    const simulatedDate=addMonthsToDate(new Date(),months-1);
    debts.forEach(d=>{
      if(d.balance<=0)return;
      let effectiveApr=Math.max(0,Number(d.apr||0));
      if(d.type==="Кредитная карта" && d.grace_enabled && d.grace_end){
        const deadline=new Date(`${d.grace_end}T23:59:59`);
        effectiveApr=simulatedDate<=deadline?0:Math.max(0,Number(d.post_grace_apr||0));
      }
      const monthlyRate=effectiveApr/100/12;
      const interest=d.balance*monthlyRate;
      d.balance+=interest;
      totalInterest+=interest;
    });

    // Pay minimums.
    let remainingBudget=debtBudget;
    debts.forEach(d=>{
      if(d.balance<=0||remainingBudget<=0)return;
      const p=Math.min(d.balance,Math.max(0,d.payment),remainingBudget);
      d.balance-=p;remainingBudget-=p;totalPaid+=p;
    });

    // Extra goes to highest APR; when rates are missing, credit cards go first.
    const order=[...debts].sort((a,b)=>{
      const simDate=addMonthsToDate(new Date(),months-1);
      const aGrace=a.grace_enabled&&a.grace_end&&simDate<=new Date(`${a.grace_end}T23:59:59`);
      const bGrace=b.grace_enabled&&b.grace_end&&simDate<=new Date(`${b.grace_end}T23:59:59`);
      if(aGrace!==bGrace)return bGrace-aGrace;
      if(aGrace&&bGrace)return new Date(a.grace_end)-new Date(b.grace_end);
      const aApr=a.grace_enabled&&a.grace_end&&simDate>new Date(`${a.grace_end}T23:59:59`)?Number(a.post_grace_apr||0):Number(a.apr||0);
      const bApr=b.grace_enabled&&b.grace_end&&simDate>new Date(`${b.grace_end}T23:59:59`)?Number(b.post_grace_apr||0):Number(b.apr||0);
      const aprDiff=bApr-aApr;
      if(Math.abs(aprDiff)>0.0001)return aprDiff;
      if(a.type!==b.type)return b.type==="Кредитная карта"?1:-1;
      return b.balance-a.balance;
    });
    for(const d of order){
      if(remainingBudget<=0)break;
      if(d.balance<=0)continue;
      const p=Math.min(d.balance,remainingBudget);
      d.balance-=p;remainingBudget-=p;totalPaid+=p;
    }

    reserve+=reserveContribution;

    if(months===1 || months%6===0 || !debts.some(d=>d.balance>0.01)){
      rows.push({
        month:months,
        debt:debts.reduce((s,d)=>s+Math.max(0,d.balance),0),
        reserve
      });
    }
  }

  if(months>=360 && debts.some(d=>d.balance>0.01)){
    return {ok:false,months:null,totalInterest,totalPaid,finish:null,rows,warning:"При текущем темпе долг не закрывается в пределах 30 лет. Проверь ставки, платежи и бюджет."};
  }

  if(hasMissingRates){
    warning="У части долгов ставка не заполнена. Для них прогноз считает 0% и поэтому может показать слишком раннюю дату.";
  }

  return {
    ok:true,
    months,
    totalInterest,
    totalPaid,
    finish:addMonthsToDate(new Date(),months),
    rows,
    warning
  };
}
function humanMonths(months){
  if(months===0)return "уже закрыты";
  const y=Math.floor(months/12),m=months%12;
  const parts=[];
  if(y)parts.push(`${y} г.`);
  if(m)parts.push(`${m} мес.`);
  return parts.join(" ");
}

function standardPlan(incoming,partNo){
  const target=priorityDebt();
  const grace=urgentGraceCard();
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

  if(grace && rem>0){
    const graceQuota=Math.min(rem,graceReserveNeededPerPayment(grace),Number(grace.balance));
    if(graceQuota>0){
      a.push([`Погасить кредитку до ${new Date(grace.grace_end+"T00:00:00").toLocaleDateString("ru-RU")}`,graceQuota]);
      rem-=graceQuota;
    }
  }

  v=Math.min(rem,bufferGoal);
  if(v>0){a.push(["Неприкосновенный остаток до выплаты",v]);rem-=v;}

  v=Math.min(rem,reserveGoal);
  if(v>0){a.push(["Пополнить подушку",v]);rem-=v;}

  if(rem>0 && target){
    const extra=Math.min(rem*strategyShare(),Number(target.balance));
    if(extra>0){a.push([`Досрочно → ${target.name}`,extra]);rem-=extra;}
  }
  if(rem>0){
    if(totalDebt()<=0)a.push(["В накопления / цели",rem]);
    else a.push(["Оставить свободными",rem]);
  }

  const mode=state.strategy_mode||"Сбалансированный";
  const graceText=grace?` Отдельно резервирую сумму для кредитки «${grace.name}», чтобы успеть закрыть её до конца льготного периода.`:"";
  return {alloc:a,target,reason:`Режим «${mode}»: сначала защищаю платежи, жизнь и обязательный резерв. В долг уходит только часть действительно свободных денег.${graceText}`};
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


function monthStart(){
  const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),1,0,0,0);
}
function monthEnd(){
  const d=new Date(); return new Date(d.getFullYear(),d.getMonth()+1,1,0,0,0);
}
function categorySpentMonth(categoryId){
  const a=monthStart(),b=monthEnd();
  return state.history.filter(h=>{
    const d=new Date(h.date);
    return d>=a && d<b && Number(h.amount)<0 &&
      ["Покупка","Расход"].includes(h.kind) && h.meta?.categoryId===categoryId;
  }).reduce((s,h)=>s+Math.abs(Number(h.amount||0)),0);
}
function fixedCategories(){
  return state.categories.filter(c=>c.kind==="Обязательный платеж" || Number(c.due_day)>0);
}
function flexibleCategories(){
  return state.categories.filter(c=>!(c.kind==="Обязательный платеж" || Number(c.due_day)>0));
}
function flexibleMonthlyBudget(){
  return flexibleCategories().reduce((s,c)=>s+Number(c.monthly||0),0);
}
function nextCategoryDue(c){
  if(!Number(c.due_day))return null;
  return nextOccurrence(Number(c.due_day)).date;
}
function fixedBillsOpen(){
  return fixedCategories().map(c=>{
    const spent=categorySpentMonth(c.id);
    const total=Number(c.monthly||0);
    const left=Math.max(0,total-spent);
    const due=nextCategoryDue(c);
    return {c,total,spent,left,due,days:due?Math.max(0,daysBetweenNow(due)):999};
  }).filter(x=>x.left>0).sort((a,b)=>a.days-b.days);
}
function smartTodayPlan(){
  let available=personalFunds();
  const rows=[];

  for(const x of fixedBillsOpen()){
    if(available<=0)break;
    const reserve=Math.min(available,x.left);
    rows.push({
      icon:"◉",tone:"pink",
      title:`Отложить на ${x.c.name}`,
      detail:`Оплатить до ${x.due.toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}`,
      amount:reserve,
      note:`осталось ${x.days} дн.`
    });
    available-=reserve;
  }

  const next=nextSalary();
  const flexibleHalf=Math.max(0,flexibleMonthlyBudget()/2);
  const spentFlex=state.history.filter(h=>{
    const d=new Date(h.date);
    return d>=currentPeriod().start && d<currentPeriod().end && Number(h.amount)<0 &&
      ["Покупка","Расход"].includes(h.kind) &&
      flexibleCategories().some(c=>c.id===h.meta?.categoryId);
  }).reduce((s,h)=>s+Math.abs(Number(h.amount||0)),0);
  const lifeNeed=Math.max(0,flexibleHalf-spentFlex);
  if(lifeNeed>0 && available>0){
    const v=Math.min(available,lifeNeed);
    rows.push({icon:"◉",tone:"blue",title:"Оставить на жизнь",detail:`До следующей зарплаты · ${next.date.toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}`,amount:v,note:`на ${next.days} дн.`});
    available-=v;
  }

  const grace=urgentGraceCard();
  if(grace && available>0){
    const quota=Math.min(available,graceReserveNeededPerPayment(grace),Number(grace.balance));
    if(quota>0){
      rows.push({
        icon:"◉",tone:"orange",
        title:`Погасить ${grace.name}`,
        detail:`0% до ${graceDeadline(grace).toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}`,
        amount:quota,note:"приоритет по дедлайну"
      });
      available-=quota;
    }
  }

  // Do not reserve a normal loan if another salary arrives before its payment.
  const loan=state.debts.filter(d=>d.type==="Кредит"&&Number(d.balance)>0)
    .sort((a,b)=>nextScheduledPaymentDate(a)-nextScheduledPaymentDate(b))[0];
  if(loan){
    const pd=nextScheduledPaymentDate(loan);
    const salaryBefore=pd && [nextOccurrence(state.salary_day_1),nextOccurrence(state.salary_day_2)]
      .some(x=>x.date<pd);
    if(!salaryBefore && pd && available>0){
      const v=Math.min(available,Number(loan.payment||0));
      if(v>0){
        rows.push({icon:"◉",tone:"purple",title:`Отложить на ${loan.name}`,detail:`Платёж ${pd.toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}`,amount:v,note:"обязательный платёж"});
        available-=v;
      }
    }
  }

  if(totalDebt()<=0 && available>0){
    rows.push({icon:"◉",tone:"green",title:"Перевести в накопления",detail:"Долги закрыты — теперь свободный поток работает на твою подушку и цели",amount:available,note:"следующий этап"});
    available=0;
  }else if(available>0){
    rows.push({icon:"◉",tone:"gray",title:"Свободные деньги",detail:"Не нужно распределять всё сразу — можно оставить резервом",amount:available,note:"можно не трогать"});
  }
  return rows.slice(0,5);
}
function calendarMini(){
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  const first=new Date(y,m,1);
  const days=new Date(y,m+1,0).getDate();
  const monday=(first.getDay()+6)%7;
  const salaryDays=new Set([Number(state.salary_day_1),Number(state.salary_day_2)]);
  const debtDays=new Set(state.debts.filter(d=>Number(d.balance)>0).map(d=>Number(d.due_day||0)));
  const billDays=new Set(fixedCategories().map(c=>Number(c.due_day||0)));
  const graceDays=new Set(state.debts.filter(d=>Number(d.balance)>0&&d.grace_enabled&&d.grace_end).map(d=>parseDateOnly(d.grace_end)).filter(d=>d&&d.getMonth()===m&&d.getFullYear()===y).map(d=>d.getDate()));
  let cells="";
  for(let i=0;i<monday;i++)cells+=`<span class="cal-empty"></span>`;
  for(let d=1;d<=days;d++){
    let dots="";
    if(salaryDays.has(d))dots+=`<i class="dot income"></i>`;
    if(billDays.has(d))dots+=`<i class="dot bill"></i>`;
    if(debtDays.has(d))dots+=`<i class="dot debt"></i>`;
    if(graceDays.has(d))dots+=`<i class="dot grace"></i>`;
    cells+=`<button class="cal-day ${d===now.getDate()?"today":""}" data-cal-day="${d}" aria-label="Открыть ${d} число"><b>${d}</b><em>${dots}</em></button>`;
  }
  return `<div class="cal-head"><b>${now.toLocaleDateString("ru-RU",{month:"long",year:"numeric"})}</b><span>нажми на дату</span></div>
  <div class="cal-week"><i>Пн</i><i>Вт</i><i>Ср</i><i>Чт</i><i>Пт</i><i>Сб</i><i>Вс</i></div>
  <div class="cal-grid">${cells}</div>`;
}

function dailyFreedomMessage(isDebtPhase=true){
  const debtMessages=[
    "Ещё один шаг к нулю.",
    "Долг уменьшается — ты ближе.",
    "Главное — продолжать.",
    "Каждый платёж работает на тебя.",
    "Сегодня достаточно одного шага.",
    "Минус долг — плюс свобода.",
    "Ты уже ближе, чем вчера.",
    "Маленькие шаги дают результат.",
    "Спокойно. План работает.",
    "Каждый рубль приближает свободу.",
    "Не спеши — двигайся стабильно.",
    "Ты уменьшаешь долг каждый месяц.",
    "Финиш становится ближе.",
    "Сегодня — ещё немного вперёд."
  ];
  const savingsMessages=[
    "Теперь деньги работают на тебя.",
    "Подушка растёт — свободы больше.",
    "Копишь не деньги, а спокойствие.",
    "Каждый взнос укрепляет запас.",
    "Теперь цель — рост, не долг.",
    "Накопления растут шаг за шагом.",
    "Финансовый запас уже строится.",
    "Свобода теперь только растёт.",
    "Каждый рубль остаётся у тебя.",
    "Ты строишь запас на будущее."
  ];

  const d=new Date();
  const key=d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();
  const arr=isDebtPhase?debtMessages:savingsMessages;
  return arr[key % arr.length];
}

function debtJourneyMarkup(){
  const debt=totalDebt();
  const start=Math.max(Number(state.start_debt||0),debt,1);
  if(debt<=0){
    const saved=savings(),target=Math.max(Number(state.reserve_target||0),1);
    const p=Math.min(100,saved/target*100);
    return `<div class="journey-card savings-phase">
      <div class="eyebrow">НОВЫЙ ЭТАП</div>
      <div class="journey-title">Долги закрыты ✓</div>
      <div class="journey-start">Было долгов: <b>${money(start)}</b></div>
      <div class="journey-number">${money(saved)} <span>накоплено</span></div>
      <div class="journey-bar"><i style="width:${p}%"></i></div>
      <div class="row small"><span>Цель подушки</span><b>${money(state.reserve_target)}</b></div>
      <div class="journey-next">Теперь свободные деньги направляются в накопления и цели.</div>
      <div class="journey-motivation">“${esc(dailyFreedomMessage(false))}”</div>
    </div>`;
  }
  const paid=Math.max(0,start-debt),p=Math.max(0,Math.min(100,paid/start*100));
  const f=forecastDebtPayoff(state.strategy_mode||"Сбалансированный");
  return `<div class="journey-card">
    <div class="eyebrow">МОЙ ПУТЬ К СВОБОДЕ</div>
    <div class="journey-title">${money(start)} → 0 ₽</div>
    <div class="journey-main">
      <div class="journey-ring"><span>${p.toFixed(0)}%</span></div>
      <div class="journey-copy">
        <span>Было <b>${money(start)}</b></span>
        <span>Осталось <b>${money(debt)}</b></span>
        <span>Прогноз <b>${f.ok?f.finish.toLocaleDateString("ru-RU",{month:"long",year:"numeric"}):"уточни данные"}</b></span>
      </div>
    </div>
    <div class="journey-motivation">“${esc(dailyFreedomMessage(true))}”</div>
  </div>`;
}



function calendarDayEvents(day, monthIndex=new Date().getMonth(), year=new Date().getFullYear()){
  const out=[];

  if(monthIndex===new Date().getMonth() && year===new Date().getFullYear()){
    if(Number(state.salary_day_1)===day) out.push({kind:"salary1",title:"1-я часть зарплаты",amount:Number(state.salary_part_1||0),type:"income"});
    if(Number(state.salary_day_2)===day) out.push({kind:"salary2",title:"2-я часть зарплаты",amount:Number(state.salary_part_2||0),type:"income"});

    fixedCategories().filter(c=>Number(c.due_day)===day).forEach(c=>{
      out.push({kind:"bill",id:c.id,title:c.name,amount:Number(c.monthly||0),type:"bill"});
    });

    state.debts.filter(d=>Number(d.balance)>0 && Number(d.due_day||0)===day).forEach(d=>{
      out.push({kind:"debt",id:d.id,title:d.name,amount:Number(d.payment||d.min_payment||0),type:"debt"});
    });
  }

  state.debts.filter(d=>Number(d.balance)>0&&d.grace_enabled&&d.grace_end).forEach(d=>{
    const gd=parseDateOnly(d.grace_end);
    if(gd && gd.getFullYear()===year && gd.getMonth()===monthIndex && gd.getDate()===day){
      out.push({kind:"grace",id:d.id,title:`Конец 0% — ${d.name}`,amount:Number(d.balance||0),type:"grace"});
    }
  });

  return out;
}

function fullCalendarMonthMarkup(monthIndex,year,selectedDay){
  const first=new Date(year,monthIndex,1);
  const totalDays=new Date(year,monthIndex+1,0).getDate();
  const monday=(first.getDay()+6)%7;
  let cells="";
  for(let i=0;i<monday;i++)cells+=`<span class="full-cal-empty"></span>`;

  for(let day=1;day<=totalDays;day++){
    const events=calendarDayEvents(day,monthIndex,year);
    const dots=[...new Set(events.map(e=>e.type))]
      .map(t=>`<i class="dot ${t}"></i>`).join("");
    cells+=`<button type="button" class="full-cal-day ${day===selectedDay?"selected":""}" data-full-day="${day}">
      <b>${day}</b>
      <em>${dots}</em>
    </button>`;
  }

  return `<div class="full-cal-week">
      <i>Пн</i><i>Вт</i><i>Ср</i><i>Чт</i><i>Пт</i><i>Сб</i><i>Вс</i>
    </div>
    <div class="full-cal-grid">${cells}</div>`;
}

function calendarEditorRows(day,monthIndex,year){
  const events=calendarDayEvents(day,monthIndex,year);
  if(!events.length){
    return `<div class="calendar-empty-state">
      <b>На эту дату пока ничего нет</b>
      <span>Можно добавить обязательный платёж ниже.</span>
    </div>`;
  }

  return events.map(ev=>{
    if(ev.kind==="salary1"||ev.kind==="salary2"){
      const part=ev.kind==="salary1"?"1":"2";
      return `<div class="calendar-edit-row" data-kind="${ev.kind}">
        <span class="event-dot income"></span>
        <div class="cal-edit-main">
          <label>Событие<input value="${esc(ev.title)}" disabled></label>
          <div class="cal-edit-grid">
            <label>Сумма<input data-live-field="salary_amount" data-part="${part}" type="number" value="${Number(ev.amount||0)}"></label>
            <label>День<input data-live-field="salary_day" data-part="${part}" type="number" min="1" max="31" value="${day}"></label>
          </div>
        </div>
      </div>`;
    }

    if(ev.kind==="bill"){
      const c=state.categories.find(x=>x.id===ev.id);
      return `<div class="calendar-edit-row" data-kind="bill" data-id="${ev.id}">
        <span class="event-dot bill"></span>
        <div class="cal-edit-main">
          <label>Название<input data-live-field="bill_name" data-id="${ev.id}" value="${esc(c?.name||ev.title)}"></label>
          <div class="cal-edit-grid">
            <label>Сумма<input data-live-field="bill_amount" data-id="${ev.id}" type="number" value="${Number(c?.monthly||0)}"></label>
            <label>Оплатить до<input data-live-field="bill_day" data-id="${ev.id}" type="number" min="1" max="31" value="${Number(c?.due_day||day)}"></label>
          </div>
          <button type="button" class="cal-delete" data-remove-bill="${ev.id}">Удалить платёж</button>
        </div>
      </div>`;
    }

    if(ev.kind==="debt"){
      const d=state.debts.find(x=>x.id===ev.id);
      return `<div class="calendar-edit-row" data-kind="debt" data-id="${ev.id}">
        <span class="event-dot debt"></span>
        <div class="cal-edit-main">
          <label>Кредит<input value="${esc(d?.name||ev.title)}" disabled></label>
          <div class="cal-edit-grid">
            <label>Платёж<input data-live-field="debt_amount" data-id="${ev.id}" type="number" value="${Number(d?.payment||d?.min_payment||0)}"></label>
            <label>День<input data-live-field="debt_day" data-id="${ev.id}" type="number" min="1" max="31" value="${Number(d?.due_day||day)}"></label>
          </div>
        </div>
      </div>`;
    }

    if(ev.kind==="grace"){
      const d=state.debts.find(x=>x.id===ev.id);
      return `<div class="calendar-edit-row" data-kind="grace" data-id="${ev.id}">
        <span class="event-dot grace"></span>
        <div class="cal-edit-main">
          <label>Дедлайн<input value="${esc(ev.title)}" disabled></label>
          <label>Дата окончания 0%<input data-live-field="grace_date" data-id="${ev.id}" type="date" value="${esc(d?.grace_end||"")}"></label>
        </div>
      </div>`;
    }
    return "";
  }).join("");
}

function openFullCalendar(initialDay=new Date().getDate()){
  let modal=$("#fullCalendarModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="fullCalendarModal";
    modal.className="full-calendar-modal";
    document.body.appendChild(modal);
  }

  const now=new Date();
  const ctx={
    month:now.getMonth(),
    year:now.getFullYear(),
    day:Math.min(initialDay,new Date(now.getFullYear(),now.getMonth()+1,0).getDate())
  };

  function renderCalendarShell(){
    const monthLabel=new Date(ctx.year,ctx.month,1).toLocaleDateString("ru-RU",{month:"long",year:"numeric"});
    modal.innerHTML=`<div class="full-calendar-backdrop" data-close-full-cal></div>
      <section class="full-calendar-sheet" aria-label="Календарь платежей">
        <div class="sheet-handle"></div>

        <div class="full-cal-header">
          <div>
            <div class="eyebrow">КАЛЕНДАРЬ ПЛАТЕЖЕЙ</div>
            <h3>${monthLabel}</h3>
          </div>
          <button type="button" class="sheet-close" data-close-full-cal>×</button>
        </div>

        <div class="month-switch">
          <button type="button" id="prevMonth">‹</button>
          <button type="button" id="todayMonth">Сегодня</button>
          <button type="button" id="nextMonth">›</button>
        </div>

        <div id="fullCalendarGrid">
          ${fullCalendarMonthMarkup(ctx.month,ctx.year,ctx.day)}
        </div>

        <div class="full-cal-legend">
          <span><i class="dot income"></i> зарплата</span>
          <span><i class="dot bill"></i> обязательное</span>
          <span><i class="dot debt"></i> кредит</span>
          <span><i class="dot grace"></i> дедлайн 0%</span>
        </div>

        <div class="selected-day-head">
          <div>
            <span>Выбрано</span>
            <b id="selectedCalendarDate"></b>
          </div>
          <button type="button" id="addBillOnSelected">＋ Платёж</button>
        </div>

        <div id="calendarLiveEditor"></div>
        <div class="calendar-live-note">Изменения сохраняются сразу и сразу отражаются в календаре.</div>
      </section>`;

    modal.classList.add("open");

    $$("[data-close-full-cal]").forEach(x=>x.onclick=()=>modal.classList.remove("open"));
    $("#prevMonth").onclick=()=>{
      ctx.month--; if(ctx.month<0){ctx.month=11;ctx.year--;}
      ctx.day=1; renderCalendarShell();
    };
    $("#nextMonth").onclick=()=>{
      ctx.month++; if(ctx.month>11){ctx.month=0;ctx.year++;}
      ctx.day=1; renderCalendarShell();
    };
    $("#todayMonth").onclick=()=>{
      const d=new Date();ctx.month=d.getMonth();ctx.year=d.getFullYear();ctx.day=d.getDate();renderCalendarShell();
    };
    $("#addBillOnSelected").onclick=async()=>{
      const name=prompt("Название платежа","Новый платёж"); if(!name)return;
      const amount=Number(prompt("Сумма","0")||0);
      state.categories.push({
        id:id(),name,monthly:amount,priority:"Обязательно",
        kind:"Обязательный платеж",due_day:Number(ctx.day)
      });
      await saveState();
      renderCalendarBody();
      renderAll();
      toast("Платёж добавлен");
    };

    renderCalendarBody();
  }

  function renderCalendarBody(){
    const grid=$("#fullCalendarGrid");
    if(grid)grid.innerHTML=fullCalendarMonthMarkup(ctx.month,ctx.year,ctx.day);

    const selected=$("#selectedCalendarDate");
    if(selected)selected.textContent=new Date(ctx.year,ctx.month,ctx.day).toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"});

    const editor=$("#calendarLiveEditor");
    if(editor)editor.innerHTML=calendarEditorRows(ctx.day,ctx.month,ctx.year);

    $$("[data-full-day]").forEach(btn=>btn.onclick=()=>{
      ctx.day=Number(btn.dataset.fullDay);
      renderCalendarBody();
    });

    $$("[data-live-field]").forEach(input=>{
      const save=async()=>{
        const field=input.dataset.liveField;
        if(field==="salary_amount"){
          const part=input.dataset.part;
          state[part==="1"?"salary_part_1":"salary_part_2"]=Math.max(0,Number(input.value||0));
        }else if(field==="salary_day"){
          const part=input.dataset.part;
          state[part==="1"?"salary_day_1":"salary_day_2"]=Math.min(31,Math.max(1,Number(input.value||1)));
          ctx.day=Number(input.value||ctx.day);
        }else if(field==="bill_name"){
          const c=state.categories.find(x=>x.id===input.dataset.id); if(c)c.name=input.value.trim()||c.name;
        }else if(field==="bill_amount"){
          const c=state.categories.find(x=>x.id===input.dataset.id); if(c)c.monthly=Math.max(0,Number(input.value||0));
        }else if(field==="bill_day"){
          const c=state.categories.find(x=>x.id===input.dataset.id);
          if(c){c.due_day=Math.min(31,Math.max(1,Number(input.value||1)));c.kind="Обязательный платеж";ctx.day=c.due_day;}
        }else if(field==="debt_amount"){
          const d=state.debts.find(x=>x.id===input.dataset.id);
          if(d){
            if(d.type==="Кредит")d.payment=Math.max(0,Number(input.value||0));
            else d.min_payment=Math.max(0,Number(input.value||0));
          }
        }else if(field==="debt_day"){
          const d=state.debts.find(x=>x.id===input.dataset.id);
          if(d){d.due_day=Math.min(31,Math.max(1,Number(input.value||1)));ctx.day=d.due_day;}
        }else if(field==="grace_date"){
          const d=state.debts.find(x=>x.id===input.dataset.id);
          if(d)d.grace_end=input.value;
        }
        await saveState();
        renderAll();
        renderCalendarBody();
      };
      input.addEventListener("change",save);
    });

    $$("[data-remove-bill]").forEach(btn=>btn.onclick=async()=>{
      const c=state.categories.find(x=>x.id===btn.dataset.removeBill);
      if(!c)return;
      if(!confirm(`Удалить обязательный платёж «${c.name}»?`))return;
      state.categories=state.categories.filter(x=>x.id!==c.id);
      await saveState();renderAll();renderCalendarBody();toast("Платёж удалён");
    });
  }

  renderCalendarShell();
}


function personalAccounts(){
  return state.accounts.filter(a=>a.type!=="Накопления");
}
function savingsAccounts(){
  return state.accounts.filter(a=>a.type==="Накопления");
}
function accountOptions(list){
  return list.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance)}</option>`).join("");
}
function ensureSavingsAccount(){
  let acc=savingsAccounts()[0];
  if(!acc){
    acc={id:id(),name:"Накопления",type:"Накопления",balance:0};
    state.accounts.push(acc);
  }
  return acc;
}

function renderToday(){
  const debt=totalDebt(), n=nextSalary(), actions=smartTodayPlan();
  const activeDebts=state.debts.filter(d=>Number(d.balance)>0);
  const monthCats=state.categories.map(c=>{
    const total=Number(c.monthly||0),spent=categorySpentMonth(c.id),left=Math.max(0,total-spent);
    const pct=total>0?Math.min(100,spent/total*100):0;
    const due=Number(c.due_day)>0?nextCategoryDue(c):null;
    return `<div class="progress-item">
      <div class="progress-top"><div><b>${esc(c.name)}</b>${due?`<span>до ${due.toLocaleDateString("ru-RU",{day:"numeric",month:"short"})}</span>`:""}</div><b>${money(total)}</b></div>
      <div class="progress-line"><i style="width:${pct}%"></i></div>
      <div class="progress-bottom"><span>Было ${money(total)}</span><span>Оплачено / потрачено ${money(spent)}</span><b>Осталось ${money(left)}</b></div>
    </div>`;
  }).join("");

  $("#screen-today").innerHTML=`
    <div class="today-hero">
      <div>
        <div class="eyebrow">ДОСТУПНО СЕЙЧАС</div>
        <div class="hero-money">${money(personalFunds())}</div>
        <div class="muted">на картах, наличными и своих счетах</div>
      </div>
      <div class="salary-mini">
        <span>Следующая зарплата</span>
        <b>${n.days} дн.</b>
        <small>${n.part} · ${money(n.amount)}</small>
      </div>
    </div>

    <div class="top-compact-grid">
      <div class="card mini-calendar calendar-preview-btn" id="openFullCalendar" role="button" tabindex="0">${calendarMini()}</div>
      ${debtJourneyMarkup()}
    </div>

    <div class="section-title compact-title"><h2>Что важно сейчас</h2><span>только ближайшее</span></div>
    <div class="action-stack">
      ${actions.map((a,i)=>`<div class="smart-action">
        <div class="action-index ${a.tone}">${i+1}</div>
        <div class="action-text"><b>${esc(a.title)}</b><span>${esc(a.detail)}</span><small>${esc(a.note)}</small></div>
        <strong>${money(a.amount)}</strong>
      </div>`).join("") || `<div class="card muted">Срочных действий нет.</div>`}
    </div>

    ${activeDebts.length?`
      <div class="section-title compact-title"><h2>Долги</h2><span>закрытые исчезают отсюда</span></div>
      <div class="debt-strip">
        ${activeDebts.map(d=>{
          const isCard=d.type==="Кредитная карта",startDebt=Math.max(Number(state.start_debt||0),totalDebt());
          const dl=isCard?graceDeadline(d):nextScheduledPaymentDate(d);
          return `<div class="debt-tile ${isCard?"creditcard":"loan"}">
            <div class="row"><div><span>${isCard?"Кредитка":"Кредит"}</span><b>${esc(d.name)}</b></div>${isCard&&d.grace_enabled?`<em>0% до ${graceDeadline(d)?.toLocaleDateString("ru-RU",{day:"numeric",month:"short"})||"—"}</em>`:""}</div>
            <div class="debt-value">${money(d.balance)}</div>
            <div class="small muted">${isCard&&dl?`До дедлайна ${Math.max(0,daysBetweenNow(dl))} дн.`:dl?`Следующий платёж ${dl.toLocaleDateString("ru-RU")}`:""}</div>
            <button class="quick-pay" data-quick-pay="${d.id}">Погасить</button>
          </div>`;
        }).join("")}
      </div>`:""}

    <div class="section-title compact-title"><h2>Расходы и платежи</h2><span>было · оплачено · осталось</span></div>
    <div class="card progress-list">${monthCats}</div>

    
    <div class="section-title compact-title"><h2>Перемещение денег</h2><span>2 быстрых действия</span></div>
    <div class="money-move-grid">
      <details class="card money-action">
        <summary>＋ Деньги пришли</summary>
        <div class="money-action-form">
          <label><span>Куда зачислить</span>
            <select id="incomeAccount">${accountOptions(personalAccounts())}</select>
          </label>
          <label><span>Сумма</span>
            <input id="incomeAmount" type="number" inputmode="decimal" placeholder="0 ₽">
          </label>
          <label><span>Что это</span>
            <select id="incomeKind">
              <option>Зарплата</option>
              <option>Премия</option>
              <option>Отпускные</option>
              <option>Другой доход</option>
            </select>
          </label>
          <button id="addIncomeBtn" class="primary full">Зачислить</button>
        </div>
      </details>

      <details class="card money-action">
        <summary>↗ Перевести в накопления</summary>
        <div class="money-action-form">
          <label><span>С какой карты / счёта</span>
            <select id="transferFromAccount">${accountOptions(personalAccounts())}</select>
          </label>
          <label><span>Сумма</span>
            <input id="transferToSavingsAmount" type="number" inputmode="decimal" placeholder="0 ₽">
          </label>
          <label><span>Куда</span>
            <select id="transferSavingsAccount">${accountOptions(savingsAccounts().length?savingsAccounts():[ensureSavingsAccount()])}</select>
          </label>
          <button id="transferToSavingsBtn" class="secondary full">Перевести</button>
        </div>
      </details>
    </div>

<details class="quick-entry card">
      <summary>＋ Быстро добавить расход</summary>
      <div class="quick-form">
        <label class="quick-field"><span>Сумма</span><input id="quickExpenseAmount" type="number" inputmode="decimal" placeholder="0 ₽"></label>
        <label class="quick-field"><span>Категория</span><select id="quickExpenseCategory">${state.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <button id="saveExpenseBtn" class="primary quick-save">Записать</button>
      </div>
      <div class="small muted">Дата — сегодня. Источник — первый личный счёт. Остальное можно изменить в «Мои деньги».</div>
    </details>

    <details class="card nearest-events">
      <summary>Календарь ближайших событий</summary>
      ${timelineEvents().map(ev=>`<div class="event-line">
        <span>${ev.date.toLocaleDateString("ru-RU",{day:"numeric",month:"short"})}</span>
        <b>${esc(ev.title)}</b>
        <strong>${ev.type==="income"?"+":""}${money(ev.amount)}</strong>
      </div>`).join("")}
      ${fixedBillsOpen().slice(0,4).map(x=>`<div class="event-line">
        <span>${x.due.toLocaleDateString("ru-RU",{day:"numeric",month:"short"})}</span>
        <b>${esc(x.c.name)}</b><strong>${money(x.left)}</strong>
      </div>`).join("")}
    </details>
  `;

  const fullCalBtn=$("#openFullCalendar");
  if(fullCalBtn){
    fullCalBtn.onclick=()=>openFullCalendar(new Date().getDate());
    fullCalBtn.onkeydown=(e)=>{
      if(e.key==="Enter"||e.key===" "){e.preventDefault();openFullCalendar(new Date().getDate());}
    };
  }
  $$("[data-cal-day]").forEach(btn=>btn.onclick=(e)=>{e.stopPropagation();openFullCalendar(Number(btn.dataset.calDay));});

  
  const addIncomeBtn=$("#addIncomeBtn");
  if(addIncomeBtn)addIncomeBtn.onclick=async()=>{
    const account=state.accounts.find(a=>a.id===$("#incomeAccount").value);
    const amount=Math.max(0,Number($("#incomeAmount").value||0));
    const kind=$("#incomeKind").value||"Доход";
    if(!account)return toast("Выбери карту или счёт");
    if(amount<=0)return toast("Введи сумму");
    account.balance=Number(account.balance||0)+amount;
    addHistory(kind,amount,`${kind} → ${account.name}`,{
      sourceName:account.name,
      sourceKind:"account",
      accountId:account.id
    });
    $("#incomeAmount").value="";
    await saveState();
    renderAll();
    toast(`${money(amount)} зачислено на «${account.name}»`);
  };

  const transferBtn=$("#transferToSavingsBtn");
  if(transferBtn)transferBtn.onclick=async()=>{
    const from=state.accounts.find(a=>a.id===$("#transferFromAccount").value);
    let to=state.accounts.find(a=>a.id===$("#transferSavingsAccount").value);
    const amount=Math.max(0,Number($("#transferToSavingsAmount").value||0));
    if(!from)return toast("Выбери карту или счёт");
    if(!to)to=ensureSavingsAccount();
    if(amount<=0)return toast("Введи сумму");
    if(Number(from.balance||0)<amount)return toast(`На «${from.name}» недостаточно денег`);
    if(from.id===to.id)return toast("Выбери разные счета");

    from.balance=Number(from.balance||0)-amount;
    to.balance=Number(to.balance||0)+amount;

    addHistory("Перевод в накопления",-amount,`${from.name} → ${to.name}`,{
      sourceName:from.name,
      targetName:to.name,
      sourceKind:"account",
      targetKind:"savings",
      sourceAccountId:from.id,
      targetAccountId:to.id,
      transferAmount:amount
    });

    $("#transferToSavingsAmount").value="";
    await saveState();
    renderAll();
    toast(`${money(amount)} переведено в «${to.name}»`);
  };

const saveBtn=$("#saveExpenseBtn");
  if(saveBtn)saveBtn.onclick=async()=>{
    const amount=Number($("#quickExpenseAmount").value||0);
    if(amount<=0)return toast("Введи сумму");
    const categoryId=$("#quickExpenseCategory").value;
    const cat=state.categories.find(c=>c.id===categoryId);
    const account=state.accounts.find(a=>a.type!=="Накопления")||state.accounts[0];
    if(!account)return toast("Сначала добавь личный счёт");
    const r=applyExpenseToSource(`account:${account.id}`,amount);
    if(!r.ok)return toast(r.msg);
    addHistory("Расход",-amount,cat?.name||"Расход",{categoryId,categoryName:cat?.name||"",sourceKey:`account:${account.id}`,sourceName:account.name,sourceKind:"account"});
    await saveState();renderAll();toast("Записано");
  };

  $$("[data-quick-pay]").forEach(btn=>btn.onclick=async()=>{
    const d=state.debts.find(x=>x.id===btn.dataset.quickPay);
    if(!d)return;
    const account=state.accounts.find(a=>a.type!=="Накопления"&&Number(a.balance)>0)||state.accounts.find(a=>Number(a.balance)>0);
    if(!account)return toast("На своих счетах нет доступных денег");
    const raw=prompt(`Сколько погасить «${d.name}»?\\nДоступно на «${account.name}»: ${money(account.balance)}`,Math.min(Number(account.balance),Number(d.balance)).toFixed(0));
    if(raw===null)return;
    const amount=Number(String(raw).replace(/\s/g,"").replace(",","."));
    const r=payDebtFromAccount(account.id,d.id,amount);
    if(!r.ok)return toast(r.msg);
    addHistory("Погашение долга",-r.actual,`${account.name} → ${d.name}`,{sourceName:account.name,debtName:d.name,debtId:d.id});
    await saveState();renderAll();
    toast(Number(d.balance)<=0?`«${d.name}» закрыт — карточка убрана с главной`:`Долг уменьшен на ${money(r.actual)}`);
  });
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
    <div class="notice"><b>Для точного календаря:</b> у обычного кредита укажи дату выдачи, первый платёж, срок и плановую дату окончания. Для кредитки с 0% — дату окончания льготы и ставку после неё.</div>
    <div id="debtList">${state.debts.map(d=>debtHtml(d)).join("")}</div>

    <button id="saveAllBtn" class="primary full" style="margin-top:16px">💾 Сохранить сейчас</button>
    <div class="notice">Используй условные названия: «Карта 1», «Вклад», «Кредитка». Номера карт не нужны.</div>
  `;

  function harvestMoneyForm(){
    $$("[data-root]").forEach(el=>state[el.dataset.root]=Number(el.value||0));
    $$("[data-root-text]").forEach(el=>state[el.dataset.rootText]=el.value);
    state.categories.forEach(c=>{
      const base=`[data-cat-id="${c.id}"]`; const el=$(base); if(!el)return;
      c.name=$(`${base} [data-f="name"]`).value;
      c.monthly=Number($(`${base} [data-f="monthly"]`).value||0);
      c.priority=$(`${base} [data-f="priority"]`).value;
      const kind=$(`${base} [data-f="kind"]`),due=$(`${base} [data-f="due_day"]`);
      c.kind=kind?kind.value:"Повседневные";
      c.due_day=due?Number(due.value||0):0;
    });
    state.accounts.forEach(a=>{
      const base=`[data-account-id="${a.id}"]`; const el=$(base); if(!el)return;
      a.name=$(`${base} [data-f="name"]`).value;a.balance=Number($(`${base} [data-f="balance"]`).value||0);a.type=$(`${base} [data-f="type"]`).value;
    });
    state.debts.forEach(d=>{
      const base=`[data-debt-id="${d.id}"]`; const el=$(base); if(!el)return;
      d.name=$(`${base} [data-f="name"]`).value;
      d.balance=Number($(`${base} [data-f="balance"]`).value||0);
      d.payment=Number($(`${base} [data-f="payment"]`).value||0);
      d.apr=Number($(`${base} [data-f="apr"]`).value||0);
      d.type=$(`${base} [data-f="type"]`).value;
      d.due_day=Number($(`${base} [data-f="due_day"]`).value||25);
      const ge=$(`${base} [data-f="grace_enabled"]`);
      const gd=$(`${base} [data-f="grace_end"]`);
      const pa=$(`${base} [data-f="post_grace_apr"]`);
      d.grace_enabled=ge?ge.checked:false;
      d.grace_end=gd?gd.value:"";
      d.post_grace_apr=pa?Number(pa.value||0):Number(d.apr||0);
      const ls=$(`${base} [data-f="loan_start"]`);
      const fp=$(`${base} [data-f="first_payment_date"]`);
      const tm=$(`${base} [data-f="term_months"]`);
      const pt=$(`${base} [data-f="payment_type"]`);
      const se=$(`${base} [data-f="scheduled_end"]`);
      d.loan_start=ls?ls.value:"";
      d.first_payment_date=fp?fp.value:"";
      d.term_months=tm?Number(tm.value||0):0;
      d.payment_type=pt?pt.value:"Аннуитетный";
      d.scheduled_end=se?se.value:"";
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

  $("#addCategory").onclick=async()=>{harvestMoneyForm();state.categories.push({id:id(),name:"Новый расход",monthly:0,priority:"Обычно",kind:"Повседневные",due_day:0});await saveState({silent:true});renderMoney();};
  $("#addAccount").onclick=async()=>{harvestMoneyForm();state.accounts.push({id:id(),name:"Новый счёт",type:"Карта",balance:0});await saveState({silent:true});renderMoney();};
  $("#addDebt").onclick=async()=>{harvestMoneyForm();state.debts.push({id:id(),name:"Новый долг",type:"Кредит",balance:0,apr:0,payment:0,due_day:25,
          grace_enabled:false,grace_end:"",post_grace_apr:0,loan_start:"",first_payment_date:"",term_months:0,payment_type:"Аннуитетный",scheduled_end:""});await saveState({silent:true});renderMoney();};

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
  <div class="item-grid"><label>Категория<input data-f="name" value="${esc(c.name)}"></label><label>Сумма в месяц<input data-f="monthly" type="number" value="${c.monthly}"></label></div>
  <div class="item-grid">
    <label>Тип<select data-f="kind">${["Повседневные","Обязательный платеж"].map(x=>`<option ${x===(c.kind||"Повседневные")?"selected":""}>${x}</option>`).join("")}</select></label>
    <label>Оплатить до числа<input data-f="due_day" type="number" min="0" max="31" value="${Number(c.due_day||0)}" placeholder="0"></label>
  </div>
  <label>Важность<select data-f="priority">${["Обязательно","Обычно","Можно сократить"].map(x=>`<option ${x===c.priority?"selected":""}>${x}</option>`).join("")}</select></label>
  <button class="danger full delete" data-delete-category="${c.id}">Удалить</button></div>`;}
function accountHtml(a){return `<div class="item" data-account-id="${a.id}">
  <div class="item-grid"><label>Название<input data-f="name" value="${esc(a.name)}"></label><label>Сейчас там<input data-f="balance" type="number" value="${a.balance}"></label></div>
  <label>Тип<select data-f="type">${["Карта","Наличные","Накопления"].map(x=>`<option ${x===a.type?"selected":""}>${x}</option>`).join("")}</select></label>
  <button class="danger full delete" data-delete-account="${a.id}">Удалить</button></div>`;}
function debtHtml(d){return `<div class="item" data-debt-id="${d.id}">
  <label>Название<input data-f="name" value="${esc(d.name)}"></label>
  <div class="item-grid"><label>Остаток долга<input data-f="balance" type="number" value="${d.balance}"></label><label>Платёж / месяц<input data-f="payment" type="number" value="${d.payment}"></label></div>
  <div class="item-grid"><label>Ставка сейчас, %<input data-f="apr" type="number" step=".1" value="${d.apr}"></label><label>День платежа<input data-f="due_day" type="number" min="1" max="31" value="${d.due_day}"></label></div>
  <label>Тип<select data-f="type">${["Кредит","Кредитная карта"].map(x=>`<option ${x===d.type?"selected":""}>${x}</option>`).join("")}</select></label>
  ${d.type==="Кредит"?`
    <div class="loan-editor">
      <div class="item-grid">
        <label>Дата выдачи<input data-f="loan_start" type="date" value="${esc(d.loan_start||"")}"></label>
        <label>Первый платёж<input data-f="first_payment_date" type="date" value="${esc(d.first_payment_date||"")}"></label>
      </div>
      <div class="item-grid">
        <label>Срок, мес.<input data-f="term_months" type="number" min="0" value="${Number(d.term_months||0)}"></label>
        <label>Тип платежа<select data-f="payment_type">${["Аннуитетный","Дифференцированный"].map(x=>`<option ${x===d.payment_type?"selected":""}>${x}</option>`).join("")}</select></label>
      </div>
      <label>Плановая дата окончания<input data-f="scheduled_end" type="date" value="${esc(d.scheduled_end||"")}"></label>
    </div>`:""}
  ${d.type==="Кредитная карта"?`
    <div class="grace-editor">
      <label class="check-line"><input data-f="grace_enabled" type="checkbox" ${d.grace_enabled?"checked":""}> Есть льготный период / 0%</label>
      <div class="item-grid">
        <label>0% до даты<input data-f="grace_end" type="date" value="${esc(d.grace_end||"")}"></label>
        <label>Ставка после льготы, %<input data-f="post_grace_apr" type="number" step=".1" value="${Number(d.post_grace_apr||0)}"></label>
      </div>
    </div>`:""}
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
