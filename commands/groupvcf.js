'use strict';

const localContactStore = require('../lib/lightweight_store');

function escapeVcard(value) {
    return String(value || 'Unknown')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}

function digitsFromParticipant(participant) {
    const raw = participant?.phoneNumber || participant?.id || participant?.jid || participant?.lid || '';
    const digits = String(raw).split('@')[0].split(':')[0].replace(/\D/g, '');
    return digits.length >= 7 ? digits : '';
}

function cleanFilePart(value, fallback = 'WhatsApp') {
    const cleaned = String(value || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');
    return (cleaned || fallback).slice(0, 80);
}

function participantName(participant, number, sock) {
    const jids = [participant?.id, participant?.jid, participant?.lid]
        .filter(Boolean)
        .map(String);
    const numberJid = number ? `${number}@s.whatsapp.net` : '';
    const storedContacts = [sock?.store?.contacts, sock?.contacts, localContactStore?.contacts].filter(Boolean);
    const stored = storedContacts
        .map((contacts) => jids.map((jid) => contacts[jid]).concat(numberJid ? contacts[numberJid] : []))
        .flat()
        .find((contact) => contact?.name || contact?.notify || contact?.vname || contact?.displayName);
    return String(
        stored?.name || stored?.notify || stored?.vname || stored?.displayName ||
        participant?.notify || participant?.name || participant?.vname || participant?.displayName || number
    ).trim() || number;
}

function requesterName(message) {
    return String(
        message?.pushName || message?.key?.pushName || message?.senderName ||
        message?.verifiedBizName || 'WhatsApp'
    ).trim() || 'WhatsApp';
}

function buildVcard(participant, number, name) {
    const safeName = escapeVcard(name);
    return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${safeName}`,
        `N:${safeName};;;;`,
        `TEL;TYPE=CELL,VOICE;waid=${number}:+${number}`,
        'END:VCARD',
        ''
    ].join('\n');
}

const groupVcfCommand = async (sock, chatId, message, isGroup, isSenderAdmin, isOwnerOrSudoCheck) => {
    if (!isGroup) {
        return await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: message });
    }
    if (!isSenderAdmin && !isOwnerOrSudoCheck) {
        return await sock.sendMessage(chatId, { text: '❌ Only group admins or the bot owner can save group contacts.' }, { quoted: message });
    }

    await sock.sendMessage(chatId, { text: '⏳ *Preparing named contacts...* Please wait.' }, { quoted: message });

    try {
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = Array.isArray(groupMetadata?.participants) ? groupMetadata.participants : [];
        const contacts = participants.map((participant) => {
            const number = digitsFromParticipant(participant);
            if (!number) return null;
            return { number, name: participantName(participant, number, sock), participant };
        }).filter(Boolean);

        if (!contacts.length) {
            return await sock.sendMessage(chatId, { text: '❌ No phone contacts were found in this group.' }, { quoted: message });
        }

        const vcfString = contacts.map(({ participant, number, name }) => buildVcard(participant, number, name)).join('');
        const fileName = `${cleanFilePart(requesterName(message))}_Contacts.vcf`;
        const caption = `✅ Saved *${contacts.length}* contacts using each person’s WhatsApp name when available.\n\n📥 Open the VCF file to add them to your phone.`;

        return await sock.sendMessage(chatId, {
            document: Buffer.from(vcfString, 'utf8'),
            fileName,
            mimetype: 'text/vcard',
            caption
        }, { quoted: message });
    } catch (error) {
        console.error('Error generating named group VCF:', error);
        return await sock.sendMessage(chatId, { text: '❌ Failed to generate the VCF contacts file. Ensure the bot is still in the group.' }, { quoted: message });
    }
};

module.exports = groupVcfCommand;
module.exports.buildVcard = buildVcard;
module.exports.participantName = participantName;
