import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { GameProjects, GameRuntime, gameHttp, attachGameRooms, gameProjectsFor, starterLogic, dispatchGameTool, startGameBrowserPage } from '../game-projects.ts';
import { gameTools } from '../shared/game-tools.ts';
import { validateInput } from '../shared/phase1-tools.ts';
import type { GameBrief } from '../shared/game-contract.ts';

// Legacy runtime tests deliberately exercise starter(), independent of new kit files.
const legacyKits = await mkdtemp(path.join(tmpdir(), 'openmotion-legacy-kits-'));
after(() => rm(legacyKits, {recursive:true,force:true}));
for (const folder of ['coop-3d', 'vendor', 'characters']) {
  await cp(new URL(`../templates/game-kits/${folder}/`, import.meta.url), path.join(legacyKits, folder), {recursive:true});
}

const brief: GameBrief = { prompt:'A small space racer', genre:'racing', style:'pixel', setting:'space', multiplayer:false };
// RFC 6455 sample handshake nonce, derived at runtime so release scanners do not read it as a credential.
const wsKey = Buffer.from('the sample nonce').toString('base64');

async function fixture(run: (service: GameProjects, workspace: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(),'openmotion-game-'));
  try {
    const service=new GameProjects(dir,path.join(dir,'templates'),legacyKits);
    gameProjectsFor(dir).kits=legacyKits;
    gameProjectsFor(dir).templates=service.templates; // Isolate adapter tests from concurrently edited bundled templates.
    await run(service,dir);
  }
  finally { await rm(dir,{recursive:true,force:true}); }
}

test('draft lifecycle, remix, persisted local viewer and concurrent counters',()=>fixture(async(service,workspace)=>{
  assert.deepEqual(await service.catalog(),{games:[]});
  const { game, agentInstruction }=await service.create(brief);
  assert.equal(game.status,'draft'); assert.equal(game.maxPlayers,1);
  assert.match(agentInstruction,/pixel style, racing, space setting\. A small space racer/);
  assert.match(agentInstruction,/openmotion-game/); assert.match(agentInstruction,new RegExp(game.id));
  assert.match((await service.read(game.id,'index.html')).content,/requestAnimationFrame/);
  assert.equal((await service.validate(game.id)).passed,true);
  await Promise.all(Array.from({length:12},()=>service.interact(game.id,'play')));
  assert.equal((await service.interact(game.id,'reaction',1)).likes,1);
  let card=await service.interact(game.id,'reaction',-1); assert.equal(card.likes,0); assert.equal(card.dislikes,1);
  card=await service.interact(game.id,'reaction',0); assert.equal(card.dislikes,0);
  assert.equal((await service.interact(game.id,'favorite',true)).favorite,true);
  card=await new GameProjects(workspace).get(game.id); assert.equal(card.plays,12); assert.equal(card.favorite,true);
  const stored=JSON.parse(await readFile(path.join(workspace,'games',game.id,'game.json'),'utf8'));
  assert.equal(stored.reaction,undefined); assert.equal(stored.favorite,undefined); assert.equal(stored.plays,0);
  await assert.rejects(service.interact(game.id,'reaction',2),/reaction/);
  await assert.rejects(service.interact(game.id,'favorite','true'),/boolean/);
  const remix=await service.remix(game.id); assert.equal(remix.game.remixOf,game.id); assert.equal(remix.game.plays,0); assert.equal(remix.game.favorite,false); assert.match(remix.agentInstruction,/remix/);
  assert.equal((await service.read(remix.game.id,'index.html')).content,(await service.read(game.id,'index.html')).content);
  await service.status(remix.game.id,'ready'); await service.publish(remix.game.id);
  assert.equal((await service.catalog()).games[0].id,remix.game.id);
  await service.write(remix.game.id,[{path:'index.html',content:'<!doctype html><title>Edited</title>'}]);
  assert.equal((await service.get(remix.game.id)).status,'building');
  await service.delete(game.id); await assert.rejects(service.get(game.id),/not found/);
  assert.equal((await service.get(remix.game.id)).remixOf,game.id);
}));

test('templates are optional, read-only and remix into independent owned files',()=>fixture(async(service,workspace)=>{
  const {game}=await service.create(brief),template=path.join(service.templates,'racer');
  await mkdir(template,{recursive:true}); await writeFile(path.join(template,'game.json'),JSON.stringify({...game,id:'racer',status:'published',source:'template'}));
  await writeFile(path.join(template,'index.html'),'<title>Template</title>');
  assert.equal((await service.get('racer')).source,'template');
  const raw=JSON.parse(await readFile(path.join(template,'game.json'),'utf8')); raw.cover='cover.png'; delete raw.remixOf; await writeFile(path.join(template,'game.json'),JSON.stringify(raw));
  assert.equal((await service.get('racer')).cover,'/api/games/racer/play/cover.png'); assert.equal((await service.get('racer')).remixOf,null);
  await assert.rejects(service.write('racer',[{path:'index.html',content:'bad'}]),/not found/);
  await assert.rejects(service.delete('racer'),/not found/); await assert.rejects(service.publish('racer'),/not found/);
  const remix=await service.remix('racer'); await service.write(remix.game.id,[{path:'index.html',content:'<title>Remixed</title>'}]);
  assert.equal((await service.read('racer','index.html')).content,'<title>Template</title>');
  assert.equal(remix.game.cover,`/api/games/${remix.game.id}/play/cover.png`);
  assert.equal(remix.game.source,'mine'); assert.equal(remix.game.status,'draft');
  await service.interact('racer','favorite',true); assert.equal((await service.get('racer')).favorite,true);
}));

test('safe static/text paths reject traversal, metadata, symlinks, invalid batches and oversized text',()=>fixture(async(service,workspace)=>{
  const {game}=await service.create(brief);
  for(const unsafe of ['../outside','/index.html','assets/../../outside','assets\\outside','.state.json','assets/./a.js']) {
    await assert.rejects(service.staticFile(game.id,unsafe));
    await assert.rejects(service.write(game.id,[{path:unsafe,content:'bad'}]));
  }
  await assert.rejects(service.write(game.id,[{path:'game.json',content:'{}'}]),/text/);
  await assert.rejects(service.write(game.id,[{path:'one.js',content:'ok'},{path:'../bad',content:'bad'}]));
  await assert.rejects(service.read(game.id,'one.js')); // preflight before any write
  await assert.rejects(service.write(game.id,[{path:'large.js',content:'x'.repeat(8*1024*1024+1)}]),/8 MiB/);
  await symlink(workspace,path.join(service.root,game.id,'escape'));
  await assert.rejects(service.staticFile(game.id,'escape/games/.state.json'));
  await assert.rejects(service.write(game.id,[{path:'escape/out.js',content:'bad'}]),/Symlink/);
  await assert.rejects(service.staticFile(game.id,'game.json'),/metadata/);
  const file=await service.staticFile(game.id,'index.html'); assert.match(file.mime,/text\/html/);
}));

test('multiplayer validation, determinism, contract errors, CDN rules and publication gate',()=>fixture(async(service)=>{
  const {game}=await service.create({...brief,multiplayer:true}); assert.equal(game.maxPlayers,4);
  assert.equal((await service.validate(game.id)).passed,true);
  assert.equal((await service.publish(game.id)).roomInviteUrlPattern,game.playUrl+'?room={room}');
  for(const source of [starterLogic+'\nMath.random();',starterLogic+'\nDate.now();',starterLogic+'\nrequire("fs");',starterLogic.replace('export function viewFor','function viewFor'),starterLogic.replace('return state; }','while(true){} }')]) {
    await service.write(game.id,[{path:'logic.js',content:source}]);
    assert.equal((await service.validate(game.id)).passed,false);
    await assert.rejects(service.publish(game.id),/validation failed/);
  }
  await service.write(game.id,[{path:'logic.js',content:starterLogic},{path:'index.html',content:'<script src="https://cdn.jsdelivr.net/example.js"></script>'}]);
  assert.equal((await service.validate(game.id)).passed,true);
  for(const host of ['wss://evil.example/room','https://evil.example/track','//evil.example/track','https://cdn.jsdelivr.net.evil.example/a.js']) {
    await service.write(game.id,[{path:'index.html',content:`<script src="${host}"></script>`}]); assert.equal((await service.validate(game.id)).passed,false);
  }
  // XML namespace identifiers are not network requests; a script loaded from the same host still is.
  await service.write(game.id,[{path:'index.html',content:'<script>document.createElementNS("http://www.w3.org/1999/xhtml","canvas");document.createElementNS("http://www.w3.org/2000/svg","svg")</script>'}]);
  assert.equal((await service.validate(game.id)).passed,true);
  await service.write(game.id,[{path:'index.html',content:'<script src="http://www.w3.org/1999/xhtml/evil.js"></script>'}]); assert.equal((await service.validate(game.id)).passed,false);
  await service.write(game.id,[{path:'index.html',content:'<script>\n//rendering comment\n</script>'},{path:'logic.js',content:starterLogic.replace('maxPlayers: 4','maxPlayers: 2')}]);
  assert.equal((await service.validate(game.id)).passed,true); assert.equal((await service.publish(game.id)).game.maxPlayers,2);
  const a=new GameRuntime(starterLogic,'same'),b=new GameRuntime(starterLogic,'same');
  for(const runtime of [a,b]) {runtime.setup(['a','b']); runtime.tick(1); runtime.apply('a',{type:'score'}); runtime.apply('b',{type:'invalid'});}
  assert.deepEqual(a.view('a'),{scores:{a:1,b:0}}); assert.deepEqual(a.view('a'),b.view('a'));
  assert.throws(()=>new GameRuntime(starterLogic+'\nFunction("return process")();','escape'),/Code generation/);
}));

test('MCP game schemas and shared dispatcher use the requested workspace without video initialization',()=>fixture(async(_,workspace)=>{
  assert.equal(gameTools.length,12);
  for(const tool of gameTools) assert.match(tool.title,/^OpenMotion · /);
  validateInput(gameTools[0].inputSchema,brief);
  assert.throws(()=>validateInput(gameTools[0].inputSchema,{...brief,genre:'invalid'}));
  const created:any=await dispatchGameTool('motion_game_create',brief,workspace);
  const detail:any=await dispatchGameTool('openmotion_game_get',{id:created.game.id},workspace);
  assert.equal(detail.id,created.game.id); assert.equal(detail.files[0].path,'index.html');
  assert.equal((await dispatchGameTool('motion_game_validate',{id:detail.id},workspace) as any).passed,true);
  await dispatchGameTool('motion_game_set_status',{id:detail.id,status:'ready'},workspace);
  assert.equal((await dispatchGameTool('motion_game_publish',{id:detail.id},workspace) as any).game.status,'published');
}));

async function listen(t: any, server: ReturnType<typeof createServer>) {
  try { await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);}); return true; }
  catch(e) { if(['EPERM','EACCES'].includes((e as NodeJS.ErrnoException).code??'')){t.skip('Loopback listen is denied by this environment');return false;}throw e; }
}
async function input(req: any,max=1024*1024) {let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>max)throw Error('Too large');}return JSON.parse(text||'{}');}
function httpCall(port: number,method: string,url: string,body?: unknown) {
  return new Promise<{status:number;body:string;headers:any}>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,method,path:url,headers:{'Content-Type':'application/json'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode!,body,headers:res.headers}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
test('HTTP lifecycle and static MIME/traversal round trip',async t=>fixture(async(_,workspace)=>{
  const server=createServer((req,res)=>{void gameHttp(req,res,new URL(req.url!,'http://localhost'),workspace,input);});
  if(!await listen(t,server))return;
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const port=(server.address() as any).port;
  const created=await httpCall(port,'POST','/api/games',brief); assert.equal(created.status,201);
  const game=JSON.parse(created.body).game;
  assert.equal((await httpCall(port,'GET','/api/games')).status,200);
  assert.equal((await httpCall(port,'GET',`/api/games/${game.id}`)).status,200);
  const staticResult=await httpCall(port,'GET',game.playUrl);assert.equal(staticResult.status,200);assert.match(staticResult.headers['content-type'],/text\/html/);
  for(const bad of ['%2e%2e%2fgame.json','assets%2f..%2f..%2fsecret','%5c..%5csecret']) assert.notEqual((await httpCall(port,'GET',`/api/games/${game.id}/play/${bad}`)).status,200);
  assert.equal(JSON.parse((await httpCall(port,'POST',`/api/games/${game.id}/play`)).body).plays,1);
  assert.equal(JSON.parse((await httpCall(port,'POST',`/api/games/${game.id}/reaction`,{value:1})).body).likes,1);
  assert.equal(JSON.parse((await httpCall(port,'POST',`/api/games/${game.id}/favorite`,{favorite:true})).body).favorite,true);
  const remix=await httpCall(port,'POST',`/api/games/${game.id}/remix`);assert.equal(remix.status,201);
  assert.equal((await httpCall(port,'DELETE',`/api/games/${game.id}`)).status,200);
  assert.equal((await httpCall(port,'GET',game.playUrl)).status,404);
}));
function inbox(socket: WebSocket) {
  const messages:any[]=[],waiting:{predicate:(m:any)=>boolean;resolve:(m:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}[]=[];
  socket.addEventListener('message',e=>{const message=JSON.parse(String(e.data));const index=waiting.findIndex(w=>w.predicate(message));if(index<0)messages.push(message);else{const [w]=waiting.splice(index,1);clearTimeout(w.timer);w.resolve(message);}});
  return (predicate:(m:any)=>boolean)=>{const index=messages.findIndex(predicate);if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);return new Promise<any>((resolve,reject)=>{const waiter={predicate,resolve,reject,timer:setTimeout(()=>reject(Error('Room response timeout')),3000)};waiting.push(waiter);});};
}
test('authoritative room: two clients join/start, legal and illegal inputs, state and over',async t=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,multiplayer:true});
  await service.write(game.id,[{path:'logic.js',content:starterLogic.replace('minPlayers: 1','minPlayers: 2').replace('return { over: false };','return { over: Object.values(state.scores).some(score => score >= 2), winners: Object.keys(state.scores).filter(id => state.scores[id] >= 2) };')}]);
  const server=createServer(),closeRooms=attachGameRooms(server,workspace);
  if(!await listen(t,server))return;
  t.after(()=>{closeRooms();return new Promise<void>(resolve=>server.close(()=>resolve()));});
  const url=`ws://127.0.0.1:${(server.address() as any).port}/api/games/${game.id}/rooms/test`;
  const a=new WebSocket(url),b=new WebSocket(url),nextA=inbox(a),nextB=inbox(b);
  await Promise.all([once(a,'open'),once(b,'open')]);
  a.send(JSON.stringify({type:'join',name:'A'}));const joinedA=await nextA(m=>m.type==='joined');
  a.send(JSON.stringify({type:'start'}));assert.match((await nextA(m=>m.type==='error')).message,/Not enough/);
  b.send(JSON.stringify({type:'join',name:'B'}));const joinedB=await nextB(m=>m.type==='joined');assert.equal(joinedB.players.length,2);
  a.send(JSON.stringify({type:'start'}));await nextA(m=>m.type==='state');await nextB(m=>m.type==='state');
  a.send(JSON.stringify({type:'input',action:{type:'score'}}));b.send(JSON.stringify({type:'input',action:{type:'invalid'}}));
  const state=await nextB(m=>m.type==='state'&&m.view.scores[joinedA.playerId]===1);assert.equal(state.view.scores[joinedB.playerId],0);
  a.send(JSON.stringify({type:'input',action:{type:'score'}}));
  const over=await nextB(m=>m.type==='over');assert.deepEqual(over.winners,[joinedA.playerId]);
  a.send(JSON.stringify({type:'input',action:{type:'score'}}));assert.match((await nextA(m=>m.type==='error')).message,/not running/);
  a.close();b.close();
}));

