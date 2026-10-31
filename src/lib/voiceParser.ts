/**
 * Voice entry's parser (spec: "Voice"): a transcript in, a partial Expense
 * out. Digits give the amount, keyword maps (English and transliterated
 * Hindi) give the Category and Payment Method, and what is left is the note.
 * Pure, so the whole behaviour is covered by table-driven tests; the result
 * only ever prefills the Quick Expense form, it is never saved as is.
 */
import type { Category, PaymentMethod } from './api'
import { MAX_AMOUNT } from './keypad'

export type VoiceDraft = {
  amount?: number
  /** Always the spelling of one of the Categories passed in. */
  category?: string
  paymentMethod?: PaymentMethod
  note?: string
}

type Token = { text: string; key: string }

/** A number (with an optional ₹ in front), a lone ₹, or a word in any script. */
const WORD = /₹?\d[\d,]*(?:\.\d+)?|₹|[\p{L}\p{M}]+/gu
const DEVANAGARI_ZERO = 0x0966

function tokenize(transcript: string): Token[] {
  // Hindi recognition may write Devanagari digits (४५०): read them as 450.
  const ascii = transcript.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO))
  return Array.from(ascii.matchAll(WORD), (m) => ({ text: m[0], key: keyOf(m[0]) }))
}

/** Lower case, with the Devanagari nukta dropped so सब्ज़ी and सब्जी are one word. */
function keyOf(word: string): string {
  return word.toLowerCase().normalize('NFD').replace(/\u093C/g, '').normalize('NFC')
}

const CURRENCY = new Set([
  '₹', 'rupees', 'rupee', 'rs', 'inr', 'rupaye', 'rupaiye', 'rupay', 'rupaya', 'rupiya', 'rupiye', 'rupye',
  'रुपये', 'रुपए', 'रुपया', 'रुपैया', 'रु',
])

/** The longest note the Ledger accepts (pkg/expenses MaxNoteLength). */
const MAX_NOTE = 500
/**
 * Words that carry no meaning at either end of the note ("paid ... for",
 * "... by", "... se diye"). Only trimmed from the ends, so "medicines for
 * Papa" keeps its "for".
 */
const FILLER = new Set([
  'paid', 'pay', 'spent', 'spend', 'gave', 'for', 'by', 'via', 'using', 'with', 'through', 'on', 'in', 'of', 'to',
  'the', 'a', 'an', 'and', 'at',
  'ke', 'ka', 'ki', 'ko', 'liye', 'se', 'mein', 'me', 'diye', 'diya', 'de', 'kiya', 'kiye', 'kharcha', 'kharche',
  'hai', 'aur', 'par',
  'के', 'का', 'की', 'को', 'लिए', 'से', 'में', 'दिए', 'दिये', 'दिया', 'किया', 'खर्च', 'है', 'और', 'पर',
])

/** Payment Method words (GLOSSARY: Payment Method), several words where needed. */
const PAYMENT: [string[], PaymentMethod][] = (
  [
    ['upi', 'UPI'], ['gpay', 'UPI'], ['google pay', 'UPI'], ['phonepe', 'UPI'], ['phone pe', 'UPI'],
    ['paytm', 'UPI'], ['bhim', 'UPI'], ['यूपीआई', 'UPI'], ['फोनपे', 'UPI'], ['फोन पे', 'UPI'], ['पेटीएम', 'UPI'],
    ['cash', 'Cash'], ['nakad', 'Cash'], ['naqad', 'Cash'], ['nagad', 'Cash'], ['नकद', 'Cash'], ['नगद', 'Cash'],
    ['कैश', 'Cash'],
    ['credit card', 'Card'], ['debit card', 'Card'], ['card', 'Card'], ['कार्ड', 'Card'],
    ['bank transfer', 'Bank Transfer'], ['net banking', 'Bank Transfer'], ['netbanking', 'Bank Transfer'],
    ['neft', 'Bank Transfer'], ['imps', 'Bank Transfer'], ['rtgs', 'Bank Transfer'],
    ['बैंक ट्रांसफर', 'Bank Transfer'], ['नेट बैंकिंग', 'Bank Transfer'],
  ] as const
)
  .map(([phrase, method]): [string[], PaymentMethod] => [phrase.split(' ').map(keyOf), method])
  // Longest first, so "credit card" is one match and not "card" alone.
  .sort((a, b) => b[0].length - a[0].length)

