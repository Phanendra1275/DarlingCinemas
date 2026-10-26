import { partyService } from '../services/partyService';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelay',
      credential: 'openrelay'
    }
  ],
  iceCandidatePoolSize: 10
};

export interface StreamManagerOptions {
  onRemoteStream: (stream: MediaStream, title?: string) => void;
  onStreamEnded?: () => void;
  onToast?: (msg: string) => void;
}

function extractMediaStream(video: HTMLVideoElement): MediaStream | null {
  if (!video) return null;
  if (video.srcObject instanceof MediaStream) {
    return video.srcObject;
  }
  if (!video.src && video.readyState === 0) {
    return null;
  }
  try {
    const fn = (video as any).captureStream || (video as any).mozCaptureStream;
    if (typeof fn === 'function') {
      const stream = fn.call(video, 30);
      if (stream && stream.getTracks().length > 0) {
        return stream;
      }
    }
  } catch (err) {
    console.warn('captureStream error:', err);
  }
  return null;
}

function waitForIceGatheringComplete(pc: RTCPeerConnection, maxTimeoutMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    let timer: any = null;
    const checkState = () => {
      if (pc.iceGatheringState === 'complete') {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', checkState);
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, maxTimeoutMs);
    pc.addEventListener('icegatheringstatechange', checkState);
  });
}

