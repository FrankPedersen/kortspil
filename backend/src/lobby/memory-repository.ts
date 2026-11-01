import { randomUUID } from 'node:crypto';
import {
  createGameSnapshot,
  createInitialGameState,
  type GameSeat,
  type MultiplayerGameState,
} from '../game/state.js';
import {
  applyKasinoAction,
  getKasinoMoveOptions,
  type KasinoTurnAction,
} from '../game/kasino-engine.js';
import { applyEsMakkerAction, type EsMakkerAction } from '../game/es-makker-engine.js';
import {
  LobbyError,
  type CreateTableInput,
  type LobbyRepository,
  type SeatRequestSummary,
  type TableSummary,
  type VipRequestSummary,
} from './types.js';

interface StoredTable extends Omit<TableSummary, 'isHost'> {
  ownerSubject: string;
  seats: string[];
  gameState: MultiplayerGameState | null;
}

interface StoredSeatRequest extends SeatRequestSummary {
  status: 'pending' | 'accepted' | 'declined';
}

interface StoredVipRequest {
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  approvedAt?: string;
}

export class MemoryLobbyRepository implements LobbyRepository {
  private readonly tables = new Map<string, StoredTable>();
  private readonly requests = new Map<string, StoredSeatRequest>();
  private readonly invitations = new Map<string, {
    id: string;
    tableId: string;
    expiresAt: Date;
    revoked: boolean;
  }>();
  private readonly vip = new Map<string, StoredVipRequest>();

  async listTables(userSubject: string): Promise<TableSummary[]> {
    const visible = [...this.tables.values()].filter(table =>
      (table.visibility === 'open' && table.status === 'waiting') ||
      table.ownerSubject === userSubject ||
      table.seats.includes(userSubject),
    );
    return visible.map(table => this.toSummary(table, userSubject));
  }

  async createTable(userSubject: string, input: CreateTableInput): Promise<TableSummary> {
    if ([...this.tables.values()].some(table =>
      table.status !== 'finished' && table.status !== 'expired' && table.seats.includes(userSubject),
    )) {
      throw new LobbyError(409, 'You already have an active multiplayer seat.');
    }

    validateComposition(input);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const seats = Array.from({ length: input.humanSeatCount }, (_, index) =>
      index === 0 ? userSubject : '',
    );
    const table: StoredTable = {
      id,
      gameType: input.gameType,
      visibility: input.visibility,
      ownerSubject: userSubject,
      humanSeatCount: input.humanSeatCount,
      botSeatCount: input.botSeatCount,
      occupiedHumanSeatCount: 1,
      pendingRequestCount: 0,
      status: 'waiting',
      createdAt,
      seats,
      gameState: null,
    };
    this.tables.set(id, table);
    return this.toSummary(table, userSubject);
  }

  async requestSeat(
    tableId: string,
    userSubject: string,
    invitationTokenHash?: Buffer,
  ): Promise<void> {
    const table = this.tables.get(tableId);
    if (!table || table.status !== 'waiting') throw new LobbyError(404, 'Waiting table not found.');
    if (table.ownerSubject === userSubject) throw new LobbyError(409, 'You already own this table.');
    if ([...this.tables.values()].some(candidate =>
      candidate.status !== 'finished' && candidate.status !== 'expired' &&
      candidate.seats.includes(userSubject),
    )) {
      throw new LobbyError(409, 'You already have an active multiplayer seat.');
    }
    if (table.visibility === 'private' && !this.hasValidInvitation(tableId, invitationTokenHash)) {
      throw new LobbyError(403, 'A valid invitation is required for this table.');
    }
    if ([...this.requests.values()].some(request =>
      request.tableId === tableId && request.userSubject === userSubject && request.status === 'pending',
    )) {
      throw new LobbyError(409, 'A seat request is already pending.');
    }
    const id = randomUUID();
    this.requests.set(id, {
      id,
      tableId,
      userSubject,
      isVip: this.vip.get(userSubject)?.status === 'approved',
      requestedAt: new Date().toISOString(),
      status: 'pending',
    });
    table.pendingRequestCount += 1;
  }

  async listSeatRequests(tableId: string, ownerSubject: string): Promise<SeatRequestSummary[]> {
    const table = this.getOwnedTable(tableId, ownerSubject);
    return [...this.requests.values()]
      .filter(request => request.tableId === table.id && request.status === 'pending')
      .sort((left, right) => Number(right.isVip) - Number(left.isVip) ||
        left.requestedAt.localeCompare(right.requestedAt))
      .map(({ id, tableId: requestTableId, userSubject, isVip, requestedAt }) => ({
        id,
        tableId: requestTableId,
        userSubject,
        isVip,
        requestedAt,
      }));
  }

