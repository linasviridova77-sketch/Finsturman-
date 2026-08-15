
import streamlit as st
from datetime import date, datetime
import json, uuid, calendar
from streamlit_local_storage import LocalStorage

st.set_page_config(
    page_title="ФинШтурман",
    page_icon="🧭",
    layout="centered",
    initial_sidebar_state="collapsed",
)

STORE_KEY = "fin_shturman_v05"
storage = LocalStorage()

DEFAULT = {
    "salary_total": 91000.0,
    "salary_1": 45500.0,
    "salary_2": 45500.0,
    "salary_day_1": 10,
    "salary_day_2": 25,

    "reserve_target": 50000.0,
    "bonus_debt_pct": 70,
    "bonus_reserve_pct": 20,
    "bonus_self_pct": 10,

    "categories": [
        {"id":"c1","name":"Еда и продукты","monthly":18000.0,"priority":"Обязательно"},
        {"id":"c2","name":"Машина / бензин","monthly":8000.0,"priority":"Обязательно"},
        {"id":"c3","name":"Транспорт / такси","monthly":3000.0,"priority":"Обычно"},
        {"id":"c4","name":"Связь / интернет","monthly":1500.0,"priority":"Обязательно"},
        {"id":"c5","name":"Мелкие расходы","monthly":5000.0,"priority":"Обычно"},
        {"id":"c6","name":"Для себя","monthly":4000.0,"priority":"Можно сократить"},
    ],

    "accounts": [
        {"id":"a1","name":"Карта 1","type":"Карта","balance":0.0},
        {"id":"a2","name":"Вклад / подушка","type":"Накопления","balance":20000.0},
    ],

    "debts": [
        {"id":"d1","name":"Единый кредит","type":"Кредит","balance":460000.0,"apr":0.0,"payment":16900.0,"due_day":25},
        {"id":"d2","name":"Кредитка 1","type":"Кредитная карта","balance":90000.0,"apr":0.0,"payment":0.0,"due_day":20},
    ],

    "history": [],
    "start_debt": 550000.0,
}

CSS = """
<style>
.block-container{max-width:780px;padding-top:.7rem;padding-bottom:5rem}
h1{font-size:1.55rem!important}
.tip{padding:14px 16px;border-radius:16px;background:rgba(127,127,127,.08);
border-left:5px solid #6f9cff;margin:10px 0}
.warn{border-left-color:#e3a744}.good{border-left-color:#55b89b}
.small{opacity:.72;font-size:.88rem}
[data-testid="stMetric"]{background:rgba(127,127,127,.07);padding:11px;border-radius:16px}
.stButton button{border-radius:14px}
@media(max-width:700px){
.block-container{padding-left:.65rem;padding-right:.65rem}
h1{font-size:1.4rem!important}
}
</style>
"""
st.markdown(CSS, unsafe_allow_html=True)

def clone_default():
    return json.loads(json.dumps(DEFAULT))

def money(v):
    return f"{float(v):,.0f} ₽".replace(",", " ")

def total_debt(d):
    return sum(float(x["balance"]) for x in d["debts"])

def total_money(d):
    return sum(float(x["balance"]) for x in d["accounts"])

def savings(d):
    return sum(float(x["balance"]) for x in d["accounts"] if x["type"] == "Накопления")

def mandatory_debt(d):
    return sum(float(x["payment"]) for x in d["debts"] if float(x["balance"]) > 0)

def monthly_life(d):
    return sum(float(x["monthly"]) for x in d["categories"])

def save():
    storage.setItem(STORE_KEY, json.dumps(st.session_state.data, ensure_ascii=False), key="save_data")

def add_history(kind, amount, note, meta=None):
    st.session_state.data["history"].append({
        "id": str(uuid.uuid4()),
        "date": datetime.now().strftime("%d.%m.%Y %H:%M"),
        "kind": kind,
        "amount": float(amount),
        "note": note,
        "meta": meta or {}
    })
    save()

