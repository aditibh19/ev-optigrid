export class InputError extends Error {
  constructor(message,status=400) { super(message); this.status=status; }
}
export function bounded(value,min,max,name) {
  if (typeof value!=='number'|| !Number.isFinite(value)||value<min||value>max)
    throw new InputError(name+' must be between '+min+' and '+max);
  return value;
}
export function chargingPower(vehicle,mode,connector,chargerKw,vehicleAcKw) {
  if (mode==='AC') return Math.min(chargerKw,bounded(vehicleAcKw,0.1,43,'Assumed onboard AC kW'));
  if (mode!=='DC') throw new InputError('Choose AC or DC mode');
  if (!vehicle.connector || vehicle.connector.toLowerCase()!==String(connector).trim().toLowerCase() || !vehicle.dcKw)
    throw new InputError('Vehicle DC connector or DC power rating is unavailable or incompatible',422);
  return Math.min(chargerKw, vehicle.dcKw);
}
