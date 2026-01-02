const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');

const app = express();
app.use(cors());
app.use(express.json());

// ===== USER AGENT =====
const REQUEST_OPTIONS = {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
  }
};

// ===== HELPER =====
function extractVideoId(input) {
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

// ===== MAIN API =====
app.get('/api/xdown-yt', async (req, res) => {
  try {
    const { link } = req.query;
    if (!link) {
      return res.status(400).json({
        status: 'error',
        message: 'link parameter required'
      });
    }

    const videoId = extractVideoId(link);

    // 🔥 PALING AMAN DI VERCEL
    const info = await ytdl.getInfo(videoId, {
      requestOptions: REQUEST_OPTIONS
    });

    const v = info.videoDetails;

    const formats = [];
    const seen = new Set();

    for (const f of info.formats) {
      if (!f.hasAudio) continue;

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

// ===== EXPORT FOR VERCEL =====
module.exports = (req, res) => {
  app(req, res);
};