def priority_debt(d):
    active=[x for x in d["debts"] if float(x["balance"]) > 0]
    if not active:
        return None
    return sorted(
        active,
        key=lambda x: (float(x.get("apr",0)), x["type"]=="Кредитная карта"),
        reverse=True
    )[0]

def days_until(day):
    today=date.today()
    last=calendar.monthrange(today.year,today.month)[1]
    target_day=min(int(day),last)
    target=date(today.year,today.month,target_day)
    if target < today:
        if today.month==12:
            y,m=today.year+1,1
        else:
            y,m=today.year,today.month+1
        last2=calendar.monthrange(y,m)[1]
        target=date(y,m,min(int(day),last2))
    return (target-today).days, target

def next_salary_part(d):
    candidates=[]
    for part, day, amount in [
        ("1-я часть", d["salary_day_1"], d["salary_1"]),
        ("2-я часть", d["salary_day_2"], d["salary_2"])
    ]:
        dd,target=days_until(day)
        candidates.append((dd,target,part,float(amount)))
    return sorted(candidates,key=lambda x:x[0])[0]

def half_life_rows(d):
    return [(c["name"],float(c["monthly"])/2,c["priority"]) for c in d["categories"]]

def safe_daily_limit(d):
    dd, target_date, part, _ = next_salary_part(d)
    days=max(dd,1)
    period_need=monthly_life(d)/2
    return period_need/days, days, target_date, part

def standard_plan(d, incoming, part_no):
    reserve_now=savings(d)
    target=priority_debt(d)
    life_rows=half_life_rows(d)
    life_need=sum(x[1] for x in life_rows)
    debt_required=mandatory_debt(d) if part_no==2 else 0.0
    reserve_gap=max(0,float(d["reserve_target"])-reserve_now)
    reserve_goal=min(3000.0 if part_no==1 else 2000.0,reserve_gap)

    remainder=float(incoming)
    allocations=[]

    v=min(remainder,life_need)
    allocations.append(("На жизнь до следующей выплаты",v))
    remainder-=v

    if debt_required>0:
        v=min(remainder,debt_required)
        allocations.append(("Обязательные платежи по долгам",v))
        remainder-=v

    if reserve_goal>0:
        v=min(remainder,reserve_goal)
        allocations.append(("В подушку",v))
        remainder-=v

    if target and remainder>0:
        v=min(remainder,float(target["balance"]))
        allocations.append((f"Досрочно → {target['name']}",v))
        remainder-=v

    if remainder>0:
        allocations.append(("Свободный остаток",remainder))

    return allocations, life_rows, target

def bonus_plan(d, incoming):
    target=priority_debt(d)
    debt_pct=int(d.get("bonus_debt_pct",70))
    reserve_pct=int(d.get("bonus_reserve_pct",20))
    self_pct=int(d.get("bonus_self_pct",10))

    total=max(debt_pct+reserve_pct+self_pct,1)
    debt_share=incoming*debt_pct/total
    reserve_share=incoming*reserve_pct/total
    self_share=incoming*self_pct/total

    reserve_gap=max(0,float(d["reserve_target"])-savings(d))
    reserve_share=min(reserve_share,reserve_gap if reserve_gap>0 else reserve_share)

    allocations=[]
    if target:
        allocations.append((f"В долг → {target['name']}",min(debt_share,float(target["balance"]))))
    else:
        reserve_share += debt_share
    if reserve_share>0:
        allocations.append(("В подушку",reserve_share))
    if self_share>0:
        allocations.append(("Себе без чувства вины",self_share))

    used=sum(x[1] for x in allocations)
    if incoming-used>1:
        allocations.append(("Свободный остаток",incoming-used))

    return allocations, target

