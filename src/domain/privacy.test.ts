import { describe, expect, it } from 'vitest'
import { HIDDEN, maskNumbers } from '@/domain/privacy'

describe('privacy mode', () => {
  it('hides every amount and number in a sentence', () => {
    expect(maskNumbers('Net worth grew by E£ 13,314.85')).toBe(`Net worth grew by ${HIDDEN}`)
    expect(maskNumbers('E£ 9000 from saving, +E£ 5000 from money lent, -E£ 2000 from rates.')).toBe(`${HIDDEN} from saving, ${HIDDEN} from money lent, ${HIDDEN} from rates.`)
    expect(maskNumbers('Rent is your biggest expense at 73%')).toBe(`Rent is your biggest expense at ${HIDDEN}`)
    expect(maskNumbers('Spending is E£ 1.2M this month')).toBe(`Spending is ${HIDDEN} this month`)
  })
  it('leaves words alone', () => {
    expect(maskNumbers('Most spent at Carrefour')).toBe('Most spent at Carrefour')
  })
})
