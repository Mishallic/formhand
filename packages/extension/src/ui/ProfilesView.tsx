import { useState } from 'react';
import type { Profile } from '../lib/settings';

interface Props {
  profiles: Profile[];
  activeId?: string;
  onChange: (profiles: Profile[], activeId?: string) => void;
}

const EXAMPLE = `Name: Jane Doe
Email: jane@example.com
Phone: +47 912 34 567
Address: Storgata 1, 0155 Oslo, Norway
Company: Acme AS
Job title: Product designer
LinkedIn: https://www.linkedin.com/in/janedoe`;

function newId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function ProfilesView({ profiles, activeId, onChange }: Props) {
  const [editing, setEditing] = useState<Profile>();
  const [confirmDelete, setConfirmDelete] = useState<string>();

  function save() {
    if (!editing) return;
    const profile = { ...editing, name: editing.name.trim() || 'Untitled', text: editing.text };
    const exists = profiles.some((p) => p.id === profile.id);
    const next = exists ? profiles.map((p) => (p.id === profile.id ? profile : p)) : [...profiles, profile];
    onChange(next, activeId ?? profile.id);
    setEditing(undefined);
  }

  function remove(id: string) {
    onChange(
      profiles.filter((p) => p.id !== id),
      activeId === id ? undefined : activeId,
    );
    setConfirmDelete(undefined);
  }

  if (editing) {
    const isNew = !profiles.some((p) => p.id === editing.id);
    return (
      <div className="view">
        <section className="section">
          <h2 className="section-title">{isNew ? 'New profile' : `Edit ${editing.name}`}</h2>
          <label className="label" htmlFor="profile-name">
            Name
          </label>
          <input id="profile-name" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Me, Work, Mum…" autoFocus />
          <label className="label" htmlFor="profile-text">
            Details
          </label>
          <textarea id="profile-text" className="textarea" style={{ minHeight: 220 }} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} placeholder={EXAMPLE} />
          <p className="help">One detail per line works best without AI. With AI, anything goes: paste a CV or a paragraph about yourself.</p>
          <div className="row">
            <button type="button" className="button primary" onClick={save}>
              Save profile
            </button>
            <button type="button" className="button" onClick={() => setEditing(undefined)}>
              Cancel
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="view">
      <section className="section">
        <div className="row spread">
          <h2 className="section-title">Profiles</h2>
          <button type="button" className="button" onClick={() => setEditing({ id: newId(), name: '', text: '' })}>
            New profile
          </button>
        </div>
        <p className="help">Save the details you fill in often. Pick a profile on the Fill tab to load it. Profiles stay in this browser.</p>
        {profiles.length === 0 ? (
          <p className="empty">No profiles yet. A profile with your name, email, phone and address covers most forms.</p>
        ) : (
          <div>
            {profiles.map((p) => (
              <div className="profile" key={p.id}>
                <div className="profile-name">
                  {p.name}
                  {p.id === activeId && <span className="badge">In use</span>}
                </div>
                <div className="profile-preview">{p.text.split('\n').filter(Boolean).slice(0, 2).join(', ') || 'Empty'}</div>
                <div className="row" style={{ marginTop: 4 }}>
                  {p.id !== activeId && (
                    <button type="button" className="link-button" onClick={() => onChange(profiles, p.id)}>
                      Use
                    </button>
                  )}
                  <button type="button" className="link-button" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                  {confirmDelete === p.id ? (
                    <>
                      <button type="button" className="link-button" style={{ color: 'var(--danger)' }} onClick={() => remove(p.id)}>
                        Delete {p.name}
                      </button>
                      <button type="button" className="link-button" onClick={() => setConfirmDelete(undefined)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" className="link-button" onClick={() => setConfirmDelete(p.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
