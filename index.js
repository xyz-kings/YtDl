const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');

const app = express();
app.use(cors());
app.use(express.json());

// ===== USER AGENT (KUNCI NYA) =====
const agent = ytdl.createAgent({
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
  }
});

// ===== HELPER =====
async function extractVideoId(input) {
  if (ytdl.validateID(input)) return input;
  if (ytdl.validateURL(input)) return ytdl.getURLVideoID(input);
  throw new Error('Invalid YouTube link');
}

function formatBytes(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

// ===== ROUTE UTAMA =====
app.get('/api/xdown-yt', async (req, res) => {
  try {
    const { link } = req.query;
    if (!link) {
      return res.status(400).json({
        status: 'error',
        message: 'link parameter required'
      });
    }

    const videoId = await extractVideoId(link);

    // PAKAI AGENT (WAJIB)
    const info = await ytdl.getInfo(videoId, { agent });
    const v = info.videoDetails;

    const formatsRaw = info.formats.filter(f => f.hasAudio);

    const formats = [];
    const seen = new Set();

    for (const f of formatsRaw) {
      const quality = f.qualityLabel || 'audio';
      const format = f.container || 'mp4';
      const key = `${quality}-${format}`;

      if (seen.has(key)) continue;
      seen.add(key);

      formats.push({
        quality,
        format,
        fps: f.fps || null,
        bitrate: f.audioBitrate ? `${f.audioBitrate}kbps` : undefined,
        size: f.contentLength
          ? formatBytes(Number(f.contentLength))
          : 'Unknown',
        downloadUrl: `/api/download/${videoId}?itag=${f.itag}`
      });
    }

    formats.sort((a, b) => {
      if (a.quality === 'audio') return 1;
      if (b.quality === 'audio') return -1;
      return parseInt(b.quality) - parseInt(a.quality);
    });

    res.json({
      status: 'success',
      data: {
        video: {
          id: v.videoId,
          title: v.title,
          description: v.shortDescription || '',
          duration: Number(v.lengthSeconds),
          uploadDate: v.uploadDate || null,
          thumbnail: `https://i.ytimg.com/vi/${v.videoId}/maxresdefault.jpg`,
          author: {
            name: v.author.name,
            channelId: v.author.id,
            profileUrl: v.author.channel_url
          },
          formats: formats.slice(0, 10)
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

// ===== OPTIONAL DOWNLOAD (RAWAN TIMEOUT DI VERCEL) =====
app.get('/api/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { itag } = req.query;

    const info = await ytdl.getInfo(id, { agent });
    const format = ytdl.chooseFormat(info.formats, {
      quality: itag || 'highest'
    });

    if (!format) {
      return res.status(404).json({
        status: 'error',
        message: 'Format not found'
      });
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${info.videoDetails.title.replace(/[^\w\s]/gi, '')}.${format.container || 'mp4'}"`
    );

    ytdl(id, { format, agent }).pipe(res);
  } catch (e) {
    res.status(500).json({
      status: 'error',
      message: e.message
    });
  }
});

// ===== EXPORT VERCEL =====
module.exports = (req, res) => {
  app(req, res);
};