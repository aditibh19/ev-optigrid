import {readFileSync} from 'node:fs';
import {artifact,HOUR,HORIZON,HISTORY,loadData,seasonal} from './preprocess.js';
import {initBackend,loadModel} from './model.js';
import {predictBatch} from './evaluate.js';
import {InputError} from '../optimization/batteryConstraints.js';

export async function createForecaster() {
  const {sites,vehicles,quality}=loadData();
  const metrics=JSON.parse(readFileSync(artifact('metrics.json'),'utf8'));
  const config=JSON.parse(readFileSync(artifact('training.json'),'utf8'));
  if(config.dataSha256!==quality.acn.sha256) throw Error('Forecast model checksum mismatch');
  await initBackend(process.env.INFERENCE_BACKEND??'wasm');
  const models={lstm:await loadModel('lstm'),hybrid:await loadModel('hybrid')};
  const catalogue=sites.map(s=>{
    let bestOrigin=s.valEnd;
    let bestObserved=-1;
    for(let i=s.valEnd;i+HORIZON<=s.rows.length;i++) {
      const observed=s.rows.slice(i,i+HORIZON).filter(p=>p?.observed).length;
      if(observed>bestObserved) {bestOrigin=i;bestObserved=observed;}
    }
    return {id:s.id,testStart:new Date(s.start+s.valEnd*HOUR),lastReplay:new Date(s.start+(s.rows.length-HORIZON)*HOUR),
      nextAfterDataset:new Date(s.start+s.rows.length*HOUR),exampleOrigin:new Date(s.start+bestOrigin*HOUR)};
  });
  function forecast(siteId,origin,kind=metrics.selected) {
    const k=sites.findIndex(s=>s.id===siteId);
    if(k<0) throw new InputError('Unknown charging site',404);
    if(!['seasonal','lstm','hybrid'].includes(kind)) throw new InputError('Unknown forecast model');
    const site=sites[k];
    if(origin!==undefined&&typeof origin!=='string') throw new InputError('Origin must be a UTC date string');
    const time=origin===undefined?+catalogue[k].exampleOrigin:Date.parse(origin);
    const i=(time-site.start)/HOUR;
    if(!Number.isInteger(i)||i<Math.max(HISTORY,site.valEnd)||i>site.rows.length)
      throw new InputError('Origin must be a UTC hour in the site’s holdout or the hour after the dataset');
    const values=kind==='seasonal'?seasonal(site,config.stats[k],i):predictBatch(models[kind],[{k,i}],sites,config.stats)[0];
    return {siteId,origin:new Date(time).toISOString(),model:kind,mode:i===site.rows.length?'historical extrapolation':'historical replay',
      inputObservedHours:site.rows.slice(i-HISTORY,i).filter(p=>p?.observed).length,
      hours:values.map((predictedKwh,h)=>({timestamp:new Date(time+h*HOUR).toISOString(),
        predictedKwh,actualKwh:site.rows[i+h]?.observed?site.rows[i+h].energy:null}))};
  }
  return {forecast,catalogue,vehicles,metrics,quality,config,dispose:()=>Object.values(models).forEach(m=>m.dispose())};
}
