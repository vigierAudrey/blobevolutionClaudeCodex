import type { UserRole } from './user';

export type ConversationType = 'RIDER_TO_RIDER' | 'RIDER_TO_PRO' | 'PRO_TO_PRO';

export interface ConversationParticipant {
  displayName: string;
  role: UserRole;
  photoUrl?: string | null;
}

export interface ThreadSummary {
  id: string;
  type: ConversationType;
  otherDisplayName: string;
  otherRole: UserRole;
  otherPhotoUrl?: string | null;
  lastMessage: string;
  lastAt: string;
  unread: number;
  trashed?: boolean;
  favorite?: boolean;
  blocked?: boolean;
  memberCount?: number;
  isGroup?: boolean;
  matchedAt?: Date | string | null;
}

export interface ThreadListResponse {
  items: ThreadSummary[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface ThreadListQuery {
  includeTrashed?: boolean;
  type?: Extract<ConversationType, 'RIDER_TO_RIDER' | 'RIDER_TO_PRO'>;
  limit?: number;
  cursor?: string;
}

export type MessageKind = 'TEXT' | 'PROPOSAL';

export interface MessageMeta {
  date?: string;
  place?: string;
  note?: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  senderId: string;
  type: MessageKind;
  content: string;
  meta?: MessageMeta | null;
  createdAt: string;
  senderName?: string;
  senderPhotoUrl?: string | null;
  isCurrentUser?: boolean;
  clientMsgId?: string; // For idempotence
}

export interface MessageListResponse {
  items: Message[];
}

export type SendMessagePayload =
  | { type: 'TEXT'; content: string; clientMsgId?: string }
  | { type: 'PROPOSAL'; content: string; meta: MessageMeta; clientMsgId?: string };
