import * as THREE from 'three';
import { createAvatar, seats, SeatData } from '../../app/cinema-scene';
import { partyService } from '../services/partyService';
import type { RoomMember, PlayerPose, RoomSeats, RoomPlayback, RoomMedia } from '../types/party';

export interface RemoteAvatarRig {
  id: string;
  name: string;
  color: string;
  gender: string;
  seatId: string | null;
  avatar: ReturnType<typeof createAvatar>;
  nameTag: {
    sprite: THREE.Sprite;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    tex: THREE.CanvasTexture;
    mat: THREE.SpriteMaterial;
    redraw: (t: string, b?: string) => void;
  };
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentYaw: number;
  targetYaw: number;
  state: 'walking' | 'standing' | 'seated';
  walkPhase: number;
}

export function createSeatMarker(seatId: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  
  function redraw(label: string, isOccupied: boolean, occupantName?: string) {
    ctx.clearRect(0, 0, 128, 48);
    ctx.fillStyle = isOccupied ? 'rgba(132, 49, 61, 0.85)' : 'rgba(20, 18, 15, 0.75)';
    ctx.beginPath();
    ctx.roundRect(8, 6, 112, 36, 10);
    ctx.fill();
    ctx.strokeStyle = isOccupied ? 'rgba(255, 120, 120, 0.6)' : 'rgba(150, 112, 68, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = isOccupied ? '#ffc7c7' : '#e8dcba';
    ctx.font = 'bold 13px "Inter", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (isOccupied && occupantName) {
      const shortName = occupantName.length > 8 ? occupantName.substring(0, 7) + '…' : occupantName;
      ctx.fillText(`${label} · ${shortName}`, 64, 24);
    } else {
      ctx.fillText(label, 64, 24);
    }
  }

  redraw(seatId, false);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.65, 0.65 * (48 / 128), 1);
  sprite.position.set(0, 1.45, 0);

  return { sprite, tex, mat, redraw };
}

function createBillboardSprite(text: string, color = '#f5eedc', badge?: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  
  function redraw(t: string, b?: string) {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(14, 12, 10, 0.82)';
    ctx.beginPath();
    ctx.roundRect(16, 10, 224, 44, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 112, 68, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const display = b ? `[${b}] ${t}` : t;
    ctx.fillStyle = color;
    ctx.font = 'bold 14px "Inter", "Montserrat", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(display.toUpperCase(), 128, 32);
  }

  redraw(text, badge);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.05, 1.05 * (64 / 256), 1);
  sprite.position.set(0, 2.2, 0);

  return { sprite, canvas, ctx, tex, mat, redraw };
}

export class CinemaMultiplayer {
  private scene: THREE.Scene;
  private remoteAvatars: Map<string, RemoteAvatarRig> = new Map();
  private seatMarkers: Map<string, ReturnType<typeof createSeatMarker>> = new Map();
  private activeMembers: Record<string, RoomMember> = {};
  private activeSeats: RoomSeats = {};
  private activePoses: Record<string, PlayerPose> = {};
  private activePlayback: RoomPlayback | null = null;
  private activeMedia: RoomMedia | null = null;

  private onToast: (msg: string) => void;
  private onTriggerWalkToSeat: (seatId: string) => void;
  private onSitConfirmed: (seatId: string) => void;

  private unsubscribeParty: (() => void) | null = null;
  private isConnected = false;

  constructor(options: {
    scene: THREE.Scene;
    onToast: (msg: string) => void;
    onTriggerWalkToSeat: (seatId: string) => void;
    onSitConfirmed: (seatId: string) => void;
  }) {
    this.scene = options.scene;
    this.onToast = options.onToast;
    this.onTriggerWalkToSeat = options.onTriggerWalkToSeat;
    this.onSitConfirmed = options.onSitConfirmed;

    this.createSeatIndicators();
  }

  private createSeatIndicators() {
    seats.forEach((seat) => {
      const marker = createSeatMarker(seat.id);
      marker.sprite.position.set(seat.position.x, seat.position.y + 1.25, seat.position.z);
      this.scene.add(marker.sprite);
      this.seatMarkers.set(seat.id, marker);
    });
  }

  /**
   * Connects this multiplayer manager to the active room.
   */
  public attachToRoom() {
    this.unsubscribeParty?.();
    this.isConnected = true;

    this.unsubscribeParty = partyService.subscribeToRoom({
      onMembers: (members) => {
        this.activeMembers = members || {};
        this.syncRemoteAvatars();
        this.updateSeatIndicators();
      },
      onSeats: (roomSeats) => {
        this.activeSeats = roomSeats || {};
        this.updateSeatIndicators();
      },
      onPoses: (poses) => {
        this.activePoses = poses || {};
        this.applyIncomingPoses();
      },
      onPlayback: (playback) => {
        this.activePlayback = playback;
      },
      onMedia: (media) => {
        this.activeMedia = media;
      }
    });
  }

