// All balance and difficulty values live here; time is measured in authoritative ticks.
const config = {
  waves: 5, arena: 13, speed: 5, inputExpiry: 8, fireTicks: 6, rayRange: 22, rayWidth: .8,
  objectiveHP: 100, playerHP: 100, reviveHP: 60, reviveRadius: 2.5, reviveTicks: 40, soloRespawnTicks: 100,
  enemyBase: 4, enemyPerWave: 2, enemyHP: 2, enemyHPWaveStep: 3, enemySpeed: 1.1, speedPerWave: .12,
  aggroRadius: 9, contactRange: 1.15, contactDamage: 12, objectiveDamage: 5, attackTicks: 18,
  dashDistance: 4.5, dashCooldown: 80, dashInvulnerability: 8, novaRadius: 4, novaDamage: 3, novaCooldown: 160,
  initialDelay: 40, betweenWaves: 80, waveHeal: 12, objectiveRepair: 3, eventLifetime: 16,
  spawns: [[-3,3],[3,3],[-3,-3],[3,-3]],
};
export const meta = { minPlayers: 1, maxPlayers: 4, tickRate: 20, serverTick: true };
function player(id, order) {
  const [x,z] = config.spawns[order % config.spawns.length];
  return { id, order, x, z, dx: 0, dz: 0, ax: 0, az: 1, fire: false, aimed: false, lastInput: -100, shot: -100,
    connected: true, hp: config.playerHP, maxHP: config.playerHP, downed: false, downTick: -100, hitTick: -100,
    reviveProgress: 0, dashReady: 0, novaReady: 0, invulnerableUntil: 0 };
}
function event(state, type, x, z, extra = {}) {
  state.events.push({id: ++state.serial, type, x, z, tick: state.tick, ...extra});
  if(state.events.length>128)state.events.shift();
}
function damageEnemy(state, enemy, damage) {
  if(enemy.hp<=0)return;
  enemy.hp-=damage;enemy.hitTick=state.tick;
  event(state,'hit',enemy.x,enemy.z);
  if(enemy.hp<=0)event(state,'death',enemy.x,enemy.z);
}
function revive(state, p, full) {
  p.hp=full?config.playerHP:config.reviveHP;p.downed=false;p.reviveProgress=0;
  p.invulnerableUntil=state.tick+meta.tickRate;p.dx=p.dz=0;
  if(full){const [x,z]=config.spawns[p.order%config.spawns.length];p.x=x;p.z=z;}
  event(state,'revive',p.x,p.z,{player:p.id});
}
export function setup(ctx, players) {
  return {players:Object.fromEntries(players.map((id,i)=>[id,player(id,i)])),joinOrder:players.length,enemies:[],shots:[],events:[],
    objective:config.objectiveHP,objectiveHit:-100,wave:0,totalWaves:config.waves,nextWave:ctx.tick+config.initialDelay,
    phase:'breather',serial:0,result:null,votes:[],tick:ctx.tick};
}
export function validateAction(state, playerId, action, ctx) {
  const p=state.players[playerId];
  if(!p?.connected||!action||typeof action!=='object')return false;
  if(action.type==='restart')return !!state.result;
  if(state.result||p.downed)return false;
  if(action.type==='skill')return (action.skill==='dash'&&ctx.tick>=p.dashReady)||(action.skill==='nova'&&ctx.tick>=p.novaReady);
  return action.type==='move'&&['dx','dz','ax','az'].every(k=>Number.isFinite(action[k])&&Math.abs(action[k])<=1)&&typeof action.fire==='boolean'&&typeof action.aimed==='boolean';
}
export function applyAction(state, playerId, action, ctx) {
  if(playerId===null&&action.type==='membership') {
    if(action.expired)delete state.players[action.player];
    if(action.connected&&!state.players[action.player])state.players[action.player]=player(action.player,state.joinOrder++);
    const p=state.players[action.player];if(p){p.connected=action.connected;p.dx=p.dz=0;p.fire=false;}
    state.votes=state.votes.filter(id=>state.players[id]?.connected);return state;
  }
  if(playerId!==null) {
    if(!validateAction(state,playerId,action,ctx))return state;
    const p=state.players[playerId];
    if(action.type==='restart') {
      if(!state.votes.includes(playerId))state.votes.push(playerId);
      const connected=Object.keys(state.players).filter(id=>state.players[id].connected);
      if(connected.every(id=>state.votes.includes(id)))return setup(ctx,connected);
    } else if(action.type==='skill') {
      if(action.skill==='dash') {
        let x=p.dx,z=p.dz;if(Math.hypot(x,z)<.01){x=p.ax;z=p.az;}const length=Math.hypot(x,z)||1;
        p.x=Math.max(-config.arena,Math.min(config.arena,p.x+x/length*config.dashDistance));
        p.z=Math.max(-config.arena,Math.min(config.arena,p.z+z/length*config.dashDistance));
        p.dashReady=ctx.tick+config.dashCooldown;p.invulnerableUntil=ctx.tick+config.dashInvulnerability;event(state,'dash',p.x,p.z,{player:p.id});
      } else {
        p.novaReady=ctx.tick+config.novaCooldown;event(state,'nova',p.x,p.z,{player:p.id,radius:config.novaRadius});
        for(const enemy of state.enemies)if(Math.hypot(enemy.x-p.x,enemy.z-p.z)<=config.novaRadius)damageEnemy(state,enemy,config.novaDamage);
      }
    } else {for(const key of ['dx','dz','ax','az','fire','aimed'])p[key]=action[key];p.lastInput=ctx.tick;}
    return state;
  }
  if(action.type!=='tick'||state.result||ctx.tick<=state.tick)return state;
  state.tick=ctx.tick;state.events=state.events.filter(e=>ctx.tick-e.tick<config.eventLifetime);state.shots=state.shots.filter(s=>s.until>ctx.tick);
  const connected=Object.values(state.players).filter(p=>p.connected);
  for(const p of connected)if(p.downed) {
    if(connected.length===1&&ctx.tick-p.downTick>=config.soloRespawnTicks)revive(state,p,true);
    else if(connected.length>1) {
      const nearby=connected.some(other=>other!==p&&!other.downed&&Math.hypot(other.x-p.x,other.z-p.z)<=config.reviveRadius);
      p.reviveProgress=nearby?p.reviveProgress+1:0;if(p.reviveProgress>=config.reviveTicks)revive(state,p,false);
    }
  }
  state.enemies=state.enemies.filter(e=>e.hp>0);
  if(state.phase==='breather'&&ctx.tick>=state.nextWave) {
    if(state.wave>=config.waves){state.result='win';event(state,'win',0,0);return state;}
    state.phase='combat';state.wave++;event(state,'wave',0,0,{wave:state.wave});
    for(let i=0;i<config.enemyBase+state.wave*config.enemyPerWave;i++) {
      const angle=ctx.random()*Math.PI*2,hp=config.enemyHP+Math.floor(state.wave/config.enemyHPWaveStep);
      state.enemies.push({id:++state.serial,x:Math.sin(angle)*config.arena,z:Math.cos(angle)*config.arena,hp,maxHP:hp,kind:i%4===0?'siege':'hunter',hitTick:-100,attackReady:0});
    }
  }
  for(const p of connected) {
    if(p.downed)continue;
    const fresh=ctx.tick-p.lastInput<=config.inputExpiry,magnitude=Math.max(1,Math.hypot(p.dx,p.dz));
    if(fresh){p.x=Math.max(-config.arena,Math.min(config.arena,p.x+p.dx/magnitude*config.speed/meta.tickRate));p.z=Math.max(-config.arena,Math.min(config.arena,p.z+p.dz/magnitude*config.speed/meta.tickRate));}
    const target=state.enemies.filter(e=>e.hp>0).reduce((best,e)=>!best||Math.hypot(e.x-p.x,e.z-p.z)<Math.hypot(best.x-p.x,best.z-p.z)?e:best,null);
    if(target&&fresh&&(p.fire||Math.hypot(p.dx,p.dz)>.01)&&ctx.tick-p.shot>=config.fireTicks&&(!p.aimed||p.fire)) {
      let ax=fresh&&p.aimed?p.ax:target.x-p.x,az=fresh&&p.aimed?p.az:target.z-p.z;const length=Math.hypot(ax,az);
      if(length>.001){ax/=length;az/=length;p.ax=ax;p.az=az;p.shot=ctx.tick;state.shots.push({x:p.x,z:p.z,ax,az,until:ctx.tick+3});
        const hit=state.enemies.filter(e=>{const x=e.x-p.x,z=e.z-p.z,forward=x*ax+z*az;return e.hp>0&&forward>0&&forward<config.rayRange&&Math.abs(x*az-z*ax)<config.rayWidth;}).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
        if(hit)damageEnemy(state,hit,1);
      }
    }
  }
  for(const e of state.enemies) {
    if(e.hp<=0)continue;
    const nearest=connected.filter(p=>!p.downed).reduce((best,p)=>!best||Math.hypot(p.x-e.x,p.z-e.z)<Math.hypot(best.x-e.x,best.z-e.z)?p:best,null);
    const target=e.kind==='hunter'&&nearest&&Math.hypot(nearest.x-e.x,nearest.z-e.z)<config.aggroRadius?nearest:null;
    const tx=target?target.x:0,tz=target?target.z:0,distance=Math.hypot(tx-e.x,tz-e.z);
    if(distance<=config.contactRange&&ctx.tick>=e.attackReady) {
      e.attackReady=ctx.tick+config.attackTicks;
      if(target){if(ctx.tick>=target.invulnerableUntil){target.hp=Math.max(0,target.hp-config.contactDamage);target.hitTick=ctx.tick;event(state,'hurt',target.x,target.z,{player:target.id});if(!target.hp){target.downed=true;target.downTick=ctx.tick;target.reviveProgress=0;event(state,'down',target.x,target.z,{player:target.id});}}}
      else {state.objective=Math.max(0,state.objective-config.objectiveDamage);state.objectiveHit=ctx.tick;event(state,'objective-hit',0,0);}
    } else if(distance>config.contactRange){const speed=(config.enemySpeed+state.wave*config.speedPerWave)/meta.tickRate;e.x+=(tx-e.x)/distance*speed;e.z+=(tz-e.z)/distance*speed;}
  }
  state.enemies=state.enemies.filter(e=>e.hp>0);
  if(state.phase==='combat'&&!state.enemies.length){state.phase='breather';state.nextWave=ctx.tick+config.betweenWaves;for(const p of connected)if(!p.downed)p.hp=Math.min(config.playerHP,p.hp+config.waveHeal);state.objective=Math.min(config.objectiveHP,state.objective+config.objectiveRepair);}
  if(state.objective<=0){state.result='loss';event(state,'lose',0,0);}
  return state;
}
export function isGameOver(state, ctx) {return {over:!!state.result,winners:state.result==='win'?Object.keys(state.players).filter(id=>state.players[id].connected):[]};}
export function viewFor(state, playerId, ctx) {return {...state,rules:config,tickRate:meta.tickRate};}

// Optional test contract: ordinary validated inputs, not a second combat implementation.
export function referenceRoute(playerIndex) {
  const [x,z]=config.spawns[playerIndex%config.spawns.length];
  const move={type:'move',dx:0,dz:0,ax:0,az:1,fire:true,aimed:false};
  const route=[{fromTick:1,toTick:17,action:{...move,dx:-Math.sign(x),dz:-Math.sign(z)}},{fromTick:18,toTick:10000,action:move}];
  for(let tick=180;tick<=10000;tick+=config.novaCooldown)route.push({fromTick:tick,toTick:tick,action:{type:'skill',skill:'nova'}});
  return route;
}
export function summarize(state) {
  return {phase:state.result??state.phase,wave:state.wave,objective:state.objective,enemies:state.enemies.length,
    players:Object.fromEntries(Object.entries(state.players).map(([id,p])=>[id,{hp:p.hp,downed:p.downed,x:+p.x.toFixed(2),z:+p.z.toFixed(2)}]))};
}
