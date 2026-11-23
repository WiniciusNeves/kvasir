import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';

const PROGRESS_STEP = 10;

// The folder people look in for a downloaded file; the current folder when there is none.
export function downloadsDir(): string {
  const downloads = path.join(os.homedir(), 'Downloads');
  return fs.existsSync(downloads) ? downloads : process.cwd();
}

// Streams `url` to `destination` with the progress on one line. Writes to a .part file first, so an
// interrupted download never leaves something that looks like a finished file.
export async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download falhou: HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let shown = 0;
  const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
    if (total > 0 && percent >= shown + PROGRESS_STEP) {
      shown = percent - (percent % PROGRESS_STEP);
      process.stdout.write(`\r   ${shown}% de ${(total / 1024 / 1024).toFixed(1)} MB`);
    }
  });

  const partial = `${destination}.part`;
  try {
    await pipeline(body, fs.createWriteStream(partial));
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
  if (total > 0) process.stdout.write('\n');
  fs.renameSync(partial, destination);
}
