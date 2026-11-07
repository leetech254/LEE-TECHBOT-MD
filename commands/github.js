const moment = require('moment-timezone');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');


async function githubCommand(sock, chatId, message) {
  const repository = process.env.BOT_GITHUB_REPO || 'leetech254/LEE-TECHBOT-MD';
  const repositoryUrl = `https://github.com/${repository}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repository}`, {
      timeout: 8000,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LEE-TECH-BOT' },
    });
    if (!res.ok) throw new Error('Error fetching repository data');
    const json = await res.json();

    let txt = `*乂  LEE TECH BOT MD  乂*\n\n`;
    txt += `✩  *Name* : ${json.name}\n`;
    txt += `✩  *Watchers* : ${json.watchers_count}\n`;
    txt += `✩  *Size* : ${(json.size / 1024).toFixed(2)} MB\n`;
    txt += `✩  *Last Updated* : ${moment(json.updated_at).format('DD/MM/YY - HH:mm:ss')}\n`;
    txt += `✩  *URL* : ${json.html_url || repositoryUrl}\n`;
    txt += `✩  *Forks* : ${json.forks_count}\n`;
    txt += `✩  *Stars* : ${json.stargazers_count}\n\n`;
    txt += `💥 *LEE TECHBot MD*`;

    // Use the local asset image
    const imgPath = path.join(__dirname, '../assets/bot_image.jpg');
    try {
      const imgBuffer = fs.readFileSync(imgPath);
      await sock.sendMessage(chatId, { image: imgBuffer, caption: txt }, { quoted: message });
    } catch {
      await sock.sendMessage(chatId, { text: txt }, { quoted: message });
    }
  } catch (error) {
    await sock.sendMessage(chatId, {
      text: `❌ GitHub details are temporarily unavailable.\n\nRepository: ${repositoryUrl}`,
    }, { quoted: message });
  }
}

module.exports = githubCommand; 
