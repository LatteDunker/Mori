import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { addDays, differenceInCalendarDays, eachDayOfInterval, endOfYear, format, isAfter, parseISO, startOfYear, subDays } from 'date-fns'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Cropper, { type Area } from 'react-easy-crop'
import { useCreateHabitModal } from './hooks/useCreateHabitModal'
import { useDayItemModal } from './hooks/useDayItemModal'
import './App.css'

type Habit = { id: string; userId?: string; name: string; color: string; sortOrder?: number; createdAt: string }
type HabitEntry = {
  id: string
  userId?: string
  habitId: string
  date: string
  completed: boolean
  note: string
  customColor?: string | null
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
  customColor?: string | null
  createdAt: string
  updatedAt: string
  imageCount?: number
}
type AuthUser = { id: string; email: string; profileImageUrl?: string | null; createdAt: string }
type StoredImage = {
  id: string
  userId?: string
  habitId: string
  entryId?: string
  visionId?: string
  date: string
  storageKey: string
  url: string
  originalName: string
  mimeType: string
  fileSize: number
  createdAt: string
}

type WritingModeField = 'eventNote' | 'visionDescription' | null

const CURRENT_YEAR = new Date().getFullYear()
const TOKEN_STORAGE_KEY = 'progress-tracker:token'
const THEME_STORAGE_KEY = 'progress-tracker:theme'
const VISION_COLOR = '#8b5cf6'

const hasProgress = (entry: HabitEntry | undefined) =>
  Boolean(entry?.completed || entry?.note.trim() || Number(entry?.imageCount ?? 0) > 0)

const hasProgressForDay = (entries: HabitEntry[] | undefined) => (entries ?? []).some((entry) => hasProgress(entry))

const loadImageFromUrl = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })

const getCroppedImageBlob = async (source: string, cropAreaPixels: Area) => {
  const image = await loadImageFromUrl(source)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported in this browser')

  const width = Math.max(1, Math.round(cropAreaPixels.width))
  const height = Math.max(1, Math.round(cropAreaPixels.height))
  canvas.width = width
  canvas.height = height

  ctx.drawImage(
    image,
    Math.round(cropAreaPixels.x),
    Math.round(cropAreaPixels.y),
    width,
    height,
    0,
    0,
    width,
    height,
  )

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to crop image'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', 0.92)
  })
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

const calcStats = (yearDays: Date[], entriesByDate: Map<string, HabitEntry[]>) => {
  const progressDays = yearDays.map((day) => hasProgressForDay(entriesByDate.get(format(day, 'yyyy-MM-dd'))))
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
    if (!hasProgressForDay(entriesByDate.get(format(cursor, 'yyyy-MM-dd')))) break
    currentStreak += 1
    cursor = subDays(cursor, 1)
  }
  return { completedDays, currentStreak, longestStreak }
}

type SortableHabitItemProps = {
  habit: Habit
  isActive: boolean
  onSelect: (habitId: string) => void
}

