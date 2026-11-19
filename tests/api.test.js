import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {io} from 'socket.io-client';
import {startServer} from '../backend/server.js';

test('real MongoDB, TensorFlow inference, scoping, live events and restart persistence',
  {skip:!process.env.TEST_MONGODB_URI,timeout:30000},async()=>{
    const uri=process.env.TEST_MONGODB_URI;
    const dbName='optigrid_test_'+randomUUID().replaceAll('-','');
    const workspace=randomUUID();
    const client=new MongoClient(uri);
    let service,socket,other;
    const start=async()=> {
      service=await startServer({uri,dbName,port:0,tickMs:100});
      return 'http://127.0.0.1:'+service.http.address().port;
    };
    let url;
    const call=async(path,{verb='GET',body,scope=workspace,status=200}={})=>{
      const response=await fetch(url+'/api'+path,{method:verb,headers:{'x-workspace-id':scope,'Content-Type':'application/json'},
        body:body?JSON.stringify(body):undefined});
      const json=await response.json();
      assert.equal(response.status,status,JSON.stringify(json));
      return json;
    };
    async function connect(scope) {
      const connection=io(url,{auth:{workspace:scope},transports:['websocket'],forceNew:true,reconnection:false});
      await new Promise((resolve,reject)=>connection.once('connect',resolve).once('connect_error',reject));
      return connection;
    }
    try {
      url=await start();
      assert.equal((await call('/health')).database,'mongodb');
      const catalogue=await call('/catalogue');
      assert.equal(catalogue.vehicles.length,478);
      const {id:siteId}=catalogue.sites[0];
      const vehicleId=catalogue.vehicles[0].id;
      const forecasts=[];
      for(const model of ['hybrid','lstm','seasonal']) {
        const f=await call('/forecasts',{verb:'POST',status:201,body:{siteId,model}});
        assert.equal(f.model,model);
        assert.equal(f.hours.length,24);
        assert.ok(f.hours.every(h=>Number.isFinite(h.predictedKwh)&&h.predictedKwh>=0));
        forecasts.push(f);
      }
      const after=await call('/forecasts',{verb:'POST',status:201,
        body:{siteId,origin:catalogue.sites[0].nextAfterDataset,model:'hybrid'}});
      assert.ok(after.hours.every(h=>h.actualKwh===null));
      await call('/forecasts',{verb:'POST',status:400,body:{siteId,origin:'2018-01-01T00:00:00Z'}});
      const body={forecastId:forecasts[0].id,vehicleId,startSoc:25,targetSoc:45,deadline:2,
        mode:'AC',chargerKw:11,vehicleAcKw:11,siteLimitKw:1000,congestionRate:0,efficiency:0.9,tariffs:[0.3,0.1]};
      await call('/plans',{verb:'POST',status:404,scope:randomUUID(),body});
      const plan=await call('/plans',{verb:'POST',status:201,body});
      assert.equal(plan.feasible,true);
      const sites=await call('/plans/'+plan.id+'/sites');
      assert.equal(sites.length,7);
      assert.equal(sites.find(s=>s.site===siteId).cost,plan.recommended.cost);
      await call('/profile',{verb:'PUT',body:{name:'Lab profile',vehicleId}});
      assert.equal((await call('/profile')).name,'Lab profile');
      const twin=await call('/twins',{verb:'POST',status:201,body:{planId:plan.id}});
      socket=await connect(workspace);
      other=await connect(randomUUID());
      let crossWorkspace=0;
      other.on('twin:update',()=>crossWorkspace++);
      const finished=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('No completed-twin socket event')),5000);
        socket.on('twin:update',event=>{
          if(event.id===twin.id&&event.finished){clearTimeout(timeout);resolve(event);}
        });
      });
      const path='/twins/'+twin.id;
      await call(path+'/actions',{verb:'POST',body:{action:'start'}});
      const departure=await finished;
      assert.equal(departure.soc,45);
      assert.equal(departure.meterReadings.length,2);
      assert.equal(departure.meterReadings.at(-1).cumulativeGridKwh,departure.gridKwh);
      assert.equal(crossWorkspace,0);
      const driven=await call(path+'/actions',{verb:'POST',body:{action:'drive',km:5}});
      assert.ok(driven.soc<45);
      socket.disconnect();other.disconnect();
      await service.close();service=null;
      url=await start();
      assert.equal((await call('/plans/'+plan.id)).recommended.endSoc,45);
      assert.equal((await call(path)).soc,driven.soc);
    } finally {
      socket?.disconnect();other?.disconnect();
      if(service) await service.close();
      await client.db(dbName).dropDatabase();
      await client.close();
    }
  });
