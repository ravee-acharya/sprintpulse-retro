/**
 * Ambient music. The facilitator controls the shared state (track + play/pause); each
 * participant's browser synthesises the track locally and can mute it for themselves.
 */
import { useEffect, useRef, useState } from 'react';
import { Music2, Volume2, VolumeX } from 'lucide-react';
import { AMBIENT_TRACKS } from '@shared/catalog';
import { audioUnlocked, startAmbient, unlockAudio, type AmbientHandle } from '../../lib/audio';
import { Button, cx, Popover } from '../ui';
import { useRetro } from './RetroContext';

const MUTE_KEY = 'sprintpulse-muted';

export function MusicControl() {
  const { s, isFac, run } = useRetro();
  const m = s.board.facilitator.music;
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [unlocked, setUnlocked] = useState(audioUnlocked());
  const handle = useRef<AmbientHandle | null>(null);
  const playingTrack = useRef<string | null>(null);

  // Drive the local synth from shared state.
  useEffect(() => {
    const want = m.playing && m.trackId && !muted && unlocked ? m.trackId : null;
    if (want === playingTrack.current) {
      handle.current?.setVolume(m.volume);
      return;
    }
    handle.current?.stop();
    handle.current = want ? startAmbient(want, m.volume) : null;
    playingTrack.current = want;
  }, [m.playing, m.trackId, m.volume, muted, unlocked]);
  useEffect(() => () => handle.current?.stop(), []);

  const toggleMute = async () => {
    if (!unlocked) setUnlocked(await unlockAudio());
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
  };

  const set = async (payload: { trackId: string | null; playing: boolean; volume?: number }) => {
    setUnlocked(await unlockAudio());
    await run('facilitator.music', { retroId: s.board.id, ...payload });
  };

  const track = AMBIENT_TRACKS.find((t) => t.id === m.trackId);
  const needsUnlock = m.playing && !unlocked && !muted;

  return (
    <div className="relative flex items-center">
      {isFac ? (
        <Button aria-label="Ambient music" onClick={() => setOpen((o) => !o)} className={cx(m.playing && 'border-brand-300 bg-brand-50 text-brand-700')}>
          <Music2 className={cx('size-4', m.playing && 'sp-anim-bounce')} />
          <span className="hidden lg:inline">{m.playing && track ? track.label : 'Music'}</span>
        </Button>
      ) : (
        m.playing && (
          <span className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700">
            <Music2 className="size-3.5 sp-anim-bounce" /> {track?.label}
          </span>
        )
      )}
      {(m.playing || isFac) && (
        <Button
          variant="ghost"
          aria-label={muted ? 'Unmute music for me' : 'Mute music for me'}
          title={needsUnlock ? 'Click to enable sound' : muted ? 'Unmute (just for you)' : 'Mute (just for you)'}
          onClick={toggleMute}
          className={cx(needsUnlock && 'animate-pulse text-brand-600')}
        >
          {muted || !unlocked ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </Button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} className="top-11 right-0 w-60">
        <div className="mb-2 text-xs font-semibold text-slate-500">Play for everyone</div>
        <div className="space-y-1">
          {AMBIENT_TRACKS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ trackId: t.id, playing: !(m.playing && m.trackId === t.id) })}
              className={cx('flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50', m.trackId === t.id && m.playing && 'bg-brand-50 text-brand-700')}
            >
              {t.label}
              {m.trackId === t.id && m.playing ? <span className="text-xs">Playing - stop</span> : <span className="text-xs text-slate-400">Play</span>}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          Volume
          <input type="range" min={0} max={1} step={0.05} defaultValue={m.volume} onMouseUp={(e) => set({ trackId: m.trackId, playing: m.playing, volume: Number((e.target as HTMLInputElement).value) })} className="flex-1" />
        </label>
      </Popover>
    </div>
  );
}
