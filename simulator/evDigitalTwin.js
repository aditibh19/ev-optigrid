import {deliver} from './virtualCharger.js';
import {bounded} from '../optimization/batteryConstraints.js';

export function createTwin(plan,vehicle) {
  return {mode:'simulation',cursor:0,soc:plan.startSoc,gridKwh:0,drivenKm:0,
    capacityKwh:vehicle.capacityKwh,efficiencyWhKm:vehicle.efficiencyWhKm,
    rangeKm:plan.startSoc/100*vehicle.capacityKwh*1000/vehicle.efficiencyWhKm,
    status:'Ready',running:false,finished:false,version:0,events:[]};
}
export function stepTwin(twin,plan) {
  if(twin.finished) return twin;
  const slot=plan.recommended.schedule[twin.cursor];
  const remaining=Math.max(0,(plan.targetSoc-twin.soc)*twin.capacityKwh/100);
  const charge=deliver(slot,remaining,plan.efficiency);
  const soc=Math.min(plan.targetSoc,twin.soc+charge.batteryKwh/twin.capacityKwh*100);
  const cursor=twin.cursor+1;
  const finished=cursor===plan.recommended.schedule.length;
  return {...twin,cursor,finished,running:!finished&&twin.running,soc,
    rangeKm:soc/100*twin.capacityKwh*1000/twin.efficiencyWhKm,
    gridKwh:twin.gridKwh+charge.gridKwh,status:finished?'Departure':charge.status,
    events:[...twin.events,{type:charge.status,timestamp:slot.timestamp,soc,gridKwh:charge.gridKwh}]};
}
export function driveTwin(twin,km) {
  bounded(km,0.01,10000,'Drive distance km');
  const actual=Math.min(twin.rangeKm,km);
  const rangeKm=Math.max(0,twin.rangeKm-actual);
  const soc=rangeKm*twin.efficiencyWhKm/10/twin.capacityKwh;
  return {...twin,soc,rangeKm,drivenKm:twin.drivenKm+actual,running:false,
    status:actual<km?'Battery depleted':'Drive complete',
    events:[...twin.events,{type:'Drive',km:actual,soc}].slice(-60)};
}
