"use client";
import {useEffect,useRef,useState} from 'react';
import Theatre,{defaultCamera, REFERENCE_GEOMETRY_VIEW, type CameraSettings} from './theatre';
import {seats,THEATRE_CONFIG} from './cinema-scene';
import {Armchair,Film,Users,Maximize,Play,Pause,Volume2,VolumeX,Upload,Repeat,X,ArrowLeft,MessageSquare,Send,Search,RefreshCcw,Monitor,LayoutGrid,Gauge,UserRound,Focus,Bell,Footprints} from 'lucide-react';
import {useLocalVideo} from '../hooks/use-local-video';
import {useMobile} from '../hooks/use-mobile';
import {useAutoHide} from '../hooks/use-auto-hide';
import {MobileJoystick} from '../components/mobile-joystick';
import {sessionManager} from '../lib/auth/sessionManager';
import {darlingStorage} from '../lib/storage/darlingStorage';
type Panel='player'|'profile'|'experience'|'seats'|'settings'|'party'|'entry'|null;
const jackets=[['Sand','#d6cdb4'],['Burgundy','#803747'],['Sage','#87937b'],['Slate','#687781'],['Lilac','#a797af']];
const time=(v:number)=>{if(!Number.isFinite(v))return '0:00';const s=Math.floor(v);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export default function Home(){
 const media=useLocalVideo(),{isTouch}=useMobile();const [seat,setSeat]=useState<string|null>(null),[nearby,setNearby]=useState<string|null>(null),[panel,setPanel]=useState<Panel>(null),[selection,setSelection]=useState('B3'),[walking,setWalking]=useState(false),[walk,setWalk]=useState(0),[reset,setReset]=useState(0),[zoom,setZoom]=useState(false),[fps,setFps]=useState<number|null>(null),[quality,setQuality]=useState<'Performance'|'Adaptive'|'Ultra'>('Performance'),[reduced,setReduced]=useState(false),[highRefresh,setHighRefresh]=useState(false),[name,setName]=useState('Guest'),[jacket,setJacket]=useState(jackets[0][1]),[gender,setGender]=useState('Male'),[appState,setAppState]=useState<'BOOT'|'RESTORING_PROFILE'|'ONBOARDING'|'RETURNING_USER'|'THEATRE_LOADING'|'EXPLORING'>('BOOT'),[pwd,setPwd]=useState(''),[confirmPwd,setConfirmPwd]=useState(''),[route,setRoute]=useState<{id:string;request:number}|null>(null),[service,setService]=useState(0),[serviceState,setServiceState]=useState(''),[notice,setNotice]=useState(''),[dev,setDev]=useState(false),[camera,setCamera]=useState<CameraSettings>(defaultCamera),[videoTab,setVideoTab]=useState<'upload'|'link'>('upload'),[videoUrl,setVideoUrl]=useState('');
 const input=useRef<HTMLInputElement>(null),move=useRef({x:0,y:0,magnitude:0}),dialog=useRef<HTMLDivElement>(null),lastFocus=useRef<HTMLElement|null>(null);
 const {showHUD,beginInteraction,endInteraction}=useAutoHide(media.isPlaying,!!seat);
 useEffect(()=>{
      setDev(process.env.NODE_ENV !== 'production' && new URLSearchParams(location.search).has('debug'));
      setAppState('RESTORING_PROFILE');
      const prefs=darlingStorage.loadPreferences();
      if(prefs){
          if(prefs.quality)setQuality(prefs.quality);
          if(prefs.reducedMotion!==undefined)setReduced(prefs.reducedMotion);
          if(prefs.highRefresh!==undefined)setHighRefresh(prefs.highRefresh);
      }
      const profile=sessionManager.restoreSession();
      if(profile){
          setName(profile.name);
          setGender(profile.gender);
          if(profile.jacket)setJacket(profile.jacket);
          setAppState('RETURNING_USER');
          setTimeout(()=>{
              setAppState('THEATRE_LOADING');
              setTimeout(()=>{
                  setAppState('EXPLORING');
                  setWalking(true);setWalk(v=>v+1);
              }, 1500);
          }, 1500);
      }else{
          setAppState('ONBOARDING');
      }
  },[]);
 useEffect(()=>{if(!notice)return;const id=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(id);},[notice]);
 useEffect(()=>{if(panel){lastFocus.current=document.activeElement as HTMLElement;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();beginInteraction();}else{endInteraction();lastFocus.current?.focus();}return()=>{};},[panel]);
 const close=()=>setPanel(null);
 const enter=()=>{close();setWalking(true);setWalk(v=>v+1);};
 const resetView=()=>{setSeat(null);setRoute(null);setWalking(false);setReset(v=>v+1);close();};
 const stand=()=>{setSeat(null);setZoom(false);setWalking(true);setRoute(null);};
 const fullscreen=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.querySelector('.darling-app')?.requestFullscreen().catch(()=>setNotice('Fullscreen is unavailable in this browser.'));};
 const load=(file:File)=>{media.loadFile(file);setPanel('player');};
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){close();return;}if((e.target as HTMLElement).closest('input,textarea,select,button')||panel)return;const k=e.key.toLowerCase();if(k==='e'){e.preventDefault();if(seat)stand();else if(nearby)setSeat(nearby);}if(k===' '){e.preventDefault();media.togglePlay();}if(k==='f')fullscreen();if(k==='m')media.toggleMute();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[panel,seat,nearby,media]);
 const title=media.filename?.replace(/\.[^.]+$/,'')||'The Quiet Hours';
 const panelNames={player:'Your story. Front and center.',profile:'A little more you.',experience:'A big screen. A little more personal.',seats:'Find your favorite spot.',settings:'Your kind of comfortable.',party:'Good stories. Better company.',entry:'The Darling Cinemas.'};
 return <main className="darling-app cinema-app">
  <header className="dc-header" data-ui-control>
   <button className="dc-pill" onClick={()=>setPanel('entry')}><ArrowLeft size={14}/> Site</button>
   <div className="dc-navigation"><button className="dc-brand" onClick={resetView}>D<span>DARLING CINEMAS</span></button><nav aria-label="Experience navigation"><button className={!panel||panel!=='experience'?'selected':''} onClick={close}>The cinema</button><button className={panel==='experience'?'selected':''} onClick={()=>setPanel('experience')}>The experience</button></nav></div>
   <div className="dc-header-right"><button className="dc-icon community" disabled title="Darling Discord is not available" aria-label="Discord unavailable"><MessageSquare/></button><button className="dc-icon community" disabled title="Darling Telegram is not available" aria-label="Telegram unavailable"><Send/></button><button className="dc-pill" onClick={()=>setPanel('party')}><Users size={14}/><span>Watch party</span></button><button className="dc-profile" aria-label="Customize your player" onClick={()=>setPanel('profile')}>{name.charAt(0).toUpperCase()}</button></div>
  </header>
  <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime,.mov" className="dc-file" aria-label="Choose local video" onChange={e=>{if(e.target.files?.[0])load(e.target.files[0]);e.currentTarget.value='';}}/>
  <section className="dc-stage">
   <Theatre seat={seat} video={media.videoElement} youtubeId={media.youtubeId} onSeat={id=>{setSeat(id);setRoute(null);}} onNearbySeat={setNearby} onFps={setFps} moveRef={move} isTouch={isTouch} onWalk={()=>setWalking(true)} walk={walk} reset={reset} zoom={zoom} jacket={jacket} name={name} gender={gender} lite={quality==='Performance'} quality={quality} blocked={!!panel || appState!=='EXPLORING'} cameraSettings={camera} reducedMotion={reduced} highRefresh={highRefresh} destination={route} onRouteCancel={()=>setRoute(null)} service={service} onServiceState={setServiceState}/>
   {!walking&&!seat&&<div className="dc-hero"><span className="dc-eyebrow">THE OUTSIDE WORLD CAN WAIT</span><h1>The Darling Cinemas.</h1><p>Step inside. Settle in. Make a little room for a great story.</p></div>}
   {(!seat||showHUD)&&<aside className="dc-controls" aria-label="Theatre controls" data-ui-control><button aria-label="Seat zoom" aria-pressed={zoom} onClick={()=>seat?setZoom(!zoom):setNotice('Sit down first, then use seat zoom to fill the screen.')}><Focus/></button><button aria-label="Search catalogue unavailable" disabled title="Movie catalogue is outside this local cinema"><Search/></button><button aria-label="Toggle performance mode" onClick={()=>setQuality(quality==='Performance'?'Adaptive':'Performance')} title={quality}><Gauge/></button></aside>}
   {(!seat||showHUD)&&<div className="dc-explore" data-ui-control>
    {!isTouch&&<div className="dc-keys">{seat?<><kbd>E</kbd> Stand anytime <kbd>Space</kbd> Play / pause</>:<><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move <span>◉ Drag to look</span><kbd>E</kbd> Sit / stand</>}</div>}
    <div className="dc-seat-actions"><div>{seat?<><button aria-label="Ring for service" disabled={!!serviceState&&serviceState!=='Complete'} title={serviceState||'Ring for service'} onClick={()=>setService(v=>v+1)}><Bell/></button><button aria-label="Stand" onClick={stand}><UserRound/></button></>:route?<button aria-label="Cancel walk" onClick={()=>setRoute(null)}><X/></button>:nearby?<button className="dc-primary-circle" aria-label={`Sit ${nearby}`} onClick={()=>setSeat(nearby)}><Armchair/></button>:<button aria-label="Walk with my player" onClick={enter}><Footprints/></button>}<button aria-label="Choose your seat" onClick={()=>setPanel('seats')}><LayoutGrid/></button></div><small>{serviceState&&serviceState!=='Complete'?serviceState:seat?`Seat ${seat}. Enjoy the view.`:route?'Use the movement controls to take over.':nearby?`Take seat ${nearby}`:'Make yourself comfortable.'}</small></div>
    <button className="dc-reset" onClick={resetView}><RefreshCcw size={13}/> Reset view</button>
   </div>}
   {!seat&&(isTouch||dev)&&!panel&&<MobileJoystick moveRef={move}/>}
   {seat&&!showHUD&&<span className="dc-tap">Tap anywhere for controls · E to stand</span>}
  </section>
  <footer className={`dc-hud ${seat&&!showHUD?'dc-hidden':''}`} data-ui-control onPointerEnter={beginInteraction} onPointerLeave={endInteraction}>
   {media.filename&&<input className="dc-progress" aria-label="Playback position" type="range" min="0" max={media.duration||1} step="0.1" value={Math.min(media.progress,media.duration||1)} onChange={e=>media.seek(+e.target.value)}/>}
   <div className="dc-now"><button className="dc-play" aria-label={media.isPlaying?'Pause screen playback':'Play screen playback'} onClick={()=>media.filename?media.togglePlay():setPanel('player')}>{media.isPlaying?<Pause/>:<Play/>}</button><button className="dc-source" onClick={()=>setPanel('player')}><small>NOW SHOWING</small><strong>{title}</strong></button><span className="dc-source-type">{media.filename?'Your collection':'Ambient scene'}⌄</span></div>
   <button className="dc-hud-middle" onClick={()=>setPanel('player')}>{media.filename?`${time(media.progress)} / ${time(media.duration)}  Open player →`:'▤  Little room. Big screen. Just right.'}</button>
   <div className="dc-hud-right"><button aria-label="Toggle mute" onClick={media.toggleMute}>{media.isMuted||media.volume===0?<VolumeX/>:<Volume2/>}<span>Sound {media.isMuted||media.volume===0?'off':'on'}</span></button><button aria-label="Graphics and accessibility settings" onClick={()=>setPanel('settings')}><Monitor/><span>{quality}</span><small>{fps===null?'Measuring…':`${fps} FPS`}</small></button><button aria-label="Fullscreen" onClick={fullscreen}><Maximize/></button></div>
  </footer>
  {notice&&<div className="dc-toast" role="status">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={14}/></button></div>}
  {panel&&<div className="dc-backdrop" onClick={close} data-ui-control><div className="dc-panel" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="panel-title" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key!=='Tab')return;const all=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]');if(!all?.length)return;if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all[all.length-1].focus();}else if(!e.shiftKey&&document.activeElement===all[all.length-1]){e.preventDefault();all[0].focus();}}}>
   <button className="dc-close" aria-label="Close panel" onClick={close}><X/></button><span className="dc-eyebrow">{panel==='profile'?'YOUR PLAYER':panel==='settings'?'THE FINER DETAILS':panel==='seats'?'MAKE YOURSELF COMFORTABLE':'DARLING CINEMAS'}</span><h2 id="panel-title">{panelNames[panel]}</h2>
   {panel==='player'&&<><p>Bring your own video. Your film stays on your device.</p>{media.filename&&<div className="dc-media"><Film size={30}/><strong>{title}</strong><input aria-label="Player seek" type="range" min="0" max={media.duration||1} value={Math.min(media.progress,media.duration||1)} step=".1" onChange={e=>media.seek(+e.target.value)}/><div className="dc-media-row"><span>{time(media.progress)} / {time(media.duration)}</span><button aria-label={media.isPlaying?'Pause video':'Play video'} onClick={media.togglePlay}>{media.isPlaying?<Pause/>:<Play/>}</button><button aria-label="Player mute" onClick={media.toggleMute}>{media.isMuted?<VolumeX/>:<Volume2/>}</button><input aria-label="Volume" type="range" min="0" max="1" step=".05" value={media.volume} onChange={e=>media.changeVolume(+e.target.value)}/></div><div className="dc-media-row"><label>Speed <select aria-label="Playback speed" value={media.playbackRate} onChange={e=>media.changePlaybackRate(+e.target.value)}>{[.5,.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v===1?'Normal':`${v}×`}</option>)}</select></label><button aria-pressed={media.isLooping} onClick={media.toggleLoop}><Repeat size={14}/> Loop {media.isLooping?'on':'off'}</button><button onClick={()=>setPanel('seats')}><Armchair size={14}/> Choose a seat</button></div></div>}
   <div className="dc-tabs">
     <button className={videoTab==='upload'?'selected':''} onClick={()=>setVideoTab('upload')}>My video</button>
     <button className={videoTab==='link'?'selected':''} onClick={()=>setVideoTab('link')}>Video link</button>
   </div>
   {videoTab==='upload' && <div className="dc-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])load(e.dataTransfer.files[0]);}}><Upload/><h3>Bring your own story.</h3><p>Drop a video here, or choose one from your device.</p><button className="dc-pill" disabled={media.status==='loading'} onClick={()=>input.current?.click()}>{media.status==='loading'?'Preparing video…':media.filename?'Change video':'Choose a video'} →</button><small>MP4 and WebM. MOV where supported.<br/>Nothing is uploaded.</small></div>}
   {videoTab==='link' && <div className="dc-drop" style={{padding: '32px 24px'}}><h3 style={{marginBottom: '8px'}}>Stream from the web.</h3><p style={{marginBottom: '24px'}}>Paste a YouTube, Google Drive, or direct MP4 link.</p><input type="url" value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} placeholder="https://..." style={{width: '100%', boxSizing: 'border-box', padding: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '4px', marginBottom: '16px'}} /><button className="dc-pill" disabled={media.status==='loading' || !videoUrl} onClick={()=>{ media.loadUrl(videoUrl); }}>{media.status==='loading'?'Loading link…':'Play link'} →</button></div>}
   {media.status==='error'&&<p role="alert" className="dc-error">{media.error||'This video could not be played.'}</p>}<button className="dc-wide" onClick={close}>Back to the cinema →</button></>}
   {panel==='profile'&&<><p>Your presence in the cinema. No account required.</p><div className="dc-avatar-preview" style={{'--jacket':jacket} as React.CSSProperties}><div className="avatar-head"/><div className="avatar-body"/><div className="avatar-legs"/></div><label className="dc-field">DISPLAY NAME<input value={name} maxLength={24} onChange={e=>setName(e.target.value)} /></label><span className="dc-eyebrow">YOUR JACKET</span><div className="dc-jackets" role="radiogroup" aria-label="Your jacket">{jackets.map(([label,color])=><button key={label} role="radio" aria-checked={jacket===color} onClick={()=>setJacket(color)}><i style={{background:color}}/>{label}</button>)}</div><button className="dc-wide" onClick={()=>{const profile=darlingStorage.loadProfile(); if(profile){profile.name=name;profile.jacket=jacket;darlingStorage.saveProfile(profile);} setNotice('Your player has been saved.');}}>Save my player</button><button className="dc-wide secondary" onClick={enter}>Walk with my player →</button><button className="dc-wide secondary" style={{marginTop: '16px', background: 'rgba(255,255,255,0.05)'}} onClick={()=>{sessionManager.clearSession(); setNotice('Signed out.'); close(); resetView(); setAppState('ONBOARDING');}}>SIGN OUT</button><button className="dc-wide secondary" style={{marginTop: '8px', color: '#ff6b6b', background: 'rgba(255,0,0,0.05)'}} onClick={()=>{if(confirm('Are you sure you want to delete your local profile?')){sessionManager.deleteLocalProfile(); setNotice('Local profile deleted.'); close(); resetView(); setAppState('ONBOARDING');}}}>DELETE LOCAL PROFILE</button><p>WASD to move. Drag to look. E to sit or stand.<br/>On mobile, use the on-screen thumbstick.</p></>}
   {panel==='seats'&&<><p>Ten wide recliners. Not a bad seat in the house.</p><div className="dc-seat-map"><div className="dc-map-screen">SCREEN</div>{['A','B'].map(row=><div className="dc-seat-row" key={row}><span>{row}</span>{seats.filter(s=>s.id.startsWith(row)).map(s=><button key={s.id} aria-label={`Select seat ${s.id}`} aria-pressed={selection===s.id} className={selection===s.id?'selected':''} onClick={()=>setSelection(s.id)}><Armchair/>{s.id}</button>)}</div>)}<small>RAISED PLATFORM · ENTRANCE</small></div><span className="dc-eyebrow">YOUR SPOT</span><h3>Seat {selection}</h3><p>{selection.startsWith('B')?'Raised back row':'Main floor'} · {selection.endsWith('3')?'A perfectly centered view':'A view of your own'}</p><button className="dc-wide" onClick={()=>{stand();setRoute({id:selection,request:Date.now()});close();}}>Settle into {selection} →</button><p>We will walk you there. You can take over at any time.</p></>}
   {panel==='settings'&&<><p>A few thoughtful adjustments. Nothing in the way.</p><span className="dc-eyebrow">RENDER QUALITY · {fps??'—'} FPS</span><div className="dc-quality" role="radiogroup" aria-label="Render quality">{(['Performance','Adaptive','Ultra'] as const).map(q=><button key={q} role="radio" aria-checked={quality===q} onClick={()=>{setQuality(q); darlingStorage.savePreferences({quality: q, reducedMotion: reduced, highRefresh});}}><strong>{q}</strong><span>{q==='Performance'?'Lower pixel ratio and no heavy shadows.':q==='Adaptive'?'Balances clarity and frame rate.':'High pixel ratio and soft shadows for strong GPUs.'}</span></button>)}</div><label className="dc-switch">High refresh target<input type="checkbox" checked={highRefresh} onChange={e=>{setHighRefresh(e.target.checked); darlingStorage.savePreferences({quality, reducedMotion: reduced, highRefresh: e.target.checked});}}/></label><label className="dc-switch">Reduced motion<input type="checkbox" checked={reduced} onChange={e=>{setReduced(e.target.checked); darlingStorage.savePreferences({quality, reducedMotion: e.target.checked, highRefresh});}}/></label><h3>Layout diagnostics</h3><p>{THEATRE_CONFIG.seatGapX.toFixed(2)} m seat gaps. {THEATRE_CONFIG.sideAisleWidth.toFixed(2)} m side aisles. Ten physical seats.</p><button className="dc-wide" onClick={resetView}>Return to the entrance →</button></>}
   {(panel==='experience'||panel==='entry')&&<><p>For the stories that deserve your full attention.</p><div className="dc-landscape"><span>Leave the everyday outside.</span></div><p>Deep burgundy recliners. Warm architectural light. Enough room to breathe. A private cinema with ten places, and every seat is yours to try.</p><p>Choose a video from your device, walk through the theatre, and settle into your own view. Your video remains local.</p><button className="dc-wide" onClick={panel==='entry'?enter:close}>{panel==='entry'?'Enter the cinema':'Back to the cinema'} →</button></>}
   {panel==='party'&&<><p>One private cinema. Ten places. A shared moment.</p><div className="dc-unavailable"><Users size={36}/><h3>Watch party is coming soon.</h3><p>Online rooms and synchronized guests are not available in this local version. Characters in the theatre are simulated guests.</p><button className="dc-wide" disabled>Create watch party · Coming soon</button></div><button className="dc-wide secondary" onClick={close}>Back to the cinema →</button></>}
   <div className="dc-panel-footer">DARLING CINEMAS · THE PRIVATE CINEMA</div>
  </div></div>}
  {dev&&<details className="dc-debug"><summary>Camera tuning</summary><button onClick={()=>{stand();setRoute({id:"CANTEEN",request:Date.now()});}}>Walk to canteen (QA)</button><button onClick={()=>{setCamera(REFERENCE_GEOMETRY_VIEW);}}>Load Reference Camera</button><button onClick={async()=>{const response=await fetch("/qa/cinema-qa.mp4");load(new File([await response.blob()],"Generated QA clip.mp4",{type:"video/mp4"}));}}>Load generated QA clip</button>{Object.entries(camera).map(([key,value])=><label key={key}>{key}<input type="number" step={key==='sensitivity'?'.001':'.1'} value={value} onChange={e=>setCamera({...camera,[key]:+e.target.value})}/></label>)}</details>}
  {appState !== 'EXPLORING' && <div className="dc-backdrop" style={{zIndex:100, transition: 'opacity 1.5s ease', opacity: appState==='THEATRE_LOADING'?0:1, backgroundColor: '#14120f', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
    <div className="dc-panel" style={{margin:'auto'}}>
      {appState === 'ONBOARDING' && (
        <>
          <span className="dc-eyebrow" style={{textAlign:'center', display:'block'}}>WELCOME TO DARLING CINEMAS</span>
          <h2 style={{textAlign:'center', marginBottom: '24px'}}>CREATE YOUR ACCOUNT</h2>
          <form onSubmit={e => {
             e.preventDefault();
             if(pwd !== confirmPwd) {setNotice('Passwords do not match'); return;}
             const profile = sessionManager.createSession(name, gender as "Male"|"Female");
             if(jacket){ profile.jacket = jacket; darlingStorage.saveProfile(profile); }
             setAppState('THEATRE_LOADING');
             setTimeout(() => {
                 setAppState('EXPLORING');
                 setWalking(true); setWalk(v=>v+1);
             }, 1500);
          }}>
            <label className="dc-field" style={{marginBottom: '16px'}}>NAME <input required value={name} onChange={e=>setName(e.target.value)}/></label>
            <div className="dc-field" style={{marginBottom: '16px'}}>
              <span className="dc-eyebrow" style={{marginBottom: '8px', display: 'block', fontSize: '10px', letterSpacing: '1px'}}>GENDER</span>
              <div style={{display: 'flex', gap: '8px'}}>
                <button type="button" aria-pressed={gender==='Male'} onClick={()=>setGender('Male')} style={{flex: 1, padding: '10px', background: gender==='Male'?'white':'transparent', color: gender==='Male'?'black':'rgba(255,255,255,0.7)', border: gender==='Male'?'1px solid white':'1px solid rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s'}}>Male</button>
                <button type="button" aria-pressed={gender==='Female'} onClick={()=>setGender('Female')} style={{flex: 1, padding: '10px', background: gender==='Female'?'white':'transparent', color: gender==='Female'?'black':'rgba(255,255,255,0.7)', border: gender==='Female'?'1px solid white':'1px solid rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s'}}>Female</button>
              </div>
            </div>
            <label className="dc-field" style={{marginBottom: '16px'}}>PASSWORD <input required type="password" value={pwd} onChange={e=>setPwd(e.target.value)}/></label>
            <label className="dc-field" style={{marginBottom: '24px'}}>CONFIRM PASSWORD <input required type="password" value={confirmPwd} onChange={e=>setConfirmPwd(e.target.value)}/></label>
            <button type="submit" className="dc-wide">CREATE ACCOUNT</button>
            <p style={{textAlign: 'center', fontSize: '12px', opacity: 0.5, marginTop: '24px', fontWeight: 500}}>Your cinema profile is stored on this browser.</p>
          </form>
        </>
      )}
      {appState === 'RETURNING_USER' && (
        <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'300px'}}>
          <span className="dc-eyebrow" style={{textAlign:'center', display:'block', marginBottom: '16px'}}>DARLING CINEMAS</span>
          <h2 style={{margin:0, opacity: 1}}>WELCOME BACK, {name.toUpperCase()}</h2>
        </div>
      )}
      {(appState === 'BOOT' || appState === 'RESTORING_PROFILE') && (
        <div style={{display:'flex', alignItems:'center', justifyContent:'center', minHeight:'300px'}}>
          <span className="dc-eyebrow" style={{opacity: 0.5}}>LOADING DARLING CINEMAS...</span>
        </div>
      )}
    </div>
  </div>}
  </main>;
}
