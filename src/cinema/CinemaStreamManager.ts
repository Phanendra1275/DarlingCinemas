import { partyService } from '../services/partyService';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

export interface StreamManagerOptions {
  onRemoteStream: (stream: MediaStream, title?: string) => void;
  onStreamEnded?: () => void;
  onToast?: (msg: string) => void;
}

function extractMediaStream(video: HTMLVideoElement): MediaStream | null {
  if (video.srcObject instanceof MediaStream) {
    return video.srcObject;
  }
  if (video.readyState < 2 || video.videoWidth === 0) {
    return null;
  }
  try {
    if ((video as any).captureStream) {
      return (video as any).captureStream();
    }
    if ((video as any).mozCaptureStream) {
      return (video as any).mozCaptureStream();
    }
  } catch (err) {
    console.warn('captureStream error:', err);
  }
  return null;
}

export class CinemaStreamManager {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private candidateQueue: Map<string, RTCIceCandidateInit[]> = new Map();
  private localVideo: HTMLVideoElement | null = null;
  private currentStream: MediaStream | null = null;
  private videoListenersCleanup: (() => void) | null = null;
  private unsubSignal: (() => void) | null = null;
  private unsubRoomChange: (() => void) | null = null;
  private options: StreamManagerOptions;

  constructor(options: StreamManagerOptions) {
    this.options = options;

    // Listen for WebRTC signals (offers, answers, ICE candidates)
    this.unsubSignal = partyService.onSignal((fromUid, data) => {
      this.handleSignal(fromUid, data);
    });

    // Cleanup when room changes or leaves
    this.unsubRoomChange = partyService.onRoomChange((code) => {
      if (!code) {
        this.closeAllConnections();
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
    video.addEventListener('playing', onReady);

    this.videoListenersCleanup = () => {
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('play', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('playing', onReady);
    };

    if (video.readyState >= 2 && !video.paused) {
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
          this.connectToGuest(guestUid, stream);
        }
      }
    }
  }

  public onMembersChanged(members: Record<string, any>) {
    if (!partyService.getIsHost() || !this.currentStream) return;
    const myUid = partyService.getUid();
    for (const guestUid of Object.keys(members)) {
      if (guestUid !== myUid && !this.peerConnections.has(guestUid)) {
        this.connectToGuest(guestUid, this.currentStream);
      }
    }
  }

  private async connectToGuest(guestUid: string, stream: MediaStream) {
    if (guestUid === partyService.getUid()) return;

    let pc = this.peerConnections.get(guestUid);
    if (pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed') {
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

    pc = new RTCPeerConnection(RTC_CONFIG);
    this.peerConnections.set(guestUid, pc);

    stream.getTracks().forEach(track => {
      try { pc!.addTrack(track, stream); } catch (e) { console.warn('addTrack error:', e); }
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        partyService.sendSignal(guestUid, {
          type: 'candidate',
          candidate: event.candidate.toJSON()
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
        this.peerConnections.delete(guestUid);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      partyService.sendSignal(guestUid, {
        type: 'offer',
        offer: {
          type: offer.type,
          sdp: offer.sdp
        }
      });
    } catch (err) {
      console.warn('Failed to create offer for guest:', guestUid, err);
    }
  }

  private handleSignal(fromUid: string, data: any) {
    if (!data || typeof data !== 'object') return;

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

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const media = partyService.getCurrentRoomMedia();
        this.options.onRemoteStream(stream, media?.title || 'Host Cinema Stream');
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        partyService.sendSignal(fromUid, {
          type: 'candidate',
          candidate: event.candidate.toJSON()
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed' || pc?.connectionState === 'closed') {
        this.peerConnections.delete(fromUid);
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

      partyService.sendSignal(fromUid, {
        type: 'answer',
        answer: {
          type: answer.type,
          sdp: answer.sdp
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
