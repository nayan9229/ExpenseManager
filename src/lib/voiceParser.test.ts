import { describe, expect, test } from 'vitest'
import type { Category } from './api'
import { parseTranscript } from './voiceParser'

function category(name: string): Category {
  return { name, emoji: '📦', colorHex: '#6E7250', monthlyBudgetLimit: 0, visibleToRoles: ['all'] }
}

/** The seven Categories a fresh Household is seeded with (pkg/bootstrap/seeds.go). */
const seeded = [
  'Groceries & Vegetables',
  'Medical & Pharmacy',
  'Utilities & Bills',
  'School & Kids',
  'Household & Help',
  'Dining & Outings',
  'Other',
].map(category)

describe('parseTranscript', () => {
  test('the ticket example fills amount, Category, note and Payment Method', () => {
    expect(parseTranscript('Paid 450 rupees for medicines by UPI', seeded)).toEqual({
      amount: 450,
      category: 'Medical & Pharmacy',
      paymentMethod: 'UPI',
      note: 'medicines',
    })
  })
})

describe('amount', () => {
  test.each([
    ['₹450 medicines', 450],
    ['1,450 for groceries', 1450],
    ['₹1,450 groceries', 1450],
    ['1,25,000 school fees', 125000],
    ['450 rupees', 450],
    ['450 rs', 450],
    ['450rs', 450],
    ['Rs. 450', 450],
    ['Rs 450.50 milk', 450.5],
    ['INR 300', 300],
    ['४५० रुपये दवाई', 450],
    ['2 kg sabzi for 80 rupees', 80],
    ['2 kg sabzi ₹80', 80],
  ])('%s -> %d', (transcript, amount) => {
    expect(parseTranscript(transcript, seeded).amount).toBe(amount)
  })

  test.each([['medicines by UPI'], ['0 rupees'], ['99999999999 rupees'], ['']])('%j has no amount', (transcript) => {
    expect(parseTranscript(transcript, seeded).amount).toBeUndefined()
  })

  test('numbers that are not the amount stay in the note', () => {
    expect(parseTranscript('2 kg sabzi for 80 rupees', seeded).note).toBe('2 kg sabzi')
  })

  test('a comma that ends a sentence is not part of the amount', () => {
    expect(parseTranscript('450, medicines', seeded)).toMatchObject({ amount: 450, note: 'medicines' })
  })
})

describe('Category', () => {
  test.each([
    // English
    ['300 for vegetables', 'Groceries & Vegetables'],
    ['groceries 1200', 'Groceries & Vegetables'],
    ['milk 60 rupees', 'Groceries & Vegetables'],
    ['medicine for Papa', 'Medical & Pharmacy'],
    ['doctor fees 500', 'Medical & Pharmacy'],
    ['chemist 230', 'Medical & Pharmacy'],
    ['electricity bill 2,340', 'Utilities & Bills'],
    ['mobile recharge 299', 'Utilities & Bills'],
    ['school fees 15000', 'School & Kids'],
    ['tuition 2000', 'School & Kids'],
    ['maid salary 3000', 'Household & Help'],
    ['dinner at the restaurant 1800', 'Dining & Outings'],
    ['movie tickets 600', 'Dining & Outings'],
    // Transliterated Hindi
    ['sabzi 80', 'Groceries & Vegetables'],
    ['sabji wale ko 120', 'Groceries & Vegetables'],
    ['doodh 60', 'Groceries & Vegetables'],
    ['dawai ke liye 200', 'Medical & Pharmacy'],
    ['dawa 150', 'Medical & Pharmacy'],
    ['bijli ka bill 1500', 'Utilities & Bills'],
    ['kitab 350', 'School & Kids'],
    ['kaamwali bai 2500', 'Household & Help'],
    ['bahar khana 900', 'Dining & Outings'],
    // Devanagari, which is what hi-IN recognition writes
    ['सब्ज़ी 80 रुपये', 'Groceries & Vegetables'],
    ['दूध 60', 'Groceries & Vegetables'],
    ['दवाई 200', 'Medical & Pharmacy'],
    ['बिजली का बिल 1500', 'Utilities & Bills'],
    ['स्कूल की फीस 5000', 'School & Kids'],
    ['खाना 900', 'Dining & Outings'],
    // The Category's own name works too, in any case
    ['MEDICAL 450', 'Medical & Pharmacy'],
    ['other 100', 'Other'],
  ])('%s -> %s', (transcript, name) => {
    expect(parseTranscript(transcript, seeded).category).toBe(name)
  })

  test('an unknown Category leaves the Category empty and keeps the words as the note', () => {
    expect(parseTranscript('petrol 500 by cash', seeded)).toEqual({ amount: 500, paymentMethod: 'Cash', note: 'petrol' })
  })

  test('the first Category mentioned wins', () => {
    expect(parseTranscript('medicines and milk 300', seeded).category).toBe('Medical & Pharmacy')
  })

  test('a Household Category outside the seeds matches by its own name', () => {
    expect(parseTranscript('petrol 500', [...seeded, category('Petrol & Travel')]).category).toBe('Petrol & Travel')
  })

  test('a Category the Member cannot see is never suggested', () => {
    const forKids = seeded.filter((c) => c.name !== 'Medical & Pharmacy')
    expect(parseTranscript('Paid 450 rupees for medicines by UPI', forKids)).toEqual({
      amount: 450,
      paymentMethod: 'UPI',
      note: 'medicines',
    })
  })

  test('a renamed seed Category is matched in the spelling the Ledger uses', () => {
    expect(parseTranscript('dawai 200', [category('  medical &  PHARMACY ')]).category).toBe('  medical &  PHARMACY ')
  })
})

