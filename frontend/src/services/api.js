import {io} from 'socket.io-client';
const key='evoptigrid-workspace';
const workspace=localStorage.getItem(key) || crypto.randomUUID();
localStorage.setItem(key,workspace);

export const socket=io({auth:{workspace}});
export async function api(path,method='GET',body) {
  const response=await fetch('/api'+path,{method,headers:{'x-workspace-id':workspace,
    ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok) throw Error(data.error??'Request failed');
  return data;
}
