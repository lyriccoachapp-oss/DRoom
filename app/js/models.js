'use strict';
/* Procedural placeholder furniture models and floor textures. */
const lin=c=>new THREE.Color(c).convertSRGBToLinear();
const matCache={};
function M(c,rough,metal){const k=c+'|'+(rough==null?.85:rough)+'|'+(metal||0);
  return matCache[k]||(matCache[k]=new THREE.MeshStandardMaterial({color:lin(c),roughness:rough==null?.85:rough,metalness:metal||0}));}
function shade(c,a){const r=(c>>16)&255,g=(c>>8)&255,b=c&255,f=v=>clamp(Math.round(a<0?v*(1+a):v+(255-v)*a),0,255);return (f(r)<<16)|(f(g)<<8)|f(b);}
function B(g,w,h,d,m,x,y,z){const me=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);me.position.set(x,y+h/2,z);me.castShadow=true;me.receiveShadow=true;g.add(me);return me;}
function Cy(g,rt,rb,h,m,x,y,z){const me=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,24),m);me.position.set(x,y+h/2,z);me.castShadow=true;me.receiveShadow=true;g.add(me);return me;}
function legs(g,w,d,h,m,t){t=t||0.045;[[1,1],[1,-1],[-1,1],[-1,-1]].forEach(s=>B(g,t,h,t,m,s[0]*(w/2-t/2-0.03),0,s[1]*(d/2-t/2-0.03)));}
function rnd(seed){let s=seed>>>0;return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}

