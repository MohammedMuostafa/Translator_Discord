import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AudioPlayerStatus,
  StreamType,
  createAudioResource,
  type AudioPlayer,
  type AudioResource
} from '@discordjs/voice';

const execFileAsync = promisify(execFile);

export type MusicTrack = {
  id: string;
  title: string;
  url: string;
  requestedBy: string;
  durationSeconds?: number;
  uploader?: string;
};

export type MusicQueueSnapshot = {
  active: boolean;
  paused: boolean;
  volume: number;
  current?: MusicTrack;
  queued: MusicTrack[];
};

type MusicHooks = {
  onActiveChange?: (active: boolean) => void;
  onTrackStart?: (track: MusicTrack) => void;
  onTrackEnd?: (track: MusicTrack) => void;
  onError?: (error: Error) => void;
};

type GuildMusicState = {
  player: AudioPlayer;
  queue: MusicTrack[];
  current?: MusicTrack;
  paused: boolean;
  resolving: boolean;
  volume: number;
  resource?: AudioResource;
  ytdlp?: ChildProcessWithoutNullStreams;
  ffmpeg?: ChildProcessWithoutNullStreams;
  hooks: MusicHooks;
};

const states = new Map<string, GuildMusicState>();
const guildVolumes = new Map<string, number>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function friendlyYtDlpError(error: unknown): Error {
  const text = errorMessage(error);
  const lower = text.toLowerCase();

  if (lower.includes('enoent') && lower.includes('yt-dlp')) {
    return new Error(
      'Music playback requires yt-dlp on the Railway runtime. Deploy the TD AI music Dockerfile first.'
    );
  }

  if (
    lower.includes('sign in to confirm') ||
    lower.includes('not a bot') ||
    lower.includes('po token') ||
    lower.includes('cookies')
  ) {
    return new Error(
      'YouTube blocked this datacenter request. Try another public link/source or configure yt-dlp cookies/PO-token support for the deployment.'
    );
  }

  if (lower.includes('unsupported url')) {
    return new Error('That music link is not supported by the current playback backend.');
  }

  return new Error(text.length > 700 ? `${text.slice(0, 700)}…` : text);
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

async function resolveTrack(query: string, requestedBy: string): Promise<MusicTrack> {
  const clean = query.trim();
  if (!clean) throw new Error('Song name or link is required.');

  const source = looksLikeUrl(clean) ? clean : `ytsearch1:${clean}`;

  let stdout = '';
  try {
    const result = await execFileAsync(
      'yt-dlp',
      [
        '--dump-json',
        '--skip-download',
        '--no-warnings',
        '--no-playlist',
        '--playlist-end',
        '1',
        source
      ],
      {
        timeout: 35_000,
        maxBuffer: 6 * 1024 * 1024
      }
    );
    stdout = String(result.stdout ?? '').trim();
  } catch (error) {
    throw friendlyYtDlpError(error);
  }

  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    throw new Error('No playable result was found for that song/link.');
  }

  let parsed: {
    id?: string;
    title?: string;
    webpage_url?: string;
    original_url?: string;
    duration?: number;
    uploader?: string;
  };

  try {
    parsed = JSON.parse(firstLine) as typeof parsed;
  } catch {
    throw new Error('Music search returned an invalid result. Try a direct public link.');
  }

  const url = parsed.webpage_url ?? parsed.original_url;
  if (!url) throw new Error('The selected music result has no playable webpage URL.');

  return {
    id: parsed.id ?? `${Date.now()}`,
    title: parsed.title?.trim() || clean,
    url,
    requestedBy,
    durationSeconds:
      Number.isFinite(parsed.duration) && Number(parsed.duration) > 0
        ? Number(parsed.duration)
        : undefined,
    uploader: parsed.uploader?.trim() || undefined
  };
}

function stopProcesses(state: GuildMusicState): void {
  try { state.ytdlp?.kill('SIGKILL'); } catch { /* no-op */ }
  try { state.ffmpeg?.kill('SIGKILL'); } catch { /* no-op */ }
  state.ytdlp = undefined;
  state.ffmpeg = undefined;
  state.resource = undefined;
}

function ensureState(
  guildId: string,
  player: AudioPlayer,
  hooks: MusicHooks = {}
): GuildMusicState {
  const existing = states.get(guildId);
  const vol = guildVolumes.get(guildId) ?? 100;
  if (existing) {
    existing.player = player;
    existing.hooks = hooks;
    return existing;
  }

  const state: GuildMusicState = {
    player,
    queue: [],
    paused: false,
    resolving: false,
    volume: vol,
    hooks
  };
  states.set(guildId, state);
  return state;
}

