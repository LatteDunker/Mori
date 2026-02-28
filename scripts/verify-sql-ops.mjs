import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { closeDb } from '../server/db.mjs'
import { startServer, stopServer } from '../server/index.mjs'
import {
  addEntryImage,
  addVisionImage,
  createHabit,
  createUser,
  deleteEntryImage,
  deleteVision,
  deleteVisionImage,
  deleteUserByEmail,
  deleteEntry,
  deleteHabit,
  findUserByEmail,
  initSchema,
  isTokenRevoked,
  listEntryImages,
  listEntriesForYear,
  listHabits,
  listVisionImages,
  listVisionsForYear,
  reorderHabits,
  revokeToken,
  updateHabit,
  upsertVision,
  upsertEntry,
} from '../server/repository.mjs'

const log = (step, value) => {
  console.log(`\n[health-check] ${step}`)
  if (value !== undefined) {
    console.log(JSON.stringify(value, null, 2))
  }
}

const assert = (condition, message, details) => {
  if (!condition) {
    log('assertion failed', { message, details })
    throw new Error(message)
  }
}

const request = async (baseUrl, path, { method = 'GET', token, body } = {}) => {
  const headers = {}
  const isFormData = body instanceof FormData
  if (!isFormData) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }
  }
  log(`endpoint ${method} ${path}`, { status: response.status, payload })
  return { status: response.status, payload }
}

