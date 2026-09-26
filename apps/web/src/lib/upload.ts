import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024;

export type UploadResult = {
  url: string;
  filename: string;
};

function fileKey(filename: string): string {
  return `uploads/${filename}`;
}

function randomFilename(originalName: string): string {
  const ext = (originalName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
}

// Resolve o diretório de uploads considerando o monorepo:
// cwd pode ser a raiz (npm run dev) ou apps/web.
function uploadsDir(): string {
  if (process.env.UPLOAD_DIR) return path.resolve(process.env.UPLOAD_DIR);
  const cwd = process.cwd();
  const appDir = path.join(cwd, "apps", "web");
  return cwd.endsWith(path.join("apps", "web"))
    ? path.join(cwd, "public", "uploads")
    : path.join(appDir, "public", "uploads");
}

type S3Settings = {
  client: S3Client;
  bucket: string;
  region: string;
  endpoint?: string;
};

// S3 e compatíveis (AWS, MinIO, Supabase Storage, R2).
// Com S3_ENDPOINT definido usa path-style (MinIO/Supabase/R2).
function s3Settings(): S3Settings {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const region = process.env.S3_REGION || "us-east-1";
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Upload S3 não configurado (defina S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY)."
    );
  }

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return { client, bucket, region, endpoint };
}

function s3PublicUrl(s: S3Settings, key: string): string {
  const base = process.env.S3_PUBLIC_URL?.replace(/\/$/, "");
  if (base) return `${base}/${key}`;
  if (s.endpoint) return `${s.endpoint.replace(/\/$/, "")}/${s.bucket}/${key}`;
  return `https://${s.bucket}.s3.${s.region}.amazonaws.com/${key}`;
}

/**
 * Upload de imagens (produtos, banners).
 * - UPLOAD_DRIVER=local → /public/uploads (dev; não persiste na Vercel)
 * - UPLOAD_DRIVER=s3    → bucket S3/MinIO/Supabase (produção; bucket precisa
 *   ser público para leitura ou servido via S3_PUBLIC_URL/CDN)
 */
export async function saveUpload(file: File): Promise<UploadResult> {
  const driver = process.env.UPLOAD_DRIVER || "local";

  if (!ALLOWED.includes(file.type)) {
    throw new Error("Tipo de arquivo não permitido. Use JPG, PNG, WEBP ou GIF.");
  }

  if (file.size > MAX_SIZE) {
    throw new Error("Arquivo muito grande (máx. 5MB).");
  }

  const filename = randomFilename(file.name);

  if (driver === "s3") {
    const s3 = s3Settings();
    const key = fileKey(filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: buffer,
        ContentType: file.type,
      })
    );
    return { url: s3PublicUrl(s3, key), filename };
  }

  if (driver !== "local") {
    throw new Error(`Driver de upload não suportado: ${driver} (use "local" ou "s3").`);
  }

  // Vercel/serverless têm filesystem somente leitura: o driver local
  // quebraria com EROFS — falha cedo com mensagem acionável.
  if (process.env.VERCEL === "1") {
    throw new Error(
      "Upload local indisponível neste ambiente (disco somente leitura). Configure UPLOAD_DRIVER=s3 com as credenciais do bucket."
    );
  }

  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  return {
    url: `/uploads/${filename}`,
    filename,
  };
}

export async function deleteUpload(url: string): Promise<void> {
  const clean = url.split("?")[0];

  // caminho local legado (/uploads/arquivo)
  if (clean.startsWith("/uploads/")) {
    const dir = uploadsDir();
    try {
      await unlink(path.join(dir, path.basename(clean)));
    } catch {
      // ignora arquivo inexistente
    }
    return;
  }

  // URL remota: só trata se o driver s3 estiver ativo
  if ((process.env.UPLOAD_DRIVER || "local") !== "s3") return;
  if (!/^https?:\/\//.test(clean)) return;

  try {
    const s3 = s3Settings();
    const key = fileKey(path.basename(clean));
    await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
  } catch {
    // ignora arquivo inexistente
  }
}
