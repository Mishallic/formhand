import { useState } from 'react';
import { forgetAnswer, type RememberedAnswer } from '@formhand/core';
import { saveMemory, type Settings } from '../lib/settings';

interface Props {
  memory: RememberedAnswer[];
  settings: Settings;
  onSaveSettings: (settings: Settings) => void;
}

const SHOWN = 12;

function shown(answer: RememberedAnswer): string {
  if (answer.kind === 'checkbox') return answer.value === 'true' ? 'Ticked' : 'Not ticked';
  return answer.value;
}

/** The answers kept from earlier fills, with a switch to stop keeping them. */
export function MemoryView({ memory, settings, onSaveSettings }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const list = showAll ? memory : memory.slice(0, SHOWN);

  return (
    <section className="section" aria-label="Remembered answers">
      <h2 className="section-title">Remembered answers</h2>
      <p className="help">
        After a fill, Formhand keeps the answers your info didn’t already have, such as a value you typed in the preview or a notice period, and uses them
        on later forms. Your info wins when they differ. Consent boxes are never kept. Answers stay in this browser.
      </p>
      <label className="toggle">
        <input type="checkbox" checked={settings.memory.enabled} onChange={(e) => onSaveSettings({ ...settings, memory: { enabled: e.target.checked } })} />
        <span>Remember answers I fill</span>
      </label>
      {memory.length === 0 ? (
        <p className="empty">Nothing remembered yet.</p>
      ) : (
        <div>
          {list.map((a) => (
            <div className="profile row spread" key={a.question} style={{ flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <div style={{ minWidth: 0 }}>
                <div className="profile-name">{a.question}</div>
                <div className="profile-preview">
                  {shown(a)} on {a.site}
                </div>
              </div>
              <button type="button" className="link-button" aria-label={`Forget ${a.question}`} onClick={() => void saveMemory(forgetAnswer(memory, a.question))}>
                Forget
              </button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            {memory.length > SHOWN && (
              <button type="button" className="link-button" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${memory.length}`}
              </button>
            )}
            {confirmClear ? (
              <>
                <button
                  type="button"
                  className="link-button"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => {
                    void saveMemory([]);
                    setConfirmClear(false);
                  }}
                >
                  Forget all {memory.length}
                </button>
                <button type="button" className="link-button" onClick={() => setConfirmClear(false)}>
                  Keep them
                </button>
              </>
            ) : (
              <button type="button" className="link-button" onClick={() => setConfirmClear(true)}>
                Forget all
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