const runRepositoryChecks = async () => {
  const year = new Date().getFullYear()
  const repoEmail = `repo-check-${Date.now()}@example.com`
  const otherEmail = `repo-other-${Date.now()}@example.com`
  const testDateA = `${year}-02-01`
  const testDateB = `${year}-02-02`

  await initSchema()
  await deleteUserByEmail(repoEmail)
  await deleteUserByEmail(otherEmail)
  log('schema + repository pre-cleanup complete')

  const passwordHash = await bcrypt.hash('repo-pass-123', 10)
  const user = await createUser({ email: repoEmail, passwordHash })
  const otherUser = await createUser({ email: otherEmail, passwordHash })
  log('users created', { user, otherUser })

  const foundUser = await findUserByEmail(repoEmail)
  assert(foundUser?.id === user.id, 'findUserByEmail should return created user', { foundUser, user })

  const habit = await createHabit({ userId: user.id, name: 'Repo Habit', color: '#1d4ed8' })
  const secondHabit = await createHabit({ userId: user.id, name: 'Repo Habit Two', color: '#16a34a' })
  await createHabit({ userId: otherUser.id, name: 'Other User Habit', color: '#6d28d9' })
  log('habits created', { habit, secondHabit })

  const ownHabits = await listHabits(user.id)
  const otherHabits = await listHabits(otherUser.id)
  assert(ownHabits.length === 2, 'listHabits should only return own habits', ownHabits)
  assert(otherHabits.length === 1, 'other user should have isolated habits', otherHabits)

  const reorderedHabits = await reorderHabits({ userId: user.id, habitIds: [secondHabit.id, habit.id] })
  assert(
    Array.isArray(reorderedHabits) &&
      reorderedHabits.length === 2 &&
      reorderedHabits[0]?.id === secondHabit.id &&
      reorderedHabits[1]?.id === habit.id,
    'reorderHabits should persist the new sort order',
    reorderedHabits,
  )

  const updatedHabit = await updateHabit({
    userId: user.id,
    habitId: habit.id,
    name: 'Repo Habit Updated',
    color: '#f97316',
  })
  assert(
    updatedHabit?.id === habit.id && updatedHabit?.name === 'Repo Habit Updated' && updatedHabit?.color === '#f97316',
    'updateHabit should update habit name and color',
    updatedHabit,
  )

  const firstEntry = await upsertEntry({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    completed: true,
    note: '',
  })
  const secondEntry = await upsertEntry({
    userId: user.id,
    habitId: habit.id,
    date: testDateB,
    completed: false,
    note: 'Repository method note',
  })
  log('entries upserted via repository', { firstEntry, secondEntry })

  const ownEntries = await listEntriesForYear({ userId: user.id, habitId: habit.id, year })
  assert(Array.isArray(ownEntries) && ownEntries.length === 2, 'listEntriesForYear should return 2 rows', ownEntries)

  const repoImageA = await addEntryImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    storageKey: 'repo-image-a.png',
    url: '/uploads/repo-image-a.png',
    originalName: 'repo-image-a.png',
    mimeType: 'image/png',
    fileSize: 1024,
  })
  assert(Boolean(repoImageA?.id), 'addEntryImage should create metadata row', repoImageA)

  const imageRows = await listEntryImages({ userId: user.id, habitId: habit.id, date: testDateA })
  assert(Array.isArray(imageRows) && imageRows.length === 1, 'listEntryImages should return uploaded image', imageRows)

  const entriesWithImages = await listEntriesForYear({ userId: user.id, habitId: habit.id, year })
  const entryForDateA = entriesWithImages?.find((entry) => entry.date === testDateA)
  assert(Number(entryForDateA?.imageCount ?? 0) === 1, 'entry image_count should reflect db change', entryForDateA)

  const removedImage = await deleteEntryImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    imageId: repoImageA.id,
  })
  assert(removedImage?.id === repoImageA.id, 'deleteEntryImage should remove inserted image row', removedImage)

  const imagesAfterDelete = await listEntryImages({ userId: user.id, habitId: habit.id, date: testDateA })
  assert(Array.isArray(imagesAfterDelete) && imagesAfterDelete.length === 0, 'image rows should be empty after delete', imagesAfterDelete)

  const vision = await upsertVision({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    title: 'Run half marathon',
    description: 'Confident finish and pace control',
  })
  assert(Boolean(vision?.id), 'upsertVision should create a row', vision)

  const visions = await listVisionsForYear({ userId: user.id, habitId: habit.id, year })
  assert(Array.isArray(visions) && visions.length === 1, 'listVisionsForYear should return one row', visions)

  const visionImage = await addVisionImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    storageKey: 'repo-vision-image.png',
    url: '/uploads/repo-vision-image.png',
    originalName: 'repo-vision-image.png',
    mimeType: 'image/png',
    fileSize: 2048,
  })
  assert(Boolean(visionImage?.id), 'addVisionImage should create metadata row', visionImage)

  const visionImageRows = await listVisionImages({ userId: user.id, habitId: habit.id, date: testDateA })
  assert(
    Array.isArray(visionImageRows) && visionImageRows.length === 1,
    'listVisionImages should return inserted row',
    visionImageRows,
  )

  const removedVisionImage = await deleteVisionImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    imageId: visionImage.id,
  })
  assert(removedVisionImage?.id === visionImage.id, 'deleteVisionImage should remove inserted row', removedVisionImage)

  const visionDeleted = await deleteVision({ userId: user.id, habitId: habit.id, date: testDateA })
  assert(visionDeleted, 'deleteVision should remove vision row', { visionDeleted })

  const forbiddenUpsert = await upsertEntry({
    userId: otherUser.id,
    habitId: habit.id,
    date: testDateA,
    completed: true,
    note: 'Should fail',
  })
  assert(forbiddenUpsert === null, 'upsertEntry should reject cross-user habit access', forbiddenUpsert)

  const deletedEntry = await deleteEntry({ userId: user.id, habitId: habit.id, date: testDateB })
  assert(deletedEntry, 'deleteEntry should remove own entry', { deletedEntry })

  const jti = randomUUID()
  await revokeToken({
    userId: user.id,
    tokenJti: jti,
    expiresAt: new Date(Date.now() + 3600000),
  })
  const revoked = await isTokenRevoked(jti)
  assert(revoked, 'isTokenRevoked should return true for revoked jti', { jti, revoked })

  const deletedHabit = await deleteHabit({ userId: user.id, habitId: habit.id })
  assert(deletedHabit, 'deleteHabit should remove own habit', { deletedHabit })

  await deleteUserByEmail(repoEmail)
  await deleteUserByEmail(otherEmail)
  log('repository checks complete', { ok: true })
}

