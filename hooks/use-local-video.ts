/* eslint-disable react-hooks/immutability */
import {useState,useRef,useEffect,useCallback} from 'react';
export function useLocalVideo(){
 const [videoElement,setVideoElement]=useState<HTMLVideoElement|null>(null),[isPlaying,setIsPlaying]=useState(false),[progress,setProgress]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(1),[isMuted,setIsMuted]=useState(false),[playbackRate,setPlaybackRate]=useState(1),[isLooping,setIsLooping]=useState(false),[filename,setFilename]=useState<string|null>(null),[status,setStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle'),[error,setError]=useState('');
 const objectUrl=useRef<string|null>(null),cancelCandidate=useRef<(()=>void)|null>(null),generation=useRef(0);
 useEffect(()=>{const el=document.createElement('video');el.playsInline=true;el.preload='auto';el.crossOrigin='anonymous';
  const sync=()=>{setProgress(el.currentTime);setDuration(Number.isFinite(el.duration)?el.duration:0);setIsPlaying(!el.paused&&!el.ended);setVolume(el.volume);setIsMuted(el.muted);setPlaybackRate(el.playbackRate);setIsLooping(el.loop);};
  const ready=()=>{sync();setStatus('ready');};const fail=()=>{setStatus('error');setError('Your browser could not decode this video. Try MP4 (H.264/AAC) or WebM.');};
  const events=['timeupdate','durationchange','play','pause','ended','volumechange','ratechange'];events.forEach(e=>el.addEventListener(e,sync));el.addEventListener('canplay',ready);el.addEventListener('error',fail);setVideoElement(el);
  return()=>{generation.current++;cancelCandidate.current?.();events.forEach(e=>el.removeEventListener(e,sync));el.removeEventListener('canplay',ready);el.removeEventListener('error',fail);el.pause();el.removeAttribute('src');el.load();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};
 },[]);
 const loadFile=useCallback((file:File)=>{if(!videoElement)return;cancelCandidate.current?.();const token=++generation.current;setError('');setStatus('loading');const url=URL.createObjectURL(file),candidate=document.createElement('video');candidate.preload='auto';let timer:ReturnType<typeof setTimeout>;let settled=false;
  const cleanup=()=>{clearTimeout(timer);candidate.removeEventListener('canplay',accept);candidate.removeEventListener('error',reject);candidate.removeAttribute('src');candidate.load();};
  const reject=()=>{if(settled)return;settled=true;cleanup();URL.revokeObjectURL(url);if(token===generation.current){setError('This file is unsupported or could not be read. Choose MP4, WebM, or a browser-supported MOV.');setStatus('error');}};
  const accept=()=>{if(settled||token!==generation.current)return;settled=true;cleanup();const old=objectUrl.current;objectUrl.current=url;videoElement.pause();videoElement.src=url;videoElement.load();setProgress(0);setDuration(0);setFilename(file.name);if(old)URL.revokeObjectURL(old);cancelCandidate.current=null;};
  cancelCandidate.current=()=>{if(settled)return;settled=true;cleanup();URL.revokeObjectURL(url);};candidate.addEventListener('canplay',accept);candidate.addEventListener('error',reject);timer=setTimeout(reject,30000);candidate.src=url;candidate.load();
 },[videoElement]);
 const togglePlay=useCallback(()=>{if(!videoElement?.src)return;if(videoElement.paused)void videoElement.play().catch(()=>{setError('Playback could not start. Tap play again or choose a supported video.');setStatus('error');});else videoElement.pause();},[videoElement]);
 const seek=useCallback((v:number)=>{if(videoElement&&Number.isFinite(videoElement.duration))videoElement.currentTime=Math.max(0,Math.min(v,videoElement.duration));},[videoElement]);
 const changeVolume=useCallback((v:number)=>{if(videoElement){videoElement.volume=Math.max(0,Math.min(v,1));if(v>0)videoElement.muted=false;}},[videoElement]);
 const toggleMute=useCallback(()=>{if(videoElement)videoElement.muted=!videoElement.muted;},[videoElement]);
 const changePlaybackRate=useCallback((v:number)=>{if(videoElement)videoElement.playbackRate=Math.max(.25,Math.min(v,4));},[videoElement]);
 const toggleLoop=useCallback(()=>{if(videoElement){videoElement.loop=!videoElement.loop;setIsLooping(videoElement.loop);}},[videoElement]);
 const dismissError=useCallback(()=>{setError('');setStatus(filename?'ready':'idle');},[filename]);
 return{videoElement,isPlaying,progress,duration,volume,isMuted,playbackRate,isLooping,filename,status,error,loadFile,togglePlay,seek,changeVolume,toggleMute,changePlaybackRate,toggleLoop,dismissError};
}