// Exercise the production adapters when the sandbox forbids localhost listeners.
import { Duplex, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { handler } from '../server.ts';
import { WorkspaceStore } from '../workspace.ts';

test('mounted /api/games and /motion-api/games HTTP adapters work without a listening socket',()=>fixture(async(_,workspace)=>{
  const store=new WorkspaceStore(workspace);
  async function call(method:string,url:string,body?:unknown) {
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]) as any;
    Object.assign(req,{method,url,headers:{host:'localhost',origin:'http://localhost','content-type':'application/json'}});
    let status=0,data:Buffer=Buffer.alloc(0);const headers:Record<string,unknown>={};
    const res={setHeader(key:string,value:unknown){headers[key.toLowerCase()]=value;},writeHead(code:number,values:Record<string,unknown>){status=code;for(const [key,value] of Object.entries(values??{}))headers[key.toLowerCase()]=value;},end(value?:any){data=Buffer.from(value??'');}} as any;
    await handler(req,res,store,{} as any);return {status,data,headers};
  }
  const created=await call('POST','/api/games',brief);assert.equal(created.status,201);
  const game=JSON.parse(created.data.toString()).game;
  const metadata=await call('POST',`/motion-api/games/${game.id}/update-meta`,{title:'HTTP metadata',controls:'Keyboard and touch'});assert.equal(metadata.status,200);assert.equal(JSON.parse(metadata.data.toString()).title,'HTTP metadata');
  const catalog=await call('GET','/motion-api/games');assert.equal(catalog.status,200,catalog.data.toString());
  const played=await call('GET',game.playUrl);assert.equal(played.status,200);assert.match(String(played.headers['content-type']),/text\/html/);
  assert.equal(JSON.parse((await call('POST',`/api/games/${game.id}/play`)).data.toString()).plays,1);
  assert.equal((await call('GET',`/api/games/${game.id}/play/%2e%2e%2fgame.json`)).status,400);
  assert.equal((await call('GET',`/api/games/${game.id}/play/game.json`)).status,404);
  assert.equal((await call('DELETE',`/motion-api/games/${game.id}`)).status,200);
}));
class MemorySocket extends Duplex {
  output=new EventEmitter();
  _read() {}
  _write(chunk:Buffer,_encoding:string,done:(e?:Error)=>void) {this.output.emit('wire',Buffer.from(chunk));done();}
  receive(value:unknown) {
    const payload=Buffer.from(JSON.stringify(value)),mask=Buffer.from([1,2,3,4]),header=Buffer.alloc(payload.length<126?2:4);
    header[0]=0x81;header[1]=0x80|(payload.length<126?payload.length:126);if(header.length===4)header.writeUInt16BE(payload.length,2);
    for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
    this.emit('data',Buffer.concat([header,mask,payload]));
  }
}
function memoryInbox(socket:MemorySocket) {
  const messages:any[]=[];const events=new EventEmitter();
  socket.output.on('wire',buffer=>{
    if(buffer.toString().startsWith('HTTP/1.1 101')) {messages.push({type:'upgrade'});events.emit('message');return;}
    if(buffer[0]!==0x81)return;
    const offset=buffer[1]<126?2:buffer[1]===126?4:10;messages.push(JSON.parse(buffer.subarray(offset).toString()));events.emit('message');
  });
  return async(predicate:(message:any)=>boolean)=>{
    const deadline=Date.now()+3000;
    while(true){const index=messages.findIndex(predicate);if(index>=0)return messages.splice(index,1)[0];await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{events.off('message',onMessage);reject(Error('Memory socket timeout'));},Math.max(1,deadline-Date.now()));const onMessage=()=>{clearTimeout(timeout);resolve();};events.once('message',onMessage);});}
  };
}
test('in-memory WebSocket upgrades and masked frames drive a two-player authoritative round',()=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,multiplayer:true});
  await service.write(game.id,[{path:'logic.js',content:starterLogic.replace('minPlayers: 1','minPlayers: 2').replace('return { over: false };','return { over: Object.values(state.scores).some(n => n >= 2), winners: Object.keys(state.scores).filter(id => state.scores[id] >= 2) };')}]);
  const server=createServer(),close=attachGameRooms(server,workspace),a=new MemorySocket(),b=new MemorySocket(),nextA=memoryInbox(a),nextB=memoryInbox(b);
  try{
    const upgrade=(socket:MemorySocket)=>server.emit('upgrade',{method:'GET',url:`/api/games/${game.id}/rooms/memory`,headers:{host:'localhost','sec-websocket-key':wsKey,'sec-websocket-version':'13',upgrade:'websocket'}},socket,Buffer.alloc(0));
    upgrade(a);upgrade(b);await nextA(m=>m.type==='upgrade');await nextB(m=>m.type==='upgrade');
    a.receive({type:'join',name:'A'});const playerA=(await nextA(m=>m.type==='joined')).playerId;
    a.receive({type:'start'});assert.match((await nextA(m=>m.type==='error')).message,/Not enough/);
    b.receive({type:'join',name:'B'});const joinedB=await nextB(m=>m.type==='joined');assert.equal(joinedB.players.length,2);
    a.receive({type:'start'});a.receive({type:'input',action:{type:'score'}});b.receive({type:'input',action:{type:'invalid'}});
    const state=await nextB(m=>m.type==='state'&&m.view.scores[playerA]===1);assert.equal(state.view.scores[joinedB.playerId],0);
    a.receive({type:'input',action:{type:'score'}});assert.deepEqual((await nextB(m=>m.type==='over')).winners,[playerA]);
    a.receive({type:'input',action:{type:'score'}});assert.match((await nextA(m=>m.type==='error')).message,/not running/);
  }finally{close();a.destroy();b.destroy();}
}));

test('masked client frames of 125–129 bytes all parse (a 16-bit length of 127 is not the 64-bit marker)',()=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,multiplayer:true});
  const server=createServer(),close=attachGameRooms(server,workspace),a=new MemorySocket(),nextA=memoryInbox(a);
  try{
    server.emit('upgrade',{method:'GET',url:`/api/games/${game.id}/rooms/sizes`,headers:{host:'localhost','sec-websocket-key':wsKey,'sec-websocket-version':'13',upgrade:'websocket'}},a,Buffer.alloc(0));
    await nextA(m=>m.type==='upgrade');
    a.receive({type:'join',name:'A'});await nextA(m=>m.type==='joined');
    let destroyed=false;a.on('close',()=>{destroyed=true;});
    a.receive({type:'start'});await nextA(m=>m.type==='state');
    const base=JSON.stringify({type:'input',action:{pad:''}}).length;
    for(const size of [125,126,127,128,129]){a.receive({type:'input',action:{pad:'x'.repeat(size-base)}});await nextA(m=>m.type==='state'||m.type==='error');}
    assert.equal(destroyed,false);
  }finally{close();a.destroy();}
}));

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const kitRoot = new URL('../templates/game-kits/', import.meta.url);

async function fakeKits(workspace: string) {
  const kits = path.join(workspace, 'kits');
  const soloLogic = starterLogic.replace('maxPlayers: 4', 'maxPlayers: 1');
  for (const [file, content] of Object.entries({
    'arcade-2d/index.html': '<canvas id="game"></canvas>',
    'arcade-2d/logic.js': soloLogic,
    'arcade-2d/assets/marker.txt': 'arcade asset',
    'coop-3d/index.html': '<canvas id="coop"></canvas>',
    'coop-3d/logic.js': starterLogic,
    'vendor/three.module.min.js': '// local three',
    'characters/marker.txt': 'coop character',
  })) {
    await mkdir(path.dirname(path.join(kits, file)), {recursive:true});
    await writeFile(path.join(kits, file), content);
  }
  return {kits, soloLogic, service:new GameProjects(workspace, path.join(workspace, 'templates'), kits)};
}

test('single-player pixel platformer copies every arcade file and keeps kit metadata private',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);
  const {game}=await service.create({...brief,prompt:'A single-player pixel platformer',genre:'platformer'});
  assert.equal(game.multiplayer,false);assert.equal(game.maxPlayers,1);assert(!('kit' in game));
  assert.equal((await service.read(game.id,'assets/marker.txt')).content,'arcade asset');
  assert.equal(JSON.parse(await readFile(path.join(service.root,game.id,'game.json'),'utf8')).kit,'arcade-2d');
  assert(!('kit' in await service.get(game.id)));assert(!('kit' in (await service.catalog()).games[0]));
  const remix=await service.remix(game.id);assert(!('kit' in remix.game));
  assert.equal(JSON.parse(await readFile(path.join(service.root,remix.game.id,'game.json'),'utf8')).kit,'arcade-2d');
  // A single-player meta export must not enable room checks, redirects or invites.
  await service.write(game.id,[{path:'client.js',content:'const ui="<button>Join room</button>";'}]);
  const result=await service.validate(game.id);assert(result.passed,JSON.stringify(result));assert(!result.warnings.some(w=>/room query/.test(w)));
  assert.equal((await service.publish(game.id)).roomInviteUrlPattern,undefined);
  for(const prefix of ['/api','/motion-api']) {
    let status=0;let headers:Record<string,string>={};
    await gameHttp({method:'GET'} as any,{writeHead(code:number,values:Record<string,string>){status=code;headers=values;},end(){}} as any,new URL(`${prefix}/games/${game.id}/play/index.html`,'http://localhost'),workspace,async()=>({}));
    assert.equal(status,200);assert.equal(headers.Location,undefined);
  }
}));

test('multiplayer shooter selects coop with vendor and characters',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);const {game}=await service.create({...brief,genre:'shooter',multiplayer:true});
  assert.equal((await service.read(game.id,'index.html')).content,'<canvas id="coop"></canvas>');
  assert.equal((await service.read(game.id,'characters/marker.txt')).content,'coop character');
  assert.equal((await service.read(game.id,'vendor/three.module.min.js')).content,'// local three');
  assert.equal(JSON.parse(await readFile(path.join(service.root,game.id,'game.json'),'utf8')).kit,'coop-3d');
}));

test('multiplayer without a genre selects coop; other multiplayer genres keep the room starter, never arcade',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);
  const kitOf=async(id:string)=>JSON.parse(await readFile(path.join(service.root,id,'game.json'),'utf8')).kit;
  const open=await service.create({prompt:'做个和朋友一起打僵尸的小游戏',multiplayer:true,genre:null,style:null,setting:null});
  assert.equal(await kitOf(open.game.id),'coop-3d');
  for(const genre of ['casual','platformer','racing','story','horror'] as const) {
    const {game}=await service.create({...brief,genre,style:null,multiplayer:true});
    assert.equal(await kitOf(game.id),'starter',genre);
    assert.match((await service.read(game.id,'index.html')).content,/Copy invite link/);
    await assert.rejects(service.read(game.id,'assets/marker.txt'),/ENOENT/);
  }
}));

test('portrait briefs are stored and told to the Agent; invalid orientation is rejected',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);
  const {game}=await service.create({...brief,orientation:'portrait'});
  assert.equal(game.orientation,'portrait');
  const stored=JSON.parse(await readFile(path.join(service.root,game.id,'game.json'),'utf8'));
  assert.match(stored.rawPrompt,/portrait 9:16 phone game/);
  const plain=await service.create(brief);assert.equal(plain.game.orientation,'landscape');
  await assert.rejects(service.create({...brief,orientation:'square'} as any),/Invalid orientation/);
}));

test('playable-ad briefs are portrait single-player only and carry the ad recipe to the Agent',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);
  const {game}=await service.create({...brief,orientation:'portrait',playableAd:true});
  assert.equal(game.playableAd,true);
  const stored=JSON.parse(await readFile(path.join(service.root,game.id,'game.json'),'utf8'));
  assert.match(stored.rawPrompt,/portrait 9:16 phone game/);
  assert.match(stored.rawPrompt,/Format: playable ad/);
  // Landscape or multiplayer briefs ignore the flag rather than building a broken ad.
  const wide=await service.create({...brief,orientation:'landscape',playableAd:true});assert.equal(wide.game.playableAd,undefined);
  const party=await service.create({...brief,multiplayer:true,orientation:'portrait',playableAd:true});assert.equal(party.game.playableAd,undefined);
  const plain=JSON.parse(await readFile(path.join(service.root,wide.game.id,'game.json'),'utf8'));assert.doesNotMatch(plain.rawPrompt,/playable ad/);
  await assert.rejects(service.create({...brief,orientation:'portrait',playableAd:'yes'} as any),/Invalid playableAd/);
}));

test('a remix of a playable ad keeps the ad recipe in its Agent instruction',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);
  const ad=(await service.create({...brief,orientation:'portrait',playableAd:true})).game;
  const remix=await service.remix(ad.id);
  assert.equal(remix.game.playableAd,true);
  assert.match(remix.agentInstruction,/Format: playable ad/);
  const stored=JSON.parse(await readFile(path.join(service.root,remix.game.id,'game.json'),'utf8'));
  assert.match(stored.rawPrompt,/Format: playable ad/);
}));