const BUILD={
  sofa(g,it){const w=it.w,d=it.d,h=it.h,fab=M(it.c1,.95),fab2=M(shade(it.c1,-0.08),.95),n=it.cat==='armchair'?1:Math.max(2,Math.min(4,Math.round(w/0.75)));
    legs(g,w,d,0.08,M(it.c3,.5));
    B(g,w,0.26,d,fab2,0,0.08,0);B(g,w,h-0.34,0.18,fab2,0,0.34,-d/2+0.09);
    B(g,0.15,0.26,d,fab2,w/2-0.075,0.34,0);B(g,0.15,0.26,d,fab2,-w/2+0.075,0.34,0);
    const inner=w-0.30,cw=inner/n;
    for(let i=0;i<n;i++){const x=-inner/2+cw*(i+.5);
      B(g,cw-0.02,0.13,d-0.21,fab,x,0.34,0.09);B(g,cw-0.04,0.30,0.14,fab,x,0.47,-d/2+0.25);}
  },
  coffee(g,it){const w=it.w,d=it.d,h=it.h,top=M(it.c2,.6),leg=M(it.c3,.5);
    B(g,w,0.04,d,top,0,h-0.04,0);
    if(it.style==='modern')B(g,w*0.86,h-0.04,d*0.7,M(shade(it.c2,-0.25),.7),0,0,0);
    else{legs(g,w,d,h-0.04,it.style==='loft'?leg:top,0.04);if(it.style==='loft')B(g,w-0.12,0.025,d-0.12,top,0,0.1,0);}
  },
  tvstand(g,it){const w=it.w,d=it.d,h=it.h,body=M(it.c2,.7),dark=M(shade(it.c2,-0.3),.7);
    legs(g,w,d,0.12,M(it.c3,.5));B(g,w,h-0.12,d,body,0,0.12,0);
    const n=Math.round(w/0.6);for(let i=1;i<n;i++)B(g,0.008,h-0.16,0.006,dark,-w/2+w*i/n,0.14,d/2);
    const tw=Math.min(w*0.82,1.35);
    B(g,0.3,0.02,0.2,M(0x111113,.4),0,h,0);B(g,0.05,0.07,0.04,M(0x111113,.4),0,h+0.02,0);
    B(g,tw,tw*0.56,0.035,M(0x0c0c0f,.25),0,h+0.08,0);
  },
  rug(g,it){const m=B(g,it.w,0.012,it.d,M(it.c1,1),0,0,0);m.castShadow=false;
    const b=B(g,it.w-0.24,0.004,it.d-0.24,M(shade(it.c1,it.tier===2?-0.18:0.12),1),0,0.012,0);b.castShadow=false;},
  lamp(g,it){const m=M(it.c3,.45,.3);Cy(g,0.14,0.15,0.025,m,0,0,0);Cy(g,0.012,0.012,1.3,m,0,0.025,0);
    const sh=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.19,0.27,24,1,true),new THREE.MeshStandardMaterial({color:lin(0xf6ead2),emissive:lin(0xffdca0),emissiveIntensity:.55,side:THREE.DoubleSide,roughness:1}));
    sh.position.set(0,1.325+0.135,0);g.add(sh);},
  shelf(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),fr=it.style==='loft'?M(it.c3,.5):m,r=rnd(it.w*1000+it.tier*7+it.style.length);
    B(g,0.03,h,d,fr,-w/2+0.015,0,0);B(g,0.03,h,d,fr,w/2-0.015,0,0);
    const cols=[0x7d8f9a,0xb8a27e,0x9a5b4a,0x4d6a5c,0xd9d2c3,0x3f4854];
    for(let i=0;i<6;i++){const y=0.08+i*(h-0.11)/5;B(g,w-0.06,0.03,d-0.02,m,0,y,0);
      if(i<5){let x=-w/2+0.06;const cnt=2+Math.floor(r()*5);
        for(let k=0;k<cnt&&x<w/2-0.12;k++){const bw=0.03+r()*0.035,bh=0.18+r()*0.1;B(g,bw,bh,d*0.6,M(cols[Math.floor(r()*cols.length)],.9),x+bw/2,y+0.03,0);x+=bw+0.004;}}}
  },
  plant(g,it){const pot=M(it.style==='scandi'?0xe9e4da:it.style==='modern'?0x2a2c30:0x8b5a3c,.8);
    Cy(g,0.18,0.14,0.36,pot,0,0,0);Cy(g,0.015,0.02,0.5,M(0x5b4a35,.9),0,0.36,0);
    const leaf=M(0x4f7f4a,.9),leaf2=M(0x3c6a3f,.9);
    [[0,0.92,0,0.26,leaf],[0.1,0.72,0.06,0.2,leaf2],[-0.1,0.78,-0.05,0.19,leaf],[0.02,1.12,-0.03,0.17,leaf2]].forEach(s=>{
      const me=new THREE.Mesh(new THREE.IcosahedronGeometry(s[3],1),s[4]);me.position.set(s[0],s[1],s[2]);me.castShadow=true;g.add(me);});
  },
  bed(g,it){const w=it.w,d=it.d,h=it.h,fr=it.style==='scandi'?M(it.c2,.7):M(shade(it.c1,-0.1),.95),linen=M(0xf2f0eb,1);
    legs(g,w,d,0.06,M(it.c3,.5),0.06);B(g,w,0.26,d,fr,0,0.06,0);B(g,w,h,0.08,fr,0,0,-d/2+0.04);
    B(g,w-0.1,0.2,d-0.16,linen,0,0.32,0.04);
    B(g,w-0.06,0.07,d*0.58,M(it.c1,1),0,0.5,d/2-d*0.29-0.03);
    const pw=Math.min(0.68,(w-0.2)/2);B(g,pw,0.12,0.4,linen,-pw/2-0.03,0.52,-d/2+0.34);B(g,pw,0.12,0.4,linen,pw/2+0.03,0.52,-d/2+0.34);
  },
  nightstand(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7);
    legs(g,w,d,0.14,M(it.c3,.5),0.035);B(g,w,h-0.14,d,m,0,0.14,0);B(g,w-0.04,0.008,0.006,dk,0,0.14+(h-0.14)/2,d/2);
    B(g,0.08,0.015,0.02,M(it.c3,.4,.4),0,0.14+(h-0.14)*0.75,d/2+0.008);},
  wardrobe(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7),hd=M(it.c3,.4,.4);
    B(g,w,h-0.06,d,m,0,0.06,0);B(g,w-0.04,0.06,d-0.06,dk,0,0,0);
    const n=Math.max(2,Math.round(w/0.5));
    for(let i=1;i<n;i++)B(g,0.008,h-0.1,0.006,dk,-w/2+w*i/n,0.08,d/2);
    for(let i=0;i<n;i++){const x=-w/2+w*(i+.5)/n+(i%2?-1:1)*(w/n/2-0.06);B(g,0.018,0.22,0.022,hd,x,1.0,d/2+0.008);}
  },
  dresser(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7),hd=M(it.c3,.4,.4);
    legs(g,w,d,0.1,M(it.c3,.5),0.04);B(g,w,h-0.1,d,m,0,0.1,0);
    for(let i=0;i<3;i++){const y=0.1+(h-0.1)*(i/3);if(i)B(g,w-0.04,0.008,0.006,dk,0,y,d/2);
      B(g,0.16,0.015,0.02,hd,-w/4,y+(h-0.1)/6,d/2+0.008);B(g,0.16,0.015,0.02,hd,w/4,y+(h-0.1)/6,d/2+0.008);}
  }
};
BUILD.armchair=BUILD.sofa;
const floorTex={};
function floorTexture(style){
  if(floorTex[style])return floorTex[style];
  const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d'),cols=STYLES[style].floor,r=rnd(style.length*97);
  const ph=64;
  for(let row=0;row<8;row++){let px=-Math.floor(r()*200);
    while(px<512){const len=160+Math.floor(r()*160);x.fillStyle=cols[Math.floor(r()*cols.length)];x.fillRect(px,row*ph,len,ph);
      x.fillStyle='rgba(0,0,0,.14)';x.fillRect(px+len-1,row*ph,1.5,ph);px+=len;}
    x.fillStyle='rgba(0,0,0,.16)';x.fillRect(0,row*ph,512,1.5);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.encoding=THREE.sRGBEncoding;t.anisotropy=4;
  return floorTex[style]=t;
}

/* Kitchen and bathroom models. */
const COUNTER={scandi:0xECE8E1,modern:0xD5D6DA,loft:0x3B3B3D};
const steel=()=>M(STEEL,.35,.6);
function doorLines(g,w,h0,h1,z,m,step){const n=Math.max(1,Math.round(w/(step||0.6)));for(let i=1;i<n;i++)B(g,0.008,h1-h0,0.006,m,-w/2+w*i/n,h0,z);}
BUILD.cabrun=function(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7);
  B(g,w-0.04,0.1,d-0.1,dk,0,0,-0.03);B(g,w,h-0.14,d-0.02,m,0,0.1,-0.01);B(g,w+0.01,0.04,d+0.02,M(COUNTER[it.style],.4),0,h-0.04,0);
  doorLines(g,w,0.12,h-0.05,d/2-0.02,dk);
  const sx=-w/2+Math.min(0.55,w/2);B(g,0.52,0.012,0.4,steel(),sx,h,0.02).castShadow=false;B(g,0.44,0.006,0.32,M(0x7f858c,.4,.6),sx,h+0.012,0.02).castShadow=false;
  Cy(g,0.012,0.012,0.22,steel(),sx,h,-d/2+0.08);B(g,0.02,0.02,0.16,steel(),sx,h+0.21,-d/2+0.15);};
