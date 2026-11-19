import * as tf from '@tensorflow/tfjs';
import {readFile, writeFile} from 'node:fs/promises';
import {artifact, HISTORY,HORIZON} from './preprocess.js';

export {tf};
class TemporalAttention extends tf.layers.Layer {
  static className = 'TemporalAttention';
  build(shape) {
    this.score = this.addWeight('score',[shape.at(-1)],'float32',tf.initializers.glorotUniform({seed:51}));
    this.built = true;
  }
  computeOutputShape(shape) { return [shape[0],shape[2]]; }
  call(input) {
    return tf.tidy(()=>{
      const sequence = Array.isArray(input)?input[0]:input;
      const logits = sequence.mul(this.score.read()).sum(-1).tanh();
      return sequence.mul(logits.softmax(-1).expandDims(-1)).sum(1);
    });
  }
}
tf.serialization.registerClass(TemporalAttention);
export function maskedMse(actual,predicted) {
  const mask = actual.greaterEqual(0).cast('float32');
  return actual.sub(predicted).square().mul(mask).sum().div(mask.sum().maximum(1));
}
export function createModel(kind,width) {
  const hybrid = kind==='hybrid';
  const input = tf.input({shape:[HISTORY,width]});
  const compact = hybrid
    ? tf.layers.conv1d({filters:12,kernelSize:12,strides:6,padding:'same',activation:'relu',
      kernelInitializer:tf.initializers.glorotUniform({seed:17})}).apply(input)
    : tf.layers.averagePooling1d({poolSize:6,strides:6}).apply(input);
  const recurrent = tf.layers.lstm({units:12,returnSequences:hybrid,
    kernelInitializer:tf.initializers.glorotUniform({seed:23}),
    recurrentInitializer:tf.initializers.orthogonal({seed:31})});
  const encoded = hybrid ? tf.layers.bidirectional({layer:recurrent}).apply(compact) : recurrent.apply(compact);
  const context = hybrid ? new TemporalAttention({}).apply(encoded) : encoded;
  const output = tf.layers.dense({units:HORIZON,kernelInitializer:tf.initializers.glorotUniform({seed:91})}).apply(context);
  const model = tf.model({inputs:input,outputs:output});
  model.compile({optimizer:tf.train.adam(0.002),loss:maskedMse});
  return model;
}
export async function saveModel(model,name) {
  await model.save(tf.io.withSaveHandler(async a=>{
    await writeFile(artifact(name+'.bin'),Buffer.from(a.weightData));
    await writeFile(artifact(name+'.json'),JSON.stringify({modelTopology:a.modelTopology,weightSpecs:a.weightSpecs}));
    return {modelArtifactsInfo:tf.io.getModelArtifactsInfoForJSON(a)};
  }));
}
export async function loadModel(name) {
  const descriptor=JSON.parse(await readFile(artifact(name+'.json'),'utf8'));
  const weights=await readFile(artifact(name+'.bin'));
  return tf.loadLayersModel(tf.io.fromMemory({...descriptor,
    weightData:weights.buffer.slice(weights.byteOffset,weights.byteOffset+weights.byteLength)}));
}
export async function initBackend(runtime) {
  if (runtime==='native') await import('@tensorflow/tfjs-node');
  if (runtime==='wasm') await import('@tensorflow/tfjs-backend-wasm');
  await tf.setBackend(runtime==='native'?'tensorflow':runtime);
  await tf.ready();
}
