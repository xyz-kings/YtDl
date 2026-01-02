const express = require('express');
const axios = require('axios');
const cors = require('cors');
const ytdl = require('ytdl-core');
const mime = require('mime-types');

const app = express();

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

// ===== UTIL CLASS =====
class YouTubeDownloader {
  async extractVideoId(input) {
    const regex =
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)?([a-zA-Z0-9_-]{11})/;
    const match = input.match(regex);
    if (!match) throw new Error('Invalid YouTube URL or ID');
    return match[1];
  }

  async getVideoInfo(videoId) {
    return await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
  }

  formatBytes(bytes) {
    if (!bytes) return 'Unknown';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
  }

  formatResponse(info) {
    const video = info.videoDetails;

    const formats = info.formats
      .filter(f => f.hasAudio)
      .map(f => ({
        itag: f.itag,
        quality: f.qualityLabel || 'audio',
        format: f.container || 'mp4',
        fps: f.fps || null,
        bitrate: f.audioBitrate ? `${f.audioBitrate}kbps` : null,
        size: f.contentLength
          ? this.formatBytes(Number(f.contentLength))
          : 'Unknown',
        downloadUrl: `/api/download/${video.videoId}?itag=${f.itag}`
      }))
      .slice(0, 10);

    return {
      status: 'success',
      data: {
        video: {
          id: video.videoId,
          title: video.title,
          duration: Number(video.lengthSeconds),
          thumbnail: video.thumbnails.at(-1)?.url,
          author: {
            name: video.author.name,
            channelUrl: video.author.channel_url
          }
        },
        formats
      }
    };
  }
}

const downloader = new YouTubeDownloader();

// ===== ROUTES =====
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    name: 'YT Downloader API',
    endpoint: '/api/ytdl?link=YOUTUBE_URL'
  });
});

app.get('/api/ytdl', async (req, res) => {
  try {
    const { link } = req.query;
    if (!link) {
      return res.status(400).json({
        status: 'error',
        message: 'link parameter required'
      });
    }

    const videoId = await downloader.extractVideoId(link);
    const info = await downloader.getVideoInfo(videoId);
    const result = downloader.formatResponse(info);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(result);
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

app.get('/api/download/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { itag } = req.query;

    if (!videoId || videoId.length !== 11) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid video ID'
      });
    }

    const info = await ytdl.getInfo(videoId);
    const format = itag
      ? ytdl.chooseFormat(info.formats, { quality: itag })
      : ytdl.chooseFormat(info.formats, { quality: 'highest' });

    if (!format) {
      return res.status(404).json({
        status: 'error',
        message: 'Format not found'
      });
    }

    const ext = format.container || 'mp4';
    const mimeType = mime.lookup(ext) || 'video/mp4';
    const filename = `${info.videoDetails.title.replace(/[^\w\s]/gi, '')}.${ext}`;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    ytdl(videoId, { format }).pipe(res);
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime()
  });
});

// ===== 404 =====
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found'
  });
});

// ===== EXPORT FOR VERCEL (INI KUNCI NYA) =====
module.exports = (req, res) => {
  app(req, res);
};