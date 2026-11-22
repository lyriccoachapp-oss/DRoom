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
const inRoom=(r,a)=>a.cx-a.hx>=-1e-3&&a.cz-a.hz>=-1e-3&&a.cx+a.hx<=r.W+1e-3&&a.cz+a.hz<=r.D+1e-3&&!(r.cutRect&&overlap(a,r.cutRect));

/* L-shaped rooms: a room may have a rectangular notch cut from one corner, room.cut = {corner: 'NE'|'NW'|'SE'|'SW', w, d}.
   cutOf() gives the notch in room coordinates, clamped so at least 1.2 m of room remains on each side. */
function cutOf(room){
  const c=room.cut;if(!c||!/^(N|S)(E|W)$/.test(c.corner))return null;
  const w=clamp(c.w,0.5,room.W-1.2),d=clamp(c.d,0.5,room.D-1.2);if(!(w>0.49&&d>0.49))return null;
  const east=c.corner[1]==='E',south=c.corner[0]==='S';
  return {corner:c.corner,w,d,x0:east?room.W-w:0,x1:east?room.W:w,z0:south?room.D-d:0,z1:south?room.D:d};
}
const roomArea=room=>{const c=cutOf(room);return room.W*room.D-(c?c.w*c.d:0);};
/* The room's outline, clockwise from the north-west corner, in room coordinates. */
function roomPolygon(room){
  const W=room.W,D=room.D,c=cutOf(room),p={NW:[[0,0]],NE:[[W,0]],SE:[[W,D]],SW:[[0,D]]};
  if(c){
    if(c.corner==='NW')p.NW=[[0,c.z1],[c.x1,c.z1],[c.x1,0]];
    if(c.corner==='NE')p.NE=[[c.x0,0],[c.x0,c.z1],[W,c.z1]];
    if(c.corner==='SE')p.SE=[[W,c.z0],[c.x0,c.z0],[c.x0,D]];
    if(c.corner==='SW')p.SW=[[c.x1,D],[c.x1,c.z0],[0,c.z0]];
  }
  return p.NW.concat(p.NE,p.SE,p.SW);
}
/* The room as one or two axis-aligned rectangles in world coordinates {x0, z0, x1, z1}. */
function roomRects(room){
  const c=cutOf(room),X=room.x,Z=room.y;
  if(!c)return [{x0:X,z0:Z,x1:X+room.W,z1:Z+room.D}];
  const zr=c.z0===0?[c.z1,room.D]:[0,c.z0];
  const a=c.x0===0?{x0:X+c.x1,x1:X+room.W}:{x0:X,x1:X+c.x0},b=c.x0===0?{x0:X,x1:X+c.x1}:{x0:X+c.x0,x1:X+room.W};
  return [{x0:a.x0,x1:a.x1,z0:Z,z1:Z+room.D},{x0:b.x0,x1:b.x1,z0:Z+zr[0],z1:Z+zr[1]}];
}
/* The largest rectangles that fit inside the room, in room coordinates, biggest first. An L has two. */
function maxRects(r){
  const c=r.cutBox;if(!c)return [{x0:0,z0:0,x1:r.W,z1:r.D}];
  return [{x0:c.x0===0?c.x1:0,x1:c.x0===0?r.W:c.x0,z0:0,z1:r.D},{x0:0,x1:r.W,z0:c.z0===0?c.z1:0,z1:c.z0===0?r.D:c.z0}]
    .sort((a,b)=>(b.x1-b.x0)*(b.z1-b.z0)-(a.x1-a.x0)*(a.z1-a.z0));
}
/* Where each side of the room still has wall, as [t0, t1] along wallPoint's t. */
function sideRange(r,w){
  const len=wallLen(r,w),c=r.cutBox;if(!c)return [0,len];
  if(w==='N'&&c.z0===0||w==='S'&&c.z1===r.D)return c.x0===0?[c.x1,len]:[0,c.x0];
  if(w==='W'&&c.x0===0||w==='E'&&c.x1===r.W)return c.z0===0?[c.z1,len]:[0,c.z0];
  return [0,len];
}
/* Wall segments for the 3D view: the four sides (shortened by a notch) plus the two notch walls.
   Each has ends a, b, an inward normal n, the side it belongs to (null for notch walls) and t0, the side's t at a. */