test('a playable ad may name store pages, other games may not; threshold 0 skips the movement assertion',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);
  const store="<script>const config={store:{ios:'https://apps.apple.com/app/id1',android:'https://play.google.com/store/apps/details?id=a.b'}};</script>";
  const ad=(await service.create({...brief,orientation:'portrait',playableAd:true})).game;
  await service.write(ad.id,[{path:'index.html',content:store}]);
  assert.equal((await service.validate(ad.id)).diagnostics.filter((d:any)=>/External network host/.test(d.message)).length,0);
  const plain=(await service.create(brief)).game;
  await service.write(plain.id,[{path:'index.html',content:store}]);
  assert.ok((await service.validate(plain.id)).diagnostics.some((d:any)=>/apps\.apple\.com/.test(d.message)));
  const base={before:{state:{selfId:'a',players:{a:{x:0,z:0}}}},after:{state:{selfId:'a',phase:'playing',players:{a:{x:0,z:0}}}},clients:1,script:[{type:'click',x:10,y:10}] as any,mobile:{width:390,height:844,scrollWidth:390}};
  const movement=(t?:number,extra:any={})=>gamePlaytestAssertions({...base,...extra,movementThreshold:t}).find((a:any)=>a.name==='scriptedMovement') as any;
  // Threshold 0 skips movement and says so; the record never claims a threshold that was not checked.
  const skipped=movement(0);
  assert.equal(skipped.passed,true);assert.equal(skipped.skipped,true);assert.equal(skipped.expected,'movement not asserted (threshold 0)');assert.equal(skipped.reason,undefined);
  assert.equal(movement().passed,false);
  // A missing authoritative state still fails even when movement is skipped.
  const blind=movement(0,{after:{}});assert.equal(blind.passed,false);assert.match(blind.reason,/Missing authoritative/);
}));

test('single-player 3d selects arcade plus vendor without characters',()=>fixture(async(_,workspace)=>{
  const {service}=await fakeKits(workspace);const {game}=await service.create({...brief,style:'3d'});
  assert.equal((await service.read(game.id,'assets/marker.txt')).content,'arcade asset');
  assert.equal((await service.read(game.id,'vendor/three.module.min.js')).content,'// local three');
  await assert.rejects(service.read(game.id,'characters/marker.txt'),/ENOENT/);
}));

test('missing or incomplete arcade kit falls back to the existing starter',()=>fixture(async(_,workspace)=>{
  for(const missing of ['arcade-2d','arcade-2d/index.html','arcade-2d/logic.js']) {
    const {service,kits}=await fakeKits(workspace);await rm(path.join(kits,missing),{recursive:true,force:true});
    for(const multiplayer of [false,true]) {
      const {game}=await service.create({...brief,multiplayer});
      assert.match((await service.read(game.id,'index.html')).content,/requestAnimationFrame|Copy invite link/);
      assert.equal(JSON.parse(await readFile(path.join(service.root,game.id,'game.json'),'utf8')).kit,'starter');
      assert.equal((await service.validate(game.id)).passed,true);
    }
  }
}));

test('arcade validation compares its own logic baseline and warns below 20 changed lines',()=>fixture(async(_,workspace)=>{
  const {service,soloLogic}=await fakeKits(workspace);const {game}=await service.create(brief);
  for(const lines of [0,19,20]) {
    await service.write(game.id,[{path:'logic.js',content:soloLogic+Array.from({length:lines},(_,i)=>`const custom${i}=${i};`).join('\n')}]);
    const result=await service.validate(game.id);assert(result.passed);assert.equal(result.warnings.some(w=>/fewer than 20/.test(w)),lines<20);
  }
}));

test('offline co-op kit scaffolds shooter/3d multiplayer with all relative runtime assets',()=>fixture(async(service)=>{
  for (const selection of [{genre:'shooter' as const,style:'pixel' as const},{genre:'racing' as const,style:'3d' as const}]) {
    const {game}=await service.create({...brief,...selection,multiplayer:true});
    const files=(await service.detail(game.id)).files.map(f=>f.path);
    for(const file of ['logic.js','index.html','client.js','style.css','vendor/three.module.min.js','vendor/GLTFLoader.js','vendor/SkeletonUtils.js','vendor/BufferGeometryUtils.js','characters/Mage.glb','characters/Knight.glb','characters/LICENSE-KayKit.txt']) assert(files.includes(file),file);
    const validation=await service.validate(game.id);assert.equal(validation.passed,true);assert.deepEqual(validation.diagnostics,[]);assert(validation.warnings.some(w=>/starter kit/.test(w)));
    assert.equal((await service.staticFile(game.id,'characters/Mage.glb')).mime,'model/gltf-binary');
    const client=(await service.read(game.id,'client.js')).content;
    assert.match(client,/\.\/characters\/Mage.glb/);assert.match(client,/sessionStorage/);
    for(const file of ['GLTFLoader.js','SkeletonUtils.js','BufferGeometryUtils.js']) {
      const code=(await service.read(game.id,'vendor/'+file)).content;
      assert(!/from\s+['"](?:three|\.\.\/)/.test(code));assert.match(code,/from ['"]\.\/three.module.min.js['"]/);
    }
  }
}));

test('dependency-free GLB inspector reads Mage and Knight animation names and durations',async()=>{
  const run=promisify(execFile);
  for (const [name,triangles] of [['Mage',5683],['Knight',6952]] as const) {
    const {stdout}=await run(process.execPath,['scripts/game-glb-inspect.mjs',`templates/game-kits/characters/${name}.glb`]);
    const result=JSON.parse(stdout);assert.equal(result.triangleCount,triangles);assert.equal(result.boneCount,41);assert.equal(result.animations.length,12);
    for(const clip of ['Idle','Walking_A','Running_A','Jump_Full_Short','Dodge_Forward','Spellcast_Shoot','1H_Melee_Attack_Chop','1H_Ranged_Shoot','Block','Hit_A','Death_A','Cheer']) assert(result.animations.some((c:any)=>c.name===clip&&c.duration>0),clip);
    assert.match(await readFile(new URL('characters/README.md',kitRoot),'utf8'),/Spellcast_Shoot/);
  }
});

test('co-op logic rejects forged events, normalizes movement, advances waves, loses and restarts by vote',async()=>{
  const source=await readFile(new URL('coop-3d/logic.js',kitRoot),'utf8');
  const a=new GameRuntime(source,'coop'),b=new GameRuntime(source,'coop');
  for(const runtime of [a,b]) {
    runtime.setup(['a','b']);
    runtime.apply('a',{type:'membership',player:'cheater',connected:true});
    runtime.apply('a',{type:'tick'});
    assert.equal(runtime.view('a').tick,0);assert.equal(runtime.view('a').players.cheater,undefined);
    const initial=runtime.view('a').players.a;
    runtime.apply('a',{type:'move',dx:1,dz:1,ax:0,az:1,fire:false,aimed:false});runtime.tick(1);
    const p=runtime.view('a').players.a;assert(Math.abs(Math.hypot(p.x-initial.x,p.z-initial.z)-.25)<1e-10);
    runtime.membership('c',true); assert(runtime.view('c').players.c.connected);
    runtime.membership('c',false);
    // No active defenders: enemies eventually destroy the objective.
    runtime.membership('a',false);runtime.membership('b',false);
    for(let t=2;t<5000&&!runtime.over().over;t++) runtime.tick(t);
    assert.equal(runtime.view('a').result,'loss');assert.equal(runtime.view('a').objective,0);
    runtime.membership('a',true);runtime.membership('b',true);
    runtime.apply('a',{type:'restart'});assert.equal(runtime.over().over,true);
    runtime.apply('b',{type:'restart'});assert.equal(runtime.over().over,false);assert.equal(runtime.view('a').objective,100);
  }
  assert.deepEqual(a.view('a'),b.view('a'));
  // Pure module harness checks the final-wave boundary without depending on aim skill.
  const logic=await import(new URL('coop-3d/logic.js',kitRoot).href);
  const ctx={tick:1,now:50,random:()=>.5},state=logic.setup(ctx,['a']);
  state.wave=state.totalWaves;state.nextWave=2;ctx.tick=2;
  assert.equal(logic.applyAction(state,null,{type:'tick'},ctx).result,'win');
  assert.deepEqual(logic.isGameOver(state,ctx),{over:true,winners:['a']});
});

test('room frames reclaim reconnect tokens, admit late players, reject token theft and enforce capacity',()=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,genre:'shooter',style:'3d',multiplayer:true});
  const server=createServer(),close=attachGameRooms(server,workspace),all:MemorySocket[]=[];
  async function connect() {
    const socket=new MemorySocket();all.push(socket);const next=memoryInbox(socket);
    server.emit('upgrade',{method:'GET',url:`/api/games/${game.id}/rooms/reconnect`,headers:{host:'localhost','sec-websocket-key':wsKey,'sec-websocket-version':'13',upgrade:'websocket'}},socket,Buffer.alloc(0));
    await next(m=>m.type==='upgrade');return {socket,next};
  }
  try {
    const a=await connect();a.socket.receive({type:'join',name:'A'});const joined=await a.next(m=>m.type==='joined');assert.equal(typeof joined.reconnectToken,'string');
    a.socket.receive({type:'start'});await a.next(m=>m.type==='state');
    const b=await connect();b.socket.receive({type:'join',name:'Late B'});const late=await b.next(m=>m.type==='joined');
    assert.notEqual(late.playerId,joined.playerId);assert((await b.next(m=>m.type==='state')).view.players[late.playerId].connected);
    b.socket.receive({type:'input',action:{type:'move',dx:1,dz:0,ax:0,az:1,fire:false,aimed:false}});
    await b.next(m=>m.type==='state'&&m.view.players[late.playerId].x>0);
    a.socket.destroy();await once(a.socket,'close');
    const reclaimed=await connect();reclaimed.socket.receive({type:'join',reconnectToken:joined.reconnectToken});
    const back=await reclaimed.next(m=>m.type==='joined');assert.equal(back.playerId,joined.playerId);assert.equal(back.reconnectToken,joined.reconnectToken);
    assert.equal((await reclaimed.next(m=>m.type==='state')).view.players[joined.playerId].connected,true);
    const c=await connect();c.socket.receive({type:'join',reconnectToken:joined.reconnectToken});assert.match((await c.next(m=>m.type==='error')).message,/already connected/);
    c.socket.receive({type:'join',reconnectToken:'invalid'});assert.match((await c.next(m=>m.type==='error')).message,/expired/);
    c.socket.receive({type:'join'});const jc=await c.next(m=>m.type==='joined');assert.equal(jc.players.length,3);
    const d=await connect();d.socket.receive({type:'join'});await d.next(m=>m.type==='joined');
    const e=await connect();e.socket.receive({type:'join'});assert.match((await e.next(m=>m.type==='error')).message,/Room full/);
  } finally {close();for(const socket of all)socket.destroy();}
}));


test('four reference defenders can clear all five waves with the actual simulation',async()=>{
  const source=await readFile(new URL('coop-3d/logic.js',kitRoot),'utf8'),runtime=new GameRuntime(source,'reachable-win');
  runtime.setup(['a','b','c','d']);
  const routes=[0,1,2,3].map(i=>runtime.referenceRoute(i));
  for(let tick=1;tick<3000&&!runtime.over().over;tick++){runtime.tick(tick);for(let i=0;i<4;i++)for(const step of routes[i])if(tick>=step.fromTick&&tick<=step.toTick)runtime.apply(['a','b','c','d'][i],step.action);}
  assert.equal(runtime.view('a').wave,5);assert.equal(runtime.view('a').result,'win');
  assert.deepEqual(runtime.over().winners,['a','b','c','d']);
});

test('expired reconnect tokens release seats without reclaiming the former identity',async t=>fixture(async(_,workspace)=>{
  t.mock.timers.enable({apis:['Date'],now:100000});
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,genre:'shooter',multiplayer:true});
  const server=createServer(),close=attachGameRooms(server,workspace),sockets:MemorySocket[]=[];
  async function connect() {
    const socket=new MemorySocket();sockets.push(socket);const next=memoryInbox(socket);
    server.emit('upgrade',{method:'GET',url:`/api/games/${game.id}/rooms/expiry`,headers:{host:'localhost','sec-websocket-key':wsKey,'sec-websocket-version':'13',upgrade:'websocket'}},socket,Buffer.alloc(0));
    await next(m=>m.type==='upgrade');return {socket,next};
  }
  try {
    const a=await connect();a.socket.receive({type:'join'});const joined=await a.next(m=>m.type==='joined');
    a.socket.receive({type:'start'});await a.next(m=>m.type==='state');
    a.socket.destroy();await once(a.socket,'close');t.mock.timers.setTime(130001);
    const b=await connect();b.socket.receive({type:'join',reconnectToken:joined.reconnectToken});assert.match((await b.next(m=>m.type==='error')).message,/expired/);
    b.socket.receive({type:'join'});const fresh=await b.next(m=>m.type==='joined');assert.notEqual(fresh.playerId,joined.playerId);
    const state=await b.next(m=>m.type==='state');assert.equal(state.view.players[joined.playerId],undefined);assert(state.view.players[fresh.playerId].connected);
  } finally {close();for(const socket of sockets)socket.destroy();}
}));

import { runInNewContext } from 'node:vm';
import { phase1Tools } from '../shared/phase1-tools.ts';
import { tools as legacyTools } from '../mcp-tools.ts';

test('sandbox previews get CORS and correct module/model MIME on both mounted prefixes',()=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,genre:'shooter',multiplayer:true});
  const store=new WorkspaceStore(workspace),dir=(await service.locate(game.id)).dir;
  for(const name of ['sample.mjs','sample.webp','sample.wasm']) await writeFile(path.join(dir,name),'fixture');
  async function call(url:string) {
    const req=Readable.from([]) as any;Object.assign(req,{method:'GET',url,headers:{host:'localhost',origin:'null'}});
    let status=0;const headers:Record<string,unknown>={};
    const res={setHeader(k:string,v:unknown){headers[k.toLowerCase()]=v;},writeHead(code:number,values:Record<string,unknown>){status=code;for(const [k,v] of Object.entries(values??{}))headers[k.toLowerCase()]=v;},end(){}} as any;
    await handler(req,res,store,{} as any);return {status,headers};
  }
  for(const prefix of ['/api/games','/motion-api/games']) {
    for(const [file,type] of [['client.js','text/javascript'],['sample.mjs','text/javascript'],['characters/Mage.glb','model/gltf-binary'],['sample.webp','image/webp'],['sample.wasm','application/wasm']]) {
      const result=await call(`${prefix}/${game.id}/play/${file}`);assert.equal(result.status,200);assert.equal(result.headers['access-control-allow-origin'],'*');assert(String(result.headers['content-type']).startsWith(type));
    }
    const metadata=await call(`${prefix}/${game.id}`);assert.equal(metadata.status,200);assert.equal(metadata.headers['access-control-allow-origin'],undefined);
    assert.equal((await call(`${prefix}/${game.id}/play/game.json`)).status,404);
  }
}));

