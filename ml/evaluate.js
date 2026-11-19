import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {HOUR,HISTORY,HORIZON,artifact,features,loadData,samples,seasonal,targets} from './preprocess.js';
import {tf,initBackend,loadModel} from './model.js';

export function xTensor(refs,sites,stats) {
  return tf.tensor3d(refs.map(({k,i})=>features(sites[k],stats[k],i,k,sites.length)),
    [refs.length,HISTORY,7+sites.length]);
}
export function predictBatch(model,refs,sites,stats) {
  return tf.tidy(()=>model.predict(xTensor(refs,sites,stats)).arraySync())
    .map((row,i)=>row.map(value=>Math.max(0,value*stats[refs[i].k].scale)));
}
const accumulator = () => ({n:0, absolute:0,squared:0});
function accumulate(a,actual,predicted) {
  if (!Number.isFinite(predicted)) throw Error('Non-finite prediction');
  const error=predicted-actual;
  a.n++; a.absolute+=Math.abs(error); a.squared+=error**2;
}
const metrics = a => ({n:a.n,mae:a.n?a.absolute/a.n:null,rmse:a.n?Math.sqrt(a.squared/a.n):null});
export function evaluate(model,refs,sites,stats) {
  const total=accumulator();
  const perSite=sites.map(accumulator);
  const horizon=Array.from({length:HORIZON},accumulator);
  let example;
  for (let offset=0;offset<refs.length;offset+=128) {
    const batch=refs.slice(offset,offset+128);
    const predictions=model?predictBatch(model,batch,sites,stats):batch.map(({k,i})=>seasonal(sites[k],stats[k],i));
    batch.forEach(({k,i},b)=>{
      const actual=targets(sites[k],i);
      const predicted=predictions[b];
      actual.forEach((value,h)=>{
        if(value<0) return;
        for (const a of [total,perSite[k],horizon[h]]) accumulate(a,value,predicted[h]);
      });
      if (!example && actual.filter(y=>y>=0).length===24) example={site:sites[k].id,
        origin:new Date(sites[k].start+i*HOUR),actual,predicted};
    });
  }
  return {...metrics(total),origins:refs.length,perSite:Object.fromEntries(sites.map((s,k)=>[s.id,metrics(perSite[k])])),
    byHorizon:horizon.map((a,h)=>({hour:h+1,...metrics(a)})),example};
}
export async function evaluateAll(sites,stats,runtime) {
  const reports={};
  const partitions=Object.fromEntries(['val','test'].map(part=>[part,samples(sites,part)]));
  for (const name of ['seasonal','lstm','hybrid']) {
    const model=name==='seasonal'?null:await loadModel(name);
    reports[name]={};
    for (const [partition,refs] of Object.entries(partitions)) {
      reports[name][partition]=evaluate(model,refs,sites,stats);
      const {n,mae,rmse}=reports[name][partition];
      console.log(name,partition,{n,mae,rmse});
    }
    model?.dispose();
  }
  const selected=Object.keys(reports).sort((a,b)=>reports[a].val.mae-reports[b].val.mae)[0];
  const output={runtime,selected,models:reports};
  writeFileSync(artifact('metrics.json'),JSON.stringify(output,null,2));
  return output;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const runtime=process.env.TF_BACKEND??'wasm';
  await initBackend(runtime);
  const {sites,quality}=loadData();
  const config=JSON.parse(readFileSync(artifact('training.json'),'utf8'));
  if(config.dataSha256!==quality.acn.sha256) throw Error('Training dataset checksum differs');
  await evaluateAll(sites,config.stats,runtime);
}
