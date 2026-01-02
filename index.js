const express = require('express');
const axios = require('axios');
const cors = require('cors');
const ytdl = require('ytdl-core');
const cheerio = require('cheerio');
const mime = require('mime-types');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const app = express();

// Konfigurasi
const PORT = process.env.PORT || 3000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Middleware
app.use(cors());
app.use(express.json());

// Utility Functions
class YouTubeDownloader {
    constructor() {
        this.sources = [
            'ytdl-core',
            'youtube-dl',
            'external-api-1',
            'external-api-2'
        ];
    }

    async extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        throw new Error('Invalid YouTube URL or ID');
    }

    async getVideoInfoFromYouTubeDL(videoId) {
        try {
            // Menggunakan yt-dlp melalui exec
            const { stdout } = await execAsync(`yt-dlp -j https://www.youtube.com/watch?v=${videoId}`);
            return JSON.parse(stdout);
        } catch (error) {
            console.error('YouTube-DL Error:', error.message);
            return null;
        }
    }

    async getVideoInfoFromExternalAPI(videoId, apiType = 1) {
        const apis = [
            {
                url: `https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`,
                method: 'POST',
                data: {
                    context: {
                        client: {
                            clientName: 'WEB',
                            clientVersion: '2.20231219.06.00',
                            hl: 'en',
                            gl: 'US'
                        }
                    },
                    videoId: videoId
                },
                headers: {
                    'User-Agent': USER_AGENT,
                    'Content-Type': 'application/json'
                }
            },
            {
                url: `https://youtubei.googleapis.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w`,
                method: 'POST',
                data: {
                    context: {
                        client: {
                            clientName: 'ANDROID',
                            clientVersion: '19.05.36',
                            androidSdkVersion: 33
                        }
                    },
                    videoId: videoId
                }
            }
        ];

        try {
            const apiConfig = apis[apiType - 1];
            const response = await axios({
                method: apiConfig.method,
                url: apiConfig.url,
                data: apiConfig.data,
                headers: apiConfig.headers || {
                    'User-Agent': USER_AGENT,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            console.error(`External API ${apiType} Error:`, error.message);
            return null;
        }
    }

    async getVideoInfoFromDYMCDN(videoId) {
        try {
            const timestamp = Date.now();
            const headers = {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json',
                'Referer': 'https://d.ymcdn.org/'
            };
            
            const initial = await axios.get(
                `https://d.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${timestamp}`,
                { headers }
            );

            if (initial.data && initial.data.token) {
                const token = initial.data.token;
                const videoResponse = await axios.get(
                    `https://d.ymcdn.org/api/v1/video?url=https://www.youtube.com/watch?v=${videoId}&token=${token}`,
                    { headers }
                );
                return videoResponse.data;
            }
        } catch (error) {
            console.error('DYMCDN Error:', error.message);
            return null;
        }
    }

    async getVideoInfo(videoId) {
        let videoInfo = null;
        
        // Coba semua sources berurutan
        for (const source of this.sources) {
            try {
                switch(source) {
                    case 'ytdl-core':
                        videoInfo = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
                        break;
                    case 'youtube-dl':
                        videoInfo = await this.getVideoInfoFromYouTubeDL(videoId);
                        break;
                    case 'external-api-1':
                        videoInfo = await this.getVideoInfoFromExternalAPI(videoId, 1);
                        break;
                    case 'external-api-2':
                        videoInfo = await this.getVideoInfoFromExternalAPI(videoId, 2);
                        break;
                }
                
                if (videoInfo) break;
            } catch (error) {
                console.log(`Source ${source} failed:`, error.message);
                continue;
            }
        }

        if (!videoInfo) {
            // Fallback ke DYMCDN
            videoInfo = await this.getVideoInfoFromDYMCDN(videoId);
        }

        return videoInfo;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
    }

    parseDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    async formatResponse(videoInfo, videoId) {
        let formats = [];
        let videoData = {};

        if (videoInfo.videoDetails) {
            // Format ytdl-core
            videoData = {
                id: videoInfo.videoDetails.videoId,
                title: videoInfo.videoDetails.title,
                description: videoInfo.videoDetails.description || '',
                duration: parseInt(videoInfo.videoDetails.lengthSeconds),
                uploadDate: videoInfo.videoDetails.uploadDate || new Date().toISOString().split('T')[0],
                thumbnail: videoInfo.videoDetails.thumbnails[0]?.url || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                author: {
                    name: videoInfo.videoDetails.author.name,
                    channelId: videoInfo.videoDetails.author.id,
                    profileUrl: `https://www.youtube.com/@${videoInfo.videoDetails.author.name.replace(/\s+/g, '')}`
                }
            };

            // Format video formats
            formats = videoInfo.formats
                .filter(format => format.qualityLabel || format.audioQuality)
                .map(format => ({
                    quality: format.qualityLabel || 'audio',
                    format: format.container || 'mp4',
                    fps: format.fps || null,
                    bitrate: format.audioBitrate ? `${Math.round(format.audioBitrate / 1000)}kbps` : null,
                    size: format.contentLength ? this.formatBytes(parseInt(format.contentLength)) : 'Unknown',
                    downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?quality=${format.qualityLabel || 'audio'}&format=${format.container || 'mp4'}`
                }))
                .filter((value, index, self) => 
                    index === self.findIndex((t) => (
                        t.quality === value.quality && t.format === value.format
                    ))
                );

        } else if (videoInfo.formats) {
            // Format external API
            videoData = {
                id: videoId,
                title: videoInfo.title || 'Unknown Title',
                description: videoInfo.description || '',
                duration: videoInfo.duration || 0,
                uploadDate: videoInfo.upload_date || new Date().toISOString().split('T')[0],
                thumbnail: videoInfo.thumbnail || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                author: {
                    name: videoInfo.channel || videoInfo.uploader || 'Unknown',
                    channelId: videoInfo.channel_id || '',
                    profileUrl: videoInfo.channel_url || ''
                }
            };

            formats = videoInfo.formats
                .filter(f => f.url || f.fragment_base_url)
                .map(f => ({
                    quality: f.format_note || (f.height ? `${f.height}p` : 'audio'),
                    format: f.ext || 'mp4',
                    fps: f.fps || null,
                    bitrate: f.abr ? `${f.abr}kbps` : null,
                    size: f.filesize ? this.formatBytes(f.filesize) : 'Unknown',
                    downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?quality=${f.format_note || (f.height ? `${f.height}p` : 'audio')}&format=${f.ext || 'mp4'}`
                }));

        } else {
            // Fallback minimal format
            videoData = {
                id: videoId,
                title: 'Video Information Unavailable',
                description: '',
                duration: 0,
                uploadDate: new Date().toISOString().split('T')[0],
                thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                author: {
                    name: 'Unknown',
                    channelId: '',
                    profileUrl: ''
                }
            };

            // Default formats
            formats = [
                {
                    quality: '1080p',
                    format: 'mp4',
                    fps: 30,
                    size: '45MB',
                    downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?quality=1080p`
                },
                {
                    quality: '720p',
                    format: 'mp4',
                    fps: 30,
                    size: '25MB',
                    downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?quality=720p`
                },
                {
                    quality: 'audio',
                    format: 'mp3',
                    bitrate: '128kbps',
                    size: '4MB',
                    downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?quality=audio&format=mp3`
                }
            ];
        }

        // Remove duplicates and sort by quality
        const uniqueFormats = Array.from(
            new Map(formats.map(item => [item.quality, item])).values()
        ).sort((a, b) => {
            if (a.quality === 'audio') return 1;
            if (b.quality === 'audio') return -1;
            const aNum = parseInt(a.quality) || 0;
            const bNum = parseInt(b.quality) || 0;
            return bNum - aNum;
        });

        return {
            status: "success",
            data: {
                video: videoData,
                formats: uniqueFormats
            }
        };
    }
}

// Inisialisasi downloader
const downloader = new YouTubeDownloader();

// Routes
app.get('/', (req, res) => {
    res.json({
        status: "online",
        message: "YouTube Downloader API - DarkForge-X Edition",
        version: "2.0.0",
        endpoints: {
            api_documentation: "GET /",
            download_info: "GET /api/ytdl?link=YOUTUBE_URL_OR_ID",
            direct_download: "GET /api/download/:videoId?quality=QUALITY&format=FORMAT"
        },
        usage_example: {
            get_info: "https://xdown-yt.vercel.app/api/ytdl?link=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            parameters: {
                link: "YouTube URL or Video ID (required)"
            }
        },
        features: [
            "Multi-source video information extraction",
            "Multiple quality formats",
            "Audio extraction support",
            "Advanced error handling",
            "CORS enabled",
            "Vercel serverless optimized"
        ],
        note: "This API is for educational purposes only. Please respect YouTube's Terms of Service."
    });
});

app.get('/api/ytdl', async (req, res) => {
    try {
        const { link } = req.query;
        
        if (!link) {
            return res.status(400).json({
                status: "error",
                message: "Parameter 'link' is required",
                example: "/api/ytdl?link=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            });
        }

        console.log(`Processing request for: ${link}`);
        
        const videoId = await downloader.extractVideoId(link);
        console.log(`Extracted Video ID: ${videoId}`);
        
        const videoInfo = await downloader.getVideoInfo(videoId);
        
        if (!videoInfo) {
            return res.status(404).json({
                status: "error",
                message: "Could not retrieve video information from any source",
                videoId: videoId
            });
        }

        const response = await downloader.formatResponse(videoInfo, videoId);
        
        // Cache control
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json(response);

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            status: "error",
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.get('/api/download/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const { quality, format } = req.query;
        
        if (!videoId) {
            return res.status(400).json({
                status: "error",
                message: "Video ID is required"
            });
        }

        const videoInfo = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
        
        let formatToDownload;
        if (quality && format) {
            formatToDownload = videoInfo.formats.find(f => 
                (f.qualityLabel === quality || f.audioQuality) && 
                f.container === format
            );
        } else if (quality) {
            formatToDownload = videoInfo.formats.find(f => 
                f.qualityLabel === quality || f.audioQuality
            );
        } else {
            // Default to highest quality video with audio
            formatToDownload = ytdl.chooseFormat(videoInfo.formats, { 
                quality: 'highest',
                filter: 'audioandvideo' 
            });
        }

        if (!formatToDownload) {
            return res.status(404).json({
                status: "error",
                message: "Requested format not available"
            });
        }

        const mimeType = mime.lookup(formatToDownload.container || 'mp4') || 'video/mp4';
        const filename = `${videoInfo.videoDetails.title.replace(/[^\w\s]/gi, '')}_${quality || 'download'}.${formatToDownload.container || 'mp4'}`;
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        
        ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
            format: formatToDownload,
            quality: quality || 'highest'
        }).pipe(res);

    } catch (error) {
        console.error('Download Error:', error);
        res.status(500).json({
            status: "error",
            message: "Download failed",
            error: error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global Error:', err);
    res.status(500).json({
        status: "error",
        message: "Internal server error",
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        status: "error",
        message: "Endpoint not found",
        available_endpoints: [
            "GET /",
            "GET /api/ytdl?link=YOUTUBE_URL",
            "GET /api/download/:videoId"
        ]
    });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 YouTube Downloader API running on port ${PORT}`);
        console.log(`📚 Documentation: http://localhost:${PORT}`);
        console.log(`🔧 Mode: ${process.env.NODE_ENV || 'development'}`);
    });
}

module.exports = app;
