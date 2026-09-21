import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ROOM={width:15.6,depth:15.2,height:5.6,front:-5.2,back:10};
export const SCREEN={width:8.8,height:8.8*9/16,y:3.0,z:-4.85};
// Dimensions estimated from supplied footage, in avatar-relative world units.
SCREEN.height=SCREEN.width*9/16;
SCREEN.y=3.0;

const W = 1.95;
export const THEATRE_CONFIG = {
 seatWidth:W,seatDepth:1.10*W,seatGapX:.25*W,rowPitch:2.25*W,
 riserHeight:.42*W,stairsPerRiser:4,stairRise:.42*W/4,stairDepth:.19*W,
 sideAisleWidth:.85*W,mainAisleWidth:1.10*W,seatCenterSpacingX:1.25*W
};
const NUM_SEATS_PER_ROW=5,NUM_ROWS=2;
const TOTAL_ROW_WIDTH=NUM_SEATS_PER_ROW*W+(NUM_SEATS_PER_ROW-1)*THEATRE_CONFIG.seatGapX;
const START_X=-TOTAL_ROW_WIDTH/2+W/2;
const Z_OFFSET=1;

export type SeatData={id:string;position:T.Vector3;rotation:number;interactionPoint:T.Vector3;sitPosition:T.Vector3;sitRotation:number;cameraPosition:T.Vector3;cameraTarget:T.Vector3;occupancyState:'free'|'occupied'};

export const seats: SeatData[] = Array.from({ length: NUM_SEATS_PER_ROW * NUM_ROWS }, (_, i) => {
  const row = Math.floor(i / NUM_SEATS_PER_ROW);
  const col = i % NUM_SEATS_PER_ROW;
  
  const x=START_X+col*(THEATRE_CONFIG.seatWidth+THEATRE_CONFIG.seatGapX);
  const y = row * THEATRE_CONFIG.riserHeight;
  const z = Z_OFFSET + row * THEATRE_CONFIG.rowPitch;
  return {
    id: `${String.fromCharCode(65 + row)}${col + 1}`,
    position: new T.Vector3(x, y, z),
    rotation: 0,
    interactionPoint: new T.Vector3(x, y, z - 1.72),
    sitPosition: new T.Vector3(x, y - 0.15, z + 0.16),
    sitRotation: 0,
    cameraPosition: new T.Vector3(x, y + 1.53, z + 0.05),
    cameraTarget: new T.Vector3(0, 3.05, -4.9),
    occupancyState: 'free'
  };
});

export function floorHeight(z: number, x = 6.7) {
  for (let row = NUM_ROWS - 1; row >= 1; row--) {
    const p_start = Z_OFFSET + row * THEATRE_CONFIG.rowPitch - 2.1;
    const p_stairs_start = p_start - THEATRE_CONFIG.stairsPerRiser * THEATRE_CONFIG.stairDepth;
    const p_stairs_end = p_start;
    
    if (z >= p_stairs_end) return row * THEATRE_CONFIG.riserHeight;
    if (z >= p_stairs_start) {
      const isCenterAisle = false;
      const isSideAisle = Math.abs(x) >= TOTAL_ROW_WIDTH / 2;
      if (isCenterAisle || isSideAisle) {
        const progress = (z - p_stairs_start) / (p_stairs_end - p_stairs_start);
        return (row - 1) * THEATRE_CONFIG.riserHeight + progress * THEATRE_CONFIG.riserHeight;
      } else {
        return (row - 1) * THEATRE_CONFIG.riserHeight;
      }
    }
  }
  return 0;
}