const SortableHabitItem = ({ habit, isActive, onSelect }: SortableHabitItemProps) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: habit.id,
  })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'habit-row dragging' : 'habit-row'}>
      <div className={isActive ? 'habit-item active' : 'habit-item'}>
        <button
          type="button"
          className="drag-handle-inline"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${habit.name}`}
        >
          <span className="drag-handle-icon" />
        </button>
        <button className="habit-select" onClick={() => onSelect(habit.id)} type="button">
          <span className="habit-color" style={{ backgroundColor: habit.color }} />
          <span className="habit-name">{habit.name}</span>
        </button>
      </div>
    </li>
  )
}

function App() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [entries, setEntries] = useState<HabitEntry[]>([])
  const [visions, setVisions] = useState<Vision[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null)
  const createHabitModal = useCreateHabitModal()
  const [creatingHabit, setCreatingHabit] = useState(false)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [editingHabitName, setEditingHabitName] = useState('')
  const [editingHabitColor, setEditingHabitColor] = useState('#2f80ed')
  const [updatingHabit, setUpdatingHabit] = useState(false)
  const [deletingHabit, setDeletingHabit] = useState(false)
  const [archivingHabit, setArchivingHabit] = useState(false)
  const [activeView, setActiveView] = useState<'main' | 'archived'>('main')
  const [archivedHabits, setArchivedHabits] = useState<Habit[]>([])
  const [loadingArchived, setLoadingArchived] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const dayItemModal = useDayItemModal()
  const [draftCompleted, setDraftCompleted] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [draftEntryColor, setDraftEntryColor] = useState('')
  const [draftVisionTitle, setDraftVisionTitle] = useState('')
  const [draftVisionDescription, setDraftVisionDescription] = useState('')
  const [draftVisionColor, setDraftVisionColor] = useState('')
  const [writingModeField, setWritingModeField] = useState<WritingModeField>(null)
  const [entryImagesByEntryId, setEntryImagesByEntryId] = useState<Map<string, StoredImage[]>>(new Map())
  const [visionImagesByVisionId, setVisionImagesByVisionId] = useState<Map<string, StoredImage[]>>(new Map())
  const [queuedModalFiles, setQueuedModalFiles] = useState<File[]>([])
  const [uploadingModalImages, setUploadingModalImages] = useState(false)
  const [deletingModalImageId, setDeletingModalImageId] = useState<string | null>(null)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [profileCropSource, setProfileCropSource] = useState<string | null>(null)
  const [profileCrop, setProfileCrop] = useState({ x: 0, y: 0 })
  const [profileZoom, setProfileZoom] = useState(1)
  const [profileCropPixels, setProfileCropPixels] = useState<Area | null>(null)
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false)
  const [removingProfileImage, setRemovingProfileImage] = useState(false)
  const [loadingHabits, setLoadingHabits] = useState(true)
  const [loadingYearData, setLoadingYearData] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [authActionLoading, setAuthActionLoading] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const eventWritingRef = useRef<HTMLTextAreaElement | null>(null)
  const visionWritingRef = useRef<HTMLTextAreaElement | null>(null)

  const activeHabitId = selectedHabitId ?? habits[0]?.id ?? null
  const selectedHabit = habits.find((habit) => habit.id === activeHabitId) ?? null
  const editingHabit = habits.find((habit) => habit.id === editingHabitId) ?? null
  const isWritingModeOpen = writingModeField !== null
  const yearStart = startOfYear(new Date(CURRENT_YEAR, 0, 1))
  const todayKey = format(new Date(), 'yyyy-MM-dd')
  const yearDays = useMemo(
    () => eachDayOfInterval({ start: yearStart, end: endOfYear(yearStart) }),
    [yearStart],
  )
  const yearStartOffset = (yearStart.getDay() + 6) % 7
  const heatmapColumns = Math.ceil((yearStartOffset + yearDays.length) / 7)
  const monthMarkers = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) => {
        const monthStart = new Date(CURRENT_YEAR, month, 1)
        const dayIndex = differenceInCalendarDays(monthStart, yearStart)
        const columnStart = Math.floor((yearStartOffset + dayIndex) / 7) + 1
        return { label: format(monthStart, 'MMM'), columnStart, columnIndex: columnStart - 1 }
      }),
    [yearStart, yearStartOffset],
  )
  const entriesByDate = useMemo(() => {
    const map = new Map<string, HabitEntry[]>()
    for (const entry of entries) {
      const list = map.get(entry.date) ?? []
      list.push(entry)
      map.set(entry.date, list)
    }
    return map
  }, [entries])
  const visionsByDate = useMemo(() => {
    const map = new Map<string, Vision[]>()
    for (const vision of visions) {
      const list = map.get(vision.date) ?? []
      list.push(vision)
      map.set(vision.date, list)
    }
    return map
  }, [visions])
  const stats = useMemo(() => calcStats(yearDays, entriesByDate), [yearDays, entriesByDate])
  const yearStartDate = yearDays[0]
  const yearEndDate = yearDays[yearDays.length - 1]
  const timelineCenterDate = useMemo(() => {
    if (selectedDate) return parseISO(selectedDate)
    const today = new Date()
    return today < yearStartDate ? yearStartDate : today > yearEndDate ? yearEndDate : today
  }, [selectedDate, yearStartDate, yearEndDate])
  const timelineCenterKey = format(timelineCenterDate, 'yyyy-MM-dd')
  const timelineWindow = useMemo(() => {
    const middleIndex = 3
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(timelineCenterDate, index - middleIndex)
      if (date < yearStartDate || date > yearEndDate) return null
      return date
    })
  }, [timelineCenterDate, yearStartDate, yearEndDate])
  const timelineEventCount = useMemo(
    () =>
      yearDays.filter((day) => {
        const key = format(day, 'yyyy-MM-dd')
        return hasProgressForDay(entriesByDate.get(key)) || Boolean((visionsByDate.get(key) ?? []).length)
      }).length,
    [yearDays, entriesByDate, visionsByDate],
  )
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const refreshHabitsWithToken = useCallback(async (accessToken: string) => {
    const data = await apiCall<{ habits: Habit[] }>('/api/habits', { token: accessToken })
    setHabits(data.habits)
    setSelectedHabitId((current) => (current && data.habits.some((h) => h.id === current) ? current : data.habits[0]?.id ?? null))
  }, [])

  const refreshArchivedHabits = useCallback(async (accessToken: string) => {
    const data = await apiCall<{ habits: Habit[] }>('/api/habits/archive', { token: accessToken })
    setArchivedHabits(data.habits)
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

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  }, [token])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!dayItemModal.isOpen) setWritingModeField(null)
  }, [dayItemModal.isOpen])

  useEffect(() => {
    setWritingModeField(null)
  }, [dayItemModal.type, dayItemModal.mode, dayItemModal.itemId, dayItemModal.date])

  useEffect(() => {
    if (writingModeField === 'eventNote') eventWritingRef.current?.focus()
    if (writingModeField === 'visionDescription') visionWritingRef.current?.focus()
  }, [writingModeField])

  useEffect(
    () => () => {
      if (profileCropSource) URL.revokeObjectURL(profileCropSource)
    },
    [profileCropSource],
  )

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
    const run = async () => {
      if (activeView !== 'archived' || !token) return
      try {
        setLoadingArchived(true)
        await refreshArchivedHabits(token)
        setApiError(null)
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'Unable to load archived habits')
      } finally {
        setLoadingArchived(false)
      }
    }
    void run()
  }, [activeView, token, refreshArchivedHabits])

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
      setProfileModalOpen(false)
      setProfileCropSource(null)
      setApiError(null)
    }
  }

  const openProfileModal = useCallback(() => {
    setProfileModalOpen(true)
  }, [])

  const closeProfileModal = useCallback(() => {
    setProfileModalOpen(false)
    setProfileCropSource(null)
    setProfileCropPixels(null)
    setProfileZoom(1)
  }, [])

  const handleProfileFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    setProfileCropSource(objectUrl)
    setProfileCrop({ x: 0, y: 0 })
    setProfileZoom(1)
    setProfileCropPixels(null)
    event.target.value = ''
  }

  const uploadProfileImage = async () => {
    if (!token || !profileCropSource || !profileCropPixels) return
    try {
      setUploadingProfileImage(true)
      const croppedBlob = await getCroppedImageBlob(profileCropSource, profileCropPixels)
      const formData = new FormData()
      formData.append('image', new File([croppedBlob], 'profile-image.jpg', { type: croppedBlob.type || 'image/jpeg' }))
      const data = await apiCall<{ user: AuthUser }>('/api/auth/profile-image', {
        method: 'POST',
        token,
        body: formData,
      })
      setAuthUser(data.user)
      setProfileCropSource(null)
      setProfileCropPixels(null)
      setProfileZoom(1)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to upload profile image')
    } finally {
      setUploadingProfileImage(false)
    }
  }

  const removeProfileImage = async () => {
    if (!token) return
    try {
      setRemovingProfileImage(true)
      const data = await apiCall<{ user: AuthUser }>('/api/auth/profile-image', {
        method: 'DELETE',
        token,
      })
      setAuthUser(data.user)
      setProfileCropSource(null)
      setProfileCropPixels(null)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to remove profile image')
    } finally {
      setRemovingProfileImage(false)
    }
  }

  const createHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) return
    const name = createHabitModal.habitName.trim()
    if (!name) return
    try {
      setCreatingHabit(true)
      const data = await apiCall<{ habit: Habit }>('/api/habits', {
        method: 'POST',
        token,
        body: JSON.stringify({ name, color: createHabitModal.habitColor }),
      })
      setHabits((current) => [...current, data.habit])
      setSelectedHabitId(data.habit.id)
      createHabitModal.closeCreateHabitModal()
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to create habit')
    } finally {
      setCreatingHabit(false)
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
      return true
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete habit')
      return false
    }
  }

  const openEditHabitModal = useCallback((habit: Habit) => {
    setEditingHabitId(habit.id)
    setEditingHabitName(habit.name)
    setEditingHabitColor(habit.color)
  }, [])

  const closeEditHabitModal = useCallback(() => {
    setEditingHabitId(null)
    setEditingHabitName('')
    setEditingHabitColor('#2f80ed')
    setUpdatingHabit(false)
  }, [])

  const saveHabitUpdates = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token || !editingHabitId) return
    const name = editingHabitName.trim()
    if (!name) return

    try {
      setUpdatingHabit(true)
      await apiCall<{ habit: Habit }>(`/api/habits/${editingHabitId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ name, color: editingHabitColor }),
      })
      await refreshHabitsWithToken(token)
      setApiError(null)
      closeEditHabitModal()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to update habit')
      setUpdatingHabit(false)
    }
  }

  const deleteEditingHabit = async () => {
    if (!editingHabitId || !token) return
    try {
      setDeletingHabit(true)
      const removed = await removeHabit(editingHabitId)
      if (removed) closeEditHabitModal()
    } finally {
      setDeletingHabit(false)
    }
  }

  const archiveEditingHabit = async () => {
    if (!editingHabitId || !token) return
    try {
      setArchivingHabit(true)
      await apiCall<{ habit: Habit }>(`/api/habits/${editingHabitId}/archive`, { method: 'POST', token })
      await refreshHabitsWithToken(token)
      await refreshArchivedHabits(token)
      setEntries([])
      setVisions([])
      setSelectedDate(null)
      setApiError(null)
      closeEditHabitModal()
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to archive habit')
    } finally {
      setArchivingHabit(false)
    }
  }

  const restoreArchivedHabit = async (habitId: string) => {
    if (!token) return
    try {
      await apiCall<{ habit: Habit }>(`/api/habits/${habitId}/restore`, { method: 'POST', token })
      await refreshHabitsWithToken(token)
      await refreshArchivedHabits(token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to restore habit')
    }
  }

  const reorderHabits = useCallback(
    async (sourceHabitId: string, targetHabitId: string) => {
      if (!token || sourceHabitId === targetHabitId) return
      const previousHabits = habits
      const oldIndex = previousHabits.findIndex((habit) => habit.id === sourceHabitId)
      const newIndex = previousHabits.findIndex((habit) => habit.id === targetHabitId)
      if (oldIndex < 0 || newIndex < 0) return

      const nextHabits = arrayMove(previousHabits, oldIndex, newIndex)
      setHabits(nextHabits)
      try {
        const response = await apiCall<{ habits: Habit[] }>('/api/habits/reorder', {
          method: 'PATCH',
          token,
          body: JSON.stringify({ habitIds: nextHabits.map((habit) => habit.id) }),
        })
        setHabits(response.habits)
        setApiError(null)
      } catch (error) {
        setHabits(previousHabits)
        setApiError(error instanceof Error ? error.message : 'Unable to reorder habits')
      }
    },
    [habits, token],
  )

  const handleHabitDragEnd = useCallback(
    (event: DragEndEvent) => {
      const sourceHabitId = String(event.active.id)
      const targetHabitId = event.over ? String(event.over.id) : null
      if (!targetHabitId || sourceHabitId === targetHabitId) return
      void reorderHabits(sourceHabitId, targetHabitId)
    },
    [reorderHabits],
  )

  const openDayEditor = async (date: string) => {
    setSelectedDate(date)
    setApiError(null)
  }

  const openCreateEventModal = (date: string) => {
    setDraftCompleted(false)
    setDraftNote('')
    setDraftEntryColor('')
    setWritingModeField(null)
    setQueuedModalFiles([])
    dayItemModal.openCreateEvent(date)
  }

  const openEditEventModal = (entry: HabitEntry) => {
    setDraftCompleted(entry.completed)
    setDraftNote(entry.note ?? '')
    setDraftEntryColor(entry.customColor ?? '')
    setWritingModeField(null)
    setQueuedModalFiles([])
    dayItemModal.openEditEvent(entry.date, entry.id)
    void fetchEntryImagesForItem(entry.date, entry.id)
  }

  const openCreateVisionModal = (date: string) => {
    setDraftVisionTitle('')
    setDraftVisionDescription('')
    setDraftVisionColor('')
    setWritingModeField(null)
    setQueuedModalFiles([])
    dayItemModal.openCreateVision(date)
  }

  const openEditVisionModal = (vision: Vision) => {
    setDraftVisionTitle(vision.title ?? '')
    setDraftVisionDescription(vision.description ?? '')
    setDraftVisionColor(vision.customColor ?? '')
    setWritingModeField(null)
    setQueuedModalFiles([])
    dayItemModal.openEditVision(vision.date, vision.id)
    void fetchVisionImagesForItem(vision.date, vision.id)
  }

  const closeDayItemModal = useCallback(() => {
    setWritingModeField(null)
    setQueuedModalFiles([])
    dayItemModal.close()
  }, [dayItemModal])

  const closeWritingMode = useCallback(() => {
    setWritingModeField(null)
  }, [])

  const handleWritingModeKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closeWritingMode()
  }, [closeWritingMode])

  const fetchEntryImagesForItem = useCallback(
    async (date: string, entryId: string) => {
      if (!activeHabitId || !token) return
      try {
        const data = await apiCall<{ images: StoredImage[] }>(`/api/habits/${activeHabitId}/entries/${date}/${entryId}/images`, { token })
        setEntryImagesByEntryId((previous) => {
          const next = new Map(previous)
          next.set(entryId, data.images)
          return next
        })
      } catch {
        // Keep UI resilient if an item is deleted while fetching.
      }
    },
    [activeHabitId, token],
  )

  const fetchVisionImagesForItem = useCallback(
    async (date: string, visionId: string) => {
      if (!activeHabitId || !token) return
      try {
        const data = await apiCall<{ images: StoredImage[] }>(`/api/habits/${activeHabitId}/visions/${date}/${visionId}/images`, { token })
        setVisionImagesByVisionId((previous) => {
          const next = new Map(previous)
          next.set(visionId, data.images)
          return next
        })
      } catch {
        // Keep UI resilient if an item is deleted while fetching.
      }
    },
    [activeHabitId, token],
  )

  const uploadItemImages = useCallback(
    async (params: { type: 'event' | 'vision'; date: string; itemId: string; files: File[] }) => {
      if (!activeHabitId || !token || params.files.length === 0) return
      for (const file of params.files) {
        const formData = new FormData()
        formData.append('image', file)
        if (params.type === 'event') {
          await apiCall(`/api/habits/${activeHabitId}/entries/${params.date}/${params.itemId}/images`, {
            method: 'POST',
            token,
            body: formData,
          })
        } else {
          await apiCall(`/api/habits/${activeHabitId}/visions/${params.date}/${params.itemId}/images`, {
            method: 'POST',
            token,
            body: formData,
          })
        }
      }
      if (params.type === 'event') {
        await fetchEntryImagesForItem(params.date, params.itemId)
      } else {
        await fetchVisionImagesForItem(params.date, params.itemId)
      }
      await refreshYearData(activeHabitId, token)
    },
    [activeHabitId, token, fetchEntryImagesForItem, fetchVisionImagesForItem, refreshYearData],
  )

  const handleModalImageSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0 || !dayItemModal.date) return

    if (dayItemModal.mode === 'create') {
      setQueuedModalFiles((previous) => [...previous, ...files])
      return
    }
    if (!dayItemModal.itemId) return

    try {
      setUploadingModalImages(true)
      await uploadItemImages({
        type: dayItemModal.type,
        date: dayItemModal.date,
        itemId: dayItemModal.itemId,
        files,
      })
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to upload images')
    } finally {
      setUploadingModalImages(false)
    }
  }

  const removeQueuedModalFile = (index: number) => {
    setQueuedModalFiles((previous) => previous.filter((_, itemIndex) => itemIndex !== index))
  }

  const deleteModalImage = async (imageId: string) => {
    if (!activeHabitId || !token || !dayItemModal.date || !dayItemModal.itemId || dayItemModal.mode !== 'edit') return
    try {
      setDeletingModalImageId(imageId)
      if (dayItemModal.type === 'event') {
        await apiCall(`/api/habits/${activeHabitId}/entries/${dayItemModal.date}/${dayItemModal.itemId}/images/${imageId}`, { method: 'DELETE', token })
        await fetchEntryImagesForItem(dayItemModal.date, dayItemModal.itemId)
      } else {
        await apiCall(`/api/habits/${activeHabitId}/visions/${dayItemModal.date}/${dayItemModal.itemId}/images/${imageId}`, { method: 'DELETE', token })
        await fetchVisionImagesForItem(dayItemModal.date, dayItemModal.itemId)
      }
      await refreshYearData(activeHabitId, token)
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete image')
    } finally {
      setDeletingModalImageId(null)
    }
  }

  const saveDayEntry = async () => {
    if (!activeHabitId || !dayItemModal.date || !token) return
    try {
      const method = dayItemModal.mode === 'edit' ? 'PATCH' : 'POST'
      const path =
        dayItemModal.mode === 'edit' && dayItemModal.itemId
          ? `/api/habits/${activeHabitId}/entries/${dayItemModal.date}/${dayItemModal.itemId}`
          : `/api/habits/${activeHabitId}/entries/${dayItemModal.date}`
      const response = await apiCall<{ entry: HabitEntry | null }>(path, {
        method,
        token,
        body: JSON.stringify({ completed: draftCompleted, note: draftNote.trim(), customColor: draftEntryColor.trim() || null }),
      })
      const targetEntryId = dayItemModal.mode === 'edit' ? dayItemModal.itemId : response.entry?.id
      if (targetEntryId && queuedModalFiles.length > 0) {
        setUploadingModalImages(true)
        await uploadItemImages({
          type: 'event',
          date: dayItemModal.date,
          itemId: targetEntryId,
          files: queuedModalFiles,
        })
      }
      await refreshYearData(activeHabitId, token)
      closeDayItemModal()
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to save day entry')
    } finally {
      setUploadingModalImages(false)
    }
  }

  const saveDayVision = async () => {
    if (!activeHabitId || !dayItemModal.date || !token) return
    const title = draftVisionTitle.trim()
    if (!title) {
      setApiError('Vision title is required')
      return
    }
    try {
      const method = dayItemModal.mode === 'edit' ? 'PATCH' : 'POST'
      const path =
        dayItemModal.mode === 'edit' && dayItemModal.itemId
          ? `/api/habits/${activeHabitId}/visions/${dayItemModal.date}/${dayItemModal.itemId}`
          : `/api/habits/${activeHabitId}/visions/${dayItemModal.date}`
      const response = await apiCall<{ vision: Vision }>(path, {
        method,
        token,
        body: JSON.stringify({ title, description: draftVisionDescription.trim(), customColor: draftVisionColor.trim() || null }),
      })
      const targetVisionId = dayItemModal.mode === 'edit' ? dayItemModal.itemId : response.vision?.id
      if (targetVisionId && queuedModalFiles.length > 0) {
        setUploadingModalImages(true)
        await uploadItemImages({
          type: 'vision',
          date: dayItemModal.date,
          itemId: targetVisionId,
          files: queuedModalFiles,
        })
      }
      await refreshYearData(activeHabitId, token)
      closeDayItemModal()
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to save vision')
    } finally {
      setUploadingModalImages(false)
    }
  }

  const deleteDayVision = async () => {
    if (!activeHabitId || !dayItemModal.date || !dayItemModal.itemId || !token) return
    try {
      await apiCall(`/api/habits/${activeHabitId}/visions/${dayItemModal.date}/${dayItemModal.itemId}`, { method: 'DELETE', token })
      await refreshYearData(activeHabitId, token)
      closeDayItemModal()
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete vision')
    }
  }

  const deleteDayEntry = async () => {
    if (!activeHabitId || !dayItemModal.date || !dayItemModal.itemId || !token) return
    try {
      await apiCall(`/api/habits/${activeHabitId}/entries/${dayItemModal.date}/${dayItemModal.itemId}`, { method: 'DELETE', token })
      await refreshYearData(activeHabitId, token)
      closeDayItemModal()
      setApiError(null)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to delete day entry')
    }
  }
  const canMoveTimelineBackward = timelineCenterDate > yearStartDate
  const canMoveTimelineForward = timelineCenterDate < yearEndDate
  const selectedDayEntries = useMemo(
    () => (selectedDate ? entries.filter((entry) => entry.date === selectedDate) : []),
    [selectedDate, entries],
  )
  const selectedDayVisions = useMemo(
    () => (selectedDate ? visions.filter((vision) => vision.date === selectedDate) : []),
    [selectedDate, visions],
  )
  const modalImages =
    dayItemModal.mode === 'edit' && dayItemModal.itemId
      ? dayItemModal.type === 'event'
        ? (entryImagesByEntryId.get(dayItemModal.itemId) ?? [])
        : (visionImagesByVisionId.get(dayItemModal.itemId) ?? [])
      : []

  useEffect(() => {
    if (!selectedDate || !activeHabitId || !token) return
    void Promise.all([
      ...selectedDayEntries.map((entry) => fetchEntryImagesForItem(entry.date, entry.id)),
      ...selectedDayVisions.map((vision) => fetchVisionImagesForItem(vision.date, vision.id)),
    ])
  }, [selectedDate, activeHabitId, token, selectedDayEntries, selectedDayVisions, fetchEntryImagesForItem, fetchVisionImagesForItem])
  const moveTimelineByDay = (direction: -1 | 1) => {
    const nextDate = addDays(timelineCenterDate, direction)
    if (nextDate < yearStartDate || nextDate > yearEndDate) return
    void openDayEditor(format(nextDate, 'yyyy-MM-dd'))
  }

  return (
    <main className="app-shell">
      {!authUser ? (
        <>
          <header>
            {apiError ? <p className="error">{apiError}</p> : null}
          </header>
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
        </>
      ) : (
        <div className="app-layout">
          <aside className="panel app-sidebar">
            <div className="sidebar-logo">Mori</div>
            <nav className="sidebar-nav" aria-label="Main navigation">
              <button
                type="button"
                className={`sidebar-nav-link ${activeView === 'main' ? 'active' : ''}`}
                onClick={() => setActiveView('main')}
              >
                Habits
              </button>
              <button
                type="button"
                className={`sidebar-nav-link ${activeView === 'archived' ? 'active' : ''}`}
                onClick={() => setActiveView('archived')}
              >
                Archived
              </button>
            </nav>
            {activeView === 'main' ? (
              <section className="sidebar-section habits-panel">
                <h2>Your habits</h2>
                {loadingHabits ? <p className="muted">Loading habits...</p> : null}
                {!loadingHabits ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleHabitDragEnd}>
                    <SortableContext items={habits.map((habit) => habit.id)} strategy={verticalListSortingStrategy}>
                      <ul className="habit-list">
                        {habits.map((habit) => (
                          <SortableHabitItem
                            key={habit.id}
                            habit={habit}
                            isActive={habit.id === activeHabitId}
                            onSelect={setSelectedHabitId}
                          />
                        ))}
                        <li className="habit-row">
                          <button
                            type="button"
                            className="habit-item habit-add-item"
                            onClick={createHabitModal.openCreateHabitModal}
                            aria-label="Create a new habit"
                          >
                            <span className="habit-add-plus" aria-hidden="true">+</span>
                            <span className="habit-name">Add habit</span>
                          </button>
                        </li>
                      </ul>
                    </SortableContext>
                  </DndContext>
                ) : null}
                {!loadingHabits && habits.length === 0 ? (
                  <p className="muted">Click Add habit to create your first habit.</p>
                ) : null}
              </section>
            ) : null}
          </aside>

          <section className="app-main">
            <header className="main-topbar">
              <div className="main-topbar-left">
                {apiError ? (
                  <p className="error">{apiError}</p>
                ) : activeView === 'archived' ? (
                  <p className="muted">Archived habits</p>
                ) : selectedHabit ? (
                  <p className="muted">{selectedHabit.name} · {CURRENT_YEAR}</p>
                ) : (
                  <p className="muted">Select a habit to begin tracking</p>
                )}
              </div>
              <div className="top-nav-right">
                <button type="button" className="ghost theme-toggle" onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}>
                  {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                </button>
                <div className="auth-bar">
                  <button type="button" className="avatar-button" onClick={openProfileModal} aria-label="Edit profile picture">
                    {authUser.profileImageUrl ? (
                      <img src={authUser.profileImageUrl} alt={`${authUser.email} profile`} />
                    ) : (
                      <span className="avatar-fallback">{authUser.email.slice(0, 1).toUpperCase()}</span>
                    )}
                  </button>
                  <button type="button" className="ghost" onClick={logout}>
                    Logout
                  </button>
                </div>
              </div>
            </header>

            <div className="main-content">
              {activeView === 'archived' ? (
                <section className="panel archived-panel">
                  <h2>Archived habits</h2>
                  <p className="muted">Habits you archived are listed below. Restore them to bring them back to your active habits.</p>
                  {loadingArchived ? <p className="muted">Loading archived habits...</p> : null}
                  {!loadingArchived && archivedHabits.length === 0 ? (
                    <p className="muted">No archived habits yet.</p>
                  ) : null}
                  {!loadingArchived && archivedHabits.length > 0 ? (
                    <ul className="archived-habit-list">
                      {archivedHabits.map((habit) => (
                        <li key={habit.id} className="archived-habit-row">
                          <span className="habit-color" style={{ backgroundColor: habit.color }} />
                          <span className="habit-name">{habit.name}</span>
                          <button
                            type="button"
                            className="archive-btn"
                            onClick={() => restoreArchivedHabit(habit.id)}
                          >
                            Restore
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : (
                <>
              <section className="panel tracker-panel">
                {!selectedHabit ? <p className="muted">Select a habit to view its year heatmap.</p> : null}
                {selectedHabit && loadingYearData ? <p className="muted">Loading year data...</p> : null}
                {selectedHabit && !loadingYearData ? (
                  <>
                    <div className="tracker-header">
                      <div>
                        <div className="habit-title-row">
                          <h2>{selectedHabit.name}</h2>
                          <button type="button" className="ghost icon-btn" onClick={() => openEditHabitModal(selectedHabit)} aria-label={`Edit ${selectedHabit.name}`}>
                            <span aria-hidden="true">✎</span>
                          </button>
                        </div>
                        <p>{CURRENT_YEAR} view</p>
                      </div>
                      <div className="stats">
                        <span>{stats.completedDays} days done</span>
                        <span>{stats.currentStreak} day streak</span>
                        <span>{stats.longestStreak} best streak</span>
                      </div>
                    </div>
                    <div className="weekday-labels">
                      <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
                    </div>
                    <div className="heatmap-area">
                      <div className="month-labels" style={{ '--heatmap-columns': heatmapColumns } as CSSProperties}>
                        {monthMarkers.map((marker) => (
                          <span key={marker.label} style={{ gridColumnStart: marker.columnStart }}>
                            {marker.label}
                          </span>
                        ))}
                      </div>
                      <div className="heatmap-grid">
                        {Array.from({ length: yearStartOffset }).map((_, index) => <div key={`empty-${index}`} className="heatmap-cell placeholder" />)}
                        {yearDays.map((day) => {
                          const key = format(day, 'yyyy-MM-dd')
                          const entry = entriesByDate.get(key)
                          const vision = visionsByDate.get(key)
                          const done = hasProgressForDay(entry)
                          const isToday = key === todayKey
                          const isPastWithoutProgress = key < todayKey && !done && !(vision && vision.length > 0)
                          const hasEntryDetail = (entry ?? []).some((row) => Boolean(row.note.trim() || Number(row.imageCount ?? 0) > 0))
                          const hasVisionDetail = (vision ?? []).some((row) => Boolean(row.imageCount || row.description?.trim()))
                          const firstEntryColor = entry?.[0]?.customColor?.trim() || selectedHabit.color
                          const firstVisionColor = vision?.[0]?.customColor?.trim() || VISION_COLOR
                          let style: CSSProperties | undefined
                          if (done && vision && vision.length > 0) {
                            style = { background: `linear-gradient(135deg, ${firstEntryColor} 0 50%, ${firstVisionColor} 50% 100%)` }
                          } else if (done) {
                            style = { backgroundColor: firstEntryColor }
                          } else if (vision && vision.length > 0) {
                            style = { backgroundColor: firstVisionColor }
                          }
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`heatmap-cell ${done ? 'done' : ''} ${vision && vision.length > 0 ? 'vision' : ''} ${hasEntryDetail || hasVisionDetail ? 'note' : ''} ${isPastWithoutProgress ? 'elapsed-empty' : ''} ${isToday ? 'today' : ''}`}
                              style={style}
                              onClick={() => openDayEditor(key)}
                              title={`${format(day, 'MMM d')}${done ? ' - progress' : ''}${vision && vision.length > 0 ? ' - vision' : ''}`}
                            />
                          )
                        })}
                      </div>
                    </div>
                    <div className="timeline-panel">
                      <div className="timeline-panel-header">
                        <h3>Event timeline</h3>
                        <p className="muted">{timelineEventCount} tracked day{timelineEventCount === 1 ? '' : 's'}</p>
                      </div>
                      <div className="timeline-controls">
                        <button
                          type="button"
                          className="ghost icon-btn"
                          onClick={() => moveTimelineByDay(-1)}
                          disabled={!canMoveTimelineBackward}
                          aria-label="Move timeline backward one day"
                        >
                          <span aria-hidden="true">←</span>
                        </button>
                        <div className="timeline-track" role="list" aria-label="Habit event timeline">
                          {timelineWindow.map((day, index) => {
                            if (!day) {
                              return <div key={`timeline-empty-${index}`} className="timeline-node placeholder" aria-hidden="true" />
                            }
                            const key = format(day, 'yyyy-MM-dd')
                            const entry = entriesByDate.get(key)
                            const vision = visionsByDate.get(key)
                            const done = hasProgressForDay(entry)
                            const hasVision = Boolean(vision && vision.length > 0)
                            const isCurrent = key === timelineCenterKey
                            return (
                              <button
                                key={key}
                                type="button"
                                role="listitem"
                                className={`timeline-node ${isCurrent ? 'current' : ''} ${done ? 'done' : ''} ${hasVision ? 'vision' : ''}`}
                                onClick={() => openDayEditor(key)}
                                title={`${format(day, 'EEEE, MMM d')}${done ? ' - progress' : ''}${hasVision ? ' - vision' : ''}`}
                              >
                                <span className="timeline-day">{format(day, 'EEE')}</span>
                                <span className="timeline-date">{format(day, 'MMM d')}</span>
                                <span className="timeline-dot" />
                              </button>
                            )
                          })}
                        </div>
                        <button
                          type="button"
                          className="ghost icon-btn"
                          onClick={() => moveTimelineByDay(1)}
                          disabled={!canMoveTimelineForward}
                          aria-label="Move timeline forward one day"
                        >
                          <span aria-hidden="true">→</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </section>

              {selectedDate && selectedHabit ? (
                <section className="panel day-editor">
                  <h3>{format(parseISO(selectedDate), 'EEEE, MMMM d, yyyy')}</h3>
                  <div className="actions">
                    <button type="button" onClick={() => openCreateEventModal(selectedDate)}>Add event</button>
                    <button type="button" className="vision-btn" onClick={() => openCreateVisionModal(selectedDate)}>Add vision</button>
                  </div>

                  <div className="vision-section">
                    <h4>Events</h4>
                    {selectedDayEntries.length === 0 ? <p className="muted">No events for this day.</p> : null}
                    {selectedDayEntries.map((entry) => (
                      <div key={entry.id} className="day-item-card">
                        <div className="day-item-row">
                          <span className="habit-color" style={{ backgroundColor: entry.customColor || selectedHabit.color }} />
                          <span className="habit-name">{entry.note?.trim() || (entry.completed ? 'Completed' : 'Event')}</span>
                          <button type="button" className="ghost" onClick={() => openEditEventModal(entry)}>Edit</button>
                        </div>
                        {(entryImagesByEntryId.get(entry.id) ?? []).length > 0 ? (
                          <div className="inline-image-grid">
                            {(entryImagesByEntryId.get(entry.id) ?? []).map((image) => (
                              <img key={image.id} src={image.url} alt={image.originalName} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="vision-section">
                    <h4>Visions</h4>
                    {selectedDayVisions.length === 0 ? <p className="muted">No visions for this day.</p> : null}
                    {selectedDayVisions.map((vision) => (
                      <div key={vision.id} className="day-item-card">
                        <div className="day-item-row">
                          <span className="habit-color" style={{ backgroundColor: vision.customColor || VISION_COLOR }} />
                          <span className="habit-name">{vision.title}</span>
                          <button type="button" className="ghost" onClick={() => openEditVisionModal(vision)}>Edit</button>
                        </div>
                        {(visionImagesByVisionId.get(vision.id) ?? []).length > 0 ? (
                          <div className="inline-image-grid">
                            {(visionImagesByVisionId.get(vision.id) ?? []).map((image) => (
                              <img key={image.id} src={image.url} alt={image.originalName} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="actions">
                    <button type="button" className="ghost" onClick={() => setSelectedDate(null)}>Close</button>
                  </div>
                </section>
              ) : (
                <section className="panel day-editor day-editor-empty">
                  <p className="muted">Pick a date from the heatmap to open the form.</p>
                </section>
              )}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {dayItemModal.isOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className={`panel modal-panel ${isWritingModeOpen ? 'writing-mode-modal' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={dayItemModal.type === 'event' ? 'Edit event' : 'Edit vision'}
          >
            <div className="modal-header">
              <h3>{dayItemModal.mode === 'create' ? `Create ${dayItemModal.type}` : `Edit ${dayItemModal.type}`}</h3>
              <button type="button" className="ghost icon-btn" onClick={closeDayItemModal} aria-label="Close day item modal">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {isWritingModeOpen ? (
              <div className="writing-mode-body">
                <div className="writing-mode-header">
                  <h4>{writingModeField === 'eventNote' ? 'Edit event notes' : 'Edit vision details'}</h4>
                  <button
                    type="button"
                    className="ghost writing-mode-toggle"
                    onClick={closeWritingMode}
                    aria-label="Collapse writing area"
                  >
                    <span aria-hidden="true">⤡</span>
                  </button>
                </div>
                {writingModeField === 'eventNote' ? (
                  <textarea
                    ref={eventWritingRef}
                    className="writing-mode-textarea"
                    value={draftNote}
                    onChange={(event) => setDraftNote(event.target.value)}
                    onKeyDown={handleWritingModeKeyDown}
                    placeholder="What did you do today?"
                  />
                ) : (
                  <textarea
                    ref={visionWritingRef}
                    className="writing-mode-textarea"
                    value={draftVisionDescription}
                    onChange={(event) => setDraftVisionDescription(event.target.value)}
                    onKeyDown={handleWritingModeKeyDown}
                    placeholder="What does this milestone look like?"
                  />
                )}
                <div className="actions">
                  <button type="button" className="ghost" onClick={closeWritingMode}>Done</button>
                </div>
              </div>
            ) : dayItemModal.type === 'event' ? (
              <div className="modal-form">
                <label className="check-row">
                  <input type="checkbox" checked={draftCompleted} onChange={(event) => setDraftCompleted(event.target.checked)} />
                  Mark progress for this event
                </label>
                <label className="notes">
                  <span className="notes-label-row">
                    <span>Notes</span>
                    <button
                      type="button"
                      className="ghost writing-mode-toggle"
                      onClick={() => setWritingModeField('eventNote')}
                      aria-label="Expand writing area"
                    >
                      <span aria-hidden="true">⤢</span>
                    </button>
                  </span>
                  <textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} placeholder="What did you do today?" />
                </label>
                <label className="notes">
                  Event color
                  <input type="color" value={draftEntryColor || '#2f80ed'} onChange={(event) => setDraftEntryColor(event.target.value)} />
                </label>
                <div className="images-section">
                  <h4>Images</h4>
                  <div className="image-upload-row">
                    <label className="ghost file-label">
                      {uploadingModalImages ? 'Uploading...' : 'Upload image'}
                      <input type="file" accept="image/*" onChange={handleModalImageSelection} disabled={uploadingModalImages} />
                    </label>
                  </div>
                  {queuedModalFiles.length > 0 ? (
                    <div className="image-upload-row">
                      {queuedModalFiles.map((file, index) => (
                        <button key={`${file.name}-${index}`} type="button" className="ghost" onClick={() => removeQueuedModalFile(index)}>
                          Remove queued: {file.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {modalImages.length > 0 ? (
                    <div className="image-grid">
                      {modalImages.map((image) => (
                        <figure key={image.id} className="image-card">
                          <img src={image.url} alt={image.originalName} />
                          <figcaption>{image.originalName}</figcaption>
                          {dayItemModal.mode === 'edit' ? (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => deleteModalImage(image.id)}
                              disabled={deletingModalImageId === image.id}
                            >
                              {deletingModalImageId === image.id ? 'Removing...' : 'Remove'}
                            </button>
                          ) : null}
                        </figure>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="actions">
                  <button type="button" onClick={saveDayEntry} disabled={uploadingModalImages}>{dayItemModal.mode === 'create' ? 'Create event' : 'Save event'}</button>
                  {dayItemModal.mode === 'edit' ? (
                    <button type="button" className="danger" onClick={deleteDayEntry}>Delete event</button>
                  ) : null}
                  <button type="button" className="ghost" onClick={closeDayItemModal}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="modal-form">
                <label className="notes">
                  Vision title
                  <input value={draftVisionTitle} onChange={(event) => setDraftVisionTitle(event.target.value)} placeholder="Vision title" />
                </label>
                <label className="notes">
                  <span className="notes-label-row">
                    <span>Vision details</span>
                    <button
                      type="button"
                      className="ghost writing-mode-toggle"
                      onClick={() => setWritingModeField('visionDescription')}
                      aria-label="Expand writing area"
                    >
                      <span aria-hidden="true">⤢</span>
                    </button>
                  </span>
                  <textarea value={draftVisionDescription} onChange={(event) => setDraftVisionDescription(event.target.value)} placeholder="What does this milestone look like?" />
                </label>
                <label className="notes">
                  Vision color
                  <input type="color" value={draftVisionColor || '#8b5cf6'} onChange={(event) => setDraftVisionColor(event.target.value)} />
                </label>
                <div className="images-section">
                  <h4>Images</h4>
                  <div className="image-upload-row">
                    <label className="ghost file-label">
                      {uploadingModalImages ? 'Uploading...' : 'Upload image'}
                      <input type="file" accept="image/*" onChange={handleModalImageSelection} disabled={uploadingModalImages} />
                    </label>
                  </div>
                  {queuedModalFiles.length > 0 ? (
                    <div className="image-upload-row">
                      {queuedModalFiles.map((file, index) => (
                        <button key={`${file.name}-${index}`} type="button" className="ghost" onClick={() => removeQueuedModalFile(index)}>
                          Remove queued: {file.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {modalImages.length > 0 ? (
                    <div className="image-grid">
                      {modalImages.map((image) => (
                        <figure key={image.id} className="image-card">
                          <img src={image.url} alt={image.originalName} />
                          <figcaption>{image.originalName}</figcaption>
                          {dayItemModal.mode === 'edit' ? (
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => deleteModalImage(image.id)}
                              disabled={deletingModalImageId === image.id}
                            >
                              {deletingModalImageId === image.id ? 'Removing...' : 'Remove'}
                            </button>
                          ) : null}
                        </figure>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="actions">
                  <button type="button" className="vision-btn" onClick={saveDayVision} disabled={uploadingModalImages}>{dayItemModal.mode === 'create' ? 'Create vision' : 'Save vision'}</button>
                  {dayItemModal.mode === 'edit' ? (
                    <button type="button" className="danger" onClick={deleteDayVision}>Delete vision</button>
                  ) : null}
                  <button type="button" className="ghost" onClick={closeDayItemModal}>Cancel</button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {editingHabit ? (
        <div className="modal-backdrop" role="presentation">
          <section className="panel modal-panel" role="dialog" aria-modal="true" aria-label={`Edit ${editingHabit.name}`}>
            <div className="modal-header">
              <h3>Edit habit</h3>
              <button type="button" className="ghost icon-btn" onClick={closeEditHabitModal} aria-label="Close edit habit modal">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <form className="modal-form" onSubmit={saveHabitUpdates}>
              <label className="notes">
                Habit name
                <input value={editingHabitName} onChange={(event) => setEditingHabitName(event.target.value)} placeholder="Habit name" required />
              </label>
              <label className="color-input">
                Color
                <input type="color" value={editingHabitColor} onChange={(event) => setEditingHabitColor(event.target.value)} aria-label="Habit color" />
              </label>
              <div className="actions">
                <button type="submit" disabled={updatingHabit}>{updatingHabit ? 'Saving...' : 'Save changes'}</button>
                <button type="button" className="archive-btn" onClick={archiveEditingHabit} disabled={archivingHabit || updatingHabit}>
                  {archivingHabit ? 'Archiving...' : 'Archive habit'}
                </button>
                <button type="button" className="danger" onClick={deleteEditingHabit} disabled={deletingHabit || updatingHabit}>
                  {deletingHabit ? 'Deleting...' : 'Delete habit'}
                </button>
                <button type="button" className="ghost" onClick={closeEditHabitModal}>Cancel</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {createHabitModal.isCreateHabitModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="panel modal-panel" role="dialog" aria-modal="true" aria-label="Create habit">
            <div className="modal-header">
              <h3>Create habit</h3>
              <button type="button" className="ghost icon-btn" onClick={createHabitModal.closeCreateHabitModal} aria-label="Close create habit modal">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <form className="modal-form" onSubmit={createHabit}>
              <label className="notes">
                Habit name
                <input
                  value={createHabitModal.habitName}
                  onChange={(event) => createHabitModal.setHabitName(event.target.value)}
                  placeholder="Habit name"
                  required
                />
              </label>
              <label className="color-input">
                Color
                <input
                  type="color"
                  value={createHabitModal.habitColor}
                  onChange={(event) => createHabitModal.setHabitColor(event.target.value)}
                  aria-label="Habit color"
                />
              </label>
              <div className="actions">
                <button type="submit" disabled={creatingHabit}>{creatingHabit ? 'Creating...' : 'Create habit'}</button>
                <button type="button" className="ghost" onClick={createHabitModal.closeCreateHabitModal}>Cancel</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {profileModalOpen && authUser ? (
        <div className="modal-backdrop" role="presentation">
          <section className="panel modal-panel" role="dialog" aria-modal="true" aria-label="Profile picture settings">
            <div className="modal-header">
              <h3>Profile picture</h3>
              <button type="button" className="ghost icon-btn" onClick={closeProfileModal} aria-label="Close profile picture modal">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="profile-modal-body">
              <div className="profile-avatar-preview">
                {authUser.profileImageUrl ? (
                  <img src={authUser.profileImageUrl} alt={`${authUser.email} profile`} />
                ) : (
                  <span className="avatar-fallback large">{authUser.email.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="actions">
                <label className="ghost file-label">
                  Upload new image
                  <input type="file" accept="image/*" onChange={handleProfileFileSelection} />
                </label>
                <button type="button" className="ghost" onClick={removeProfileImage} disabled={!authUser.profileImageUrl || removingProfileImage}>
                  {removingProfileImage ? 'Removing...' : 'Remove image'}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {profileCropSource ? (
        <div className="crop-popup-backdrop" role="presentation">
          <section className="panel crop-popup" role="dialog" aria-modal="true" aria-label="Crop profile picture">
            <div className="modal-header">
              <h3>Crop image</h3>
              <button type="button" className="ghost icon-btn" onClick={() => setProfileCropSource(null)} aria-label="Close crop popup">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="cropper-frame">
              <Cropper
                image={profileCropSource}
                crop={profileCrop}
                zoom={profileZoom}
                aspect={1}
                onCropChange={setProfileCrop}
                onZoomChange={setProfileZoom}
                onCropComplete={(_area, areaPixels) => setProfileCropPixels(areaPixels)}
                cropShape="rect"
                showGrid
              />
            </div>
            <label className="zoom-row">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={profileZoom}
                onChange={(event) => setProfileZoom(Number(event.target.value))}
              />
            </label>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setProfileCropSource(null)}>Cancel</button>
              <button type="button" onClick={uploadProfileImage} disabled={!profileCropPixels || uploadingProfileImage}>
                {uploadingProfileImage ? 'Uploading...' : 'Use cropped image'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
