import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { eachDayOfInterval, endOfYear, format, isAfter, parseISO, startOfYear, subDays } from 'date-fns'
import 'jheat.js/dist/heat.esm.js'
import 'jheat.js/dist/heat.js.css'
import './App.css'

type Habit = { id: string; userId?: string; name: string; color: string; createdAt: string }
type HabitEntry = {
  id: string
  userId?: string
  habitId: string
  date: string
  completed: boolean
  note: string
  updatedAt: string
  imageCount?: number
}
type Vision = {
  id: string
  userId?: string
  habitId: string
  date: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  imageCount?: number
}
type StoredImage = {
  id: string
  userId?: string
  habitId: string
  date: string
  storageKey: string
  url: string
  originalName: string
  mimeType: string
  fileSize: number
  createdAt: string
}
type AuthUser = { id: string; email: string; createdAt: string }

const CURRENT_YEAR = new Date().getFullYear()
const TOKEN_STORAGE_KEY = 'progress-tracker:token'
const VISION_COLOR = '#8b5cf6'
const HEATMAP_BINDING_ID = 'progress-tracker-heatmap'

type HeatInstance = {
  render: (element: HTMLElement, options: Record<string, unknown>) => HeatInstance
  destroy: (id: string) => HeatInstance
  reset: (id: string, refresh?: boolean) => HeatInstance
  addDate: (id: string, date: Date, trendType?: string | null, refresh?: boolean) => HeatInstance
  refresh: (id: string) => HeatInstance
}

declare global {
  interface Window {
    $heat?: HeatInstance
  }
}

const hasProgress = (entry: HabitEntry | undefined) =>
  Boolean(entry?.completed || entry?.note.trim() || Number(entry?.imageCount ?? 0) > 0)

const heatDateToKey = (value: string) => {
  const [day, month, year] = value.split('-')
  if (!day || !month || !year) return null
  return `${year}-${month}-${day}`
}

