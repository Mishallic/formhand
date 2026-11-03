/** What a person pastes for the job application test form (pages/apply.html). */
export const PASTE = `First name: Jane
Last name: Doe
Email: jane@northwind.test
Phone: +47 912 34 567
Date of birth: 14/02/1991
Street address: Storgata 1
City: Oslo
Postcode: 0155
Country: Norway
Years of experience: 7
Newsletter: yes`;

/** What a person pastes for the React test form (pages/react-form.tsx). */
export const REACT_PASTE = `Email: jane@northwind.test
Role: Product manager
Plan: Pro
About you: I design calm tools.
Start date: 2026-12-01
I agree to the terms: yes`;

/** React's state once REACT_PASTE is filled in. */
export const REACT_FILLED = {
  email: 'jane@northwind.test',
  role: 'pm',
  plan: 'pro',
  agree: true,
  about: 'I design calm tools.',
  start: '2026-12-01',
};

/** The pairing code the tests start the MCP helper with. */
export const PAIRING_CODE = 'E2ETS-TCDEF-GHJKM-NPQRS';
