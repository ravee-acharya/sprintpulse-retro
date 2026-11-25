/** Facilitator: edit a live board's columns (rename / reorder / recolour / add / remove). */
import { useEffect, useState } from 'react';
import { ColumnEditor, type EditableColumn } from '../ColumnEditor';
import { Button, Modal } from '../ui';
import { useRetro } from './RetroContext';

export function EditColumnsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, run } = useRetro();
  const [cols, setCols] = useState<EditableColumn[]>([]);
  const [moveTo, setMoveTo] = useState('');

  useEffect(() => {
    if (open) setCols([...s.board.columns].sort((a, b) => a.order - b.order).map(({ order: _o, ...c }) => c));
  }, [open, s.board.columns]);

  const keptIds = new Set(cols.map((c) => c.id).filter(Boolean));
  const removedWithCards = s.board.columns.filter((c) => !keptIds.has(c.id) && s.cards.some((card) => card.columnId === c.id));
  const targets = cols.filter((c) => c.id);
  const valid = cols.length > 0 && cols.every((c) => c.title.trim()) && (!removedWithCards.length || moveTo);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit columns"
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={async () => {
              const ok = await run('retros.updateColumns', { retroId: s.board.id, columns: cols, moveOrphansTo: moveTo || null });
              if (ok) onClose();
            }}
          >
            Save columns
          </Button>
        </>
      }
    >
      <ColumnEditor columns={cols} onChange={setCols} />
      {removedWithCards.length > 0 && (
        <label className="mt-3 block rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {removedWithCards.map((c) => c.title).join(', ')} still {removedWithCards.length === 1 ? 'has' : 'have'} cards. Move them to:
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="ml-2 rounded border border-amber-300 bg-white px-1">
            <option value="">Choose a column</option>
            {targets.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      )}
    </Modal>
  );
}
