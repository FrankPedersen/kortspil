CREATE TABLE dbo.UserProfiles (
    UserSubject nvarchar(300) NOT NULL PRIMARY KEY,
    DisplayName nvarchar(100) NOT NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_UserProfiles_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt datetime2(3) NOT NULL CONSTRAINT DF_UserProfiles_UpdatedAt DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.VipRequests (
    RequestId uniqueidentifier NOT NULL CONSTRAINT DF_VipRequests_RequestId DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    UserSubject nvarchar(300) NOT NULL,
    Status varchar(12) NOT NULL,
    RequestedAt datetime2(3) NOT NULL CONSTRAINT DF_VipRequests_RequestedAt DEFAULT SYSUTCDATETIME(),
    ReviewedAt datetime2(3) NULL,
    ReviewedBy nvarchar(300) NULL,
    CONSTRAINT CK_VipRequests_Status CHECK (Status IN ('pending', 'approved', 'denied', 'removed'))
);

CREATE UNIQUE INDEX UX_VipRequests_PendingUser
    ON dbo.VipRequests (UserSubject)
    WHERE Status = 'pending';

CREATE TABLE dbo.VipMembers (
    UserSubject nvarchar(300) NOT NULL PRIMARY KEY,
    ApprovedBy nvarchar(300) NOT NULL,
    ApprovedAt datetime2(3) NOT NULL CONSTRAINT DF_VipMembers_ApprovedAt DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.VipAuditLog (
    AuditId bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    AdminSubject nvarchar(300) NOT NULL,
    TargetSubject nvarchar(300) NOT NULL,
    Action varchar(16) NOT NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_VipAuditLog_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_VipAuditLog_Action CHECK (Action IN ('approved', 'denied', 'removed'))
);

CREATE INDEX IX_VipAuditLog_TargetCreated
    ON dbo.VipAuditLog (TargetSubject, CreatedAt DESC);

CREATE TABLE dbo.GameTables (
    TableId uniqueidentifier NOT NULL CONSTRAINT DF_GameTables_TableId DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    GameType varchar(16) NOT NULL,
    Visibility varchar(8) NOT NULL,
    OwnerSubject nvarchar(300) NOT NULL,
    HumanSeatCount tinyint NOT NULL,
    BotSeatCount tinyint NOT NULL,
    Status varchar(12) NOT NULL,
    StateVersion bigint NOT NULL CONSTRAINT DF_GameTables_StateVersion DEFAULT 0,
    StateJson nvarchar(max) NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_GameTables_CreatedAt DEFAULT SYSUTCDATETIME(),
    LastActivityAt datetime2(3) NOT NULL CONSTRAINT DF_GameTables_LastActivityAt DEFAULT SYSUTCDATETIME(),
    DisconnectedAt datetime2(3) NULL,
    ExpiresAt datetime2(3) NULL,
    CONSTRAINT CK_GameTables_GameType CHECK (GameType IN ('es-makker', 'kasino')),
    CONSTRAINT CK_GameTables_Visibility CHECK (Visibility IN ('open', 'private')),
    CONSTRAINT CK_GameTables_Status CHECK (Status IN ('waiting', 'active', 'finished', 'expired')),
    CONSTRAINT CK_GameTables_HumanSeats CHECK (HumanSeatCount >= 1),
    CONSTRAINT CK_GameTables_ValidSeatCount CHECK (
        (GameType = 'es-makker' AND HumanSeatCount + BotSeatCount = 4)
        OR
        (GameType = 'kasino' AND HumanSeatCount + BotSeatCount BETWEEN 2 AND 4)
    ),
    CONSTRAINT CK_GameTables_StateJson CHECK (StateJson IS NULL OR ISJSON(StateJson) = 1)
);

CREATE INDEX IX_GameTables_Lobby
    ON dbo.GameTables (Visibility, Status, CreatedAt DESC);

CREATE INDEX IX_GameTables_Expired
    ON dbo.GameTables (ExpiresAt)
    WHERE ExpiresAt IS NOT NULL;

CREATE TABLE dbo.GameSeats (
    TableId uniqueidentifier NOT NULL,
    SeatNumber tinyint NOT NULL,
    SeatKind varchar(6) NOT NULL,
    UserSubject nvarchar(300) NULL,
    IsActive bit NOT NULL CONSTRAINT DF_GameSeats_IsActive DEFAULT 1,
    LastConnectedAt datetime2(3) NULL,
    DisconnectedAt datetime2(3) NULL,
    CONSTRAINT PK_GameSeats PRIMARY KEY (TableId, SeatNumber),
    CONSTRAINT FK_GameSeats_GameTables FOREIGN KEY (TableId)
        REFERENCES dbo.GameTables (TableId) ON DELETE CASCADE,
    CONSTRAINT CK_GameSeats_SeatKind CHECK (SeatKind IN ('human', 'bot')),
    CONSTRAINT CK_GameSeats_UserForKind CHECK (
        SeatKind = 'human'
        OR
        (SeatKind = 'bot' AND UserSubject IS NULL)
    )
);

CREATE UNIQUE INDEX UX_GameSeats_OneActiveTablePerUser
    ON dbo.GameSeats (UserSubject)
    WHERE IsActive = 1 AND UserSubject IS NOT NULL;

CREATE TABLE dbo.GameSeatRequests (
    RequestId uniqueidentifier NOT NULL CONSTRAINT DF_GameSeatRequests_RequestId DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    TableId uniqueidentifier NOT NULL,
    UserSubject nvarchar(300) NOT NULL,
    RequestedAt datetime2(3) NOT NULL CONSTRAINT DF_GameSeatRequests_RequestedAt DEFAULT SYSUTCDATETIME(),
    Status varchar(10) NOT NULL,
    ReviewedAt datetime2(3) NULL,
    CONSTRAINT FK_GameSeatRequests_GameTables FOREIGN KEY (TableId)
        REFERENCES dbo.GameTables (TableId) ON DELETE CASCADE,
    CONSTRAINT CK_GameSeatRequests_Status CHECK (Status IN ('pending', 'accepted', 'declined', 'cancelled'))
);

CREATE UNIQUE INDEX UX_GameSeatRequests_OnePendingRequestPerUserTable
    ON dbo.GameSeatRequests (TableId, UserSubject)
    WHERE Status = 'pending';

CREATE INDEX IX_GameSeatRequests_Waiting
    ON dbo.GameSeatRequests (TableId, Status, RequestedAt);

CREATE TABLE dbo.GameInvitations (
    InvitationId uniqueidentifier NOT NULL CONSTRAINT DF_GameInvitations_InvitationId DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    TableId uniqueidentifier NOT NULL,
    TokenHash binary(32) NOT NULL,
    CreatedBy nvarchar(300) NOT NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_GameInvitations_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt datetime2(3) NOT NULL,
    RevokedAt datetime2(3) NULL,
    CONSTRAINT FK_GameInvitations_GameTables FOREIGN KEY (TableId)
        REFERENCES dbo.GameTables (TableId) ON DELETE CASCADE,
    CONSTRAINT UQ_GameInvitations_TokenHash UNIQUE (TokenHash)
);

CREATE INDEX IX_GameInvitations_Expiry
    ON dbo.GameInvitations (ExpiresAt)
    WHERE RevokedAt IS NULL;

CREATE TABLE dbo.GuestSessions (
    SessionHash binary(32) NOT NULL PRIMARY KEY,
    GameType varchar(16) NOT NULL,
    StateJson nvarchar(max) NULL,
    StateVersion bigint NOT NULL CONSTRAINT DF_GuestSessions_StateVersion DEFAULT 0,
    LastActivityAt datetime2(3) NOT NULL CONSTRAINT DF_GuestSessions_LastActivityAt DEFAULT SYSUTCDATETIME(),
    DisconnectedAt datetime2(3) NULL,
    ExpiresAt datetime2(3) NOT NULL,
    CONSTRAINT CK_GuestSessions_GameType CHECK (GameType IN ('es-makker', 'kasino')),
    CONSTRAINT CK_GuestSessions_StateJson CHECK (StateJson IS NULL OR ISJSON(StateJson) = 1)
);

CREATE INDEX IX_GuestSessions_Expiry
    ON dbo.GuestSessions (ExpiresAt);