BUILD.uppers=function(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7);
  B(g,w,h,d,m,0,1.45,0);doorLines(g,w,1.47,1.43+h,d/2,dk);};
BUILD.range=function(g,it){const w=it.w,d=it.d,h=it.h;
  B(g,w,h-0.02,d,steel(),0,0,0);B(g,w,0.02,d,M(0x15161a,.3),0,h-0.02,0);B(g,w-0.1,0.42,0.01,M(0x1b1c20,.2),0,0.2,d/2);B(g,w-0.14,0.02,0.03,steel(),0,0.68,d/2+0.02);
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(s=>{Cy(g,0.08,0.08,0.008,M(0x2a2b30,.5),s[0]*w*0.22,h,s[1]*d*0.2).castShadow=false;});
  B(g,w,0.1,0.03,steel(),0,h,-d/2+0.015);};
BUILD.fridge=function(g,it){const w=it.w,d=it.d,h=it.h,dk=M(0x70757b,.5);
  B(g,w,h,d,steel(),0,0,0);B(g,w,0.008,0.006,dk,0,0.62,d/2);B(g,0.008,h-0.64,0.006,dk,0,0.63,d/2);
  B(g,0.02,0.5,0.03,dk,-0.05,0.9,d/2+0.015);B(g,0.02,0.5,0.03,dk,0.05,0.9,d/2+0.015);B(g,0.3,0.02,0.03,dk,0,0.5,d/2+0.015);};
