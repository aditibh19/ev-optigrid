import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parse} from 'csv-parse/sync';

export const HOUR = 3600000;
export const HISTORY = 168;
export const HORIZON = 24;
export const artifact = name => new URL('./artifacts/' + name, import.meta.url);
const acnColumns='timestamp_utc site_id energy_kwh active_sessions observed_energy'.split(' ');
const evColumns=('brand model top_speed_kmh battery_capacity_kWh battery_type number_of_cells torque_nm '+
  'efficiency_wh_per_km range_km acceleration_0_100_s fast_charging_power_kw_dc fast_charge_port towing_capacity_kg '+
  'cargo_volume_l seats drivetrain segment length_mm width_mm height_mm car_body_type source_url').split(' ');
const csv = (name,expected) => {
  const bytes = readFileSync(new URL('../data/' + name, import.meta.url));
  const rows=parse(bytes,{bom:true,columns:header=>{
    if(header.length!==expected.length||new Set(header).size!==header.length||
      expected.some(key=>!header.includes(key))) throw Error('Unexpected columns in '+name);
    return header;
  },skip_empty_lines:true,trim:true});
  if(!rows.length) throw Error('Empty dataset '+name);
  return {rows,
    sha256:createHash('sha256').update(bytes).digest('hex')};
};
const numeric = value => value?.trim() ? Number(value) : NaN;
const optional = value => Number.isFinite(numeric(value)) ? Number(value) : null;
const positive = value => Number.isFinite(numeric(value)) && Number(value) > 0;

export function loadData() {
  const acn = csv('acn_hourly_load.csv',acnColumns);
  const ev = csv('ev_specifications.csv',evColumns);
  const lookup = new Map();
  for (const row of acn.rows) {
    const time = Date.parse(row.timestamp_utc);
    const energy = numeric(row.energy_kwh);
    const active = numeric(row.active_sessions);
    if (!row.site_id || !row.timestamp_utc.endsWith('Z') || !Number.isFinite(time) || time % HOUR ||
        !Number.isFinite(energy) || energy < 0 || !Number.isInteger(active) || active < 0 ||
        !['0','1'].includes(row.observed_energy)) throw Error('Invalid ACN row: ' + JSON.stringify(row));
    if (!lookup.has(row.site_id)) lookup.set(row.site_id, new Map());
    const points = lookup.get(row.site_id);
    if (points.has(time)) throw Error('Duplicate ACN site/hour: ' + row.site_id + ' ' + row.timestamp_utc);
    points.set(time, {energy, active, observed:row.observed_energy === '1'});
  }
  const sites = [...lookup].sort(([a],[b]) => a.localeCompare(b)).map(([id, points]) => {
    const times = [...points.keys()].sort((a,b) => a-b);
    const start = times[0];
    const length = (times.at(-1)-start)/HOUR + 1;
    const rows = Array.from({length}, (_, i) => points.get(start+i*HOUR) ?? null);
    const leading = rows.findIndex(p=>p?.observed);
    if (leading<0) throw Error('Site has no observed measurements: '+id);
    const usable = rows.slice(leading);
    return {id, start:start+leading*HOUR, rows:usable, rawStart:start, rawRows:rows, leading};
  });
  // A shared model must never train on a different site's future.
  const commonStart=Math.max(...sites.map(s=>s.start));
  const commonEnd=Math.min(...sites.map(s=>s.start+s.rows.length*HOUR));
  const commonHours=(commonEnd-commonStart)/HOUR;
  if (commonHours<7*24+3*HORIZON) throw Error('Shared site coverage is too short for a chronological split');
  const validationStart=commonStart+Math.floor(commonHours*.70)*HOUR;
  const testStart=commonStart+Math.floor(commonHours*.85)*HOUR;
  for (const site of sites) {
    site.trainEnd=(validationStart-site.start)/HOUR;
    site.valEnd=(testStart-site.start)/HOUR;
  }
  const missing = Object.fromEntries(Object.keys(ev.rows[0]).map(key =>
    [key,ev.rows.filter(row=>!row[key]).length]));
  const ids = new Set();
  const numericIssues=Object.fromEntries(['top_speed_kmh','number_of_cells','torque_nm',
    'acceleration_0_100_s','towing_capacity_kg','cargo_volume_l','seats','length_mm','width_mm','height_mm']
    .map(key=>[key,ev.rows.flatMap((row,i)=>row[key]&&(!Number.isFinite(numeric(row[key]))||numeric(row[key])<0)?
      [{line:i+2,value:row[key]}]:[])]));
  const vehicles = ev.rows.map((row,i) => {
    if (!row.brand || !positive(row.battery_capacity_kWh) || !positive(row.efficiency_wh_per_km) ||
        !positive(row.range_km) || (row.fast_charging_power_kw_dc && !positive(row.fast_charging_power_kw_dc))) {
      throw Error('Invalid EV row ' + (i+2));
    }
    const url = new URL(row.source_url);
    if (url.protocol !== 'https:' || url.hostname !== 'ev-database.org' || ids.has(url.href))
      throw Error('Invalid or duplicate EV source URL at row ' + (i+2));
    ids.add(url.href);
    return {id:String(i+1), brand:row.brand, model:row.model || 'Unnamed model',
      capacityKwh:Number(row.battery_capacity_kWh), efficiencyWhKm:Number(row.efficiency_wh_per_km),
      rangeKm:Number(row.range_km), dcKw:optional(row.fast_charging_power_kw_dc),
      connector:row.fast_charge_port || null, body:row.car_body_type, sourceUrl:url.href};
  });
  const quality = {acn:{rows:acn.rows.length, columns:Object.keys(acn.rows[0]), sha256:acn.sha256,
    split:{strategy:'shared UTC cutoffs at 70% and 85% of common calendar coverage',
      commonStart:new Date(commonStart),commonEndExclusive:new Date(commonEnd),
      validationStart:new Date(validationStart),testStart:new Date(testStart)},
    sites:sites.map(s=>({site:s.id, start:new Date(s.rawStart), modelingStart:new Date(s.start), leadingExcluded:s.leading, end:new Date(s.start+(s.rows.length-1)*HOUR),
      observed:s.rawRows.filter(p=>p?.observed).length, observedZero:s.rawRows.filter(p=>p?.observed&&p.energy===0).length,
      unobserved:s.rawRows.filter(p=>p&&!p.observed).length,
      unobservedNonzero:s.rawRows.filter(p=>p&&!p.observed&&p.energy>0).length,
      absent:s.rawRows.filter(p=>!p).length, hours:s.rawRows.length,
      measuredByPartition:[s.rows.slice(0,s.trainEnd),s.rows.slice(s.trainEnd,s.valEnd),
        s.rows.slice(s.valEnd)].map(rows=>rows.filter(p=>p?.observed).length),
      maxMeasuredKwh:Math.max(...s.rawRows.filter(p=>p?.observed).map(p=>p.energy)),
      validationStart:new Date(s.start+s.trainEnd*HOUR), testStart:new Date(s.start+s.valEnd*HOUR)}))},
    ev:{rows:ev.rows.length, columns:Object.keys(ev.rows[0]), missing, numericIssues, sha256:ev.sha256}};
  return {sites, vehicles, quality};
}

