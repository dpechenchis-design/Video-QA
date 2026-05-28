// api/extract-audio.js — витягування аудіо з відео (файл або URL)
export const config = { api: { bodyParser: { sizeLimit: '500mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { fileBase64, filename, url } = req.body;

  try {
    let videoBuffer;

    if (fileBase64) {
      videoBuffer = Buffer.from(fileBase64, 'base64');
    } else if (url) {
      const directUrl = resolveUrl(url);
      const response = await fetch(directUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EGA-QA/1.0)' },
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(getDownloadHint(url, response.status));
      const sizeMB = parseInt(response.headers.get('content-length') || '0') / 1024 / 1024;
      if (sizeMB > 150) throw new Error(`Файл ${Math.round(sizeMB)}MB — перевищує ліміт 150MB`);
      videoBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      throw new Error('Потрібен файл або URL');
    }

    const videoMeta = await getVideoMeta(videoBuffer);
    const audioBase64 = await extractAudio(videoBuffer);
    return res.status(200).json({ ok: true, audioBase64, videoMeta });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function resolveUrl(url) {
  const gdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (gdMatch) return `https://drive.google.com/uc?export=download&id=${gdMatch[1]}&confirm=t`;
  const gdOpen = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (gdOpen) return `https://drive.google.com/uc?export=download&id=${gdOpen[1]}&confirm=t`;
  return url;
}

function getDownloadHint(url, status) {
  if (url.includes('frame.io')) return `Frame.io (${status}): використай Share Link → Copy Link, не Project посилання.`;
  if (url.includes('drive.google')) return `Google Drive (${status}): файл має бути відкритий для всіх хто має посилання.`;
  return `Не вдалось завантажити відео (HTTP ${status}).`;
}

async function extractAudio(videoBuffer) {
  try {
    const { spawnSync } = await import('child_process');
    const { writeFileSync, readFileSync, unlinkSync, existsSync } = await import('fs');
    const { tmpdir } = await import('os');
    const path = await import('path');
    const id = Date.now();
    const tmpIn = path.join(tmpdir(), `qa_in_${id}.mp4`);
    const tmpOut = path.join(tmpdir(), `qa_out_${id}.mp3`);
    writeFileSync(tmpIn, videoBuffer);
    spawnSync('ffmpeg', ['-i', tmpIn, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-b:a', '64k', '-t', '1800', '-y', tmpOut], { timeout: 90000 });
    if (!existsSync(tmpOut)) throw new Error('FFmpeg недоступний');
    const buf = readFileSync(tmpOut);
    try { unlinkSync(tmpIn); unlinkSync(tmpOut); } catch {}
    return buf.toString('base64');
  } catch {
    return videoBuffer.slice(0, 8 * 1024 * 1024).toString('base64');
  }
}

async function getVideoMeta(videoBuffer) {
  try {
    const { execSync } = await import('child_process');
    const { writeFileSync, unlinkSync } = await import('fs');
    const { tmpdir } = await import('os');
    const path = await import('path');
    const tmp = path.join(tmpdir(), `qa_meta_${Date.now()}.mp4`);
    writeFileSync(tmp, videoBuffer);
    const out = execSync(`ffprobe -v quiet -print_format json -show_format -show_streams "${tmp}" 2>/dev/null`, { timeout: 15000 }).toString();
    try { unlinkSync(tmp); } catch {}
    const data = JSON.parse(out);
    const fmt = data.format || {};
    const vs = (data.streams || []).find(s => s.codec_type === 'video') || {};
    const dur = parseFloat(fmt.duration || '0');
    const w = vs.width || 0; const h = vs.height || 0;
    const [fn, fd] = (vs.r_frame_rate || '30/1').split('/');
    return {
      duration: dur,
      durationStr: `${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}`,
      width: w, height: h,
      resolution: w && h ? `${w}×${h}` : 'невідомо',
      fps: Math.round(parseInt(fn) / parseInt(fd)),
      orientation: h > w ? '9:16' : '16:9',
      sizeMB: Math.round(videoBuffer.length / 1024 / 1024),
    };
  } catch {
    return { durationStr: '??:??', resolution: 'невідомо', fps: 30, orientation: 'невідомо', sizeMB: Math.round(videoBuffer.length / 1024 / 1024) };
  }
}
