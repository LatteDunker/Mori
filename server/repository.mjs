import { randomUUID } from 'node:crypto'
import { getDb } from './db.mjs'

const duplicateColumnErrorCode = 'ER_DUP_FIELDNAME'

const toHabit = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  color: row.color,
  sortOrder: Number(row.sort_order ?? 0),
  createdAt: row.created_at,
})

const toEntry = (row) => ({
  id: row.id,
  userId: row.user_id,
  habitId: row.habit_id,
  date: row.entry_date,
  completed: Boolean(row.completed),
  note: row.note ?? '',
  updatedAt: row.updated_at,
  imageCount: Number(row.image_count ?? 0),
})

const toEntryImage = (row) => ({
  id: row.id,
  userId: row.user_id,
  habitId: row.habit_id,
  date: row.entry_date,
  storageKey: row.storage_key,
  url: row.url,
  originalName: row.original_name,
  mimeType: row.mime_type,
  fileSize: Number(row.file_size),
  createdAt: row.created_at,
})

const toVision = (row) => ({
  id: row.id,
  userId: row.user_id,
  habitId: row.habit_id,
  date: row.target_date,
  title: row.title,
  description: row.description ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  imageCount: Number(row.image_count ?? 0),
})

const toVisionImage = (row) => ({
  id: row.id,
  userId: row.user_id,
  habitId: row.habit_id,
  date: row.target_date,
  storageKey: row.storage_key,
  url: row.url,
  originalName: row.original_name,
  mimeType: row.mime_type,
  fileSize: Number(row.file_size),
  createdAt: row.created_at,
})

const toUser = (row) => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
})

const toMySqlDateTime = (date) => {
  const iso = date.toISOString()
  return iso.slice(0, 19).replace('T', ' ')
}

const addColumnIfMissing = async (table, columnDefinition) => {
  const db = await getDb()
  try {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`)
  } catch (error) {
    if (error?.code !== duplicateColumnErrorCode) {
      throw error
    }
  }
}

export const initSchema = async () => {
  const db = await getDb()
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      token_jti CHAR(36) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      CONSTRAINT fk_revoked_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS habits (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      name VARCHAR(120) NOT NULL,
      color VARCHAR(20) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      INDEX idx_habits_user (user_id),
      CONSTRAINT fk_habits_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS habit_entries (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      habit_id CHAR(36) NOT NULL,
      entry_date DATE NOT NULL,
      completed TINYINT(1) NOT NULL DEFAULT 0,
      note TEXT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_entries_user (user_id),
      CONSTRAINT fk_entries_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
      UNIQUE KEY uk_habit_day (habit_id, entry_date)
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS habit_entry_images (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      habit_id CHAR(36) NOT NULL,
      entry_date DATE NOT NULL,
      storage_key VARCHAR(255) NOT NULL,
      url VARCHAR(512) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX idx_entry_images_lookup (user_id, habit_id, entry_date),
      CONSTRAINT fk_entry_images_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS visions (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      habit_id CHAR(36) NOT NULL,
      target_date DATE NOT NULL,
      title VARCHAR(180) NOT NULL,
      description TEXT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_visions_user (user_id),
      CONSTRAINT fk_visions_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
      UNIQUE KEY uk_vision_day (habit_id, target_date)
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS vision_images (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      habit_id CHAR(36) NOT NULL,
      target_date DATE NOT NULL,
      storage_key VARCHAR(255) NOT NULL,
      url VARCHAR(512) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX idx_vision_images_lookup (user_id, habit_id, target_date),
      CONSTRAINT fk_vision_images_habit FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    )
  `)

  await addColumnIfMissing('habits', 'user_id CHAR(36) NULL AFTER id')
  await addColumnIfMissing('habits', 'sort_order INT NOT NULL DEFAULT 0 AFTER color')
  await addColumnIfMissing('habit_entries', 'user_id CHAR(36) NULL AFTER id')

  await db.query(
    `UPDATE habits h
     JOIN (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) - 1 AS next_order
       FROM habits
     ) ranked ON ranked.id = h.id
     SET h.sort_order = ranked.next_order`,
  )
}

export const createUser = async ({ email, passwordHash }) => {
  const db = await getDb()
  const user = {
    id: randomUUID(),
    email,
    passwordHash,
    createdAt: toMySqlDateTime(new Date()),
  }
  await db.query('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', [
    user.id,
    user.email,
    user.passwordHash,
    user.createdAt,
  ])
  return user
}

export const findUserByEmail = async (email) => {
  const db = await getDb()
  const [rows] = await db.query(
    'SELECT id, email, password_hash, created_at FROM users WHERE email = ? LIMIT 1',
    [email],
  )
  return rows[0] ? toUser(rows[0]) : null
}

