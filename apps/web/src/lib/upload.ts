import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024;

export type UploadResult = {
  url: string;
  filename: string;
};

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

/**
 * Upload local em dev (/public/uploads).
 * TODO-CLIENTE: credenciais S3/MinIO para produção (UPLOAD_DRIVER=s3).
 */
export async function saveUpload(file: File): Promise<UploadResult> {
  const driver = process.env.UPLOAD_DRIVER || "local";

  if (!ALLOWED.includes(file.type)) {
    throw new Error("Tipo de arquivo não permitido. Use JPG, PNG, WEBP ou GIF.");
  }

  if (file.size > MAX_SIZE) {
    throw new Error("Arquivo muito grande (máx. 5MB).");
  }

  if (driver !== "local") {
    throw new Error(`Driver de upload não suportado: ${driver} (integrar S3/MinIO).`);
  }

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
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
  if (!url.startsWith("/uploads/")) return;
  const filename = path.basename(url);
  const dir = uploadsDir();
  try {
    await unlink(path.join(dir, filename));
  } catch {
    // ignora arquivo inexistente
  }
}
