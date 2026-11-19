import {WebSocket,WebSocketServer} from 'ws';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

// A loopback protocol demo. REST and the twin use the in-process charger.
export async function demo() {
  const protocol='ocpp1.6';
  const gateway=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:4096,
    handleProtocols:offered=>offered.has(protocol)?protocol:false});
  await once(gateway,'listening');
  const receipts=[];
  gateway.on('connection',peer=>{
    if(peer.protocol!==protocol) { peer.close(1002,'OCPP 1.6 required');return; }
    let registered=false;
    peer.on('message',bytes=>{
      let frame;
      try { frame=JSON.parse(bytes); }
      catch {peer.close(1007,'Invalid JSON');return;}
      if(!Array.isArray(frame)||frame.length!==4||frame[0]!==2||typeof frame[1]!=='string') {
        peer.close(1002,'Invalid CALL');return;
      }
      const [,id,action,payload]=frame;
      const currentTime=new Date().toISOString();
      const authorized=registered || action==='BootNotification';
      let result;
      if(action==='BootNotification'&&payload?.chargePointVendor&&payload?.chargePointModel) {
        registered=true;
        result={currentTime,interval:60,status:'Accepted'};
      } else if(authorized&&action==='Heartbeat') result={currentTime};
      else if(authorized&&action==='StatusNotification'&&Number.isInteger(payload?.connectorId)&&
        ['Available','Charging','Finishing'].includes(payload?.status)&&payload?.errorCode==='NoError') result={};
      else {
        peer.send(JSON.stringify([4,id,'NotSupported','Unsupported call or invalid demo payload',{}]));
        return;
      }
      receipts.push(action);
      peer.send(JSON.stringify([3,id,result]));
    });
  });
  const charger=new WebSocket('ws://127.0.0.1:'+gateway.address().port+'/virtual-plug',protocol);
  try {
    await once(charger,'open');
    const calls=[
      ['BootNotification',{chargePointVendor:'EV-OptiGrid',chargePointModel:'Virtual plug'}],
      ['Heartbeat',{}],
      ['StatusNotification',{connectorId:1,errorCode:'NoError',status:'Charging'}]
    ];
    for(const [i,[action,payload]] of calls.entries()) {
      const id=String(i+1);
      const response=once(charger,'message',{signal:AbortSignal.timeout(5000)});
      charger.send(JSON.stringify([2,id,action,payload]));
      const [raw]=await response;
      const [type,responseId]=JSON.parse(raw);
      if(type!==3||responseId!==id) throw Error('Unexpected gateway response to '+action);
    }
    return receipts;
  } finally {
    charger.terminate();
    await new Promise(resolve=>gateway.close(resolve));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log('Virtual charger and loopback gateway exchanged',await demo());
