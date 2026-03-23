import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client as MinioClient } from 'minio'
import { config } from './config.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadsDir = path.resolve(__dirname, '../uploads')

const provider = String(config.storageProvider ?? 'filesystem').toLowerCase()
const useMinio = provider === 'minio'

let minioClient = null
let minioReady = false

const getFileExtension = (originalName) => {
  const ext = path.extname(String(originalName ?? '')).slice(0, 10).toLowerCase()
  return ext || ''
}

const generateStorageKey = (originalName) => `${Date.now()}-${randomUUID()}${getFileExtension(originalName)}`

export const initStorage = async () => {
  await fsp.mkdir(uploadsDir, { recursive: true })

  if (!useMinio) return
  if (!config.minio.accessKey || !config.minio.secretKey) {
    throw new Error('MINIO_ACCESS_KEY and MINIO_SECRET_KEY are required when STORAGE_PROVIDER=minio')
  }

  minioClient = new MinioClient({
    endPoint: config.minio.endPoint,
    port: config.minio.port,
    useSSL: config.minio.useSSL,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
  })

  const bucketExists = await minioClient.bucketExists(config.minio.bucket)
  if (!bucketExists) {
    await minioClient.makeBucket(config.minio.bucket)
  }
  minioReady = true
}

export const getUploadsDir = () => uploadsDir

export const saveUploadedFile = async ({ file, prefix = 'uploads' }) => {
  const storageKey = `${prefix}-${generateStorageKey(file?.originalname)}`
  const url = `/uploads/${encodeURIComponent(storageKey)}`

  if (useMinio) {
    if (!minioReady || !minioClient) throw new Error('MinIO storage is not initialized')
    await minioClient.putObject(config.minio.bucket, storageKey, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    })
    return { storageKey, url }
  }

  const localPath = path.join(uploadsDir, storageKey)
  await fsp.writeFile(localPath, file.buffer)
  return { storageKey, url: `/uploads/${encodeURIComponent(storageKey)}` }
}

export const deleteStoredFile = async (storageKey) => {
  if (!storageKey) return
  if (useMinio) {
    if (!minioReady || !minioClient) return
    await minioClient.removeObject(config.minio.bucket, storageKey).catch(() => {})
    return
  }
  await fsp.unlink(path.join(uploadsDir, storageKey)).catch(() => {})
}

export const getStoredFileStream = async (storageKey) => {
  if (!storageKey) return null

  if (useMinio) {
    if (!minioReady || !minioClient) return null
    try {
      const stat = await minioClient.statObject(config.minio.bucket, storageKey)
      const stream = await minioClient.getObject(config.minio.bucket, storageKey)
      return { stream, mimeType: stat.metaData?.['content-type'] ?? 'application/octet-stream' }
    } catch {
      // Fall through so older filesystem uploads remain readable during migration.
    }
  }

  const fullPath = path.join(uploadsDir, storageKey)
  try {
    await fsp.access(fullPath)
    return { stream: fs.createReadStream(fullPath), mimeType: 'application/octet-stream' }
  } catch {
    return null
  }
}
