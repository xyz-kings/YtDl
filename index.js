const express = require('express');
const axios = require('axios');
const cors = require('cors');
const ytdl = require('ytdl-core');
const cheerio = require('cheerio');
const mime = require('mime-types');
const { exec } = require('child_process');
const util = require('util');

const app = express();
const execAsync = util.promisify(exec);

// Configuration
const PORT = process.env.PORT || 3000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Middleware
app.use(cors());
app.use(express.json());

// Utility Functions
class YouTubeDownloader {
    constructor() {
        this.sources = ['ytdl-core', 'external-api-1', 'external-api-2'];
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

    async getVideoInfoFromExternalAPI(videoId, apiType = 1) {
        const apis = [
            {
                url: 'https://www.youtube.com/youtubei/v1/player',
                params: {
                    key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
                },
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
                }
            },
            {
                url: 'https://youtubei.googleapis.com/youtubei/v1/player',
                params: {
                    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w'
                },
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
            const response = await axios.post(
                apiConfig.url,
                apiConfig.data,
                {
                    params: apiConfig.params,
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            console.log(`External API ${apiType} failed: ${error.message}`);
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

            if (initial.data?.token) {
                const videoResponse = await axios.get(
                    `https://d.ymcdn.org/api/v1/video?url=https://www.youtube.com/watch?v=${videoId}&token=${initial.data.token}`,
                    { headers }
                );
                return videoResponse.data;
            }
        } catch (error) {
            console.log('DYMCDN failed:', error.message);
            return null;
        }
    }

    async getVideoInfo(videoId) {
        // Try ytdl-core first
        try {
            return await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
        } catch (error) {
            console.log('ytdl-core failed, trying external APIs...');
        }

        // Try external APIs
        for (let i = 1; i <= 2; i++) {
            try {
                const info = await this.getVideoInfoFromExternalAPI(videoId, i);
                if (info) return info;
            } catch (error) {
                continue;
            }
        }

        // Try DYMCDN as last resort
        return await this.getVideoInfoFromDYMCDN(videoId);
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return 'Unknown';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async formatResponse(videoInfo, videoId) {
        // Default video data structure
        let videoData = {
            id: videoId,
            title: 'Unknown Title',
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

        let formats = [];

        // Parse based on response type
        if (videoInfo?.videoDetails) {
            // ytdl-core response
            const details = videoInfo.videoDetails;
            videoData = {
                id: details.videoId,
                title: details.title,
                description: details.description || '',
                duration: parseInt(details.lengthSeconds) || 0,
                uploadDate: details.uploadDate || videoData.uploadDate,
                thumbnail: details.thumbnails?.[0]?.url || videoData.thumbnail,
                author: {
                    name: details.author?.name || 'Unknown',
                    channelId: details.author?.id || '',
                    profileUrl: details.author?.channel_url || 
                               `https://www.youtube.com/@${details.author?.name?.replace(/\s+/g, '') || 'Unknown'}`
                }
            };

            // Get available formats
            if (videoInfo.formats) {
                formats = videoInfo.formats
                    .filter(f => f.qualityLabel || f.audioQuality)
                    .map(f => ({
                        quality: f.qualityLabel || 'audio',
                        format: f.container || 'mp4',
                        fps: f.fps || null,
                        bitrate: f.audioBitrate ? `${Math.round(f.audioBitrate / 1000)}kbps` : null,
                        size: f.contentLength ? this.formatBytes(parseInt(f.contentLength)) : 'Unknown',
                        downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?itag=${f.itag}`
                    }));
            }
        } else if (videoInfo?.streamingData?.formats) {
            // YouTube API response
            const details = videoInfo.videoDetails || {};
            videoData = {
                id: videoId,
                title: details.title || 'Unknown Title',
                description: details.shortDescription || '',
                duration: Math.floor(details.lengthSeconds || 0),
                uploadDate: details.publishDate?.split('T')[0] || videoData.uploadDate,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                author: {
                    name: details.author || 'Unknown',
                    channelId: details.channelId || '',
                    profileUrl: `https://www.youtube.com/channel/${details.channelId || ''}`
                }
            };

            // Get formats from streamingData
            const allFormats = [
                ...(videoInfo.streamingData.formats || []),
                ...(videoInfo.streamingData.adaptiveFormats || [])
            ];

            formats = allFormats
                .filter(f => f.url || f.cipher)
                .map(f => ({
                    quality: f.qualityLabel || (f.height ? `${f.height}p` : 'audio'),
                    format: f.mimeType?.split('/')[1]?.split(';')[0] || 'mp4',
                    fps: f.fps || null,
                    bitrate: f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : null,
                    size: f.contentLength ? this.formatBytes(parseInt(f.contentLength)) : 'Unknown',
                    downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?itag=${f.itag}`
                }));
        } else if (videoInfo?.formats) {
            // DYMCDN or similar response
            videoData = {
                id: videoId,
                title: videoInfo.title || 'Unknown Title',
                description: videoInfo.description || '',
                duration: videoInfo.duration || 0,
                uploadDate: videoInfo.upload_date || videoData.uploadDate,
                thumbnail: videoInfo.thumbnail || videoData.thumbnail,
                author: {
                    name: videoInfo.channel || videoInfo.uploader || 'Unknown',
                    channelId: videoInfo.channel_id || '',
                    profileUrl: videoInfo.channel_url || ''
                }
            };

            formats = videoInfo.formats
                .filter(f => f.url)
                .map(f => ({
                    quality: f.format_note || (f.height ? `${f.height}p` : 'audio'),
                    format: f.ext || 'mp4',
                    fps: f.fps || null,
                    bitrate: f.abr ? `${f.abr}kbps` : null,
                    size: f.filesize ? this.formatBytes(f.filesize) : 'Unknown',
                    downloadUrl: f.url || `https://xdown-yt.vercel.app/api/download/${videoId}?format=${f.format_id}`
                }));
        }

        // If no formats found, create default ones
        if (formats.length === 0) {
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
                    downloadUrl: `https://xdown-yt.vercel.app/api/download/${videoId}?quality=audio`
                }
            ];
        }

        // Remove duplicates and sort
        const uniqueFormats = Array.from(
            new Map(formats.map(item => [item.quality + item.format, item])).values()
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
                formats: uniqueFormats.slice(0, 10) // Limit to 10 formats
            }
        };
    }
}

// Initialize downloader
const downloader = new YouTubeDownloader();

// Routes
app.get('/', (req, res) => {
    res.json({
        status: "online",
        message: "YouTube Downloader API - DarkForge-X Edition",
        version: "2.0.0",
        endpoints: {
            documentation: "GET /",
            download_info: "GET /api/ytdl?link=YOUTUBE_URL_OR_ID",
            direct_download: "GET /api/download/:videoId?quality=QUALITY&itag=ITAG"
        },
        usage: {
            example: "https://xdown-yt.vercel.app/api/ytdl?link=https://youtu.be/dQw4w9WgXcQ",
            parameters: {
                link: "YouTube URL or Video ID (required)"
            }
        },
        features: [
            "Multiple source fallback",
            "Audio/video formats",
            "File size estimation",
            "CORS enabled"
        ]
    });
});

app.get('/api/ytdl', async (req, res) => {
    try {
        const { link } = req.query;
        
        if (!link) {
            return res.status(400).json({
                status: "error",
                message: "Missing 'link' parameter",
                example: "/api/ytdl?link=https://youtu.be/dQw4w9WgXcQ"
            });
        }

        // Extract video ID
        const videoId = await downloader.extractVideoId(link);
        
        // Get video info
        const videoInfo = await downloader.getVideoInfo(videoId);
        
        if (!videoInfo) {
            return res.status(404).json({
                status: "error",
                message: "Video not found or cannot be accessed",
                videoId: videoId
            });
        }

        // Format response
        const response = await downloader.formatResponse(videoInfo, videoId);
        
        // Cache for 1 hour
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json(response);

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            status: "error",
            message: error.message
        });
    }
});

app.get('/api/download/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const { quality, itag, format } = req.query;
        
        if (!videoId || videoId.length !== 11) {
            return res.status(400).json({
                status: "error",
                message: "Invalid video ID"
            });
        }

        // Get video info
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
        
        let selectedFormat;
        
        if (itag) {
            // Use specific itag if provided
            selectedFormat = ytdl.chooseFormat(info.formats, { quality: parseInt(itag) });
        } else if (quality) {
            // Filter by quality
            const availableFormats = info.formats.filter(f => {
                if (quality === 'audio') return f.hasAudio && !f.hasVideo;
                if (quality === 'video') return f.hasVideo && !f.hasAudio;
                return f.qualityLabel === quality;
            });
            
            selectedFormat = availableFormats[0] || ytdl.chooseFormat(info.formats, { quality: 'highest' });
        } else {
            // Default to highest quality with audio
            selectedFormat = ytdl.chooseFormat(info.formats, { 
                quality: 'highest',
                filter: 'audioandvideo'
            });
        }

        if (!selectedFormat) {
            return res.status(404).json({
                status: "error",
                message: "Requested format not available"
            });
        }

        // Set headers for download
        const mimeType = mime.lookup(selectedFormat.container || 'mp4') || 'video/mp4';
        const filename = `${info.videoDetails.title.replace(/[^\w\s-]/gi, '')}.${selectedFormat.container || 'mp4'}`;
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', selectedFormat.contentLength || '');
        
        // Stream the video
        ytdl(`https://www.youtube.com/watch?v=${videoId}`, {
            format: selectedFormat
        }).pipe(res);

    } catch (error) {
        console.error('Download Error:', error);
        res.status(500).json({
            status: "error",
            message: "Download failed: " + error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
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
            "GET /api/download/:videoId",
            "GET /health"
        ]
    });
});

// Export for Vercel
module.exports = app;

// Start server if running locally
if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`🚀 Server running on port ${port}`);
        console.log(`📚 API: http://localhost:${port}`);
        console.log(`🔄 Health: http://localhost:${port}/health`);
    });
}