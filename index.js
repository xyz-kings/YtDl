const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');

const app = express();
app.use(cors());
app.use(express.json());

// ===== USER AGENT =====
const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

// ===== HELPER =====
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

    // ===== INIT TOKEN DYMCDN =====
    const initReq = await fetch(
      `https://d.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`,
      { headers }
    );
    const init = await initReq.json();

    if (!init?.token) {
      throw new Error('Failed to get DYMCDN token');
    }

    // ===== FETCH VIDEO DATA =====
    const videoReq = await fetch(
      `https://d.ymcdn.org/api/v1/video?url=${encodeURIComponent(
        link
      )}&token=${init.token}`,
      { headers }
    );
    const data = await videoReq.json();

    if (!data?.id) {
      throw new Error('Failed to fetch video info');
    }

    // ===== FORMAT RESPONSE =====
    const formats = (data.formats || [])
      .filter(f => f.url)
      .map(f => ({
        quality: f.format_note || (f.height ? `${f.height}p` : 'audio'),
        format: f.ext || 'mp4',
        fps: f.fps || null,
        bitrate: f.abr ? `${f.abr}kbps` : undefined,
        size: f.filesize ? formatBytes(f.filesize) : 'Unknown',
        downloadUrl: `/api/download/${data.id}?itag=${f.format_id}`
      }))
      .slice(0, 10);

    res.json({
      status: 'success',
      data: {
        video: {
          id: data.id,
          title: data.title,
          description: data.description || '',
          duration: data.duration || 0,
          uploadDate: data.upload_date || null,
          thumbnail:
            data.thumbnail ||
            `https://i.ytimg.com/vi/${data.id}/maxresdefault.jpg`,
          author: {
            name: data.channel || data.uploader || 'Unknown',
            channelId: data.channel_id || '',
            profileUrl: data.channel_url || ''
          },
          formats
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

// ===== DOWNLOAD (YTDL ONLY DI SINI) =====
app.get('/api/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { itag } = req.query;

    if (!ytdl.validateID(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid video ID'
      });
    }

    const info = await ytdl.getInfo(id, {
      requestOptions: { headers }
    });

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
      `attachment; filename="${info.videoDetails.title.replace(
        /[^\w\s]/gi,
        ''
      )}.${format.container || 'mp4'}"`
    );

    ytdl(id, { format, requestOptions: { headers } }).pipe(res);
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

// ===== EXPORT VERCEL =====
module.exports = (req, res) => {
  app(req, res);
};