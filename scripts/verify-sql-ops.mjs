import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { closeDb } from '../server/db.mjs'
import { startServer, stopServer } from '../server/index.mjs'
import {
  addEntryImage,
  addVisionImage,
  archiveHabit,
  createEntry,
  createHabit,
  createUser,
  createVision,
  clearUserProfileImage,
  deleteEntryById,
  deleteEntryImage,
  deleteVisionById,
  deleteVisionImage,
  deleteUserByEmail,
  deleteHabit,
  findUserByEmail,
  findUserById,
  initSchema,
  isTokenRevoked,
  listEntryImages,
  listEntriesForDate,
  listEntriesForYear,
  listHabits,
  listArchivedHabits,
  listVisionImages,
  listVisionsForDate,
  listVisionsForYear,
  reorderHabits,
  revokeToken,
  restoreHabit,
  setUserProfileImage,
  updateHabit,
  updateEntry,
  updateVision,
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

const requestBinary = async (baseUrl, path) => {
  const response = await fetch(`${baseUrl}${path}`)
  const bytes = await response.arrayBuffer()
  const result = {
    status: response.status,
    byteLength: bytes.byteLength,
    contentType: response.headers.get('content-type') ?? '',
  }
  log(`binary GET ${path}`, result)
  return result
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

  const profileSet = await setUserProfileImage({
    userId: user.id,
    storageKey: 'repo-profile.png',
    url: '/uploads/repo-profile.png',
  })
  assert(profileSet?.user?.profileImageUrl === '/uploads/repo-profile.png', 'setUserProfileImage should persist profile url', profileSet)

  const userAfterProfileSet = await findUserById(user.id)
  assert(userAfterProfileSet?.profileImageStorageKey === 'repo-profile.png', 'findUserById should include profile image metadata', userAfterProfileSet)

  const profileCleared = await clearUserProfileImage(user.id)
  assert(profileCleared?.user?.profileImageUrl === null, 'clearUserProfileImage should remove profile image', profileCleared)

  const habit = await createHabit({ userId: user.id, name: 'Repo Habit', color: '#1d4ed8' })
  const secondHabit = await createHabit({ userId: user.id, name: 'Repo Habit Two', color: '#16a34a' })
  await createHabit({ userId: otherUser.id, name: 'Other User Habit', color: '#6d28d9' })
  log('habits created', { habit, secondHabit })

  const ownHabits = await listHabits(user.id)
  const otherHabits = await listHabits(otherUser.id)
  assert(ownHabits.length === 2, 'listHabits should only return own habits', ownHabits)
  assert(otherHabits.length === 1, 'other user should have isolated habits', otherHabits)

  const archivedSecondHabit = await archiveHabit({ userId: user.id, habitId: secondHabit.id })
  assert(archivedSecondHabit?.id === secondHabit.id, 'archiveHabit should move habit out of active list', archivedSecondHabit)
  const activeAfterArchive = await listHabits(user.id)
  const archivedAfterArchive = await listArchivedHabits(user.id)
  assert(activeAfterArchive.length === 1 && activeAfterArchive[0]?.id === habit.id, 'active habits should hide archived habits', activeAfterArchive)
  assert(
    archivedAfterArchive.length === 1 && archivedAfterArchive[0]?.id === secondHabit.id,
    'listArchivedHabits should return archived habits',
    archivedAfterArchive,
  )

  const restoredSecondHabit = await restoreHabit({ userId: user.id, habitId: secondHabit.id })
  assert(restoredSecondHabit?.id === secondHabit.id, 'restoreHabit should return archived habit to active list', restoredSecondHabit)
  const activeAfterRestore = await listHabits(user.id)
  const archivedAfterRestore = await listArchivedHabits(user.id)
  assert(activeAfterRestore.length === 2, 'active habits should include restored habit', activeAfterRestore)
  assert(archivedAfterRestore.length === 0, 'archived habits should be empty after restore', archivedAfterRestore)

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

  const firstEntry = await createEntry({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    completed: true,
    note: '',
    customColor: '#22c55e',
  })
  const secondEntry = await createEntry({
    userId: user.id,
    habitId: habit.id,
    date: testDateB,
    completed: false,
    note: 'Repository method note',
    customColor: '#2563eb',
  })
  log('entries created via repository', { firstEntry, secondEntry })
  assert(firstEntry?.customColor === '#22c55e', 'createEntry should persist custom entry color', firstEntry)
  assert(secondEntry?.customColor === '#2563eb', 'createEntry should persist custom entry color', secondEntry)

  const updatedSecondEntry = await updateEntry({
    userId: user.id,
    habitId: habit.id,
    date: testDateB,
    entryId: secondEntry.id,
    completed: true,
    note: 'Updated repository method note',
    customColor: '#f59e0b',
  })
  assert(updatedSecondEntry?.customColor === '#f59e0b', 'updateEntry should update custom color', updatedSecondEntry)

  const ownEntries = await listEntriesForYear({ userId: user.id, habitId: habit.id, year })
  assert(Array.isArray(ownEntries) && ownEntries.length === 2, 'listEntriesForYear should return 2 rows', ownEntries)
  const ownEntryA = ownEntries.find((entry) => entry.date === testDateA)
  assert(ownEntryA?.customColor === '#22c55e', 'listEntriesForYear should include custom entry color', ownEntryA)
  const entriesOnDateA = await listEntriesForDate({ userId: user.id, habitId: habit.id, date: testDateA })
  assert(Array.isArray(entriesOnDateA) && entriesOnDateA.length === 1, 'listEntriesForDate should list entries for a day', entriesOnDateA)

  const repoImageA = await addEntryImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    entryId: firstEntry.id,
    storageKey: 'repo-image-a.png',
    url: '/uploads/repo-image-a.png',
    originalName: 'repo-image-a.png',
    mimeType: 'image/png',
    fileSize: 1024,
  })
  assert(Boolean(repoImageA?.id), 'addEntryImage should create metadata row', repoImageA)

  const imageRows = await listEntryImages({ userId: user.id, habitId: habit.id, date: testDateA, entryId: firstEntry.id })
  assert(Array.isArray(imageRows) && imageRows.length === 1, 'listEntryImages should return uploaded image', imageRows)

  const entriesWithImages = await listEntriesForYear({ userId: user.id, habitId: habit.id, year })
  const entryForDateA = entriesWithImages?.find((entry) => entry.date === testDateA)
  assert(Number(entryForDateA?.imageCount ?? 0) === 1, 'entry image_count should reflect db change', entryForDateA)

  const removedImage = await deleteEntryImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    entryId: firstEntry.id,
    imageId: repoImageA.id,
  })
  assert(removedImage?.id === repoImageA.id, 'deleteEntryImage should remove inserted image row', removedImage)

  const imagesAfterDelete = await listEntryImages({ userId: user.id, habitId: habit.id, date: testDateA, entryId: firstEntry.id })
  assert(Array.isArray(imagesAfterDelete) && imagesAfterDelete.length === 0, 'image rows should be empty after delete', imagesAfterDelete)

  const vision = await createVision({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    title: 'Run half marathon',
    description: 'Confident finish and pace control',
    customColor: '#7c3aed',
  })
  assert(Boolean(vision?.id), 'createVision should create a row', vision)
  assert(vision?.customColor === '#7c3aed', 'createVision should persist custom vision color', vision)

  const updatedVision = await updateVision({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    visionId: vision.id,
    title: 'Run full marathon',
    description: 'Confident finish and pace control',
    customColor: '#4f46e5',
  })
  assert(updatedVision?.customColor === '#4f46e5', 'updateVision should update custom vision color', updatedVision)

  const visions = await listVisionsForYear({ userId: user.id, habitId: habit.id, year })
  assert(Array.isArray(visions) && visions.length === 1, 'listVisionsForYear should return one row', visions)
  assert(visions[0]?.customColor === '#4f46e5', 'listVisionsForYear should include custom vision color', visions[0])
  const visionsOnDateA = await listVisionsForDate({ userId: user.id, habitId: habit.id, date: testDateA })
  assert(Array.isArray(visionsOnDateA) && visionsOnDateA.length === 1, 'listVisionsForDate should list visions for a day', visionsOnDateA)

  const visionImage = await addVisionImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    visionId: vision.id,
    storageKey: 'repo-vision-image.png',
    url: '/uploads/repo-vision-image.png',
    originalName: 'repo-vision-image.png',
    mimeType: 'image/png',
    fileSize: 2048,
  })
  assert(Boolean(visionImage?.id), 'addVisionImage should create metadata row', visionImage)

  const visionImageRows = await listVisionImages({ userId: user.id, habitId: habit.id, date: testDateA, visionId: vision.id })
  assert(
    Array.isArray(visionImageRows) && visionImageRows.length === 1,
    'listVisionImages should return inserted row',
    visionImageRows,
  )

  const removedVisionImage = await deleteVisionImage({
    userId: user.id,
    habitId: habit.id,
    date: testDateA,
    visionId: vision.id,
    imageId: visionImage.id,
  })
  assert(removedVisionImage?.id === visionImage.id, 'deleteVisionImage should remove inserted row', removedVisionImage)

  const visionDeleted = await deleteVisionById({ userId: user.id, habitId: habit.id, date: testDateA, visionId: vision.id })
  assert(visionDeleted, 'deleteVisionById should remove vision row', { visionDeleted })

  const forbiddenCreateEntry = await createEntry({
    userId: otherUser.id,
    habitId: habit.id,
    date: testDateA,
    completed: true,
    note: 'Should fail',
  })
  assert(forbiddenCreateEntry === null, 'createEntry should reject cross-user habit access', forbiddenCreateEntry)

  const deletedEntry = await deleteEntryById({ userId: user.id, habitId: habit.id, date: testDateB, entryId: secondEntry.id })
  assert(deletedEntry, 'deleteEntryById should remove own entry', { deletedEntry })

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

    const profileImageForm = new FormData()
    profileImageForm.append('image', new Blob(['profile'], { type: 'image/png' }), 'profile.png')
    const uploadProfileImageResponse = await request(baseUrl, '/api/auth/profile-image', {
      method: 'POST',
      token,
      body: profileImageForm,
    })
    assert(
      uploadProfileImageResponse.status === 200 &&
        typeof uploadProfileImageResponse.payload?.user?.profileImageUrl === 'string' &&
        uploadProfileImageResponse.payload.user.profileImageUrl.startsWith('/uploads/'),
      'profile image upload endpoint should return user with profileImageUrl',
      uploadProfileImageResponse,
    )
    const profileImageUrl = uploadProfileImageResponse.payload.user.profileImageUrl
    const profileImageFetch = await requestBinary(baseUrl, profileImageUrl)
    assert(
      profileImageFetch.status === 200 && profileImageFetch.byteLength > 0,
      'uploaded profile image url should be directly fetchable',
      profileImageFetch,
    )

    const meAfterProfileUpload = await request(baseUrl, '/api/auth/me', { token })
    assert(
      meAfterProfileUpload.status === 200 &&
        typeof meAfterProfileUpload.payload?.user?.profileImageUrl === 'string' &&
        meAfterProfileUpload.payload.user.profileImageUrl.startsWith('/uploads/'),
      'auth/me should include profileImageUrl after upload',
      meAfterProfileUpload,
    )

    const deleteProfileImageResponse = await request(baseUrl, '/api/auth/profile-image', {
      method: 'DELETE',
      token,
    })
    assert(
      deleteProfileImageResponse.status === 200 && deleteProfileImageResponse.payload?.user?.profileImageUrl === null,
      'delete profile image endpoint should clear profileImageUrl',
      deleteProfileImageResponse,
    )

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

    const archiveHabitResponse = await request(baseUrl, `/api/habits/${habitIdTwo}/archive`, {
      method: 'POST',
      token,
    })
    assert(
      archiveHabitResponse.status === 200 && archiveHabitResponse.payload?.habit?.id === habitIdTwo,
      'archive habit endpoint should move habit to archive collection',
      archiveHabitResponse,
    )

    const activeHabitsAfterArchive = await request(baseUrl, '/api/habits', { token })
    assert(
      activeHabitsAfterArchive.status === 200 &&
        Array.isArray(activeHabitsAfterArchive.payload?.habits) &&
        activeHabitsAfterArchive.payload.habits.length === 1 &&
        activeHabitsAfterArchive.payload.habits[0]?.id === habitId,
      'list habits should exclude archived habits',
      activeHabitsAfterArchive,
    )

    const archivedHabitsResponse = await request(baseUrl, '/api/habits/archive', { token })
    assert(
      archivedHabitsResponse.status === 200 &&
        Array.isArray(archivedHabitsResponse.payload?.habits) &&
        archivedHabitsResponse.payload.habits.length === 1 &&
        archivedHabitsResponse.payload.habits[0]?.id === habitIdTwo,
      'list archived habits endpoint should include archived habit',
      archivedHabitsResponse,
    )

    const restoreHabitResponse = await request(baseUrl, `/api/habits/${habitIdTwo}/restore`, {
      method: 'POST',
      token,
    })
    assert(
      restoreHabitResponse.status === 200 && restoreHabitResponse.payload?.habit?.id === habitIdTwo,
      'restore habit endpoint should return habit to active list',
      restoreHabitResponse,
    )

    const archivedAfterRestoreResponse = await request(baseUrl, '/api/habits/archive', { token })
    assert(
      archivedAfterRestoreResponse.status === 200 &&
        Array.isArray(archivedAfterRestoreResponse.payload?.habits) &&
        archivedAfterRestoreResponse.payload.habits.length === 0,
      'archive list should be empty after restoring the habit',
      archivedAfterRestoreResponse,
    )

    const deleteRestoredHabit = await request(baseUrl, `/api/habits/${habitIdTwo}`, {
      method: 'DELETE',
      token,
    })
    assert(deleteRestoredHabit.status === 204, 'delete endpoint should delete restored habits', deleteRestoredHabit)

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

    const createEntryA = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}`, {
      method: 'POST',
      token,
      body: { completed: true, note: '', customColor: '#14b8a6' },
    })
    assert(createEntryA.status === 201, 'create entry should return 201', createEntryA)
    assert(createEntryA.payload?.entry?.customColor === '#14b8a6', 'entry endpoint should persist custom color', createEntryA)
    const entryAId = createEntryA.payload?.entry?.id

    const createEntryB = await request(baseUrl, `/api/habits/${habitId}/entries/${dateB}`, {
      method: 'POST',
      token,
      body: { completed: false, note: 'API flow note', customColor: '#ea580c' },
    })
    assert(createEntryB.status === 201, 'create note entry should return 201', createEntryB)
    assert(createEntryB.payload?.entry?.customColor === '#ea580c', 'entry endpoint should persist custom color', createEntryB)
    const entryBId = createEntryB.payload?.entry?.id

    const updateEntryB = await request(baseUrl, `/api/habits/${habitId}/entries/${dateB}/${entryBId}`, {
      method: 'PATCH',
      token,
      body: { completed: true, note: 'API flow note updated', customColor: '#fb7185' },
    })
    assert(updateEntryB.status === 200, 'update entry should return 200', updateEntryB)
    assert(updateEntryB.payload?.entry?.customColor === '#fb7185', 'update entry should persist new custom color', updateEntryB)

    const listEntries = await request(baseUrl, `/api/habits/${habitId}/entries?year=${year}`, { token })
    assert(
      listEntries.status === 200 && Array.isArray(listEntries.payload?.entries) && listEntries.payload.entries.length === 2,
      'list entries endpoint should return 2 rows',
      listEntries,
    )
    const listedEntryA = listEntries.payload.entries.find((entry) => entry.date === dateA)
    assert(listedEntryA?.customColor === '#14b8a6', 'list entries endpoint should return customColor', listedEntryA)
    const listEntriesForDateA = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}`, { token })
    assert(
      listEntriesForDateA.status === 200 &&
        Array.isArray(listEntriesForDateA.payload?.entries) &&
        listEntriesForDateA.payload.entries.length === 1,
      'list entries by date endpoint should return day cards',
      listEntriesForDateA,
    )

    const createVisionResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}`, {
      method: 'POST',
      token,
      body: { title: 'Launch my coaching site', description: 'Landing page, payment flow, first clients', customColor: '#9333ea' },
    })
    assert(createVisionResponse.status === 201, 'create vision endpoint should return 201', createVisionResponse)
    assert(
      createVisionResponse.payload?.vision?.customColor === '#9333ea',
      'vision endpoint should persist custom color',
      createVisionResponse,
    )
    const visionId = createVisionResponse.payload?.vision?.id

    const updateVisionResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}/${visionId}`, {
      method: 'PATCH',
      token,
      body: { title: 'Launch my coaching site updated', description: 'Landing page updated', customColor: '#7c3aed' },
    })
    assert(updateVisionResponse.status === 200, 'update vision endpoint should return 200', updateVisionResponse)
    assert(
      updateVisionResponse.payload?.vision?.customColor === '#7c3aed',
      'update vision endpoint should persist new custom color',
      updateVisionResponse,
    )

    const listVisionsResponse = await request(baseUrl, `/api/habits/${habitId}/visions?year=${year}`, { token })
    assert(
      listVisionsResponse.status === 200 &&
        Array.isArray(listVisionsResponse.payload?.visions) &&
        listVisionsResponse.payload.visions.length === 1,
      'list visions endpoint should return one row',
      listVisionsResponse,
    )
    assert(
      listVisionsResponse.payload.visions[0]?.customColor === '#7c3aed',
      'list visions endpoint should return customColor',
      listVisionsResponse.payload.visions[0],
    )
    const listVisionsForDateA = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}`, { token })
    assert(
      listVisionsForDateA.status === 200 &&
        Array.isArray(listVisionsForDateA.payload?.visions) &&
        listVisionsForDateA.payload.visions.length === 1,
      'list visions by date endpoint should return day cards',
      listVisionsForDateA,
    )

    const imageForm = new FormData()
    imageForm.append('image', new Blob(['fakepng'], { type: 'image/png' }), 'api-image.png')
    const uploadImage = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}/${entryAId}/images`, {
      method: 'POST',
      token,
      body: imageForm,
    })
    assert(uploadImage.status === 201, 'image upload endpoint should return 201', uploadImage)
    const imageId = uploadImage.payload?.image?.id
    assert(Boolean(imageId), 'image upload should return image id', uploadImage.payload)
    const entryImageUrl = uploadImage.payload?.image?.url
    assert(typeof entryImageUrl === 'string' && entryImageUrl.startsWith('/uploads/'), 'entry image should include uploads url', uploadImage)
    const entryImageFetch = await requestBinary(baseUrl, entryImageUrl)
    assert(entryImageFetch.status === 200 && entryImageFetch.byteLength > 0, 'entry image url should be fetchable', entryImageFetch)

    const listImages = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}/${entryAId}/images`, { token })
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
    const tooLargeUpload = await request(baseUrl, `/api/habits/${habitId}/entries/${dateA}/${entryAId}/images`, {
      method: 'POST',
      token,
      body: tooLargeForm,
    })
    assert(tooLargeUpload.status === 413, 'oversized uploads should be rejected with 413', tooLargeUpload)

    const deleteImageResponse = await request(
      baseUrl,
      `/api/habits/${habitId}/entries/${dateA}/${entryAId}/images/${imageId}`,
      {
        method: 'DELETE',
        token,
      },
    )
    assert(deleteImageResponse.status === 204, 'delete image endpoint should return 204', deleteImageResponse)

    const visionImageForm = new FormData()
    visionImageForm.append('image', new Blob(['fakevision'], { type: 'image/png' }), 'vision-image.png')
    const uploadVisionImageResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}/${visionId}/images`, {
      method: 'POST',
      token,
      body: visionImageForm,
    })
    assert(uploadVisionImageResponse.status === 201, 'vision image upload should return 201', uploadVisionImageResponse)
    const visionImageId = uploadVisionImageResponse.payload?.image?.id
    const visionImageUrl = uploadVisionImageResponse.payload?.image?.url
    assert(
      typeof visionImageUrl === 'string' && visionImageUrl.startsWith('/uploads/'),
      'vision image should include uploads url',
      uploadVisionImageResponse,
    )
    const visionImageFetch = await requestBinary(baseUrl, visionImageUrl)
    assert(
      visionImageFetch.status === 200 && visionImageFetch.byteLength > 0,
      'vision image url should be fetchable',
      visionImageFetch,
    )

    const listVisionImagesResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}/${visionId}/images`, { token })
    assert(
      listVisionImagesResponse.status === 200 &&
        Array.isArray(listVisionImagesResponse.payload?.images) &&
        listVisionImagesResponse.payload.images.length === 1,
      'list vision images endpoint should return one row',
      listVisionImagesResponse,
    )

    const deleteVisionImageResponse = await request(
      baseUrl,
      `/api/habits/${habitId}/visions/${dateA}/${visionId}/images/${visionImageId}`,
      {
        method: 'DELETE',
        token,
      },
    )
    assert(deleteVisionImageResponse.status === 204, 'delete vision image endpoint should return 204', deleteVisionImageResponse)

    const deleteVisionResponse = await request(baseUrl, `/api/habits/${habitId}/visions/${dateA}/${visionId}`, {
      method: 'DELETE',
      token,
    })
    assert(deleteVisionResponse.status === 204, 'delete vision endpoint should return 204', deleteVisionResponse)

    const deleteEntryResponse = await request(baseUrl, `/api/habits/${habitId}/entries/${dateB}/${entryBId}`, {
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
