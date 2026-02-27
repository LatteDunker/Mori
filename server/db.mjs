import mysql from 'mysql2/promise'
import { config } from './config.mjs'

const adminPool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
})

let appPool
let adminClosed = false

const identifier = (value) => `\`${String(value).replaceAll('`', '``')}\``

export const ensureDatabase = async () => {
  await adminPool.query(`CREATE DATABASE IF NOT EXISTS ${identifier(config.mysql.database)}`)
}

export const getDb = async () => {
  if (appPool) return appPool

  await ensureDatabase()
  appPool = mysql.createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
  })
  return appPool
}

export const closeDb = async () => {
  if (appPool) {
    await appPool.end()
    appPool = undefined
  }
  if (!adminClosed) {
    await adminPool.end()
    adminClosed = true
  }
}