const runEndpointChecks = async () => {
  const serverBundle = await startServer({ port: 0, log: false })
  const baseUrl = `http://127.0.0.1:${serverBundle.port}`
  const email = `api-check-${Date.now()}@example.com`
  const password = 'api-pass-123'
  const year = new Date().getFullYear()
  const dateA = `${year}-03-01`
  const dateB = `${year}-03-02`

  try {
    const health = await request(baseUrl, '/api/health')
    assert(health.status === 200 && health.payload?.ok === true, 'health endpoint should return ok')

    const unauthorized = await request(baseUrl, '/api/habits')
    assert(unauthorized.status === 401, 'habits route should require bearer token', unauthorized)

    const signup = await request(baseUrl, '/api/auth/signup', {
      method: 'POST',
      body: { email, password },
    })
    assert(signup.status === 201, 'signup should return 201', signup)
    assert(Boolean(signup.payload?.token), 'signup should return token', signup.payload)
    const signupToken = signup.payload.token

    const login = await request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    assert(login.status === 200 && Boolean(login.payload?.token), 'login should return token', login)
    const token = login.payload.token

    const me = await request(baseUrl, '/api/auth/me', { token: signupToken })
    assert(me.status === 200 && me.payload?.user?.email === email, 'auth/me should return current user', me)

    const createdHabit = await request(baseUrl, '/api/habits', {
      method: 'POST',
      token,
      body: { name: 'API Habit', color: '#2f80ed' },
    })
    assert(createdHabit.status === 201, 'create habit endpoint should return 201', createdHabit)
    const habitId = createdHabit.payload.habit.id
    const createdHabitTwo = await request(baseUrl, '/api/habits', {
      method: 'POST',
      token,
      body: { name: 'API Habit Two', color: '#16a34a' },
    })
    assert(createdHabitTwo.status === 201, 'create second habit endpoint should return 201', createdHabitTwo)
    const habitIdTwo = createdHabitTwo.payload.habit.id

    const habits = await request(baseUrl, '/api/habits', { token })
    assert(habits.status === 200 && habits.payload?.habits?.length >= 2, 'list habits should return rows', habits)

    const reorderHabitsResponse = await request(baseUrl, '/api/habits/reorder', {
      method: 'PATCH',
      token,
      body: { habitIds: [habitIdTwo, habitId] },
    })
    assert(
      reorderHabitsResponse.status === 200 &&
        Array.isArray(reorderHabitsResponse.payload?.habits) &&
        reorderHabitsResponse.payload.habits[0]?.id === habitIdTwo &&
        reorderHabitsResponse.payload.habits[1]?.id === habitId,
      'reorder habits endpoint should return habits in requested order',
      reorderHabitsResponse,
    )

    const habitsAfterReorder = await request(baseUrl, '/api/habits', { token })
    assert(
      habitsAfterReorder.status === 200 &&
        Array.isArray(habitsAfterReorder.payload?.habits) &&
        habitsAfterReorder.payload.habits[0]?.id === habitIdTwo &&
        habitsAfterReorder.payload.habits[1]?.id === habitId,
      'list habits should preserve persisted reorder',
      habitsAfterReorder,
    )

    const updateHabitResponse = await request(baseUrl, `/api/habits/${habitId}`, {
      method: 'PATCH',
      token,
      body: { name: 'API Habit Updated', color: '#f97316' },
    })
    assert(
      updateHabitResponse.status === 200 &&
        updateHabitResponse.payload?.habit?.id === habitId &&
        updateHabitResponse.payload?.habit?.name === 'API Habit Updated' &&
        updateHabitResponse.payload?.habit?.color === '#f97316',
      'update habit endpoint should return updated habit',
      updateHabitResponse,
    )

    const upsertA = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}`, {
      method: 'PUT',
      token,
      body: { completed: true, note: '' },
    })
    assert(upsertA.status === 200, 'upsert entry should return 200', upsertA)

    const upsertB = await request(baseUrl, `/api/habits/${habitId}/entries/${dateB}`, {
      method: 'PUT',
      token,
      body: { completed: false, note: 'API flow note' },
    })
    assert(upsertB.status === 200, 'upsert note entry should return 200', upsertB)

    const listEntries = await request(baseUrl, `/api/habits/${habitId}/entries?year=${year}`, { token })
    assert(
      listEntries.status === 200 && Array.isArray(listEntries.payload?.entries) && listEntries.payload.entries.length === 2,
      'list entries endpoint should return 2 rows',
      listEntries,
    )

    const upsertVisionResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}`, {
      method: 'PUT',
      token,
      body: { title: 'Launch my coaching site', description: 'Landing page, payment flow, first clients' },
    })
    assert(upsertVisionResponse.status === 200, 'upsert vision endpoint should return 200', upsertVisionResponse)

    const listVisionsResponse = await request(baseUrl, `/api/habits/${habitId}/visions?year=${year}`, { token })
    assert(
      listVisionsResponse.status === 200 &&
        Array.isArray(listVisionsResponse.payload?.visions) &&
        listVisionsResponse.payload.visions.length === 1,
      'list visions endpoint should return one row',
      listVisionsResponse,
    )

    const imageForm = new FormData()
    imageForm.append('image', new Blob(['fakepng'], { type: 'image/png' }), 'api-image.png')
    const uploadImage = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}/images`, {
      method: 'POST',
      token,
      body: imageForm,
    })
    assert(uploadImage.status === 201, 'image upload endpoint should return 201', uploadImage)
    const imageId = uploadImage.payload?.image?.id
    assert(Boolean(imageId), 'image upload should return image id', uploadImage.payload)

    const listImages = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}/images`, { token })
    assert(
      listImages.status === 200 &&
        Array.isArray(listImages.payload?.images) &&
        listImages.payload.images.length === 1,
      'list images endpoint should return uploaded image',
      listImages,
    )

    const oversizedPayload = new Uint8Array(8 * 1024 * 1024 + 10)
    const tooLargeForm = new FormData()
    tooLargeForm.append('image', new Blob([oversizedPayload], { type: 'image/jpeg' }), 'too-large.jpg')
    const tooLargeUpload = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}/images`, {
      method: 'POST',
      token,
      body: tooLargeForm,
    })
    assert(tooLargeUpload.status === 413, 'oversized uploads should be rejected with 413', tooLargeUpload)

    const deleteImageResponse = await request(
      baseUrl,
      `/api/habits/${habitId}/entries/${dateA}/images/${imageId}`,
      {
        method: 'DELETE',
        token,
      },
    )
    assert(deleteImageResponse.status === 204, 'delete image endpoint should return 204', deleteImageResponse)

    const visionImageForm = new FormData()
    visionImageForm.append('image', new Blob(['fakevision'], { type: 'image/png' }), 'vision-image.png')
    const uploadVisionImageResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}/images`, {
      method: 'POST',
      token,
      body: visionImageForm,
    })
    assert(uploadVisionImageResponse.status === 201, 'vision image upload should return 201', uploadVisionImageResponse)
    const visionImageId = uploadVisionImageResponse.payload?.image?.id

    const listVisionImagesResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}/images`, { token })
    assert(
      listVisionImagesResponse.status === 200 &&
        Array.isArray(listVisionImagesResponse.payload?.images) &&
        listVisionImagesResponse.payload.images.length === 1,
      'list vision images endpoint should return one row',
      listVisionImagesResponse,
    )

    const deleteVisionImageResponse = await request(
      baseUrl,
      `/api/habits/${habitId}/visions/${dateA}/images/${visionImageId}`,
      {
        method: 'DELETE',
        token,
      },
    )
    assert(deleteVisionImageResponse.status === 204, 'delete vision image endpoint should return 204', deleteVisionImageResponse)

    const deleteVisionResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}`, {
      method: 'DELETE',
      token,
    })
    assert(deleteVisionResponse.status === 204, 'delete vision endpoint should return 204', deleteVisionResponse)

    const deleteEntryResponse = await request(baseUrl, `/api/habits/${habitId}/entries/${dateB}`, {
      method: 'DELETE',
      token,
    })
    assert(deleteEntryResponse.status === 204, 'delete entry endpoint should return 204', deleteEntryResponse)

    const logout = await request(baseUrl, '/api/auth/logout', { method: 'POST', token })
    assert(logout.status === 204, 'logout should return 204', logout)

    const afterLogout = await request(baseUrl, '/api/habits', { token })
    assert(afterLogout.status === 401, 'token should be unusable after logout (revoked)', afterLogout)

    log('endpoint checks complete', { ok: true })
  } finally {
    await deleteUserByEmail(email)
    await stopServer(serverBundle.server)
  }
}

const run = async () => {
  await runRepositoryChecks()
  await runEndpointChecks()
  log('full health check complete', { ok: true })
}

run()
  .catch((error) => {
    console.error('\n[health-check] failed')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
