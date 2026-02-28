import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.mjs'
import { closeDb } from './db.mjs'
import { createAccessToken, requireAuth } from './auth.mjs'
import {
  addVisionImage,
  createHabit,
  createUser,
  deleteEntry,
  deleteEntryImage,
  deleteHabit,
  deleteVision,
  deleteVisionImage,
  findUserByEmail,
  findUserById,
  habitBelongsToUser,
  initSchema,
  listEntriesForYear,
  listEntryImages,
  listHabits,
  listVisionImages,
  listVisionsForYear,
  reorderHabits,
  revokeToken,
  addEntryImage,
  upsertVision,
  upsertEntry,
} from './repository.mjs'

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadsDir = path.resolve(__dirname, '../uploads')

const isValidDateString = (dateValue) => /^\d{4}-\d{2}-\d{2}$/.test(dateValue)

const buildUploadMiddleware = () =>
  multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, uploadsDir),
      filename: (_req, file, callback) => {
        const ext = path.extname(file.originalname).slice(0, 10)
        callback(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`)
      },
    }),
    limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    fileFilter: (_req, file, callback) => {
      if (!file.mimetype.startsWith('image/')) {
        callback(new Error('Only image uploads are allowed'))
        return
      }
      callback(null, true)
    },
  })

const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt,
})

export const createApp = () => {
  const app = express()
  const upload = buildUploadMiddleware()
  app.use(cors())
  app.use(express.json())
  app.use('/uploads', express.static(uploadsDir))

  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true })
  })

  app.post('/api/auth/signup', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    if (!email.includes('@')) return res.status(400).json({ message: 'Valid email is required' })
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' })
    }

    const existing = await findUserByEmail(email)
    if (existing) return res.status(409).json({ message: 'Email already in use' })

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await createUser({ email, passwordHash })
    const tokenBundle = createAccessToken(user)
    return res.status(201).json({
      user: sanitizeUser(user),
      token: tokenBundle.token,
    })
  })

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const user = await findUserByEmail(email)
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' })

    const tokenBundle = createAccessToken(user)
    return res.json({
      user: sanitizeUser(user),
      token: tokenBundle.token,
    })
  })

  app.get('/api/auth/me', requireAuth, async (req, res) => {
    const user = await findUserById(req.auth.userId)
    if (!user) return res.status(401).json({ message: 'User not found' })
    return res.json({ user: sanitizeUser(user) })
  })

  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    const expDate = req.auth.exp ? new Date(req.auth.exp * 1000) : new Date(Date.now() + 86400000)
    await revokeToken({
      userId: req.auth.userId,
      tokenJti: req.auth.jti,
      expiresAt: expDate,
    })
    return res.status(204).send()
  })

  app.get('/api/habits', requireAuth, async (req, res) => {
    const habits = await listHabits(req.auth.userId)
    res.json({ habits })
  })

  app.post('/api/habits', requireAuth, async (req, res) => {
    const name = String(req.body?.name ?? '').trim()
    const color = String(req.body?.color ?? '').trim() || '#2f80ed'
    if (!name) return res.status(400).json({ message: 'Habit name is required' })
    const habit = await createHabit({ userId: req.auth.userId, name, color })
    return res.status(201).json({ habit })
  })

  app.patch('/api/habits/reorder', requireAuth, async (req, res) => {
    const habitIds = Array.isArray(req.body?.habitIds) ? req.body.habitIds : null
    if (!habitIds || !habitIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
      return res.status(400).json({ message: 'habitIds must be a non-empty array of habit ids' })
    }
    const habits = await reorderHabits({ userId: req.auth.userId, habitIds })
    if (!habits) return res.status(400).json({ message: 'habitIds must match your current habits exactly' })
    return res.json({ habits })
  })

  app.delete('/api/habits/:habitId', requireAuth, async (req, res) => {
    const removed = await deleteHabit({ userId: req.auth.userId, habitId: req.params.habitId })
    if (!removed) return res.status(404).json({ message: 'Habit not found' })
    return res.status(204).send()
  })

  app.get('/api/habits/:habitId/entries', requireAuth, async (req, res) => {
    const year = Number(req.query.year ?? new Date().getFullYear())
    if (!Number.isInteger(year) || year < 1970 || year > 3000) {
      return res.status(400).json({ message: 'Invalid year value' })
    }
    const entries = await listEntriesForYear({ userId: req.auth.userId, habitId: req.params.habitId, year })
    if (entries === null) return res.status(404).json({ message: 'Habit not found' })
    return res.json({ entries })
  })

  app.put('/api/habits/:habitId/entries/:date', requireAuth, async (req, res) => {
    const hasHabit = await habitBelongsToUser(req.auth.userId, req.params.habitId)
    if (!hasHabit) return res.status(404).json({ message: 'Habit not found' })

    const completed = Boolean(req.body?.completed)
    const note = String(req.body?.note ?? '')
    const entry = await upsertEntry({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
      completed,
      note,
    })
    return res.json({ entry })
  })

  app.delete('/api/habits/:habitId/entries/:date', requireAuth, async (req, res) => {
    const removed = await deleteEntry({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
    })
    if (!removed) return res.status(404).json({ message: 'Entry not found' })
    return res.status(204).send()
  })

  app.get('/api/habits/:habitId/entries/:date/images', requireAuth, async (req, res) => {
    if (!isValidDateString(req.params.date)) {
      return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
    }
    const images = await listEntryImages({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
    })
    if (images === null) return res.status(404).json({ message: 'Habit not found' })
    return res.json({ images })
  })

  app.get('/api/habits/:habitId/visions', requireAuth, async (req, res) => {
    const year = Number(req.query.year ?? new Date().getFullYear())
    if (!Number.isInteger(year) || year < 1970 || year > 3000) {
      return res.status(400).json({ message: 'Invalid year value' })
    }
    const visions = await listVisionsForYear({ userId: req.auth.userId, habitId: req.params.habitId, year })
    if (visions === null) return res.status(404).json({ message: 'Habit not found' })
    return res.json({ visions })
  })

  app.put('/api/habits/:habitId/visions/:date', requireAuth, async (req, res) => {
    if (!isValidDateString(req.params.date)) {
      return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
    }
    const title = String(req.body?.title ?? '').trim()
    const description = String(req.body?.description ?? '')
    if (!title) return res.status(400).json({ message: 'Vision title is required' })
    const vision = await upsertVision({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
      title,
      description,
    })
    if (!vision) return res.status(404).json({ message: 'Habit not found' })
    return res.json({ vision })
  })

  app.delete('/api/habits/:habitId/visions/:date', requireAuth, async (req, res) => {
    if (!isValidDateString(req.params.date)) {
      return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
    }
    const removed = await deleteVision({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
    })
    if (!removed) return res.status(404).json({ message: 'Vision not found' })
    return res.status(204).send()
  })

  app.post(
    '/api/habits/:habitId/entries/:date/images',
    requireAuth,
    upload.single('image'),
    async (req, res) => {
      if (!isValidDateString(req.params.date)) {
        return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
      }
      if (!req.file) return res.status(400).json({ message: 'Image file is required' })

      const image = await addEntryImage({
        userId: req.auth.userId,
        habitId: req.params.habitId,
        date: req.params.date,
        storageKey: req.file.filename,
        url: `/uploads/${req.file.filename}`,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
      })
      if (image === null) return res.status(404).json({ message: 'Habit not found' })
      return res.status(201).json({ image })
    },
  )

  app.delete('/api/habits/:habitId/entries/:date/images/:imageId', requireAuth, async (req, res) => {
    if (!isValidDateString(req.params.date)) {
      return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
    }
    const image = await deleteEntryImage({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
      imageId: req.params.imageId,
    })
    if (!image) return res.status(404).json({ message: 'Image not found' })

    await fs.unlink(path.join(uploadsDir, image.storageKey)).catch(() => {})
    return res.status(204).send()
  })

  app.get('/api/habits/:habitId/visions/:date/images', requireAuth, async (req, res) => {
    if (!isValidDateString(req.params.date)) {
      return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
    }
    const images = await listVisionImages({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
    })
    if (images === null) return res.status(404).json({ message: 'Habit not found' })
    return res.json({ images })
  })

  app.post(
    '/api/habits/:habitId/visions/:date/images',
    requireAuth,
    upload.single('image'),
    async (req, res) => {
      if (!isValidDateString(req.params.date)) {
        return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
      }
      if (!req.file) return res.status(400).json({ message: 'Image file is required' })
      const image = await addVisionImage({
        userId: req.auth.userId,
        habitId: req.params.habitId,
        date: req.params.date,
        storageKey: req.file.filename,
        url: `/uploads/${req.file.filename}`,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
      })
      if (image === null) return res.status(404).json({ message: 'Vision not found' })
      return res.status(201).json({ image })
    },
  )

  app.delete('/api/habits/:habitId/visions/:date/images/:imageId', requireAuth, async (req, res) => {
    if (!isValidDateString(req.params.date)) {
      return res.status(400).json({ message: 'Date must use YYYY-MM-DD format' })
    }
    const image = await deleteVisionImage({
      userId: req.auth.userId,
      habitId: req.params.habitId,
      date: req.params.date,
      imageId: req.params.imageId,
    })
    if (!image) return res.status(404).json({ message: 'Vision image not found' })
    await fs.unlink(path.join(uploadsDir, image.storageKey)).catch(() => {})
    return res.status(204).send()
  })

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Image exceeds 8MB limit' })
    }
    if (err?.message === 'Only image uploads are allowed') {
      return res.status(400).json({ message: err.message })
    }
    console.error(err)
    res.status(500).json({ message: 'Unexpected server error' })
  })

  return app
}

export const startServer = async ({ port = config.apiPort, log = true } = {}) => {
  await fs.mkdir(uploadsDir, { recursive: true })
  await initSchema()
  const app = createApp()
  const server = await new Promise((resolve) => {
    const instance = app.listen(port, () => resolve(instance))
  })
  const actualPort = server.address()?.port ?? port
  if (log) {
    console.log(`API ready on http://localhost:${actualPort}`)
  }
  return { app, server, port: actualPort }
}

export const stopServer = async (server) => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
  await closeDb()
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
  let startedServer
  startServer({ port: config.apiPort, log: true })
    .then(({ server }) => {
      startedServer = server
    })
    .catch(async (error) => {
      console.error('Failed to boot API:', error)
      await closeDb()
      process.exit(1)
    })

  const shutdown = async () => {
    await stopServer(startedServer)
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
