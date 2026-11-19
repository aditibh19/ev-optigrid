import {bounded,chargingPower,InputError} from './batteryConstraints.js';

export const defaultTariff=timestamp=>{
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',
    hour:'2-digit',hourCycle:'h23'}).format(new Date(timestamp)));
  return hour>=16&&hour<21?0.34:hour>=8&&hour<16?0.21:0.12;
};
export function optimize(vehicle,forecast,p) {
  if (!p || !forecast.hours.length) throw new InputError('Charging inputs and a forecast are required');
  const startSoc=bounded(p.startSoc,0,100,'Current SOC');
  const targetSoc=bounded(p.targetSoc,startSoc,100,'Target SOC');
  const efficiency=bounded(p.efficiency,0.01,1,'Efficiency');
  const siteLimitKw=bounded(p.siteLimitKw,0.1,10000,'Scenario site capacity kW');
  const congestionRate=bounded(p.congestionRate,0,10,'Congestion preference');
  const chargerKw=bounded(p.chargerKw,0.1,500,'Charger kW');
  const deadline=bounded(p.deadline,1,forecast.hours.length,'Hours to departure');
  if (!Number.isInteger(deadline)) throw new InputError('Hours to departure must be a whole number');
  const cap=chargingPower(vehicle,p.mode,p.connector,chargerKw,p.vehicleAcKw);
  let tariffs=p.tariffs;
  if(tariffs!==undefined && (!Array.isArray(tariffs)||tariffs.length!==deadline))
    throw new InputError('Provide one tariff per hour through departure');
  const slots=forecast.hours.slice(0,deadline).map(({timestamp,predictedKwh},index)=>{
    const tariff=tariffs?bounded(tariffs[index],0,10,'Tariff'):defaultTariff(timestamp);
    const congestion=congestionRate*predictedKwh/siteLimitKw;
    return {index,timestamp,tariff,forecastKwh:predictedKwh,
      availableKwh:Math.min(cap,Math.max(0,siteLimitKw-predictedKwh)),
      objectiveRate:tariff+congestion};
  });
  const requestedKwh=(targetSoc-startSoc)/100*vehicle.capacityKwh/efficiency;
  function allocate(order) {
    const allocations=Array(deadline).fill(0);
    let remaining=requestedKwh;
    for(const s of order) {
      allocations[s.index]=Math.min(remaining,s.availableKwh);
      remaining-=allocations[s.index];
    }
    let soc=startSoc;
    const schedule=slots.map(s=>{
      const energyKwh=allocations[s.index];
      soc+=energyKwh*efficiency/vehicle.capacityKwh*100;
      return {...s,energyKwh,soc:Math.min(soc,targetSoc),cost:energyKwh*s.tariff,
        objectiveCost:energyKwh*s.objectiveRate};
    });
    return {schedule, endSoc:Math.min(soc,targetSoc), shortfallBatteryKwh:remaining*efficiency,
      cost:schedule.reduce((n,h)=>n+h.cost,0),objective:schedule.reduce((n,h)=>n+h.objectiveCost,0)};
  }
  const recommended=allocate([...slots].sort((a,b)=>a.objectiveRate-b.objectiveRate||a.index-b.index));
  const earliest=allocate(slots);
  const inputs={startSoc,targetSoc,deadline,mode:p.mode,
    ...(p.mode==='AC'?{vehicleAcKw:p.vehicleAcKw}:{connector:String(p.connector).trim()}),
    chargerKw,siteLimitKw,congestionRate,efficiency,...(tariffs?{tariffs}:{})};
  return {inputs,vehicleId:vehicle.id,siteId:forecast.siteId,origin:forecast.origin,model:forecast.model,
    startSoc,targetSoc,efficiency,requestedKwh,cap,mode:p.mode,siteLimitKw,deadline,
    feasible:recommended.shortfallBatteryKwh<1e-8,recommended,
    earliestCost:earliest.cost,earliestObjective:earliest.objective,
    costDifference:earliest.cost-recommended.cost,currency:'USD',tariffSource:tariffs?'user scenario':'illustrative California-local hours'};
}
