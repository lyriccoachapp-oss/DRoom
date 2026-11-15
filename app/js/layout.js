'use strict';
/* Layout engine. Room coordinates: x in [0,W], z in [0,D]; walls N (z=0), S (z=D), W (x=0), E (x=W). */
const WALLS={N:{n:[0,1],horiz:true},S:{n:[0,-1],horiz:true},W:{n:[1,0],horiz:false},E:{n:[-1,0],horiz:false}};
const OPP={N:'S',S:'N',W:'E',E:'W'};
const ROT={N:0,S:Math.PI,W:Math.PI/2,E:-Math.PI/2};
const wallLen=(r,w)=>WALLS[w].horiz?r.W:r.D;
const acrossOf=(r,w)=>WALLS[w].horiz?r.D:r.W;
function wallPoint(r,w,t){return w==='N'?[t,0]:w==='S'?[t,r.D]:w==='W'?[0,t]:[r.W,t];}
/* Rect with its centre at distance o from wall w, at position t along it; iw runs along the wall, id away from it. */
function at(r,w,t,o,iw,id){
  const p=wallPoint(r,w,t),n=WALLS[w].n,hz=WALLS[w].horiz;
  return {cx:p[0]+n[0]*o,cz:p[1]+n[1]*o,hx:hz?iw/2:id/2,hz:hz?id/2:iw/2,rot:ROT[w],wall:w,t,o};
}
const overlap=(a,b,m)=>Math.abs(a.cx-b.cx)<a.hx+b.hx+(m||0)-1e-6&&Math.abs(a.cz-b.cz)<a.hz+b.hz+(m||0)-1e-6;
const inRoom=(r,a)=>a.cx-a.hx>=-1e-3&&a.cz-a.hz>=-1e-3&&a.cx+a.hx<=r.W+1e-3&&a.cz+a.hz<=r.D+1e-3;


