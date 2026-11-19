export function deliver(slot,remainingBatteryKwh,efficiency) {
  const gridKwh=Math.max(0,Math.min(slot.energyKwh,slot.availableKwh,remainingBatteryKwh/efficiency));
  return {gridKwh,batteryKwh:gridKwh*efficiency,status:gridKwh>0?'Charging':'Idle'};
}
