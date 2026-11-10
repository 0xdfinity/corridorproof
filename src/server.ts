import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { handle } from './handlers.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(resolve(process.cwd(), 'dist')));

// Every route is a thin shell over the same handler the serverless deployment calls.
const via = (action: string, pick: (req: express.Request) => unknown = (req) => req.body) =>
  async (req: express.Request, res: express.Response) => {
    const { status, body } = await handle(action, pick(req), req.headers as Record<string, unknown>);
    res.status(status).json(body);
  };

app.get('/api/health', via('health'));
app.post('/api/settlement/observe', via('settlement.observe'));
app.post('/api/pricing/quote', via('pricing.quote'));
app.get('/api/receipts', via('receipt.list'));
app.get('/api/receipts/:id', via('receipt.get', (req) => ({ id: req.params.id })));
app.post('/api/receipts/verify', via('receipt.verify'));
app.post('/api/receipts', via('receipt.create'));
app.post('/api/quote/preview', via('quote.preview'));
app.post('/api/quote/firm', via('quote.firm'));
app.post('/api/settle/dry-run', via('settle.dry-run'));
app.post('/api/settle', via('settle'));
app.post('/api/attribution/read', via('attribution.read'));
app.post('/api/attribution/send', via('attribution.send'));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`CorridorProof listening on ${port}`));