/* Geometry of one room: door and window positions clamped to their walls, plus the zones they keep clear. */
function roomGeom(room){
  const r={W:room.W,D:room.D};
  const dl=wallLen(r,room.doorWall),wl=wallLen(r,room.winWall);
  r.door={wall:room.doorWall,t:clamp(room.doorPos*dl,0.55,dl-0.55)};
  r.win={wall:room.winWall,t:clamp(room.winPos*wl,0.8,wl-0.8)};
  r.doorRect=at(r,r.door.wall,r.door.t,0.5,1.0,1.0);
  r.winRect=at(r,r.win.wall,r.win.t,0.2,1.4,0.4);
  return r;
}
function runLayout(r,want,forced){
  const placed=[];
  const fits=(rect,h)=>inRoom(r,rect)&&!overlap(rect,r.doorRect)&&!(h>0.85&&overlap(rect,r.winRect))&&placed.every(p=>p.flat||!overlap(rect,p,0.04));
  const clearOk=c=>!c||placed.every(p=>p.flat||!overlap(c,p));
  const add=(cat,si,rect,extra)=>{const sz=CATS[cat].sizes[si];const p=Object.assign({cat,si,w:sz[0],d:sz[1],h:sz[2]},rect,extra||{});placed.push(p);return p;};
  const sizes=cat=>forced[cat]!=null?[forced[cat]]:CATS[cat].sizes.map((_,i)=>i).reverse();
  const dims=(cat,si)=>CATS[cat].sizes[si];
  function onWall(w,iw,id,h,pref,gap,front){
    const len=wallLen(r,w),ts=[];
    for(let t=iw/2+0.05;t<=len-iw/2-0.05+1e-6;t+=0.1)ts.push(t);
    const mid=len/2;if(mid>=iw/2+0.05&&mid<=len-iw/2-0.05)ts.push(mid);
    ts.sort((a,b)=>Math.abs(a-pref)-Math.abs(b-pref));
    for(const t of ts){
      const rect=at(r,w,t,gap+id/2,iw,id);
      const clr=front?at(r,w,t,gap+id+front/2,iw,front):null;
      if(fits(rect,h)&&clearOk(clr)){rect.gap=gap;return rect;}
    }
    return null;
  }
  const doorT=w=>{ /* end of wall w that is farther from the door */
    const len=wallLen(r,w),a=wallPoint(r,w,0),b=wallPoint(r,w,len),d=r.doorRect;
    return Math.hypot(a[0]-d.cx,a[1]-d.cz)>Math.hypot(b[0]-d.cx,b[1]-d.cz)?0:len;
  };
  function corner(cat,h,nearWindow){
    if(!want.has(cat))return;
    const si=sizes(cat)[0],sz=dims(cat,si),k=sz[0]/2+0.08;
    const cs=[[k,k],[r.W-k,k],[k,r.D-k],[r.W-k,r.D-k]];
    const dist=c=>Math.hypot(c[0]-r.winRect.cx,c[1]-r.winRect.cz);
    cs.sort((a,b)=>nearWindow?dist(a)-dist(b):dist(b)-dist(a));
    for(const c of cs){const rect={cx:c[0],cz:c[1],hx:sz[0]/2,hz:sz[1]/2,rot:0};if(fits(rect,h)){add(cat,si,rect);return;}}
  }
  function byWalls(cat,walls,front){
    if(!want.has(cat))return;
    for(const si of sizes(cat)){const sz=dims(cat,si);
      for(const w of walls){const rect=onWall(w,sz[0],sz[1],sz[2],doorT(w),0.02,front);if(rect){add(cat,si,rect);return;}}
    }
  }
  const all=['W','E','N','S'];

  if(want.has('sofa')){ /* living room */
    const score=w=>{let s=0;const a=acrossOf(r,w);if(r.win.wall===w)s-=3;if(r.door.wall===w)s-=2;if(r.door.wall===OPP[w])s-=1;if(wallLen(r,w)>=a)s+=1;if(a>=3&&a<=5.5)s+=1;return s;};
    const tvWall=all.slice().sort((a,b)=>score(b)-score(a))[0],sw=OPP[tvWall];
    const len=wallLen(r,sw),ac=acrossOf(r,sw);
    let sofa=null;
    for(const si of sizes('sofa')){const sz=dims('sofa',si);const rect=onWall(sw,sz[0],sz[1],sz[2],len/2,Math.max(0.04,ac-4.4));if(rect){sofa=add('sofa',si,rect);break;}}
    if(want.has('tvstand'))for(const si of sizes('tvstand')){const sz=dims('tvstand',si);const rect=onWall(tvWall,sz[0],sz[1],sz[2],sofa?sofa.t:len/2,0.02);if(rect){add('tvstand',si,rect);break;}}
    if(sofa){
      const front=sofa.gap+sofa.d; let coffee=null;
      if(want.has('coffee')){const si=sizes('coffee')[0],sz=dims('coffee',si),o=front+0.4+sz[1]/2;
        const rect=at(r,sw,sofa.t,o,sz[0],sz[1]);
        if(ac-(o+sz[1]/2)-0.45>=0.5&&fits(rect,sz[2]))coffee=add('coffee',si,rect);}
      if(want.has('rug')){const space=ac-front-0.45;
        for(const si of sizes('rug')){const sz=dims('rug',si);
          if(sz[0]<=len-0.3&&sz[1]<=space+0.3){const t=clamp(sofa.t,sz[0]/2+0.1,len-sz[0]/2-0.1);
            const rect=at(r,sw,t,front-0.3+sz[1]/2,sz[0],sz[1]);if(inRoom(r,rect)){add('rug',si,rect,{flat:true});break;}}}}
      if(want.has('armchair')&&coffee){const si=sizes('armchair')[0],sz=dims('armchair',si),hz=WALLS[sw].horiz;
        const cand=[1,-1].map(sg=>{const t=sofa.t+sg*(coffee.w/2+0.45+sz[1]/2);const rect=at(r,sw,t,coffee.o,sz[1],sz[0]);
          rect.rot=Math.atan2(hz?-sg:0,hz?0:-sg);return rect;});
        cand.sort((a,b)=>Math.hypot(b.cx-r.doorRect.cx,b.cz-r.doorRect.cz)-Math.hypot(a.cx-r.doorRect.cx,a.cz-r.doorRect.cz));
        for(const rect of cand)if(fits(rect,sz[2])){add('armchair',si,rect);break;}}
      if(want.has('lamp')){const si=sizes('lamp')[0],sz=dims('lamp',si);let ok=false;
        for(const sg of [1,-1]){const rect=at(r,sw,sofa.t+sg*(sofa.w/2+0.28),sofa.gap+0.25,sz[0],sz[1]);if(fits(rect,0.5)){add('lamp',si,rect);ok=true;break;}}
        if(!ok)corner('lamp',0.5,false);}
    }
    byWalls('shelf',all.filter(w=>w!==tvWall&&w!==sw).concat([tvWall,sw]),0.45);
    corner('plant',0.5,true);
  }
  if(want.has('bed')){ /* bedroom */
    const score=w=>{let s=0;if(r.win.wall===w)s-=3;if(r.door.wall===w)s-=3;if(wallLen(r,w)>=3)s+=1;if(acrossOf(r,w)>=2.9)s+=2;return s;};
    const hw=all.slice().sort((a,b)=>score(b)-score(a))[0],len=wallLen(r,hw),ac=acrossOf(r,hw);
    let bed=null;
    for(const pass of [1.1,0]){if(bed)break;
      for(const si of sizes('bed')){const sz=dims('bed',si);if(len<sz[0]+pass)continue;
        const rect=onWall(hw,sz[0],sz[1],sz[2],len/2,0.02);if(rect){bed=add('bed',si,rect);break;}}}
    if(bed){
      if(want.has('nightstand')){const si=sizes('nightstand')[0],sz=dims('nightstand',si);
        for(const sg of [-1,1]){const rect=at(r,hw,bed.t+sg*(bed.w/2+0.06+sz[0]/2),0.02+sz[1]/2,sz[0],sz[1]);if(fits(rect,sz[2]))add('nightstand',si,rect);}}
      if(want.has('rug'))for(const si of sizes('rug')){const sz=dims('rug',si);
        if(sz[0]<=len-0.2&&sz[1]<=ac-0.2){const t=clamp(bed.t,sz[0]/2+0.1,len-sz[0]/2-0.1);
          const o=Math.min(0.02+bed.d+0.5-sz[1]/2,ac-0.1-sz[1]/2);const rect=at(r,hw,t,o,sz[0],sz[1]);
          if(inRoom(r,rect)){add('rug',si,rect,{flat:true});break;}}}
    }
    const sides=all.filter(w=>w!==hw&&w!==OPP[hw]);
    byWalls('wardrobe',[OPP[hw]].concat(sides,[hw]),0.6);
    byWalls('dresser',sides.concat([OPP[hw],hw]),0.5);
    corner('lamp',0.5,false);
    corner('plant',0.5,true);
  }
  if(want.has('cabrun')){ /* kitchen: fridge, cabinet run and range in a line along one wall */
    const score=w=>{let s=wallLen(r,w)/10;if(r.win.wall!==w)s+=2;if(r.door.wall!==w)s+=2;return s;};
    const kw=all.slice().sort((a,b)=>score(b)-score(a))[0],len=wallLen(r,kw),far=doorT(kw);
    const pos=s=>far===0?s:len-s;
    let cur=0.05;
    const put=(cat,si)=>{const sz=dims(cat,si);
      for(let sh=0;sh<=1.2;sh+=0.1){const c=cur+sh;if(c+sz[0]>len-0.04)break;
        const rect=at(r,kw,pos(c+sz[0]/2),0.02+sz[1]/2,sz[0],sz[1]);
        if(fits(rect,sz[2])){rect.gap=0.02;cur=c+sz[0]+0.02;return add(cat,si,rect);}}
      return null;};
    const rangeW=want.has('range')?dims('range',0)[0]+0.02:0;
    let run=null;
    for(const si of sizes('cabrun')){if(cur+dims('cabrun',si)[0]+rangeW>len-0.04)continue;run=put('cabrun',si);if(run)break;}
    if(want.has('range'))put('range',sizes('range')[0]);
    if(want.has('fridge')&&!put('fridge',sizes('fridge')[0]))byWalls('fridge',all.filter(w=>w!==kw),0.6);
    if(run&&want.has('uppers')&&(forced.uppers==null||forced.uppers===run.si)){
      const sz=dims('uppers',run.si),rect=at(r,kw,run.t,0.02+sz[1]/2,sz[0],sz[1]);
      if(!overlap(rect,r.winRect))add('uppers',run.si,rect,{flat:true});}
    if(run&&want.has('island')){const si=sizes('island')[0],sz=dims('island',si),ac=acrossOf(r,kw);
      if(ac>=0.64+1.05+sz[1]+0.95&&len>=sz[0]+1.6){const rect=at(r,kw,len/2,0.64+1.05+sz[1]/2,sz[0],sz[1]);if(fits(rect,sz[2]))add('island',si,rect);}}
  }
  if(want.has('vanity')){ /* bathroom: fixtures against the walls, away from the door */
    const order=all.slice().sort((a,b)=>(a===r.door.wall?1:0)-(b===r.door.wall?1:0));
    byWalls('tub',order,0.5);
    byWalls('vanity',order,0.55);
    byWalls('toilet',order,0.5);
    if(!placed.some(p=>p.cat==='tub'))corner('shower',2,false);
    byWalls('bathcab',order,0.45);
  }
  return placed;
}


