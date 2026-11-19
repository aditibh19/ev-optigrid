import express from 'express';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Server} from 'socket.io';
import {createForecaster} from '../ml/predict.js';
import {optimize} from '../optimization/chargingOptimizer.js';
import {InputError} from '../optimization/batteryConstraints.js';
import {createTwin,stepTwin,driveTwin} from '../simulator/evDigitalTwin.js';
import {startMeterGateway} from '../simulator/meterGateway.js';
import {connectStore} from './store.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validWorkspace=value=>typeof value==='string'&&uuid.test(value);
const required=(value,message)=>{
  if(!value) throw new InputError(message,404);
  return value;
};

export async function startServer({uri=process.env.MONGODB_URI??'mongodb://127.0.0.1:27017',
  dbName=process.env.MONGODB_DB??'ev_optigrid',port=Number(process.env.PORT??3000),
  host=process.env.HOST??'127.0.0.1', tickMs=1600}={}) {
  const store=await connectStore(uri,dbName);
  let ml;
  try { ml=await createForecaster(); }
  catch(error) { await store.close(); throw error; }
  let meter;
  try {meter=await startMeterGateway();} catch(error) {ml.dispose();await store.close();throw error;}
  const vehicle=id=>required(ml.vehicles.find(v=>v.id===id),'Vehicle not found');
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'32kb'}));
  const http=createServer(app);
  const io=new Server(http);
  io.use((socket,next)=>validWorkspace(socket.handshake.auth.workspace)?next():next(Error('Workspace required')));
  io.on('connection',socket=>socket.join(socket.handshake.auth.workspace));
  const publish=doc=>io.to(doc.workspace).emit('twin:update',doc);
  const api=express.Router();
  app.use('/api',api);
  api.get('/health',async(req,res)=>{await store.ping();res.json({status:'ok',database:'mongodb'});});
  api.get('/catalogue',(req,res)=>res.json({sites:ml.catalogue,vehicles:ml.vehicles,selected:ml.metrics.selected}));
  api.get('/metrics',(req,res)=>res.json({metrics:ml.metrics,training:ml.config}));
  api.get('/data-quality',(req,res)=>res.json(ml.quality));
  api.use((req,res,next)=>{
    req.workspace=req.get('x-workspace-id');
    if(!validWorkspace(req.workspace)) throw new InputError('Valid x-workspace-id required');
    next();
  });
  api.put('/profile',async(req,res)=>{
    const {name,vehicleId}=req.body??{};
    if(typeof name!=='string'||name.trim().length<1||name.trim().length>80) throw new InputError('Profile name must have 1–80 characters');
    vehicle(vehicleId);
    res.json(await store.profile(req.workspace,{name:name.trim(),vehicleId}));
  });
  api.get('/profile',async(req,res)=>res.json(await store.get('profiles',req.workspace,req.workspace)));
  for(const resource of ['forecasts','plans','twins']) {
    api.get('/'+resource,async(req,res)=>{
      const planId=resource==='twins'?req.query.planId:undefined;
      if(planId!==undefined&&(!validWorkspace(planId))) throw new InputError('Invalid plan ID');
      res.json(await store.list(resource,req.workspace,planId));
    });
    api.get('/'+resource+'/:id',async(req,res)=>res.json(required(
      await store.get(resource,req.workspace,req.params.id),'Record not found')));
  }
  api.post('/forecasts',async(req,res)=>{
    const {siteId,origin,model}=req.body??{};
    res.status(201).json(await store.insert('forecasts',req.workspace,ml.forecast(siteId,origin,model)));
  });
  api.post('/plans',async(req,res)=>{
    const {forecastId,vehicleId,...inputs}=req.body??{};
    if(!uuid.test(String(forecastId))) throw new InputError('Forecast ID is required');
    const forecast=required(await store.get('forecasts',req.workspace,forecastId),'Forecast not found');
    res.status(201).json(await store.insert('plans',req.workspace,
      {...optimize(vehicle(vehicleId),forecast,inputs),forecastId}));
  });
  api.get('/plans/:id/sites',async(req,res)=>{
    const plan=required(await store.get('plans',req.workspace,req.params.id),'Plan not found');
    if(!plan.inputs) throw new InputError('Recreate this plan to compare its inputs',409);
    const choices=[];
    for(const site of ml.catalogue) {
      if(Date.parse(plan.origin)<Date.parse(site.testStart)||Date.parse(plan.origin)>Date.parse(site.nextAfterDataset)) continue;
      const forecast=ml.forecast(site.id,plan.origin,plan.model);
      const candidate=optimize(vehicle(plan.vehicleId),forecast,plan.inputs);
      choices.push({site:site.id,feasible:candidate.feasible,shortfall:candidate.recommended.shortfallBatteryKwh,
        cost:candidate.recommended.cost,objective:candidate.recommended.objective});
    }
    choices.sort((a,b)=>Number(b.feasible)-Number(a.feasible)||(a.feasible?0:a.shortfall-b.shortfall)||a.objective-b.objective);
    res.json(choices);
  });
  api.post('/twins',async(req,res)=>{
    const {planId}=req.body??{};
    if(!uuid.test(String(planId))) throw new InputError('Plan ID is required');
    const plan=required(await store.get('plans',req.workspace,planId),'Plan not found');
    const twin=await store.insert('twins',req.workspace,{...createTwin(plan,vehicle(plan.vehicleId)),planId});
    publish(twin);
    res.status(201).json(twin);
  });
  api.post('/twins/:id/actions',async(req,res)=>{
    const twin=required(await store.get('twins',req.workspace,req.params.id),'Twin not found');
    const {action,km}=req.body??{};
    let next;
    if(action==='start'&&!twin.finished) next={...twin,running:true,status:'Running'};
    else if(action==='pause') next={...twin,running:false,status:twin.finished?twin.status:'Paused'};
    else if(action==='drive'&&twin.finished) next=driveTwin(twin,km);
    else throw new InputError('Start before departure or drive after departure',409);
    const {version,...fields}=next;
    const saved=await store.updateTwin(twin,fields);
    if(!saved) throw new InputError('Simulation advanced. Retry the action.',409);
    publish(saved);
    res.json(saved);
  });
  api.use((req,res)=>res.status(404).json({error:'API endpoint not found'}));
  const dist=fileURLToPath(new URL('../frontend/dist/',import.meta.url));
  if(existsSync(dist)) app.use(express.static(dist));
  app.use((err,req,res,next)=>{
    const status=err.status||500;
    if(status>=500) console.error(err);
    res.status(status).json({error:status>=500?'Service unavailable':err.message});
  });
  let pending;
  const timer=setInterval(()=>{
    if(pending) return;
    pending=(async()=>{
      for (const twin of await store.running()) {
        const plan=await store.get('plans',twin.workspace,twin.planId);
        if(!plan) continue;
        const {version,...next}=stepTwin(twin,plan);
        const slot=plan.recommended.schedule[twin.cursor];
        let receipt;
        try {
          receipt=await meter.record(new Date(Date.parse(slot.timestamp)+3600000).toISOString(),next.gridKwh);
        } catch(error) {console.error('Virtual meter retry',twin.id,error.message);continue;}
        next.meterReadings=[...(twin.meterReadings??[]),receipt];
        const saved=await store.updateTwin(twin,next);
        if(saved) publish(saved);
      }
    })().catch(console.error).finally(()=>{pending=null;});
  },tickMs);
  function close() {
    clearInterval(timer);
    return new Promise(resolve=>io.close(resolve)).then(async()=>{
      await pending;
      await meter.close();
      ml.dispose();
      await store.close();
    });
  }
  try {
    await new Promise((resolve,reject)=>{
      http.once('error',reject);
      http.listen(port,host,resolve);
    });
  } catch(error) {
    await close();
    throw error;
  }
  return {http,close};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const service=await startServer();
  console.log('EV-OptiGrid available on port '+service.http.address().port);
  for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>service.close());
}