export class CinemaStreamManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private candidateQueue: Map<string, RTCIceCandidateInit[]> = new Map();
  private localVideo: HTMLVideoElement | null = null;
  private currentStream: MediaStream | null = null;
  private videoListenersCleanup: (() => void) | null = null;
  private unsubSignal: (() => void) | null = null;
  private unsubRoomChange: (() => void) | null = null;
  private requestStreamTimer: any = null;
  private hasReceivedStream = false;
  private options: StreamManagerOptions;

  constructor(options: StreamManagerOptions) {
    this.options = options;

    // Listen for WebRTC signals (offers, answers, ICE candidates, request_stream)
    this.unsubSignal = partyService.onSignal((fromUid, data) => {
      this.handleSignal(fromUid, data);
    });

    // Cleanup when room changes or leaves
    this.unsubRoomChange = partyService.onRoomChange((code) => {
      if (!code) {
        this.closeAllConnections();
        this.hasReceivedStream = false;
        clearTimeout(this.requestStreamTimer);
      } else if (partyService.getIsHost()) {
        setTimeout(() => this.checkAndBroadcastLocalVideo(), 200);
      } else {
        this.hasReceivedStream = false;
        setTimeout(() => this.requestStreamFromHost(), 300);
      }
    });
  }

  public setLocalVideoElement(video: HTMLVideoElement | null) {
    if (this.localVideo === video) return;
    this.cleanupVideoListeners();
    this.localVideo = video;
    if (!video) return;

    const onReady = () => {
      if (partyService.getIsHost()) {
        this.checkAndBroadcastLocalVideo();
      }
    };

    video.addEventListener('canplay', onReady);
    video.addEventListener('play', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('playing', onReady);
    video.addEventListener('timeupdate', () => {
      if (!this.currentStream && partyService.getIsHost() && !video.paused) {
        onReady();
      }
    });

    this.videoListenersCleanup = () => {
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('play', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('playing', onReady);
    };

    if (video.readyState >= 1 || !video.paused) {
      onReady();
    }
  }

  public checkAndBroadcastLocalVideo() {
    if (!partyService.getIsHost() || !this.localVideo) return;
    const stream = extractMediaStream(this.localVideo);
    if (stream && stream.getTracks().length > 0) {
      this.currentStream = stream;
      const members = partyService.getMembers();
      const myUid = partyService.getUid();
      for (const guestUid of Object.keys(members)) {
        if (guestUid !== myUid) {
          this.connectToGuest(guestUid, stream, false);
        }
      }
    }
  }

  public onMembersChanged(members: Record<string, any>) {
    if (partyService.getIsHost()) {
      if (!this.currentStream && this.localVideo) {
        this.currentStream = extractMediaStream(this.localVideo);
      }
      if (!this.currentStream) return;
      const myUid = partyService.getUid();
      for (const guestUid of Object.keys(members)) {
        if (guestUid !== myUid) {
          const pc = this.peerConnections.get(guestUid);
          const needsConnect = !pc || pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected';
          if (needsConnect) {
            this.connectToGuest(guestUid, this.currentStream, false);
          }
        }
      }
    } else {
      if (!this.hasReceivedStream) {
        this.requestStreamFromHost();
      }
    }
  }

  public requestStreamFromHost() {
    if (partyService.getIsHost() || !partyService.getActiveRoom()) return;
    const members = partyService.getMembers();
    const myUid = partyService.getUid();
    let hostUid = partyService.getHostId();
    if (!hostUid) {
      const meta = partyService.getCurrentRoomMeta();
      hostUid = meta?.hostId || null;
    }
    if (!hostUid) {
      for (const uid of Object.keys(members)) {
        if (uid !== myUid) {
          hostUid = uid;
          break;
        }
      }
    }
    if (hostUid && hostUid !== myUid) {
      partyService.sendSignal(hostUid, { type: 'request_stream' });
    }

    // Schedule retry if stream not yet received
    if (!this.hasReceivedStream) {
      clearTimeout(this.requestStreamTimer);
      this.requestStreamTimer = setTimeout(() => {
        if (!this.hasReceivedStream && !partyService.getIsHost() && partyService.getActiveRoom()) {
          this.requestStreamFromHost();
        }
      }, 3000);
    }
  }

  private async connectToGuest(guestUid: string, stream: MediaStream, force = false) {
    if (guestUid === partyService.getUid()) return;

    let pc = this.peerConnections.get(guestUid);
    if (pc && !force && pc.connectionState !== 'closed' && pc.connectionState !== 'failed' && pc.connectionState !== 'disconnected') {
      const senders = pc.getSenders();
      stream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch(console.warn);
        } else {
          try { pc!.addTrack(track, stream); } catch {}
        }
      });
      return;
    }

    if (pc) {
      try { pc.close(); } catch {}
      this.peerConnections.delete(guestUid);
    }

    pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(guestUid, pc);

    let isMakingOffer = false;
    const sendOffer = async () => {
      if (isMakingOffer || pc.signalingState !== 'stable') return;
      isMakingOffer = true;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc, 1000);
        const finalSdp = pc.localDescription?.sdp || offer.sdp;
        partyService.sendSignal(guestUid, {
          type: 'offer',
          offer: {
            type: offer.type,
            sdp: finalSdp
          }
        });
      } catch (err) {
        console.warn('sendOffer error:', err);
      } finally {
        isMakingOffer = false;
      }
    };

    stream.getTracks().forEach(track => {
      try { pc!.addTrack(track, stream); } catch (e) { console.warn('addTrack error:', e); }
    });

    pc.onnegotiationneeded = () => {
      sendOffer();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const cand = event.candidate.toJSON ? event.candidate.toJSON() : {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        };
        partyService.sendSignal(guestUid, {
          type: 'candidate',
          candidate: cand
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
        this.peerConnections.delete(guestUid);
      }
    };

    sendOffer();
  }

  private handleSignal(fromUid: string, data: any) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'request_stream') {
      if (partyService.getIsHost()) {
        const stream = this.currentStream || (this.localVideo ? extractMediaStream(this.localVideo) : null);
        if (stream) {
          this.currentStream = stream;
          this.connectToGuest(fromUid, stream, true);
        }
      }
      return;
    }

    if (data.type === 'offer' && data.offer) {
      this.handleOffer(fromUid, data.offer);
    } else if (data.type === 'answer' && data.answer) {
      this.handleAnswer(fromUid, data.answer);
    } else if (data.type === 'candidate' && data.candidate) {
      this.handleCandidate(fromUid, data.candidate);
    }
  }

  private async handleOffer(fromUid: string, offerData: RTCSessionDescriptionInit) {
    if (partyService.getIsHost()) return;

    let pc = this.peerConnections.get(fromUid);
    if (pc) {
      try { pc.close(); } catch {}
    }

    pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(fromUid, pc);

    const remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      this.hasReceivedStream = true;
      clearTimeout(this.requestStreamTimer);
      let trackStream: MediaStream;
      if (event.streams && event.streams[0]) {
        trackStream = event.streams[0];
      } else {
        if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
        trackStream = remoteStream;
      }
      const media = partyService.getCurrentRoomMedia();
      this.options.onRemoteStream(trackStream, media?.title || 'Host Cinema Stream');
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const cand = event.candidate.toJSON ? event.candidate.toJSON() : {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        };
        partyService.sendSignal(fromUid, {
          type: 'candidate',
          candidate: cand
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
        this.peerConnections.delete(fromUid);
        // If connection failed, trigger stream request retry
        if (!this.hasReceivedStream) {
          setTimeout(() => this.requestStreamFromHost(), 1000);
        }
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offerData));

      const queued = this.candidateQueue.get(fromUid) || [];
      for (const c of queued) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      this.candidateQueue.set(fromUid, []);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc, 1000);
      const finalSdp = pc.localDescription?.sdp || answer.sdp;

      partyService.sendSignal(fromUid, {
        type: 'answer',
        answer: {
          type: answer.type,
          sdp: finalSdp
        }
      });
    } catch (err) {
      console.warn('handleOffer error:', err);
    }
  }

  private async handleAnswer(fromUid: string, answerData: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(fromUid);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answerData));
      const queued = this.candidateQueue.get(fromUid) || [];
      for (const c of queued) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      this.candidateQueue.set(fromUid, []);
    } catch (err) {
      console.warn('handleAnswer error:', err);
    }
  }

  private async handleCandidate(fromUid: string, candidateData: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(fromUid);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidateData));
      } catch (err) {
        console.warn('addIceCandidate error:', err);
      }
    } else {
      const q = this.candidateQueue.get(fromUid) || [];
      q.push(candidateData);
      this.candidateQueue.set(fromUid, q);
    }
  }

  private cleanupVideoListeners() {
    if (this.videoListenersCleanup) {
      this.videoListenersCleanup();
      this.videoListenersCleanup = null;
    }
  }

  private closeAllConnections() {
    this.peerConnections.forEach(pc => {
      try { pc.close(); } catch {}
    });
    this.peerConnections.clear();
    this.candidateQueue.clear();
    this.currentStream = null;
  }

  public destroy() {
    clearTimeout(this.requestStreamTimer);
    this.cleanupVideoListeners();
    this.closeAllConnections();
    if (this.unsubSignal) {
      this.unsubSignal();
      this.unsubSignal = null;
    }
    if (this.unsubRoomChange) {
      this.unsubRoomChange();
      this.unsubRoomChange = null;
    }
  }
}
