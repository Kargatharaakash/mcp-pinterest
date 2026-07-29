import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';

describe('HTTP / SSE API Key Authentication Security Tests', () => {
  let app: express.Application;
  let server: http.Server;
  let port: number;
  const TEST_API_KEY = 'secret_test_key_12345';

  beforeAll((done) => {
    app = express();
    app.use(express.json());

    // Public health check route
    app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', authenticated: true });
    });

    // Auth middleware helper
    const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers['x-api-key'] as string;
      const queryApiKey = req.query.api_key as string;

      let providedKey = '';
      if (authHeader) {
        providedKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
      } else if (apiKeyHeader) {
        providedKey = apiKeyHeader.trim();
      } else if (queryApiKey) {
        providedKey = queryApiKey.trim();
      }

      if (providedKey === TEST_API_KEY) {
        return next();
      }
      res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    };

    // Protected SSE route
    app.get('/sse', authMiddleware, (req: Request, res: Response) => {
      res.status(200).send('sse-stream-established');
    });

    server = app.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        port = address.port;
      }
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('GET /health should return 200 OK without requiring authentication', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
  });

  it('GET /sse without API key should return 401 Unauthorized', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sse`);
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toContain('Unauthorized');
  });

  it('GET /sse with invalid Bearer API key should return 401 Unauthorized', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sse`, {
      headers: {
        'Authorization': 'Bearer wrong_key'
      }
    });
    expect(res.status).toBe(401);
  });

  it('GET /sse with valid Authorization: Bearer <key> header should return 200 OK', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sse`, {
      headers: {
        'Authorization': `Bearer ${TEST_API_KEY}`
      }
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('sse-stream-established');
  });

  it('GET /sse with valid x-api-key header should return 200 OK', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sse`, {
      headers: {
        'x-api-key': TEST_API_KEY
      }
    });
    expect(res.status).toBe(200);
  });
});