def vacation_plan(d, incoming, vacation_budget):
    target=priority_debt(d)
    next_daily, days, target_date, part= safe_daily_limit(d)
    life_until_next=min(incoming,next_daily*days)
    mandatory=min(max(0,incoming-life_until_next),mandatory_debt(d))
    vacation=min(max(0,incoming-life_until_next-mandatory),vacation_budget)
    remainder=max(0,incoming-life_until_next-mandatory-vacation)

    allocations=[]
    if life_until_next>0:
        allocations.append((f"Резерв на жизнь до {target_date.strftime('%d.%m')}",life_until_next))
    if mandatory>0:
        allocations.append(("Ближайшие обязательные платежи",mandatory))
    if vacation>0:
        allocations.append(("На отпуск / поездку",vacation))
    if target and remainder>0:
        allocations.append((f"Остаток досрочно → {target['name']}",min(remainder,float(target["balance"]))))
        remainder=max(0,remainder-float(target["balance"]))
    if remainder>0:
        allocations.append(("Свободный остаток",remainder))

    return allocations, target, target_date

def other_plan(d, incoming, purpose):
    target=priority_debt(d)
    allocations=[]
    if purpose=="Сохранить на цель":
        allocations.append(("Оставить под цель",incoming))
    elif purpose=="В подушку":
        allocations.append(("В подушку",incoming))
    elif purpose=="В долг" and target:
        allocations.append((f"В долг → {target['name']}",min(incoming,float(target["balance"]))))
        if incoming>float(target["balance"]):
            allocations.append(("Свободный остаток",incoming-float(target["balance"])))
    else:
        # neutral 50/30/20
        debt=incoming*.5 if target else 0
        reserve=incoming*.3
        self_amt=incoming-debt-reserve
        if target:
            allocations.append((f"В долг → {target['name']}",min(debt,float(target["balance"]))))
        allocations.append(("В подушку",reserve))
        allocations.append(("Себе / на цель",self_amt))
    return allocations,target

if "data" not in st.session_state:
    raw=storage.getItem(STORE_KEY,key="load_data")
    if raw:
        try:
            st.session_state.data=json.loads(raw)
        except Exception:
            st.session_state.data=clone_default()
    else:
        st.session_state.data=clone_default()

d=st.session_state.data

for key,val in DEFAULT.items():
    if key not in d:
        d[key]=json.loads(json.dumps(val))
for x in d["accounts"]:
    x.setdefault("id",str(uuid.uuid4()))
for x in d["debts"]:
    x.setdefault("id",str(uuid.uuid4()))
for x in d["categories"]:
    x.setdefault("id",str(uuid.uuid4()))
d.setdefault("history",[])
d.setdefault("start_debt",max(total_debt(d),1))

st.markdown("# 🧭 ФинШтурман")
st.caption("Две части зарплаты • премии • отпускные • расходы • долги • подушка")

tab_home, tab_plan, tab_history = st.tabs(["🏠 Сегодня","✏️ Настроить","📜 История"])