export function buildCinema(scene:T.Scene){
  const materials:T.Material[]=[];const geometries=new Map<string,T.BufferGeometry>();
  const mat=(color:string,roughness=.7,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});materials.push(m);return m;};
  const wall=mat('#322b25'),panel=mat('#383129'),trim=mat('#181714'),bronze=mat('#967044',.43,.65),red=mat('#84313d',.48),redLight=mat('#a34851',.5),base=mat('#111311'),floor=mat('#282522',.95),leaf=mat('#354832',.9);
  const glow=new T.MeshBasicMaterial({color:'#e3c88a'});materials.push(glow);
  function box(parent:T.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,m:T.Material,r=0){const key=[w,h,d,r].join('/');let geo=geometries.get(key);if(!geo){geo=r?new RoundedBoxGeometry(w,h,d,3,r):new T.BoxGeometry(w,h,d);geometries.set(key,geo);}const mesh=new T.Mesh(geo,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  const collision:T.Object3D[]=[];
  
  box(scene,15.6,.2,18,0,-.1,1,floor);

  for (let row = 1; row < NUM_ROWS; row++) {
    const p_start = Z_OFFSET + row * THEATRE_CONFIG.rowPitch - 2.1;
    const p_stairs_start = p_start - THEATRE_CONFIG.stairsPerRiser * THEATRE_CONFIG.stairDepth;
    const p_stairs_end = p_start;
    const depth = ROOM.back - p_start;
    const y_center = (row * THEATRE_CONFIG.riserHeight) / 2;
    
    collision.push(box(scene,TOTAL_ROW_WIDTH,row*THEATRE_CONFIG.riserHeight,depth,0,y_center,p_start+depth/2,floor));
    box(scene,TOTAL_ROW_WIDTH,.025,.04,0,row*THEATRE_CONFIG.riserHeight+.0125,p_start+.02,bronze);
    const sideDepth=ROOM.back-p_stairs_end;
    const sideCenterX=TOTAL_ROW_WIDTH/2+THEATRE_CONFIG.sideAisleWidth/2;
    for (const side of [-1, 1]) {
      collision.push(box(scene, THEATRE_CONFIG.sideAisleWidth, row * THEATRE_CONFIG.riserHeight, sideDepth, side * sideCenterX, y_center, p_stairs_end + sideDepth / 2, floor));
      
      for (let s = 0; s < THEATRE_CONFIG.stairsPerRiser; s++) {
        const stairY = (row - 1) * THEATRE_CONFIG.riserHeight + (s + 1) * THEATRE_CONFIG.stairRise;
        const stairZ = p_stairs_start + s * THEATRE_CONFIG.stairDepth + THEATRE_CONFIG.stairDepth / 2;
        collision.push(box(scene, THEATRE_CONFIG.sideAisleWidth, stairY, THEATRE_CONFIG.stairDepth, side * sideCenterX, stairY / 2, stairZ, floor));
        box(scene, THEATRE_CONFIG.sideAisleWidth, 0.025, 0.04, side * sideCenterX, stairY + 0.0125, stairZ - THEATRE_CONFIG.stairDepth / 2 + 0.02, bronze);
      }
    }
  }

  collision.push(box(scene,15.6,5.6,.25,0,2.8,-5.2,wall),box(scene,13.35,5.6,.25,-1.125,2.8,10,wall),box(scene,2.25,2.6,.25,6.675,4.3,10,wall));
  const exitC=document.createElement('canvas');exitC.width=256;exitC.height=128;const ex=exitC.getContext('2d')!;ex.fillStyle='#0a0808';ex.fillRect(0,0,256,128);ex.fillStyle='#cc3333';ex.font='bold 48px Arial, sans-serif';ex.textAlign='center';ex.textBaseline='middle';ex.fillText('EXIT',128,64);const exT=new T.CanvasTexture(exitC);exT.colorSpace=T.SRGBColorSpace;const exMesh=new T.Mesh(new T.PlaneGeometry(1.0,.5),new T.MeshBasicMaterial({map:exT}));exMesh.position.set(6.675,3.3,9.87);exMesh.rotation.y=Math.PI;scene.add(exMesh);
  for(const s of [-1,1]){
    collision.push(box(scene,.25,5.6,18,s*7.8,2.8,1,wall));
    for(const z of [-5.4,-1.7,2,5.7,9.1]){
      box(scene,.07,4.45,2.95,s*7.64,2.8,z,panel);
      for(const dz of [-1.49,1.49])box(scene,.12,4.52,.055,s*7.56,2.8,z+dz,trim);
      for(const y of [.54,5.06])box(scene,.12,.055,3.05,s*7.56,y,z,trim);
      for(const dz of [-.14,0,.14])box(scene,.18,4.65,.04,s*7.49,2.8,z+1.73+dz,bronze);
      box(scene,.16,.96,.18,s*7.44,2.75,z+1.68,base);
      box(scene,.19,.59,.09,s*7.32,2.8,z+1.68,glow);
    }
    box(scene,.05,.045,17.5,s*7.5,.37,1,bronze);
    for(const z of [-2.4,5.7]){
      const art=new T.Group();art.position.set(s*7.43,2.7,z);art.rotation.y=-s*Math.PI/2;scene.add(art);
      box(art,1.25,1.8,.08,0,0,0,bronze);box(art,1.16,1.71,.1,0,0,.02,base);
      const cv=document.createElement('canvas');cv.width=256;cv.height=384;const cx=cv.getContext('2d')!;cx.fillStyle='#203030';cx.fillRect(0,0,256,384);cx.fillStyle='#bc9a72';cx.beginPath();cx.arc(128,130,55,0,Math.PI*2);cx.fill();cx.fillStyle='#172123';cx.beginPath();cx.moveTo(0,230);cx.lineTo(95,120);cx.lineTo(256,270);cx.lineTo(256,384);cx.lineTo(0,384);cx.fill();cx.fillStyle='#d3c4a7';cx.textAlign='center';cx.font='18px Georgia';cx.fillText('THE QUIET HOURS',128,310);const tx=new T.CanvasTexture(cv);tx.colorSpace=T.SRGBColorSpace;const am=new T.MeshStandardMaterial({map:tx,roughness:.9});materials.push(am);const ap=new T.Mesh(new T.PlaneGeometry(1.08,1.63),am);ap.position.z=.08;art.add(ap);
    }
  }
  
  box(scene,15.6,.22,18,0,5.65,1,base);
  for(const s of [-1,1]){box(scene,.7,.25,18,s*7.15,5.36,1,panel);box(scene,.035,.035,17,s*6.8,5.22,1,bronze);}
  for(const z of [-6.8,3,8.8]){box(scene,14.3,.22,.45,0,5.32,z,trim);box(scene,13.6,.04,.025,0,5.19,z-.2,bronze);}
  
  box(scene,9.35,5.3,.16,0,3,-5.1,base,.035);
  box(scene,9.08,5.14,.04,0,3,-4.99,bronze);
  box(scene,8.98,5.04,.08,0,3,-4.96,base);
  box(scene,7.3,.3,.65,0,.18,-4.38,panel,.035);
  for(let x=-3.5;x<3.7;x+=1.18)box(scene,.018,.27,.015,x,.2,-4.04,bronze);
  const cv=document.createElement('canvas');cv.width=1600;cv.height=900;const cx=cv.getContext('2d')!;
  const gradient=cx.createLinearGradient(0,0,0,900);gradient.addColorStop(0,'#253b43');gradient.addColorStop(.6,'#718176');gradient.addColorStop(1,'#172a2c');cx.fillStyle=gradient;cx.fillRect(0,0,1600,900);
  for(let layer=0;layer<5;layer++){cx.fillStyle=['#586d69','#435e5d','#304b4e','#203c41','#132a30'][layer];cx.beginPath();cx.moveTo(0,900);for(let x=0;x<=1600;x+=40)cx.lineTo(x,370+layer*85+Math.sin(x*.008+layer*2)*100+Math.cos(x*.021+layer)*36);cx.lineTo(1600,900);cx.fill();}
  cx.fillStyle='#efe8d7';cx.font='600 12px Arial';cx.fillText('DARLING CINEMAS ORIGINAL',100,380);cx.font='bold 76px Georgia';cx.fillText('THE QUIET HOURS',95,450);cx.font='18px Arial';cx.fillText('There is a world beyond the window.',100,490);
  const welcome=new T.CanvasTexture(cv);welcome.colorSpace=T.SRGBColorSpace;
  const screen=new T.Mesh(new T.PlaneGeometry(SCREEN.width,SCREEN.height),new T.MeshBasicMaterial({map:welcome,toneMapped:false}));screen.position.set(0,SCREEN.y,SCREEN.z);scene.add(screen);
  for(const s of [-1,1]){
    const speaker=new T.Group();speaker.position.set(s*6.1,0,-4.15);scene.add(speaker);box(speaker,.75,2.15,.62,0,1.075,0,base,.025);
    for(const [y,r] of [[.47,.23],[1.12,.22],[1.73,.13]]){const ring=new T.Mesh(new T.CylinderGeometry(r,r,.035,24),trim);ring.rotation.x=Math.PI/2;ring.position.set(0,y,.325);speaker.add(ring);const cone=new T.Mesh(new T.SphereGeometry(r*.65,16,8),base);cone.scale.z=.2;cone.position.set(0,y,.355);speaker.add(cone);}
    const plant=new T.Group();plant.position.set(s*7.03,0,-3.4);scene.add(plant);const pot=new T.Mesh(new T.CylinderGeometry(.31,.23,.58,16),trim);pot.position.y=.29;plant.add(pot);
    for(let i=0;i<13;i++){const angle=i*2.4,h=.8+(i%5)*.25;const stem=new T.Mesh(new T.CylinderGeometry(.016,.022,h,5),leaf);stem.position.set(Math.sin(angle)*.13,.5+h/2,Math.cos(angle)*.13);plant.add(stem);const l=new T.Mesh(new T.SphereGeometry(1,8,5),leaf);l.scale.set(.1,.48,.06);l.position.set(Math.sin(angle)*.3,h+.47,Math.cos(angle)*.3);l.rotation.set(Math.cos(angle)*.5,angle,Math.sin(angle)*.65);plant.add(l);}
  }
  const chairs:T.Group[]=[];
  for(const seat of seats){const c=new T.Group();c.position.copy(seat.position);c.userData.seat=seat.id;c.scale.y=.85;scene.add(c);chairs.push(c);
    box(c,1.89,.16,1.98,0,.12,0,base,.055);box(c,1.82,.28,1.82,0,.33,0,red,.095);
    box(c,1.23,.23,1.23,0,.58,-.15,redLight,.085);
    const back=box(c,1.4,1.65,.34,0,1.28,.64,red,.13);back.rotation.x=-.07;
    box(c,1.17,.46,.14,0,1.8,.41,redLight,.08);box(c,1.18,.72,.1,0,1.17,.4,red,.06);
    for(const s of [-1,1]){box(c,.3,.6,1.74,s*.8,.6,-.02,red,.11);box(c,.35,.19,1.62,s*.8,.94,-.07,redLight,.085);const ring=new T.Mesh(new T.CylinderGeometry(.105,.105,.022,20),bronze);ring.position.set(s*.8,1.046,-.52);c.add(ring);const well=new T.Mesh(new T.CylinderGeometry(.079,.079,.025,20),base);well.position.set(s*.8,1.048,-.52);c.add(well);}
    box(c,1.2,.17,.56,0,.32,-1.1,redLight,.065);box(c,.16,.14,.022,0,1.07,.842,bronze,.014);box(c,.06,.055,.025,0,1.07,.86,base);
  }
  // Deepened cinematic lighting by reducing intensities
  const hemi=new T.HemisphereLight('#ddd8c9','#31251b',1.05);scene.add(hemi);
  const key=new T.DirectionalLight('#fff0d7',1.9);key.position.set(0,5,3);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-9;key.shadow.camera.right=9;key.shadow.camera.top=10;key.shadow.camera.bottom=-10;key.shadow.bias=-.001;scene.add(key);
  const lamps:T.PointLight[]=[];for(const s of [-1,1])for(const z of [-3.72,3.68,7.38]){const l=new T.PointLight('#ffcf8a',7,6,2);l.position.set(s*6.9,3,z);scene.add(l);lamps.push(l);}
  const leftSpill=new T.PointLight('#000000',0,12,2);leftSpill.position.set(-3.5,2.5,-3.5);scene.add(leftSpill);
  const centerSpill=new T.PointLight('#000000',0,16,2);centerSpill.position.set(0,2.5,-3.0);scene.add(centerSpill);
  const rightSpill=new T.PointLight('#000000',0,12,2);rightSpill.position.set(3.5,2.5,-3.5);scene.add(rightSpill);
  // Walkable rear canteen, reconstructed from recording 152-158 seconds.
  const loungeFloor=(NUM_ROWS - 1) * THEATRE_CONFIG.riserHeight;
  const tan=mat('#76604c'),counter=mat('#30271f'),bottle=mat('#304638',.3),cream=mat('#d6c6a0');
  box(scene,15.6,.3,7,0,loungeFloor-.15,13.5,floor);
  collision.push(box(scene,15.6,5.6,.25,0,2.8,17, tan));
  for(const side of [-1,1])collision.push(box(scene,.25,5.6,7,side*7.8,2.8,13.5,tan));
  box(scene,15.6,.2,7,0,5.6,13.5,base);
  const bannerTex=new T.TextureLoader().load('/darling-banner.jpg');bannerTex.colorSpace=T.SRGBColorSpace;
  const promoGroup=new T.Group();promoGroup.position.set(-1.125,2.95,10.126);scene.add(promoGroup);
  box(promoGroup,8.2,4.7,.1,0,0,-.05,trim);
  box(promoGroup,8.2,.1,.15,0,2.3,0,bronze);box(promoGroup,8.2,.1,.15,0,-2.3,0,bronze);
  box(promoGroup,.1,4.5,.15,-4.05,0,0,bronze);box(promoGroup,.1,4.5,.15,4.05,0,0,bronze);
  const banner=new T.Mesh(new T.PlaneGeometry(8.0,4.5),new T.MeshBasicMaterial({map:bannerTex}));banner.position.set(0,0,.01);promoGroup.add(banner);
  const loungeLamp=new T.PointLight('#ffdda9',35,12,2);loungeLamp.position.set(0,4.5,13);scene.add(loungeLamp);
  const counterGroup=new T.Group();counterGroup.position.set(1,loungeFloor,14.5);scene.add(counterGroup);
  box(counterGroup,6.2,1.15,1,0,.575,0,counter);box(counterGroup,6.45,.14,1.25,0,1.21,0,base,.03);
  for(let x=-3;x<=3;x+=.14)box(counterGroup,.055,1.1,.035,x,.59,-.52,bronze);
  for(const x of [-1.9,1.9])for(const y of [1.3,2.1,2.9]){box(scene,1.6,.07,.36,x+1,y+loungeFloor,16.5,base);for(let i=0;i<4;i++){const b=new T.Mesh(new T.CylinderGeometry(.055,.07,.28,8),bottle);b.position.set(x+.45+i*.27,y+loungeFloor+.17,16.5);scene.add(b);}}
  const menuTex=new T.TextureLoader().load('/menu-card.jpg');menuTex.colorSpace=T.SRGBColorSpace;
  const menuGroup=new T.Group();menuGroup.position.set(1,3.0,16.87);menuGroup.rotation.y=Math.PI;scene.add(menuGroup);
  box(menuGroup,2.0,2.7,.1,0,0,-.05,trim);
  box(menuGroup,2.0,.1,.15,0,1.3,0,bronze);box(menuGroup,2.0,.1,.15,0,-1.3,0,bronze);
  box(menuGroup,.1,2.5,.15,-.95,0,0,bronze);box(menuGroup,.1,2.5,.15,.95,0,0,bronze);
  const menu=new T.Mesh(new T.PlaneGeometry(1.8,2.5),new T.MeshBasicMaterial({map:menuTex}));
  menu.position.set(0,0,.01);menuGroup.add(menu);
  for(const x of [-5,-2.8]){const table=new T.Mesh(new T.CylinderGeometry(.65,.65,.1,24),counter);table.position.set(x,loungeFloor+.95,11.8);scene.add(table);box(scene,.1,.85,.1,x,loungeFloor+.45,11.8,base);for(const dz of [-.95,.95]){box(scene,.65,.1,.65,x,loungeFloor+.58,11.8+dz,red,.03);for(const dx of [-.24,.24])box(scene,.06,.55,.06,x+dx,loungeFloor+.3,11.8+dz,base);}}
  for(const x of [-.8,1,2.8]){box(scene,.6,.12,.6,x,loungeFloor+.65,13.3,red,.04);box(scene,.1,.6,.1,x,loungeFloor+.3,13.3,base);}
  for(const x of [-1.5, -0.2, 1.2, 2.5]){const snack=createSnacks();snack.position.set(x,loungeFloor+1.31,14.4);scene.add(snack);}
  const waiter1=createAvatar('#3b3530');waiter1.root.position.set(-0.5,loungeFloor,15.6);waiter1.root.rotation.y=Math.PI;scene.add(waiter1.root);
  const waiter2=createAvatar('#3b3530');waiter2.root.position.set(2.5,loungeFloor,15.6);waiter2.root.rotation.y=Math.PI;scene.add(waiter2.root);
  return{screen,welcome,chairs,collision,hemi,key,lamps,leftSpill,centerSpill,rightSpill,glow};
}

export function createAvatar(color='#d6cdb4', gender='Male'){
  const root=new T.Group();const jacket=new T.MeshStandardMaterial({color,roughness:.85}),skin=new T.MeshStandardMaterial({color:'#c99e74',roughness:.8}),pants=new T.MeshStandardMaterial({color:'#29302d'}),hair=new T.MeshStandardMaterial({color:'#2b201b'});
  function part(parent:T.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,m:T.Material,r=.025){const mesh=new T.Mesh(new RoundedBoxGeometry(w,h,d,2,r),m);mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;}
  part(root,.55,.67,.29,0,1.12,0,jacket);part(root,.42,.42,.38,0,1.69,0,skin,.04);
  part(root,.44,.16,.4,0,1.9,.015,hair,.025);
  if(gender==='Female')part(root,.46,.55,.2,0,1.6,.18,hair);else part(root,.44,.24,.12,0,1.74,.16,hair);
  for(const s of [-1,1])part(root,.027,.027,.012,s*.09,1.72,-.195,hair,.002);part(root,.055,.06,.04,0,1.64,-.202,skin,.008);
  const arms:T.Group[]=[],legs:T.Group[]=[],knees:T.Group[]=[];
  for(const s of [-1,1]){const arm=new T.Group();arm.position.set(s*.365,1.41,0);part(arm,.17,.5,.2,0,-.23,0,jacket);part(arm,.15,.16,.18,0,-.55,0,skin);root.add(arm);arms.push(arm);const leg=new T.Group();leg.position.set(s*.145,.8,0);part(leg,.22,.34,.25,0,-.17,0,pants);const knee=new T.Group();knee.position.y=-.34;part(knee,.21,.35,.24,0,-.175,0,pants);part(knee,.24,.1,.37,0,-.38,-.06,hair);leg.add(knee);knees.push(knee);root.add(leg);legs.push(leg);}
  return{root,jacket,arms,legs,knees};
}

export function createSnacks(){const group=new T.Group();const red=new T.MeshStandardMaterial({color:'#86323c'}),white=new T.MeshStandardMaterial({color:'#e8d7ad'});const tub=new T.Mesh(new T.CylinderGeometry(.18,.13,.3,12),red);tub.position.y=.15;group.add(tub);for(let i=0;i<18;i++){const kernel=new T.Mesh(new T.IcosahedronGeometry(.06,0),white);kernel.position.set(Math.sin(i*2.4)*.13,.3+Math.floor(i/7)*.04,Math.cos(i*2.4)*.13);group.add(kernel);}const drink=new T.Mesh(new T.CylinderGeometry(.09,.07,.3,12),red);drink.position.set(.36,.15,0);group.add(drink);const straw=new T.Mesh(new T.CylinderGeometry(.009,.009,.25,5),white);straw.position.set(.36,.36,0);group.add(straw);return group;}