test('rooms accept sandbox and loopback origins on both prefixes and reject foreign origins/hosts',()=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,genre:'shooter',multiplayer:true});
  const server=createServer(),close=attachGameRooms(server,workspace),sockets:MemorySocket[]=[];
  let room=0;
  try {
    for(const prefix of ['/api/games','/motion-api/games']) for(const origin of [undefined,'null','http://localhost:5173','http://127.0.0.1:5174','https://[::1]:5173']) {
      const socket=new MemorySocket();sockets.push(socket);const next=memoryInbox(socket);
      const wire=once(socket.output,'wire');
      server.emit('upgrade',{method:'GET',url:`${prefix}/${game.id}/rooms/preview-${++room}`,headers:{host:'localhost:3000',origin,'sec-websocket-key':wsKey,'sec-websocket-version':'13',upgrade:'websocket'}},socket,Buffer.alloc(0));
      assert.match((await wire)[0].toString(),/^HTTP\/1.1 101/);
      socket.receive({type:'join'});const joined=await next(m=>m.type==='joined');
      socket.receive({type:'start'});assert.equal((await next(m=>m.type==='state')).view.players[joined.playerId].connected,true);
      socket.destroy();
    }
    for(const [host,origin] of [['localhost:3000','https://foreign.example'],['localhost:3000','http://localhost.evil.example:5173'],['foreign.example','null'],['localhost:3000','file://localhost'],['localhost:3000','malformed']]) {
      const socket=new MemorySocket();sockets.push(socket);const wire=once(socket.output,'wire');
      server.emit('upgrade',{method:'GET',url:`/motion-api/games/${game.id}/rooms/rejected`,headers:{host,origin,'sec-websocket-key':wsKey,'sec-websocket-version':'13',upgrade:'websocket'}},socket,Buffer.alloc(0));
      assert.match((await wire)[0].toString(),/^HTTP\/1.1 400/);
    }
  } finally {close();for(const socket of sockets)socket.destroy();}
}));

test('both generated clients build ws/wss room URLs from the served location and preserve proxy prefixes',()=>fixture(async(service)=>{
  const {game}=await service.create({...brief,multiplayer:true}),basic=(await service.read(game.id,'client.js')).content;
  const kit=await readFile(new URL('coop-3d/client.js',kitRoot),'utf8');
  const kitUrl=kit.slice(kit.indexOf('  const roomUrl ='),kit.indexOf('  socket.onopen'));
  for(const source of [basic,kitUrl]) for(const protocol of ['http:','https:']) for(const prefix of ['/api/games','/motion-api/games']) {
    const href=`${protocol}//localhost:5173${prefix}/project/play/index.html?room=touch-room#ignored`;
    const observed:string[]=[];
    runInNewContext(source,{
      URL,URLSearchParams,location:{href,protocol,pathname:new URL(href).pathname,search:'?room=touch-room'},roomId:'touch-room',
      WebSocket:class {constructor(url:string){observed.push(url);}},
      document:{querySelector:()=>({getContext:()=>({})})},addEventListener(){},sessionStorage:{getItem:()=>null},setTimeout,clearTimeout,
    });
    assert.deepEqual(observed,[`${protocol==='http:'?'ws:':'wss:'}//localhost:5173${prefix}/project/rooms/touch-room`]);
  }
}));

test('metadata tool persists safe owned fields and locale merges, preserves counters and warns without blocking publication',()=>fixture(async(service,workspace)=>{
  const {game}=await service.create(brief);
  await service.write(game.id,['plan.md','assets.csv','verification.md'].map(name=>({path:'design/'+name,content:'Test fixture; project verification pending.'})));
  const initial=await service.publish(game.id);assert.equal(initial.game.status,'published');assert.equal(initial.warnings.length,2);
  await service.interact(game.id,'play');
  await service.write(game.id,[{path:'assets/cover.svg',content:'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"/>'}]);
  const patch={id:game.id,title:'Orbit Guard',description:'Defend the orbital gate.',controls:'WASD or touch joystick',cover:'assets/cover.svg',i18n:{'zh-CN':{title:'轨道守卫',description:'守住轨道大门。',controls:'键盘或触控摇杆'}}};
  const tool=gameTools.find(t=>t.name==='openmotion_game_update_meta')!;validateInput(tool.inputSchema,patch);
  assert.throws(()=>validateInput(tool.inputSchema,{...patch,i18n:{'zh-CN':{unknown:'bad'}}}));
  const updated:any=await dispatchGameTool(tool.name,patch,workspace);assert.equal(updated.title,patch.title);assert.equal(updated.plays,1);
  assert.equal(updated.cover,`/api/games/${game.id}/play/assets/cover.svg`);assert.deepEqual(updated.i18n,patch.i18n);assert.equal(updated.rawPrompt,undefined);
  const stored=JSON.parse(await readFile(path.join(service.root,game.id,'game.json'),'utf8'));assert.equal(stored.cover,'assets/cover.svg');assert.equal(stored.rawPrompt,brief.prompt);
  await service.publish(game.id);
  const translated=await dispatchGameTool('motion_game_update_meta',{id:game.id,i18n:{'zh-CN':{controls:'触控移动'},en:{title:'Orbit Guard'}}},workspace) as any;
  assert.equal(translated.i18n['zh-CN'].title,'轨道守卫');assert.equal(translated.i18n['zh-CN'].controls,'触控移动');assert.equal(translated.status,'published');
  assert.deepEqual((await service.publish(game.id)).warnings,[]);
  await dispatchGameTool(tool.name,{id:game.id,title:brief.prompt},workspace);
  assert.equal((await service.publish(game.id)).warnings.length,1); // description edits must not hide raw-prompt titles
  const before=await readFile(path.join(service.root,game.id,'game.json'),'utf8');
  for(const bad of [{title:''},{title:'x'.repeat(201)},{description:42},{controls:null},{status:'published'},{cover:'../secret.png'},{cover:'/cover.png'},{cover:'https://foreign.example/a.png'},{cover:'client.js'},{cover:'assets/missing.png'},{cover:'assets/cover.svg?bad'}, {i18n:[]},{i18n:{'zh-CN':{title:7}}},{i18n:{'../bad':{title:'bad'}}}]) {
    await assert.rejects(service.updateMeta(game.id,bad as any));assert.equal(await readFile(path.join(service.root,game.id,'game.json'),'utf8'),before);
  }
  await symlink(path.join(service.root,game.id,'assets/cover.svg'),path.join(service.root,game.id,'assets/link.svg'));
  await assert.rejects(service.updateMeta(game.id,{cover:'assets/link.svg'}),/Symlink/);
  const template=path.join(service.templates,'metadata-template');await mkdir(template,{recursive:true});await writeFile(path.join(template,'game.json'),JSON.stringify(game));
  await assert.rejects(service.updateMeta('metadata-template',{title:'No write'}),/not found/);
  const long=await service.create({...brief,prompt:'Long original brief '.repeat(10)});assert.equal((await service.publish(long.game.id)).warnings.filter(w=>!w.includes('design/')).length,2);
}));

test('new metadata tool is registered consistently in shared phase-one and legacy lists',async()=>{
  const profile=JSON.parse(await readFile(new URL('../shared/mcp-profiles.json',import.meta.url),'utf8'));
  const names=gameTools.map(tool=>tool.name);
  assert.deepEqual(profile.phase1.tools.filter((name:string)=>name.startsWith('openmotion_game_')),names);
  assert.deepEqual(phase1Tools.filter(tool=>tool.name.startsWith('openmotion_game_')).map(tool=>tool.name),names);
  assert.deepEqual(legacyTools.filter(tool=>tool.name.startsWith('openmotion_game_')).map(tool=>tool.name),names);
});

test('validation checks external client.js URLs with the same CDN allowlist and permits an absent optional client',()=>fixture(async(service)=>{
  const {game}=await service.create(brief);assert.equal((await service.validate(game.id)).passed,true);
  for(const url of ['https://foreign.example/script.js','//foreign.example/script.js','https://cdn.jsdelivr.net.evil.example/script.js','wss://foreign.example/room']) {
    await service.write(game.id,[{path:'client.js',content:`fetch('${url}');`}]);
    const result=await service.validate(game.id);assert.equal(result.passed,false);assert(result.diagnostics.some(d=>d.path==='client.js'&&d.message.includes('External network host')));
  }
  for(const url of ['https://cdn.jsdelivr.net/package/file.js','https://unpkg.com/package/file.js','https://cdnjs.cloudflare.com/file.js','./vendor/module.js']) {
    await service.write(game.id,[{path:'client.js',content:`import '${url}';`}]);assert.equal((await service.validate(game.id)).passed,true);
  }
  const coop=await service.create({...brief,genre:'shooter',multiplayer:true});const runtime=new GameRuntime((await service.read(coop.game.id,'logic.js')).content,'solo');assert.equal(runtime.meta.minPlayers,1);
  const basic=await service.create({...brief,multiplayer:true});assert.equal(new GameRuntime((await service.read(basic.game.id,'logic.js')).content,'solo-basic').meta.minPlayers,1);
}));

test('co-op lobby joins a room on load without typing and survives an opaque iframe denying history replacement',async()=>{
  const source=await readFile(new URL('coop-3d/client.js',kitRoot),'utf8'),html=await readFile(new URL('coop-3d/index.html',kitRoot),'utf8');
  assert.doesNotMatch(html,/id="room"|id="join"/);
  const start=source.indexOf('roomId = room;'),join=source.slice(start,source.indexOf('connect();',start)+'connect();'.length);
  const elements:any={'room-code':{textContent:''}};let connected=0;
  runInNewContext('let roomId,tokenKey;const room="sandbox-room";'+join,{
    $:(id:string)=>elements[id],URL,location:{href:'http://localhost:5173/motion-api/games/example/play/index.html',pathname:'/motion-api/games/example/play/index.html'},
    history:{replaceState(){throw Error('SecurityError');}},connect(){connected++;},
  });
  assert.equal(connected,1);assert.equal(elements['room-code'].textContent,'sandbox-room');
});

import { gameCoverDimensions, assertGameCoverSize, gameChangedLines, validateGameScript } from '../game-projects.ts';
import { browserExecutable } from '../browser.ts';

function pngHeader(width:number,height:number) {
  const data=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(data);data.writeUInt32BE(width,16);data.writeUInt32BE(height,20);return data;
}
test('cover dimensions enforce minimum size and 16:9 tolerance for raster and SVG inputs',()=>{
  for(const [w,h] of [[960,540],[1280,720],[1920,1080],[1260,720]]) {const size=gameCoverDimensions(pngHeader(w,h),'.png');assert.deepEqual(size,{width:w,height:h});assertGameCoverSize(size);}
  for(const [w,h] of [[959,540],[960,539],[1280,800],[1280,1280],[2000,720]]) assert.throws(()=>assertGameCoverSize(gameCoverDimensions(pngHeader(w,h),'.png')),/960x540/);
  assert.deepEqual(gameCoverDimensions(Buffer.from('<svg viewBox="0 0 1280 720"></svg>'),'.svg'),{width:1280,height:720});
  assert.throws(()=>gameCoverDimensions(Buffer.from('<svg/>'),'.svg'),/dimensions/);
  assert.throws(()=>gameCoverDimensions(Buffer.from('not an image'),'.png'),/dimensions/);
  const gif=Buffer.alloc(10);gif.write('GIF89a');gif.writeUInt16LE(1280,6);gif.writeUInt16LE(720,8);assert.deepEqual(gameCoverDimensions(gif,'.gif'),{width:1280,height:720});
  const webp=Buffer.alloc(30);webp.write('RIFF');webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUIntLE(1279,24,3);webp.writeUIntLE(719,27,3);assert.deepEqual(gameCoverDimensions(webp,'.webp'),{width:1280,height:720});
});

test('metadata rejects small and browser-window-shaped covers without changing saved metadata',()=>fixture(async(service)=>{
  const {game}=await service.create(brief),dir=(await service.locate(game.id)).dir;
  await writeFile(path.join(dir,'small.png'),pngHeader(640,360));await writeFile(path.join(dir,'window.png'),pngHeader(1280,900));
  for(const cover of ['small.png','window.png'])await assert.rejects(service.updateMeta(game.id,{cover}),/960x540/);
  assert.equal((await service.get(game.id)).cover,null);
}));

test('headless scripts are bounded key/mouse/wait actions rather than JavaScript or desktop commands',()=>{
  const script=[{type:'key',key:'w',event:'down'},{type:'wait',ms:200},{type:'key',key:'w',event:'up'},{type:'mouse',event:'click',selector:'#nova'},{type:'mouse',event:'move',x:10,y:20}];
  assert.deepEqual(validateGameScript(script),script);
  for(const bad of [[{type:'eval',code:'process.exit()'}],[{type:'key',key:'Meta+L'}],[{type:'mouse',event:'click',selector:'body button'}],[{type:'mouse',event:'move',x:-1,y:20}],[{type:'wait',ms:10001}],Array.from({length:7},()=>({type:'wait',ms:10000})),Array(101).fill({type:'wait',ms:0})]) assert.throws(()=>validateGameScript(bad));
});

test('new server headless tools expose schema/dispatch validation without starting a browser',()=>fixture(async(service,workspace)=>{
  const {game}=await service.create({...brief,genre:'shooter',multiplayer:true});
  const capture=gameTools.find(t=>t.name==='openmotion_game_capture_cover')!,play=gameTools.find(t=>t.name==='openmotion_game_playtest')!;
  validateInput(capture.inputSchema,{id:game.id,delayMs:0,actions:[{type:'mouse',event:'click',selector:'#nova'}]});
  validateInput(play.inputSchema,{id:game.id,clients:2,durationMs:1000,scripts:[[{type:'key',key:'w'}],[]]});
  assert.throws(()=>validateInput(play.inputSchema,{id:game.id,clients:5,durationMs:1}));
  await assert.rejects(dispatchGameTool(play.name,{id:game.id,clients:5,durationMs:0},workspace),/clients/);
  await assert.rejects(dispatchGameTool(capture.name,{id:game.id,delayMs:-1},workspace),/delayMs/);
  await assert.rejects(service.playtest(game.id,{clients:2,scripts:[[],[],[]]}),/one script/);
  await assert.rejects(service.captureCover(game.id,{actions:[{type:'eval'} as any]}),/Only key/);
}));

