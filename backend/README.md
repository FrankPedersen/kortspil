# Kortspil API

TypeScript/Node.js API for authenticated multiplayer tables, invitations, and
VIP administration. Azure infrastructure is described by the Bicep templates
in `../infra`.

## Requirements

- Node.js 22 or newer
- npm

## Local development

```powershell
cd backend
npm ci
npm run dev
```

The health endpoint is `http://127.0.0.1:3000/healthz`. OpenAPI documentation
is generated from the Fastify route schemas:

```powershell
npm run contracts:generate
```

The lobby API includes table creation/listing, seat requests and host decisions,
private invitations (hashed tokens, revocation, and fragment-based links), and
VIP requests/administration. Mutations require the configured same-origin
`PUBLIC_APP_URL`, App Service Authentication, and a valid AAD principal.
`VIP_ADMIN_USER_IDS` is a comma-separated list of trusted App Service subject
IDs; it is not populated from client claims.

The first server-owned game lifecycle slice is available through
`POST /api/v1/tables/{tableId}/start` and `GET /api/v1/tables/{tableId}/state`.
Starting requires the host and all configured human seats; the backend shuffles
and deals both games, stores the initial state, and returns a player-specific
snapshot suitable for reconnecting. Opponents' hands and Es Makker's kitty are
never included. Turn actions, scoring, and bot decision-making are not yet
implemented in the backend.

Local development uses an in-memory repository and is not durable. Production
always uses Azure SQL and fails startup if SQL configuration is missing; there
is no production fallback to memory. SQL authentication uses Azure Identity
default credentials, so configure Managed Identity for the deployed app.

The API applies per-process rate limits. They provide a useful first layer but
are not a substitute for distributed abuse controls if the service is scaled
to multiple instances.

The protected browser lobby is served from `/lobby/` on the API's own origin.
This keeps App Service Authentication cookies same-origin and avoids weakening
authentication for browser preflight requests. The lobby can create public
tables with at least one human seat available for another player, request
seats, and approve requests; the standalone game clients do not yet consume
multiplayer snapshots.

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` to enable Azure Monitor OpenTelemetry.
Production startup fails if the connection string is missing. Local runs can
omit it.

## Database

`sql/001_initial.sql` defines the initial Azure SQL schema for user profiles,
VIP requests and audit history, game tables and seats, invitations, and
short-lived guest games. Production uses Azure Identity for SQL authentication;
do not put database credentials in configuration.

The current deployment places App Service and Web PubSub in West Europe. Azure
SQL is in North Europe because Azure rejected new SQL servers in West Europe.
The replacement App Service `kortspil-api-20261101-v2` is the verified
production API. Its public network access is enabled for HTTPS requests, while
App Service Authentication is required for every route. The SQL firewall
allows only the App Service outbound IPs. The original App Service is retained
for now and should not be used by clients.

The Bicep template accepts `appNameOverride` to target the replacement app
while retaining the existing resource suffix for the shared plan and
monitoring resources. It does not create the SQL database user or grant SQL
roles to the managed identity; those remain separate database provisioning
steps.

App Service Authentication is configured for the `common` Microsoft identity
issuer. The Entra app registration accepts personal Microsoft accounts and
work or school accounts, and redirects to the App Service
`/.auth/login/aad/callback` endpoint. Enable ID-token issuance in the Entra app
registration for App Service's hybrid sign-in flow; access-token issuance is
not required. The Bicep template configures App Service but does not manage the
separate Entra app registration. Authentication is required for every request;
other identity providers are disabled. The provider client secret is stored as
a protected App Service setting and is not committed to this repository.

The infrastructure template requires a secure `microsoftClientSecret`
parameter. Supply it from a protected parameter file when deploying; never
commit that file. Rotate the Entra app registration secret before its one-year
expiry.

The schema stores a hash of the invitation token and guest-session cookie,
not the bearer values themselves. Game state is private to the backend; API
responses must project only the data each player is allowed to see.
