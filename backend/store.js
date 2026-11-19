import {MongoClient} from 'mongodb';
import {randomUUID} from 'node:crypto';

export async function connectStore(uri,dbName) {
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:5000});
  try {
    const db=client.db(dbName);
    await db.command({ping:1});
    await Promise.all(['forecasts','plans','twins'].map(name=>
      db.collection(name).createIndex({workspace:1,createdAt:-1})));
    await db.collection('twins').createIndex({running:1,updatedAt:1});
    return {
      ping:()=>db.command({ping:1}),
      close:()=>client.close(),
      async insert(name,workspace,value) {
        const {_id,...rest}={_id:randomUUID(),workspace,createdAt:new Date(),...value};
        await db.collection(name).insertOne({_id,...rest});
        return {id:_id,...rest};
      },
      async list(name,workspace,planId) {
        const docs=await db.collection(name).find({workspace,...(planId?{planId}:{})}).sort({createdAt:-1}).limit(15).toArray();
        return docs.map(toPublic);
      },
      async get(name,workspace,id) {
        return toPublic(await db.collection(name).findOne({_id:id,workspace}));
      },
      async profile(workspace,fields) {
        return toPublic(await db.collection('profiles').findOneAndUpdate({_id:workspace},
          {$set:{...fields,workspace},$setOnInsert:{createdAt:new Date()}},{upsert:true,returnDocument:'after'}));
      },
      async running() {
        return (await db.collection('twins').find({running:true}).sort({updatedAt:1}).limit(50).toArray()).map(toPublic);
      },
      async updateTwin(current,next) {
        const {id,...fields}=next;
        return toPublic(await db.collection('twins').findOneAndUpdate(
          {_id:current.id,workspace:current.workspace,version:current.version},
          {$set:{...fields,updatedAt:new Date()},$inc:{version:1}},
          {returnDocument:'after'}));
      }
    };
  } catch(error) {
    await client.close();
    throw error;
  }
}
function toPublic(doc) {
  if (!doc) return null;
  const {_id,...fields}=doc;
  return {id:_id,...fields};
}