test('validation returns advisory starter and missing-cover warnings without failing a valid game',()=>fixture(async(service)=>{
  const {game}=await service.create({...brief,genre:'shooter',multiplayer:true});const source=(await service.read(game.id,'logic.js')).content;
  assert.equal(gameChangedLines(source,source),0);assert.equal(gameChangedLines('a\nb\nc','a\nb\nd'),1);
  assert.equal(gameChangedLines(source.replace('enemyPerWave: 2','enemyPerWave: 3'),source),1);
  let result=await service.validate(game.id);assert(result.passed);assert(result.warnings.some(w=>/starter kit/.test(w)));assert(result.warnings.some(w=>/cover/.test(w)));
  await service.write(game.id,[{path:'logic.js',content:source+'\n'+Array.from({length:25},(_,i)=>`const unique${i}=${i};`).join('\n')}]);
  result=await service.validate(game.id);assert(result.passed);assert(!result.warnings.some(w=>/starter kit/.test(w)));
}));

async function coopLogic(){return import(new URL('coop-3d/logic.js',kitRoot).href);}
function context(){let seed=42;return {tick:0,now:0,random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}};}
test('co-op spawn order, skill cooldowns, damage/down states and revive are authoritative and deterministic',async()=>{
  const logic=await coopLogic();
  async function run(){
    const ctx=context();let state=logic.setup(ctx,['first','second']);assert.notDeepEqual([state.players.first.x,state.players.first.z],[state.players.second.x,state.players.second.z]);
    state=logic.applyAction(state,null,{type:'membership',player:'third',connected:true},ctx);assert.equal(state.players.third.order,2);
    assert(logic.validateAction(state,'first',{type:'skill',skill:'dash'},ctx));
    const start={x:state.players.first.x,z:state.players.first.z};state=logic.applyAction(state,'first',{type:'skill',skill:'dash'},ctx);
    assert.equal(Math.hypot(state.players.first.x-start.x,state.players.first.z-start.z),4.5);
    assert.equal(logic.validateAction(state,'first',{type:'skill',skill:'dash'},ctx),false);
    const ready=state.players.first.dashReady;ctx.tick=ready-1;assert(!logic.validateAction(state,'first',{type:'skill',skill:'dash'},ctx));ctx.tick=ready;assert(logic.validateAction(state,'first',{type:'skill',skill:'dash'},ctx));
    const p=state.players.first;state.enemies=[{id:5,x:p.x,z:p.z+1,hp:2,maxHP:2,kind:'hunter',attackReady:0,hitTick:-100}];
    state=logic.applyAction(state,'first',{type:'skill',skill:'nova'},ctx);assert(state.enemies[0].hp<=0);assert(state.events.some(e=>e.type==='death'));
    assert(!logic.validateAction(state,'first',{type:'skill',skill:'nova'},ctx));
    state=logic.setup(context(),['first','second']);state.phase='combat';state.nextWave=10000;
    const victim=state.players.first;victim.hp=12;victim.aimed=true;victim.fire=false;victim.lastInput=1;
    state.enemies=[{id:100,x:victim.x,z:victim.z+.5,hp:1000,maxHP:1000,kind:'hunter',attackReady:0,hitTick:-100}];
    ctx.tick=1;ctx.now=50;state=logic.applyAction(state,null,{type:'tick'},ctx);assert.equal(victim.hp,0);assert(victim.downed);assert(state.events.some(e=>e.type==='hurt'));assert(state.events.some(e=>e.type==='down'));
    assert(!logic.validateAction(state,'first',{type:'skill',skill:'nova'},ctx));
    state.enemies=[];state.phase='breather';state.nextWave=10000;state.players.second.x=victim.x+1;state.players.second.z=victim.z;
    for(let i=2;i<=40;i++){ctx.tick=i;state=logic.applyAction(state,null,{type:'tick'},ctx);}assert(victim.downed);assert.equal(victim.reviveProgress,39);
    ctx.tick=41;state=logic.applyAction(state,null,{type:'tick'},ctx);assert(!victim.downed);assert.equal(victim.hp,60);assert(state.events.some(e=>e.type==='revive'));
    return JSON.parse(JSON.stringify(state));
  }
  assert.deepEqual(await run(),await run());
});

test('solo downed player respawns after five seconds and area skills damage only nearby enemies',async()=>{
  const logic=await coopLogic(),ctx=context();let state=logic.setup(ctx,['solo']);const p=state.players.solo;
  p.hp=0;p.downed=true;p.downTick=0;state.nextWave=10000;
  for(let tick=1;tick<100;tick++){ctx.tick=tick;state=logic.applyAction(state,null,{type:'tick'},ctx);}assert(p.downed);
  ctx.tick=100;state=logic.applyAction(state,null,{type:'tick'},ctx);assert(!p.downed);assert.equal(p.hp,100);
  state.enemies=[{id:1,x:p.x+1,z:p.z,hp:5},{id:2,x:p.x+10,z:p.z,hp:5}];
  state=logic.applyAction(state,'solo',{type:'skill',skill:'nova'},ctx);assert.equal(state.enemies[0].hp,2);assert.equal(state.enemies[1].hp,5);
});

test('headless capture reaches a playable canvas while background polling remains active',async t=>fixture(async(service)=>{
  if(!await browserExecutable().catch(()=>undefined)){t.skip('Local Chrome is unavailable; no browser download attempted');return;}
  const {game}=await service.create(brief);
  await service.write(game.id,[
    {path:'index.html',content:'<!doctype html><canvas id="game" width="1280" height="720"></canvas><script src="./client.js"></script>'},
    {path:'client.js',content:`const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let heartbeats=0;
      window.__omGame={getState:()=>({running:true,heartbeats})};
      function frame(){ctx.fillStyle='#246';ctx.fillRect(0,0,canvas.width,canvas.height);requestAnimationFrame(frame);}frame();
      setInterval(()=>fetch('./heartbeat.txt?tick='+Date.now()).then(response=>{if(response.ok)heartbeats++;}).catch(()=>{}),100);`},
    {path:'heartbeat.txt',content:'alive'},
  ]);
  try{
    const cover=await service.captureCover(game.id,{delayMs:500});
    assert.deepEqual(gameCoverDimensions(await readFile(cover.screenshotPath),'.png'),{width:1280,height:720});
    assert(cover.diagnostics.authoritative?.state.heartbeats>=2,'Background requests must still complete while capturing');
    assert(cover.diagnostics.metrics.fpsEstimate>0);
    assert.equal(cover.diagnostics.consoleErrors.length,0,JSON.stringify(cover.diagnostics.consoleErrors));
    assert.equal(cover.diagnostics.failedRequests.length,0,JSON.stringify(cover.diagnostics.failedRequests));
  }catch(error){if(/EPERM|EACCES|Operation not permitted|Failed to launch|sandbox|MachPortRendezvous|bootstrap_check_in/i.test(String(error))){t.skip('Sandbox blocks local Chrome or loopback: '+String(error).slice(0,300));return;}throw error;}
}));

test('server headless capture/playtest use isolated clients and canvas-only output when Chrome and loopback are available',async t=>fixture(async(service)=>{
  if(!await browserExecutable().catch(()=>undefined)){t.skip('Local Chrome is unavailable; no browser download attempted');return;}
  const {game}=await service.create({...brief,genre:'shooter',style:'3d',multiplayer:true});
  try{
    const cover=await service.captureCover(game.id,{delayMs:500});assert.equal(cover.cover,'assets/cover.png');
    assert.deepEqual(gameCoverDimensions(await readFile(cover.screenshotPath),'.png'),{width:1280,height:720});
    const run=await service.playtest(game.id,{clients:2,durationMs:700,scripts:[[{type:'key',key:'w',event:'down'},{type:'wait',ms:350},{type:'key',key:'w',event:'up'}],[{type:'key',key:'a',event:'down'},{type:'wait',ms:350},{type:'key',key:'a',event:'up'},{type:'mouse',event:'click',selector:'#nova'}]]});
    assert.equal(run.clients.length,2);
    for(const client of run.clients){assert(client.assertions.every(a=>a.passed),JSON.stringify(client.assertions));assert.equal(client.metrics.roomJoined,true);assert.equal(client.metrics.playerCount,2);assert(client.metrics.fpsEstimate>0);assert.equal(client.consoleErrors.length,0,JSON.stringify(client.consoleErrors));assert.equal(client.failedRequests.length,0,JSON.stringify(client.failedRequests));assert.deepEqual(gameCoverDimensions(await readFile(client.screenshotPath),'.png'),{width:1280,height:720});}
  }catch(error){if(/EPERM|EACCES|Operation not permitted|Failed to launch|sandbox|MachPortRendezvous|bootstrap_check_in/i.test(String(error))){t.skip('Sandbox blocks local Chrome or loopback: '+String(error).slice(0,300));return;}throw error;}
}));

test('procedural enemy geometry and instanced eyes build from the actual client source without WebGL',async()=>{
  const THREE=await import(new URL('vendor/three.module.min.js',kitRoot).href);
  const {mergeGeometries}=await import(new URL('vendor/BufferGeometryUtils.js',kitRoot).href);
  const source=await readFile(new URL('coop-3d/client.js',kitRoot),'utf8');
  const geometry=source.slice(source.indexOf('const enemyParts ='),source.indexOf('const decalMaterial='));
  const scene=new THREE.Scene();runInNewContext(geometry,{THREE,mergeGeometries,scene});
  assert.equal(scene.children.length,2);
  for(const mesh of scene.children){assert(mesh.isInstancedMesh);assert(mesh.geometry.getAttribute('position').count>0);assert.equal(mesh.instanceMatrix.count,64);}
});

import { gameNextSteps, gamePlaytestAssertions, validateSimulationRoute } from '../game-projects.ts';

test('simulation is deterministic and the shipped reference wins while idle loses for 1–4 players',()=>fixture(async(service,workspace)=>{
  const {game}=await service.create({...brief,genre:'shooter',style:'3d',multiplayer:true});
  for(const players of [1,2,3,4]) {
    const reference=await service.simulate(game.id,{players,scripts:'reference',maxTicks:2500});
    const idle=await service.simulate(game.id,{players,scripts:'idle',maxTicks:2000});
    assert.equal(reference.result.over,true);assert.equal(reference.result.winners?.length,players,JSON.stringify(reference.timeline.at(-1)));
    assert.equal(reference.timeline.at(-1)?.state.phase,'win');assert(reference.result.tick<=2500);
    assert.equal(idle.result.over,true);assert.deepEqual(idle.result.winners,[]);assert.equal(idle.timeline.at(-1)?.state.phase,'loss');
    assert.equal(idle.timeline.at(-1)?.state.objective,0);assert(idle.result.tick<=2000);
    assert(reference.timeline.length<=100);assert.equal(reference.timeline[0].tick,0);assert.equal(reference.timeline.at(-1)?.tick,reference.result.tick);
    for(let i=1;i<reference.timeline.length;i++)assert(reference.timeline[i].tick>reference.timeline[i-1].tick);
    if(players===2)assert.deepEqual(reference,await dispatchGameTool('openmotion_game_simulate',{id:game.id,players,scripts:'reference',maxTicks:2500},workspace));
  }
}));

test('simulation validates route bounds, falls back to viewFor and leaves game files unchanged',()=>fixture(async(service)=>{
  const {game}=await service.create({...brief,multiplayer:true});
  const before=await readFile(path.join(service.root,game.id,'game.json'),'utf8');
  const source=starterLogic.replace('return { over: false };','return { over: Object.values(state.scores).some(n=>n>=3), winners: Object.keys(state.scores).filter(id=>state.scores[id]>=3) };');
  await service.write(game.id,[{path:'logic.js',content:source}]);
  const metadata=await readFile(path.join(service.root,game.id,'game.json'),'utf8');
  const scripts=[[{fromTick:1,toTick:3,action:{type:'score'}}],'idle'] as any;
  const run=await service.simulate(game.id,{players:2,scripts,maxTicks:20});assert.deepEqual(run.result,{over:true,winners:['player-1'],tick:3});assert.equal(run.timeline.at(-1)?.state.scores['player-1'],3);
  assert.equal(await readFile(path.join(service.root,game.id,'game.json'),'utf8'),metadata);assert.notEqual(before,undefined);
  const idle=await service.simulate(game.id,{players:1,scripts:'idle',maxTicks:10});assert.equal(idle.result.over,false);assert.equal(idle.result.tick,10);
  await assert.rejects(service.simulate(game.id,{players:1,scripts:'reference',maxTicks:10}),/referenceRoute/);
  for(const route of [[{fromTick:0,toTick:2,action:{}}],[{fromTick:3,toTick:2,action:{}}],[{fromTick:1,toTick:10001,action:{}}],[{fromTick:1,toTick:2,action:null}],Array(1001).fill({fromTick:1,toTick:1,action:{}})])assert.throws(()=>validateSimulationRoute(route));
  await assert.rejects(service.simulate(game.id,{players:0,scripts:'idle',maxTicks:10}),/players/);
  await assert.rejects(service.simulate(game.id,{players:1,scripts:[],maxTicks:10}),/one simulation route/);
  await assert.rejects(service.simulate(game.id,{players:1,scripts:'idle',maxTicks:10001}),/maxTicks/);
  assert.throws(()=>validateSimulationRoute(Array.from({length:17},()=>({fromTick:1,toTick:1,action:{type:'score'}}))),/16 simulation actions/);
  await assert.rejects(service.simulate(game.id,{players:1,scripts:[Array.from({length:11},()=>({fromTick:1,toTick:10000,action:{type:'score'}}))],maxTicks:10000}),/100000/);
  const tool=gameTools.find(t=>t.name==='openmotion_game_simulate')!;validateInput(tool.inputSchema,{id:game.id,players:2,scripts,maxTicks:20});
}));

