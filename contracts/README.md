# API contracts

The backend's Fastify route schemas are the source of truth. Generate the
OpenAPI document and TypeScript declarations with:

```bash
cd backend
npm run contracts:generate
```

`openapi.json` is the HTTP contract. `api-types.d.ts` is generated for
TypeScript consumers. The vanilla JavaScript client must validate network
payloads at runtime; TypeScript declarations do not validate JSON received
over HTTP.
