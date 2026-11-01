import sql from 'mssql';
import {
  createGameSnapshot,
  createInitialGameState,
  parseGameState,
  type GameSeat,
} from '../game/state.js';
import { LobbyError, type CreateTableInput, type LobbyRepository, type TableSummary, type VipRequestSummary } from './types.js';

interface DatabaseTableRow {
  TableId: string;
  GameType: 'es-makker' | 'kasino';
  Visibility: 'open' | 'private';
  OwnerSubject: string;
  HumanSeatCount: number;
  BotSeatCount: number;
  OccupiedHumanSeatCount: number;
  PendingRequestCount: number;
  Status: 'waiting' | 'active' | 'finished' | 'expired';
  CreatedAt: Date;
}

function mapTable(row: DatabaseTableRow, userSubject: string): TableSummary {
  return {
    id: row.TableId,
    isHost: row.OwnerSubject === userSubject,
    gameType: row.GameType,
    visibility: row.Visibility,
    humanSeatCount: row.HumanSeatCount,
    botSeatCount: row.BotSeatCount,
    occupiedHumanSeatCount: row.OccupiedHumanSeatCount,
    pendingRequestCount: row.PendingRequestCount,
    status: row.Status,
    createdAt: row.CreatedAt.toISOString(),
  };
}

export class SqlLobbyRepository implements LobbyRepository {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async listTables(userSubject: string): Promise<TableSummary[]> {
    const result = await this.pool.request()
      .input('userSubject', sql.NVarChar(300), userSubject)
      .query<DatabaseTableRow>(`
        SELECT t.TableId, t.GameType, t.Visibility, t.OwnerSubject,
               t.HumanSeatCount, t.BotSeatCount, t.Status, t.CreatedAt,
               SUM(CASE WHEN s.SeatKind = 'human' AND s.UserSubject IS NOT NULL THEN 1 ELSE 0 END) AS OccupiedHumanSeatCount,
               (SELECT COUNT(*) FROM dbo.GameSeatRequests r
                WHERE r.TableId = t.TableId AND r.Status = 'pending') AS PendingRequestCount
        FROM dbo.GameTables t
        LEFT JOIN dbo.GameSeats s ON s.TableId = t.TableId
        WHERE (t.Visibility = 'open' AND t.Status = 'waiting')
           OR t.OwnerSubject = @userSubject
           OR EXISTS (
               SELECT 1 FROM dbo.GameSeats mine
               WHERE mine.TableId = t.TableId AND mine.UserSubject = @userSubject AND mine.IsActive = 1
           )
        GROUP BY t.TableId, t.GameType, t.Visibility, t.OwnerSubject,
                 t.HumanSeatCount, t.BotSeatCount, t.Status, t.CreatedAt
        ORDER BY t.CreatedAt DESC;
      `);
    return result.recordset.map(row => mapTable(row, userSubject));
  }