test('validate gives one non-blocking reminder for each missing design artifact',()=>fixture(async(service)=>{
  const {game}=await service.create(brief),files=['design/plan.md','design/assets.csv','design/verification.md'];
  for(let index=0;index<=files.length;index++){
    const result=await service.validate(game.id);assert(result.passed);
    for(let i=0;i<files.length;i++)assert.equal(result.warnings.filter(w=>w.includes(files[i])).length,i<index?0:1,files[i]);
    if(index<files.length)await service.write(game.id,[{path:files[index],content:'Project-specific draft; results pending.'}]);
  }
}));

test('publish returns exactly three follow-up prompts derived from the plan when supplied',()=>fixture(async(service)=>{
  for(const plan of ['', '# Sample\n\n## Follow-up opportunities\n- Add a shield orb.\n- Add a moon arena.\n- Improve rescue feedback.\n\n## Other\n- Ignore this.']) {
    const {game}=await service.create(brief);
    if(plan)await service.write(game.id,[{path:'design/plan.md',content:plan}]);
    const {nextSteps}=await service.publish(game.id);assert.equal(nextSteps.length,3);assert(nextSteps.every(text=>typeof text==='string'&&text.length>5&&text.length<=200));
    if(plan)assert.deepEqual(nextSteps,['Add a shield orb.','Add a moon arena.','Make a gameplay trailer for this game with openmotion_game_trailer.']);
  }
  assert.equal(gameNextSteps('# Test\n## Follow-up opportunities\n- Same\n- Same').length,3);
}));

test('playtest assertions distinguish authoritative motion, phase, player count and mobile overflow',()=>{
  const before={state:{selfId:'a',players:{a:{x:0,z:0,connected:true},b:{x:2,z:0,connected:true}},phase:'combat'}};
  const after={state:{...before.state,players:{...before.state.players,a:{x:1,z:0,connected:true}}}};
  const base={before,after,clients:2,script:[{type:'key',key:'w',event:'down'}] as any,mobile:{width:390,height:844,scrollWidth:390,overflowElements:[]}};
  const pass=gamePlaytestAssertions(base);assert.equal(pass.length,4);assert(pass.every(item=>item.passed));
  assert.equal(gamePlaytestAssertions({...base,after:before}).find(a=>a.name==='scriptedMovement')?.passed,false);
  assert.equal(gamePlaytestAssertions({...base,clients:3}).find(a=>a.name==='playerCount')?.passed,false);
  assert.equal(gamePlaytestAssertions({...base,expectedPhase:'win'}).find(a=>a.name==='phase')?.passed,false);
  assert.equal(gamePlaytestAssertions({...base,mobile:{width:390,height:844,scrollWidth:600}}).find(a=>a.name==='mobileHorizontalOverflow')?.passed,false);
  assert.equal(gamePlaytestAssertions({...base,mobile:{width:390,height:844,scrollWidth:390,overflowElements:['hud']}}).find(a=>a.name==='mobileHorizontalOverflow')?.passed,false);
  assert.equal(gamePlaytestAssertions({...base,after:null}).filter(a=>!a.passed).length,3);
});

test('co-op public test hooks return snapshots and send actions through the actual room sender',async()=>{
  const source=await readFile(new URL('coop-3d/client.js',kitRoot),'utf8');
  const hook=source.slice(source.indexOf('window.__omGame=Object.freeze'),source.indexOf('const debugPanel='));
  const view={players:{a:{hp:100,connected:true}},enemies:[],shots:[],tick:4,phase:'combat'},sent:any[]=[],window:any={};
  runInNewContext(hook,{window,view,playerId:'a',measuredFPS:50,renderer:{info:{render:{calls:42}}},socket:{readyState:1},WebSocket:{OPEN:1},send:(message:any)=>sent.push(message)});
  const snapshot=window.__omGame.getState();snapshot.players.a.hp=0;assert.equal(view.players.a.hp,100);assert.equal(snapshot.selfId,'a');
  assert.equal(window.__omGame.getStats().drawCalls,42);assert.equal(window.__omGame.getStats().tick,4);
  assert(window.__omGame.sendAction({type:'skill',skill:'nova'}));assert.equal(sent[0].type,'input');
  assert.match(source,/has\('debug'\)/);
});

test('continuous zero-motion/no-fire input remains an idle loss rather than an automatic win',()=>fixture(async(service)=>{
  const {game}=await service.create({...brief,genre:'shooter',multiplayer:true});
  const run=await service.simulate(game.id,{players:1,scripts:[[{fromTick:1,toTick:2000,action:{type:'move',dx:0,dz:0,ax:0,az:1,fire:false,aimed:false}}]],maxTicks:2000});
  assert(run.result.over);assert.deepEqual(run.result.winners,[]);assert.equal(run.timeline.at(-1)?.state.phase,'loss');
}));

import { inspectProject, pluginRoot as trailerRuntimeRoot } from '../hyperframes.ts';
import { gameTrailerComposition, trailerTransition } from '../game-projects.ts';
import type { GameCard, GameTrailer } from '../shared/game-contract.ts';

async function waitTrailer(service:GameProjects,id:string) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const job=await service.trailer(id);if(['ready','failed'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,5));}
  throw Error('Trailer fixture did not reach a terminal state');
}
class StubTrailerProjects extends GameProjects {
  stages:string[]=[];failure?:'recording'|'composing'|'rendering';hold?:Promise<void>;
  protected override async recordTrailer(id:string,root:string,runId:string,onClip:(clips:string[])=>Promise<void>) {
    this.stages.push((await this.trailer(id)).status);if(this.hold)await this.hold;
    const clips:string[]=[];await mkdir(path.join(root,'trailer/clips'),{recursive:true});
    for(let i=0;i<3;i++){const file=`trailer/clips/${runId}-${i+1}.mp4`;await writeFile(path.join(root,file),Buffer.from('test-only clip bytes'));clips.push(file);await onClip([...clips]);if(this.failure==='recording')throw Error('Fixture recorder failed');}
    return clips;
  }
  protected override async composeTrailer(game:GameCard,_root:string,_clips:string[],onProject:(id:string)=>Promise<void>) {
    this.stages.push((await this.trailer(game.id)).status);const projectId='11111111-1111-4111-8111-111111111111';await onProject(projectId);if(this.failure==='composing')throw Error('Fixture composition failed');return projectId;
  }
  protected override async renderTrailer(_projectId:string) {
    this.stages.push('rendering');if(this.failure==='rendering')throw Error('Fixture render failed');
    const file=path.join(path.dirname(this.root),'fixture-export.mp4');await writeFile(file,'test-only rendered bytes');return file;
  }
}

test('trailer composition is deterministic, localized, editable native HTML and references every clip and cover',()=>{
  const game={title:'Base title',description:'Defend <the gate>',controls:'WASD & click',genre:'shooter',multiplayer:true,i18n:{'zh-CN':{title:'晶石守卫',controls:'键盘与触控'}}} as GameCard;
  const clips=['assets/gameplay-1.mp4','assets/gameplay-2.mp4','assets/gameplay-3.mp4'];
  const built=gameTrailerComposition(game,clips,'assets/cover.png');assert.deepEqual(built,gameTrailerComposition(game,clips,'assets/cover.png'));
  assert.equal(built.composition.title,'晶石守卫');assert.equal(built.composition.duration,19);assert.equal(built.composition.fps,30);
  assert.match(built.html,/data-composition-id="game-trailer"/);assert.match(built.html,/window.__timelines/);assert.match(built.files.map(f=>f.content).join('\n'),/Play now/);assert.match(built.files.map(f=>f.content).join('\n'),/键盘与触控/);
  assert.match(built.files.map(f=>f.content).join('\n'),/Defend &lt;the gate&gt;/);for(const file of [...clips,'assets/cover.png'])assert(built.html.includes(file));
  assert.equal(gameTrailerComposition(game,clips.slice(0,2),'assets/cover.png').composition.duration,15.5);
  for(const [id,start] of [['title-card',.1],['end-card',0]] as const){
    const scene=built.files.find(f=>f.path===`compositions/${id}.html`)!.content,window:any={},starts:number[]=[];
    runInNewContext(/<script>([\s\S]*?)<\/script>/.exec(scene)![1],{window,gsap:{timeline:()=>({fromTo:(_target:any,_from:any,_to:any,at:number)=>starts.push(at)})}});
    assert.deepEqual(starts,[start]);assert(window.__timelines[id]);
  }
  assert.doesNotMatch(built.html,/timeline\.fromTo\('#(?:title-text|end-cta)/);

  assert.throws(()=>gameTrailerComposition(game,['../bad.mp4','assets/b.mp4'],'assets/cover.png'),/Unsafe/);
  assert.throws(()=>gameTrailerComposition(game,[],'assets/cover.png'),/2–3/);
});

test('persistent trailer state machine, active coalescing, restart and catalog projection use the GameTrailer contract',()=>fixture(async(_,workspace)=>{
  const service=new StubTrailerProjects(workspace,path.join(workspace,'templates')),{game}=await service.create(brief);
  await assert.rejects(service.startTrailer(game.id),/ready or published/);await service.status(game.id,'ready');
  let release!:()=>void;service.hold=new Promise(resolve=>release=resolve);
  const start=await service.startTrailer(game.id);assert.equal(start.status,'recording');assert.equal(start.progress,0);assert.equal((start as any).runId,undefined);
  assert.equal((await service.startTrailer(game.id)).status,'recording');assert.equal((await service.get(game.id)).trailer?.status,'recording');
  release();service.hold=undefined;const finished=await waitTrailer(service,game.id);assert.equal(finished.status,'ready');assert.equal(finished.progress,1);assert.equal(finished.clips?.length,3);assert(finished.projectId);assert.equal(finished.videoUrl,`/api/games/${game.id}/play/trailer/trailer.mp4`);
  assert.deepEqual(service.stages,['recording','composing','rendering']);assert.equal((await new GameProjects(workspace).get(game.id)).trailer?.status,'ready');
  assert.equal((await service.catalog()).games[0].trailer?.videoUrl,finished.videoUrl);
  const media=await service.staticFile(game.id,'trailer/trailer.mp4');assert.equal(media.mime,'video/mp4');assert.equal(media.data.toString(),'test-only rendered bytes');
  await assert.rejects(service.staticFile(game.id,'trailer/job.json'),/Private/);await assert.rejects(service.write(game.id,[{path:'trailer/job.json',content:'{}'}]),/text source/);
  const second=await service.startTrailer(game.id);assert.equal(second.status,'recording');await waitTrailer(service,game.id);assert.equal(service.stages.length,6);
  assert(trailerTransition('recording','composing'));assert(trailerTransition('composing','rendering'));assert(trailerTransition('rendering','ready'));assert(trailerTransition('recording','failed'));assert(!trailerTransition('recording','ready'));assert(!trailerTransition('ready','recording'));
}));

test('interrupted trailer jobs fail on recovery and failures retain completed clips and partial project identity',()=>fixture(async(_,workspace)=>{
  const service=new StubTrailerProjects(workspace,path.join(workspace,'templates')),{game}=await service.create(brief);await service.status(game.id,'ready');
  await mkdir(path.join(service.root,game.id,'trailer'),{recursive:true});
  await writeFile(path.join(service.root,game.id,'trailer/job.json'),JSON.stringify({runId:'stopped-process',status:'rendering',progress:.7,clips:['kept.mp4'],projectId:'kept-project',updatedAt:new Date(0).toISOString()}));
  const recovered=await new GameProjects(workspace).trailer(game.id);assert.equal(recovered.status,'failed');assert.match(recovered.error!,/service restart/);assert.deepEqual(recovered.clips,['kept.mp4']);assert.equal(recovered.projectId,'kept-project');
  for(const failure of ['recording','composing','rendering'] as const){service.failure=failure;await service.startTrailer(game.id);const job=await waitTrailer(service,game.id);assert.equal(job.status,'failed');assert.match(job.error!,new RegExp(failure+' failed'));assert(job.clips!.length>0);if(failure!=='recording')assert(job.projectId);}
}));

test('live trailer owners in another service process are coalesced and private owner fields stay internal',()=>fixture(async(_,workspace)=>{
  const service=new StubTrailerProjects(workspace,path.join(workspace,'templates')),{game}=await service.create(brief);await service.status(game.id,'ready');
  await mkdir(path.join(service.root,game.id,'trailer'),{recursive:true});
  const stored={runId:'another-service',ownerPid:process.pid,status:'recording',clips:[],updatedAt:new Date().toISOString()};
  await writeFile(path.join(service.root,game.id,'trailer/job.json'),JSON.stringify(stored));
  const result=await service.startTrailer(game.id);assert.equal(result.status,'recording');assert.equal((result as any).ownerPid,undefined);assert.equal((result as any).runId,undefined);assert.deepEqual(service.stages,[]);
  assert.equal(JSON.parse(await readFile(path.join(service.root,game.id,'trailer/job.json'),'utf8')).runId,'another-service');
}));

test('template trailer jobs use a writable workspace overlay without modifying the bundled game',()=>fixture(async(_,workspace)=>{
  const service=new StubTrailerProjects(workspace,path.join(workspace,'templates')),{game}=await service.create(brief),template=path.join(service.templates,'trailer-template');
  await mkdir(template,{recursive:true});const metadata=JSON.stringify({...game,status:'published',id:'trailer-template',source:'template'});await writeFile(path.join(template,'game.json'),metadata);await writeFile(path.join(template,'index.html'),'<canvas id="game"></canvas>');
  await service.startTrailer('trailer-template');const job=await waitTrailer(service,'trailer-template');assert.equal(job.status,'ready');
  assert.equal(await readFile(path.join(template,'game.json'),'utf8'),metadata);await assert.rejects(readFile(path.join(template,'trailer/job.json')));
  assert.equal((await service.get('trailer-template')).trailer?.status,'ready');assert.equal((await service.staticFile('trailer-template','trailer/trailer.mp4')).mime,'video/mp4');
  assert.equal(JSON.parse(await readFile(path.join(workspace,'game-trailers/trailer-template/trailer/job.json'),'utf8')).status,'ready');
}));

class NativeTrailerProjectFixture extends GameProjects {
  createNative(game:GameCard,root:string,clips:string[]){return this.composeTrailer(game,root,clips,async()=>{});}
}
test('trailer composition uses the actual MCP native-project creation path and creates an independent editable project',async t=>fixture(async(_,workspace)=>{
  const previous=process.env.HYPERFRAMES_HISTORY_ROOT;process.env.HYPERFRAMES_HISTORY_ROOT=path.join(workspace,'native-history');
  t.after(()=>{if(previous===undefined)delete process.env.HYPERFRAMES_HISTORY_ROOT;else process.env.HYPERFRAMES_HISTORY_ROOT=previous;});
  const service=new NativeTrailerProjectFixture(workspace,path.join(workspace,'templates')),{game}=await service.create(brief),root=(await service.locate(game.id)).dir;
  await service.write(game.id,[{path:'cover.svg',content:'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"/>'}]);await service.updateMeta(game.id,{cover:'cover.svg'});
  await mkdir(path.join(root,'trailer/clips'),{recursive:true});const clips=['trailer/clips/1.mp4','trailer/clips/2.mp4','trailer/clips/3.mp4'];for(const clip of clips)await writeFile(path.join(root,clip),'stub bytes: composition-only test');
  const projectId=await service.createNative(await service.get(game.id),root,clips),store=new WorkspaceStore(workspace),project=store.forProject(projectId);
  assert(store.projectCatalog().projects.some(p=>p.id===projectId));assert(store.projectCatalog().sessions!.some(s=>s.artifacts.some(a=>a.projectId===projectId)));
  assert.match((await project.readFile('index.html')).content,/data-composition-id="game-trailer"/);assert.equal(JSON.parse((await project.readFile('trailer.json')).content).duration,19);
  for(const asset of ['cover.svg','gameplay-1.mp4','gameplay-2.mp4','gameplay-3.mp4'])assert((await readFile(path.join(project.projectDirectory,'assets',asset))).length>0);
  for(const id of ['title-card','end-card']){assert.match((await project.readFile('index.html')).content,new RegExp('data-composition-src="compositions/'+id+'\\.html"'));const scene=(await project.readFile('compositions/'+id+'.html')).content;assert.match(scene,/<template>/);assert(scene.includes('data-composition-id="'+id+'"'));assert(scene.includes("window.__timelines['"+id+"']"));}
  const lint=await inspectProject(trailerRuntimeRoot,project.projectDirectory,'lint');assert.equal(lint.exitCode,0,JSON.stringify(lint.result));
  const shorter=gameTrailerComposition(await service.get(game.id),['assets/gameplay-1.mp4','assets/gameplay-2.mp4'],'assets/cover.svg');
  await project.writeFiles((await project.get()).revision,shorter.files);
  const shorterLint=await inspectProject(trailerRuntimeRoot,project.projectDirectory,'lint');assert.equal(shorterLint.exitCode,0,JSON.stringify(shorterLint.result));
}));

test('trailer HTTP and MCP status/start adapters use the shared domain service',()=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create(brief),tool=gameTools.find(t=>t.name==='openmotion_game_trailer')!;
  validateInput(tool.inputSchema,{id:game.id,action:'start'});assert.throws(()=>validateInput(tool.inputSchema,{id:game.id,action:'merge'}));
  await assert.rejects(dispatchGameTool(tool.name,{id:game.id,action:'start'},workspace),/ready or published/);
  async function call(method:string,url:string){const req=Readable.from([]) as any;req.method=method;let status=0,body='';const res={writeHead(code:number){status=code;},end(value:any){body=String(value??'');}} as any;await gameHttp(req,res,new URL(url,'http://localhost'),workspace,async()=>({}));return {status,body};}
  assert.equal((await call('POST',`/api/games/${game.id}/trailer`)).status,409);assert.equal((await call('GET',`/motion-api/games/${game.id}/trailer`)).status,404);
  await mkdir(path.join(service.root,game.id,'trailer'),{recursive:true});await writeFile(path.join(service.root,game.id,'trailer/job.json'),JSON.stringify({runId:'fixture',status:'failed',error:'Fixture',updatedAt:new Date().toISOString()}));
  assert.equal(JSON.parse((await call('GET',`/api/games/${game.id}/trailer`)).body).error,'Fixture');assert.equal((await dispatchGameTool(tool.name,{id:game.id,action:'status'},workspace) as GameTrailer).status,'failed');
}));

