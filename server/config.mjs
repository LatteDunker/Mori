import dotenv from 'dotenv'

dotenv.config()

export const config = {
  apiPort: Number(process.env.API_PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'replace_me_in_production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  storageProvider: process.env.STORAGE_PROVIDER ?? 'filesystem',
  mysql: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? 'chicken27',
    database: process.env.DB_NAME ?? 'progress_tracker',
  },
  minio: {
    endPoint: process.env.MINIO_ENDPOINT ?? '127.0.0.1',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: String(process.env.MINIO_USE_SSL ?? 'false').toLowerCase() === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
    bucket: process.env.MINIO_BUCKET ?? 'progress-tracker',
  },
}
