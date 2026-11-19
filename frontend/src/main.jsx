import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {api,socket} from './services/api.js';
import {EnergyChart} from './charts/EnergyChart.jsx';
import {Evidence} from './components/Evidence.jsx';
import {names,number,dateLabel,money} from './components/format.js';
import './style.css';

const initial={startSoc:25,targetSoc:75,deadline:12,mode:'AC',connector:'CCS',chargerKw:11,
  vehicleAcKw:11,siteLimitKw:100,congestionRate:0.12,efficiency:0.9};

function NumberField({label,value,onChange,min,max,step=1}) {
  return <label>{label}<input type="number" required value={value} min={min} max={max} step={step} onChange={e=>onChange(e.target.value)}/></label>;
}
function App() {
  const [tab,setTab]=useState('Planner');
  const [catalogue,setCatalogue]=useState(null);
  const [evidence,setEvidence]=useState(null);
  const [quality,setQuality]=useState(null);
  const [site,setSite]=useState('');
  const [model,setModel]=useState('');
  const [customOrigin,setCustomOrigin]=useState('');
  const [vehicleId,setVehicleId]=useState('1');
  const [vehicleFilter,setVehicleFilter]=useState('');
  const [profile,setProfile]=useState('');
  const [forecast,setForecast]=useState(null);
  const [inputs,setInputs]=useState(initial);
  const [tariff,setTariff]=useState('');
  const [plan,setPlan]=useState(null);
  const [twin,setTwin]=useState(null);
  const [km,setKm]=useState('25');
  const [online,setOnline]=useState(socket.connected);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [comparison,setComparison]=useState(null);
  const [saved,setSaved]=useState([]);

  function updateTwin(next) {
    setTwin(current=>current&&current.id===next.id&&current.version>next.version?current:next);
  }
  useEffect(()=>{
    let live=true;
    Promise.all([api('/catalogue'),api('/metrics'),api('/data-quality'),api('/profile'),api('/plans')])
      .then(([c,m,q,p,plans])=>{
        if(!live) return;
        setCatalogue(c); setEvidence(m); setQuality(q); setSaved(plans);
        setSite(c.sites[0].id);setModel(c.selected);
        if(p){setProfile(p.name);setVehicleId(p.vehicleId);}
        return api('/forecasts','POST',{siteId:c.sites[0].id,model:c.selected}).then(f=>{if(live)setForecast(current=>current??f);});
      }).catch(e=>{if(live)setError(e.message);});
    function connection(){setOnline(socket.connected);}
    function receive(next) {
      setTwin(current=>current?.id===next.id&&next.version>=current.version?next:current);
    }
    socket.on('connect',connection).on('disconnect',connection).on('twin:update',receive);
    return ()=>{live=false;socket.off('connect',connection).off('disconnect',connection).off('twin:update',receive);};
  },[]);
  useEffect(()=>{
    if(!twin?.id||!online) return;
    let live=true;
    api('/twins/'+twin.id).then(next=>{
      if(live) setTwin(current=>current?.id===next.id&&next.version>=current.version?next:current);
    }).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[online,twin?.id]);
  const run=fn=>async event=>{
    event?.preventDefault();
    setBusy(true);setError('');
    try {await fn();} catch(e){setError(e.message);} finally{setBusy(false);}
  };
  const field=(name,label,min,max,step)=> <NumberField label={label} value={inputs[name]} min={min} max={max} step={step}
    onChange={v=>setInputs(i=>({...i,[name]:v}))}/>;
  const selected=catalogue?.vehicles.find(v=>v.id===vehicleId);
  const siteInfo=catalogue?.sites.find(s=>s.id===site);
  const filtered=catalogue?.vehicles.filter(v=>v.id===vehicleId||
    (v.brand+' '+v.model).toLowerCase().includes(vehicleFilter.toLowerCase()));
  const refreshForecast=run(async()=>{
    setForecast(await api('/forecasts','POST',{siteId:site,model,
      ...(customOrigin?{origin:customOrigin+':00Z'}:{})}));
    setPlan(null);setTwin(null);
  });
  const makePlan=run(async()=>{
    const payload=Object.fromEntries(Object.entries(inputs).map(([k,v])=>
      [k,['mode','connector'].includes(k)?v:Number(v)]));
    const next=await api('/plans','POST',{...payload,vehicleId,forecastId:forecast.id,
      ...(tariff.trim()?{tariffs:tariff.split(',').map(s=>s.trim()===''?null:Number(s))}:{})});
    setPlan(next);setTwin(null);setSaved(items=>[next,...items].slice(0,15));
  });
  const act=(action)=>run(async()=>updateTwin(await api('/twins/'+twin.id+'/actions','POST',
    {action,...(action==='drive'?{km:Number(km)}:{})})));

  return <>
    <header><div className="header-inner"><div className="brand"><span className="mark" aria-hidden="true">ϟ</span><div>EV-OptiGrid <small>2.0</small><span>Charging intelligence</span></div></div>
      <nav aria-label="Main navigation">{['Planner','Model results','Saved plans'].map(t=><button className={tab===t?'current':''} aria-current={tab===t?'page':undefined} key={t} onClick={()=>setTab(t)}>{t}</button>)}</nav>
      <span className="connection"><i className={online?'on':''}/>{online?'Live simulator link':'Simulator link offline'}</span>
    </div></header>
    <main>
      <div className="hero"><div><p className="eyebrow">EV CHARGING PLATFORM</p><h1>{tab==='Planner'?'Plan an EV charge':tab}</h1>
      <p>{tab==='Planner'?'Replay historical site demand, compare charging plans, and run a battery simulation.':
        tab==='Model results'?'Compare the trained models using unseen ACN measurements.':'Reopen a charging schedule or its most recent battery simulation.'}</p></div>
      <span className="scope">Historical data · Simulated charging</span></div>
      {error&&<p className="notice error" role="alert">{error}</p>}
      {tab==='Model results'&&<Evidence record={evidence} quality={quality}/>}
      {tab==='Saved plans'&&<section className="card"><h2>Recent charging plans</h2>
        {!saved.length?<p>No plans saved yet.</p>:<div className="saved">{saved.map(p=><button key={p.id} disabled={busy} className="record"
          onClick={run(async()=>{const [f,twins]=await Promise.all([api('/forecasts/'+p.forecastId),api('/twins?planId='+p.id)]);
            setForecast(f);setPlan(p);setTwin(twins.find(t=>t.planId===p.id)??null);
            setSite(p.siteId);setVehicleId(p.vehicleId);setModel(f.model);setCustomOrigin(f.origin.slice(0,16));
            setInputs({...initial,...p.inputs});setTariff(p.inputs?.tariffs?.join(',')??'');setTab('Planner');})}>
          <strong>{catalogue?.vehicles.find(v=>v.id===p.vehicleId)?.model??'EV'}</strong><span>{dateLabel(p.origin)}</span>
          <span>{p.feasible?'Feasible':'Shortfall'} · {money(p.recommended.cost)}</span></button>)}</div>}
      </section>}
      {tab==='Planner'&&(!catalogue?<p>Loading datasets and model artefacts…</p>:<div className="stack">
        <div className="overview"><div><span>Hourly ACN records</span><strong>{quality.acn.rows.toLocaleString()}</strong></div>
          <div><span>Charging sites</span><strong>{catalogue.sites.length}</strong></div>
          <div><span>EV catalogue records</span><strong>{catalogue.vehicles.length}</strong></div>
          <div><span>Forecast horizon</span><strong>24 <small>hours</small></strong></div></div>
        <section className="card"><div className="section-head"><div><h2>Site demand forecast</h2><p>Hourly charging energy · kWh</p></div>
          {forecast&&<span className="tag">{forecast.mode}</span>}</div>
          <form onSubmit={refreshForecast} className="form-grid forecast-form">
            <label>Charging site<select value={site} onChange={e=>{setSite(e.target.value);setCustomOrigin('');}}>
              {catalogue.sites.map(s=><option key={s.id}>{s.id}</option>)}</select></label>
            <label>Forecast model<select value={model} onChange={e=>setModel(e.target.value)}>
              {Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
            <label>Origin (UTC, optional)<input type="datetime-local" step="3600" min={siteInfo.testStart.slice(0,16)}
              max={siteInfo.nextAfterDataset.slice(0,16)} value={customOrigin} onChange={e=>setCustomOrigin(e.target.value)}/></label>
            <button className="primary" disabled={busy}>Run forecast</button>
          </form>
          {forecast?<><p className="muted">{forecast.siteId} · {dateLabel(forecast.origin)} · {forecast.inputObservedHours}/168 measured input hours</p>
            <EnergyChart series={[{label:names[forecast.model],color:'#0c8067',values:forecast.hours.map(h=>h.predictedKwh)},
              {label:'Measured energy',color:'#bf773c',values:forecast.hours.map(h=>h.actualKwh)}]}/>
            <details><summary>View hourly data (UTC)</summary><div className="scroll"><table><thead><tr><th>Hour</th><th>Forecast kWh</th><th>Measured kWh</th></tr></thead>
              <tbody>{forecast.hours.map(h=><tr key={h.timestamp}><td>{dateLabel(h.timestamp)}</td><td>{number(h.predictedKwh)}</td><td>{number(h.actualKwh)}</td></tr>)}</tbody></table></div></details>
          </>:<p>Preparing the first historical replay…</p>}
        </section>
        <div className="columns">
          <section className="card"><h2>Vehicle and charging inputs</h2>
            <form onSubmit={makePlan} className="form-grid">
              <label>Find a vehicle<input placeholder="Search make or model" value={vehicleFilter} onChange={e=>setVehicleFilter(e.target.value)}/></label>
              <label>Vehicle model<select value={vehicleId} onChange={e=>setVehicleId(e.target.value)}>
                {filtered.map(v=><option key={v.id} value={v.id}>{v.brand} {v.model}</option>)}</select></label>
              <p className="wide vehicle-spec">{selected.capacityKwh} kWh battery · {selected.efficiencyWhKm} Wh/km · {selected.rangeKm} km catalogue range
                <br/>DC: {selected.connector??'Unknown'} · {selected.dcKw??'—'} kW</p>
              {field('startSoc','Current SOC (%)',0,100)}{field('targetSoc','Target SOC (%)',0,100)}
              {field('deadline','Hours to departure',1,24)}{field('efficiency','Charging efficiency',0.01,1,0.01)}
              <label>Charging mode<select value={inputs.mode} onChange={e=>setInputs(i=>({...i,mode:e.target.value}))}><option>AC</option><option>DC</option></select></label>
              {field('chargerKw','Charger limit (kW)',0.1,500,0.1)}
              {inputs.mode==='AC'?field('vehicleAcKw','Assumed onboard AC limit (kW)',0.1,43,0.1):
                <label>DC connector<input required value={inputs.connector} onChange={e=>setInputs(i=>({...i,connector:e.target.value}))}/></label>}
              {field('siteLimitKw','Scenario site limit (kW)',0.1,10000,0.1)}
              {field('congestionRate','Congestion preference (USD/kWh)',0,10,0.01)}
              <label>Custom tariffs (USD/kWh)<input placeholder="Comma-separated hourly rates" value={tariff} onChange={e=>setTariff(e.target.value)}/></label>
              <button className="primary wide" disabled={busy||!forecast}>Optimize charging</button>
            </form>
            <details><summary>Save vehicle preference</summary><form className="profile" onSubmit={run(async()=>{const p=await api('/profile','PUT',{name:profile,vehicleId});setProfile(p.name);setTab('Saved plans');})}>
              <label>Demo profile name<input value={profile} required maxLength="80" onChange={e=>setProfile(e.target.value)}/></label>
              <button disabled={busy}>Save profile</button></form></details>
          </section>
          <section className="card plan"><h2>Charging schedule</h2>
            {!plan?<p className="empty">Generate a plan to compare cost, departure SOC, and charging slots.</p>:<>
              <p className={plan.feasible?'notice success':'notice warning'}>{plan.feasible?'Target SOC is reachable':number(plan.recommended.shortfallBatteryKwh)+' kWh battery shortfall by departure'}</p>
              <p>{plan.siteId} · {dateLabel(plan.origin)} · {catalogue.vehicles.find(v=>v.id===plan.vehicleId)?.model}</p>
              <div className="plan-metrics"><div>Plan cost<strong>{money(plan.recommended.cost)}</strong></div>
                <div>Charge ASAP<strong>{money(plan.earliestCost)}</strong></div><div>Departure SOC<strong>{number(plan.recommended.endSoc,1)}%</strong></div></div>
              <p className="muted">{plan.tariffSource} · Scenario estimate</p>
              <div className="scroll"><table><thead><tr><th>UTC hour</th><th>Tariff</th><th>Charge kWh</th><th>SOC</th></tr></thead>
                <tbody>{plan.recommended.schedule.map(h=><tr key={h.index}><td>{h.timestamp.slice(11,16)}</td>
                  <td>{money(h.tariff)}</td><td>{number(h.energyKwh)}</td><td>{number(h.soc,1)}%</td></tr>)}</tbody></table></div>
              <button disabled={busy} onClick={run(async()=>setComparison({id:plan.id,sites:await api('/plans/'+plan.id+'/sites')}))}>Compare charging sites</button>
              {comparison?.id===plan.id&&<div className="scroll"><table><caption>Same departure, vehicle, tariff and assumed capacity · ranked by feasibility and objective</caption><thead><tr><th>Site</th><th>Result</th><th>Estimated cost</th></tr></thead>
                <tbody>{comparison.sites.map(s=><tr key={s.site}><td>{s.site}</td><td>{s.feasible?'Reachable':number(s.shortfall)+' kWh short'}</td><td>{money(s.cost)}</td></tr>)}</tbody></table></div>}
              <button className="primary" disabled={busy} onClick={run(async()=>updateTwin(await api('/twins','POST',{planId:plan.id})))}>Create digital twin</button>
            </>}
          </section>
        </div>
        {twin&&<section className="card twin"><div className="section-head"><div><h2>EV digital twin</h2><p>1.6 seconds per simulated charging hour</p></div><span className="tag">Simulated telemetry</span></div>
          <div className="plan-metrics"><div>Battery SOC<strong data-testid="twin-soc">{number(twin.soc,1)}%</strong></div>
            <div>Estimated range<strong>{number(twin.rangeKm,1)} km</strong></div><div>Grid energy<strong>{number(twin.gridKwh,1)} kWh</strong></div></div>
          <progress value={twin.soc} max="100" aria-label="Battery state of charge"/>
          <p role="status">{twin.status} · {twin.cursor}/{plan?.deadline} simulated hours</p>
          <div className="actions">{!twin.finished?(twin.running?<button disabled={busy} onClick={act('pause')}>Pause simulation</button>:
            <button className="primary" disabled={busy} onClick={act('start')}>Start simulation</button>):
            <form className="profile" onSubmit={act('drive')}><NumberField label="Driving distance (km)" value={km} onChange={setKm} min={0.01} max={10000} step={0.01}/>
              <button className="primary" disabled={busy}>Simulate drive</button></form>}</div>
          {twin.meterReadings?.length>0&&<details><summary>Station meter receipts ({twin.meterReadings.length})</summary><div className="scroll"><table>
            <thead><tr><th>Slot end (UTC)</th><th>Cumulative grid kWh</th><th>Protocol message</th></tr></thead><tbody>
            {twin.meterReadings.map(r=><tr key={r.messageId}><td>{dateLabel(r.timestamp)}</td><td>{number(r.cumulativeGridKwh)}</td><td>{r.action}</td></tr>)}</tbody></table></div></details>}
          {twin.events.length>0&&<details><summary>Telemetry history</summary><ul>{twin.events.slice().reverse().map((e,i)=>
            <li key={i}>{e.type} · {e.timestamp?dateLabel(e.timestamp):number(e.km,1)+' km'} · {number(e.soc,1)}% SOC</li>)}</ul></details>}
        </section>}
      </div>)}
    </main><footer>EV-OptiGrid 2.0 · ACN-Data historical replay</footer>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
