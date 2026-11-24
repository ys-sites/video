import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone } from './vendor/SkeletonUtils.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

const $ = id => document.getElementById(id), canvas = $('arena');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch { $('status').textContent = 'WebGL unavailable. Enable hardware acceleration and reload.'; throw Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x132033); scene.fog = new THREE.Fog(0x132033, 25, 52);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.set(0, 19, 18); camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xd9edff, 0x34354d, 2));
const sun = new THREE.DirectionalLight(0xffdfb0, 2); sun.position.set(5, 15, 8); scene.add(sun);
const rim = new THREE.DirectionalLight(0x71bbff, 3); rim.position.set(-8, 8, -12); scene.add(rim);
const floor = new THREE.Mesh(new THREE.BoxGeometry(29, .3, 29), new THREE.MeshStandardMaterial({ color: 0x344e60 })); floor.position.y = -.2; scene.add(floor);
const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), new THREE.MeshStandardMaterial({ color: 0x55e6be, emissive: 0x125f53 })); crystal.position.y = 1.3; scene.add(crystal);
const blocks = [];
for (const x of [-15, 15]) for (const z of [-15, 15]) blocks.push(new THREE.BoxGeometry(1, 3, 1).translate(x, 1.5, z));
const pillars = new THREE.Mesh(mergeGeometries(blocks), new THREE.MeshStandardMaterial({ color: 0x7b8697 })); scene.add(pillars); blocks.forEach(g => g.dispose());
// Offline stylised crystal skeletons: one merged body draw plus one emissive eye draw.
const enemyParts = [new THREE.IcosahedronGeometry(.6, 0).scale(.85,1.1,.65).translate(0,.7,0),new THREE.OctahedronGeometry(.43).translate(0,1.5,0),new THREE.BoxGeometry(.12,.7,.12).rotateZ(.5).translate(-.6,.9,0),new THREE.BoxGeometry(.12,.7,.12).rotateZ(-.5).translate(.6,.9,0)];
const enemies = new THREE.InstancedMesh(mergeGeometries(enemyParts.map(g=>g.index?g.toNonIndexed():g)),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.8}),64); enemyParts.forEach(g=>g.dispose());enemies.count=0;scene.add(enemies);
const eyeParts=[new THREE.BoxGeometry(.1,.12,.08).translate(-.16,1.55,.36),new THREE.BoxGeometry(.1,.12,.08).translate(.16,1.55,.36)];
const enemyEyes=new THREE.InstancedMesh(mergeGeometries(eyeParts),new THREE.MeshBasicMaterial({color:0xffcc66}),64);eyeParts.forEach(g=>g.dispose());enemyEyes.count=0;scene.add(enemyEyes);
const decalMaterial=new THREE.MeshBasicMaterial({color:0x527b82,side:THREE.DoubleSide});
for(const [x,z,r] of [[0,0,2],[-3,3,.9],[3,3,.9],[-3,-3,.9],[3,-3,.9]]){const decal=new THREE.Mesh(new THREE.RingGeometry(r-.08,r,48),decalMaterial);decal.rotation.x=-Math.PI/2;decal.position.set(x,.01,z);scene.add(decal);}
const particles=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.1),new THREE.MeshBasicMaterial({color:0xffb26e}),256);particles.count=0;scene.add(particles);
const sparks=Array.from({length:256},()=>({life:0,x:0,y:0,z:0,vx:0,vy:0,vz:0}));let sparkIndex=0;
const rings=Array.from({length:8},()=>{const mesh=new THREE.Mesh(new THREE.RingGeometry(.85,1,48),new THREE.MeshBasicMaterial({color:0x78daff,side:THREE.DoubleSide,transparent:true}));mesh.rotation.x=-Math.PI/2;mesh.visible=false;scene.add(mesh);return {mesh,life:0,radius:1};});let ringIndex=0;
const seenEvents=new Set();let shake=0,previousResult=null,previousWave=0;
function effect(e){
  if(['death','down','revive','hurt'].includes(e.type))for(let i=0;i<(e.type==='death'?14:6);i++){const p=sparks[sparkIndex++%sparks.length],angle=i*2.399+e.id;p.life=.65;p.x=e.x;p.z=e.z;p.y=.7;p.vx=Math.cos(angle)*3;p.vz=Math.sin(angle)*3;p.vy=2+(i%3);}
  if(e.type==='nova'||e.type==='dash'||e.type==='revive'){const r=rings[ringIndex++%rings.length];r.life=.6;r.radius=e.radius??2;r.mesh.position.set(e.x,.035,e.z);r.mesh.visible=true;}
  if(e.type==='objective-hit')shake=.45;
  sound(e.type);
}
function updateHUD(){
  const p=view.players[playerId];
  $('status').textContent=`Crystal ${view.objective}/${view.rules.objectiveHP} · Wave ${view.wave}/${view.totalWaves} · ${view.enemies.length} enemies${view.result?' · '+(view.result==='win'?'Victory!':'Crystal lost')+' · Restart votes '+view.votes.length:''}`;
  $('hp').max=p?.maxHP??view.rules.playerHP;$('hp').value=p?.hp??0;
  $('team').textContent=p?.downed?`Downed · ${Object.values(view.players).filter(p=>p.connected).length===1?'Respawn in '+Math.max(0,Math.ceil((view.rules.soloRespawnTicks-(view.tick-p.downTick))/view.tickRate))+'s':'Ally revive '+Math.round(p.reviveProgress/view.rules.reviveTicks*100)+'%'}`:'Stand near a downed ally to revive';
  for(const [skill,key] of [['dash','Space'],['nova','E']]){const left=Math.max(0,((p?.[skill+'Ready']??0)-view.tick)/view.tickRate);$(skill).textContent=`${skill==='dash'?'Dash':'Nova'} · ${left>0?left.toFixed(1)+'s':key}`;$(skill).disabled=!p||p.downed||!!view.result||left>0;}
  const countdown=Math.max(0,Math.ceil((view.nextWave-view.tick)/view.tickRate));
  $('wave-banner').textContent=view.result?(view.result==='win'?'ARENA CLEARED':'CRYSTAL FALLEN'):view.phase==='breather'?(view.wave===view.totalWaves?'Victory in ':'Next wave in ')+countdown+'s':view.events.some(e=>e.type==='wave'&&view.tick-e.tick<16)?`WAVE ${view.wave} · DEFEND THE CRYSTAL`:'';
}
const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(.08, .08, 18), new THREE.MeshBasicMaterial({ color: 0xffeb99 }), 32); beams.count = 0; scene.add(beams);
const enemyTint=new THREE.Color();
const muzzles=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.22),new THREE.MeshBasicMaterial({color:0xffeeb4}),32);muzzles.count=0;scene.add(muzzles);
const dummy = new THREE.Object3D(), actors = new Map(), clock = new THREE.Clock();
let model, clips, view, playerId, socket, reconnectTimer, stopped = false, muted = false, audio, lastShot = -1;
// Public game test hooks return snapshots of server views; inputs still use the room protocol.
let measuredFPS=0,frameCount=0,frameWindow=performance.now();
window.__omGame=Object.freeze({
  getState:()=>view?JSON.parse(JSON.stringify({...view,selfId:playerId})):null,
  getStats:()=>({fps:measuredFPS,drawCalls:renderer.info.render.calls,entities:view?Object.values(view.players).filter(p=>p.connected).length+view.enemies.length+view.shots.length:0,tick:view?.tick??0,phase:view?.result??view?.phase??'lobby'}),
  sendAction:action=>{if(socket?.readyState!==WebSocket.OPEN)return false;send({type:'input',action});return true;},
});
const debugPanel=new URLSearchParams(location.search).has('debug')?document.createElement('pre'):null;
if(debugPanel){debugPanel.id='debug';debugPanel.setAttribute('aria-hidden','true');document.body.append(debugPanel);}
const room = new URLSearchParams(location.search).get('room') || 'arena-' + Math.random().toString(36).slice(2, 8);
let roomId, tokenKey;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 3000); }
function sound(kind) {
  const frequency=({hit:660,hurt:130,down:90,wave:520,win:880,lose:110,death:240,revive:740,nova:320,dash:400,'objective-hit':100,shot:440})[kind];
  if(!frequency)return;
  if (muted || !audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime); gain.gain.setValueAtTime(.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .08);
  oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .08);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