function wallSegments(r){
  const segs=[];
  for(const w in WALLS){const rg=sideRange(r,w);if(rg[1]-rg[0]<0.01)continue;segs.push({side:w,a:wallPoint(r,w,rg[0]),b:wallPoint(r,w,rg[1]),n:WALLS[w].n,t0:rg[0]});}
  const c=r.cutBox;
  if(c){
    const zi=c.z0===0?c.z1:c.z0,xi=c.x0===0?c.x1:c.x0;
    segs.push({side:null,a:[c.x0,zi],b:[c.x1,zi],n:[0,c.z0===0?1:-1],t0:0});
    segs.push({side:null,a:[xi,c.z0],b:[xi,c.z1],n:[c.x0===0?1:-1,0],t0:0});
  }
  return segs;
}

/* A room's door: type 'swing' (hinged), 'pocket' (slides into the wall), 'barn' (slides along the wall face) or 'open' (no leaf).
   side 'left' or 'right' is the end of the opening, in increasing t along the wall, that holds the hinge or that the leaf slides to.
   swing 'in' or 'out' says which way a hinged leaf opens. width is the clear opening in metres. */
const DOOR_TYPES=['swing','pocket','barn','open'];
function doorOf(room){
  return {type:DOOR_TYPES.indexOf(room.doorType)>=0?room.doorType:'swing',side:room.doorSide==='right'?'right':'left',
    swing:room.doorSwing==='out'?'out':'in',width:clamp(Number(room.doorWidth)||0.81,0.6,1.2)};
}