async function startTrack(guildId: string, state: GuildMusicState, track: MusicTrack): Promise<void> {
  stopProcesses(state);
  state.current = track;
  state.paused = false;
  state.hooks.onActiveChange?.(true);
  state.hooks.onTrackStart?.(track);

  const ytdlp = spawn(
    'yt-dlp',
    [
      '--no-warnings',
      '--no-playlist',
      '-f',
      'bestaudio/best',
      '-o',
      '-',
      track.url
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-f',
      's16le',
      'pipe:1'
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );

  state.ytdlp = ytdlp;
  state.ffmpeg = ffmpeg;

  ytdlp.stdin.end();
  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on('error', () => undefined);

  let stderr = '';
  const rememberError = (chunk: Buffer) => {
    if (stderr.length < 2400) stderr += chunk.toString('utf8');
  };
  ytdlp.stderr.on('data', rememberError);
  ffmpeg.stderr.on('data', rememberError);

  let childFailed = false;
  const childError = (error: Error) => {
    if (childFailed) return;
    childFailed = true;
    state.hooks.onError?.(friendlyYtDlpError(error));
    try { state.player.stop(true); } catch { /* no-op */ }
  };

  ytdlp.once('error', childError);
  ffmpeg.once('error', childError);

  ytdlp.once('close', (code) => {
    if (code && code !== 0 && !childFailed) {
      childFailed = true;
      state.hooks.onError?.(
        friendlyYtDlpError(new Error(stderr.trim() || `yt-dlp exited with code ${code}.`))
      );
      try { state.player.stop(true); } catch { /* no-op */ }
    }
  });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
    metadata: {
      tdMusic: true,
      guildId,
      trackId: track.id
    }
  });

  const currentVol = state.volume ?? getGuildMusicVolume(guildId);
  if (resource.volume) {
    resource.volume.setVolume(currentVol / 100);
  }

  state.resource = resource;
  state.volume = currentVol;
  state.player.play(resource);

  state.player.once(AudioPlayerStatus.Idle, () => {
    const currentState = states.get(guildId);
    if (!currentState || currentState !== state) return;

    const finished = currentState.current;
    stopProcesses(currentState);
    currentState.current = undefined;
    currentState.paused = false;
    if (finished) currentState.hooks.onTrackEnd?.(finished);

    void playNext(guildId, currentState);
  });
}

async function playNext(guildId: string, state: GuildMusicState): Promise<void> {
  if (state.current || state.resolving) return;

  const next = state.queue.shift();
  if (!next) {
    state.hooks.onActiveChange?.(false);
    return;
  }

  try {
    await startTrack(guildId, state, next);
  } catch (error) {
    state.current = undefined;
    state.hooks.onError?.(friendlyYtDlpError(error));
    await playNext(guildId, state);
  }
}

export async function enqueueMusic(
  guildId: string,
  player: AudioPlayer,
  query: string,
  requestedBy: string,
  hooks: MusicHooks = {}
): Promise<{ track: MusicTrack; position: number; started: boolean }> {
  const state = ensureState(guildId, player, hooks);
  state.resolving = true;

  let track: MusicTrack;
  try {
    track = await resolveTrack(query, requestedBy);
  } finally {
    state.resolving = false;
  }

  const started = !state.current && state.queue.length === 0;
  state.queue.push(track);
  const position = state.current ? state.queue.length : 1;
  await playNext(guildId, state);

  return { track, position, started };
}

export function pauseMusic(guildId: string): boolean {
  const state = states.get(guildId);
  if (!state?.current || state.paused) return false;
  const ok = Boolean(state.player.pause(true));
  if (ok) state.paused = true;
  return ok;
}

export function resumeMusic(guildId: string): boolean {
  const state = states.get(guildId);
  if (!state?.current || !state.paused) return false;
  const ok = Boolean(state.player.unpause());
  if (ok) state.paused = false;
  return ok;
}

export function skipMusic(guildId: string): boolean {
  const state = states.get(guildId);
  if (!state?.current) return false;
  stopProcesses(state);
  state.player.stop(true);
  return true;
}

export function stopMusic(guildId: string): boolean {
  const state = states.get(guildId);
  if (!state) return false;

  state.queue = [];
  state.resolving = false;
  const hadMusic = Boolean(state.current);
  stopProcesses(state);
  state.current = undefined;
  state.paused = false;
  try { state.player.stop(true); } catch { /* no-op */ }
  state.hooks.onActiveChange?.(false);
  states.delete(guildId);
  return hadMusic;
}

export function getGuildMusicVolume(guildId: string): number {
  return guildVolumes.get(guildId) ?? 100;
}

export function setGuildMusicVolume(guildId: string, volumePercent: number): number {
  const clamped = Math.max(0, Math.min(200, Math.round(volumePercent)));
  guildVolumes.set(guildId, clamped);
  const state = states.get(guildId);
  if (state) {
    state.volume = clamped;
    if (state.resource?.volume) {
      state.resource.volume.setVolume(clamped / 100);
    }
  }
  return clamped;
}

export function adjustGuildMusicVolume(guildId: string, deltaPercent: number): number {
  const current = getGuildMusicVolume(guildId);
  return setGuildMusicVolume(guildId, current + deltaPercent);
}

export function musicQueue(guildId: string): MusicQueueSnapshot {
  const state = states.get(guildId);
  const volume = getGuildMusicVolume(guildId);
  if (!state) {
    return { active: false, paused: false, volume, queued: [] };
  }

  return {
    active: Boolean(state.current),
    paused: state.paused,
    volume: state.volume ?? volume,
    current: state.current,
    queued: [...state.queue]
  };
}
