import { useState } from 'react';
import { formatRelativeTime } from '../../lib/utils';
import { MEMORY_CHAR_BUDGET, MAX_FACTS } from '../../lib/memory';
import { useMemoryStore } from '../../store/memoryStore';
import { toastSuccess } from '../../store/toastStore';
import { Badge, Button, Field, Switch, TextInput } from '../ui/controls';

/**
 * View, edit and delete the facts the app has saved about the user, and switch
 * the whole thing off. This panel is the only place those facts are visible, so
 * it says plainly what is stored, where, and who gets to see it.
 */
export function MemoryPanel() {
  const enabled = useMemoryStore((state) => state.enabled);
  const setEnabled = useMemoryStore((state) => state.setEnabled);
  const facts = useMemoryStore((state) => state.facts);
  const add = useMemoryStore((state) => state.add);
  const update = useMemoryStore((state) => state.update);
  const remove = useMemoryStore((state) => state.remove);
  const clearAll = useMemoryStore((state) => state.clearAll);

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const saved = facts.reduce((total, fact) => total + fact.text.length + 3, 0);

  return (
    <div className="space-y-4">
      <label className="flex items-start justify-between gap-4 rounded-xl border border-line p-3.5">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-fg">Use memory</span>
          <span className="mt-0.5 block max-w-[52ch] text-[12px] leading-relaxed text-muted">
            Adds the facts below to the system prompt of every request, so “what is my name?” can be answered after a
            restart. Off keeps them on this device but sends none of them.
          </span>
        </span>
        <Switch checked={enabled} onChange={setEnabled} label="Use memory" />
      </label>

      <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
        <h3 className="flex items-center gap-2 text-[13px] font-medium text-fg">
          Saved facts
          <Badge tone={facts.length ? 'neutral' : 'muted'}>
            {facts.length}/{MAX_FACTS}
          </Badge>
          <Badge tone={enabled ? 'success' : 'muted'}>{enabled ? 'in use' : 'paused'}</Badge>
        </h3>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Nothing is saved automatically. In a chat, start a message with “remember that …” and the fact lands here — the
          app stores it, not the model. Facts live in this browser's localStorage and are sent to whichever model you are
          using, so treat them as public to that provider. Passwords, keys and card numbers are refused. At most{' '}
          {MEMORY_CHAR_BUDGET} characters (the newest facts first) go into any one request.
        </p>
      </div>

      <Field label="Add a fact" hint="Same as saying “remember that …” in a chat.">
        <div className="flex gap-2">
          <TextInput
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const fact = add(draft);
              if (fact) {
                setDraft('');
                toastSuccess('Saved to memory', fact.text);
              }
            }}
            placeholder="My name is Sam"
            aria-label="Add a fact"
          />
          <Button
            variant="secondary"
            disabled={!draft.trim()}
            onClick={() => {
              const fact = add(draft);
              if (!fact) return;
              setDraft('');
              toastSuccess('Saved to memory', fact.text);
            }}
          >
            Add
          </Button>
        </div>
      </Field>

      {facts.length === 0 ? (
        <p className="rounded-xl border border-line px-3.5 py-3 text-[12px] leading-relaxed text-muted">
          No facts saved yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {facts.map((fact) => (
            <li key={fact.id} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              {editingId === fact.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <TextInput
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    aria-label="Edit fact"
                    autoFocus
                  />
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!editDraft.trim()}
                      onClick={() => {
                        update(fact.id, editDraft);
                        setEditingId(null);
                      }}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] leading-relaxed text-fg">{fact.text}</p>
                    <p className="mt-0.5 text-[11px] text-muted">saved {formatRelativeTime(fact.updatedAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(fact.id);
                        setEditDraft(fact.text);
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(fact.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger" disabled={!facts.length} onClick={clearAll}>
          Forget everything
        </Button>
        <p className="text-[11px] text-muted">
          {saved > MEMORY_CHAR_BUDGET
            ? `${saved} characters saved; only the newest ${MEMORY_CHAR_BUDGET} are sent.`
            : `${saved} characters saved — all of them fit in every request.`}
        </p>
      </div>
    </div>
  );
}