/* Furnish one room: lay it out, then pick price tiers so the total fits the budget.
   Returns {room, r, placed, lines, excluded, total, budget, notes}. */
function planRoom(room,style,budget,notes){
  notes=notes||[];
  const r=roomGeom(room),spec=ROOMS[room.type];
  const forced={};
  for(const c in room.overrides){const it=BYID[room.overrides[c]];if(it&&spec.all.includes(c))forced[c]=it.si;else delete room.overrides[c];}
  const want=new Set(spec.all.filter(c=>!room.removed.includes(c)));
  let placed=runLayout(r,want,forced);
  for(const c in forced){if(want.has(c)&&!placed.some(p=>p.cat===c)){
    notes.push(BYID[room.overrides[c]].name+' does not fit in '+room.name+'. A different size was chosen.');
    delete room.overrides[c];return planRoom(room,style,budget,notes);}}
  const area=Math.ceil(r.W*r.D*1.1*10)/10;
  const has=c=>CATS[c].area||placed.some(p=>p.cat===c);
  const excluded=[];
  spec.all.forEach(c=>{if(room.removed.includes(c))excluded.push({cat:c,reason:'removed'});else if(!has(c)&&!(c==='shower'&&has('tub')))excluded.push({cat:c,reason:'space'});});
  let active=spec.all.filter(c=>has(c)&&!room.removed.includes(c));
  const qty=c=>CATS[c].area?area:placed.filter(p=>p.cat===c).length;
  const si=c=>CATS[c].area?0:placed.find(p=>p.cat===c).si;
  const tier={};active.forEach(c=>tier[c]=0);
  const itemOf=c=>room.overrides[c]?BYID[room.overrides[c]]:BYID[idOf(c,style,tier[c],si(c))];
  const total=()=>active.reduce((s,c)=>s+itemOf(c).price*qty(c),0);
  for(const c of active.slice().reverse()){
    if(total()<=budget)break;
    if(spec.required.includes(c)||room.overrides[c])continue;
    active=active.filter(x=>x!==c);excluded.push({cat:c,reason:'budget'});
  }
  let changed=true;
  while(changed){changed=false;
    for(const c of active){if(room.overrides[c]||tier[c]>=2)continue;tier[c]++;if(total()>budget)tier[c]--;else changed=true;}}
  placed=placed.filter(p=>active.includes(p.cat));
  const lines=active.map(c=>({cat:c,item:itemOf(c),qty:qty(c),area:!!CATS[c].area}));
  return {room,r,placed,lines,excluded,total:total(),budget,notes};
}
/* Would size `si` of this category fit, keeping every other placed item at its current size? */
function canFit(plan,cat,si){
  if(CATS[cat].area)return true;
  const forced={};plan.lines.forEach(l=>{if(!l.area)forced[l.cat]=l.item.si;});forced[cat]=si;
  const want=new Set(plan.lines.filter(l=>!l.area).map(l=>l.cat));
  return runLayout(plan.r,want,forced).some(p=>p.cat===cat);
}
