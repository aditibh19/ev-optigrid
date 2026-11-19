import {writeFileSync} from 'node:fs';
import {artifact,loadData,fitFeatures,samples,targets} from './preprocess.js';
import {tf,createModel,initBackend,saveModel} from './model.js';
import {xTensor,evaluateAll} from './evaluate.js';

const runtime=process.env.TF_BACKEND??'cpu';
const epochs=Number(process.env.EPOCHS??10);
const stride=Number(process.env.TRAIN_STRIDE??4);
if (![epochs,stride].every(n=>Number.isInteger(n)&&n>0)) throw Error('Expected positive epochs and stride');
await initBackend(runtime);
const {sites,quality}=loadData();
const stats=fitFeatures(sites);
const train=samples(sites,'train',stride);
const val=samples(sites,'val',4);
const tensorPair=refs=>[xTensor(refs,sites,stats),tf.tensor2d(refs.map(({k,i})=>
  targets(sites[k],i).map(y=>y<0?-1:y/stats[k].scale)))];
const [x,y]=tensorPair(train);
const validationData=tensorPair(val);
const config={runtime,epochs,stride,stats,dataSha256:quality.acn.sha256,split:quality.acn.split,
  trainOrigins:train.length,checkpointValidationOrigins:val.length,batchSize:128,learningRate:0.002,runs:{}};
console.log('Training setup',{runtime,train:train.length,val:val.length,epochs,stride});
for (const name of ['lstm','hybrid']) {
  const model=createModel(name,7+sites.length);
  let best=Infinity;
  let bestEpoch=0;
  const history=[];
  await model.fit(x,y,{epochs,batchSize:128,validationData,shuffle:true,verbose:0,
    callbacks:{onEpochEnd:async(epoch,logs)=>{
      const row={epoch:epoch+1,loss:logs.loss,valLoss:logs.val_loss};
      history.push(row);
      console.log(name,row);
      if(Number.isFinite(row.valLoss)&&row.valLoss<best-1e-6) {
        best=row.valLoss; bestEpoch=epoch+1;
        await saveModel(model,name);
      } else if (epoch+1-bestEpoch>=3) model.stopTraining=true;
    }}});
  if(!bestEpoch) throw Error('Training failed for '+name);
  config.runs[name]={parameters:model.countParams(),bestEpoch,history};
  model.dispose();
  model.optimizer.dispose();
}
tf.dispose([x,y,...validationData]);
writeFileSync(artifact('training.json'),JSON.stringify(config,null,2));
writeFileSync(artifact('data-quality.json'),JSON.stringify(quality,null,2));
await evaluateAll(sites,stats,runtime);
