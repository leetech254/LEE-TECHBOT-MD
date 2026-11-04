const { ttdl } = require("ruhend-scraper");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Store processed message IDs to prevent duplicates
const processedMessages = new Set();

async function tiktokCommand(sock, chatId, message) {
    let tempVideoPath = null;
    let tempAudioPath = null;
    const BOT_NAME = "𝗟𝗘𝗘 𝗧𝗘𝗖𝗛𝗕𝗼𝘁 𝗠𝗗"; // Updated Bot Name

    try {
        // Check if message has already been processed
        if (processedMessages.has(message.key.id)) {
            return;
        }
        
        // Add message ID to processed set
        processedMessages.add(message.key.id);
        
        // Clean up old message IDs after 5 minutes
        setTimeout(() => {
            processedMessages.delete(message.key.id);
        }, 5 * 60 * 1000);

        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        
        if (!text) {
            return await sock.sendMessage(chatId, { text: "Please provide a TikTok link for the video." });
        }

        // Extract URL from command
        const url = text.split(' ').slice(1).join(' ').trim();
        
        if (!url) {
            return await sock.sendMessage(chatId, { text: "Please provide a TikTok link for the video." });
        }

        // Check for various TikTok URL formats
        const tiktokPatterns = [
            /https?:\/\/(?:www\.)?tiktok\.com\//,
            /https?:\/\/(?:vm\.)?tiktok\.com\//,
            /https?:\/\/(?:vt\.)?tiktok\.com\//,
            /https?:\/\/(?:www\.)?tiktok\.com\/@/,
            /https?:\/\/(?:www\.)?tiktok\.com\/t\//
        ];

        const isValidUrl = tiktokPatterns.some(pattern => pattern.test(url));
        
        if (!isValidUrl) {
            return await sock.sendMessage(chatId, { text: "That is not a valid TikTok link. Please provide a valid TikTok video link." });
        }

        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });

        let videoUrl = null;
        let audioUrl = null;
        let title = "TikTok Video";
        let isCarousel = false; // Flag for photo slides
        let carouselMedia = [];

        // 1. Try Siputzx API first
        try {
            const apiUrl = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`;
            const response = await axios.get(apiUrl, { 
                timeout: 15000,
                headers: {
                    'accept': '*/*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            });
            
            if (response.data && response.data.status && response.data.data) {
                const data = response.data.data;
                title = data.metadata?.title || "TikTok Video";

                if (data.urls && Array.isArray(data.urls) && data.urls.length > 0) {
                    videoUrl = data.urls[0];
                } else if (data.video_url) {
                    videoUrl = data.video_url;
                } else if (data.url) {
                    videoUrl = data.url;
                } else if (data.download_url) {
                    videoUrl = data.download_url;
                }

                if (data.audio_url) {
                    audioUrl = data.audio_url;
                }
            }
        } catch (apiError) {
            console.error(`Siputzx API failed: ${apiError.message}`);
        }

        // 2. If Siputzx API didn't work, try the original ttdl method
        if (!videoUrl) {
            try {
                let downloadData = await ttdl(url);
                if (downloadData && downloadData.data && downloadData.data.length > 0) {
                    const mediaData = downloadData.data;
                    
                    // Check if it's a video or photo carousel
                    const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(mediaData[0].url) || mediaData[0].type === 'video';

                    if (isVideo) {
                        videoUrl = mediaData[0].url;
                    } else {
                        // It's a photo carousel
                        isCarousel = true;
                        carouselMedia = mediaData;
                    }
                }
            } catch (ttdlError) {
                console.error("ttdl fallback also failed:", ttdlError.message);
            }
        }

        // Prepare Temp Directory for robust downloading
        const tmpDir = require('../lib/runtime').TMP_DIR;
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const caption = `𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 ${BOT_NAME}\n\n📝 Title: ${title}`;

        // --- HANDLE PHOTO CAROUSELS (Slideshows) ---
        if (isCarousel && carouselMedia.length > 0) {
            for (let i = 0; i < Math.min(20, carouselMedia.length); i++) {
                await sock.sendMessage(chatId, {
                    image: { url: carouselMedia[i].url },
                    caption: caption
                }, { quoted: message });
            }
            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return; // Exit after sending photos
        }

        // --- HANDLE SINGLE VIDEO DOWNLOAD (Stream to Disk) ---
        if (videoUrl) {
            tempVideoPath = path.join(tmpDir, `tt_vid_${Date.now()}.mp4`);
            const writer = fs.createWriteStream(tempVideoPath);
            
            const videoResponse = await axios({
                method: 'get',
                url: videoUrl,
                responseType: 'stream',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'video/mp4,video/*,*/*;q=0.9',
                    'Referer': 'https://www.tiktok.com/'
                }
            });

            videoResponse.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('close', resolve);
                writer.on('error', reject);
            });

            // Send Video from Disk (RAM Safe)
            await sock.sendMessage(chatId, {
                video: { url: tempVideoPath },
                mimetype: "video/mp4",
                caption: caption
            }, { quoted: message });

            // --- HANDLE AUDIO DOWNLOAD (If available) ---
            if (audioUrl) {
                try {
                    tempAudioPath = path.join(tmpDir, `tt_aud_${Date.now()}.mp3`);
                    const audioWriter = fs.createWriteStream(tempAudioPath);
                    
                    const audioResponse = await axios({
                        method: 'get',
                        url: audioUrl,
                        responseType: 'stream',
                        timeout: 30000
                    });

                    audioResponse.data.pipe(audioWriter);
                    
                    await new Promise((resolve, reject) => {
                        audioWriter.on('close', resolve);
                        audioWriter.on('error', reject);
                    });

                    await sock.sendMessage(chatId, {
                        audio: { url: tempAudioPath },
                        mimetype: "audio/mp4", // Standard for Baileys voice/audio
                        caption: "🎵 Audio from TikTok"
                    }, { quoted: message });
                } catch (audioError) {
                    console.error(`Failed to download audio: ${audioError.message}`);
                }
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
            return;
        }

        // If we reach here, no video or carousel was found
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        return await sock.sendMessage(chatId, { 
            text: "❌ Failed to download TikTok video. All download methods failed. Please try again with a different link."
        }, { quoted: message });

    } catch (error) {
        console.error('Error in TikTok command:', error);
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, { 
            text: "An error occurred while processing the request. Please try again later."
        }, { quoted: message });
    } finally {
        // ALWAYS clean up temp files to prevent server storage from filling up
        if (tempVideoPath && fs.existsSync(tempVideoPath)) {
            try { fs.unlinkSync(tempVideoPath); } catch (e) { console.error("Error deleting video temp:", e); }
        }
        if (tempAudioPath && fs.existsSync(tempAudioPath)) {
            try { fs.unlinkSync(tempAudioPath); } catch (e) { console.error("Error deleting audio temp:", e); }
        }
    }
}

module.exports = tiktokCommand;