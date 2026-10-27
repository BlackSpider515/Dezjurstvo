import type { GradeType } from './types'

export const TEST_STUDENT_COUNT = 30
export const TEST_ASSIGNMENT_COUNT = 50

export const TEST_STUDENTS = [
  'Александров Артём Сергеевич',
  'Андреева Мария Дмитриевна',
  'Белов Максим Игоревич',
  'Богданова Софья Алексеевна',
  'Васильев Кирилл Павлович',
  'Волкова Анна Михайловна',
  'Григорьев Дмитрий Андреевич',
  'Гусева Полина Викторовна',
  'Данилов Егор Олегович',
  'Дмитриева Елизавета Сергеевна',
  'Егоров Никита Владимирович',
  'Ершова Варвара Денисовна',
  'Жуков Арсений Романович',
  'Зайцева Алиса Павловна',
  'Иванов Матвей Алексеевич',
  'Козлова Виктория Ильинична',
  'Комаров Лев Дмитриевич',
  'Кузнецова Ксения Максимовна',
  'Лебедев Тимофей Николаевич',
  'Макарова Дарья Артёмовна',
  'Морозов Роман Евгеньевич',
  'Новикова Валерия Александровна',
  'Орлов Пётр Сергеевич',
  'Павлова Милана Андреевна',
  'Романов Савелий Денисович',
  'Смирнова Арина Владимировна',
  'Соколов Глеб Ильич',
  'Фёдорова Ева Максимовна',
  'Цветков Марк Алексеевич',
  'Щербакова Анастасия Романовна',
] as const

export interface TestAssignmentInput {
  title: string
  description: string
  grade_type: GradeType
  assigned_date: string
  lesson_number: number
  due_at: string
}

function localIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildTestAssignments(): TestAssignmentInput[] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 45)

  const gradeTypes: GradeType[] = ['stars', 'pass_fail', 'points']

  return Array.from({ length: TEST_ASSIGNMENT_COUNT }, (_, index) => {
    const assigned = new Date(start)
    assigned.setDate(start.getDate() + index * 2)
    const due = new Date(assigned)
    due.setDate(assigned.getDate() + 7)
    due.setHours(23, 59, 0, 0)
    const number = String(index + 1).padStart(2, '0')

    return {
      title: `Практическая работа ${number}`,
      description: `Демонстрационное задание №${index + 1} для проверки журнала, дедлайнов и оценивания.`,
      grade_type: gradeTypes[index % gradeTypes.length],
      assigned_date: localIsoDate(assigned),
      lesson_number: (index % 4) + 1,
      due_at: due.toISOString(),
    }
  })
}