export const findUserById = async (userId) => {
  const db = await getDb()
  const [rows] = await db.query(
    'SELECT id, email, password_hash, created_at FROM users WHERE id = ? LIMIT 1',
    [userId],
  )
  return rows[0] ? toUser(rows[0]) : null
}

export const revokeToken = async ({ userId, tokenJti, expiresAt }) => {
  const db = await getDb()
  await db.query(
    `INSERT INTO revoked_tokens (id, user_id, token_jti, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
    [randomUUID(), userId, tokenJti, toMySqlDateTime(expiresAt), toMySqlDateTime(new Date())],
  )
}

export const isTokenRevoked = async (tokenJti) => {
  const db = await getDb()
  const [rows] = await db.query('SELECT id FROM revoked_tokens WHERE token_jti = ? LIMIT 1', [tokenJti])
  return Boolean(rows[0])
}

export const clearExpiredRevokedTokens = async () => {
  const db = await getDb()
  await db.query('DELETE FROM revoked_tokens WHERE expires_at < ?', [toMySqlDateTime(new Date())])
}

export const deleteUserByEmail = async (email) => {
  const db = await getDb()
  await db.query('DELETE FROM users WHERE email = ?', [email])
}

export const habitBelongsToUser = async (userId, habitId) => {
  const db = await getDb()
  const [rows] = await db.query('SELECT id FROM habits WHERE id = ? AND user_id = ? LIMIT 1', [
    habitId,
    userId,
  ])
  return Boolean(rows[0])
}

export const listHabits = async (userId) => {
  const db = await getDb()
  const [rows] = await db.query(
    'SELECT id, user_id, name, color, sort_order, created_at FROM habits WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC',
    [userId],
  )
  return rows.map(toHabit)
}

export const createHabit = async ({ userId, name, color }) => {
  const db = await getDb()
  const [[orderRow]] = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM habits WHERE user_id = ?', [
    userId,
  ])
  const habit = {
    id: randomUUID(),
    userId,
    name,
    color,
    sortOrder: Number(orderRow?.max_sort_order ?? -1) + 1,
    createdAt: toMySqlDateTime(new Date()),
  }
  await db.query('INSERT INTO habits (id, user_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    habit.id,
    habit.userId,
    habit.name,
    habit.color,
    habit.sortOrder,
    habit.createdAt,
  ])
  return habit
}

export const reorderHabits = async ({ userId, habitIds }) => {
  const db = await getDb()
  const normalizedIds = [...new Set(habitIds.map((id) => String(id)))]
  const [rows] = await db.query('SELECT id FROM habits WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC', [userId])
  const currentIds = rows.map((row) => row.id)
  if (normalizedIds.length !== currentIds.length) return null
  if (currentIds.some((id) => !normalizedIds.includes(id))) return null

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    for (let index = 0; index < normalizedIds.length; index += 1) {
      await connection.query('UPDATE habits SET sort_order = ? WHERE user_id = ? AND id = ?', [index, userId, normalizedIds[index]])
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  const [updatedRows] = await db.query(
    'SELECT id, user_id, name, color, sort_order, created_at FROM habits WHERE user_id = ? ORDER BY sort_order ASC, created_at DESC',
    [userId],
  )
  return updatedRows.map(toHabit)
}

export const updateHabit = async ({ userId, habitId, name, color }) => {
  const db = await getDb()
  const trimmedName = String(name ?? '').trim()
  const trimmedColor = String(color ?? '').trim()
  if (!trimmedName) return null

  const [result] = await db.query(
    'UPDATE habits SET name = ?, color = ? WHERE id = ? AND user_id = ?',
    [trimmedName, trimmedColor || '#2f80ed', habitId, userId],
  )
  if (result.affectedRows === 0) return null

  const [rows] = await db.query(
    'SELECT id, user_id, name, color, sort_order, created_at FROM habits WHERE id = ? AND user_id = ? LIMIT 1',
    [habitId, userId],
  )
  return rows[0] ? toHabit(rows[0]) : null
}

export const deleteHabit = async ({ userId, habitId }) => {
  const db = await getDb()
  const [result] = await db.query('DELETE FROM habits WHERE id = ? AND user_id = ?', [habitId, userId])
  return result.affectedRows > 0
}

export const listEntriesForYear = async ({ userId, habitId, year }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const [rows] = await db.query(
    `SELECT
       e.id,
       e.user_id,
       e.habit_id,
       e.entry_date,
       e.completed,
       e.note,
       e.updated_at,
       (
         SELECT COUNT(*)
         FROM habit_entry_images i
         WHERE i.user_id = e.user_id
           AND i.habit_id = e.habit_id
           AND i.entry_date = e.entry_date
       ) AS image_count
     FROM habit_entries
     AS e
     WHERE e.user_id = ? AND e.habit_id = ? AND e.entry_date BETWEEN ? AND ?
     ORDER BY entry_date ASC`,
    [userId, habitId, start, end],
  )
  return rows.map(toEntry)
}

export const upsertEntry = async ({ userId, habitId, date, completed, note }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const trimmed = (note ?? '').trim()
  const shouldPersist = Boolean(completed || trimmed.length > 0)

  if (!shouldPersist) {
    await db.query('DELETE FROM habit_entries WHERE user_id = ? AND habit_id = ? AND entry_date = ?', [
      userId,
      habitId,
      date,
    ])
    return null
  }

  await db.query(
    `INSERT INTO habit_entries (id, user_id, habit_id, entry_date, completed, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       completed = VALUES(completed),
       note = VALUES(note),
       updated_at = VALUES(updated_at)`,
    [randomUUID(), userId, habitId, date, completed ? 1 : 0, trimmed, toMySqlDateTime(new Date())],
  )

  const [rows] = await db.query(
    `SELECT
       e.id,
       e.user_id,
       e.habit_id,
       e.entry_date,
       e.completed,
       e.note,
       e.updated_at,
       (
         SELECT COUNT(*)
         FROM habit_entry_images i
         WHERE i.user_id = e.user_id
           AND i.habit_id = e.habit_id
           AND i.entry_date = e.entry_date
       ) AS image_count
     FROM habit_entries AS e
     WHERE e.user_id = ? AND e.habit_id = ? AND e.entry_date = ?`,
    [userId, habitId, date],
  )
  return rows[0] ? toEntry(rows[0]) : null
}

export const deleteEntry = async ({ userId, habitId, date }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return false
  const db = await getDb()
  await db.query('DELETE FROM habit_entry_images WHERE user_id = ? AND habit_id = ? AND entry_date = ?', [
    userId,
    habitId,
    date,
  ])
  const [result] = await db.query(
    'DELETE FROM habit_entries WHERE user_id = ? AND habit_id = ? AND entry_date = ?',
    [userId, habitId, date],
  )
  return result.affectedRows > 0
}

export const listVisionsForYear = async ({ userId, habitId, year }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const [rows] = await db.query(
    `SELECT
       v.id,
       v.user_id,
       v.habit_id,
       v.target_date,
       v.title,
       v.description,
       v.created_at,
       v.updated_at,
       (
         SELECT COUNT(*)
         FROM vision_images i
         WHERE i.user_id = v.user_id
           AND i.habit_id = v.habit_id
           AND i.target_date = v.target_date
       ) AS image_count
     FROM visions AS v
     WHERE v.user_id = ? AND v.habit_id = ? AND v.target_date BETWEEN ? AND ?
     ORDER BY v.target_date ASC`,
    [userId, habitId, start, end],
  )
  return rows.map(toVision)
}

export const upsertVision = async ({ userId, habitId, date, title, description }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const trimmedTitle = String(title ?? '').trim()
  if (!trimmedTitle) return null

  const now = toMySqlDateTime(new Date())
  await db.query(
    `INSERT INTO visions (id, user_id, habit_id, target_date, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       description = VALUES(description),
       updated_at = VALUES(updated_at)`,
    [randomUUID(), userId, habitId, date, trimmedTitle, String(description ?? '').trim(), now, now],
  )

  const [rows] = await db.query(
    `SELECT
       v.id,
       v.user_id,
       v.habit_id,
       v.target_date,
       v.title,
       v.description,
       v.created_at,
       v.updated_at,
       (
         SELECT COUNT(*)
         FROM vision_images i
         WHERE i.user_id = v.user_id
           AND i.habit_id = v.habit_id
           AND i.target_date = v.target_date
       ) AS image_count
     FROM visions AS v
     WHERE v.user_id = ? AND v.habit_id = ? AND v.target_date = ?`,
    [userId, habitId, date],
  )
  return rows[0] ? toVision(rows[0]) : null
}

export const deleteVision = async ({ userId, habitId, date }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return false
  const db = await getDb()
  await db.query('DELETE FROM vision_images WHERE user_id = ? AND habit_id = ? AND target_date = ?', [
    userId,
    habitId,
    date,
  ])
  const [result] = await db.query(
    'DELETE FROM visions WHERE user_id = ? AND habit_id = ? AND target_date = ?',
    [userId, habitId, date],
  )
  return result.affectedRows > 0
}

const visionExistsForDate = async ({ userId, habitId, date }) => {
  const db = await getDb()
  const [rows] = await db.query(
    'SELECT id FROM visions WHERE user_id = ? AND habit_id = ? AND target_date = ? LIMIT 1',
    [userId, habitId, date],
  )
  return Boolean(rows[0])
}

const ensureEntryExistsForImage = async ({ userId, habitId, date }) => {
  const db = await getDb()
  const [rows] = await db.query(
    'SELECT id FROM habit_entries WHERE user_id = ? AND habit_id = ? AND entry_date = ? LIMIT 1',
    [userId, habitId, date],
  )
  if (rows[0]) return

  await db.query(
    `INSERT INTO habit_entries (id, user_id, habit_id, entry_date, completed, note, updated_at)
     VALUES (?, ?, ?, ?, 1, '', ?)
     ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
    [randomUUID(), userId, habitId, date, toMySqlDateTime(new Date())],
  )
}

export const listEntryImages = async ({ userId, habitId, date }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const [rows] = await db.query(
    `SELECT id, user_id, habit_id, entry_date, storage_key, url, original_name, mime_type, file_size, created_at
     FROM habit_entry_images
     WHERE user_id = ? AND habit_id = ? AND entry_date = ?
     ORDER BY created_at DESC`,
    [userId, habitId, date],
  )
  return rows.map(toEntryImage)
}

export const addEntryImage = async ({
  userId,
  habitId,
  date,
  storageKey,
  url,
  originalName,
  mimeType,
  fileSize,
}) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  await ensureEntryExistsForImage({ userId, habitId, date })

  const db = await getDb()
  const image = {
    id: randomUUID(),
    userId,
    habitId,
    date,
    storageKey,
    url,
    originalName,
    mimeType,
    fileSize,
    createdAt: toMySqlDateTime(new Date()),
  }

  await db.query(
    `INSERT INTO habit_entry_images
     (id, user_id, habit_id, entry_date, storage_key, url, original_name, mime_type, file_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      image.id,
      image.userId,
      image.habitId,
      image.date,
      image.storageKey,
      image.url,
      image.originalName,
      image.mimeType,
      image.fileSize,
      image.createdAt,
    ],
  )
  return image
}

export const deleteEntryImage = async ({ userId, habitId, date, imageId }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const [rows] = await db.query(
    `SELECT id, user_id, habit_id, entry_date, storage_key, url, original_name, mime_type, file_size, created_at
     FROM habit_entry_images
     WHERE id = ? AND user_id = ? AND habit_id = ? AND entry_date = ?
     LIMIT 1`,
    [imageId, userId, habitId, date],
  )
  const image = rows[0] ? toEntryImage(rows[0]) : null
  if (!image) return null

  await db.query('DELETE FROM habit_entry_images WHERE id = ?', [image.id])
  return image
}

export const listVisionImages = async ({ userId, habitId, date }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const [rows] = await db.query(
    `SELECT id, user_id, habit_id, target_date, storage_key, url, original_name, mime_type, file_size, created_at
     FROM vision_images
     WHERE user_id = ? AND habit_id = ? AND target_date = ?
     ORDER BY created_at DESC`,
    [userId, habitId, date],
  )
  return rows.map(toVisionImage)
}

export const addVisionImage = async ({
  userId,
  habitId,
  date,
  storageKey,
  url,
  originalName,
  mimeType,
  fileSize,
}) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  if (!(await visionExistsForDate({ userId, habitId, date }))) return null

  const db = await getDb()
  const image = {
    id: randomUUID(),
    userId,
    habitId,
    date,
    storageKey,
    url,
    originalName,
    mimeType,
    fileSize,
    createdAt: toMySqlDateTime(new Date()),
  }

  await db.query(
    `INSERT INTO vision_images
     (id, user_id, habit_id, target_date, storage_key, url, original_name, mime_type, file_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      image.id,
      image.userId,
      image.habitId,
      image.date,
      image.storageKey,
      image.url,
      image.originalName,
      image.mimeType,
      image.fileSize,
      image.createdAt,
    ],
  )
  return image
}

export const deleteVisionImage = async ({ userId, habitId, date, imageId }) => {
  if (!(await habitBelongsToUser(userId, habitId))) return null
  const db = await getDb()
  const [rows] = await db.query(
    `SELECT id, user_id, habit_id, target_date, storage_key, url, original_name, mime_type, file_size, created_at
     FROM vision_images
     WHERE id = ? AND user_id = ? AND habit_id = ? AND target_date = ?
     LIMIT 1`,
    [imageId, userId, habitId, date],
  )
  const image = rows[0] ? toVisionImage(rows[0]) : null
  if (!image) return null

  await db.query('DELETE FROM vision_images WHERE id = ?', [image.id])
  return image
}
