import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

// A React-controlled form. React keeps its own copy of each value and ignores DOM changes
// it didn't see as input events, so window.__state shows whether a fill really reached React.
function Signup() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [plan, setPlan] = useState('free');
  const [agree, setAgree] = useState(false);
  const [about, setAbout] = useState('');
  const [start, setStart] = useState('');
  const state = { email, role, plan, agree, about, start };
  useEffect(() => {
    (window as { __state?: unknown }).__state = state;
  });

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <h1>Join Northwind</h1>
      <label>
        Email <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Role
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Pick one</option>
          <option value="dev">Developer</option>
          <option value="pm">Product manager</option>
        </select>
      </label>
      <fieldset>
        <legend>Plan</legend>
        <label>
          <input type="radio" name="plan" value="free" checked={plan === 'free'} onChange={() => setPlan('free')} /> Free
        </label>
        <label>
          <input type="radio" name="plan" value="pro" checked={plan === 'pro'} onChange={() => setPlan('pro')} /> Pro
        </label>
      </fieldset>
      <label>
        About you <textarea name="about" value={about} onChange={(e) => setAbout(e.target.value)} />
      </label>
      <label>
        Start date <input name="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" name="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree to the terms
      </label>
      <output id="state">{JSON.stringify(state)}</output>
    </form>
  );
}

createRoot(document.getElementById('app')!).render(<Signup />);