BUILD.island=function(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7);
  B(g,w-0.16,0.1,d-0.2,dk,0,0,0);B(g,w-0.1,h-0.14,d-0.14,m,0,0.1,0);B(g,w,0.04,d,M(COUNTER[it.style],.4),0,h-0.04,0);doorLines(g,w-0.1,0.12,h-0.05,d/2-0.07,dk);};
BUILD.vanity=function(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7);
  B(g,w-0.06,0.1,d-0.1,dk,0,0,-0.02);B(g,w,h-0.14,d-0.02,m,0,0.1,-0.01);B(g,w+0.02,0.04,d+0.02,M(COUNTER[it.style],.4),0,h-0.04,0);
  doorLines(g,w,0.12,h-0.05,d/2-0.02,dk,0.45);
  const bw=Math.min(0.5,w-0.14);B(g,bw,0.014,d*0.62,M(CERAMIC,.2),0,h,0.02).castShadow=false;B(g,bw-0.08,0.006,d*0.46,M(0xdde3e7,.2),0,h+0.014,0.02).castShadow=false;
  Cy(g,0.012,0.012,0.16,steel(),0,h,-d/2+0.07);B(g,0.02,0.02,0.12,steel(),0,h+0.15,-d/2+0.12);
  B(g,w*0.82,0.7,0.02,M(0xcfdde6,.1,.6),0,1.15,-d/2+0.01).castShadow=false;};
BUILD.toilet=function(g,it){const d=it.d,c=M(CERAMIC,.25);
  B(g,0.38,0.38,0.18,c,0,0.4,-d/2+0.09);B(g,0.2,0.3,0.3,c,0,0,-d/2+0.25);
  const bowl=Cy(g,0.19,0.13,0.4,c,0,0,0.09);bowl.scale.z=1.3;const seat=Cy(g,0.2,0.2,0.03,M(0xffffff,.3),0,0.4,0.09);seat.scale.z=1.3;};
BUILD.tub=function(g,it){const w=it.w,d=it.d,h=it.h,c=M(CERAMIC,.2);
  B(g,w,h,d,c,0,0,0);B(g,w-0.14,0.006,d-0.14,M(0xd9e4ea,.15),0,h,0).castShadow=false;
  Cy(g,0.014,0.014,0.14,steel(),-w/2+0.09,h,0);B(g,0.12,0.02,0.02,steel(),-w/2+0.14,h+0.13,0);};
BUILD.shower=function(g,it){const w=it.w,d=it.d,h=it.h;
  const glass=new THREE.MeshStandardMaterial({color:lin(0xbfe0ea),transparent:true,opacity:0.28,roughness:0.1});
  B(g,w,0.06,d,M(CERAMIC,.3),0,0,0);
  const a=B(g,w,h-0.1,0.012,glass,0,0.06,d/2-0.006),b=B(g,0.012,h-0.1,d,glass,w/2-0.006,0.06,0);a.castShadow=b.castShadow=false;
  Cy(g,0.012,0.012,h-0.2,steel(),-w/2+0.08,0.06,-d/2+0.08);Cy(g,0.1,0.1,0.02,steel(),-w/2+0.2,h-0.16,-d/2+0.2);};