  async decideSeatRequest(
    requestId: string,
    ownerSubject: string,
    decision: 'accept' | 'decline',
  ): Promise<void> {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') throw new LobbyError(404, 'Pending seat request not found.');
    const table = this.getOwnedTable(request.tableId, ownerSubject);
    if (table.status !== 'waiting') throw new LobbyError(409, 'The table is no longer waiting.');

    if (decision === 'accept') {
      if (table.occupiedHumanSeatCount >= table.humanSeatCount) {
        throw new LobbyError(409, 'There are no human seats available.');
      }
      if ([...this.tables.values()].some(candidate =>
        candidate.status !== 'finished' && candidate.status !== 'expired' &&
        candidate.seats.includes(request.userSubject),
      )) {
        throw new LobbyError(409, 'This player already has an active multiplayer seat.');
      }
      const emptySeat = table.seats.indexOf('');
      if (emptySeat === -1) throw new LobbyError(409, 'There are no human seats available.');
      table.seats[emptySeat] = request.userSubject;
      table.occupiedHumanSeatCount += 1;
      request.status = 'accepted';
    } else {
      request.status = 'declined';
    }
    table.pendingRequestCount -= 1;
  }

  async createInvitation(
    tableId: string,
    ownerSubject: string,
    tokenHash: Buffer,
    expiresAt: Date,
  ): Promise<string> {
    const table = this.getOwnedTable(tableId, ownerSubject);
    if (table.visibility !== 'private' || table.status !== 'waiting') {
      throw new LobbyError(409, 'Invitations are only available for waiting private tables.');
    }
    const id = randomUUID();
    this.invitations.set(tokenHash.toString('hex'), { id, tableId, expiresAt, revoked: false });
    return id;
  }

  async revokeInvitation(invitationId: string, ownerSubject: string): Promise<void> {
    const invitation = [...this.invitations.values()].find(item => item.id === invitationId);
    if (!invitation) throw new LobbyError(404, 'Invitation not found.');
    this.getOwnedTable(invitation.tableId, ownerSubject);
    invitation.revoked = true;
  }

  async requestVip(userSubject: string): Promise<VipRequestSummary> {
    const current = this.vip.get(userSubject);
    if (current?.status === 'approved') return { status: 'approved', requestedAt: current.requestedAt };
    if (current?.status === 'pending') return { status: 'pending', requestedAt: current.requestedAt };

    const request = { status: 'pending' as const, requestedAt: new Date().toISOString() };
    this.vip.set(userSubject, request);
    return { status: request.status, requestedAt: request.requestedAt };
  }

  async listVipRequests(): Promise<Array<{ userSubject: string; requestedAt: string }>> {
    return [...this.vip.entries()]
      .filter(([, request]) => request.status === 'pending')
      .map(([userSubject, request]) => ({ userSubject, requestedAt: request.requestedAt }))
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  }

  async listVipMembers(): Promise<Array<{ userSubject: string; approvedAt: string }>> {
    return [...this.vip.entries()]
      .filter(([, request]) => request.status === 'approved')
      .map(([userSubject, request]) => ({
        userSubject,
        approvedAt: request.approvedAt ?? request.requestedAt,
      }))
      .sort((left, right) => left.approvedAt.localeCompare(right.approvedAt));
  }

  async decideVipRequest(
    userSubject: string,
    _adminSubject: string,
    decision: 'approve' | 'deny' | 'remove',
  ): Promise<void> {
    const current = this.vip.get(userSubject);
    if (decision === 'remove') {
      if (current?.status !== 'approved') throw new LobbyError(404, 'VIP member not found.');
      this.vip.delete(userSubject);
      return;
    }
    if (current?.status !== 'pending') throw new LobbyError(404, 'Pending VIP request not found.');
    this.vip.set(userSubject, {
      status: decision === 'approve' ? 'approved' : 'denied',
      requestedAt: current.requestedAt,
      ...(decision === 'approve' ? { approvedAt: new Date().toISOString() } : {}),
    });
  }

  async startGame(tableId: string, ownerSubject: string) {
    const table = this.getOwnedTable(tableId, ownerSubject);
    if (table.status !== 'waiting') throw new LobbyError(409, 'The table is not waiting to start.');
    if (table.gameType === 'kasino' && table.botSeatCount > 0) {
      throw new LobbyError(409, 'Online Kasino currently requires human players in every seat.');
    }
    if (table.seats.some(subject => subject.length === 0)) {
      throw new LobbyError(409, 'All human seats must be occupied before the game starts.');
    }

    const seats: GameSeat[] = [
      ...table.seats.map((userSubject, seatNumber) => ({
        seatNumber,
        kind: 'human' as const,
        userSubject,
      })),
      ...Array.from({ length: table.botSeatCount }, (_, botIndex) => ({
        seatNumber: table.humanSeatCount + botIndex,
        kind: 'bot' as const,
        userSubject: null,
      })),
    ];
    const state = createInitialGameState(table.gameType, seats, ownerSubject);
    table.gameState = state;
    table.status = 'active';
    return createGameSnapshot(state, ownerSubject);
  }

