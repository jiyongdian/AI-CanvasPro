/**
 * 音频处理工具模块
 * 使用 Web Audio API 实现音频加载、混合、转换、导出
 */

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContext();
  }
  // 如果被浏览器暂停（如用户未交互），尝试恢复
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {
      // 静默失败，用户交互后会自动恢复
    });
  }
  return sharedAudioContext;
}

/** 清理 AudioContext（组件卸载时调用以避免资源泄漏） */
export function closeAudioContext(): void {
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    sharedAudioContext.close().catch(() => {});
    sharedAudioContext = null;
  }
}

/**
 * 将 URL 或 Blob 加载为 AudioBuffer
 */
export async function loadAudioBuffer(source: string | Blob): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  let arrayBuffer: ArrayBuffer;

  if (typeof source === 'string') {
    const response = await fetch(source);
    arrayBuffer = await response.arrayBuffer();
  } else {
    arrayBuffer = await source.arrayBuffer();
  }

  return ctx.decodeAudioData(arrayBuffer);
}

/**
 * 混合多条音轨，支持起始时间和独立音量
 */
export async function mixAudioTracks(
  tracks: Array<{ buffer: AudioBuffer; startTime: number; volume?: number }>,
  totalDuration: number,
  sampleRate: number = 44100,
): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(totalDuration * sampleRate),
    sampleRate,
  });

  for (const track of tracks) {
    const source = offlineCtx.createBufferSource();
    source.buffer = track.buffer;

    const gain = offlineCtx.createGain();
    gain.gain.value = track.volume ?? 1.0;

    source.connect(gain).connect(offlineCtx.destination);
    source.start(track.startTime);
  }

  return offlineCtx.startRendering();
}

/**
 * 将 AudioBuffer 编码为 WAV 格式 Blob
 */
export function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = audioBuffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // 交错写入各声道数据
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * 将 AudioBuffer 导出为可下载的 Blob
 */
export function audioBufferToExportable(audioBuffer: AudioBuffer, _format: 'wav' | 'mp3' = 'wav'): Blob {
  // 浏览器原生不支持 MP3 编码，默认输出 WAV
  return audioBufferToWav(audioBuffer);
}

/**
 * 下载音频 Blob 为文件
 */
export function downloadAudio(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 生成指定时长的静音 AudioBuffer
 */
export function generateSilence(duration: number, sampleRate: number = 44100): AudioBuffer {
  const ctx = getAudioContext();
  const length = Math.ceil(duration * sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  // 默认 Float32Array 初始化为 0，已是静音
  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
