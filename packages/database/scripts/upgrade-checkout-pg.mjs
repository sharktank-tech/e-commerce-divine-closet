#!/usr/bin/env node
// Upgrade isolado do main anterior ao PR16. Nunca usa DATABASE_URL externa.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const base = '1c79fa491bc20131b896369be98bd411a6aaa56c';
const host = process.env.PGHOST || '127.0.0.1';
const port = process.env.PGPORT || '5433';
if (!['127.0.0.1', 'localhost'].includes(host) || !/^\d+$/.test(port)) throw new Error('Somente PG local descartável permitido');
const name = `dc_pr16_upgrade_${process.pid}`;
const temp = await mkdtemp(join(tmpdir(), 'dc-pr16-upgrade-'));
const url = `postgresql://postgres@${host}:${port}/${name}`;
const db = new PrismaClient({ datasourceUrl: url });
let criado = false;
const git = async (...args) => (await run('git', args, { cwd: root })).stdout;
const psql = sql => run('psql', ['-h',host,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql]);
const migrate = schema => run(join(root,'node_modules/.bin/prisma'), ['migrate','deploy','--schema',schema], {
  cwd: root, env: { ...process.env, DATABASE_URL: url }, maxBuffer: 4 * 1024 * 1024,
});
try {
  const prefix = 'packages/database/prisma/';
  const files = (await git('ls-tree','-r','--name-only',base,'--',prefix+'migrations')).trim().split('\n');
  const sqls = files.filter(f => f.endsWith('/migration.sql'));
  assert.equal(sqls.length, 28);
  for (const path of [...files, prefix+'schema.prisma']) {
    const texto = await git('show', `${base}:${path}`);
    if (path.endsWith('/migration.sql')) assert.equal(await readFile(join(root,path),'utf8'),texto,'Migração aplicada foi reescrita');
    const destino = join(temp,path.slice(prefix.length));
    await mkdir(dirname(destino), { recursive: true }); await writeFile(destino,texto);
  }
  await psql(`CREATE DATABASE ${name}`); criado = true;
  await migrate(join(temp,'schema.prisma'));
  const antes = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
  assert.equal(antes[0].n,28);
  await db.$executeRawUnsafe(`INSERT INTO "Coupon" (code,type,value,"maxUses","usedCount","updatedAt") VALUES ('LEGADO_UPGRADE','FIXED',5,10,3,now())`);
  const linhas = await db.$queryRawUnsafe(`INSERT INTO "Order" (number,subtotal,total,"couponCode","updatedAt") VALUES ('DC-UPGRADE-SINTETICO',100,95,'LEGADO_UPGRADE',now()) RETURNING id`);
  await db.$executeRawUnsafe(`INSERT INTO "Order" (number,subtotal,total,status,"paymentStatus","paymentId","updatedAt")
    VALUES ('DC-UPGRADE-PAGO',100,100,'PAID','PAID','sintetico-pago',now()),
           ('DC-UPGRADE-ESTORNADO',100,100,'REFUNDED','REFUNDED','sintetico-estornado',now())`);
  const estornado = await db.$queryRawUnsafe(`SELECT id FROM "Order" WHERE number = 'DC-UPGRADE-ESTORNADO'`);
  await db.refund.create({ data: { orderId:estornado[0].id, paymentId:'sintetico-estornado',
    amount:100, status:'APPROVED', idempotencyKey:'sintetico-refund', mpRefundId:'sintetico-1', resolvedAt:new Date() } });
  const snapshot = async () => JSON.stringify({
    orders: await db.$queryRawUnsafe('SELECT id, number, status, "paymentStatus", "paymentId", total FROM "Order" ORDER BY number'),
    refunds: await db.refund.findMany({ orderBy:{ id:'asc' } }),
  });
  const financeiroAntes = await snapshot();
  await migrate(join(root,prefix,'schema.prisma'));
  assert.equal(await snapshot(),financeiroAntes,'Estado financeiro alterado no upgrade');
  const depois = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
  assert.equal(depois[0].n,31);
  const pedido = await db.order.findUniqueOrThrow({ where: { id: linhas[0].id } });
  assert.equal(pedido.couponReserved,false); assert.equal(pedido.idempotencyKey,null);
  assert.equal(pedido.paymentRequestHash,null); assert.equal(pedido.holdCode,null);
  assert.equal(pedido.paymentStatus,'PENDING'); assert.equal(Number(pedido.total),95);
  const cupom = await db.coupon.findUniqueOrThrow({ where: { code:'LEGADO_UPGRADE' } });
  assert.equal(cupom.usedCount,3); assert.equal(cupom.maxUses,10);
  console.log(JSON.stringify({ base, migracoesAntes:28, migracoesDepois:31, dadosPreservados:true, pedidos:3, refunds:1, ambiente:'PG local descartável' }));
} finally {
  await db.$disconnect();
  if (criado) await psql(`DROP DATABASE ${name}`);
  await rm(temp, { recursive:true, force:true });
}
