declare module 'zzfx' {
  export const ZZFX: {
    volume: number;
    audioContext: AudioContext;
    play: (...parameters: Array<number | undefined>) => AudioBufferSourceNode;
  };
  export function zzfx(...parameters: Array<number | undefined>): AudioBufferSourceNode;
}