describe('Payment Method', () => {
  test.each([
    ['450 by UPI', 'UPI'],
    ['450 on GPay', 'UPI'],
    ['450 through Google Pay', 'UPI'],
    ['450 PhonePe', 'UPI'],
    ['450 phone pe se', 'UPI'],
    ['450 paytm', 'UPI'],
    ['450 BHIM', 'UPI'],
    ['450 cash', 'Cash'],
    ['450 nakad', 'Cash'],
    ['450 naqad diye', 'Cash'],
    ['450 नकद', 'Cash'],
    ['450 कैश में', 'Cash'],
    ['450 by card', 'Card'],
    ['450 credit card', 'Card'],
    ['450 debit card se', 'Card'],
    ['450 कार्ड से', 'Card'],
    ['450 bank transfer', 'Bank Transfer'],
    ['450 NEFT', 'Bank Transfer'],
    ['450 net banking', 'Bank Transfer'],
    ['450 यूपीआई से', 'UPI'],
  ])('%s -> %s', (transcript, method) => {
    expect(parseTranscript(transcript, seeded)).toEqual({ amount: 450, paymentMethod: method })
  })

  test('no Payment Method said leaves it to the Member default', () => {
    expect(parseTranscript('450 medicines', seeded).paymentMethod).toBeUndefined()
  })

  test('"phone" without "pe" is not a Payment Method', () => {
    expect(parseTranscript('phone repair 450', seeded)).toEqual({ amount: 450, category: 'Household & Help', note: 'phone repair' })
  })
})

describe('whole phrases', () => {
  test.each<[string, string, ReturnType<typeof parseTranscript>]>([
    ['English with a note', 'Spent ₹1,450 on groceries at Big Bazaar using GPay', {
      amount: 1450, category: 'Groceries & Vegetables', paymentMethod: 'UPI', note: 'groceries at Big Bazaar',
    }],
    ['English, Payment Method first', 'Cash 200 for medicines for Papa', {
      amount: 200, category: 'Medical & Pharmacy', paymentMethod: 'Cash', note: 'medicines for Papa',
    }],
    ['English, as Chrome writes en-IN', 'paid ₹2,340 electricity bill by net banking.', {
      amount: 2340, category: 'Utilities & Bills', paymentMethod: 'Bank Transfer', note: 'electricity bill',
    }],
    ['transliterated Hindi', 'dawai ke liye 200 rupaye nakad diye', {
      amount: 200, category: 'Medical & Pharmacy', paymentMethod: 'Cash', note: 'dawai',
    }],
    ['transliterated Hindi, UPI app', 'sabzi wale ko 120 paytm se', {
      amount: 120, category: 'Groceries & Vegetables', paymentMethod: 'UPI', note: 'sabzi wale',
    }],
    ['Devanagari, as hi-IN recognition writes', 'दवाई के लिए 450 रुपये यूपीआई से दिए', {
      amount: 450, category: 'Medical & Pharmacy', paymentMethod: 'UPI', note: 'दवाई',
    }],
    ['Devanagari with English loan words', 'दूध 60 रुपए कैश', {
      amount: 60, category: 'Groceries & Vegetables', paymentMethod: 'Cash', note: 'दूध',
    }],
  ])('%s', (_, transcript, expected) => {
    expect(parseTranscript(transcript, seeded)).toEqual(expected)
  })

  test('missing amount still fills the rest', () => {
    expect(parseTranscript('sabzi from the market by cash', seeded)).toEqual({
      category: 'Groceries & Vegetables',
      paymentMethod: 'Cash',
      note: 'sabzi from the market',
    })
  })
})

describe('junk', () => {
  test.each([[''], ['   '], ['...?!'], ['rupees'], ['paid for by'], ['के लिए']])('%j gives nothing', (transcript) => {
    expect(parseTranscript(transcript, seeded)).toEqual({})
  })

  test('words the parser does not know only become the note', () => {
    expect(parseTranscript('hello hello testing', seeded)).toEqual({ note: 'hello hello testing' })
  })

  test('the note is cut to what the Ledger accepts', () => {
    const note = parseTranscript('word '.repeat(200), seeded).note ?? ''
    expect(note.length).toBeLessThanOrEqual(500)
    expect(note.endsWith('word')).toBe(true)
  })
})
