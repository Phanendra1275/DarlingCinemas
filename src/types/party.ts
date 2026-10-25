export type SeatId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5';

export interface RoomMeta {
  code: string;
  title: string;
  hostId: string;
  online: boolean;
  screening: boolean;
  createdAt: number;
}

export interface RoomMedia {
  id: string;
  title: string;
  kind: 'stream' | 'file' | 'local';
  streamUrl?: string;
  posterPath?: string;
}

export interface RoomPlayback {
  playing: boolean;
  time: number;
  rate: number;
  updatedAt: number;
}

export interface RoomMember {
  id: string;
  name: string;
  color: string;
  seatId: string | null;
  joinedAt: number;
  muted: boolean;
  gender?: 'Male' | 'Female';
}

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  state: 'walking' | 'standing' | 'seated';
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  ts: number;
  seatId?: string | null;
}

export interface RoomSeats {
  [seatId: string]: string | null;
}

export interface RoomData {
  meta: RoomMeta;
  media: RoomMedia;
  playback: RoomPlayback;
  members: Record<string, RoomMember>;
  seats: RoomSeats;
  poses: Record<string, PlayerPose>;
  chat: Record<string, ChatMessage>;
}

export type PartyEventListener = {
  onMeta?: (meta: RoomMeta) => void;
  onMedia?: (media: RoomMedia) => void;
  onPlayback?: (playback: RoomPlayback) => void;
  onMembers?: (members: Record<string, RoomMember>) => void;
  onSeats?: (seats: RoomSeats) => void;
  onPoses?: (poses: Record<string, PlayerPose>) => void;
  onChat?: (chat: ChatMessage[]) => void;
  onError?: (err: Error) => void;
};