const apiCall = async <T,>(path: string, init?: RequestInit & { token?: string | null }): Promise<T> => {
  const headers = new Headers(init?.headers)
  const isFormData = init?.body instanceof FormData
  if (!isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`)

  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as { message?: string }
      throw new Error(parsed.message || `API error: ${response.status}`)
    } catch {
      throw new Error(text || `API error: ${response.status}`)
    }
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const calcStats = (yearDays: Date[], entriesByDate: Map<string, HabitEntry>) => {
  const progressDays = yearDays.map((day) => hasProgress(entriesByDate.get(format(day, 'yyyy-MM-dd'))))
  const completedDays = progressDays.filter(Boolean).length
  let longestStreak = 0
  let running = 0
  for (const done of progressDays) {
    running = done ? running + 1 : 0
    longestStreak = Math.max(longestStreak, running)
  }
  let currentStreak = 0
  let cursor = isAfter(new Date(), yearDays[yearDays.length - 1]) ? yearDays[yearDays.length - 1] : new Date()
  while (format(cursor, 'yyyy') === String(CURRENT_YEAR)) {
    if (!hasProgress(entriesByDate.get(format(cursor, 'yyyy-MM-dd')))) break
    currentStreak += 1
    cursor = subDays(cursor, 1)
  }
  return { completedDays, currentStreak, longestStreak }
}

function App() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [entries, setEntries] = useState<HabitEntry[]>([])
  const [visions, setVisions] = useState<Vision[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null)
  const [habitName, setHabitName] = useState('')
  const [habitColor, setHabitColor] = useState('#2f80ed')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [draftCompleted, setDraftCompleted] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [draftVisionTitle, setDraftVisionTitle] = useState('')
  const [draftVisionDescription, setDraftVisionDescription] = useState('')
  const [visionDate, setVisionDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [visionTitle, setVisionTitle] = useState('')
  const [visionDescription, setVisionDescription] = useState('')
  const [dayImages, setDayImages] = useState<StoredImage[]>([])
  const [visionImages, setVisionImages] = useState<StoredImage[]>([])
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null)
  const [selectedVisionImageFile, setSelectedVisionImageFile] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingVisionImage, setUploadingVisionImage] = useState(false)
  const [loadingHabits, setLoadingHabits] = useState(true)
  const [loadingYearData, setLoadingYearData] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [authActionLoading, setAuthActionLoading] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const heatmapRef = useRef<HTMLDivElement | null>(null)

  const activeHabitId = selectedHabitId ?? habits[0]?.id ?? null
  const selectedHabit = habits.find((habit) => habit.id === activeHabitId) ?? null
  const yearStart = startOfYear(new Date(CURRENT_YEAR, 0, 1))
  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const yearDays = useMemo(
    () => eachDayOfInterval({ start: yearStart, end: endOfYear(yearStart) }),
    [yearStart],
  )
  const entriesByDate = useMemo(() => {
    const map = new Map<string, HabitEntry>()
    for (const entry of entries) map.set(entry.date, entry)
    return map
  }, [entries])
  const visionsByDate = useMemo(() => {
    const map = new Map<string, Vision>()
    for (const vision of visions) map.set(vision.date, vision)
    return map
  }, [visions])
  const stats = useMemo(() => calcStats(yearDays, entriesByDate), [yearDays, entriesByDate])

  const refreshHabitsWithToken = useCallback(async (accessToken: string) => {
    const data = await apiCall<{ habits: Habit[] }>('/api/habits', { token: accessToken })
    setHabits(data.habits)
    setSelectedHabitId((current) => (current && data.habits.some((h) => h.id === current) ? current : data.habits[0]?.id ?? null))
  }, [])

  const refreshYearData = useCallback(
    async (habitId: string, accessToken: string) => {
      const [entriesData, visionsData] = await Promise.all([
        apiCall<{ entries: HabitEntry[] }>(`/api/habits/${habitId}/entries?year=${CURRENT_YEAR}`, { token: accessToken }),
        apiCall<{ visions: Vision[] }>(`/api/habits/${habitId}/visions?year=${CURRENT_YEAR}`, { token: accessToken }),
      ])
      setEntries(entriesData.entries)
      setVisions(visionsData.visions)
    },
    [],
  )

  const fetchDayImages = useCallback(
    async (habitId: string, date: string, accessToken: string) => {
      const [entryImages, visionImagesData] = await Promise.all([
        apiCall<{ images: StoredImage[] }>(`/api/habits/${habitId}/entries/${date}/images`, { token: accessToken }),
        apiCall<{ images: StoredImage[] }>(`/api/habits/${habitId}/visions/${date}/images`, { token: accessToken }),
      ])
      setDayImages(entryImages.images)
      setVisionImages(visionImagesData.images)
    },
    [],
  )

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  }, [token])

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setAuthLoading(false)
        setLoadingHabits(false)
        return
      }
      try {
        const auth = await apiCall<{ user: AuthUser }>('/api/auth/me', { token })
        setAuthUser(auth.user)
        setLoadingHabits(true)
        await refreshHabitsWithToken(token)
        setApiError(null)
      } catch (error) {
        setToken(null)
        setAuthUser(null)
        setApiError(error instanceof Error ? error.message : 'Unable to load habits')
      } finally {
        setAuthLoading(false)
        setLoadingHabits(false)
      }
    }
    void run()
  }, [token, refreshHabitsWithToken])

  useEffect(() => {
    const run = async () => {
      if (!activeHabitId || !token) {
        setEntries([])
        setVisions([])
        return
      }
      try {
        setLoadingYearData(true)
        await refreshYearData(activeHabitId, token)
        setApiError(null)
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'Unable to load year data')
      } finally {
        setLoadingYearData(false)
      }
    }
    void run()
  }, [activeHabitId, token, refreshYearData])

  useEffect(() => {
    const heat = window.$heat
    const container = heatmapRef.current
    if (!heat || !container || !selectedHabit) return

    const onMapDayClick = (date: unknown) => {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return
      void openDayEditor(format(date, 'yyyy-MM-dd'))
    }

    container.id = HEATMAP_BINDING_ID
    heat.destroy(HEATMAP_BINDING_ID)
    heat.render(container, {
      defaultView: 'map',
      startMonth: 0,
      sideMenu: { enabled: false },
      yearlyStatistics: { enabled: false },
      title: {
        showText: false,
        showSectionText: false,
        showYearSelector: true,
        showYearSelectionDropDown: false,
        showRefreshButton: false,
        showExportButton: false,
        showImportButton: false,
        showClearButton: false,
        showConfigurationButton: false,
        showCurrentYearButton: false,
      },
      events: { onMapDayClick },
      views: {
        map: {
          enabled: true,
          showMonthNames: true,
          placeMonthNamesOnTheBottom: false,
          showMonthDayGaps: true,
          showDayNames: true,
          showMinimalDayNames: true,
          showToolTips: true,
          highlightCurrentDay: false,
        },
        line: { enabled: false },
        chart: { enabled: false },
        days: { enabled: false },
        months: { enabled: false },
        colorRanges: { enabled: false },
      },
    })

    heat.reset(HEATMAP_BINDING_ID, false)
    for (const day of yearDays) {
      const key = format(day, 'yyyy-MM-dd')
      const entry = entriesByDate.get(key)
      const vision = visionsByDate.get(key)
      if (hasProgress(entry) || vision) {
        heat.addDate(HEATMAP_BINDING_ID, day, null, false)
      }
    }
    heat.refresh(HEATMAP_BINDING_ID)

    const heatDayCells = container.querySelectorAll<HTMLDivElement>('div.day[data-heat-js-map-date]')
    for (const cell of heatDayCells) {
      const heatDate = cell.getAttribute('data-heat-js-map-date')
      if (!heatDate) continue
      const key = heatDateToKey(heatDate)
      if (!key) continue

      const entry = entriesByDate.get(key)
      const vision = visionsByDate.get(key)
      const done = hasProgress(entry)
      const hasEntryDetail = Boolean(entry?.note.trim() || Number(entry?.imageCount ?? 0) > 0)
      const hasVisionDetail = Boolean(vision?.imageCount || vision?.description?.trim())
      const isToday = key === todayKey
      const isPastWithoutProgress = key < todayKey && !done && !vision

      cell.classList.toggle('pt-state-done', done && !vision)
      cell.classList.toggle('pt-state-vision', !done && Boolean(vision))
      cell.classList.toggle('pt-state-both', done && Boolean(vision))
      cell.classList.toggle('pt-note', hasEntryDetail || hasVisionDetail)
      cell.classList.toggle('pt-elapsed-empty', isPastWithoutProgress)
      cell.classList.toggle('pt-today', isToday)
      cell.setAttribute('title', `${format(parseISO(key), 'MMM d')}${done ? ' - progress' : ''}${vision ? ' - vision' : ''}`)
    }

    container.style.setProperty('--habit-color', selectedHabit.color)
    container.style.setProperty('--vision-color', VISION_COLOR)
    container.classList.add('tracker-heatmap')

    return () => {
      heat.destroy(HEATMAP_BINDING_ID)
    }
  }, [selectedHabit, yearDays, entriesByDate, visionsByDate, todayKey])

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !password) return
    const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
    try {
      setAuthActionLoading(true)
      const data = await apiCall<{ user: AuthUser; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email: trimmedEmail, password }),
      })
      setToken(data.token)
      setAuthUser(data.user)
      await refreshHabitsWithToken(data.token)
      setPassword('')
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Authentication failed')
    } finally {
      setAuthActionLoading(false)
    }
  }

  const logout = async () => {
    try {
      if (token) await apiCall('/api/auth/logout', { method: 'POST', token })
    } catch {
      // no-op
    } finally {
      setToken(null)
      setAuthUser(null)
      setHabits([])
      setEntries([])
      setVisions([])
      setSelectedHabitId(null)
      setSelectedDate(null)
      setApiError(null)
    }
  }

  const createHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    const name = habitName.trim()
    if (!name) return
    try {
      const data = await apiCall<{ habit: Habit }>('/api/habits', {
        method: 'POST',
        token,
        body: JSON.stringify({ name, color: habitColor }),
      })
      setHabits((current) => [data.habit, ...current])
      setSelectedHabitId(data.habit.id)
      setHabitName('')
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to create habit')
    }
  }

  const removeHabit = async (habitId: string) => {
    if (!token) return
    try {
      await apiCall(`/api/habits/${habitId}`, { method: 'DELETE', token })
      await refreshHabitsWithToken(token)
      setEntries([])
      setVisions([])
      setSelectedDate(null)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete habit')
    }
  }

  const openDayEditor = async (date: string) => {
    setSelectedDate(date)
    const dayEntry = entriesByDate.get(date)
    const dayVision = visionsByDate.get(date)
    setDraftCompleted(dayEntry?.completed ?? false)
    setDraftNote(dayEntry?.note ?? '')
    setDraftVisionTitle(dayVision?.title ?? '')
    setDraftVisionDescription(dayVision?.description ?? '')
    setSelectedImageFile(null)
    setSelectedVisionImageFile(null)
    if (!activeHabitId || !token) {
      setDayImages([])
      setVisionImages([])
      return
    }
    try {
      await fetchDayImages(activeHabitId, date, token)
      setApiError(null)
    } catch (error) {
      setDayImages([])
      setVisionImages([])
      setApiError(error instanceof Error ? error.message : 'Unable to load day images')
    }
  }

  const saveDayEntry = async () => {
    if (!activeHabitId || !selectedDate || !token) return
    try {
      await apiCall<{ entry: HabitEntry | null }>(`/api/habits/${activeHabitId}/entries/${selectedDate}`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ completed: draftCompleted, note: draftNote.trim() }),
      })
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to save day entry')
    }
  }

  const saveDayVision = async () => {
    if (!activeHabitId || !selectedDate || !token) return
    const title = draftVisionTitle.trim()
    if (!title) {
      setApiError('Vision title is required')
      return
    }
    try {
      await apiCall<{ vision: Vision }>(`/api/habits/${activeHabitId}/visions/${selectedDate}`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ title, description: draftVisionDescription.trim() }),
      })
      await refreshYearData(activeHabitId, token)
      await fetchDayImages(activeHabitId, selectedDate, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to save vision')
    }
  }

  const deleteDayVision = async () => {
    if (!activeHabitId || !selectedDate || !token) return
    try {
      await apiCall(`/api/habits/${activeHabitId}/visions/${selectedDate}`, { method: 'DELETE', token })
      setDraftVisionTitle('')
      setDraftVisionDescription('')
      setVisionImages([])
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete vision')
    }
  }

  const createVisionFromForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeHabitId || !token) return
    const title = visionTitle.trim()
    if (!title || !visionDate) return
    try {
      await apiCall<{ vision: Vision }>(`/api/habits/${activeHabitId}/visions/${visionDate}`, {
        method: 'PUT',
        token,
        body: JSON.stringify({ title, description: visionDescription.trim() }),
      })
      setVisionTitle('')
      setVisionDescription('')
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to create vision')
    }
  }

  const uploadEntryImage = async () => {
    if (!token || !activeHabitId || !selectedDate || !selectedImageFile) return
    try {
      setUploadingImage(true)
      const formData = new FormData()
      formData.append('image', selectedImageFile)
      await apiCall<{ image: StoredImage }>(`/api/habits/${activeHabitId}/entries/${selectedDate}/images`, {
        method: 'POST',
        token,
        body: formData,
      })
      setSelectedImageFile(null)
      await fetchDayImages(activeHabitId, selectedDate, token)
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to upload day image')
    } finally {
      setUploadingImage(false)
    }
  }

  const deleteEntryImageById = async (imageId: string) => {
    if (!token || !activeHabitId || !selectedDate) return
    try {
      await apiCall(`/api/habits/${activeHabitId}/entries/${selectedDate}/images/${imageId}`, {
        method: 'DELETE',
        token,
      })
      await fetchDayImages(activeHabitId, selectedDate, token)
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete day image')
    }
  }

  const uploadVisionImage = async () => {
    if (!token || !activeHabitId || !selectedDate || !selectedVisionImageFile) return
    if (!draftVisionTitle.trim() && !visionsByDate.get(selectedDate)) {
      setApiError('Create/save the vision first before uploading images')
      return
    }
    try {
      setUploadingVisionImage(true)
      const formData = new FormData()
      formData.append('image', selectedVisionImageFile)
      await apiCall<{ image: StoredImage }>(`/api/habits/${activeHabitId}/visions/${selectedDate}/images`, {
        method: 'POST',
        token,
        body: formData,
      })
      setSelectedVisionImageFile(null)
      await fetchDayImages(activeHabitId, selectedDate, token)
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to upload vision image')
    } finally {
      setUploadingVisionImage(false)
    }
  }

  const deleteVisionImageById = async (imageId: string) => {
    if (!token || !activeHabitId || !selectedDate) return
    try {
      await apiCall(`/api/habits/${activeHabitId}/visions/${selectedDate}/images/${imageId}`, {
        method: 'DELETE',
        token,
      })
      await fetchDayImages(activeHabitId, selectedDate, token)
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete vision image')
    }
  }

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) =>
    setSelectedImageFile(event.target.files?.[0] ?? null)
  const handleVisionImageSelection = (event: ChangeEvent<HTMLInputElement>) =>
    setSelectedVisionImageFile(event.target.files?.[0] ?? null)

  return (
    <main className="app-shell">
      <header>
        <h1>Progress Tracker</h1>
        <p>Track consistency by habit, one day at a time.</p>
        {authUser ? (
          <div className="auth-bar">
            <span>{authUser.email}</span>
            <button type="button" className="ghost" onClick={logout}>
              Logout
            </button>
          </div>
        ) : null}
        {apiError ? <p className="error">{apiError}</p> : null}
      </header>

      {!authUser ? (
        <section className="panel auth-panel">
          <h2>{authMode === 'signup' ? 'Create account' : 'Login'}</h2>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" required />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
            <button type="submit" disabled={authActionLoading || authLoading}>
              {authActionLoading ? 'Please wait...' : authMode === 'signup' ? 'Sign up' : 'Login'}
            </button>
          </form>
          <p className="muted">
            {authMode === 'signup' ? 'Already have an account?' : 'Need an account?'}{' '}
            <button type="button" className="inline-link" onClick={() => setAuthMode((m) => (m === 'signup' ? 'login' : 'signup'))}>
              {authMode === 'signup' ? 'Login here' : 'Sign up here'}
            </button>
          </p>
        </section>
      ) : null}

      {authUser ? (
        <>
          <section className="panel">
            <h2>Create habit</h2>
            <form className="habit-form" onSubmit={createHabit}>
              <input value={habitName} onChange={(event) => setHabitName(event.target.value)} placeholder="Habit name (Running, Quran, Content...)" aria-label="Habit name" />
              <label className="color-input">
                Color
                <input type="color" value={habitColor} onChange={(event) => setHabitColor(event.target.value)} aria-label="Habit color" />
              </label>
              <button type="submit">Add habit</button>
            </form>
          </section>

          {selectedHabit ? (
            <section className="panel">
              <h2>Create vision milestone</h2>
              <form className="habit-form" onSubmit={createVisionFromForm}>
                <input type="date" value={visionDate} onChange={(event) => setVisionDate(event.target.value)} />
                <input value={visionTitle} onChange={(event) => setVisionTitle(event.target.value)} placeholder="Vision title" />
                <input value={visionDescription} onChange={(event) => setVisionDescription(event.target.value)} placeholder="Description (optional)" />
                <button type="submit">Save vision</button>
              </form>
            </section>
          ) : null}

          <section className="layout">
            <aside className="panel habits-panel">
              <h2>Your habits</h2>
              {loadingHabits ? <p className="muted">Loading habits...</p> : null}
              {!loadingHabits && habits.length === 0 ? <p className="muted">Create your first habit to start tracking.</p> : null}
              {!loadingHabits && habits.length > 0 ? (
                <ul className="habit-list">
                  {habits.map((habit) => (
                    <li key={habit.id}>
                      <button className={habit.id === activeHabitId ? 'habit-item active' : 'habit-item'} onClick={() => setSelectedHabitId(habit.id)} type="button">
                        <span className="habit-color" style={{ backgroundColor: habit.color }} />
                        {habit.name}
                      </button>
                      <button className="danger" onClick={() => removeHabit(habit.id)} type="button" aria-label={`Delete ${habit.name}`}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </aside>

            <section className="panel tracker-panel">
              {!selectedHabit ? <p className="muted">Select a habit to view its year heatmap.</p> : null}
              {selectedHabit && loadingYearData ? <p className="muted">Loading year data...</p> : null}
              {selectedHabit && !loadingYearData ? (
                <>
                  <div className="tracker-header">
                    <div>
                      <h2>{selectedHabit.name}</h2>
                      <p>{CURRENT_YEAR} view</p>
                    </div>
                    <div className="stats">
                      <span>{stats.completedDays} days done</span>
                      <span>{stats.currentStreak} day streak</span>
                      <span>{stats.longestStreak} best streak</span>
                    </div>
                  </div>
                  <div ref={heatmapRef} className="heatmap-host" />
                </>
              ) : null}
            </section>
          </section>

          {selectedDate && selectedHabit ? (
            <section className="panel day-editor">
              <h3>{format(parseISO(selectedDate), 'EEEE, MMMM d, yyyy')}</h3>
              <label className="check-row">
                <input type="checkbox" checked={draftCompleted} onChange={(event) => setDraftCompleted(event.target.checked)} />
                Mark progress for this day
              </label>
              <label className="notes">
                Notes
                <textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} placeholder="What did you do today?" />
              </label>

              <div className="images-section">
                <h4>Entry images (max 8MB each)</h4>
                <div className="image-upload-row">
                  <input type="file" accept="image/*" onChange={handleImageSelection} />
                  <button type="button" onClick={uploadEntryImage} disabled={!selectedImageFile || uploadingImage}>
                    {uploadingImage ? 'Uploading...' : 'Upload entry image'}
                  </button>
                </div>
                {dayImages.length === 0 ? <p className="muted">No entry images added yet.</p> : null}
                {dayImages.length > 0 ? (
                  <div className="image-grid">
                    {dayImages.map((image) => (
                      <figure key={image.id} className="image-card">
                        <img src={image.url} alt={image.originalName} />
                        <figcaption>{image.originalName}</figcaption>
                        <button type="button" className="ghost" onClick={() => deleteEntryImageById(image.id)}>Remove</button>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="vision-section">
                <h4>Vision milestone (distinct purple on calendar)</h4>
                <input value={draftVisionTitle} onChange={(event) => setDraftVisionTitle(event.target.value)} placeholder="Vision title" />
                <textarea value={draftVisionDescription} onChange={(event) => setDraftVisionDescription(event.target.value)} placeholder="What does this milestone look like?" />
                <div className="actions">
                  <button type="button" className="vision-btn" onClick={saveDayVision}>Save vision</button>
                  <button type="button" className="ghost" onClick={deleteDayVision}>Delete vision</button>
                </div>
                <div className="image-upload-row">
                  <input type="file" accept="image/*" onChange={handleVisionImageSelection} />
                  <button type="button" className="vision-btn" onClick={uploadVisionImage} disabled={!selectedVisionImageFile || uploadingVisionImage}>
                    {uploadingVisionImage ? 'Uploading...' : 'Upload vision image'}
                  </button>
                </div>
                {visionImages.length === 0 ? <p className="muted">No vision images added yet.</p> : null}
                {visionImages.length > 0 ? (
                  <div className="image-grid">
                    {visionImages.map((image) => (
                      <figure key={image.id} className="image-card">
                        <img src={image.url} alt={image.originalName} />
                        <figcaption>{image.originalName}</figcaption>
                        <button type="button" className="ghost" onClick={() => deleteVisionImageById(image.id)}>Remove</button>
                      </figure>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="actions">
                <button type="button" onClick={saveDayEntry}>Save day entry</button>
                <button type="button" className="ghost" onClick={() => setSelectedDate(null)}>Close</button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  )
}

export default App