function unlockAudio() { try { audio ??= new AudioContext(); void audio.resume(); } catch { /* sound is optional */ } }
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function storedToken() { try { return sessionStorage.getItem(tokenKey); } catch { return null; } }
function connect() {
  clearTimeout(reconnectTimer);
  const roomUrl = new URL(location.href);
  roomUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  roomUrl.pathname = location.pathname.split('/play/')[0] + '/rooms/' + encodeURIComponent(roomId);
  roomUrl.search = ''; roomUrl.hash = '';
  socket = new WebSocket(roomUrl.href);
  socket.onopen = () => send({ type: 'join', reconnectToken: storedToken() || undefined });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'joined') {
      playerId = message.playerId;
      try { sessionStorage.setItem(tokenKey, message.reconnectToken); } catch { toast('Session storage unavailable; refresh cannot reclaim this player.'); }
      $('roster').textContent = `Room ${message.room} · ${message.players.length}/${message.maxPlayers} players`;
      $('start').disabled = false;
    } else if (message.type === 'state') {
      view = message.view; $('lobby').hidden = !view.result; $('restart').hidden = !view.result;
      if(previousResult&&!view.result||view.wave<previousWave){seenEvents.clear();lastShot=-1;}
      previousResult=view.result;previousWave=view.wave;
      updateHUD();
      for(const e of view.events??[])if(!seenEvents.has(e.id)){seenEvents.add(e.id);effect(e);}
      if(seenEvents.size>2048)seenEvents.clear();
      if(view.shots.some(s=>s.until>lastShot)){sound('shot');lastShot=Math.max(...view.shots.map(s=>s.until));}
    } else if (message.type === 'error') {
      toast(message.message);
      if (message.message.startsWith('Reconnect token expired')) { try { sessionStorage.removeItem(tokenKey); } catch {} send({ type: 'join' }); }
    }
  };
  socket.onclose = () => { if (!stopped) { toast('Disconnected. Retrying; seat reserved for 30 seconds.'); reconnectTimer = setTimeout(connect, 1000); } };
  socket.onerror = () => toast('Room connection failed. Keep the local OpenMotion process running.');
}
// Players never type a room: the page joins one on load and friends join through the invite link.
const copyInvite = async () => { const url = new URL(location.href); url.searchParams.set('room', roomId); try { await navigator.clipboard.writeText(url.href); toast('Invite copied. Local browsers only.'); } catch { toast('Clipboard unavailable. Copy the address bar after joining.'); } };
$('copy').onclick = copyInvite; $('invite').onclick = copyInvite;
$('start').onclick = () => { unlockAudio(); send({ type: 'start' }); };
$('restart').onclick = () => send({ type: 'input', action: { type: 'restart' } });
for(const skill of ['dash','nova'])$(skill).onclick=()=>{unlockAudio();send({type:'input',action:{type:'skill',skill}});};
$('mute').onclick = () => { muted = !muted; $('mute').textContent = muted ? 'Unmute' : 'Mute'; };
new GLTFLoader().load('./characters/Mage.glb', gltf => { model = gltf.scene; clips = gltf.animations; $('status').textContent = 'Character ready. Press Start, or invite friends first.'; }, undefined, () => { $('status').textContent = 'Character failed to load. Reload to retry.'; });
const keys = new Set(), stick = { x: 0, z: 0 }, aim = { x: 0, z: 1, active: false, fire: false };
addEventListener('keydown', e => { if (e.target instanceof HTMLInputElement) return; if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault(); keys.add(e.code);if(!e.repeat&&(e.code==='Space'||e.code==='KeyE')){unlockAudio();send({type:'input',action:{type:'skill',skill:e.code==='Space'?'dash':'nova'}});} });
addEventListener('keyup', e => keys.delete(e.code));
function resetInput() { keys.clear(); stick.x = stick.z = 0; aim.fire = aim.active = false; $('joystick').firstElementChild.style.transform = ''; }
addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { resetInput(); if (document.hidden) void audio?.suspend(); else if (!muted) void audio?.resume(); });
const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' || !view?.players[playerId]) return;
  pointer.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2); ray.setFromCamera(pointer, camera);
  if (ray.ray.intersectPlane(plane, hit)) { const p = view.players[playerId], n = Math.hypot(hit.x - p.x, hit.z - p.z) || 1; aim.x = (hit.x - p.x) / n; aim.z = (hit.z - p.z) / n; aim.active = true; }
});
canvas.addEventListener('pointerdown', e => { unlockAudio(); if (e.pointerType !== 'touch') aim.fire = true; });
addEventListener('pointerup', () => aim.fire = false);
let stickPointer;
$('joystick').onpointerdown = e => { stickPointer = e.pointerId; $('joystick').setPointerCapture(e.pointerId); unlockAudio(); updateStick(e); };
function updateStick(e) { if (stickPointer !== e.pointerId) return; const r = $('joystick').getBoundingClientRect(), x = (e.clientX - r.left - r.width / 2) / 40, z = (e.clientY - r.top - r.height / 2) / 40, n = Math.max(1, Math.hypot(x,z)); stick.x = x / n; stick.z = z / n; $('joystick').firstElementChild.style.transform = `translate(${stick.x * 35}px,${stick.z * 35}px)`; }
$('joystick').onpointermove = updateStick;
$('joystick').onlostpointercapture = $('joystick').onpointerup = $('joystick').onpointercancel = () => { stickPointer = undefined; stick.x = stick.z = 0; $('joystick').firstElementChild.style.transform = ''; };
const inputTimer = setInterval(() => { if (!view || view.result) return; send({ type: 'input', action: { type: 'move', dx: Math.max(-1, Math.min(1, stick.x + Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')))), dz: Math.max(-1, Math.min(1, stick.z + Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')))), ax: aim.x, az: aim.z, aimed: aim.active, fire: aim.fire } }); }, 100);
function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight, false); } addEventListener('resize', resize); resize();
function draw() {
  requestAnimationFrame(draw); const dt = Math.min(clock.getDelta(), .05); if (document.hidden) return;
  if (view && model) {
    for (const [id, p] of Object.entries(view.players)) {
      let actor = actors.get(id);
      if (!actor) {
        const root = clone(model), box = new THREE.Box3().setFromObject(root), height = box.max.y - box.min.y;
        root.scale.setScalar(2.4 / height); root.position.y = -box.min.y * 2.4 / height;
        const materials=[];root.traverse(o=>{if(o.isMesh){o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.emissive)materials.push(m);}});
        const group = new THREE.Group(); group.add(root); scene.add(group);
        const mixer = new THREE.AnimationMixer(root), actions = {};
        for (const [key, name] of Object.entries({ idle: 'Idle', run: 'Running_A', attack: 'Spellcast_Shoot', hit: 'Hit_A', death: 'Death_A' })) {
          const clip = THREE.AnimationClip.findByName(clips, name); if (clip) { actions[key] = mixer.clipAction(clip); if (key === 'death' || key === 'hit') { actions[key].setLoop(THREE.LoopOnce, 1); actions[key].clampWhenFinished = true; } }
        }
        actor = { group, mixer, actions, materials, current: null }; actors.set(id, actor);
      }
      actor.group.visible = p.connected; if (!p.connected) continue;
      actor.group.position.set(p.x, 0, p.z); actor.group.rotation.y = Math.atan2(p.ax, p.az);
      for(const m of actor.materials){m.emissive.setHex(view.tick-p.hitTick<5?0xff7755:0);m.emissiveIntensity=view.tick-p.hitTick<5?1.8:0;}
      const action = p.downed ? 'death' : view.tick-p.hitTick<10?'hit': view.tick - p.shot < 5 ? 'attack' : view.tick - p.lastInput <= 8 && Math.hypot(p.dx, p.dz) > .1 ? 'run' : 'idle';
      if (actor.current !== action && actor.actions[action]) { actor.actions[actor.current]?.fadeOut(.2); actor.actions[action].reset().fadeIn(.2).play(); actor.current = action; }
      actor.mixer.update(dt);
    }
    for (const [id, actor] of actors) if (!view.players[id]) { actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.mixer.getRoot()); scene.remove(actor.group);actor.group.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}); actors.delete(id); }
    enemies.count=Math.min(view.enemies.length,64);enemyEyes.count=enemies.count;
    for(let i=0;i<enemies.count;i++){const e=view.enemies[i];dummy.position.set(e.x,Math.sin(performance.now()/180+e.id)*.08,e.z);dummy.rotation.set(0,Math.atan2(-e.x,-e.z),0);dummy.scale.setScalar(e.kind==='siege'?1.2:1);dummy.updateMatrix();enemies.setMatrixAt(i,dummy.matrix);enemyEyes.setMatrixAt(i,dummy.matrix);enemyTint.setHex(view.tick-e.hitTick<4?0xffffff:e.kind==='siege'?0xa599bc:0xd8bba1);enemies.setColorAt(i,enemyTint);}enemies.instanceMatrix.needsUpdate=true;enemyEyes.instanceMatrix.needsUpdate=true;if(enemies.instanceColor)enemies.instanceColor.needsUpdate=true;
    dummy.scale.setScalar(1);
    beams.count = Math.min(view.shots.length, 32); muzzles.count=beams.count;
    for (let i = 0; i < beams.count; i++) { const s = view.shots[i]; dummy.position.set(s.x + s.ax * 9, 1.2, s.z + s.az * 9); dummy.rotation.set(0, Math.atan2(s.ax, s.az), 0); dummy.updateMatrix(); beams.setMatrixAt(i, dummy.matrix);dummy.position.set(s.x+s.ax*.6,1.2,s.z+s.az*.6);dummy.updateMatrix();muzzles.setMatrixAt(i,dummy.matrix); } beams.instanceMatrix.needsUpdate = true;muzzles.instanceMatrix.needsUpdate=true;
  }
  particles.count=0;
  for(const p of sparks)if(p.life>0){p.life-=dt;p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=p.vy*dt;p.vy-=9*dt;dummy.position.set(p.x,Math.max(.05,p.y),p.z);dummy.rotation.set(0,0,0);dummy.scale.setScalar(Math.max(.01,p.life));dummy.updateMatrix();particles.setMatrixAt(particles.count++,dummy.matrix);}particles.instanceMatrix.needsUpdate=true;dummy.scale.setScalar(1);
  for(const r of rings)if(r.life>0){r.life-=dt;r.mesh.scale.setScalar(r.radius*(1-r.life/.6));r.mesh.material.opacity=Math.max(0,r.life/.6);r.mesh.visible=r.life>0;}
  shake=Math.max(0,shake-dt);camera.position.set(Math.sin(performance.now()*.055)*shake*.6,19,18);crystal.rotation.y+=dt*.5;crystal.material.emissiveIntensity=view&&view.tick-view.objectiveHit<6?3:1;
  renderer.render(scene, camera);
  frameCount++;const now=performance.now();if(now-frameWindow>=500){measuredFPS=frameCount*1000/(now-frameWindow);frameCount=0;frameWindow=now;}
  if(debugPanel){const stats=window.__omGame.getStats();debugPanel.textContent=`FPS ${stats.fps.toFixed(1)} · draws ${stats.drawCalls}\nEntities ${stats.entities} · tick ${stats.tick} · ${stats.phase}`;}

} draw();
roomId = room; tokenKey = `openmotion-room:${location.pathname}:${roomId}`; $('room-code').textContent = roomId;
{ const url = new URL(location.href); url.searchParams.set('room', roomId); try { history.replaceState(null, '', url); } catch { /* Opaque sandbox origins may deny history changes. */ } }
connect();
addEventListener('pagehide', () => { stopped = true; clearTimeout(reconnectTimer); clearInterval(inputTimer); socket?.close(); void audio?.close(); renderer.dispose(); });
