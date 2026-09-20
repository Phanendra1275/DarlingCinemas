"use client";
import {useEffect,useRef} from 'react';
import * as T from 'three';
import {buildCinema,createAvatar,floorHeight,seats,SCREEN,THEATRE_CONFIG,createSnacks} from './cinema-scene';
export type Member={id:string;seat:string|null;color:string;name?:string};
export type CameraSettings={fov:number;distance:number;height:number;pitch:number;targetHeight:number;sideOffset:number;damping:number;sensitivity:number;heroX:number;heroY:number;heroZ:number;targetX:number;targetY:number;targetZ:number;yaw:number;collisionDistance:number};
export const defaultCamera:CameraSettings={fov:64,distance:3.2,height:.65,pitch:.04,targetHeight:1.35,sideOffset:0,damping:7,sensitivity:.003,heroX:6.85,heroY:4.2,heroZ:7.2,targetX:-.65,targetY:1,targetZ:-2.5,yaw:0,collisionDistance:.18};
export const REFERENCE_GEOMETRY_VIEW:CameraSettings={fov:64,distance:0,height:1.2,pitch:0,targetHeight:1.2,sideOffset:0,damping:7,sensitivity:.003,heroX:5.5,heroY:1.2,heroZ:4.5,targetX:-1.0,targetY:1.2,targetZ:-2.0,yaw:0,collisionDistance:.18};
export type TheatreProps={seat:string|null;video?:HTMLVideoElement|null;lite?:boolean;members?:Member[];service?:number;onSeat?:(seat:string)=>void;onNearbySeat?:(seat:string|null)=>void;onFps?:(fps:number)=>void;onWalk?:()=>void;moveRef?:React.MutableRefObject<{x:number;y:number;magnitude:number}>;reset?:number;zoom?:boolean;isTouch?:boolean;walk?:number;jacket?:string;cameraSettings?:CameraSettings;blocked?:boolean;quality?:string;reducedMotion?:boolean;highRefresh?:boolean;destination?:{id:string;request:number}|null;onRouteCancel?:()=>void;onServiceState?:(state:string)=>void;name?:string;gender?:string;};
export default function Theatre(props:TheatreProps){
 const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
 useEffect(()=>{if(!host.current)return;const el=host.current;let renderer:T.WebGLRenderer;
 try{renderer=new T.WebGLRenderer({antialias:true});}catch{el.textContent='This device could not start the 3D cinema. Please enable WebGL.';return;}
 renderer.setClearColor('#14120f');renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;el.appendChild(renderer.domElement);
  const scene=new T.Scene(),room=buildCinema(scene),avatar=createAvatar(props.jacket??'#d6cdb4', props.gender??'Male');scene.add(avatar.root);
  const nameCanvas=document.createElement('canvas');nameCanvas.width=256;nameCanvas.height=64;
  const nctx=nameCanvas.getContext('2d')!;
  const nameTex=new T.CanvasTexture(nameCanvas);
  const nameMat=new T.SpriteMaterial({map:nameTex,transparent:true,opacity:1,depthTest:false});
  const nameSprite=new T.Sprite(nameMat);
  nameSprite.scale.set(0.9,0.9*(64/256),1);
  nameSprite.position.set(0,2.05,0);
  nameSprite.visible=false; // Only visible to other users
  avatar.root.add(nameSprite);
  let lastName='';
 const camera=new T.PerspectiveCamera(64,1,.08,60);camera.position.set(6.85,4.5,8.8);
 const player=new T.Vector3(6.45,.32,5.9),velocity=new T.Vector2(),desired=new T.Vector3(),focus=new T.Vector3(),direction=new T.Vector3(),orbitRay=new T.Raycaster();
 let overview=true,yaw=0,pitch=defaultCamera.pitch,distance=defaultCamera.distance,lastSeat:string|null=null,lastNearby:string|null=null,lastReset=props.reset,lastWalk=props.walk,lastDpr=0,lastFov=0,elapsed=0;
 let pointer:number|null=null,px=0,py=0,dragged=false;const keys=new Set<string>();
 let video:HTMLVideoElement|null=null,texture:T.VideoTexture|null=null;const videoMaterial=new T.MeshBasicMaterial({toneMapped:false});const videoMesh=new T.Mesh(new T.PlaneGeometry(SCREEN.width,SCREEN.height),videoMaterial);videoMesh.position.z=.012;videoMesh.visible=false;room.screen.add(videoMesh);
  if(typeof window!=='undefined'&&!(window as any).CINEMA_LIGHTS_CONFIG){(window as any).CINEMA_LIGHTS_CONFIG={samplingFPS:6,blendWithWhite:.15,minLuminance:.02,intensityMul:30,attack:6.0,release:2.5};}
  const sample=document.createElement('canvas');sample.width=24;sample.height=14;const context=sample.getContext('2d',{willReadFrequently:true});let sampled=0,sampleFailed=false;let previousMap:T.Texture|null=room.welcome;
  const tL=new T.Color('#000'),tC=new T.Color('#000'),tR=new T.Color('#000');let iL=0,iC=0,iR=0;
 let route:T.Vector3[]=[];let destinationRequest=0;let routeSeat:string|null=null;let lastService=0,serviceStarted=0;const server=createAvatar('#e0d6c0');server.root.visible=false;scene.add(server.root);const snacks=createSnacks();snacks.visible=false;scene.add(snacks);
 const startWalk=()=>{if(overview){overview=false;latest.current.onWalk?.();}};
 function blocked(x:number,z:number){return (z>14.1&&x>-2.5&&x<4.6)||(z>9.7&&z<10.3&&x<5.6)||seats.some(s=>Math.abs(x-s.position.x)<1.19&&z>s.position.z-1.55&&z<s.position.z+1.17);}
 const down=(e:PointerEvent)=>{if(latest.current.blocked||pointer!==null)return;pointer=e.pointerId;px=e.clientX;py=e.clientY;dragged=false;renderer.domElement.setPointerCapture(pointer);};
 const move=(e:PointerEvent)=>{if(pointer!==e.pointerId)return;const dx=e.clientX-px,dy=e.clientY-py;dragged=dragged||Math.abs(dx)+Math.abs(dy)>3;if(dragged){startWalk();const cfg=latest.current.cameraSettings??defaultCamera;yaw-=dx*cfg.sensitivity;pitch=T.MathUtils.clamp(pitch+dy*cfg.sensitivity,-.25,.7);}px=e.clientX;py=e.clientY;};
 const up=(e:PointerEvent)=>{if(pointer!==e.pointerId)return;pointer=null;if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);if(!dragged&&!latest.current.seat&&lastNearby){const bounds=renderer.domElement.getBoundingClientRect();const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-bounds.left)/bounds.width*2-1,-(e.clientY-bounds.top)/bounds.height*2+1),camera);const hit=ray.intersectObjects(room.chairs,true)[0];if(hit){let item:T.Object3D|null=hit.object;while(item&&!item.userData.seat)item=item.parent;if(item?.userData.seat===lastNearby)latest.current.onSeat?.(lastNearby);}}};
 const keydown=(e:KeyboardEvent)=>{if(latest.current.blocked||(e.target as HTMLElement).closest('input,textarea,select,button,[role="dialog"]'))return;const k=e.key.toLowerCase();if(['w','a','s','d'].includes(k)){e.preventDefault();keys.add(k);if(!latest.current.seat)startWalk();}};
 const keyup=(e:KeyboardEvent)=>keys.delete(e.key.toLowerCase());const blur=()=>{keys.clear();velocity.set(0,0);};
 const wheel=(e:WheelEvent)=>{if(latest.current.blocked)return;e.preventDefault();distance=T.MathUtils.clamp(distance+e.deltaY*.004,1.8,6);};
 renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',up);renderer.domElement.addEventListener('wheel',wheel,{passive:false});window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
 const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);};const observer=new ResizeObserver(resize);observer.observe(el);resize();
 let id=0,last=performance.now(),fpsAt=last,count=0,previousSettings=props.cameraSettings;
 function frame(t:number){id=requestAnimationFrame(frame);if(!latest.current.highRefresh&&t-last<1000/60-.5)return;const dt=Math.min((t-last)/1000,.08);last=t;elapsed+=dt;const p=latest.current,cfg=p.cameraSettings??defaultCamera,blend=1-Math.exp(-dt*(p.reducedMotion?20:cfg.damping));
  const dpr=p.quality==='Ultra'?Math.min(devicePixelRatio,2):p.lite?1:Math.min(devicePixelRatio,p.isTouch?1.25:1.5);renderer.shadowMap.enabled=!p.lite;if(dpr!==lastDpr){renderer.setPixelRatio(dpr);lastDpr=dpr;resize();}const fov=p.zoom&&p.seat?40:cfg.fov;if(fov!==lastFov){camera.fov=fov;camera.updateProjectionMatrix();lastFov=fov;}
  if(previousSettings!==p.cameraSettings){distance=cfg.distance;pitch=cfg.pitch;yaw=cfg.yaw;previousSettings=p.cameraSettings;}
  if(p.name!==lastName){lastName=p.name??'Guest';nctx.clearRect(0,0,256,64);nctx.fillStyle='rgba(0,0,0,0.4)';nctx.beginPath();nctx.roundRect(32,16,192,32,16);nctx.fill();nctx.fillStyle='rgba(255,255,255,0.85)';nctx.font='600 13px "Inter", sans-serif';nctx.textAlign='center';nctx.textBaseline='middle';nctx.letterSpacing='2px';nctx.fillText(lastName.toUpperCase(),128,32);nameTex.needsUpdate=true;}
  nameMat.opacity=T.MathUtils.lerp(nameMat.opacity,p.seat?0:1,blend);
  avatar.jacket.color.set(p.jacket??'#d6cdb4');
  if(p.reset!==lastReset){lastReset=p.reset;overview=true;player.set(6.45,.32,5.9);yaw=0;pitch=cfg.pitch;distance=cfg.distance;velocity.set(0,0);}
  if(p.walk!==lastWalk){lastWalk=p.walk;startWalk();}
  if(p.seat!==lastSeat){if(p.seat){overview=false;velocity.set(0,0);yaw=0;pitch=0;}else if(lastSeat){const s=seats.find(s=>s.id===lastSeat)!;player.copy(s.interactionPoint);player.z-=.12;overview=false;pitch=cfg.pitch;}lastSeat=p.seat;}
  if(p.destination&&p.destination.request!==destinationRequest){destinationRequest=p.destination.request;const dest=seats.find(s=>s.id===p.destination!.id)??{id:'CANTEEN',interactionPoint:new T.Vector3(1,THEATRE_CONFIG.riserHeight,12.8)};const side=player.x<0?-6.75:6.75;const currentLane=player.z>3?2.7:-.75;route=[new T.Vector3(side,0,player.z),new T.Vector3(side,0,dest.interactionPoint.z),dest.interactionPoint.clone()];routeSeat=dest.id;startWalk();}else if(!p.destination&&routeSeat){route=[];routeSeat=null;}
  if(p.service&&p.service!==lastService){lastService=p.service;serviceStarted=t;server.root.visible=true;p.onServiceState?.('Server on the way');}
  if(serviceStarted){const ss=seats.find(s=>s.id===p.seat);const elapsedService=(t-serviceStarted)/1000;const sx=ss?.position.x??player.x,sz=ss?.position.z??player.z;const progress=Math.min(elapsedService/4,1);server.root.position.set(6.7+(sx+.95-6.7)*progress,floorHeight(sz,6.7),8+(sz-8)*progress);server.arms[0].rotation.x=-1;if(elapsedService>6){server.root.visible=false;serviceStarted=0;p.onServiceState?.('Enjoying your order - Popcorn & drink');if(ss){snacks.position.set(ss.position.x+.8,ss.position.y+1.07,ss.position.z-.3);snacks.visible=true;}}}
  const selected=seats.find(s=>s.id===p.seat);
  if(selected){avatar.root.position.lerp(selected.sitPosition,blend);avatar.root.rotation.y=0;avatar.legs.forEach(l=>l.rotation.x=T.MathUtils.lerp(l.rotation.x,1.4,blend));avatar.knees.forEach(k=>k.rotation.x=T.MathUtils.lerp(k.rotation.x,-1.4,blend));avatar.arms.forEach(a=>a.rotation.x=-.35);desired.copy(selected.cameraPosition);focus.copy(selected.cameraTarget);focus.x+=Math.sin(yaw)*4;focus.y-=pitch*4;avatar.root.visible=camera.position.distanceTo(selected.cameraPosition)>.8;}
  else{avatar.root.visible=true;avatar.knees.forEach(k=>k.rotation.x=T.MathUtils.lerp(k.rotation.x,0,blend));const joy=p.moveRef?.current;let x=p.blocked?0:(keys.has('d')?1:0)-(keys.has('a')?1:0)+(joy?.x??0),z=p.blocked?0:(keys.has('s')?1:0)-(keys.has('w')?1:0)+(joy?.y??0);const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}if(len>.05)startWalk();const vx=(x*Math.cos(yaw)+z*Math.sin(yaw))*2.65,vz=(-x*Math.sin(yaw)+z*Math.cos(yaw))*2.65;velocity.x=T.MathUtils.lerp(velocity.x,vx,1-Math.exp(-dt*(len?9:12)));velocity.y=T.MathUtils.lerp(velocity.y,vz,1-Math.exp(-dt*(len?9:12)));
   if(len>.05&&route.length){route=[];routeSeat=null;p.onRouteCancel?.();}
   if(route.length&&!p.blocked){const waypoint=route[0];const dx=waypoint.x-player.x,dz=waypoint.z-player.z,d=Math.hypot(dx,dz);if(d<.09){route.shift();if(!route.length&&routeSeat){if(routeSeat==='CANTEEN'){yaw=Math.PI;p.onRouteCancel?.();}else p.onSeat?.(routeSeat);routeSeat=null;}}else velocity.set(dx/d*2.6,dz/d*2.6);}
   const nx=T.MathUtils.clamp(player.x+velocity.x*dt,-7.05,7.05),nz=T.MathUtils.clamp(player.z+velocity.y*dt,-5.5,16.4);if(!blocked(nx,player.z))player.x=nx;const riserZ=seats[5].position.z-2.1;const crossesRiser=Math.abs(player.x)<5.85&&((player.z<riserZ&&nz>=riserZ)||(player.z>=riserZ&&nz<riserZ));if(!blocked(player.x,nz)&&!crossesRiser)player.z=nz;player.y=floorHeight(player.z,player.x);avatar.root.position.copy(player);
   const speed=velocity.length();if(speed>.1){const targetAngle=Math.atan2(-velocity.x,-velocity.y);avatar.root.rotation.y+=Math.atan2(Math.sin(targetAngle-avatar.root.rotation.y),Math.cos(targetAngle-avatar.root.rotation.y))*blend;}
   avatar.arms.forEach((a,i)=>a.rotation.x=Math.sin(elapsed*8+i*Math.PI)*Math.min(speed*.25,.6));avatar.legs.forEach((l,i)=>l.rotation.x=Math.sin(elapsed*8+i*Math.PI+Math.PI)*Math.min(speed*.22,.55));
   let nearest:string|null=null,best=1.3;for(const s of seats){const d=player.distanceTo(s.interactionPoint);if(d<best){best=d;nearest=s.id;}}if(nearest!==lastNearby){lastNearby=nearest;p.onNearbySeat?.(nearest);}
   if(overview){desired.set(cfg.heroX,cfg.heroY,cfg.heroZ);focus.set(cfg.targetX,cfg.targetY,cfg.targetZ);}else{focus.copy(player);focus.y+=cfg.targetHeight;desired.copy(focus);desired.x+=Math.sin(yaw)*distance+Math.cos(yaw)*cfg.sideOffset;desired.z+=Math.cos(yaw)*distance-Math.sin(yaw)*cfg.sideOffset;desired.y+=cfg.height+Math.sin(pitch)*distance;direction.copy(desired).sub(focus);const max=direction.length();orbitRay.set(focus,direction.normalize());orbitRay.far=max;const hits=orbitRay.intersectObjects([...room.collision,...room.chairs],true);if(hits.length&&hits[0].distance<max)desired.copy(focus).addScaledVector(direction,Math.max(.35,hits[0].distance-cfg.collisionDistance));desired.y=Math.max(floorHeight(desired.z,desired.x)+.5,Math.min(desired.y,5.25));}
  }
  camera.position.lerp(desired,blend);camera.lookAt(focus);
  if(p.video!==video){texture?.dispose();video=p.video??null;texture=video?new T.VideoTexture(video):null;if(texture){texture.colorSpace=T.SRGBColorSpace;texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;}videoMaterial.map=texture;videoMaterial.needsUpdate=true;sampleFailed=false;}
  const lightCfg=(window as any).CINEMA_LIGHTS_CONFIG||{samplingFPS:6,blendWithWhite:.15,minLuminance:.02,intensityMul:30,attack:6.0,release:2.5};
  const ready=!!video&&video.readyState>=2&&video.videoWidth>0;videoMesh.visible=ready;if(ready&&video){const ratio=video.videoWidth/video.videoHeight,screenRatio=SCREEN.width/SCREEN.height;videoMesh.scale.set(ratio<screenRatio?ratio/screenRatio:1,ratio>screenRatio?screenRatio/ratio:1,1);(room.screen.material as T.MeshBasicMaterial).map=null;(room.screen.material as T.MeshBasicMaterial).color.set('#000');if(context&&!sampleFailed&&t-sampled>1000/lightCfg.samplingFPS){sampled=t;try{context.drawImage(video,0,0,24,14);const data=context.getImageData(0,0,24,14).data;
   let rL=0,gL=0,bL=0,cL=0, rC=0,gC=0,bC=0,cC=0, rR=0,gR=0,bR=0,cR=0;
   for(let y=0;y<14;y++){for(let x=0;x<24;x++){const i=(y*24+x)*4, r=data[i],g=data[i+1],b=data[i+2], lum=(0.299*r+0.587*g+0.114*b)/255;
    if(lum<lightCfg.minLuminance)continue; const w=0.1+lum;
    if(x<8){rL+=r*w;gL+=g*w;bL+=b*w;cL+=w;}else if(x<16){rC+=r*w;gC+=g*w;bC+=b*w;cC+=w;}else{rR+=r*w;gR+=g*w;bR+=b*w;cR+=w;}
   }}
   const blend=lightCfg.blendWithWhite;
   const setZone=(tc:T.Color, sums:[number,number,number,number])=>{
    if(sums[3]>0.01){
     const r=sums[0]/sums[3]/255, g=sums[1]/sums[3]/255, b=sums[2]/sums[3]/255;
     const lum = 0.299*r + 0.587*g + 0.114*b;
     tc.setRGB(r*(1-blend)+lum*blend, g*(1-blend)+lum*blend, b*(1-blend)+lum*blend, T.SRGBColorSpace);
     return Math.min(1.0, lum);
    } else {tc.setRGB(0,0,0); return 0;}
   };
   const lumL=setZone(tL,[rL,gL,bL,cL]), lumC=setZone(tC,[rC,gC,bC,cC]), lumR=setZone(tR,[rR,gR,bR,cR]);
   iL = lumL < 0.05 ? lumL*2 : (0.1 + (lumL-0.05)*1.2);
   iC = lumC < 0.05 ? lumC*2 : (0.1 + (lumC-0.05)*1.2);
   iR = lumR < 0.05 ? lumR*2 : (0.1 + (lumR-0.05)*1.2);
   iL=Math.min(1.0, iL)*lightCfg.intensityMul; iC=Math.min(1.0, iC)*lightCfg.intensityMul; iR=Math.min(1.0, iR)*lightCfg.intensityMul;
  }catch{sampleFailed=true;}}}else{(room.screen.material as T.MeshBasicMaterial).map=room.welcome;(room.screen.material as T.MeshBasicMaterial).color.set('#fff');}
  if(previousMap!==(room.screen.material as T.MeshBasicMaterial).map){previousMap=(room.screen.material as T.MeshBasicMaterial).map;(room.screen.material as T.MeshBasicMaterial).needsUpdate=true;}
  const dark=!!selected&&ready&&!video!.paused;const lb=1-Math.exp(-dt*2);room.glow.color.lerp(new T.Color(dark?"#423823":"#e3c88a"),lb);room.hemi.intensity=T.MathUtils.lerp(room.hemi.intensity,dark?.075:1.05,lb);room.key.intensity=T.MathUtils.lerp(room.key.intensity,dark?.04:1.9,lb);room.lamps.forEach(l=>l.intensity=T.MathUtils.lerp(l.intensity,dark?.18:7,lb));
  if(dark){
   const rL=room.leftSpill,rC=room.centerSpill,rR=room.rightSpill;
   rL.color.lerp(tL, 1-Math.exp(-dt*(iL>rL.intensity?lightCfg.attack:lightCfg.release))); rL.intensity=T.MathUtils.lerp(rL.intensity,iL,1-Math.exp(-dt*(iL>rL.intensity?lightCfg.attack:lightCfg.release)));
   rC.color.lerp(tC, 1-Math.exp(-dt*(iC>rC.intensity?lightCfg.attack:lightCfg.release))); rC.intensity=T.MathUtils.lerp(rC.intensity,iC,1-Math.exp(-dt*(iC>rC.intensity?lightCfg.attack:lightCfg.release)));
   rR.color.lerp(tR, 1-Math.exp(-dt*(iR>rR.intensity?lightCfg.attack:lightCfg.release))); rR.intensity=T.MathUtils.lerp(rR.intensity,iR,1-Math.exp(-dt*(iR>rR.intensity?lightCfg.attack:lightCfg.release)));
  } else {
   const rL=room.leftSpill,rC=room.centerSpill,rR=room.rightSpill;
   rL.intensity=T.MathUtils.lerp(rL.intensity,0,lb); rC.intensity=T.MathUtils.lerp(rC.intensity,0,lb); rR.intensity=T.MathUtils.lerp(rR.intensity,0,lb);
  }
  renderer.render(scene,camera);count++;if(t-fpsAt>1000){p.onFps?.(Math.round(count*1000/(t-fpsAt)));count=0;fpsAt=t;}
 }
 id=requestAnimationFrame(frame);
 return()=>{cancelAnimationFrame(id);observer.disconnect();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointermove',move);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('pointercancel',up);renderer.domElement.removeEventListener('wheel',wheel);const gs=new Set<T.BufferGeometry>(),ms=new Set<T.Material>(),ts=new Set<T.Texture>();scene.traverse(o=>{if(o instanceof T.Mesh){gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){ms.add(m);if('map'in m&&m.map)ts.add(m.map as T.Texture);}}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.add(room.welcome);if(texture)ts.add(texture);ts.forEach(tx=>tx.dispose());renderer.dispose();renderer.domElement.remove();};
 },[]);
 return <div className="three-host cinema-viewport" ref={host} aria-label="Interactive 3D cinema. WASD to walk, drag to orbit, approach a chair and press E to sit."/>;
}