/** The Payment Method phrase starting at token `i`, if any. */
function paymentAt(tokens: Token[], i: number): { method: PaymentMethod; length: number } | null {
  for (const [words, method] of PAYMENT) {
    if (words.every((w, j) => tokens[i + j]?.key === w)) return { method, length: words.length }
  }
  return null
}
type Keywords = { strong: string[]; weak?: string[] }

/**
 * Words that point at each seeded Category, keyed by its name in lower case
 * (GLOSSARY: Category). English, transliterated Hindi, and Devanagari,
 * because hi-IN recognition writes Devanagari. Weak words ("bill", "fees")
 * only count when nothing stronger was said: "doctor fees" is Medical.
 * A plain "s" or "es" plural matches too.
 */
const CATEGORY_WORDS: Record<string, Keywords> = {
  'groceries & vegetables': {
    strong: [
      'grocery', 'groceries', 'vegetable', 'veggies', 'sabzi', 'sabji', 'subzi', 'sabziyan', 'sabjiyan', 'tarkari',
      'milk', 'doodh', 'dudh', 'fruit', 'phal', 'kirana', 'ration', 'atta', 'aata', 'chawal', 'rice', 'dal', 'daal',
      'bread', 'egg', 'anda', 'ande', 'onion', 'pyaz', 'aloo', 'tamatar', 'tomato', 'sugar', 'cheeni',
      'सब्जी', 'सब्जियां', 'सब्जियाँ', 'तरकारी', 'दूध', 'किराना', 'राशन', 'फल', 'आटा', 'चावल', 'दाल', 'अंडे',
    ],
  },
  'medical & pharmacy': {
    strong: [
      'medicine', 'pharmacy', 'chemist', 'doctor', 'hospital', 'tablet', 'clinic', 'injection', 'dawai', 'dawa',
      'davai', 'dava', 'dawaai', 'dawaiyan', 'aspatal',
      'दवाई', 'दवा', 'दवाइयां', 'दवाइयाँ', 'डॉक्टर', 'डाक्टर', 'अस्पताल', 'केमिस्ट', 'मेडिकल', 'गोली',
    ],
  },
  'utilities & bills': {
    strong: [
      'electricity', 'bijli', 'recharge', 'mobile', 'internet', 'wifi', 'broadband', 'gas', 'cylinder', 'water',
      'paani', 'pani', 'dth',
      'बिजली', 'रिचार्ज', 'गैस', 'सिलेंडर', 'पानी', 'इंटरनेट',
    ],
    weak: ['bill', 'बिल'],
  },
  'school & kids': {
    strong: [
      'school', 'tuition', 'book', 'kitab', 'kitaab', 'kitabein', 'stationery', 'uniform', 'pencil', 'coaching',
      'bachche', 'bacche', 'bachon', 'bacchon',
      'स्कूल', 'ट्यूशन', 'किताब', 'किताबें', 'कॉपी', 'वर्दी', 'बच्चों',
    ],
    weak: ['fee', 'फीस'],
  },
  'household & help': {
    strong: [
      'maid', 'bai', 'kaamwali', 'kamwali', 'cook', 'driver', 'cleaning', 'safai', 'dhobi', 'laundry', 'ironing',
      'istri', 'plumber', 'electrician', 'carpenter', 'mistri', 'repair', 'watchman',
      'कामवाली', 'बाई', 'सफाई', 'धोबी', 'ड्राइवर', 'इस्त्री', 'मिस्त्री',
    ],
    weak: ['salary'],
  },
  'dining & outings': {
    strong: [
      'dinner', 'lunch', 'breakfast', 'restaurant', 'hotel', 'food', 'khana', 'khaana', 'nashta', 'outing', 'movie',
      'cinema', 'film', 'picnic', 'pizza', 'burger', 'cafe', 'coffee', 'zomato', 'swiggy', 'snacks',
      'खाना', 'नाश्ता', 'होटल', 'रेस्टोरेंट', 'फिल्म', 'पिक्चर',
    ],
  },
  'petrol & transport': {
    strong: [
      'petrol', 'diesel', 'cng', 'fuel', 'pump', 'parking', 'toll', 'auto', 'rickshaw', 'rikshaw', 'riksha', 'cab',
      'taxi', 'uber', 'ola', 'rapido',
      'पेट्रोल', 'डीजल', 'सीएनजी', 'पंप', 'पार्किंग', 'टोल', 'ऑटो', 'आटो', 'रिक्शा', 'रिक्शे', 'कैब', 'टैक्सी', 'उबर',
      'ओला', 'रैपिडो',
    ],
  },
}