with tab_home:
    debt=total_debt(d)
    cash=total_money(d)
    reserve=savings(d)
    target=priority_debt(d)

    c1,c2=st.columns(2)
    c1.metric("Долги",money(debt))
    c2.metric("Мои деньги",money(cash))
    c3,c4=st.columns(2)
    c3.metric("Подушка",money(reserve))
    c4.metric("Расходы / месяц",money(monthly_life(d)))

    start=max(float(d.get("start_debt",debt)),debt,1)
    progress=max(0,min(1,1-debt/start))
    st.write(f"**Путь к нулевому долгу: {progress*100:.0f}%**")
    st.progress(progress)

    daily,days_left,target_date,next_part=safe_daily_limit(d)
    st.markdown(
        f"<div class='tip good'><b>📅 До следующей выплаты: {days_left} дн.</b><br>"
        f"Ориентир на повседневные расходы: около <b>{money(daily)} в день</b>.<br>"
        f"<span class='small'>Следующая выплата: {next_part}, {target_date.strftime('%d.%m.%Y')}.</span></div>",
        unsafe_allow_html=True
    )

    st.subheader("💰 Мне пришли деньги")
    income_type=st.selectbox(
        "Что пришло?",
        ["1-я часть зарплаты","2-я часть зарплаты","Премия","Отпускные","Другое поступление"]
    )

    if income_type=="1-я часть зарплаты":
        default_income=float(d["salary_1"])
    elif income_type=="2-я часть зарплаты":
        default_income=float(d["salary_2"])
    else:
        default_income=0.0

    incoming=st.number_input("Сумма",min_value=0.0,value=default_income,step=500.0,key="incoming")

    vacation_budget=0.0
    other_purpose=None
    if income_type=="Отпускные":
        vacation_budget=st.number_input(
            "Сколько реально хочешь потратить на отпуск / поездку?",
            min_value=0.0,
            value=0.0,
            step=1000.0
        )
    elif income_type=="Другое поступление":
        other_purpose=st.selectbox(
            "Что хочешь сделать с этими деньгами?",
            ["Пока не знаю","Сохранить на цель","В подушку","В долг"]
        )

    if incoming>0:
        if income_type=="1-я часть зарплаты":
            allocations,life_rows,target=standard_plan(d,incoming,1)
            reason="Первая часть сначала защищает жизнь до следующей выплаты. Только остаток идёт в накопления и долг."
        elif income_type=="2-я часть зарплаты":
            allocations,life_rows,target=standard_plan(d,incoming,2)
            reason="Вторая часть дополнительно резервирует обязательные платежи. После них остаток ускоряет погашение долга."
        elif income_type=="Премия":
            allocations,target=bonus_plan(d,incoming)
            life_rows=[]
            reason="Премия не считается новой постоянной зарплатой. Поэтому она не увеличивает твой обычный бюджет на жизнь."
        elif income_type=="Отпускные":
            allocations,target,target_date=vacation_plan(d,incoming,vacation_budget)
            life_rows=[]
            reason="Отпускные не считаются полностью свободными деньгами: сначала сохраняется сумма на жизнь до следующей обычной выплаты и обязательные платежи."
        else:
            allocations,target=other_plan(d,incoming,other_purpose)
            life_rows=[]
            reason="Для разового поступления помощник не меняет твою обычную зарплату и предлагает безопасное распределение."

        st.markdown("#### Я бы распределил так:")
        for title,val in allocations:
            if val>0:
                st.write(f"**{title}: {money(val)}**")

        st.markdown(
            f"<div class='tip'><b>Почему так?</b><br>{reason}</div>",
            unsafe_allow_html=True
        )

        if income_type in ["1-я часть зарплаты","2-я часть зарплаты"]:
            with st.expander("Из чего складывается «на жизнь»"):
                for name,val,priority in life_rows:
                    st.write(f"{name} — **{money(val)}**")

        if st.button("✓ Записать поступление",type="primary",use_container_width=True):
            add_history(
                income_type,
                incoming,
                "Помощник сформировал план распределения.",
                {"allocations":allocations,"reason":reason}
            )
            st.success("Сохранено в истории.")

    st.divider()
    st.subheader("🛍️ Перед покупкой")
    with st.expander("Проверить, можно ли сейчас потратить"):
        item=st.text_input("Что хочешь купить?",placeholder="Например: одежда, косметика, техника")
        price=st.number_input("Стоимость",min_value=0.0,step=500.0,key="buy_price")
        if price>0:
            available_period=max(0,monthly_life(d)/2)
            if price<=daily:
                st.success("По размеру это укладывается примерно в один дневной лимит.")
            elif price<=available_period*.25:
                st.info("Покупка возможна, но она заметно уменьшит бюджет до следующей выплаты.")
            else:
                st.warning("Покупка большая относительно бюджета текущего периода.")
            if target:
                st.write(
                    f"Если вместо покупки направить **{money(price)}** в «{target['name']}», "
                    f"остаток долга станет примерно **{money(max(0,float(target['balance'])-price))}**."
                )
            c1,c2=st.columns(2)
            if c1.button("⏳ Отложить",use_container_width=True):
                add_history("Отложила покупку",price,item or "Покупка")
                st.success("Записано.")
            if c2.button("Купила",use_container_width=True):
                add_history("Покупка",-price,item or "Покупка")
                st.info("Записано. Остаток счёта можно поправить в «Настроить».")