  public detach() {
    this.isConnected = false;
    this.unsubscribeParty?.();
    this.unsubscribeParty = null;

    // Remove all remote avatars from scene
    this.remoteAvatars.forEach((rig) => {
      this.scene.remove(rig.avatar.root);
      rig.nameTag.tex.dispose();
      rig.nameTag.mat.dispose();
    });
    this.remoteAvatars.clear();
    this.updateSeatIndicators();
  }

  private updateSeatIndicators() {
    this.seatMarkers.forEach((marker, seatId) => {
      const occupantUid = this.activeSeats[seatId];
      const isOccupied = !!occupantUid;
      const occupantMember = isOccupied ? this.activeMembers[occupantUid] : undefined;
      const occupantName = occupantMember ? occupantMember.name : (occupantUid ? 'Occupied' : undefined);
      marker.redraw(seatId, isOccupied, occupantName);
      marker.tex.needsUpdate = true;
    });
  }

  private syncRemoteAvatars() {
    const localUid = partyService.getUid();
    const currentMemberUids = new Set(Object.keys(this.activeMembers));

    // Remove avatars that left
    for (const [uid, rig] of this.remoteAvatars.entries()) {
      if (!currentMemberUids.has(uid) || uid === localUid) {
        this.scene.remove(rig.avatar.root);
        rig.nameTag.tex.dispose();
        rig.nameTag.mat.dispose();
        this.remoteAvatars.delete(uid);
      }
    }

    // Add or update existing avatars
    for (const [uid, member] of Object.entries(this.activeMembers)) {
      if (uid === localUid) continue;

      let rig = this.remoteAvatars.get(uid);
      if (!rig) {
        const avatarColor = member.color || '#803747';
        const gender = member.gender || 'Male';
        const avatar = createAvatar(avatarColor, gender);
        const nameTag = createBillboardSprite(member.name || 'Guest', '#f5eedc', member.seatId || undefined);
        avatar.root.add(nameTag.sprite);
        this.scene.add(avatar.root);

        rig = {
          id: uid,
          name: member.name,
          color: avatarColor,
          gender,
          seatId: member.seatId,
          avatar,
          nameTag,
          currentPos: new THREE.Vector3(6.45, 0.32, 5.9),
          targetPos: new THREE.Vector3(6.45, 0.32, 5.9),
          currentYaw: 0,
          targetYaw: 0,
          state: member.seatId ? 'seated' : 'standing',
          walkPhase: 0
        };
        rig.avatar.root.position.copy(rig.currentPos);
        this.remoteAvatars.set(uid, rig);
      }

      // Update color if modified
      if (member.color && member.color !== rig.color) {
        rig.color = member.color;
        rig.avatar.jacket.color.set(member.color);
      }

      // Update name & seat badge
      if (member.seatId !== rig.seatId || member.name !== rig.name) {
        rig.seatId = member.seatId;
        rig.name = member.name;
        rig.nameTag.redraw(member.name, member.seatId || undefined);
        rig.nameTag.tex.needsUpdate = true;
      }
    }
  }

  private applyIncomingPoses() {
    const localUid = partyService.getUid();
    for (const [uid, pose] of Object.entries(this.activePoses)) {
      if (uid === localUid) continue;
      const rig = this.remoteAvatars.get(uid);
      if (!rig) continue;

      rig.targetPos.set(pose.x, pose.y, pose.z);
      rig.targetYaw = pose.yaw;
      rig.state = pose.state;
    }
  }

  /**
   * FEATURE B: Seat reservation with mutual exclusion check and transaction.
   */
  public async requestSeatReservation(seatId: string): Promise<boolean> {
    const currentOccupant = this.activeSeats[seatId];
    const localUid = partyService.getUid();

    if (currentOccupant && currentOccupant !== localUid) {
      this.onToast(`Seat ${seatId} is already occupied. Choose another recliner.`);
      return false;
    }

    const res = await partyService.claimSeat(seatId);
    if (!res.success) {
      this.onToast(res.reason || `Seat ${seatId} is already occupied. Choose another recliner.`);
      return false;
    }

    this.onToast(`Seat ${seatId} reserved! Moving to your recliner.`);
    this.onTriggerWalkToSeat(seatId);
    return true;
  }