/* Geometry of one room: door and window positions clamped to their walls, plus the zones they keep clear. */
function roomGeom(room){
  const r={W:room.W,D:room.D};
  r.cutBox=cutOf(room);
  r.cutRect=r.cutBox?{cx:(r.cutBox.x0+r.cutBox.x1)/2,cz:(r.cutBox.z0+r.cutBox.z1)/2,hx:r.cutBox.w/2,hz:r.cutBox.d/2}:null;
  r.area=roomArea(room);
  /* An opening goes on its chosen side where that side still has wall; a side too short for it hands it to the longest side. */
  const place=(wall,pos,half)=>{
    let rg=sideRange(r,wall);
    if(rg[1]-rg[0]<half*2+0.1){wall=Object.keys(WALLS).sort((a,b)=>{const ra=sideRange(r,a),rb=sideRange(r,b);return (rb[1]-rb[0])-(ra[1]-ra[0]);})[0];rg=sideRange(r,wall);}
    return {wall,t:clamp(pos*wallLen(r,wall),rg[0]+half,rg[1]-half)};
  };
  const dd=doorOf(room),slides=dd.type==='pocket'||dd.type==='barn';
  r.door=place(room.doorWall,room.doorPos,dd.width/2+0.1+(slides?dd.width/2:0));
  Object.assign(r.door,dd);
  if(slides){ /* the leaf needs a full door width of wall on its sliding side */
    const rg=sideRange(r,r.door.wall),lo=rg[0]+dd.width/2+0.1+(dd.side==='left'?dd.width:0),hi=rg[1]-dd.width/2-0.1-(dd.side==='right'?dd.width:0);
    r.door.t=lo<=hi?clamp(r.door.t,lo,hi):(rg[0]+rg[1])/2;
  }
  r.win=place(room.winWall,room.winPos,0.8);
  /* What furniture must leave clear: an inward hinged door sweeps a square of its own width; every other door only needs a passage.
     A barn door also needs the wall beside the opening that its leaf slides over. */
  const w=dd.width;
  r.doorRect=dd.type==='swing'&&dd.swing==='in'?at(r,r.door.wall,r.door.t,w/2+0.05,w+0.1,w+0.1):at(r,r.door.wall,r.door.t,0.35,w+0.1,0.7);
  r.keepClear=[r.doorRect];
  if(dd.type==='barn')r.keepClear.push(at(r,r.door.wall,r.door.t+(dd.side==='left'?-w:w),0.09,w,0.18));
  r.winRect=at(r,r.win.wall,r.win.t,0.2,1.4,0.4);
  return r;
}
function runLayout(r,want,forced){
  const placed=[];
  const fits=(rect,h)=>inRoom(r,rect)&&!r.keepClear.some(z=>overlap(rect,z))&&!(h>0.85&&overlap(rect,r.winRect))&&placed.every(p=>p.flat||!overlap(rect,p,0.04));
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
    const si=sizes(cat)[0],sz=dims(cat,si),k=sz[0]/2+(cat==='shower'?0.01:0.08);
    const cs=[[k,k],[r.W-k,k],[k,r.D-k],[r.W-k,r.D-k]];
    const dist=c=>Math.hypot(c[0]-r.winRect.cx,c[1]-r.winRect.cz);
    cs.sort((a,b)=>nearWindow?dist(a)-dist(b):dist(b)-dist(a));
    for(const c of cs){const east=c[0]>r.W/2,south=c[1]>r.D/2,rect={cx:c[0],cz:c[1],hx:sz[0]/2,hz:sz[1]/2,rot:east?(south?Math.PI:-Math.PI/2):(south?Math.PI/2:0)};if(fits(rect,h)){add(cat,si,rect);return;}}
  }
  function byWalls(cat,walls,front){
    if(!want.has(cat))return;
    for(const si of sizes(cat)){const sz=dims(cat,si);
      for(const w of walls){const rect=onWall(w,sz[0],sz[1],sz[2],doorT(w),0.02,front);if(rect){add(cat,si,rect);return;}}
    }
  }
  const all=['W','E','N','S'];
  const eff=w=>{const g=sideRange(r,w);return g[1]-g[0];},mid=w=>{const g=sideRange(r,w);return (g[0]+g[1])/2;};

  if(want.has('sofa')){ /* living room */
    const score=w=>{let s=0;const a=acrossOf(r,w);if(r.win.wall===w)s-=3;if(r.door.wall===w)s-=2;if(r.door.wall===OPP[w])s-=1;if(eff(w)>=a)s+=1;if(a>=3&&a<=5.5)s+=1;if(eff(OPP[w])<1.7)s-=4;return s;};
    /* The TV goes on the best-scoring wall whose opposite wall can take a sofa; an L-shaped room may rule out the first choice. */
    const order=all.slice().sort((a,b)=>score(b)-score(a));
    let tvWall=order[0],pick=null;
    for(const tw of order){const s2=OPP[tw];
      for(const si of sizes('sofa')){const sz=dims('sofa',si);const rect=onWall(s2,sz[0],sz[1],sz[2],mid(s2),Math.max(0.04,acrossOf(r,s2)-4.4));if(rect){pick={si,rect};break;}}
      if(pick){tvWall=tw;break;}}
    const sw=OPP[tvWall],len=wallLen(r,sw),ac=acrossOf(r,sw);
    let sofa=pick?add('sofa',pick.si,pick.rect):null;
    if(want.has('tvstand'))for(const si of sizes('tvstand')){const sz=dims('tvstand',si);const rect=onWall(tvWall,sz[0],sz[1],sz[2],sofa?sofa.t:mid(tvWall),0.02);if(rect){add('tvstand',si,rect);break;}}
    if(sofa){
      const front=sofa.gap+sofa.d; let coffee=null;
      /* Coffee table in front of the sofa: centred first, then nudged along the sofa or a little farther out to clear a door swing. */
      if(want.has('coffee')){const si=sizes('coffee')[0],sz=dims('coffee',si);
        search:for(const dO of [0.4,0.5,0.6])for(const dt of [0,-0.15,0.15,-0.3,0.3]){const o=front+dO+sz[1]/2,rect=at(r,sw,sofa.t+dt,o,sz[0],sz[1]);
          if(ac-(o+sz[1]/2)-0.45>=0.5&&fits(rect,sz[2])){coffee=add('coffee',si,rect);break search;}}}
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
    const score=w=>{let s=0;if(r.win.wall===w)s-=3;if(r.door.wall===w)s-=3;if(eff(w)>=3)s+=1;if(acrossOf(r,w)>=2.9)s+=2;return s;};
    const order=all.slice().sort((a,b)=>score(b)-score(a));
    let hw=order[0],bed=null;
    /* First pass leaves room to walk past the bed; the head wall is the best-scoring one that takes it. */
    outer:for(const pass of [1.1,0])for(const w2 of order)for(const si of sizes('bed')){const sz=dims('bed',si);if(eff(w2)<sz[0]+pass)continue;
      const rect=onWall(w2,sz[0],sz[1],sz[2],mid(w2),0.02);if(rect){hw=w2;bed=add('bed',si,rect);break outer;}}
    const len=wallLen(r,hw),ac=acrossOf(r,hw);
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
  if(want.has('dtable')){ /* dining room: table in the middle, chairs along its long sides */
    /* The table is centred in the largest rectangle of the room (for an L, one of its two arms), long side along its long side. */
    let tb=null,bw='N',tc=0,oc=0,L=0,A=0;
    table:for(const q of maxRects(r)){const wq=q.x1-q.x0,dq=q.z1-q.z0;bw=wq>=dq?'N':'W';L=Math.max(wq,dq);A=Math.min(wq,dq);
      tc=bw==='N'?(q.x0+q.x1)/2:(q.z0+q.z1)/2;oc=bw==='N'?(q.z0+q.z1)/2:(q.x0+q.x1)/2;
      for(const si of sizes('dtable')){const sz=dims('dtable',si);if(L<sz[0]+1.5||A<sz[1]+1.9)continue;
        const rect=at(r,bw,tc,oc,sz[0],sz[1]);if(fits(rect,sz[2])){tb=add('dtable',si,rect);break table;}}}
    if(tb){
      if(want.has('rug'))for(const si of sizes('rug')){const sz=dims('rug',si),rr=at(r,bw,tc,oc,sz[0],sz[1]);if(sz[0]<=L-0.3&&sz[1]<=A-0.3&&sz[0]>=tb.w&&inRoom(r,rr)){add('rug',si,rr,{flat:true});break;}}
      if(want.has('dchair')){const si=sizes('dchair')[0],sz=dims('dchair',si),n=Math.max(2,Math.floor(tb.w/0.55)),off=tb.d/2+0.06+sz[1]/2;
        for(let i=0;i<n;i++){const t=tc-tb.w/2+tb.w*(i+0.5)/n;
          [[oc-off,ROT[bw]],[oc+off,ROT[OPP[bw]]]].forEach(v=>{const rect=at(r,bw,t,v[0],sz[0],sz[1]);rect.rot=v[1];if(fits(rect,0.5))add('dchair',si,rect);});}}
    }
    byWalls('sideboard',all,0.5);
    corner('lamp',0.5,false);corner('plant',0.5,true);
  }
  if(want.has('desk')){ /* office: desk against a wall away from the door, chair in front of it */
    const order=all.slice().sort((a,b)=>(a===r.door.wall?1:0)-(b===r.door.wall?1:0));
    byWalls('desk',order,1.0);
    const dk=placed.find(p=>p.cat==='desk');
    if(dk){
      if(want.has('rug')&&(forced.rug==null||forced.rug===0)){const rs=dims('rug',0),rr=at(r,dk.wall,dk.t,dk.gap+dk.d+0.1+rs[1]/2,rs[0],rs[1]);if(inRoom(r,rr))add('rug',0,rr,{flat:true});}
      if(want.has('ochair')){const si=sizes('ochair')[0],sz=dims('ochair',si),rect=at(r,dk.wall,dk.t,dk.gap+dk.d+0.08+sz[1]/2,sz[0],sz[1]);rect.rot=ROT[OPP[dk.wall]];if(fits(rect,0.5))add('ochair',si,rect);}
    }
    byWalls('shelf',order,0.45);
    corner('lamp',0.5,false);corner('plant',0.5,true);
  }
  if(want.has('cabrun')){ /* kitchen: fridge, cabinet run and range in a line along one wall */
    const score=w=>{let s=eff(w)/10;if(r.win.wall!==w)s+=2;if(r.door.wall!==w)s+=2;return s;};
    const kw=all.slice().sort((a,b)=>score(b)-score(a))[0],len=wallLen(r,kw),far=doorT(kw),kr=sideRange(r,kw);
    /* s runs along the wall from the end farther from the door, over the part of the wall that exists. */
    const pos=s=>far===0?s:len-s,s0=far===0?kr[0]:len-kr[1],s1=far===0?kr[1]:len-kr[0];
    let cur=s0+0.05;
    const put=(cat,si)=>{const sz=dims(cat,si);
      for(let sh=0;sh<=1.2;sh+=0.1){const c=cur+sh;if(c+sz[0]>s1-0.04)break;
        const rect=at(r,kw,pos(c+sz[0]/2),0.02+sz[1]/2,sz[0],sz[1]);
        if(fits(rect,sz[2])){rect.gap=0.02;cur=c+sz[0]+0.05;return add(cat,si,rect);}}
      return null;};
    const rangeW=want.has('range')?dims('range',0)[0]+0.05:0;
    let run=null;
    for(const si of sizes('cabrun')){if(cur+dims('cabrun',si)[0]+rangeW>s1-0.04)continue;run=put('cabrun',si);if(run)break;}
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
/* Paint for the walls: two coats over the wall area less the door and window. */
function paintGallons(r){const wall=2*(r.W+r.D)*2.7-r.door.width*2.05-1.4*1.3;return Math.max(1,Math.ceil(wall*2/37-0.05));}
function planRoom(room,style,budget,notes){
  notes=notes||[];
  const r=roomGeom(room),spec0=ROOMS[room.type],paint=/^#[0-9a-f]{6}$/i.test(room.wallColor||'');
  /* A chosen wall colour adds paint to the room, as a required line. */
  const spec={all:spec0.all.concat(paint?['paint']:[]),required:spec0.required.concat(paint?['paint']:[])};
  const forced={};
  for(const c in room.overrides){const it=BYID[room.overrides[c]];if(it&&spec.all.includes(c))forced[c]=it.si;else delete room.overrides[c];}
  const want=new Set(spec.all.filter(c=>!room.removed.includes(c)));
  let placed=runLayout(r,want,forced);
  for(const c in forced){if(want.has(c)&&!placed.some(p=>p.cat===c)){
    notes.push(BYID[room.overrides[c]].name+' does not fit in '+room.name+'. A different size was chosen.');
    delete room.overrides[c];return planRoom(room,style,budget,notes);}}
  const area=Math.ceil(r.area*1.1*10)/10;
  const has=c=>CATS[c].area||CATS[c].unit||placed.some(p=>p.cat===c);
  const excluded=[];
  spec.all.forEach(c=>{if(room.removed.includes(c))excluded.push({cat:c,reason:'removed'});else if(!has(c)&&!(c==='shower'&&has('tub')))excluded.push({cat:c,reason:'space'});});
  let active=spec.all.filter(c=>has(c)&&!room.removed.includes(c));
  const qty=c=>CATS[c].unit?paintGallons(r):CATS[c].area?area:placed.filter(p=>p.cat===c).length;
  const si=c=>CATS[c].area||CATS[c].unit?0:placed.find(p=>p.cat===c).si;
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
  const lines=active.map(c=>({cat:c,item:itemOf(c),qty:qty(c),area:!!CATS[c].area,unit:CATS[c].unit||null}));
  return {room,r,placed,lines,excluded,total:total(),budget,notes};
}
/* Would size `si` of this category fit, keeping every other placed item at its current size? */
function canFit(plan,cat,si){
  if(CATS[cat].area||CATS[cat].unit)return true;
  const forced={};plan.lines.forEach(l=>{if(!l.area&&!l.unit)forced[l.cat]=l.item.si;});forced[cat]=si;
  const want=new Set(plan.lines.filter(l=>!l.area&&!l.unit).map(l=>l.cat));
  return runLayout(plan.r,want,forced).some(p=>p.cat===cat);
}

/* ---------- Walking ---------- */
/* Where a person can stand: room interiors kept 0.22 m off the walls, joined through door openings.
   Returns test(x, z) in world coordinates; test.zones holds the rectangles. */
function walkArea(plans){
  const zones=[];
  plans.forEach(pl=>{
    const o=pl.room,r=pl.r;
    maxRects(r).forEach(q=>zones.push({x0:o.x+q.x0+0.22,x1:o.x+q.x1-0.22,z0:o.y+q.z0+0.22,z1:o.y+q.z1-0.22}));
    const d=at(r,r.door.wall,r.door.t,0,Math.max(0.5,r.door.width-0.12),1.1);
    zones.push({x0:o.x+d.cx-d.hx,x1:o.x+d.cx+d.hx,z0:o.y+d.cz-d.hz,z1:o.y+d.cz+d.hz});
  });
  /* Furniture is solid: you walk round it, with a little clearance. Rugs and wall cabinets do not block. */
  const solid=[];
  plans.forEach(pl=>(pl.placed||[]).forEach(q=>{if(!q.flat&&q.h>0.3)solid.push({x0:pl.room.x+q.cx-q.hx-0.12,x1:pl.room.x+q.cx+q.hx+0.12,z0:pl.room.y+q.cz-q.hz-0.12,z1:pl.room.y+q.cz+q.hz+0.12});}));
  const test=(x,z)=>zones.some(q=>x>=q.x0&&x<=q.x1&&z>=q.z0&&z<=q.z1)&&!solid.some(q=>x>q.x0&&x<q.x1&&z>q.z0&&z<q.z1);
  test.zones=zones;
  return test;
}
/* Shortest walk from `from` to `to` ([x, z]) that stays where test() allows: A* on a grid, then straightened.
   Returns the points to walk through (the start excluded), or null when there is no way. A target that is not
   walkable snaps to the nearest point that is, within about a metre. */
function findPath(test,from,to,step){
  step=step||0.15;
  const zs=test.zones;if(!zs.length)return null;
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
  zs.forEach(q=>{x0=Math.min(x0,q.x0);z0=Math.min(z0,q.z0);x1=Math.max(x1,q.x1);z1=Math.max(z1,q.z1);});
  const nx=Math.ceil((x1-x0)/step)+1,nz=Math.ceil((z1-z0)/step)+1,N=nx*nz,P=i=>[x0+(i%nx)*step,z0+Math.floor(i/nx)*step];
  const ok=new Uint8Array(N);for(let i=0;i<N;i++){const p=P(i);ok[i]=test(p[0],p[1])?1:0;}
  const near=p=>{
    const ci=clamp(Math.round((p[0]-x0)/step),0,nx-1),cj=clamp(Math.round((p[1]-z0)/step),0,nz-1);
    let best=-1,bd=Infinity,R=Math.ceil(1.0/step);
    for(let j=Math.max(0,cj-R);j<=Math.min(nz-1,cj+R);j++)for(let i=Math.max(0,ci-R);i<=Math.min(nx-1,ci+R);i++){
      if(!ok[j*nx+i])continue;const q=P(j*nx+i),d=(q[0]-p[0])**2+(q[1]-p[1])**2;if(d<bd){bd=d;best=j*nx+i;}}
    return best;
  };
  const s=near(from),g=near(to);if(s<0||g<0)return null;
  /* A* with a binary heap; 8 neighbours, no cutting past a blocked corner. */
  const gs=new Float64Array(N).fill(Infinity),came=new Int32Array(N).fill(-1),done=new Uint8Array(N),heap=[],fs=[];
  const gx=g%nx,gz=Math.floor(g/nx),hh=i=>{const dx=Math.abs(i%nx-gx),dz=Math.abs(Math.floor(i/nx)-gz);return Math.max(dx,dz)+0.4142*Math.min(dx,dz);};
  const push=(i,f)=>{heap.push(i);fs.push(f);let k=heap.length-1;while(k){const pp=(k-1)>>1;if(fs[pp]<=fs[k])break;[heap[pp],heap[k]]=[heap[k],heap[pp]];[fs[pp],fs[k]]=[fs[k],fs[pp]];k=pp;}};
  const pop=()=>{const top=heap[0],li=heap.pop(),lf=fs.pop();if(heap.length){heap[0]=li;fs[0]=lf;let k=0;for(;;){const a=2*k+1,b=a+1;let m=k;if(a<heap.length&&fs[a]<fs[m])m=a;if(b<heap.length&&fs[b]<fs[m])m=b;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];[fs[m],fs[k]]=[fs[k],fs[m]];k=m;}}return top;};
  gs[s]=0;push(s,hh(s));
  while(heap.length){
    const c=pop();if(done[c])continue;done[c]=1;if(c===g)break;
    const ci=c%nx,cj=Math.floor(c/nx);
    for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
      if(!di&&!dj)continue;const i=ci+di,j=cj+dj;if(i<0||j<0||i>=nx||j>=nz)continue;const k=j*nx+i;if(!ok[k]||done[k])continue;
      if(di&&dj&&(!ok[cj*nx+i]||!ok[j*nx+ci]))continue;
      const ng=gs[c]+(di&&dj?1.4142:1);if(ng<gs[k]){gs[k]=ng;came[k]=c;push(k,ng+hh(k));}
    }
  }
  if(!done[g])return null;
  const cells=[];for(let c=g;c>=0;c=came[c])cells.unshift(P(c));
  cells[0]=from.slice();if(test(to[0],to[1]))cells[cells.length-1]=to.slice();
  /* Straighten: keep a point only where the straight line to the next kept point would leave the walkable area. */
  const clear=(a,b)=>{const L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(L/(step/3)));for(let k=1;k<n;k++){const t=k/n;if(!test(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))return false;}return true;};
  const out=[];let a=cells[0],k=1;
  while(k<cells.length){let far=k;while(far+1<cells.length&&clear(a,cells[far+1]))far++;out.push(cells[far]);a=cells[far];k=far+1;}
  return out;
}
