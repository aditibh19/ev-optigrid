import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadData,fitFeatures,samples,features,HISTORY,HORIZON} from '../ml/preprocess.js';
import {optimize} from '../optimization/chargingOptimizer.js';
import {createTwin,stepTwin,driveTwin} from '../simulator/evDigitalTwin.js';
import {demo} from '../simulator/ocppDemo.js';

const data=loadData();
test('preserves source counts, schema, missingness and valid catalogue vehicles',()=>{
  assert.equal(data.quality.acn.rows,104995);
  assert.equal(data.quality.ev.rows,478);
  assert.equal(data.quality.ev.columns.length,22);
  assert.equal(data.sites.length,7);
  assert.ok(data.quality.acn.sites.some(s=>s.unobserved>0));
  assert.equal(data.quality.ev.missing.model,1);
  assert.equal(new Set(data.vehicles.map(v=>v.sourceUrl)).size,478);
});
test('targets fit only in their chronological partition and features ignore future data',()=>{
  const stats=fitFeatures(data.sites);
  assert.equal(new Set(data.quality.acn.sites.map(s=>s.testStart.toISOString())).size,1);
  assert.equal(new Set(data.quality.acn.sites.map(s=>s.validationStart.toISOString())).size,1);
  for(const split of ['train','val','test']) {
    for(const {k,i} of samples(data.sites,split)) {
      const s=data.sites[k];
      const [from,to]={train:[HISTORY,s.trainEnd],val:[s.trainEnd,s.valEnd],test:[s.valEnd,s.rows.length]}[split];
      assert.ok(i>=from&&i+HORIZON<=to);
    }
  }
  const site=data.sites[0];
  const origin=site.trainEnd;
  const before=features(site,stats[0],origin,0,7);
  const modified={...site,rows:[...site.rows.slice(0,origin),{energy:999,active:999,observed:true}]};
  assert.deepEqual(features(modified,stats[0],origin,0,7),before);
});
const vehicle={id:'1',capacityKwh:40,efficiencyWhKm:200,dcKw:7,connector:'CCS'};
const forecast={siteId:'test',origin:'2020-01-01T00:00:00Z',model:'hybrid',
  hours:[8,2,0].map((predictedKwh,i)=>({timestamp:'2020-01-01T0'+i+':00:00Z',predictedKwh}))};
const p={startSoc:25,targetSoc:50,efficiency:0.8,mode:'DC',connector:'CCS',chargerKw:11,
  deadline:3,siteLimitKw:10,congestionRate:0,tariffs:[0.6,0.1,0.2]};
test('linear optimizer uses cheapest available slots with partial charging, and respects power',()=>{
  const plan=optimize(vehicle,forecast,p);
  assert.equal(plan.feasible,true);
  assert.equal(plan.cap,7);
  assert.deepEqual(plan.recommended.schedule.map(h=>h.energyKwh),[0,7,5.5]);
  assert.equal(plan.recommended.endSoc,50);
  assert.ok(plan.earliestCost>=plan.recommended.cost);
});
test('reports infeasible, incompatible and invalid inputs',()=>{
  const plan=optimize(vehicle,forecast,{...p,targetSoc:100});
  assert.equal(plan.feasible,false);
  assert.ok(plan.recommended.shortfallBatteryKwh>0);
  assert.throws(()=>optimize(vehicle,forecast,{...p,connector:'CHAdeMO'}),{status:422});
  assert.throws(()=>optimize(vehicle,forecast,{...p,deadline:2.5}),{status:400});
  assert.throws(()=>optimize(vehicle,forecast,{...p,efficiency:0}),{status:400});
});
test('twin simulates conservation, stop at departure, driving and battery depletion',()=>{
  const plan=optimize(vehicle,forecast,p);
  let twin=createTwin(plan,vehicle);
  for(let i=0;i<3;i++) twin=stepTwin(twin,plan);
  assert.equal(twin.soc,50);
  assert.equal(twin.gridKwh,12.5);
  assert.equal(twin.finished,true);
  assert.strictEqual(stepTwin(twin,plan),twin);
  const driven=driveTwin(twin,25);
  assert.equal(driven.soc,37.5);
  assert.equal(driveTwin(driven,999).soc,0);
});
test('virtual charger exchanges OCPP frames over loopback WebSocket',async()=>{
  assert.deepEqual(await demo(),['BootNotification','Heartbeat','StatusNotification']);
});