test('real gameplay recording and native trailer rendering stay wired when all local prerequisites are available',async t=>fixture(async(_,workspace)=>{
  const probe=createServer();if(!await listen(t,probe))return;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  if(!await browserExecutable().catch(()=>undefined)){t.skip('Local Chrome is unavailable; nothing was downloaded');return;}
  const {verificationBinaries}=await import('../scripts/verify-export.ts');const {execute,pluginRoot}=await import('../hyperframes.ts');
  const {nativeRuntimeStatus}=await import('../scripts/npm-runtime.mjs');const native=await nativeRuntimeStatus(pluginRoot);
  if(native.managed&&!native.capabilities.export){t.skip('Existing native export components are unavailable; no preparation was started');return;}
  try{for(const binary of Object.values(verificationBinaries()))if((await execute(binary,['-version'],workspace,10000)).code)throw Error('Native binary is unavailable');}
  catch(error){if(/ENOENT|EACCES|unavailable/.test(String(error))){t.skip(String(error));return;}throw error;}
  const previous=process.env.HYPERFRAMES_HISTORY_ROOT;process.env.HYPERFRAMES_HISTORY_ROOT=path.join(workspace,'native-history');
  t.after(()=>{if(previous===undefined)delete process.env.HYPERFRAMES_HISTORY_ROOT;else process.env.HYPERFRAMES_HISTORY_ROOT=previous;});
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,genre:'shooter',style:'3d',multiplayer:true});
  await service.status(game.id,'ready');assert.equal((await service.startTrailer(game.id)).status,'recording');
  const deadline=Date.now()+31*60*1000;let job=await service.trailer(game.id);
  while(Date.now()<deadline&&!['failed','ready'].includes(job.status)){await new Promise(resolve=>setTimeout(resolve,250));job=await service.trailer(game.id);}
  if(job.status==='failed'&&/EPERM|EACCES|Failed to launch|sandbox|NATIVE_RUNTIME_NOT_READY/i.test(job.error??'')){t.skip(job.error);return;}
  assert.equal(job.status,'ready',job.error);assert.equal(job.clips?.length,3);assert(job.projectId);assert(job.videoUrl);
  const media=await service.staticFile(game.id,'trailer/trailer.mp4');assert.equal(media.data.toString('ascii',4,8),'ftyp');
}));

test('multiplayer entry redirects both prefixes to a fresh room and preserves queries; assets and solo pages stay direct',()=>fixture(async(service,workspace)=>{
  const multi=(await service.create({...brief,multiplayer:true})).game,solo=(await service.create(brief)).game;
  async function get(url:string){let status=0;const headers:Record<string,string>={};let body:any;await gameHttp({method:'GET'} as any,{writeHead(code:number,values:Record<string,string>){status=code;Object.assign(headers,values);},end(value:any){body=value;}} as any,new URL(url,'http://localhost'),workspace,async()=>({}));return {status,headers,body};}
  const rooms=new Set<string>();
  for(const prefix of ['/api','/motion-api'])for(const entry of ['', 'index.html']){
    const url=`${prefix}/games/${multi.id}/play/${entry}?debug=1&lang=zh-CN`,response=await get(url);assert.equal(response.status,302);
    const redirect=new URL(response.headers.Location,'http://localhost');assert.equal(redirect.pathname,new URL(url,'http://localhost').pathname);assert.equal(redirect.searchParams.get('debug'),'1');assert.equal(redirect.searchParams.get('lang'),'zh-CN');assert.match(redirect.searchParams.get('room')!,/^[a-z0-9]{8}$/);rooms.add(redirect.searchParams.get('room')!);
    assert.equal((await get(redirect.pathname+redirect.search)).status,200);
    assert.equal((await get(`${prefix}/games/${solo.id}/play/${entry}?debug=1`)).status,200);
    assert.equal((await get(`${prefix}/games/${multi.id}/play/${entry}?room=existing`)).status,200);
    assert.equal((await get(`${prefix}/games/${multi.id}/play/logic.js`)).status,200);
  }
  assert.equal(rooms.size,4);
}));

test('multiplayer validation blocks room entry inputs and join buttons, warns on missing room reads, and gates publish',()=>fixture(async(service)=>{
  const {game}=await service.create({...brief,multiplayer:true});
  const cases=[['index.html','<input id="room-code">'],['index.html',"<input name='roomCode' type='text'>"],['client.js','const ui=`<input placeholder="请输入房间号">`;'],['index.html','<label for="code">房间号</label><input id="code">'],['index.html','<label>Room code <input></label>'],['client.js','const ui=`<button>Join <span>room</span></button>`;'],['index.html','<button>加入房间</button>'],['client.js',"button.textContent='Join room';"]];
  for(const [file,source] of cases){await service.write(game.id,[{path:'index.html',content:'<canvas id="game"></canvas>'},{path:'client.js',content:'const room = new URLSearchParams(location.search).get("room");'}]);await service.write(game.id,[{path:file,content:source}]);const validation=await service.validate(game.id);assert.equal(validation.passed,false,source);assert(validation.diagnostics.some(d=>d.path===file&&/forbidden/.test(d.message)),source);await assert.rejects(service.publish(game.id),/validation/i);}
  await service.write(game.id,[{path:'index.html',content:'<canvas id="game"></canvas><input id="nickname"><input type="hidden" id="room"><p>Room code: demo</p><button>Copy invite link</button><button id="start">Start</button>'},{path:'client.js',content:'const room = new URL(location.href).searchParams.get("room");'}]);
  assert.equal((await service.validate(game.id)).passed,true);assert(!(await service.validate(game.id)).warnings.some(w=>/room query/.test(w)));
  await service.write(game.id,[{path:'client.js',content:'const name="player";'}]);assert((await service.validate(game.id)).warnings.some(w=>/room query/.test(w)));
  const solo=(await service.create(brief)).game;await service.write(solo.id,[{path:'index.html',content:'<input placeholder="Room"><button>Join room</button>'}]);assert.equal((await service.validate(solo.id)).passed,true);
}));

test('playtest autoJoin assertion requires evidence within five seconds captured before any scripted input',()=>{
  const base={before:null,after:null,clients:1,script:[],mobile:{width:390,height:844,scrollWidth:390}};
  for(const [joined,elapsedMs,expected] of [[true,0,true],[true,5000,true],[true,5001,false],[false,null,false]] as const){const assertion=gamePlaytestAssertions({...base,autoJoin:{joined,elapsedMs}}).find(a=>a.name==='autoJoin');assert.equal(assertion?.passed,expected);}
});

test('actual headless join probe observes sockets and authoritative hooks without input',async()=>{
  const source=await readFile(new URL('../game-projects.ts',import.meta.url),'utf8');
  const injected=/await page.evaluateOnNewDocument\(`([\s\S]*?)`\);/.exec(source)![1];
  for(const mode of ['socket','hook'] as const){
    let now=100;const frames:(()=>void)[]=[];
    class Socket {listener?: (e:any)=>void;addEventListener(_name:string,listener:(e:any)=>void){this.listener=listener;}}
    const window:any={WebSocket:Socket};
    runInNewContext(injected,{window,document:{},performance:{now:()=>now},requestAnimationFrame:(frame:()=>void)=>frames.push(frame)});
    assert.equal(window.__openmotionGameProbe.roomJoined,false);
    now=420;
    if(mode==='socket'){const socket=new window.WebSocket();socket.listener({data:JSON.stringify({type:'joined',players:['one']})});}
    else{window.__omGame={getState:()=>({selfId:'one',players:{one:{connected:true}}})};frames.shift()!();}
    assert.equal(window.__openmotionGameProbe.roomJoined,true);assert.equal(window.__openmotionGameProbe.joinedAtMs,420);
    now=6000;frames.shift()!();assert.equal(window.__openmotionGameProbe.joinedAtMs,420);
  }
  assert(source.indexOf('const autoJoin=await page.evaluate')<source.indexOf('startGameBrowserPage(page, !!recording)'));
});

test('basic multiplayer starter auto-joins a generated room and exposes copy/start without room inputs',()=>fixture(async(service)=>{
  const {game}=await service.create({...brief,multiplayer:true});const html=(await service.read(game.id,'index.html')).content,client=(await service.read(game.id,'client.js')).content;
  assert.match(html,/Copy invite link/);assert.match(html,/id="room-code"/);assert.match(html,/>Start<\/button>/);assert.doesNotMatch(html,/<input\b/i);
  const nodes=new Map<string,any>(['#room-code','#invite','#start','canvas'].map(id=>[id,{getContext:()=>({}),onclick:null,textContent:''}]));
  const sockets:any[]=[];let copied='';class Socket {onopen?:()=>void;onmessage?:()=>void;url:string;constructor(url:string){this.url=url;sockets.push(this);}send(){}close(){}}
  runInNewContext(client,{URL,location:{href:`http://localhost${game.playUrl}`,pathname:game.playUrl,protocol:'http:'},crypto:{randomUUID:()=> '12345678-abcd'},history:{replaceState(){throw Error('opaque origin');}},document:{querySelector:(id:string)=>nodes.get(id)},WebSocket:Socket,addEventListener(){},navigator:{clipboard:{writeText:async(text:string)=>{copied=text;}}},console});
  assert.equal(sockets.length,1);assert.match(sockets[0].url,/\/rooms\/12345678$/);assert.equal(nodes.get('#room-code').textContent,'12345678');await nodes.get('#invite').onclick();assert.equal(new URL(copied).searchParams.get('room'),'12345678');
}));

test('reserved source aliases and tampered metadata cannot redirect saves',()=>fixture(async(service,workspace)=>{
  const {game}=await service.create(brief), metadata=path.join(service.root,game.id,'game.json');
  const original=await readFile(metadata,'utf8');
  for(const file of ['GAME.JSON','Game.Json','./game.json','TRAILER/x.js','trailer/X.js']) {
    await assert.rejects(service.write(game.id,[{path:file,content:'{}'}]));
    assert.equal(await readFile(metadata,'utf8'),original);
  }
  for(const method of ['write','updateMeta','status'] as const){
    await writeFile(metadata,JSON.stringify({...game,id:'../escaped'}));
    if(method==='write')await service.write(game.id,[{path:'safe.js',content:'// safe'}]);
    else if(method==='updateMeta')await service.updateMeta(game.id,{title:'Safe title'});
    else await service.status(game.id,'ready');
    assert.equal(JSON.parse(await readFile(metadata,'utf8')).id,game.id);
    await assert.rejects(readFile(path.join(workspace,'escaped','game.json')),/ENOENT/);
  }
  await assert.rejects((service as any).save('../escape',game),/Invalid.*id/);
}));

