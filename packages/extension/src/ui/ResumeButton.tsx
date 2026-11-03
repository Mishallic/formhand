import { useRef, useState } from 'react';
import { resumeProfileText, type ResumeReply } from '@formhand/core';
import { AiError, PROVIDERS, readResumeWithAi } from '../lib/ai';
import { readResume, RESUME_ACCEPT, ResumeError } from '../lib/resume';
import { providerProblem, type Profile, type Settings } from '../lib/settings';

export function newProfileId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** "jane-doe_CV (2).pdf" → "jane doe CV", for when the resume gives no name. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/\(\d+\)/g, '').replace(/[_-]+/g, ' ').trim() || 'Resume';
}

interface Props {
  settings: Settings;
  /** Called with the new profile; `problem` says why the details weren't picked out, when they weren't. */
  onProfile: (profile: Profile, made: { fileName: string; problem?: string }) => void;
  label: string;
  className?: string;
}

/**
 * Picks a resume file, reads it in the browser, then asks the AI provider (when one
 * is set up) to pick out the details forms ask for. Shows its own progress and errors.
 */
export function ResumeButton({ settings, onProfile, label, className = 'button' }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const who = PROVIDERS[settings.provider].label.split(' (')[0];

  async function pick(file: File) {
    setError(undefined);
    setBusy(`Reading ${file.name}…`);
    try {
      const resume = await readResume(file);
      let reply: ResumeReply | undefined;
      let problem: string | undefined;
      if (providerProblem(settings)) {
        if (!resume.text) throw new ResumeError('This PDF is a scanned image with no text in it. Set up Claude in Settings to read scans, or paste the text into a new profile.');
        problem = `Kept the text of ${file.name}. Set up an AI provider in Settings to pick out your details, so Match fields can use them too.`;
      } else {
        setBusy(`Picking out your details with ${who}…`);
        try {
          reply = await readResumeWithAi(settings, resume);
        } catch (e) {
          if (!resume.text || !(e instanceof AiError)) throw e;
          problem = `${e.message} Kept the text of ${file.name} as it is.`;
        }
      }
      onProfile({ id: newProfileId(), name: reply?.name || nameFromFile(file.name), text: resumeProfileText(reply, resume.text) }, { fileName: file.name, problem });
    } catch (e) {
      setError(e instanceof ResumeError || e instanceof AiError ? e.message : `Something went wrong: ${(e as Error).message}`);
    } finally {
      setBusy(undefined);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()} disabled={!!busy}>
        {busy ?? label}
      </button>
      <input
        ref={input}
        type="file"
        accept={RESUME_ACCEPT}
        aria-label="Resume file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
        }}
      />
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
