import dotenv from 'dotenv'

dotenv.config()

export const config = {
  apiPort: Number(process.env.API_PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'replace_me_in_production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  mysql: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? 'chicken27',
    database: process.env.DB_NAME ?? 'progress_tracker',
  },
}
