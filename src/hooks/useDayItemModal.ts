import { useCallback, useState } from 'react'

type DayItemModalType = 'event' | 'vision'
type DayItemModalMode = 'create' | 'edit'

type DayItemModalState = {
  isOpen: boolean
  type: DayItemModalType
  mode: DayItemModalMode
  date: string | null
  itemId: string | null
}

const initialState: DayItemModalState = {
  isOpen: false,
  type: 'event',
  mode: 'create',
  date: null,
  itemId: null,
}

export const useDayItemModal = () => {
  const [state, setState] = useState<DayItemModalState>(initialState)

  const openCreateEvent = useCallback((date: string) => {
    setState({ isOpen: true, type: 'event', mode: 'create', date, itemId: null })
  }, [])

  const openEditEvent = useCallback((date: string, entryId: string) => {
    setState({ isOpen: true, type: 'event', mode: 'edit', date, itemId: entryId })
  }, [])

  const openCreateVision = useCallback((date: string) => {
    setState({ isOpen: true, type: 'vision', mode: 'create', date, itemId: null })
  }, [])

  const openEditVision = useCallback((date: string, visionId: string) => {
    setState({ isOpen: true, type: 'vision', mode: 'edit', date, itemId: visionId })
  }, [])

  const close = useCallback(() => {
    setState(initialState)
  }, [])

  return {
    ...state,
    openCreateEvent,
    openEditEvent,
    openCreateVision,
    openEditVision,
    close,
  }
}

