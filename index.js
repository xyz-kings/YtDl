const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');

const app = express();
app.use(cors());
app.use(express.json());

// ===== HELPER =====
async function extractVideoId(input) {
  // langsung ID
  if (ytdl.validateID(input)) return input;

  // semua URL YouTube (shorts, embed, youtu.be, mobile, ada ?si dll)
  if (ytdl.validateURL(input)) {
    return ytdl.getURLVideoID(input);
  }

  throw new Error('Invalid YouTube link');
}

function formatBytes(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

// ===== ROUTE =====
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

    // AMAN: jangan pakai full URL
    const info = await ytdl.getInfo(videoId);
    const v = info.videoDetails;

    // FORMAT
    const formats = info.formats
      .filter(f => f.hasAudio)
      .map(f => ({
        quality: f.qualityLabel || 'audio',
        format: f.container || (f.mimeType?.includes('audio') ? 'mp3' : 'mp4'),
        fps: f.fps || null,
        bitrate: f.audioBitrate ? `${f.audioBitrate}kbps` : undefined,
        size: f.contentLength
          ? formatBytes(Number(f.contentLength))
          : 'Unknown',
        downloadUrl: `/api/download/${videoId}?itag=${f.itag}`
      }));

    // bersihin duplikat + rapihin
    const uniq = [];
    const map = new Set();

    for (const f of formats) {
      const key = `${f.quality}-${f.format}`;
      if (!map.has(key)) {
        map.add(key);
        uniq.push(f);
      }
    }

    uniq.sort((a, b) => {
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
          formats: uniq.slice(0, 10)
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

// ===== OPTIONAL DOWNLOAD (HATI2 TIMEOUT) =====
app.get('/api/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { itag } = req.query;

    const info = await ytdl.getInfo(id);
    const format = ytdl.chooseFormat(info.formats, {
      quality: itag || 'highest'
    });

    if (!format) {
      return res.status(404).json({ status: 'error', message: 'Format not found' });
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${info.videoDetails.title.replace(/[^\w\s]/gi, '')}.${format.container || 'mp4'}"`
    );

    ytdl(id, { format }).pipe(res);
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ===== EXPORT VERCEL =====
module.exports = (req, res) => {
  app(req, res);
};