with tab_plan:
    st.subheader("💰 Зарплата")
    d["salary_total"]=st.number_input("Всего в месяц",min_value=0.0,value=float(d["salary_total"]),step=1000.0)
    c1,c2=st.columns(2)
    d["salary_1"]=c1.number_input("1-я часть",min_value=0.0,value=float(d["salary_1"]),step=500.0)
    d["salary_2"]=c2.number_input("2-я часть",min_value=0.0,value=float(d["salary_2"]),step=500.0)
    c3,c4=st.columns(2)
    d["salary_day_1"]=c3.number_input("День 1-й выплаты",1,31,int(d["salary_day_1"]))
    d["salary_day_2"]=c4.number_input("День 2-й выплаты",1,31,int(d["salary_day_2"]))

    st.divider()
    st.subheader("🎁 Как делить премию")
    st.caption("Эти проценты можно менять. Они работают только для премии.")
    p1,p2,p3=st.columns(3)
    d["bonus_debt_pct"]=p1.number_input("В долг, %",0,100,int(d["bonus_debt_pct"]))
    d["bonus_reserve_pct"]=p2.number_input("В подушку, %",0,100,int(d["bonus_reserve_pct"]))
    d["bonus_self_pct"]=p3.number_input("Себе, %",0,100,int(d["bonus_self_pct"]))
    if d["bonus_debt_pct"]+d["bonus_reserve_pct"]+d["bonus_self_pct"]!=100:
        st.warning("Проценты не дают 100%. Помощник всё равно пропорционально пересчитает распределение.")

    st.divider()
    st.subheader("🧾 Мои обычные расходы")
    for c in list(d["categories"]):
        with st.container(border=True):
            c1,c2=st.columns([1.6,1])
            c["name"]=c1.text_input("Категория",c["name"],key=f"cn_{c['id']}")
            c["monthly"]=c2.number_input("В месяц",min_value=0.0,value=float(c["monthly"]),step=500.0,key=f"cm_{c['id']}")
            c3,c4=st.columns([2,1])
            opts=["Обязательно","Обычно","Можно сократить"]
            c["priority"]=c3.selectbox("Важность",opts,index=opts.index(c.get("priority","Обычно")),key=f"cp_{c['id']}")
            if c4.button("🗑️ Удалить",key=f"cdel_{c['id']}",use_container_width=True):
                d["categories"]=[z for z in d["categories"] if z["id"]!=c["id"]]
                save(); st.rerun()

    if st.button("＋ Добавить расход",use_container_width=True):
        d["categories"].append({
            "id":str(uuid.uuid4()),
            "name":"Новый расход",
            "monthly":0.0,
            "priority":"Обычно"
        })
        save(); st.rerun()

    st.markdown(f"**Всего обычных расходов: {money(monthly_life(d))} / месяц**")

    st.divider()
    st.subheader("💵 Деньги и накопления")
    d["reserve_target"]=st.number_input("Цель подушки",min_value=0.0,value=float(d["reserve_target"]),step=5000.0)
    for a in list(d["accounts"]):
        with st.container(border=True):
            c1,c2=st.columns([1.6,1])
            a["name"]=c1.text_input("Название",a["name"],key=f"an_{a['id']}")
            a["balance"]=c2.number_input("Сейчас там",min_value=0.0,value=float(a["balance"]),step=500.0,key=f"ab_{a['id']}")
            c3,c4=st.columns([2,1])
            types=["Карта","Наличные","Накопления"]
            a["type"]=c3.selectbox("Тип",types,index=types.index(a["type"]) if a["type"] in types else 0,key=f"at_{a['id']}")
            if c4.button("🗑️ Удалить",key=f"adel_{a['id']}",use_container_width=True):
                d["accounts"]=[z for z in d["accounts"] if z["id"]!=a["id"]]
                save(); st.rerun()
    if st.button("＋ Добавить карту / вклад / наличные",use_container_width=True):
        d["accounts"].append({"id":str(uuid.uuid4()),"name":"Новый счёт","type":"Карта","balance":0.0})
        save(); st.rerun()

    st.divider()
    st.subheader("💳 Долги")
    for x in list(d["debts"]):
        with st.container(border=True):
            x["name"]=st.text_input("Название",x["name"],key=f"dn_{x['id']}")
            c1,c2=st.columns(2)
            x["balance"]=c1.number_input("Остаток долга",min_value=0.0,value=float(x["balance"]),step=1000.0,key=f"db_{x['id']}")
            x["payment"]=c2.number_input("Обязательный платёж",min_value=0.0,value=float(x["payment"]),step=500.0,key=f"dp_{x['id']}")
            c3,c4=st.columns(2)
            x["apr"]=c3.number_input("Ставка, %",min_value=0.0,max_value=100.0,value=float(x.get("apr",0)),step=.1,key=f"da_{x['id']}")
            types=["Кредит","Кредитная карта"]
            x["type"]=c4.selectbox("Тип",types,index=types.index(x["type"]) if x["type"] in types else 0,key=f"dt_{x['id']}")
            c5,c6=st.columns([2,1])
            x["due_day"]=c5.number_input("День платежа",1,31,int(x.get("due_day",25)),key=f"dd_{x['id']}")
            if c6.button("🗑️ Удалить",key=f"ddel_{x['id']}",use_container_width=True):
                d["debts"]=[z for z in d["debts"] if z["id"]!=x["id"]]
                save(); st.rerun()

    if st.button("＋ Добавить долг",use_container_width=True):
        d["debts"].append({
            "id":str(uuid.uuid4()),"name":"Новый долг","type":"Кредит",
            "balance":0.0,"apr":0.0,"payment":0.0,"due_day":25
        })
        d["start_debt"]=max(float(d.get("start_debt",0)),total_debt(d))
        save(); st.rerun()

    if st.button("💾 Сохранить всё",type="primary",use_container_width=True):
        d["start_debt"]=max(float(d.get("start_debt",0)),total_debt(d))
        save()
        add_history("Настройки обновлены",0,"Зарплата, премия, расходы, счета или долги")
        st.success("Сохранено.")

