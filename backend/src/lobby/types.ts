import type { GameSnapshot } from '../game/state.js';
import type { KasinoMoveOption, KasinoTurnAction } from '../game/kasino-engine.js';
import type { EsMakkerAction } from '../game/es-makker-engine.js';

export type GameType = 'es-makker' | 'kasino';
export type TableVisibility = 'open' | 'private';
export type TableStatus = 'waiting' | 'active' | 'finished' | 'expired';
export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface TableSummary {
  id: string;
  isHost: boolean;
  gameType: GameType;
  visibility: TableVisibility;
  humanSeatCount: number;
  botSeatCount: number;
  occupiedHumanSeatCount: number;
  pendingRequestCount: number;
  status: TableStatus;
  createdAt: string;
}

export interface CreateTableInput {
  gameType: GameType;
  visibility: TableVisibility;
  humanSeatCount: number;
  botSeatCount: number;
}

export interface SeatRequestSummary {
  id: string;
  tableId: string;
  userSubject: string;
  isVip: boolean;
  requestedAt: string;
}

export interface InvitationSummary {
  id: string;
  token: string;
  expiresAt: string;
}

export interface VipRequestSummary {
  status: 'pending' | 'approved' | 'denied' | 'not-requested';
  requestedAt: string | null;
}

export interface LobbyRepository {
  listTables(userSubject: string): Promise<TableSummary[]>;
  createTable(userSubject: string, input: CreateTableInput): Promise<TableSummary>;
  requestSeat(tableId: string, userSubject: string, invitationTokenHash?: Buffer): Promise<void>;
  listSeatRequests(tableId: string, ownerSubject: string): Promise<SeatRequestSummary[]>;
  decideSeatRequest(
    requestId: string,
    ownerSubject: string,
    decision: 'accept' | 'decline',
  ): Promise<void>;
  createInvitation(
    tableId: string,
    ownerSubject: string,
    tokenHash: Buffer,
    expiresAt: Date,
  ): Promise<string>;
  revokeInvitation(invitationId: string, ownerSubject: string): Promise<void>;
  requestVip(userSubject: string): Promise<VipRequestSummary>;
  listVipRequests(): Promise<Array<{ userSubject: string; requestedAt: string }>>;
  listVipMembers(): Promise<Array<{ userSubject: string; approvedAt: string }>>;
  decideVipRequest(
    userSubject: string,
    adminSubject: string,
    decision: 'approve' | 'deny' | 'remove',
  ): Promise<void>;
  startGame(tableId: string, ownerSubject: string): Promise<GameSnapshot>;
  getGameSnapshot(tableId: string, userSubject: string): Promise<GameSnapshot>;
  getKasinoMoveOptions(
    tableId: string,
    userSubject: string,
    handCardId: string,
    targetItemIds: string[],
  ): Promise<KasinoMoveOption[]>;
  playKasinoTurn(
    tableId: string,
    userSubject: string,
    expectedVersion: number,
    action: KasinoTurnAction,
  ): Promise<GameSnapshot>;
  playEsMakkerAction(
    tableId: string,
    userSubject: string,
    expectedVersion: number,
    action: EsMakkerAction,
  ): Promise<GameSnapshot>;
}

export class LobbyError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'LobbyError';
  }
}
