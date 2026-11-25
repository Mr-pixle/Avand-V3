(()=>{'use strict';
const c=document.getElementById('art'),ctx=c.getContext('2d',{alpha:false});
const TAU=Math.PI*2;
let W,H,D,seed,rand,mode,palette,staticLayer,travelers=[],currentPaths=[],epoch=performance.now();
function rng(s){return ()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
function r(a=0,b=1){return a+(b-a)*rand()}function pick(a){return a[Math.floor(r(0,a.length))]}function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function rgba(rgb,opacity){return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(opacity,0,1)})`}
const palettes=[
 {paper:[250,249,246],ink:[36,38,44],soft:[129,127,127],accents:[[30,60,114],[154,54,53],[195,138,66]]},
 {paper:[249,249,249],ink:[23,27,33],soft:[117,126,132],accents:[[165,35,39],[200,67,53],[31,61,100]]},
 {paper:[248,249,251],ink:[19,35,59],soft:[112,135,160],accents:[[38,66,128],[67,104,162],[146,65,67]]},
 {paper:[251,249,244],ink:[51,42,43],soft:[131,109,114],accents:[[111,63,115],[52,72,137],[167,105,82]]},
 {paper:[247,246,244],ink:[28,28,31],soft:[126,127,128],accents:[[52,54,63],[121,118,120],[80,80,82]]},
 {paper:[250,249,247],ink:[43,37,46],soft:[150,124,126],accents:[[42,64,119],[52,81,132],[174,80,82]]}
];
let atlasTheme=document.documentElement.dataset.theme==='dark'?'dark':'light', basePalette=null, drawSeed=1;
function darkPalette(p){
 // Keep the original pigments recognizable against dark paper, with a modest lift.
 const lift=(c)=>c.map(v=>Math.min(255,Math.round(v*.92+48)));
 return {paper:[12,13,17],ink:[225,227,232],soft:[134,142,156],accents:p.accents.map(lift)};
}
function applyAtlasTheme(next){
 next=next==='dark'?'dark':'light';
 document.documentElement.dataset.theme=next;
 document.body.style.background=next==='dark'?'#0c0d11':'#f8f7f4';
 if(atlasTheme===next && basePalette)return;
 atlasTheme=next;
 if(!basePalette)return;
 palette=next==='dark'?darkPalette(basePalette):basePalette;
 rand=rng(drawSeed);draw();if(staticLayer){ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(staticLayer,0,0);}
}
addEventListener('message',ev=>{if(ev.source===parent&&ev.origin===location.origin&&ev.data&&ev.data.type==='AVAND_ATLAS_THEME')applyAtlasTheme(ev.data.theme)});
const dot=(g,x,y,rad,color,alpha=1)=>{g.fillStyle=rgba(color,alpha);g.beginPath();g.arc(x,y,Math.max(.12,rad),0,TAU);g.fill()};
function wash(g,x,y,rad,col,opacity){const z=g.createRadialGradient(x,y,0,x,y,rad);z.addColorStop(0,rgba(col,opacity));z.addColorStop(.3,rgba(col,opacity*.47));z.addColorStop(.72,rgba(col,opacity*.13));z.addColorStop(1,rgba(col,0));g.fillStyle=z;g.fillRect(x-rad,y-rad,rad*2,rad*2)}
function stroke(g,x,y,nx,ny,width,color,opacity){g.strokeStyle=rgba(color,opacity);g.lineWidth=Math.max(.17,width);g.lineCap='round';g.beginPath();g.moveTo(x,y);g.lineTo(nx,ny);g.stroke()}
function grain(g){const count=Math.min(33000,Math.floor(W*H/35));for(let i=0;i<count;i++){let x=r(0,W),y=r(0,H);dot(g,x,y,r(.12,.55),r()<.5?palette.ink:palette.soft,r(.012,.045))}}
function record(arr){if(currentPaths.length<1400&&arr.length>6)currentPaths.push(arr)}
// Fractal vascular trees: crooked branching, capillary haze, local branching, thick artery stems.
function tree(g,start,initial,span,base,depth,c,options={}){
 let stack=[{x:start[0],y:start[1],a:initial,len:span,w:base,d:0,pts:[[start[0],start[1]]],charge:r(-1,1)}];
 const maxBranches=options.maxBranches||6000;let n=0;
 while(stack.length&&n<maxBranches){let b=stack.pop();n++;
 let steps=clamp(Math.round(b.len/r(2,5)),5,25);let x=b.x,y=b.y,a=b.a;let poly=b.pts;
 for(let j=0;j<steps;j++){
  let t=j/steps;
  a+=r(-.20,.20)+(b.charge*.035);
  let step=b.len/steps*r(.75,1.3),nx=x+Math.cos(a)*step,ny=y+Math.sin(a)*step;
  let wd=b.w*(1-.5*t);
  stroke(g,x,y,nx,ny,wd,c,clamp(.74-b.d*.075,.13,.88));
  if(wd>1.25&&r()<.36)stroke(g,x+r(-2,2),y+r(-2,2),nx,ny,wd*.3,palette.soft,.16);
  if(b.d>2&&r()<.28)dot(g,nx+r(-2,2),ny+r(-2,2),r(.13,.65),c,r(.07,.24));
  poly.push([nx,ny]);x=nx;y=ny;
  if(r()<(.065+.09*t)&&b.d<depth&&n+stack.length<maxBranches){
   const count=r()<.12?2:1;
   for(let k=0;k<count;k++){
    let turn=(r()<.5?-1:1)*r(.38,1.34);
    stack.push({x,y,a:a+turn,len:b.len*r(.52,.79),w:Math.max(.27,wd*r(.48,.73)),d:b.d+1,charge:r(-1,1),pts:[[x,y]]});
   }
  }
 }
 if(poly.length>6&&b.d<3)record(poly);
 if(b.d<depth&&b.len>5){let children=b.d<1?2:1;for(let k=0;k<children;k++)stack.push({x,y,a:a+r(-.82,.82),len:b.len*r(.57,.82),w:Math.max(.23,b.w*r(.48,.73)),d:b.d+1,charge:r(-1,1),pts:[[x,y]]})}
 }
}
function capillaryCloud(g,x,y,rad,n,col){for(let i=0;i<n;i++){
 let a=r(0,TAU),dst=rad*Math.sqrt(r()),px=x+Math.cos(a)*dst,py=y+Math.sin(a)*dst;
 let len=r(3,rad*.22),ang=a+r(-1.5,1.5);stroke(g,px,py,px+Math.cos(ang)*len,py+Math.sin(ang)*len,r(.12,.5),col,r(.035,.16));
 if(r()<.15)dot(g,px,py,r(.3,1.4),col,r(.04,.2));
 }}
function branchingAtlas(g,variant){
 let sz=Math.min(W,H),x=r(W*.26,W*.72),y=r(H*.24,H*.78);
 let hues=variant===1?[palette.ink,palette.ink,palette.accents[0]]:variant===2?[palette.ink,palette.accents[0],palette.accents[1]]:[palette.ink,palette.ink,palette.soft];
 let count=variant===2?9:variant===1?8:11;
 // a rich mass of crossing branches growing out of several hubs, not isolated thin lines
 for(let i=0;i<count;i++){
  let a=i/count*TAU+r(-.36,.36),rootx=x+r(-sz*.16,sz*.16),rooty=y+r(-sz*.15,sz*.15);
  let pigment=pick(hues),len=r(sz*.17,sz*.42);
  tree(g,[rootx,rooty],a,len,r(1.7,5.9)*(variant===2?1.18:1),Math.floor(r(5,8)),pigment,{maxBranches:Math.floor(r(220,420))});
 }
 for(let i=0;i<15;i++){
  let px=x+r(-sz*.4,sz*.4),py=y+r(-sz*.4,sz*.4),rad=r(sz*.06,sz*.19);
  capillaryCloud(g,px,py,rad,Math.floor(r(80,240)),r()<.7?palette.soft:pick(hues));
 }
 for(let i=0;i<7;i++)wash(g,x+r(-sz*.3,sz*.3),y+r(-sz*.28,sz*.28),r(sz*.05,sz*.14),pick(palette.accents),r(.018,.08));
}
function riverNetwork(g){
 let sz=Math.min(W,H),start=[r(W*.12,W*.33),r(H*.2,H*.68)],end=[r(W*.66,W*.88),r(H*.36,H*.82)];
 for(let j=0;j<3;j++){
 let pts=[];let offset=j*sz*.035;
 for(let i=0;i<=150;i++){let t=i/150,x=start[0]*(1-t)+end[0]*t,y=start[1]*(1-t)+end[1]*t;
  x+=Math.sin(t*TAU*1.6+j)*sz*.062+Math.sin(t*TAU*4.2+j*.3)*sz*.02;
  y+=Math.cos(t*TAU*1.2+j)*sz*.06+offset;
  pts.push([x,y]);
 }
 for(let i=1;i<pts.length;i++){
   let a=pts[i-1],b=pts[i];stroke(g,a[0],a[1],b[0],b[1],j===0?r(3.4,7):r(1.2,3),j===0?palette.accents[0]:palette.ink,j===0?.8:.38)
 }
 record(pts);
 for(let k=5;k<pts.length-5;k+=Math.floor(r(3,8))){let [x,y]=pts[k];let a=Math.atan2(pts[k+1][1]-pts[k-1][1],pts[k+1][0]-pts[k-1][0]);
 tree(g,[x,y],a+(r()<.5?-1:1)*r(.75,1.65),r(sz*.045,sz*.13),r(.5,1.45),Math.floor(r(3,6)),r()<.67?palette.ink:palette.soft,{maxBranches:Math.floor(r(100,210))})
 }
 }
 for(let i=0;i<35;i++){let pt=pick(currentPaths);if(!pt)continue;let p=pick(pt);wash(g,p[0],p[1],r(sz*.015,sz*.075),pick(palette.accents),r(.018,.075))}
}
function orbitalInk(g){
 let sz=Math.min(W,H),cx=r(W*.3,W*.7),cy=r(H*.3,H*.7),nodes=[];
 for(let i=0;i<Math.floor(r(9,20));i++)nodes.push({x:cx+r(-sz*.37,sz*.37),y:cy+r(-sz*.35,sz*.35),rad:r(sz*.025,sz*.14),col:pick(palette.accents)});
 for(const n of nodes){
   wash(g,n.x,n.y,n.rad*2.7,n.col,r(.08,.21));
   for(let k=0;k<Math.floor(r(60,150));k++){
    let angle=r(0,TAU),rr=n.rad*Math.sqrt(r());dot(g,n.x+Math.cos(angle)*rr,n.y+Math.sin(angle)*rr,r(.25,2.1),n.col,r(.035,.29))
   }
 }
 for(let i=0;i<240;i++){
  let a=pick(nodes),b=pick(nodes),path=[],steps=Math.floor(r(16,80));if(a===b)continue;
  let bx=(a.x+b.x)/2+r(-sz*.3,sz*.3),by=(a.y+b.y)/2+r(-sz*.3,sz*.3);
  for(let k=0;k<=steps;k++){let t=k/steps;let x=(1-t)*(1-t)*a.x+2*(1-t)*t*bx+t*t*b.x;
   let y=(1-t)*(1-t)*a.y+2*(1-t)*t*by+t*t*b.y;
   x+=Math.sin(t*TAU*2+i)*r(0,.6);y+=Math.cos(t*TAU*2+i)*r(0,.6);
   if(path.length){let p=path[path.length-1];stroke(g,p[0],p[1],x,y,r(.18,1.1),r()<.8?palette.ink:a.col,r(.06,.38))}path.push([x,y])
  }if(r()<.55)record(path)
 }
 for(let i=0;i<8;i++){let n=pick(nodes);tree(g,[n.x,n.y],r(0,TAU),r(sz*.035,sz*.12),r(.6,1.8),5,palette.ink,{maxBranches:140})}
}
function filamentField(g){
 let sz=Math.min(W,H),cx=r(W*.3,W*.7),cy=r(H*.25,H*.7),col=pick(palette.accents);
 for(let i=0;i<680;i++){
 let angle=r(0,TAU),r0=sz*r(.02,.21),x=cx+Math.cos(angle)*r0,y=cy+Math.sin(angle)*r0;
 let pts=[[x,y]],v=angle+r(-1.3,1.3);let steps=Math.floor(r(12,65));
 for(let j=0;j<steps;j++){
  v+=Math.sin(x*.008+seed*.00001)*.075+Math.cos(y*.009)*.06+r(-.16,.16);
  let xx=x+Math.cos(v)*r(1,4.5),yy=y+Math.sin(v)*r(1,4.5);
  stroke(g,x,y,xx,yy,r(.15,.8),r()<.85?palette.ink:col,r(.045,.38));x=xx;y=yy;pts.push([x,y]);
 }
 if(i%3===0)record(pts)
 }
 for(let i=0;i<1400;i++){
 let x=cx+r(-sz*.25,sz*.25),y=cy+r(-sz*.25,sz*.25);
 if(r()<.4)dot(g,x,y,r(.3,1.5),col,r(.08,.48));
 }
 for(let i=0;i<6;i++)wash(g,cx+r(-sz*.13,sz*.13),cy+r(-sz*.12,sz*.12),r(sz*.06,sz*.16),col,r(.028,.09))
}
function redConstellation(g){
 let sz=Math.min(W,H),cx=r(W*.37,W*.63),cy=r(H*.35,H*.63),points=[];
 const n=1450,acol=palette.accents[0];
 for(let i=0;i<n;i++){
 let t=r(0,1),a=t*TAU*1.45,rr=sz*(.045+.24*t)+r(-sz*.08,sz*.08);
 let x=cx+Math.cos(a)*rr*r(.65,1.4),y=cy+Math.sin(a)*rr*r(.7,1.5);
 if(r()<.65){x=cx+(r()-.5)*sz*.55;y=cy+(r()-.5)*sz*.75}
 points.push([x,y]);dot(g,x,y,r(.35,1.9),r()<.75?acol:palette.ink,r(.1,.75));
 }
 for(let i=0;i<700;i++){
 let a=pick(points),b=pick(points),dx=a[0]-b[0],dy=a[1]-b[1],dd=dx*dx+dy*dy;
 if(dd<sz*sz*.015&&dd>sz*sz*.0003){stroke(g,a[0],a[1],b[0],b[1],r(.2,.7),r()<.2?acol:palette.soft,r(.035,.17));if(r()<.16)record([a,[(a[0]+b[0])/2,(a[1]+b[1])/2],b,a,b,a,b])}
 }
 for(let i=0;i<7;i++)tree(g,[cx+r(-sz*.19,sz*.19),cy+r(-sz*.2,sz*.2)],r(0,TAU),r(sz*.11,sz*.23),r(1,3),5,r()<.35?acol:palette.ink,{maxBranches:280});
}

// Additional geometry families. They obey the same selected light/dark ink palette.
function arcLoom(g){
 const sz=Math.min(W,H),cx=r(W*.35,W*.65),cy=r(H*.32,H*.67),rad=r(sz*.23,sz*.43),col=pick(palette.accents);
 for(let i=0;i<250;i++){
  let a=r(-2.6,2.6),b=a+r(.45,3.2),rr=rad*r(.25,1.1),pts=[];
  for(let j=0;j<=52;j++){let t=j/52,ang=a+(b-a)*t,rr2=rr+Math.sin(t*TAU*2+i)*r(0,sz*.012),x=cx+Math.cos(ang)*rr2,y=cy+Math.sin(ang)*rr2;
   if(pts.length){let q=pts[pts.length-1];stroke(g,q[0],q[1],x,y,r(.2,.7),i%5?palette.ink:col,r(.08,.35))}pts.push([x,y]);}
  if(i%3===0)record(pts);
 }
}
function chordWeb(g){
 const sz=Math.min(W,H),cx=r(W*.32,W*.68),cy=r(H*.28,H*.72),rad=sz*r(.23,.4),N=240;
 for(let i=0;i<560;i++){
  let a=r(0,TAU),b=a+r(.3,Math.PI*1.85),p=[cx+rad*Math.cos(a),cy+rad*Math.sin(a)],q=[cx+rad*Math.cos(b),cy+rad*Math.sin(b)];
  stroke(g,p[0],p[1],q[0],q[1],r(.2,.7),i%7?palette.ink:pick(palette.accents),r(.035,.19));
  if(i%5===0)record([p,p,p,p,q,q,q,q]);
 }
}
function flowRibbons(g){
 const sz=Math.min(W,H),cx=r(W*.25,W*.75),cy=r(H*.3,H*.7),direction=r(-1,1);
 for(let i=0;i<580;i++){
  let yy=(i/580-.5)*sz*.9,pts=[];
  for(let j=0;j<=75;j++){
    let t=j/75,x=cx+(t-.5)*W*.95,y=cy+yy*.8+Math.sin(t*TAU*(1.2+direction*.2)+i*.028)*sz*.115*(1-Math.abs(t-.5)*.9);
    if(pts.length){let q=pts[pts.length-1];stroke(g,q[0],q[1],x,y,r(.18,.85),i%12===0?pick(palette.accents):palette.ink,r(.035,.24));}pts.push([x,y]);
  }
  if(i%7===0)record(pts);
 }
}
function radialFans(g){
 const sz=Math.min(W,H),cx=r(W*.28,W*.72),cy=r(H*.25,H*.75),n=7;
 for(let hub=0;hub<n;hub++){
  let a=TAU*hub/n,px=cx+Math.cos(a)*sz*.11,py=cy+Math.sin(a)*sz*.11;
  for(let i=0;i<135;i++){
   let theta=a+r(-1.6,1.6),len=r(sz*.15,sz*.65),points=[];
   for(let j=0;j<=30;j++){
    let t=j/30,an=theta+Math.sin(t*Math.PI)*r(-.6,.6),x=px+Math.cos(an)*len*t,y=py+Math.sin(an)*len*t;
    if(points.length){let q=points[points.length-1];stroke(g,q[0],q[1],x,y,r(.18,.7),i%13===0?pick(palette.accents):palette.ink,r(.05,.3));}points.push([x,y]);
   }
   if(i%10===0)record(points);
  }
 }
}
function merger(g){
 const sz=Math.min(W,H),tx=r(W*.55,W*.75),ty=r(H*.3,H*.7),side=r()<.5?-1:1;
 for(let i=0;i<450;i++){
  let y=H*(i+.5)/450,x=side<0?W*.03:W*.97,pts=[];
  for(let j=0;j<=65;j++){
   let t=j/65,tt=t*t*(3-2*t),xx=x+(tx-x)*t,yy=y+(ty-y)*tt+Math.sin(t*TAU*2+i*.05)*sz*.025*(1-t);
   if(pts.length){let q=pts[pts.length-1];stroke(g,q[0],q[1],xx,yy,r(.13,.6),i%9===0?pick(palette.accents):palette.ink,r(.055,.28));}pts.push([xx,yy]);
  }
  if(i%6===0)record(pts);
 }
}
function technicalContours(g){
 const sz=Math.min(W,H),cx=r(W*.35,W*.65),cy=r(H*.3,H*.7);
 for(let i=0;i<160;i++){
  let rr=sz*(.04+i*.0029),points=[];
  for(let j=0;j<=110;j++){
   let a=j/110*TAU,rad=rr*(1+.15*Math.sin(5*a+i*.035)+.08*Math.cos(9*a-i*.01)),x=cx+rad*Math.cos(a)*1.25,y=cy+rad*Math.sin(a)*.72;
   if(points.length){let q=points[points.length-1];stroke(g,q[0],q[1],x,y,r(.15,.7),i%17===0?pick(palette.accents):palette.ink,r(.055,.24));}points.push([x,y]);
  }
  if(i%8===0)record(points);
 }
}

function draw(){
 currentPaths=[];travelers=[];
 const g=staticLayer.getContext('2d',{alpha:false});g.setTransform(D,0,0,D,0,0);g.fillStyle=rgba(palette.paper,1);g.fillRect(0,0,W,H);
 // paper-like subtle mixed-media marks below the structure
 for(let i=0;i<12;i++){let x=r(0,W),y=r(0,H);wash(g,x,y,r(40,Math.min(W,H)*.28),pick(palette.accents),r(.006,.025))}
 if(mode===0)branchingAtlas(g,0);else if(mode===1)branchingAtlas(g,1);else if(mode===2)branchingAtlas(g,2);else if(mode===3)riverNetwork(g);else if(mode===4)orbitalInk(g);else if(mode===5)filamentField(g);else if(mode===6)redConstellation(g);else if(mode===7)arcLoom(g);else if(mode===8)chordWeb(g);else if(mode===9)flowRibbons(g);else if(mode===10)radialFans(g);else if(mode===11)merger(g);else technicalContours(g);
  // Restrained colored segments along paths already drawn by the artwork.
  // These are stationary accents, not an extra set of moving lines.
  for(let i=0;i<Math.min(36,currentPaths.length);i++){
    if(r()>.45)continue;
    const path=pick(currentPaths);
    if(!path||path.length<7)continue;
    const start=Math.floor(r(1,Math.max(2,path.length-5)));
    const end=Math.min(path.length-1,start+Math.floor(r(3,11)));
    const col=pick(palette.accents);
    for(let j=start+1;j<=end;j++){
      const a=path[j-1],b=path[j];
      stroke(g,a[0],a[1],b[0],b[1],r(.45,1.2),col,r(.14,.37));
    }
  }
  grain(g);
 for(let i=0;i<Math.min(145,currentPaths.length);i++){
 let points=pick(currentPaths);if(points.length<3)continue;
 // Slow the visually fast long-line / fan / chord / merge families without changing artwork.
 // The pixel-per-second cap prevents long paths from creating sudden fast streaks.
 let pathLength=0;
 for(let k=1;k<points.length;k++){
   const dx=points[k][0]-points[k-1][0],dy=points[k][1]-points[k-1][1];
   pathLength+=Math.hypot(dx,dy);
 }
 const slowFamily=(mode===8||mode===9||mode===10||mode===11);
 const speedFactor=slowFamily?.22:(mode===7||mode===12?.48:1);
 const maxPixelsPerSecond=slowFamily?19:(mode===7||mode===12?32:58);
 const speed=Math.min(r(.015,.075)*speedFactor,maxPixelsPerSecond/Math.max(pathLength,1));
 travelers.push({pts:points,speed,phase:r(),width:r(.5,2.8),color:pick([...palette.accents,...palette.accents,palette.ink]),offset:r(-3,3),alpha:r(.36,.84)})
 }
 epoch=performance.now();
}
function regenerate(){
 W=innerWidth;H=innerHeight;D=Math.min(devicePixelRatio||1,2);
 c.width=Math.floor(W*D);c.height=Math.floor(H*D);ctx.setTransform(D,0,0,D,0,0);
 staticLayer=document.createElement('canvas');staticLayer.width=c.width;staticLayer.height=c.height;
 if(seed===undefined){const arr=new Uint32Array(1);crypto.getRandomValues(arr);seed=arr[0]||Date.now();}rand=rng(seed);
 mode=Math.floor(r(0,13));basePalette=pick(palettes);
  drawSeed=(seed^0x51F15EED)>>>0;
  palette=atlasTheme==='dark'?darkPalette(basePalette):basePalette;
  rand=rng(drawSeed);draw();if(staticLayer){ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(staticLayer,0,0);}
}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let last=0;
function frame(now){if(!reducedMotion.matches)requestAnimationFrame(frame);if(now-last<25)return;last=now;
 ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(staticLayer,0,0);
 ctx.setTransform(D,0,0,D,0,0);
 const time=(now-epoch)/1000;
 // softly flowing luminescent pigment, dots traveling along actual generated branches
 for(const t of travelers){
  let p=(t.phase+time*t.speed)%1,index=Math.min(t.pts.length-2,Math.floor(p*(t.pts.length-1)));
  let u=p*(t.pts.length-1)-index,a=t.pts[index],b=t.pts[index+1];
  let x=a[0]+(b[0]-a[0])*u,y=a[1]+(b[1]-a[1])*u;
  let halo=ctx.createRadialGradient(x,y,0,x,y,t.width*7);halo.addColorStop(0,rgba(t.color,t.alpha*.24));halo.addColorStop(1,rgba(t.color,0));ctx.fillStyle=halo;ctx.beginPath();ctx.arc(x,y,t.width*7,0,TAU);ctx.fill();
  dot(ctx,x,y,t.width,t.color,t.alpha*.62);
 }
 // subtle drifting dust rather than mechanical blinking
 for(let i=0;i<36;i++){let s=i*127.13+seed*.001,x=((Math.sin(s*2.35)*.5+.5)*W+time*(i%2?2:-2)+W)%W;
 let y=((Math.cos(s*.91)*.5+.5)*H+Math.sin(time*.21+i)*8+H)%H;
 dot(ctx,x,y,.45,palette.soft,.03+.025*Math.sin(time*.6+i))}
}
let timer;addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(regenerate,190)});
regenerate();requestAnimationFrame(frame);
})();
