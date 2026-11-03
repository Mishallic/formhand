import { containsPhrase, normalize } from './text';

/**
 * What a field or a pasted key is "about". Names follow the HTML autocomplete tokens
 * where one exists, so a field's autocomplete attribute maps straight onto a concept.
 */
export type Concept = keyof typeof SYNONYMS;

const SYNONYMS = {
  'given-name': ['first name', 'firstname', 'fname', 'given name', 'forename', 'first'],
  'family-name': ['last name', 'lastname', 'lname', 'surname', 'family name', 'last'],
  'additional-name': ['middle name', 'middle initial', 'middle'],
  name: ['name', 'full name', 'fullname', 'your name', 'contact name', 'applicant name', 'legal name'],
  'honorific-prefix': ['salutation', 'honorific', 'prefix', 'title mr mrs'],
  email: ['email', 'e mail', 'email address', 'mail', 'e mail address', 'work email', 'contact email'],
  tel: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'mobile number', 'mobile phone', 'cell', 'cell phone', 'contact number', 'whatsapp'],
  organization: ['company', 'company name', 'organization', 'organisation', 'employer', 'current company', 'business name', 'business'],
  'organization-title': ['job title', 'position', 'current title', 'role', 'occupation', 'designation'],
  'street-address': ['address', 'street address', 'street', 'home address', 'mailing address'],
  'address-line1': ['address line 1', 'address 1', 'address1', 'street line 1'],
  'address-line2': ['address line 2', 'address 2', 'address2', 'apartment', 'apt', 'suite', 'unit', 'flat'],
  'address-level2': ['city', 'town', 'locality', 'city town'],
  'address-level1': ['state', 'province', 'region', 'county', 'state province', 'state region'],
  'postal-code': ['zip', 'zip code', 'zipcode', 'postal code', 'postcode', 'post code', 'pin code'],
  country: ['country', 'country name', 'country region', 'nation'],
  bday: ['birthday', 'date of birth', 'dob', 'birth date', 'birthdate'],
  sex: ['gender', 'sex'],
  url: ['website', 'url', 'homepage', 'web site', 'personal website', 'portfolio', 'portfolio url', 'site'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile', 'linked in'],
  github: ['github', 'github url', 'github profile', 'git hub'],
  username: ['username', 'user name', 'login', 'user id', 'handle'],
  nationality: ['nationality', 'citizenship'],
  salary: ['salary', 'expected salary', 'salary expectation', 'salary expectations', 'desired salary', 'compensation'],
  'notice-period': ['notice period', 'notice'],
  'start-date': ['start date', 'available from', 'availability', 'earliest start date'],
  experience: ['years of experience', 'experience years', 'total experience'],
  'cover-letter': ['cover letter', 'motivation', 'motivation letter', 'why do you want to work here'],
  subject: ['subject', 'topic'],
  message: ['message', 'comments', 'comment', 'notes', 'additional information', 'inquiry', 'enquiry', 'your message', 'how can we help'],
} as const;

/** Autocomplete tokens that name the same thing as one of our concepts. */
const AUTOCOMPLETE_ALIASES: Record<string, Concept> = {
  'address-line3': 'address-line2',
  'country-name': 'country',
  'tel-national': 'tel',
  'tel-local': 'tel',
  nickname: 'username',
};

const ALL_PHRASES: { phrase: string; concept: Concept }[] = Object.entries(SYNONYMS).flatMap(
  ([concept, phrases]) => phrases.map((phrase) => ({ phrase, concept: concept as Concept })),
);

const EXACT = new Map(ALL_PHRASES.map((p) => [p.phrase, p.concept]));

/** Words that name a concept on their own but mean little inside a longer label ("First time here?"). */
const EXACT_ONLY = new Set(['first', 'last', 'middle', 'mail', 'site', 'notice', 'role', 'business', 'unit', 'flat', 'login', 'prefix', 'handle', 'notes', 'comment', 'topic']);

/**
 * The concept a label, key or attribute talks about, or undefined if none is clear.
 * An exact synonym wins. Otherwise the synonym that ends last in the text wins, since
 * the head noun of a label usually comes last ("Company email" is an email, "Email
 * address" is an email, "Name of company" is a company); ties go to the longer phrase.
 */
export function conceptOf(text: string): Concept | undefined {
  const n = normalize(text);
  if (!n) return undefined;
  const exact = EXACT.get(n);
  if (exact) return exact;
  const padded = ` ${n} `;
  let best: { concept: Concept; end: number; length: number } | undefined;
  for (const { phrase, concept } of ALL_PHRASES) {
    if (EXACT_ONLY.has(phrase) || !containsPhrase(n, phrase)) continue;
    const end = padded.lastIndexOf(` ${phrase} `) + phrase.length;
    if (!best || end > best.end || (end === best.end && phrase.length > best.length)) {
      best = { concept, end, length: phrase.length };
    }
  }
  return best?.concept;
}

/** Maps an autocomplete attribute such as "shipping given-name" to a concept. */
export function conceptOfAutocomplete(autocomplete: string | undefined): Concept | undefined {
  if (!autocomplete) return undefined;
  const parts = autocomplete.toLowerCase().trim().split(/\s+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const token = parts[i]!;
    if (token in SYNONYMS) return token as Concept;
    const alias = AUTOCOMPLETE_ALIASES[token];
    if (alias) return alias;
  }
  return undefined;
}
