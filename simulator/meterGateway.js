import {WebSocket,WebSocketServer} from 'ws';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';

// A private OCPP 1.6J MeterValues endpoint for the application's virtual stations.
export async function startMeterGateway() {
  const token=randomUUID();
  const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:4096,
    verifyClient:({req})=>req.headers.authorization==='Bearer '+token,
    handleProtocols:protocols=>protocols.has('ocpp1.6')?'ocpp1.6':false});
  await once(server,'listening');
  const readings=new Map();
  server.on('connection',peer=>{
    peer.on('error',()=>{});
    peer.on('message',raw=>{
      try {
        const [type,id,action,payload]=JSON.parse(raw);
        const pending=readings.get(id);
        const meter=payload?.meterValue?.[0];
        const sample=meter?.sampledValue?.[0];
        const kwh=Number(sample?.value);
        if(type!==2||!pending||action!=='MeterValues'||payload.connectorId!==1||
          sample?.unit!=='kWh'||sample.measurand!=='Energy.Active.Import.Register'||
          !Number.isFinite(kwh)||kwh<0||meter.timestamp!==pending.timestamp) {
          peer.close(1008,'Invalid meter reading'); return;
        }
        pending.receipt={messageId:id,action,connectorId:1,timestamp:meter.timestamp,
          cumulativeGridKwh:kwh,source:'virtual station'};
        peer.send(JSON.stringify([3,id,{}]));
      } catch {peer.close(1007,'Invalid frame');}
    });
  });
  return {
    async record(timestamp,kwh) {
      const id=randomUUID();
      const pending={timestamp};
      readings.set(id,pending);
      const socket=new WebSocket('ws://127.0.0.1:'+server.address().port,'ocpp1.6',
        {headers:{authorization:'Bearer '+token},handshakeTimeout:3000});
      socket.on('error',()=>{});
      try {
        const signal=AbortSignal.timeout(4000);
        await once(socket,'open',{signal});
        const response=once(socket,'message',{signal});
        socket.send(JSON.stringify([2,id,'MeterValues',{connectorId:1,meterValue:[{timestamp,
          sampledValue:[{value:String(kwh),measurand:'Energy.Active.Import.Register',unit:'kWh'}]}]}]));
        const [raw]=await response;
        const [type,messageId]=JSON.parse(raw);
        if(type!==3||messageId!==id||!pending.receipt) throw Error('Missing station acknowledgement');
        return pending.receipt;
      } finally { readings.delete(id);socket.terminate(); }
    },
    close:()=>new Promise(resolve=>server.close(resolve))
  };
}
