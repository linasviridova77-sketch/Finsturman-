[app.py](https://github.com/user-attachments/files/31102203/app.py)
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import date, datetime, timedelta
import calendar, json, base64, hashlib, secrets, math
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

st.set_page_config(page_title='ФинШтурман 0.2', page_icon='🧭', layout='wide', initial_sidebar_state='collapsed')

DEFAULT = {
    'profile': {
        'monthly_income': 91000.0,
        'essential_budget': 48000.0,
        'reserve_target': 50000.0,
        'goal_name': 'Свобода от долгов'
    },
    'accounts': [
        {'name':'Карта 1','type':'Дебетовая карта','balance':0.0,'apr':0.0},
        {'name':'Вклад','type':'Накопления','balance':20000.0,'apr':0.0},
    ],
    'debts': [
        {'name':'Единый кредит','type':'Кредит','balance':460000.0,'apr':0.0,'min_payment':16900.0,'due_day':25,'grace_end':'','new_spending':False},
        {'name':'Кредитка 1','type':'Кредитная карта','balance':90000.0,'apr':0.0,'min_payment':0.0,'due_day':25,'grace_end':'','new_spending':False},
        {'name':'Кредитка резерв','type':'Кредитная карта','balance':0.0,'apr':0.0,'min_payment':0.0,'due_day':25,'grace_end':'','new_spending':False},
    ],
    'history': [],
    'wishes': [],
    'settings': {
        'reserve_monthly':5000.0,
        'weekly_fun_budget':7000.0,
        'extra_debt_payment':15000.0,
        'scenario_amount':10000.0
    }
}

CSS = '''
<style>
.block-container {padding-top: 1.0rem; padding-bottom: 4rem; max-width: 1180px;}
[data-testid="stMetric"] {background:rgba(127,127,127,.08);padding:14px;border-radius:18px;border:1px solid rgba(127,127,127,.12)}
.fin-card {padding:16px 18px;border-radius:18px;background:rgba(127,127,127,.08);margin:10px 0;border:1px solid rgba(127,127,127,.12)}
.good {border-left:5px solid #55B89B}.warn {border-left:5px solid #E2A84A}.bad {border-left:5px solid #D76565}.info {border-left:5px solid #6F9CFF}
.small {opacity:.72;font-size:.9rem}.big {font-size:1.15rem;font-weight:700}.hero {font-size:2rem;font-weight:800;line-height:1.1}
.pill {display:inline-block;padding:5px 10px;border-radius:999px;background:rgba(127,127,127,.12);margin:2px 4px 2px 0;font-size:.85rem}
section[data-testid="stSidebar"] {min-width:250px;}
@media (max-width: 700px){
  .block-container{padding-left:.75rem;padding-right:.75rem;padding-top:.5rem}
  .hero{font-size:1.55rem}
  [data-testid="stMetric"]{padding:10px}
  div[data-testid="column"]{min-width:0!important}
}
</style>
'''
st.markdown(CSS, unsafe_allow_html=True)

if 'data' not in st.session_state:
    st.session_state.data = json.loads(json.dumps(DEFAULT))
if 'unlocked' not in st.session_state:
    st.session_state.unlocked = False
if 'master_password' not in st.session_state:
    st.session_state.master_password = ''


def money(x):
    return f"{float(x):,.0f} ₽".replace(',', ' ')

def total_savings(d):
    return sum(float(a.get('balance',0)) for a in d['accounts'] if a.get('type') in ['Накопления','Вклад','Накопительный счет'])

def total_cash(d):
    return sum(float(a.get('balance',0)) for a in d['accounts'])

def total_debt(d):
    return sum(float(x.get('balance',0)) for x in d['debts'])

def mandatory_total(d):
    return sum(float(x.get('min_payment',0)) for x in d['debts'] if float(x.get('balance',0)) > 0)

def log_event(kind, amount=0, note=''):
    st.session_state.data['history'].append({
        'date': datetime.now().isoformat(timespec='seconds'), 'kind': kind,
        'amount': float(amount), 'note': note
    })

def parse_date(s):
    try:
        return datetime.strptime(s, '%Y-%m-%d').date() if s else None
    except Exception:
        return None

def debt_priority(debt):
    card = 2 if debt.get('type') == 'Кредитная карта' else 1
    grace = parse_date(debt.get('grace_end',''))
    urgency = 0
    if grace:
        days = (grace - date.today()).days
        if 0 <= days <= 60: urgency = 3
        elif 60 < days <= 120: urgency = 2
    return (urgency, card, float(debt.get('apr',0)), float(debt.get('balance',0)))

def active_debts(d):
    return [x for x in d['debts'] if float(x.get('balance',0)) > 0]

def priority_debt(d):
    act = active_debts(d)
    return sorted(act, key=debt_priority, reverse=True)[0] if act else None

def allocate_income(amount, d):
    amount = float(amount); remaining = amount; steps=[]
    mandatory = mandatory_total(d)
    take=min(remaining,mandatory); steps.append(('1. Обязательные платежи',take,'Не допускаем просрочек.')); remaining-=take
    essential=float(d['profile'].get('essential_budget',0)); take=min(remaining,essential); steps.append(('2. Жизнь и обязательные расходы',take,'Жильё, еда, транспорт, связь и другие необходимые расходы.')); remaining-=take
    reserve=total_savings(d); target=float(d['profile'].get('reserve_target',0)); desired=min(float(d['settings'].get('reserve_monthly',0)),max(0,target-reserve)); take=min(remaining,desired); steps.append(('3. Финансовая подушка',take,'Формируем собственный резерв вместо кредитного лимита.')); remaining-=take
    target_debt=priority_debt(d)
    if target_debt and remaining>0:
        take=min(remaining,float(target_debt['balance'])); steps.append((f"4. Досрочно → {target_debt['name']}",take,'Приоритет определяется типом долга, ставкой и сроком льготного периода.')); remaining-=take
    if remaining>0: steps.append(('5. Свободный остаток',remaining,'Можно оставить буфером или распределить на следующую цель.'))
    return steps

def simulate_payoff(d, extra_monthly=0.0, max_months=240):
    debts=[]
    for x in active_debts(d):
        debts.append({
            'name':x['name'], 'type':x['type'], 'balance':float(x['balance']),
            'apr':float(x.get('apr',0)), 'min_payment':float(x.get('min_payment',0)),
            'grace_end':x.get('grace_end','')
        })
    if not debts: return pd.DataFrame(), 0, 0.0
    rows=[]; total_interest=0.0
    start=date.today().replace(day=1)
    for m in range(max_months+1):
        month_date=(start + pd.DateOffset(months=m)).date()
        rows.append({'Месяц':month_date,'Общий долг':sum(x['balance'] for x in debts)})
        if sum(x['balance'] for x in debts) <= 0.01: return pd.DataFrame(rows), m, total_interest
        # monthly interest first
        for x in debts:
            if x['balance'] <= 0: continue
            r=max(0,x['apr'])/100/12
            interest=x['balance']*r
            x['balance'] += interest; total_interest += interest
        # mandatory payments
        rollover=0.0
        for x in debts:
            if x['balance'] <= 0: continue
            p=min(x['balance'],max(0,x['min_payment']))
            x['balance']-=p
            rollover += max(0,x['min_payment']-p)
        # extra + freed minimums to priority debt
        pool=float(extra_monthly)+rollover
        safety=0
        while pool>0.01 and any(x['balance']>0.01 for x in debts) and safety<20:
            candidates=[x for x in debts if x['balance']>0.01]
            target=sorted(candidates,key=debt_priority,reverse=True)[0]
            p=min(pool,target['balance']); target['balance']-=p; pool-=p; safety+=1
    return pd.DataFrame(rows), max_months, total_interest

def payment_calendar(d, months=2):
    events=[]; today=date.today()
    for offset in range(months+1):
        y=(today.year*12 + today.month-1 + offset)//12
        m=(today.month-1+offset)%12+1
        last=calendar.monthrange(y,m)[1]
        for x in active_debts(d):
            day=min(int(x.get('due_day',25)),last)
            dt=date(y,m,day)
            if dt>=today:
                events.append({'Дата':dt,'Платёж':x['name'],'Сумма':float(x.get('min_payment',0)),'Тип':x['type']})
    return pd.DataFrame(events).sort_values('Дата') if events else pd.DataFrame()

def scenario_compare(d, amount):
    target=priority_debt(d)
    savings_accounts=[a for a in d['accounts'] if a.get('type') in ['Накопления','Вклад','Накопительный счет']]
    best_sav=max(savings_accounts,key=lambda a:float(a.get('apr',0)),default=None)
    debt_apr=float(target.get('apr',0)) if target else 0
    sav_apr=float(best_sav.get('apr',0)) if best_sav else 0
    debt_gain=amount*(debt_apr/100) if debt_apr>0 else None
    sav_gain=amount*(sav_apr/100) if sav_apr>0 else None
    return target,best_sav,debt_gain,sav_gain

def derive_key(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 250000, dklen=32)

def encrypt_backup(data, password):
    salt=secrets.token_bytes(16); nonce=secrets.token_bytes(12); key=derive_key(password,salt)
    raw=json.dumps(data, ensure_ascii=False).encode('utf-8')
    ct=AESGCM(key).encrypt(nonce,raw,None)
    return json.dumps({'v':2,'salt':base64.b64encode(salt).decode(),'nonce':base64.b64encode(nonce).decode(),'data':base64.b64encode(ct).decode()},ensure_ascii=False,indent=2).encode('utf-8')

def decrypt_backup(blob,password):
    p=json.loads(blob.decode('utf-8')); salt=base64.b64decode(p['salt']); nonce=base64.b64decode(p['nonce']); ct=base64.b64decode(p['data']); key=derive_key(password,salt)
    return json.loads(AESGCM(key).decrypt(nonce,ct,None).decode('utf-8'))

# lock
if not st.session_state.unlocked:
    st.markdown("<div class='hero'>🧭 ФинШтурман 0.2</div>",unsafe_allow_html=True)
    st.caption('Личный финансовый помощник: долги, бюджет, накопления и защита от импульсивных трат')
    st.info('Не вводи номера карт, CVV, логины банков или SMS-коды. Используй условные названия: «Карта 1», «Кредитка 1», «Вклад».')
    pwd=st.text_input('Пароль этой сессии',type='password',help='Не используй банковский пароль. Этот пароль нужен для шифрования резервной копии.')
    if st.button('Открыть помощника',type='primary',use_container_width=True):
        if len(pwd)<6: st.error('Задай пароль минимум из 6 символов.')
        else: st.session_state.master_password=pwd; st.session_state.unlocked=True; st.rerun()
    st.stop()

d=st.session_state.data
# backward compatibility
for a in d.get('accounts',[]): a.setdefault('apr',0.0)
d.setdefault('settings',{}).setdefault('extra_debt_payment',15000.0)
d['settings'].setdefault('scenario_amount',10000.0)
d.setdefault('profile',{}).setdefault('goal_name','Свобода от долгов')

pages=['Главная','Бюджет месяца','Календарь','Прогноз долгов','Куда направить деньги','Пришла зарплата','Хочу потратить','Счета','Долги','История','Настройки']
page=st.segmented_control('Раздел',pages,default='Главная') if hasattr(st,'segmented_control') else st.selectbox('Раздел',pages)

if page=='Главная':
    debt=total_debt(d); sav=total_savings(d); cash=total_cash(d); net=cash-debt
    st.markdown("<div class='hero'>Твоя финансовая панель</div>",unsafe_allow_html=True)
    c1,c2,c3,c4=st.columns(4)
    c1.metric('Все долги',money(debt)); c2.metric('Накопления',money(sav)); c3.metric('Деньги',money(cash)); c4.metric('Чистая позиция',money(net))
    st.caption('Кредитные лимиты не считаются твоими деньгами.')

    # progress
    reserve_target=float(d['profile'].get('reserve_target',0)); reserve_progress=min(1,sav/reserve_target) if reserve_target>0 else 1
    st.subheader('Прогресс')
    cc1,cc2=st.columns(2)
    with cc1:
        st.write(f'**Подушка:** {money(sav)} из {money(reserve_target)}')
        st.progress(reserve_progress)
    with cc2:
        baseline=550000.0
        if d['history']:
            debt_events=[h for h in d['history'] if h.get('kind')=='Стартовый долг']
            if debt_events: baseline=max(debt,float(debt_events[0].get('amount',debt)))
        progress=max(0,min(1,1-debt/max(baseline,1)))
        st.write(f'**Путь к нулевому долгу:** {progress*100:.0f}%')
        st.progress(progress)

    target=priority_debt(d)
    if target:
        aprtxt=f" · ставка {target.get('apr',0):.1f}%" if float(target.get('apr',0))>0 else ''
        st.markdown(f"<div class='fin-card warn'><b>🎯 Приоритет сейчас: {target['name']}</b><br>Остаток {money(target['balance'])}{aprtxt}.<br><span class='small'>После обязательных расходов и платежей свободные деньги логичнее направлять сюда.</span></div>",unsafe_allow_html=True)
    if sav < reserve_target:
        st.markdown(f"<div class='fin-card good'><b>🛟 Подушка: {money(sav)} из {money(reserve_target)}</b><br><span class='small'>Не обнуляй её ради обычной покупки. Это твой настоящий резерв.</span></div>",unsafe_allow_html=True)
    cards=[x for x in d['debts'] if x.get('type')=='Кредитная карта']
    if any(x.get('new_spending') for x in cards): st.warning('Есть кредитка, где разрешены новые покупки. Пока есть долг, это повышает риск нового витка задолженности.')

    # next payments and forecast
    cal=payment_calendar(d,1)
    fc, months, interest=simulate_payoff(d,float(d['settings'].get('extra_debt_payment',0)))
    c1,c2=st.columns(2)
    with c1:
        st.subheader('Ближайшие платежи')
        if not cal.empty:
            st.dataframe(cal.head(5).assign(Сумма=lambda x:x['Сумма'].map(money)),hide_index=True,use_container_width=True)
        else: st.success('Нет обязательных платежей.')
    with c2:
        st.subheader('Прогноз')
        if debt<=0: st.success('Долгов нет 🎉')
        elif months>=240: st.warning('С текущими параметрами долг не закрывается в пределах 20 лет. Проверь минимальные платежи и ставки.')
        else:
            payoff=(date.today().replace(day=1)+pd.DateOffset(months=months)).date()
            st.metric('Ориентир выхода из долгов',payoff.strftime('%m.%Y'))
            st.caption(f"При дополнительном платеже {money(d['settings'].get('extra_debt_payment',0))} в месяц. Прогноз расчетный.")

elif page=='Бюджет месяца':
    st.title('🧩 Бюджет месяца')
    income=float(d['profile'].get('monthly_income',0)); mandatory=mandatory_total(d); essential=float(d['profile'].get('essential_budget',0)); reserve=float(d['settings'].get('reserve_monthly',0)); extra=float(d['settings'].get('extra_debt_payment',0))
    planned=mandatory+essential+reserve+extra; free=income-planned
    c1,c2,c3=st.columns(3); c1.metric('Доход',money(income)); c2.metric('Запланировано',money(planned)); c3.metric('Остаток',money(free))
    rows=[('Обязательные платежи',mandatory),('Жизнь',essential),('Подушка',reserve),('Досрочно долги',extra),('Свободно',max(0,free))]
    df=pd.DataFrame(rows,columns=['Категория','Сумма'])
    fig=px.pie(df[df['Сумма']>0],names='Категория',values='Сумма',hole=.55)
    st.plotly_chart(fig,use_container_width=True)
    if free<0:
        st.error(f'План превышает доход на {money(abs(free))}. Сначала уменьши необязательные траты или дополнительный досрочный платеж.')
    else:
        weekly=max(0,free)/4.3
        st.markdown(f"<div class='fin-card info'><b>Безопасный свободный лимит ≈ {money(weekly)} в неделю</b><br><span class='small'>Это ориентир после того, как деньги на обязательные платежи, жизнь, подушку и досрочное погашение уже зарезервированы.</span></div>",unsafe_allow_html=True)

elif page=='Календарь':
    st.title('📅 Календарь платежей')
    cal=payment_calendar(d,3)
    if cal.empty: st.info('Добавь долги и дни платежей.')
    else:
        cal2=cal.copy(); cal2['Через дней']=(pd.to_datetime(cal2['Дата'])-pd.Timestamp(date.today())).dt.days
        cal2['Сумма']=cal2['Сумма'].map(money)
        st.dataframe(cal2,hide_index=True,use_container_width=True)
        soon=cal[(pd.to_datetime(cal['Дата'])-pd.Timestamp(date.today())).dt.days<=7]
        if not soon.empty: st.warning(f'В ближайшие 7 дней платежей на {money(soon["Сумма"].sum())}.')

elif page=='Прогноз долгов':
    st.title('📉 Прогноз выхода из долгов')
    extra=st.slider('Дополнительный платеж сверх обязательных, ₽/мес.',0,50000,int(d['settings'].get('extra_debt_payment',15000)),1000)
    d['settings']['extra_debt_payment']=float(extra)
    fc,months,interest=simulate_payoff(d,extra)
    if fc.empty: st.success('Долгов нет 🎉')
    else:
        fig=px.line(fc,x='Месяц',y='Общий долг',markers=True)
        fig.update_layout(yaxis_title='Остаток долга, ₽',xaxis_title='')
        st.plotly_chart(fig,use_container_width=True)
        c1,c2,c3=st.columns(3)
        if months<240:
            payoff=(date.today().replace(day=1)+pd.DateOffset(months=months)).date()
            c1.metric('До нулевого долга',f'{months} мес.')
            c2.metric('Ориентир',payoff.strftime('%m.%Y'))
        else:
            c1.metric('Горизонт','>20 лет'); c2.metric('Ориентир','—')
        c3.metric('Расчётные проценты',money(interest))
        st.caption('Модель приблизительная: проценты начисляются ежемесячно, досрочные платежи направляются на приоритетный долг. Реальный банковский график может отличаться.')

elif page=='Куда направить деньги':
    st.title('⚖️ Куда направить свободные деньги')
    amount=st.number_input('Свободная сумма',min_value=0.0,value=float(d['settings'].get('scenario_amount',10000)),step=1000.0)
    d['settings']['scenario_amount']=float(amount)
    target,best_sav,debt_gain,sav_gain=scenario_compare(d,amount)
    reserve_gap=max(0,float(d['profile'].get('reserve_target',0))-total_savings(d))
    cols=st.columns(3)
    with cols[0]:
        st.markdown("<div class='fin-card good'><div class='big'>🛟 В подушку</div></div>",unsafe_allow_html=True)
        st.write(f'Текущий дефицит подушки: **{money(reserve_gap)}**')
        st.write('Подходит, если резерв еще слишком маленький и непредвиденная трата снова загонит в кредит.')
    with cols[1]:
        st.markdown("<div class='fin-card warn'><div class='big'>💳 В долг</div></div>",unsafe_allow_html=True)
        if target:
            st.write(f'Приоритет: **{target["name"]}**')
            st.write(f'Долг уменьшится сразу на **{money(min(amount,target["balance"]))}**.')
            if debt_gain is not None: st.caption(f'Грубая экономия процентов за год при неизменном остатке: до {money(debt_gain)}.')
        else: st.write('Активных долгов нет.')
    with cols[2]:
        st.markdown("<div class='fin-card info'><div class='big'>🏦 На вклад</div></div>",unsafe_allow_html=True)
        if best_sav:
            st.write(f'Лучший указанный счет: **{best_sav["name"]}**, ставка {float(best_sav.get("apr",0)):.1f}%')
            if sav_gain is not None: st.caption(f'Грубый доход за год: около {money(sav_gain)} до налоговых/банковских нюансов.')
        else: st.write('Нет накопительного счета.')
    if reserve_gap>0 and total_savings(d)<min(30000,float(d['profile'].get('reserve_target',0))):
        st.success('Рекомендация: сначала укрепить маленькую подушку, затем ускорять дорогой долг.')
    elif target and float(target.get('apr',0))>0 and (not best_sav or float(target.get('apr',0))>=float(best_sav.get('apr',0))):
        st.success(f'Рекомендация: при текущих ставках приоритетнее направить деньги в «{target["name"]}».')
    elif target and float(target.get('apr',0))==0:
        st.info('Для точного сравнения добавь реальные процентные ставки по долгам и вкладам.')
    else:
        st.success('Если долгов нет, свободные деньги можно направлять в подушку и накопительные цели.')

elif page=='Пришла зарплата':
    st.title('💰 Мне пришли деньги')
    amount=st.number_input('Сколько пришло?',min_value=0.0,value=float(d['profile']['monthly_income']),step=1000.0)
    steps=allocate_income(amount,d) if amount>0 else []
    for title,val,why in steps:
        if val>0: st.markdown(f"<div class='fin-card'><b>{title}: {money(val)}</b><br><span class='small'>{why}</span></div>",unsafe_allow_html=True)
    note=st.text_input('Комментарий',placeholder='Например: зарплата за август')
    if st.button('Записать поступление в историю',type='primary',use_container_width=True):
        log_event('Доход',amount,note or 'Поступление денег'); st.success('Записано.'); st.rerun()

elif page=='Хочу потратить':
    st.title('🛍️ Я хочу что-то купить')
    name=st.text_input('Что хочется купить?',placeholder='Например: одежда')
    price=st.number_input('Цена',min_value=0.0,step=500.0)
    monthly_income=float(d['profile'].get('monthly_income',0)); mandatory=mandatory_total(d); essential=float(d['profile'].get('essential_budget',0)); reserve=float(d['settings'].get('reserve_monthly',0)); extra=float(d['settings'].get('extra_debt_payment',0))
    safe=max(0,monthly_income-mandatory-essential-reserve-extra)
    if price>0:
        if price<=safe:
            st.success(f'Покупка помещается в текущий свободный месячный остаток {money(safe)}, если остальные категории уже зарезервированы.')
        else:
            st.warning(f'Покупка превышает свободный месячный остаток на {money(price-safe)}.')
        target=priority_debt(d)
        if target:
            before_fc,bm,_=simulate_payoff(d,extra)
            # compare as if same money becomes one-time debt reduction by temporarily reducing target balance
            clone=json.loads(json.dumps(d)); t=priority_debt(clone)
            if t: t['balance']=max(0,float(t['balance'])-price)
            after_fc,am,_=simulate_payoff(clone,extra)
            gain=max(0,bm-am)
            st.markdown(f"<div class='fin-card warn'><b>Цена решения</b><br>Если вместо покупки направить {money(price)} в «{target['name']}», долг уменьшится сразу. По модели это может приблизить выход из долгов примерно на <b>{gain} мес.</b></div>",unsafe_allow_html=True)
        c1,c2=st.columns(2)
        if c1.button('⏳ Отложить на 72 часа',type='primary',use_container_width=True):
            d['wishes'].append({'name':name or 'Покупка','price':price,'created':datetime.now().isoformat(),'review_after':(datetime.now()+timedelta(hours=72)).isoformat(),'status':'wait'})
            log_event('Пауза 72 часа',price,name or 'Покупка'); st.success('Покупка поставлена на паузу.'); st.rerun()
        if c2.button('Я всё равно решила купить',use_container_width=True):
            log_event('Покупка',-price,name or 'Покупка'); st.warning('Решение записано. После покупки обнови остаток на соответствующей карте.')
    st.subheader('На паузе')
    waits=[w for w in d['wishes'] if w.get('status')=='wait']
    if not waits: st.caption('Нет покупок на паузе.')
    for w in waits:
        ready=datetime.now()>=datetime.fromisoformat(w['review_after'])
        st.markdown(f"<div class='fin-card'><b>{w['name']} — {money(w['price'])}</b><br><span class='small'>{'Можно пересмотреть решение' if ready else '72-часовая пауза ещё действует'}</span></div>",unsafe_allow_html=True)

elif page=='Счета':
    st.title('🏦 Счета и накопления')
    st.caption('Только условные названия — никаких реквизитов.')
    types=['Дебетовая карта','Наличные','Накопления','Вклад','Накопительный счет']
    for i,a in enumerate(list(d['accounts'])):
        with st.expander(f"{a['name']} · {money(a['balance'])}"):
            a['name']=st.text_input('Название',a['name'],key=f'an{i}')
            a['type']=st.selectbox('Тип',types,index=types.index(a['type']) if a['type'] in types else 0,key=f'at{i}')
            a['balance']=st.number_input('Реальный остаток',min_value=0.0,value=float(a['balance']),step=500.0,key=f'ab{i}')
            if a['type'] in ['Накопления','Вклад','Накопительный счет']:
                a['apr']=st.number_input('Ставка, % годовых',min_value=0.0,max_value=100.0,value=float(a.get('apr',0)),step=.1,key=f'aapr{i}')
            if st.button('Удалить',key=f'ad{i}'):
                d['accounts'].pop(i); st.rerun()
    if st.button('➕ Добавить счет'):
        d['accounts'].append({'name':f'Карта {len(d["accounts"])+1}','type':'Дебетовая карта','balance':0.0,'apr':0.0}); st.rerun()

elif page=='Долги':
    st.title('💳 Кредиты и кредитные карты')
    st.caption('Только название и параметры долга. Номера карт не нужны.')
    for i,x in enumerate(list(d['debts'])):
        with st.expander(f"{x['name']} · долг {money(x['balance'])}"):
            x['name']=st.text_input('Название',x['name'],key=f'dn{i}')
            x['type']=st.selectbox('Тип',['Кредит','Кредитная карта'],index=0 if x['type']=='Кредит' else 1,key=f'dt{i}')
            x['balance']=st.number_input('Остаток долга',min_value=0.0,value=float(x['balance']),step=1000.0,key=f'db{i}')
            x['apr']=st.number_input('Ставка, % годовых',min_value=0.0,max_value=100.0,value=float(x.get('apr',0)),step=.1,key=f'da{i}')
            x['min_payment']=st.number_input('Обязательный платеж',min_value=0.0,value=float(x.get('min_payment',0)),step=500.0,key=f'dm{i}')
            x['due_day']=st.number_input('День платежа',min_value=1,max_value=31,value=int(x.get('due_day',25)),key=f'dday{i}')
            if x['type']=='Кредитная карта':
                x['grace_end']=st.text_input('Конец льготного периода',x.get('grace_end',''),placeholder='2026-12-31',key=f'dg{i}')
                x['new_spending']=st.toggle('Разрешаю новые покупки по этой кредитке',value=bool(x.get('new_spending',False)),key=f'ds{i}')
                if x['new_spending']: st.warning('Кредитный лимит — не резерв. Новые покупки могут замедлить выход из долгов.')
            if st.button('Удалить долг',key=f'ddel{i}'):
                d['debts'].pop(i); st.rerun()
    if st.button('➕ Добавить долг'):
        d['debts'].append({'name':f'Долг {len(d["debts"])+1}','type':'Кредит','balance':0.0,'apr':0.0,'min_payment':0.0,'due_day':25,'grace_end':'','new_spending':False}); st.rerun()

elif page=='История':
    st.title('📜 История решений')
    if d['history']:
        df=pd.DataFrame(d['history']); df['date']=pd.to_datetime(df['date']); df=df.sort_values('date',ascending=False)
        st.dataframe(df.rename(columns={'date':'Дата','kind':'Событие','amount':'Сумма','note':'Комментарий'}),use_container_width=True,hide_index=True)
    else: st.info('История пока пустая.')

elif page=='Настройки':
    st.title('⚙️ Настройки')
    d['profile']['monthly_income']=st.number_input('Обычный месячный доход',min_value=0.0,value=float(d['profile']['monthly_income']),step=1000.0)
    d['profile']['essential_budget']=st.number_input('Необходимые расходы на месяц',min_value=0.0,value=float(d['profile']['essential_budget']),step=1000.0)
    d['profile']['reserve_target']=st.number_input('Цель подушки',min_value=0.0,value=float(d['profile']['reserve_target']),step=5000.0)
    d['settings']['reserve_monthly']=st.number_input('Ежемесячно в подушку',min_value=0.0,value=float(d['settings']['reserve_monthly']),step=1000.0)
    d['settings']['weekly_fun_budget']=st.number_input('Недельный бюджет на необязательные траты',min_value=0.0,value=float(d['settings']['weekly_fun_budget']),step=500.0)
    d['settings']['extra_debt_payment']=st.number_input('Плановый дополнительный платеж по долгам',min_value=0.0,value=float(d['settings'].get('extra_debt_payment',15000)),step=1000.0)
    st.divider(); st.subheader('🔐 Резервная копия')
    st.warning('На Streamlit Community Cloud данные сессии не являются постоянным хранилищем. Регулярно скачивай зашифрованную резервную копию.')
    backup=encrypt_backup(d,st.session_state.master_password)
    st.download_button('⬇️ Скачать зашифрованную копию',backup,file_name=f'fin_shturman_backup_{date.today().isoformat()}.fin',mime='application/octet-stream',use_container_width=True)
    up=st.file_uploader('Восстановить из .fin',type=['fin'])
    if up and st.button('Восстановить данные',type='primary'):
        try:
            st.session_state.data=decrypt_backup(up.read(),st.session_state.master_password); st.success('Данные восстановлены.'); st.rerun()
        except Exception: st.error('Не удалось расшифровать. Проверь файл и пароль.')
    if st.button('🔒 Заблокировать приложение',use_container_width=True):
        st.session_state.unlocked=False; st.session_state.master_password=''; st.rerun()
    st.caption('Не используй банковский пароль. Не вводи номера карт, CVV, логины или SMS-коды.')