BUILD.bathcab=function(g,it){const w=it.w,d=it.d,h=it.h,m=M(it.c2,.7),dk=M(shade(it.c2,-0.3),.7);
  B(g,w,h-0.06,d,m,0,0.06,0);B(g,w-0.04,0.06,d-0.06,dk,0,0,0);B(g,w-0.02,0.008,0.006,dk,0,h*0.5,d/2);B(g,0.018,0.2,0.022,M(it.c3,.4,.4),w/2-0.06,h*0.62,d/2+0.008);};
/* Square-tile floor texture, tinted by the chosen tile. */
const tileTex={};
/* Wallpaper: a quiet vertical pattern in the product's colour, one metre wide. */
const paperTex={};
function wallpaperTexture(color){
  if(paperTex[color])return paperTex[color];
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle=hex(shade(color,0.25));x.fillRect(0,0,256,256);
  for(let i=0;i<8;i++){x.fillStyle=hex(shade(color,i%2?0.12:0));x.fillRect(i*32+10,0,i%2?4:12,256);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.encoding=THREE.sRGBEncoding;t.anisotropy=4;
  return paperTex[color]=t;
}
function tileTexture(color){
  if(tileTex[color])return tileTex[color];
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d'),r=rnd(color);
  for(let i=0;i<4;i++)for(let j=0;j<4;j++){x.fillStyle=hex(shade(color,(r()-0.5)*0.08));x.fillRect(i*64,j*64,64,64);}
  x.fillStyle='rgba(40,40,40,.35)';for(let i=0;i<=4;i++){x.fillRect(i*64-1,0,2,256);x.fillRect(0,i*64-1,256,2);}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.encoding=THREE.sRGBEncoding;t.anisotropy=4;
  return tileTex[color]=t;
}

/* Dining room and office models. */
BUILD.dtable=function(g,it){const w=it.w,d=it.d,h=it.h,top=M(it.c2,.6),leg=it.style==='loft'?M(it.c3,.5):top;B(g,w,0.045,d,top,0,h-0.045,0);legs(g,w-0.1,d-0.1,h-0.045,leg,0.06);};
BUILD.dchair=function(g,it){const w=it.w,d=it.d,m=M(it.c2,.7),f=M(it.c1,.95);legs(g,w,d,0.44,m,0.035);B(g,w,0.05,d,f,0,0.44,0);B(g,w,0.42,0.04,m,0,0.49,-d/2+0.02);};
BUILD.sideboard=BUILD.dresser;
BUILD.desk=function(g,it){const w=it.w,d=it.d,h=it.h,top=M(it.c2,.6),side=it.style==='loft'?M(it.c3,.5):M(shade(it.c2,-0.15),.7);
  B(g,w,0.04,d,top,0,h-0.04,0);B(g,0.04,h-0.04,d-0.06,side,-w/2+0.04,0,0);B(g,0.4,h-0.1,d-0.08,side,w/2-0.22,0.06,0);
  for(let i=1;i<3;i++)B(g,0.36,0.008,0.006,M(shade(it.c2,-0.35),.7),w/2-0.22,0.06+(h-0.1)*i/3,d/2-0.04);};
BUILD.ochair=function(g,it){const m=M(0x26282c,.6),f=M(it.c1,.95);
  Cy(g,0.28,0.28,0.03,m,0,0,0);Cy(g,0.03,0.03,0.4,m,0,0.03,0);B(g,0.5,0.08,0.48,f,0,0.43,0);B(g,0.46,0.5,0.06,f,0,0.52,-0.22);};

/* The deep end of an L-shaped sofa: a seat with no back, drawn at the size the layout gave it. */
BUILD.sofaPart=function(g,it,q){const fab=M(it.c1,.95),fab2=M(shade(it.c1,-0.08),.95);B(g,q.w,0.26,q.d,fab2,0,0.08,0);B(g,q.w-0.04,0.13,q.d-0.04,fab,0,0.34,0);};