  /**
   * Releases current seat when standing up.
   */
  public async releaseCurrentSeat(): Promise<void> {
    const activeSeat = partyService.getActiveSeat();
    if (activeSeat) {
      await partyService.releaseSeat(activeSeat);
    }
  }

  /**
   * FEATURE C: Video Drift Correction for Guests
   */
  public syncVideoElement(video: HTMLVideoElement, isHost: boolean) {
    if (!video || !this.activePlayback) return;

    if (isHost) {
      // Host broadcasts playback status if changed
      return;
    }

    const { playing, time, rate, updatedAt } = this.activePlayback;
    const now = Date.now();
    const elapsedSinceUpdate = playing ? (now - updatedAt) / 1000 * rate : 0;
    const expectedTime = time + elapsedSinceUpdate;

    // Silent drift correction within 1.5s tolerance
    const drift = Math.abs(video.currentTime - expectedTime);
    if (drift > 1.5 && Number.isFinite(expectedTime) && expectedTime >= 0) {
      try {
        video.currentTime = expectedTime;
      } catch {}
    }

    // Match playback rate
    if (video.playbackRate !== rate && Number.isFinite(rate) && rate > 0) {
      video.playbackRate = rate;
    }

    // Match playing/paused state
    if (playing && video.paused) {
      video.play().catch(() => {});
    } else if (!playing && !video.paused) {
      video.pause();
    }
  }

  /**
   * Update loop: smoothly lerps remote avatars, swings walk cycles, and handles seated poses.
   */
  public update(
    dt: number,
    elapsed: number,
    localPlayerPos: THREE.Vector3,
    localYaw: number,
    localPitch: number,
    localState: 'walking' | 'standing' | 'seated'
  ) {
    // 1. Send local player pose heartbeat throttled to 110ms
    if (partyService.getActiveRoom()) {
      partyService.updatePose({
        x: Number(localPlayerPos.x.toFixed(3)),
        y: Number(localPlayerPos.y.toFixed(3)),
        z: Number(localPlayerPos.z.toFixed(3)),
        yaw: Number(localYaw.toFixed(3)),
        pitch: Number(localPitch.toFixed(3)),
        state: localState
      });
    }

    // 2. Smoothly lerp remote avatars
    const blend = 1 - Math.exp(-dt * 14);

    this.remoteAvatars.forEach((rig) => {
      // If member is seated in a recliner
      if (rig.seatId) {
        const recliner = seats.find((s) => s.id === rig.seatId);
        if (recliner) {
          rig.avatar.root.position.lerp(recliner.sitPosition, blend);
          rig.avatar.root.rotation.y = THREE.MathUtils.lerp(rig.avatar.root.rotation.y, 0, blend);
          rig.avatar.legs.forEach((l) => (l.rotation.x = THREE.MathUtils.lerp(l.rotation.x, 1.4, blend)));
          rig.avatar.knees.forEach((k) => (k.rotation.x = THREE.MathUtils.lerp(k.rotation.x, -1.4, blend)));
          rig.avatar.arms.forEach((a) => (a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, -0.35, blend)));
          return;
        }
      }

      // Standing / Walking in the theatre
      rig.avatar.root.position.lerp(rig.targetPos, blend);
      const angleDiff = Math.atan2(
        Math.sin(rig.targetYaw - rig.avatar.root.rotation.y),
        Math.cos(rig.targetYaw - rig.avatar.root.rotation.y)
      );
      rig.avatar.root.rotation.y += angleDiff * blend;
      rig.avatar.knees.forEach((k) => (k.rotation.x = THREE.MathUtils.lerp(k.rotation.x, 0, blend)));

      if (rig.state === 'walking') {
        rig.walkPhase += dt * 8;
        rig.avatar.arms.forEach((a, i) => (a.rotation.x = Math.sin(rig.walkPhase + i * Math.PI) * 0.45));
        rig.avatar.legs.forEach((l, i) => (l.rotation.x = Math.sin(rig.walkPhase + i * Math.PI + Math.PI) * 0.4));
      } else {
        rig.avatar.arms.forEach((a) => (a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, 0, blend)));
        rig.avatar.legs.forEach((l) => (l.rotation.x = THREE.MathUtils.lerp(l.rotation.x, 0, blend)));
      }
    });
  }

  public getOccupiedSeats(): RoomSeats {
    return this.activeSeats;
  }

  public dispose() {
    this.detach();
    this.seatMarkers.forEach((marker) => {
      this.scene.remove(marker.sprite);
      marker.tex.dispose();
      marker.mat.dispose();
    });
    this.seatMarkers.clear();
  }
}
