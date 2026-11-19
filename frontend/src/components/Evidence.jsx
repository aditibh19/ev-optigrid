import React from 'react';
import {EnergyChart} from '../charts/EnergyChart.jsx';
import {names,number} from './format.js';
export function Evidence({record,quality}) {
  if(!record) return <p>Loading experiment results…</p>;
  const {metrics,training}=record;
  const example=metrics.models.hybrid.test.example;
  return <div className="stack">
    <section className="card"><h2>Forecast benchmark</h2>
      <p>24-hour direct forecasts. Only measured targets count. Validation MAE selected <strong>{names[metrics.selected]}</strong> for the dashboard default.</p>
      <div className="scroll"><table><thead><tr><th>Model</th><th>Validation MAE</th><th>Test MAE</th><th>Test RMSE</th><th>Scored test pairs</th></tr></thead>
        <tbody>{Object.entries(metrics.models).map(([name,m])=><tr key={name}><td>{names[name]}</td>
          <td>{number(m.val.mae)}</td><td>{number(m.test.mae)}</td><td>{number(m.test.rmse)}</td><td>{m.test.n.toLocaleString()}</td></tr>)}</tbody>
      </table></div><p className="muted">MAE and RMSE in kWh per hourly target.</p>
    </section>
    {example&&<section className="card"><h2>Hybrid forecast on held-out data</h2><p>{example.site} · {example.origin}</p>
      <EnergyChart series={[{label:'CNN–BiLSTM–Attention',color:'#0c8067',values:example.predicted},
        {label:'Measured energy',color:'#bf773c',values:example.actual}]}/></section>}
    <section className="card"><h2>Error by forecast horizon</h2><EnergyChart series={Object.entries(metrics.models).map(([key,m],i)=>({
      label:names[key],values:m.test.byHorizon.map(h=>h.mae),color:['#bf773c','#5274a5','#0c8067'][i]}))}/></section>
    <section className="card"><h2>Training and validation loss</h2><p>Masked MSE on normalized energy. {training.trainOrigins.toLocaleString()} training origins.</p>
      <EnergyChart unit="normalized MSE" labels={Array.from({length:training.epochs},(_,i)=>'E'+(i+1))}
        series={Object.entries(training.runs).flatMap(([key,run],i)=>[
          {label:names[key]+' train',color:['#567eb0','#0c8067'][i],values:run.history.map(r=>r.loss)},
          {label:names[key]+' validation',color:['#805bb0','#bf773c'][i],values:run.history.map(r=>r.valLoss)}])}/>
    </section>
    {quality&&<section className="card"><h2>Dataset coverage</h2><p>{quality.acn.rows.toLocaleString()} ACN records and {quality.ev.rows} EV catalogue records.</p>
      <div className="scroll"><table><thead><tr><th>Charging site</th><th>Measured</th><th>Unmeasured</th><th>Absent</th><th>Test start (UTC)</th></tr></thead>
      <tbody>{quality.acn.sites.map(s=><tr key={s.site}><td>{s.site}</td><td>{s.observed}</td><td>{s.unobserved}</td><td>{s.absent}</td><td>{s.testStart.slice(0,16).replace('T',' ')}</td></tr>)}</tbody></table></div>
    </section>}
  </div>;
}
