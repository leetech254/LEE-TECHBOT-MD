const fs = require('fs').promises;
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const decryptCommand = async (sock, chatId, message, isOwnerOrSudoCheck, args) => {
    // Basic Auth
    if (!isOwnerOrSudoCheck) return await sock.sendMessage(chatId, { text: '❌ Access Denied.' }, { quoted: message });

    // Identify File
    const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const documentData = quotedMsg?.documentMessage || quotedMsg?.documentWithCaptionMessage?.message?.documentMessage;

    if (!documentData || !documentData.fileName) return await sock.sendMessage(chatId, { text: '❌ Reply to a document file.' }, { quoted: message });

    try {
        await sock.sendMessage(chatId, { text: '⏳ *Forcing file dump...*' }, { quoted: message });

        // Download as Raw Buffer
        const stream = await downloadContentFromMessage(documentData, 'document');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // Force dump as text (even if binary/locked)
        const outputData = buffer.toString('utf-8'); 

        const { TMP_DIR: tempDir } = require('../lib/runtime');
        await fs.mkdir(tempDir, { recursive: true });
        const outputFileName = `Dump_${documentData.fileName}.txt`;
        const tempPath = path.join(tempDir, outputFileName);
        
        await fs.writeFile(tempPath, outputData);

        await sock.sendMessage(chatId, { 
            document: await fs.readFile(tempPath),
            fileName: outputFileName,
            mimetype: 'text/plain',
            caption: `✅ *Dump Complete.*\nIf this looks like code, it's open. If it looks like symbols/random text, the file is encrypted/binary-locked.`
        }, { quoted: message });

        await fs.unlink(tempPath);
    } catch (error) {
        await sock.sendMessage(chatId, { text: `❌ *Error:* ${error.message}` }, { quoted: message });
    }
};

module.exports = decryptCommand;