/** The words of a Category's own name ("Petrol & Travel" -> petrol, travel). */
function nameWords(name: string): string[] {
  return tokenize(name)
    .map((t) => t.key)
    .filter((w) => w.length >= 3 && w !== 'and')
}

function findCategory(tokens: Token[], categories: Category[]): string | undefined {
  const lists = categories.map((c) => {
    const known = CATEGORY_WORDS[normalName(c.name)]
    return { name: c.name, strong: [...nameWords(c.name), ...(known?.strong ?? [])], weak: known?.weak ?? [] }
  })
  for (const strength of ['strong', 'weak'] as const) {
    for (const t of tokens) {
      const found = lists.find((l) => l[strength].some((w) => matches(t.key, w)))
      if (found) return found.name
    }
  }
  return undefined
}

function amountOf(token: Token): number | null {
  const digits = token.key.replace(/^₹/, '')
  if (!/^\d/.test(digits)) return null
  const n = Number(digits.replaceAll(',', ''))
  return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT ? n : null
}

/**
 * Which number is the amount: the first one said with a currency word or
 * ₹ next to it ("2 kg sabzi for 80 rupees" is 80), else the first number.
 */
function amountIndex(tokens: Token[]): number {
  const numbers = tokens.flatMap((t, i) => (amountOf(t) === null ? [] : [i]))
  const priced = numbers.find(
    (i) =>
      tokens[i]!.key.startsWith('₹') ||
      CURRENCY.has(tokens[i - 1]?.key ?? '') ||
      CURRENCY.has(tokens[i + 1]?.key ?? ''),
  )
  return priced ?? numbers[0] ?? -1
}

function normalName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}


function matches(key: string, word: string): boolean {
  return key === word || key === `${word}s` || key === `${word}es`
}

export function parseTranscript(transcript: string, categories: Category[]): VoiceDraft {
  const tokens = tokenize(transcript)
  const keep = tokens.map(() => true)
  const draft: VoiceDraft = {}

  const at = amountIndex(tokens)
  if (at >= 0) {
    draft.amount = amountOf(tokens[at]!)!
    keep[at] = false
  }
  for (let i = 0; i < tokens.length; i++) {
    if (!keep[i]) continue
    if (CURRENCY.has(tokens[i]!.key)) {
      keep[i] = false
      continue
    }
    const payment = paymentAt(tokens, i)
    if (payment) {
      draft.paymentMethod ??= payment.method
      keep.fill(false, i, i + payment.length)
      i += payment.length - 1
    }
  }

  const category = findCategory(tokens.filter((_, i) => keep[i]), categories)
  if (category !== undefined) draft.category = category

  const rest = tokens.filter((_, i) => keep[i])
  while (rest.length > 0 && FILLER.has(rest[0]!.key)) rest.shift()
  while (rest.length > 0 && FILLER.has(rest[rest.length - 1]!.key)) rest.pop()
  let note = ''
  for (const t of rest) {
    const next = note ? `${note} ${t.text}` : t.text
    if (next.length > MAX_NOTE) break
    note = next
  }
  if (note) draft.note = note
  return draft
}
