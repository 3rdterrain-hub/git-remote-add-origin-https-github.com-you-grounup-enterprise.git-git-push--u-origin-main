/**
 * Generates docs/openapi.json from the gateway's own route table.
 *
 * The spec is generated rather than hand-written for one reason: a hand-written
 * spec drifts from the code, and a published API spec that lies is worse than
 * none. `npm run verify` regenerates it and fails if the committed file differs,
 * so the two cannot separate.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GATEWAY = join(ROOT, 'supabase/functions/_shared/api/gateway.ts');

/**
 * The gateway is Deno TypeScript with a `.ts` import specifier that Node will
 * not resolve, so the route table is read from the source rather than imported.
 * A malformed table therefore fails this script loudly instead of silently
 * producing an empty spec.
 */
const source = readFileSync(GATEWAY, 'utf8');

const block = /export const ROUTES: readonly RouteDef\[\] = \[([\s\S]*?)\n\];/.exec(source);
if (!block) throw new Error('Could not find ROUTES in gateway.ts — the generator and the gateway have diverged.');

const routes = [...block[1].matchAll(
  /\{\s*method:\s*'(\w+)',\s*template:\s*'([^']+)',\s*scope:\s*'([^']+)',\s*resource:\s*'([^']+)',\s*\n?\s*summary:\s*'([^']+)'\s*\},/g,
)].map(([, method, template, scope, resource, summary]) => ({ method, template, scope, resource, summary }));

if (routes.length === 0) throw new Error('Parsed zero routes from gateway.ts.');

const scopes = [...new Set(routes.map((r) => r.scope))].sort();

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'A stable machine-readable code. Handle this, not the message.' },
        message: { type: 'string' },
        required_scope: { type: 'string', description: 'Present on insufficient_scope.' },
        retry_after_seconds: { type: 'integer', description: 'Present on rate_limited.' },
      },
    },
  },
};

const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const paths = {};
for (const r of routes) {
  const path = `/${r.template.replace(/^\//, '')}`;
  paths[path] ??= {};
  const params = [...r.template.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' },
    description: `Identifier of the ${name.replace(/Id$/, '')}.`,
  }));
  if (r.method === 'GET' && !r.template.match(/\{\w+\}$/)) {
    params.push(
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        description: 'Page size. A larger value is clamped to 200 and reported in `warnings`.' },
      { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
    );
  }
  paths[path][r.method.toLowerCase()] = {
    summary: r.summary,
    operationId: `${r.method.toLowerCase()}${r.template.replace(/[/{}-]+(\w)/g, (_, c) => c.toUpperCase()).replace(/[/{}-]/g, '')}`,
    tags: [r.scope.split(':')[0]],
    security: [{ apiKey: [r.scope] }],
    parameters: params,
    ...(r.method === 'POST' ? {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    } : {}),
    responses: {
      [r.method === 'POST' ? '201' : '200']: {
        description: 'Success.',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      401: errorResponse('The key is missing, unrecognized, revoked or expired. These are deliberately indistinguishable.'),
      403: errorResponse(`The key does not hold the \`${r.scope}\` scope.`),
      404: errorResponse('No such endpoint, or no such record inside the calling company.'),
      429: errorResponse('The key exceeded its per-minute rate limit. See `Retry-After`.'),
      500: errorResponse('The request could not be completed. No internal detail is returned.'),
    },
  };
}

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'GrounUp Enterprise API',
    version: '1.0.0',
    description: [
      'The GrounUp Enterprise public API.',
      '',
      'Authenticate with an API key as `Authorization: Bearer gu_live_…`. A key is shown once',
      'at creation and only its SHA-256 hash is stored, so it cannot be recovered — if a key is',
      'lost, revoke it and issue another.',
      '',
      'Every key belongs to exactly one company. Scopes decide what kind of record a key may',
      'read or write; the company decides which records exist. No scope widens the second, so a',
      'key can never reach another company’s data regardless of the scopes it holds.',
      '',
      'Errors share one shape. Handle `error.code`, which is stable, rather than `error.message`,',
      'which is written for people.',
    ].join('\n'),
    contact: { name: 'GrounUp Enterprise', url: 'https://grounup.example/docs/api' },
  },
  servers: [{ url: 'https://{project}.supabase.co/functions/v1/api', variables: { project: { default: 'your-project' } } }],
  security: [{ apiKey: [] }],
  tags: [...new Set(routes.map((r) => r.scope.split(':')[0]))].sort().map((t) => ({ name: t })),
  paths,
  components: {
    schemas: { Error: ERROR_SCHEMA },
    securitySchemes: {
      apiKey: {
        type: 'http', scheme: 'bearer',
        description: `Available scopes: ${scopes.join(', ')}.`,
      },
    },
  },
};

/*
 * Two destinations, both generated.
 *
 * `docs/openapi.json` is the published spec. `apps/web/src/data/openapi.json`
 * is the same file, inside the Vite root so the API Access screen can import
 * it — that screen used to carry a hand-written endpoint list, which is
 * precisely the kind of thing that quietly falls a route behind the gateway
 * and tells a customer an endpoint exists that does not.
 */
const OUTPUTS = [join(ROOT, 'docs/openapi.json'), join(ROOT, 'apps/web/src/data/openapi.json')];
const rendered = JSON.stringify(spec, null, 2) + '\n';

if (process.argv.includes('--check')) {
  for (const out of OUTPUTS) {
    let current = '';
    try { current = readFileSync(out, 'utf8'); } catch { /* not generated yet */ }
    if (current !== rendered) {
      console.error(`${out} is out of date with the gateway route table. Run: npm run openapi`);
      process.exit(1);
    }
  }
  console.log(`OpenAPI spec matches the gateway (${routes.length} routes).`);
} else {
  for (const out of OUTPUTS) writeFileSync(out, rendered);
  console.log(`Wrote the OpenAPI spec from ${routes.length} routes.`);
}