export function fitFeatures(sites) {
  return sites.map(site => {
    const hour = Array.from({length:168},()=>({sum:0,n:0}));
    let sum=0, sumSq=0, n=0;
    site.rows.slice(0,site.trainEnd).forEach((p,i)=>{
      if (!p?.observed) return;
      const bin = hour[weekly(site.start+i*HOUR)];
      bin.sum+=p.energy; bin.n++;
      sum+=p.energy; sumSq+=p.energy**2; n++;
    });
    if (!n) throw Error('No training observations for ' + site.id);
    return {id:site.id, scale:Math.max(1,Math.sqrt(sumSq/n)), mean:sum/n,
      weekly:hour.map(x=>x.n?x.sum/x.n:sum/n)};
  });
}
const weekly = time => Math.floor(time/HOUR)%168;
export const features = (site, stats, origin, siteIndex, count) =>
  Array.from({length:HISTORY}, (_,step)=>{
    const i = origin-HISTORY+step;
    const time = site.start+i*HOUR;
    const p = site.rows[i];
    const observed = p?.observed ?? false;
    const dailyAngle = (time/HOUR%24)*Math.PI/12;
    const weeklyAngle = weekly(time)*Math.PI/84;
    return [observed?p.energy/stats.scale:0, +observed, Math.log1p(p?.active??0),
      Math.sin(dailyAngle), Math.cos(dailyAngle), Math.sin(weeklyAngle), Math.cos(weeklyAngle),
      ...Array.from({length:count},(_,k)=>+(k===siteIndex))];
  });
export function samples(sites, split, stride=1) {
  return sites.flatMap((site, k)=>{
    const [start,end] = {train:[HISTORY,site.trainEnd], val:[site.trainEnd, site.valEnd],
      test:[site.valEnd,site.rows.length]}[split];
    const result=[];
    for(let i=Math.max(start,HISTORY); i+HORIZON<=end; i+=stride) {
      if (site.rows.slice(i,i+HORIZON).some(p=>p?.observed)) result.push({k,i});
    }
    return result;
  });
}
export const seasonal = (site,stats,origin) => Array.from({length:HORIZON},(_,h)=>{
  const index = origin+h;
  const lag = site.rows[index-168];
  return lag?.observed?lag.energy:stats.weekly[weekly(site.start+index*HOUR)];
});
export const targets = (site,i) => site.rows.slice(i,i+HORIZON).map(p=>p?.observed?p.energy:-1);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {quality} = loadData();
  writeFileSync(artifact('data-quality.json'),JSON.stringify(quality,null,2));
  console.log(JSON.stringify(quality,null,2));
}