  async getGameSnapshot(tableId: string, userSubject: string) {
    const table = this.tables.get(tableId);
    if (!table) throw new LobbyError(404, 'Game table not found.');
    if (!table.seats.includes(userSubject)) {
      throw new LobbyError(403, 'You do not occupy a seat at this table.');
    }
    if (!table.gameState || !['active', 'finished'].includes(table.status)) {
      throw new LobbyError(409, 'The game has not started.');
    }
    return createGameSnapshot(table.gameState, userSubject);
  }

  async getKasinoMoveOptions(
    tableId: string,
    userSubject: string,
    handCardId: string,
    targetItemIds: string[],
  ) {
    const table = this.getActiveTable(tableId, userSubject);
    if (!table.gameState || table.gameState.gameType !== 'kasino') {
      throw new LobbyError(409, 'This Kasino game is not active.');
    }
    const seatNumber = table.seats.indexOf(userSubject);
    return getKasinoMoveOptions(table.gameState, seatNumber, handCardId, targetItemIds);
  }

  async playKasinoTurn(
    tableId: string,
    userSubject: string,
    expectedVersion: number,
    action: KasinoTurnAction,
  ) {
    const table = this.getActiveTable(tableId, userSubject);
    if (!table.gameState || table.gameState.gameType !== 'kasino') {
      throw new LobbyError(409, 'This table is not a Kasino game.');
    }
    const seatNumber = table.seats.indexOf(userSubject);
    table.gameState = applyKasinoAction(table.gameState, seatNumber, expectedVersion, action);
    if (table.gameState.winner !== null) table.status = 'finished';
    return createGameSnapshot(table.gameState, userSubject);
  }

  async playEsMakkerAction(
    tableId: string,
    userSubject: string,
    expectedVersion: number,
    action: EsMakkerAction,
  ) {
    const table = this.getActiveTable(tableId, userSubject);
    if (!table.gameState || table.gameState.gameType !== 'es-makker') {
      throw new LobbyError(409, 'This table is not an Es Makker game.');
    }
    const seatNumber = table.seats.indexOf(userSubject);
    table.gameState = applyEsMakkerAction(table.gameState, seatNumber, expectedVersion, action);
    if (table.gameState.phase === 'finished') table.status = 'finished';
    return createGameSnapshot(table.gameState, userSubject);
  }

  private hasValidInvitation(tableId: string, tokenHash?: Buffer): boolean {
    if (!tokenHash) return false;
    const invitation = this.invitations.get(tokenHash.toString('hex'));
    return invitation?.tableId === tableId &&
      !invitation.revoked &&
      invitation.expiresAt.getTime() > Date.now();
  }

  private getOwnedTable(tableId: string, ownerSubject: string): StoredTable {
    const table = this.tables.get(tableId);
    if (!table) throw new LobbyError(404, 'Table not found.');
    if (table.ownerSubject !== ownerSubject) throw new LobbyError(403, 'Only the table host can perform this action.');
    return table;
  }

  private getActiveTable(tableId: string, userSubject: string): StoredTable {
    const table = this.tables.get(tableId);
    if (!table) throw new LobbyError(404, 'Game table not found.');
    if (!table.seats.includes(userSubject)) {
      throw new LobbyError(403, 'You do not occupy a seat at this table.');
    }
    if (!table.gameState || table.status !== 'active') {
      throw new LobbyError(409, 'This game is not active.');
    }
    return table;
  }

  private toSummary(table: StoredTable, userSubject: string): TableSummary {
    return {
      id: table.id,
      isHost: table.ownerSubject === userSubject,
      gameType: table.gameType,
      visibility: table.visibility,
      humanSeatCount: table.humanSeatCount,
      botSeatCount: table.botSeatCount,
      occupiedHumanSeatCount: table.occupiedHumanSeatCount,
      pendingRequestCount: [...this.requests.values()].filter(request =>
        request.tableId === table.id && request.status === 'pending',
      ).length,
      status: table.status,
      createdAt: table.createdAt,
    };
  }
}

function validateComposition(input: CreateTableInput): void {
  if (
    !Number.isInteger(input.humanSeatCount) ||
    !Number.isInteger(input.botSeatCount) ||
    input.humanSeatCount < 1 ||
    input.botSeatCount < 0 ||
    (input.gameType === 'es-makker' &&
      (input.humanSeatCount !== 4 || input.botSeatCount !== 0)) ||
    (input.gameType === 'kasino' &&
      (input.humanSeatCount + input.botSeatCount < 2 || input.humanSeatCount + input.botSeatCount > 4))
  ) {
    throw new LobbyError(400, 'The player and robot seat counts are invalid for this game.');
  }
}