test('source batches reject path conflicts and roll back source and status after a save failure',()=>fixture(async(service)=>{
  const {game}=await service.create(brief);await service.status(game.id,'ready');
  const root=(await service.locate(game.id)).dir, before=await readFile(path.join(root,'index.html'),'utf8'),meta=await readFile(path.join(root,'game.json'),'utf8');
  for(const paths of [['a.js','a.js/b.js'],['A.js/b.js','a.js'],['same.js','SAME.js']]) {
    await assert.rejects(service.write(game.id,[{path:'index.html',content:'changed'},...paths.map(path=>({path,content:'new'}))]),/conflict|duplicate/i);
    assert.equal(await readFile(path.join(root,'index.html'),'utf8'),before);
    assert.equal(await readFile(path.join(root,'game.json'),'utf8'),meta);
  }
  const save=(service as any).save;
  (service as any).save=async()=>{throw Error('Injected metadata save failure');};
  try{await assert.rejects(service.write(game.id,[{path:'index.html',content:'changed'},{path:'new/folder/file.js',content:'new'}]),/Injected/);}
  finally{(service as any).save=save;}
  assert.equal(await readFile(path.join(root,'index.html'),'utf8'),before);
  assert.equal(await readFile(path.join(root,'game.json'),'utf8'),meta);
  await assert.rejects(readFile(path.join(root,'new/folder/file.js')),/ENOENT/);
  const detail=service.detail;
  service.detail=async()=>{throw Error('Injected receipt failure');};
  try{await assert.rejects(service.write(game.id,[{path:'index.html',content:'changed again'}]),/receipt failure/);}
  finally{service.detail=detail;}
  assert.equal(await readFile(path.join(root,'index.html'),'utf8'),before);
  assert.equal(await readFile(path.join(root,'game.json'),'utf8'),meta);
  await service.write(game.id,[{path:'index.html',content:'committed'}]);
  assert.equal((await service.get(game.id)).status,'building');
  assert.equal(await readFile(path.join(root,'index.html'),'utf8'),'committed');
}));

test('HTML and SVG have one opaque-origin sandbox CSP with local asset and room access',()=>fixture(async(service,workspace)=>{
  const {game}=await service.create(brief);await service.write(game.id,[{path:'image.svg',content:'<svg xmlns="http://www.w3.org/2000/svg"/>'}]);
  for(const prefix of ['/api/games','/motion-api/games'])for(const file of ['index.html','image.svg']){
    let headers:Record<string,any>={};
    await gameHttp({method:'GET',headers:{host:'localhost:4321'}} as any,{writeHead(status:number,h:Record<string,any>){assert.equal(status,200);headers=h;},end(){}} as any,new URL(`${prefix}/${game.id}/play/${file}`,'http://localhost'),workspace,async()=>({}));
    const csp=headers['Content-Security-Policy'];assert.equal(typeof csp,'string');
    assert.match(csp,/(?:^|;)\s*sandbox allow-scripts allow-pointer-lock allow-popups allow-modals(?:;|$)/);
    assert.doesNotMatch(csp,/allow-same-origin/);assert.equal(csp.match(/sandbox/g).length,1);
    assert.match(csp,/blob: data:|data: blob:/);assert(csp.includes(`ws://localhost:4321${prefix}/${game.id}/rooms/`));
    assert.equal(headers['Access-Control-Allow-Origin'],'*');
  }
}));

test('both bundled starter logic modules simulate and inert determinism examples are allowed',()=>fixture(async(_,workspace)=>{
  const service=new GameProjects(workspace,path.join(workspace,'templates'));
  for(const multiplayer of [false,true]){
    const {game}=await service.create({...brief,multiplayer,genre:'shooter'});
    const run=await service.simulate(game.id,{players:1,scripts:'idle',maxTicks:3});assert.equal(run.result.tick,3);
  }
  new GameRuntime(starterLogic+'\n// Math.random Date.now require import\nconst examples=["Math.random()",`Date.now()`,/require/];','examples');
  for(const code of ['Math.random()','Math["random"]()','Date.now()','Date["now"]()','require("fs")','import("fs")','`value ${Math.random()}`'])assert.throws(()=>new GameRuntime(starterLogic+`;${code};`,'reject'),/cannot import\/require/);
}));

test('empty continuation floods, unfinished messages and oversized receive buffers disconnect',t=>fixture(async(_,workspace)=>{
  const service=gameProjectsFor(workspace),{game}=await service.create({...brief,multiplayer:true});
  const server=createServer(),close=attachGameRooms(server,workspace),sockets:MemorySocket[]=[];
  try{
    async function connect(room:string){const socket=new MemorySocket();sockets.push(socket);const next=memoryInbox(socket);server.emit('upgrade',{method:'GET',url:`/api/games/${game.id}/rooms/${room}`,headers:{host:'localhost',origin:'null','sec-websocket-key':wsKey,'sec-websocket-version':'13',upgrade:'websocket'}},socket,Buffer.alloc(0));await next(m=>m.type==='upgrade');socket.receive({type:'join'});await next(m=>m.type==='joined');return socket;}
    const empty=(opcode:number)=>Buffer.from([opcode,0x80,1,2,3,4]);
    const flood=await connect('flood');for(let i=0;i<100&&!flood.destroyed;i++)flood.emit('data',empty(i?0:1));assert.equal(flood.destroyed,true);
    const huge=await connect('huge');huge.emit('data',Buffer.concat(Array.from({length:22000},()=>empty(0x89))));assert.equal(huge.destroyed,true);
    const slow=await connect('slow');t.mock.timers.enable({apis:['setTimeout']});slow.emit('data',empty(1));t.mock.timers.tick(10001);assert.equal(slow.destroyed,true);t.mock.timers.reset();
  }finally{t.mock.timers.reset();close();for(const socket of sockets)socket.destroy();}
}));

test('default arcade playtest starts gameplay and passes movement when Chrome and loopback are available',async t=>fixture(async(_,workspace)=>{
  const service=new GameProjects(workspace,path.join(workspace,'templates'));gameProjectsFor(workspace).kits=service.kits;
  const {game}=await service.create(brief);
  try{
    const run=await service.playtest(game.id);const movement=run.clients[0].assertions.find(a=>a.name==='scriptedMovement');
    assert(movement,JSON.stringify(run.clients[0].assertions));assert.equal(movement.passed,true,JSON.stringify(run.clients[0]));
    assert.deepEqual(run.clients[0].failedRequests,[]);assert.deepEqual(run.clients[0].consoleErrors,[]);
  }catch(error){if(/EPERM|EACCES|Chrome|Chromium|browser.*not|executable/i.test(String(error)))t.skip('Local Chrome or loopback unavailable: '+String(error));else throw error;}
}));


test('isolated startup uses the visible start control or start hook before observing running ticks',async()=>{
  for(const button of [true,false]){
    const order:string[]=[],state={tick:0,phase:'playing'},window={__omGame:{getState:()=>state,start:()=>order.push('hook')}};
    const page={
      async evaluate(fn:Function){return runInNewContext(`(${fn.toString()})()`,{window});},
      async $(selector:string){assert.match(selector,/#start/);return button?{async click(){order.push('click');}}:null;},
      async waitForFunction(fn:Function,_options:unknown,tick:number){order.push('wait');assert.equal(runInNewContext(`(${fn.toString()})(${tick})`,{window}),false);state.tick=1;assert.equal(runInNewContext(`(${fn.toString()})(${tick})`,{window}),true);},
    };
    await startGameBrowserPage(page as any);
    assert.deepEqual(order,[button?'click':'hook','wait']);
  }
});

test('default arcade input uses its horizontal keyboard controls for both press and release',()=>fixture(async(_,workspace)=>{
  const service=new GameProjects(workspace,path.join(workspace,'templates')),{game}=await service.create(brief);
  let scripts:any;
  (service as any).runBrowser=async(_id:string,_clients:number,inputs:any)=>{scripts=inputs;return {clients:[]};};
  await service.playtest(game.id);
  assert.deepEqual(scripts[0],[{type:'key',key:'d',event:'down'},{type:'wait',ms:350},{type:'key',key:'d',event:'up'}]);
  const client=(await service.read(game.id,'client.js')).content;assert.match(client,/KeyD/);
}));

test('any workspace draft returns a complete Agent handoff; templates do not',()=>fixture(async(service,workspace)=>{
  const created=await service.create({...brief,prompt:'Co-op zombie night shift',multiplayer:true,orientation:'portrait'});
  const handoff=await service.handoff(created.game.id);
  assert.equal(handoff.gameId,created.game.id); assert.equal(handoff.status,'draft');
  assert.equal(handoff.agentInstruction,created.agentInstruction);
  for(const part of [created.game.id,'openmotion_game_get','openmotion_game_set_status','Co-op zombie night shift','portrait 9:16']) assert(handoff.agentInstruction.includes(part),part);
  await service.status(created.game.id,'building'); assert.equal((await service.handoff(created.game.id)).status,'building');
  const template=path.join(service.templates,'racer'); await mkdir(template,{recursive:true});
  await writeFile(path.join(template,'game.json'),JSON.stringify({...created.game,id:'racer',status:'published',source:'template'}));
  await writeFile(path.join(template,'index.html'),'<title>Template</title>');
  await assert.rejects(service.handoff('racer'),/not found/);
  const remix=await service.remix('racer'); const again=await service.handoff(remix.game.id);
  assert.equal(again.agentInstruction,remix.agentInstruction); assert.match(again.agentInstruction,/remix game/);
}));

test('game tools use the runtime root that the host passes, so packaged builds find puppeteer-core and hyperframes',()=>fixture(async(_,workspace)=>{
  const runtime=path.join(workspace,'installed-runtime');
  const created=await dispatchGameTool('openmotion_game_create',{...brief},workspace,runtime);
  assert.equal(gameProjectsFor(workspace).runtimeRoot,runtime);
  // Without a runtime root the existing service keeps the last one; a fresh workspace falls back to the plugin root.
  assert.notEqual(gameProjectsFor(path.join(workspace,'other')).runtimeRoot,runtime);
  // Playtest resolves puppeteer-core from the runtime root: an empty runtime fails there, not in the plugin checkout.
  await assert.rejects(dispatchGameTool('openmotion_game_playtest',{id:created.game.id,clients:1,durationMs:0},workspace,runtime),/puppeteer-core/);
}));

test('catalog reports an unreadable game folder instead of failing, and a failed create leaves no orphan',()=>fixture(async(service,workspace)=>{
  const { game }=await service.create(brief);
  await mkdir(path.join(service.root,'orphan-without-game-json'));
  await mkdir(path.join(service.root,'malformed')); await writeFile(path.join(service.root,'malformed','game.json'),'{ not json');
  const catalog=await service.catalog();
  assert.deepEqual(catalog.games.map(card=>card.id),[game.id]);
  assert.deepEqual(catalog.issues?.map(issue=>issue.id).sort(),['malformed','orphan-without-game-json']);
  // A kit that cannot be copied (here a symlink, which project files never follow) aborts create and removes its folder.
  const kits=await mkdtemp(path.join(tmpdir(),'openmotion-broken-kits-'));
  try {
    await mkdir(path.join(kits,'arcade-2d'));
    await writeFile(path.join(kits,'arcade-2d','index.html'),'<!doctype html>'); await writeFile(path.join(kits,'arcade-2d','logic.js'),starterLogic);
    await symlink(path.join(kits,'arcade-2d','logic.js'),path.join(kits,'arcade-2d','linked.js'));
    const broken=new GameProjects(workspace,service.templates,kits);
    await assert.rejects(broken.create(brief));
    assert.deepEqual((await service.catalog()).games.map(card=>card.id),[game.id]);
    assert.equal((await service.catalog()).issues?.length,2);
  } finally { await rm(kits,{recursive:true,force:true}); }
}));

test('single-player games run the bounded logic.js smoke check before publication',()=>fixture(async(_,workspace)=>{
  const service=new GameProjects(workspace,path.join(workspace,'templates'),path.resolve('templates/game-kits'));
  const { game }=await service.create(brief);
  assert.equal(JSON.parse(await readFile(path.join(service.root,game.id,'game.json'),'utf8')).kit,'arcade-2d');
  assert.equal((await service.validate(game.id)).passed,true);
  await service.write(game.id,[{path:'logic.js',content:'export const meta = { minPlayers: 1, maxPlayers: 1, tickRate: 20 };\nexport function setup( {'}]);
  const broken=await service.validate(game.id);
  assert.equal(broken.passed,false); assert(broken.diagnostics.some(item=>item.path==='logic.js'));
  await service.status(game.id,'ready'); await assert.rejects(service.publish(game.id),/validation failed/);
  // The kit client imports logic.js, so deleting it is reported rather than treated as optional.
  await rm(path.join(service.root,game.id,'logic.js'));
  assert((await service.validate(game.id)).diagnostics.some(item=>item.path==='logic.js'));
}));

test('the single-player smoke check respects validateAction, as live play does',()=>fixture(async(_,workspace)=>{
  const service=new GameProjects(workspace,path.join(workspace,'templates'),path.resolve('templates/game-kits'));
  const { game }=await service.create(brief);
  await service.write(game.id,[{path:'logic.js',content:`export const meta = { minPlayers: 1, maxPlayers: 1, tickRate: 20 };
export function setup(players){ return { players, t: 0 }; }
export function validateAction(state, player, action){ return action.type === 'move'; }
export function applyAction(state, player, action){ if (action.type !== 'move') throw new Error('unsupported'); return state; }
export function tick(state){ return { ...state, t: state.t + 1 }; }
export function viewFor(state){ return state; }
export function isGameOver(){ return { over: false }; }`}]);
  assert.deepEqual((await service.validate(game.id)).diagnostics,[]);
}));

test('the smoke check stops when the game ends, as live play does',()=>fixture(async(_,workspace)=>{
  const service=new GameProjects(workspace,path.join(workspace,'templates'),path.resolve('templates/game-kits'));
  const { game }=await service.create(brief);
  await service.write(game.id,[{path:'logic.js',content:`export const meta = { minPlayers: 1, maxPlayers: 1, tickRate: 20 };
export function setup(players){ return { players, t: 0, board: [1] }; }
export function validateAction(){ return true; }
export function applyAction(state){ return state; }
export function tick(state){ if (state.t >= 10) throw new Error('ticked after the game ended'); return { ...state, t: state.t + 1 }; }
export function viewFor(state){ return state; }
export function isGameOver(state){ return { over: state.t >= 10 }; }`}]);
  assert.deepEqual((await service.validate(game.id)).diagnostics,[]);
}));