  async createTable(userSubject: string, input: CreateTableInput): Promise<TableSummary> {
    validateComposition(input);
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const activeSeat = await new sql.Request(transaction)
        .input('userSubject', sql.NVarChar(300), userSubject)
        .query(`
          SELECT TOP (1) 1 AS HasSeat
          FROM dbo.GameSeats WITH (UPDLOCK, HOLDLOCK)
          WHERE UserSubject = @userSubject AND IsActive = 1;
        `);
      if (activeSeat.recordset.length > 0) {
        throw new LobbyError(409, 'You already have an active multiplayer seat.');
      }

      const created = await new sql.Request(transaction)
        .input('gameType', sql.VarChar(16), input.gameType)
        .input('visibility', sql.VarChar(8), input.visibility)
        .input('ownerSubject', sql.NVarChar(300), userSubject)
        .input('humanSeatCount', sql.TinyInt, input.humanSeatCount)
        .input('botSeatCount', sql.TinyInt, input.botSeatCount)
        .query<{ TableId: string; CreatedAt: Date }>(`
          INSERT INTO dbo.GameTables
            (GameType, Visibility, OwnerSubject, HumanSeatCount, BotSeatCount, Status)
          OUTPUT inserted.TableId, inserted.CreatedAt
          VALUES (@gameType, @visibility, @ownerSubject, @humanSeatCount, @botSeatCount, 'waiting');
        `);
      const table = created.recordset[0];
      if (!table) throw new Error('Database did not return the newly created table.');

      for (let seatNumber = 0; seatNumber < input.humanSeatCount; seatNumber += 1) {
        await new sql.Request(transaction)
          .input('tableId', sql.UniqueIdentifier, table.TableId)
          .input('seatNumber', sql.TinyInt, seatNumber)
          .input('userSubject', sql.NVarChar(300), seatNumber === 0 ? userSubject : null)
          .query(`
            INSERT INTO dbo.GameSeats (TableId, SeatNumber, SeatKind, UserSubject, IsActive)
            VALUES (@tableId, @seatNumber, 'human', @userSubject, CASE WHEN @userSubject IS NULL THEN 0 ELSE 1 END);
          `);
      }
      for (let botIndex = 0; botIndex < input.botSeatCount; botIndex += 1) {
        await new sql.Request(transaction)
          .input('tableId', sql.UniqueIdentifier, table.TableId)
          .input('seatNumber', sql.TinyInt, input.humanSeatCount + botIndex)
          .query(`
            INSERT INTO dbo.GameSeats (TableId, SeatNumber, SeatKind, UserSubject, IsActive)
            VALUES (@tableId, @seatNumber, 'bot', NULL, 1);
          `);
      }

      await transaction.commit();
      return {
        id: table.TableId,
        isHost: true,
        gameType: input.gameType,
        visibility: input.visibility,
        humanSeatCount: input.humanSeatCount,
        botSeatCount: input.botSeatCount,
        occupiedHumanSeatCount: 1,
        pendingRequestCount: 0,
        status: 'waiting',
        createdAt: table.CreatedAt.toISOString(),
      };
    } catch (error) {
      await rollbackPreservingError(transaction);
      if (isUniqueConstraintError(error)) {
        throw new LobbyError(409, 'You already have an active multiplayer seat.');
      }
      throw error;
    }
  }

  async requestSeat(tableId: string, userSubject: string, invitationTokenHash?: Buffer): Promise<void> {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const tableResult = await new sql.Request(transaction)
        .input('tableId', sql.UniqueIdentifier, tableId)
        .query<{ Visibility: string; Status: string; OwnerSubject: string }>(`
          SELECT Visibility, Status, OwnerSubject
          FROM dbo.GameTables WITH (UPDLOCK, HOLDLOCK)
          WHERE TableId = @tableId;
        `);
      const table = tableResult.recordset[0];
      if (!table || table.Status !== 'waiting') throw new LobbyError(404, 'Waiting table not found.');
      if (table.OwnerSubject === userSubject) throw new LobbyError(409, 'You already own this table.');

      if (table.Visibility === 'private') {
        if (!invitationTokenHash) throw new LobbyError(403, 'A valid invitation is required for this table.');
        const invite = await new sql.Request(transaction)
          .input('tableId', sql.UniqueIdentifier, tableId)
          .input('tokenHash', sql.VarBinary(32), invitationTokenHash)
          .query(`
            SELECT TOP (1) 1 AS IsValid
            FROM dbo.GameInvitations
            WHERE TableId = @tableId AND TokenHash = @tokenHash
              AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME();
          `);
        if (invite.recordset.length === 0) {
          throw new LobbyError(403, 'A valid invitation is required for this table.');
        }
      }

      const activeSeat = await new sql.Request(transaction)
        .input('userSubject', sql.NVarChar(300), userSubject)
        .query(`
          SELECT TOP (1) 1 AS HasSeat
          FROM dbo.GameSeats WITH (UPDLOCK, HOLDLOCK)
          WHERE UserSubject = @userSubject AND IsActive = 1;
        `);
      if (activeSeat.recordset.length > 0) {
        throw new LobbyError(409, 'You already have an active multiplayer seat.');
      }

      await new sql.Request(transaction)
        .input('tableId', sql.UniqueIdentifier, tableId)
        .input('userSubject', sql.NVarChar(300), userSubject)
        .query(`
          IF EXISTS (
            SELECT 1 FROM dbo.GameSeatRequests
            WHERE TableId = @tableId AND UserSubject = @userSubject AND Status = 'pending'
          )
            THROW 51001, 'A seat request is already pending.', 1;

          INSERT INTO dbo.GameSeatRequests (TableId, UserSubject, Status)
          VALUES (@tableId, @userSubject, 'pending');
        `);
      await transaction.commit();
    } catch (error) {
      await rollbackPreservingError(transaction);
      if (isUniqueConstraintError(error) || isDuplicateRequestError(error)) {
        throw new LobbyError(409, 'A seat request is already pending or you already have a seat.');
      }
      throw error;
    }
  }

  async listSeatRequests(tableId: string, ownerSubject: string) {
    const result = await this.pool.request()
      .input('tableId', sql.UniqueIdentifier, tableId)
      .input('ownerSubject', sql.NVarChar(300), ownerSubject)
      .query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.GameTables WHERE TableId = @tableId AND OwnerSubject = @ownerSubject
        )
          THROW 51002, 'Table not found or host access denied.', 1;

        SELECT r.RequestId AS id, r.TableId AS tableId, r.UserSubject AS userSubject,
               CAST(CASE WHEN v.UserSubject IS NULL THEN 0 ELSE 1 END AS bit) AS isVip,
               r.RequestedAt AS requestedAt
        FROM dbo.GameSeatRequests r
        LEFT JOIN dbo.VipMembers v ON v.UserSubject = r.UserSubject
        WHERE r.TableId = @tableId AND r.Status = 'pending'
        ORDER BY CASE WHEN v.UserSubject IS NULL THEN 1 ELSE 0 END, r.RequestedAt;
      `);
    return result.recordset.map((row: {
      id: string;
      tableId: string;
      userSubject: string;
      isVip: boolean;
      requestedAt: Date;
    }) => ({ ...row, requestedAt: row.requestedAt.toISOString() }));
  }

  async decideSeatRequest(
    requestId: string,
    ownerSubject: string,
    decision: 'accept' | 'decline',
  ): Promise<void> {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const requestResult = await new sql.Request(transaction)
        .input('requestId', sql.UniqueIdentifier, requestId)
        .input('ownerSubject', sql.NVarChar(300), ownerSubject)
        .query<{ TableId: string; UserSubject: string }>(`
          SELECT r.TableId, r.UserSubject
          FROM dbo.GameSeatRequests r WITH (UPDLOCK, HOLDLOCK)
          JOIN dbo.GameTables t WITH (UPDLOCK, HOLDLOCK) ON t.TableId = r.TableId
          WHERE r.RequestId = @requestId AND r.Status = 'pending'
            AND t.OwnerSubject = @ownerSubject AND t.Status = 'waiting';
        `);
      const requestRow = requestResult.recordset[0];
      if (!requestRow) throw new LobbyError(404, 'Pending seat request not found.');

      if (decision === 'accept') {
        const activeSeat = await new sql.Request(transaction)
          .input('userSubject', sql.NVarChar(300), requestRow.UserSubject)
          .query(`
            SELECT TOP (1) 1 AS HasSeat
            FROM dbo.GameSeats WITH (UPDLOCK, HOLDLOCK)
            WHERE UserSubject = @userSubject AND IsActive = 1;
          `);
        if (activeSeat.recordset.length > 0) {
          throw new LobbyError(409, 'This player already has an active multiplayer seat.');
        }

        const seat = await new sql.Request(transaction)
          .input('tableId', sql.UniqueIdentifier, requestRow.TableId)
          .input('userSubject', sql.NVarChar(300), requestRow.UserSubject)
          .query(`
            ;WITH available AS (
              SELECT TOP (1) *
              FROM dbo.GameSeats WITH (UPDLOCK, ROWLOCK)
              WHERE TableId = @tableId AND SeatKind = 'human' AND UserSubject IS NULL
              ORDER BY SeatNumber
            )
            UPDATE available
            SET UserSubject = @userSubject, IsActive = 1, LastConnectedAt = SYSUTCDATETIME()
            OUTPUT inserted.SeatNumber;
          `);
        if (seat.recordset.length === 0) throw new LobbyError(409, 'There are no human seats available.');
      }

      await new sql.Request(transaction)
        .input('requestId', sql.UniqueIdentifier, requestId)
        .input('status', sql.VarChar(10), decision === 'accept' ? 'accepted' : 'declined')
        .query(`
          UPDATE dbo.GameSeatRequests
          SET Status = @status, ReviewedAt = SYSUTCDATETIME()
          WHERE RequestId = @requestId AND Status = 'pending';
        `);
      await transaction.commit();
    } catch (error) {
      await rollbackPreservingError(transaction);
      if (isUniqueConstraintError(error)) {
        throw new LobbyError(409, 'This player already has an active multiplayer seat.');
      }
      throw error;
    }
  }

  async createInvitation(
    tableId: string,
    ownerSubject: string,
    tokenHash: Buffer,
    expiresAt: Date,
  ): Promise<string> {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const table = await new sql.Request(transaction)
        .input('tableId', sql.UniqueIdentifier, tableId)
        .input('ownerSubject', sql.NVarChar(300), ownerSubject)
        .query<{ Visibility: string; Status: string }>(`
          SELECT Visibility, Status
          FROM dbo.GameTables WITH (UPDLOCK, HOLDLOCK)
          WHERE TableId = @tableId AND OwnerSubject = @ownerSubject;
        `);
      const ownedTable = table.recordset[0];
      if (!ownedTable) throw new LobbyError(404, 'Table not found.');
      if (ownedTable.Visibility !== 'private' || ownedTable.Status !== 'waiting') {
        throw new LobbyError(409, 'Invitations are only available for waiting private tables.');
      }

      const result = await new sql.Request(transaction)
        .input('tableId', sql.UniqueIdentifier, tableId)
        .input('ownerSubject', sql.NVarChar(300), ownerSubject)
        .input('tokenHash', sql.VarBinary(32), tokenHash)
        .input('expiresAt', sql.DateTime2(3), expiresAt)
        .query<{ InvitationId: string }>(`
          INSERT INTO dbo.GameInvitations (TableId, TokenHash, CreatedBy, ExpiresAt)
          OUTPUT inserted.InvitationId
          VALUES (@tableId, @tokenHash, @ownerSubject, @expiresAt);
        `);
      const invitation = result.recordset[0];
      if (!invitation) throw new Error('Database did not return the new invitation.');
      await transaction.commit();
      return invitation.InvitationId;
    } catch (error) {
      await rollbackPreservingError(transaction);
      throw error;
    }
  }

  async revokeInvitation(invitationId: string, ownerSubject: string): Promise<void> {
    const result = await this.pool.request()
      .input('invitationId', sql.UniqueIdentifier, invitationId)
      .input('ownerSubject', sql.NVarChar(300), ownerSubject)
      .query(`
        UPDATE i
        SET RevokedAt = SYSUTCDATETIME()
        FROM dbo.GameInvitations i
        INNER JOIN dbo.GameTables t ON t.TableId = i.TableId
        WHERE i.InvitationId = @invitationId
          AND t.OwnerSubject = @ownerSubject
          AND i.RevokedAt IS NULL;
      `);
    if (result.rowsAffected.reduce((total, count) => total + count, 0) === 0) {
      throw new LobbyError(404, 'Invitation not found.');
    }
  }

  async requestVip(userSubject: string): Promise<VipRequestSummary> {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const member = await new sql.Request(transaction)
        .input('userSubject', sql.NVarChar(300), userSubject)
        .query<{ ApprovedAt: Date }>(`
          SELECT ApprovedAt FROM dbo.VipMembers WITH (UPDLOCK, HOLDLOCK)
          WHERE UserSubject = @userSubject;
        `);
      if (member.recordset[0]) {
        await transaction.commit();
        return { status: 'approved', requestedAt: null };
      }

      const existing = await new sql.Request(transaction)
        .input('userSubject', sql.NVarChar(300), userSubject)
        .query<{ RequestedAt: Date }>(`
          SELECT TOP (1) RequestedAt FROM dbo.VipRequests WITH (UPDLOCK, HOLDLOCK)
          WHERE UserSubject = @userSubject AND Status = 'pending'
          ORDER BY RequestedAt DESC;
        `);
      const current = existing.recordset[0];
      if (current) {
        await transaction.commit();
        return { status: 'pending', requestedAt: current.RequestedAt.toISOString() };
      }

      const created = await new sql.Request(transaction)
        .input('userSubject', sql.NVarChar(300), userSubject)
        .query<{ RequestedAt: Date }>(`
          INSERT INTO dbo.VipRequests (UserSubject, Status)
          OUTPUT inserted.RequestedAt
          VALUES (@userSubject, 'pending');
        `);
      const request = created.recordset[0];
      if (!request) throw new Error('Database did not return the VIP request status.');
      await transaction.commit();
      return { status: 'pending', requestedAt: request.RequestedAt.toISOString() };
    } catch (error) {
      await rollbackPreservingError(transaction);
      throw error;
    }
  }

  async listVipRequests(): Promise<Array<{ userSubject: string; requestedAt: string }>> {
    const result = await this.pool.request().query<{ UserSubject: string; RequestedAt: Date }>(`
      SELECT UserSubject, RequestedAt
      FROM dbo.VipRequests
      WHERE Status = 'pending'
      ORDER BY RequestedAt;
    `);
    return result.recordset.map(row => ({
      userSubject: row.UserSubject,
      requestedAt: row.RequestedAt.toISOString(),
    }));
  }

  async listVipMembers(): Promise<Array<{ userSubject: string; approvedAt: string }>> {
    const result = await this.pool.request().query<{ UserSubject: string; ApprovedAt: Date }>(`
      SELECT UserSubject, ApprovedAt
      FROM dbo.VipMembers
      ORDER BY ApprovedAt;
    `);
    return result.recordset.map(row => ({
      userSubject: row.UserSubject,
      approvedAt: row.ApprovedAt.toISOString(),
    }));
  }

  async decideVipRequest(
    userSubject: string,
    adminSubject: string,
    decision: 'approve' | 'deny' | 'remove',
  ): Promise<void> {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      if (decision === 'remove') {
        const removed = await new sql.Request(transaction)
          .input('userSubject', sql.NVarChar(300), userSubject)
          .query(`
            DELETE FROM dbo.VipMembers OUTPUT deleted.UserSubject
            WHERE UserSubject = @userSubject;
          `);
        if (removed.recordset.length === 0) throw new LobbyError(404, 'VIP member not found.');
        await new sql.Request(transaction)
          .input('adminSubject', sql.NVarChar(300), adminSubject)
          .input('targetSubject', sql.NVarChar(300), userSubject)
          .query(`
            INSERT INTO dbo.VipAuditLog (AdminSubject, TargetSubject, Action)
            VALUES (@adminSubject, @targetSubject, 'removed');
          `);
        await transaction.commit();
        return;
      }

      const pending = await new sql.Request(transaction)
        .input('userSubject', sql.NVarChar(300), userSubject)
        .input('decision', sql.VarChar(12), decision === 'approve' ? 'approved' : 'denied')
        .input('adminSubject', sql.NVarChar(300), adminSubject)
        .query(`
          UPDATE dbo.VipRequests WITH (UPDLOCK, HOLDLOCK)
          SET Status = @decision, ReviewedAt = SYSUTCDATETIME(), ReviewedBy = @adminSubject
          WHERE UserSubject = @userSubject AND Status = 'pending';
        `);
      if (pending.rowsAffected.reduce((total, count) => total + count, 0) === 0) {
        throw new LobbyError(404, 'Pending VIP request not found.');
      }

      if (decision === 'approve') {
        await new sql.Request(transaction)
          .input('userSubject', sql.NVarChar(300), userSubject)
          .input('adminSubject', sql.NVarChar(300), adminSubject)
          .query(`
            INSERT INTO dbo.VipMembers (UserSubject, ApprovedBy)
            VALUES (@userSubject, @adminSubject);
          `);
      }
      await new sql.Request(transaction)
        .input('adminSubject', sql.NVarChar(300), adminSubject)
        .input('targetSubject', sql.NVarChar(300), userSubject)
        .input('action', sql.VarChar(16), decision === 'approve' ? 'approved' : 'denied')
        .query(`
          INSERT INTO dbo.VipAuditLog (AdminSubject, TargetSubject, Action)
          VALUES (@adminSubject, @targetSubject, @action);
        `);
      await transaction.commit();
    } catch (error) {
      await rollbackPreservingError(transaction);
      throw error;
    }
  }

  async startGame(tableId: string, ownerSubject: string) {
    const transaction = new sql.Transaction(this.pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const tableResult = await new sql.Request(transaction)
        .input('tableId', sql.UniqueIdentifier, tableId)
        .input('ownerSubject', sql.NVarChar(300), ownerSubject)
        .query<{
          GameType: 'es-makker' | 'kasino';
          Status: string;
          HumanSeatCount: number;
          BotSeatCount: number;
        }>(`
          SELECT GameType, Status, HumanSeatCount, BotSeatCount
          FROM dbo.GameTables WITH (UPDLOCK, HOLDLOCK)
          WHERE TableId = @tableId AND OwnerSubject = @ownerSubject;
        `);
      const table = tableResult.recordset[0];
      if (!table) throw new LobbyError(404, 'Table not found.');
      if (table.Status !== 'waiting') throw new LobbyError(409, 'The table is not waiting to start.');

      const seatsResult = await new sql.Request(transaction)
        .input('tableId', sql.UniqueIdentifier, tableId)
        .query<{
          SeatNumber: number;
          SeatKind: 'human' | 'bot';
          UserSubject: string | null;
        }>(`
          SELECT SeatNumber, SeatKind, UserSubject
          FROM dbo.GameSeats WITH (UPDLOCK, HOLDLOCK)
          WHERE TableId = @tableId
          ORDER BY SeatNumber;
        `);
      const seats: GameSeat[] = seatsResult.recordset.map(seat => ({
        seatNumber: seat.SeatNumber,
        kind: seat.SeatKind,
        userSubject: seat.UserSubject,
      }));
      if (
        seats.filter(seat => seat.kind === 'human').length !== table.HumanSeatCount ||
        seats.filter(seat => seat.kind === 'bot').length !== table.BotSeatCount
      ) {
        throw new LobbyError(409, 'The table seat arrangement is incomplete.');
      }
      if (seats.some(seat => seat.kind === 'human' && !seat.userSubject)) {
        throw new LobbyError(409, 'All human seats must be occupied before the game starts.');
      }

      const state = createInitialGameState(table.GameType, seats, ownerSubject);
      const updated = await new sql.Request(transaction)
        .input('tableId', sql.UniqueIdentifier, tableId)
        .input('stateJson', sql.NVarChar(sql.MAX), JSON.stringify(state))
        .query(`
          UPDATE dbo.GameTables
          SET Status = 'active',
              StateJson = @stateJson,
              StateVersion = 1,
              LastActivityAt = SYSUTCDATETIME()
          WHERE TableId = @tableId AND Status = 'waiting';
        `);
      if (updated.rowsAffected.reduce((total, count) => total + count, 0) !== 1) {
        throw new LobbyError(409, 'The table changed while the game was starting.');
      }
      const snapshot = createGameSnapshot(state, ownerSubject);
      await transaction.commit();
      return snapshot;
    } catch (error) {
      await rollbackPreservingError(transaction);
      throw error;
    }
  }

  async getGameSnapshot(tableId: string, userSubject: string) {
    const result = await this.pool.request()
      .input('tableId', sql.UniqueIdentifier, tableId)
      .input('userSubject', sql.NVarChar(300), userSubject)
      .query<{ GameType: 'es-makker' | 'kasino'; StateJson: string | null }>(`
        SELECT t.GameType, t.StateJson
        FROM dbo.GameTables t
        INNER JOIN dbo.GameSeats s ON s.TableId = t.TableId
        WHERE t.TableId = @tableId AND s.UserSubject = @userSubject AND s.IsActive = 1;
      `);
    const row = result.recordset[0];
    if (!row) throw new LobbyError(403, 'You do not occupy a seat at this table.');
    if (!row.StateJson) throw new LobbyError(409, 'The game has not started.');
    return createGameSnapshot(parseGameState(row.StateJson, row.GameType), userSubject);
  }

}

export async function createSqlPool(): Promise<sql.ConnectionPool> {
  const server = process.env.SQL_SERVER;
  const database = process.env.SQL_DATABASE;
  if (!server || !database) throw new Error('SQL_SERVER and SQL_DATABASE must be configured.');

  const pool = new sql.ConnectionPool({
    server,
    database,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    authentication: {
      type: 'azure-active-directory-default',
      options: {},
    },
    pool: {
      max: Number(process.env.SQL_POOL_MAX ?? 10),
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  });
  return pool.connect();
}

function validateComposition(input: CreateTableInput): void {
  if (
    !Number.isInteger(input.humanSeatCount) ||
    !Number.isInteger(input.botSeatCount) ||
    input.humanSeatCount < 1 ||
    input.botSeatCount < 0 ||
    (input.gameType === 'es-makker' && input.humanSeatCount + input.botSeatCount !== 4) ||
    (input.gameType === 'kasino' &&
      (input.humanSeatCount + input.botSeatCount < 2 || input.humanSeatCount + input.botSeatCount > 4))
  ) {
    throw new LobbyError(400, 'The player and robot seat counts are invalid for this game.');
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof sql.RequestError && error.number === 2601 ||
    error instanceof sql.RequestError && error.number === 2627;
}

function isDuplicateRequestError(error: unknown): boolean {
  return error instanceof sql.RequestError && error.number === 51001;
}

async function rollbackPreservingError(transaction: sql.Transaction): Promise<void> {
  try {
    await transaction.rollback();
  } catch (rollbackError) {
    console.error('Failed to roll back a lobby SQL transaction.', rollbackError);
  }
}
