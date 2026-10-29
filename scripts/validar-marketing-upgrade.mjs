import {execFileSync} from 'node:child_process';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const host=process.env.PGHOST||'127.0.0.1',port=process.env.PGPORT||'5433';
if(!['127.0.0.1','localhost'].includes(host))throw Error('Apenas PostgreSQL local descartável');
const root=process.cwd(),migrations=resolve('packages/database/prisma/migrations'),db='dc_marketing_upgrade';
const sql=(command,database='postgres')=>execFileSync('psql',['-h',host,'-p',port,'-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At','-c',command],{encoding:'utf8'}).trim();
const dir=mkdtempSync(join(tmpdir(),'dc-marketing-upgrade-'));
const added=['20261028000000_newsletter_subscribers','20261029160000_marketing_seguro'];
const env={...process.env,DATABASE_URL:`postgresql://postgres@${host}:${port}/${db}`};
try{
 sql(`DROP DATABASE IF EXISTS ${db}`);sql(`CREATE DATABASE ${db}`);
 writeFileSync(join(dir,'schema.prisma'),execFileSync('git',['-c',`safe.directory=${root}`,'show','b7b23d256f6d1a29a6ba955b6e5000a1f29edf5c:packages/database/prisma/schema.prisma'],{encoding:'utf8'}));
 for(const entry of readdirSync(migrations)){if(!added.includes(entry))cpSync(join(migrations,entry),join(dir,'migrations',entry),{recursive:true});}
 execFileSync(resolve('node_modules/.bin/prisma'),['migrate','deploy','--schema',join(dir,'schema.prisma')],{env,stdio:'pipe',cwd:root});
 sql(`INSERT INTO "Order"(id,number,subtotal,total,"paymentStatus",status,"updatedAt") VALUES ('00000000-0000-4000-8000-000000000123','DC-UPGRADE-TEST',32.99,32.99,'REFUNDED','REFUNDED',now()); INSERT INTO "Coupon"(id,code,type,value,"maxUses","usedCount","updatedAt") VALUES ('00000000-0000-4000-8000-000000000124','UPGRADE','FIXED',1,5,3,now()); ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated;`,db);
 // Aplicar a versão original e simular assinante anterior ao hardening.
 sql(readFileSync(join(migrations,added[0],'migration.sql'),'utf8'),db);
 sql(`INSERT INTO "NewsletterSubscriber"(email,status,"consentVersion","consentSource","consentedAt","unsubscribeToken","updatedAt") VALUES ('upgrade@example.invalid','pending','legacy','footer',now(),'legacy-token',now());`,db);
 // A primeira migração foi aplicada por SQL só no banco de teste; registrar seu checksum pelo Prisma.
 execFileSync(resolve('node_modules/.bin/prisma'),['migrate','resolve','--applied',added[0],'--schema','packages/database/prisma/schema.prisma'],{env,stdio:'pipe'});
 execFileSync(resolve('node_modules/.bin/prisma'),['migrate','deploy','--schema','packages/database/prisma/schema.prisma'],{env,stdio:'pipe'});
 assert.equal(sql(`SELECT total::text||':'||"paymentStatus"::text FROM "Order" WHERE number='DC-UPGRADE-TEST'`,db),'32.99:REFUNDED');
 assert.equal(sql(`SELECT "usedCount" FROM "Coupon" WHERE code='UPGRADE'`,db),'3');
 assert.equal(sql(`SELECT status||':'||("unsubscribeToken" IS NULL)::text||':'||("tokenVersion" IS NOT NULL)::text FROM "NewsletterSubscriber" WHERE email='upgrade@example.invalid'`,db),'pending:true:true');
 for(const t of ['NewsletterSubscriber','MarketingCampaign','MarketingMessage']){
 assert.equal(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='"${t}"'::regclass`,db),'t');
 for(const role of ['anon','authenticated'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal(sql(`SELECT has_table_privilege('${role}','"${t}"','${permission}')`,db),'f');
 }
 execFileSync(resolve('node_modules/.bin/prisma'),['migrate','status','--schema','packages/database/prisma/schema.prisma'],{env,stdio:'pipe'});
 console.log('PASS upgrade main -> newsletter -> hardening: pedidos e cupons preservados, assinante preservado, token legado invalidado, RLS e 42 negações verificadas, migrate status atualizado.');
}finally{sql(`DROP DATABASE IF EXISTS ${db}`);rmSync(dir,{recursive:true,force:true});}
