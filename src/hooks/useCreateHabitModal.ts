import { useCallback, useState } from 'react'

const DEFAULT_HABIT_COLOR = '#2f80ed'

export const useCreateHabitModal = () => {
  const [isCreateHabitModalOpen, setIsCreateHabitModalOpen] = useState(false)
  const [habitName, setHabitName] = useState('')
  const [habitColor, setHabitColor] = useState(DEFAULT_HABIT_COLOR)

  const openCreateHabitModal = useCallback(() => {
    setIsCreateHabitModalOpen(true)
  }, [])

  const closeCreateHabitModal = useCallback(() => {
    setIsCreateHabitModalOpen(false)
    setHabitName('')
    setHabitColor(DEFAULT_HABIT_COLOR)
  }, [])

  return {
    isCreateHabitModalOpen,
    habitName,
    habitColor,
    setHabitName,
    setHabitColor,
    openCreateHabitModal,
    closeCreateHabitModal,
  }
}