with tab_history:
    st.subheader("📜 История")
    if not d["history"]:
        st.info("Пока пусто.")
    else:
        for h in reversed(d["history"]):
            with st.container(border=True):
                c1,c2=st.columns([4,1])
                sign="+" if h["amount"]>0 else ""
                amount_text=(sign+money(h["amount"])) if h["amount"] else ""
                c1.markdown(f"**{h['kind']}** {amount_text}")
                c1.caption(f"{h['date']} · {h['note']}")
                if h.get("meta",{}).get("allocations"):
                    with c1.expander("Как распределял помощник"):
                        for title,val in h["meta"]["allocations"]:
                            if val>0:
                                st.write(f"{title}: **{money(val)}**")
                        if h["meta"].get("reason"):
                            st.caption(h["meta"]["reason"])
                if c2.button("🗑️",key=f"hdel_{h['id']}",help="Удалить"):
                    d["history"]=[z for z in d["history"] if z["id"]!=h["id"]]
                    save(); st.rerun()

    with st.expander("Резервная копия / восстановление"):
        payload=json.dumps(d,ensure_ascii=False,indent=2).encode("utf-8")
        st.download_button(
            "⬇️ Скачать резервную копию",
            payload,
            "fin_shturman_backup.json",
            "application/json",
            use_container_width=True
        )
        uploaded=st.file_uploader("Восстановить копию",type=["json"])
        if uploaded and st.button("Восстановить"):
            try:
                st.session_state.data=json.loads(uploaded.read().decode("utf-8"))
                save(); st.success("Восстановлено."); st.rerun()
            except Exception:
                st.error("Не удалось прочитать файл.")

save()
st.caption("🔒 Не вводи номера карт, CVV, банковские логины или SMS-коды. Используй условные названия.")
